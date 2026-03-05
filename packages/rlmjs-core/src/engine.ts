import {
  type RlmEngineInput,
  type RlmEngineOutput,
  type RlmMessage,
  type RlmProvider,
  type RlmRunLimits,
  type RlmToolCall,
  type RlmToolResult,
  type RlmToolRuntime,
  type RlmTrace
} from "./types.js";

const DEFAULT_LIMITS: RlmRunLimits = {
  maxDepth: 4,
  maxIterations: 12,
  maxTimeMs: 30_000,
  maxLoadedBytes: 4_000_000
};

export class RlmEngineLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RlmEngineLimitError";
  }
}

export type RlmEngineConfig = {
  provider: RlmProvider;
  tools: RlmToolRuntime;
  limits?: Partial<RlmRunLimits>;
};

type RunInternalInput = {
  query: string;
  systemPrompt?: string;
  depth: number;
};

type RunContext = {
  trace: RlmTrace;
  timeStartMs: number;
  loadedBytes: number;
  totalIterations: number;
  maxDepthReached: number;
};

export class RlmEngine {
  private readonly provider: RlmProvider;
  private readonly tools: RlmToolRuntime;
  private readonly limits: RlmRunLimits;
  private lastTrace: RlmTrace | null = null;

  constructor(config: RlmEngineConfig) {
    this.provider = config.provider;
    this.tools = config.tools;
    this.limits = {
      ...DEFAULT_LIMITS,
      ...(config.limits ?? {})
    };
  }

  getTrace() {
    return this.lastTrace;
  }

  async run(input: RlmEngineInput): Promise<RlmEngineOutput> {
    const context: RunContext = {
      trace: {
        traceId: crypto.randomUUID(),
        steps: []
      },
      timeStartMs: Date.now(),
      loadedBytes: 0,
      totalIterations: 0,
      maxDepthReached: 0
    };

    const output = await this.runInternal({
      query: input.query,
      systemPrompt: input.systemPrompt,
      depth: 0
    }, context);

    this.lastTrace = context.trace;
    return output;
  }

  private async runInternal(input: RunInternalInput, context: RunContext): Promise<RlmEngineOutput> {
    context.maxDepthReached = Math.max(context.maxDepthReached, input.depth);
    this.assertWithinLimits(input.depth, context);

    const messages: RlmMessage[] = [];
    if (input.systemPrompt?.trim()) {
      messages.push({
        role: "system",
        content: input.systemPrompt
      });
    }
    messages.push({
      role: "user",
      content: input.query
    });

    for (let iteration = 0; iteration < this.limits.maxIterations; iteration += 1) {
      this.assertWithinLimits(input.depth, context);

      const action = await this.provider.complete({
        query: input.query,
        depth: input.depth,
        iteration,
        messages,
        traceId: context.trace.traceId
      });
      context.totalIterations += 1;

      context.trace.steps.push({
        depth: input.depth,
        iteration,
        providerAction: action
      });

      if (action.type === "final") {
        return {
          answer: action.answer,
          citations: action.citations ?? [],
          traceId: context.trace.traceId,
          stats: {
            depth: context.maxDepthReached,
            iterations: context.totalIterations,
            loadedBytes: context.loadedBytes,
            elapsedMs: Date.now() - context.timeStartMs
          }
        };
      }

      const toolResult = await this.dispatchToolCall(action.call, input.depth, iteration, context);
      context.trace.steps[context.trace.steps.length - 1]!.toolResult = toolResult;

      messages.push({
        role: "assistant",
        content: JSON.stringify({
          type: "tool_call",
          call: action.call
        })
      });
      messages.push({
        role: "tool",
        name: action.call.name,
        content: JSON.stringify(toolResult)
      });
    }

    throw new RlmEngineLimitError(
      `maxIterations exceeded (${this.limits.maxIterations}) before final answer`
    );
  }

  private async dispatchToolCall(
    call: RlmToolCall,
    depth: number,
    iteration: number,
    context: RunContext
  ): Promise<RlmToolResult> {
    if (call.name === "recursive_query") {
      const query = String(call.args.query ?? "").trim();
      if (!query) {
        return {
          ok: false,
          error: "recursive_query requires non-empty args.query"
        };
      }
      if (depth + 1 > this.limits.maxDepth) {
        return {
          ok: false,
          error: `recursive depth limit reached at depth ${depth}`
        };
      }

      const sub = await this.runInternal({
        query,
        systemPrompt:
          typeof call.args.systemPrompt === "string" ? call.args.systemPrompt : undefined,
        depth: depth + 1
      }, context);
      return {
        ok: true,
        data: {
          answer: sub.answer,
          citations: sub.citations,
          traceId: sub.traceId
        }
      };
    }

    const result = await this.tools.invoke(call, {
      depth,
      iteration,
      traceId: context.trace.traceId,
      loadedBytes: context.loadedBytes
    });
    context.loadedBytes += Math.max(0, Number(result.loadedBytes ?? 0));
    this.assertWithinLimits(depth, context);
    return result;
  }

  private assertWithinLimits(depth: number, context: RunContext) {
    if (depth > this.limits.maxDepth) {
      throw new RlmEngineLimitError(`maxDepth exceeded (${this.limits.maxDepth})`);
    }
    const elapsedMs = Date.now() - context.timeStartMs;
    if (elapsedMs > this.limits.maxTimeMs) {
      throw new RlmEngineLimitError(`maxTimeMs exceeded (${this.limits.maxTimeMs}ms)`);
    }
    if (context.loadedBytes > this.limits.maxLoadedBytes) {
      throw new RlmEngineLimitError(
        `maxLoadedBytes exceeded (${this.limits.maxLoadedBytes} bytes)`
      );
    }
  }
}

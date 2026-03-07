import {
  ReplRuntime,
  type ReplCellResult,
  type ReplChildCallRequest,
  type ReplChildCallResult,
  type ReplLeafCallRequest,
  type ReplLeafCallResult
} from "./repl-runtime.js";
import { parseFinalTag } from "./repl-final-tag.js";

export type ReplControllerMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ReplModelInput = {
  query: string;
  iteration: number;
  traceId: string;
  depth: number;
  contextSizeChars: number;
  contextChunkCount: number;
  messages: ReplControllerMessage[];
};

export type ReplModelOutput = {
  content: string;
};

export interface ReplModel {
  complete(input: ReplModelInput): Promise<ReplModelOutput>;
}

export type ReplChatLikeModel = {
  complete(input: {
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
  }): Promise<{
    content: string;
  }>;
};

export type ReplControllerOptions = {
  model: ReplModel;
  runtime: ReplRuntime;
  maxIterations?: number;
  maxObservationChars?: number;
  systemPrompt?: string;
};

export type ReplControllerTraceStep = {
  iteration: number;
  messagesBeforeModel: ReplControllerMessage[];
  modelOutput: string;
  cellResult?: ReplCellResult;
  observation: string;
};

export type ReplControllerResult = {
  query: string;
  answer: string;
  traceId: string;
  iterations: number;
  trace: ReplControllerTraceStep[];
};

export type ReplLeafCallHandlerOptions = {
  model: ReplChatLikeModel;
  systemPrompt?: string;
  maxContextBytes?: number;
};

export type ReplModelStackOptions = {
  model: ReplChatLikeModel;
  recursiveModel?: ReplChatLikeModel;
  leafModel?: ReplChatLikeModel;
  recursiveMaxIterations?: number;
  recursiveMaxObservationChars?: number;
  recursiveSystemPrompt?: string;
  leafSystemPrompt?: string;
  maxLeafContextBytes?: number;
};

export type ReplCallGraphChild = {
  query: string;
  depth: number;
  chunkIds?: string[];
  traceId?: string;
  answer?: string;
  node?: ReplCallGraphNode;
};

export type ReplCallGraphNode = {
  traceId: string;
  query: string;
  answer: string;
  iterations: number;
  children: ReplCallGraphChild[];
};

export type ReplRunHistoryStep = {
  iteration: number;
  messages: ReplControllerMessage[];
  modelOutput: string;
  observation: string;
  childCalls: ReplCellResult["childCalls"];
  prints?: string[];
  finalAnswer?: string;
  error?: string;
  result?: unknown;
  ok?: boolean;
};

export type ReplRunHistoryNode = {
  traceId: string;
  query: string;
  answer: string;
  depth: number;
  iterations: number;
  steps: ReplRunHistoryStep[];
  children: ReplRunHistoryNode[];
};

export type ReplModelStack = {
  model: ReplModel;
  onRecursiveCall: (input: ReplChildCallRequest) => Promise<ReplChildCallResult>;
  onLeafCall: (input: ReplLeafCallRequest) => Promise<ReplLeafCallResult>;
  buildCallGraph: (result: ReplControllerResult) => ReplCallGraphNode;
  buildRunHistory: (result: ReplControllerResult) => ReplRunHistoryNode;
  getRecordedRuns: () => ReadonlyMap<string, ReplControllerResult>;
  clearRecordedRuns: () => void;
};

const DEFAULT_SYSTEM_PROMPT = [
  "You are a Recursive Language Model operating a JavaScript notebook-style runtime.",
  "You never receive the raw long context in your prompt.",
  "Respond with exactly one JavaScript code block each turn.",
  "Available values: `state`, `context`, `callRlm`, `FINAL`, `FINAL_VAR`, `print`.",
  "All `context` methods are async. Always use `await` with `context.search(...)`, `context.get(...)`, `context.list()`, `context.subviewFromSearch(...)`, `context.range(...)`, `context.window(...)`, and `context.materialize(...)`.",
  "`await context.search(query, { k })` returns hits shaped like `{ chunkId, score, sequence, summary, metadata? }`. Search hits do not have a `content` field.",
  "`await context.get(chunkId)` returns a chunk shaped like `{ chunkId, sequence, text, role?, summary?, metadata? }`.",
  "`await context.materialize({ limitBytes })` returns `{ text, chunkIds, truncated, loadedBytes }` when you need raw text.",
  "Use `context` to search, derive subviews, materialize text, and inspect long context lazily.",
  "Prefer short notebook steps: inspect context first, then narrow, then finalize.",
  "If recursion is needed, narrow the child context before `callRlm(...)` when possible.",
  "Preferred completion: call `FINAL(...)` or `FINAL_VAR(\"name\")` inside the code block.",
  "Compatibility: a trailing line with `FINAL(...)` or `FINAL_VAR(\"name\")` outside code is also accepted, but prefer in-code finalization.",
  "Do not answer with extra prose around final tags.",
  "Do not import modules or rely on DOM, network, filesystem, or ambient globals.",
  "Example:",
  "```js",
  'const hits = await context.search("launch", { k: 3 });',
  'const chunk = hits[0] ? await context.get(hits[0].chunkId) : undefined;',
  "print(hits);",
  'if (chunk) FINAL(chunk.text);',
  "```"
].join("\n");

const DEFAULT_MAX_OBSERVATION_CHARS = 4_096;
const DEFAULT_LEAF_CONTEXT_BYTES = 512_000;
const DEFAULT_LEAF_SYSTEM_PROMPT = [
  "Answer the user using only the provided context.",
  "Do not use tools, code blocks, or notebook state.",
  "Reply with the final answer in plain text."
].join("\n");

function extractCodeBlocks(content: string): string[] {
  const blocks: string[] = [];
  const pattern = /```(?:js|javascript)?\s*([\s\S]*?)```/gi;
  for (const match of content.matchAll(pattern)) {
    const block = match[1]?.trim();
    if (block) {
      blocks.push(block);
    }
  }
  return blocks;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateText(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) {
    return text;
  }

  const suffix = `... [truncated ${text.length - maxChars} chars]`;
  const headLength = Math.max(0, maxChars - suffix.length);
  return `${text.slice(0, headLength)}${suffix}`;
}

function renderObservation(result: ReplCellResult, maxChars: number): string {
  const lines: string[] = [];
  lines.push(`Execution ${result.ok ? "succeeded" : "failed"}.`);

  if (result.prints.length > 0) {
    lines.push(`Prints: ${result.prints.join(" | ")}`);
  }
  if (result.childCalls.length > 0) {
    const childSummary = result.childCalls
      .map((call) => `${call.query}${call.chunkIds ? ` [${call.chunkIds.join(",")}]` : ""}`)
      .join(" | ");
    lines.push(`Child calls: ${childSummary}`);
  }
  if (result.finalAnswer !== undefined) {
    lines.push(`Final answer: ${result.finalAnswer}`);
  }
  if (result.error) {
    lines.push(`Error: ${result.error}`);
  } else if (result.result !== undefined) {
    lines.push(`Result: ${typeof result.result === "string" ? result.result : JSON.stringify(result.result)}`);
  }
  lines.push(`State keys: ${result.stateKeys.join(", ") || "(none)"}`);

  return truncateText(lines.join("\n"), maxChars);
}

function renderMissingCodeObservation(): string {
  return [
    "No executable JavaScript code block was found.",
    "Respond with exactly one ```js``` block that uses the runtime API."
  ].join("\n");
}

function cloneMessages(messages: ReplControllerMessage[]): ReplControllerMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
}

function renderRuntimeStatusMessage(depth: number, contextSizeChars: number, contextChunkCount: number): string {
  return [
    "Runtime status:",
    `- current_depth: ${depth}`,
    `- context_size_chars: ${contextSizeChars}`,
    `- context_chunk_count: ${contextChunkCount}`
  ].join("\n");
}

export class ReplController {
  private readonly model: ReplModel;
  private readonly runtime: ReplRuntime;
  private readonly maxIterations: number;
  private readonly maxObservationChars: number;
  private readonly systemPrompt: string;

  constructor(options: ReplControllerOptions) {
    this.model = options.model;
    this.runtime = options.runtime;
    this.maxIterations = Math.max(1, Math.floor(options.maxIterations ?? 12));
    this.maxObservationChars = Math.max(
      256,
      Math.floor(options.maxObservationChars ?? DEFAULT_MAX_OBSERVATION_CHARS)
    );
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  }

  async run(query: string): Promise<ReplControllerResult> {
    const traceId = crypto.randomUUID();
    const depth = this.runtime.getDepth();
    const contextStats = await this.runtime.getContextStats();
    const messages: ReplControllerMessage[] = [
      {
        role: "system",
        content: this.systemPrompt
      },
      {
        role: "system",
        content: renderRuntimeStatusMessage(depth, contextStats.charLength, contextStats.chunkCount)
      },
      {
        role: "user",
        content: query
      }
    ];
    const trace: ReplControllerTraceStep[] = [];
    let previousCode: string | undefined;

    for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
      const messagesBeforeModel = cloneMessages(messages);
      const response = await this.model.complete({
        query,
        iteration,
        traceId,
        depth,
        contextSizeChars: contextStats.charLength,
        contextChunkCount: contextStats.chunkCount,
        messages: messagesBeforeModel
      });

      messages.push({
        role: "assistant",
        content: response.content
      });

      const codeBlocks = extractCodeBlocks(response.content);
      const parsedFinalTag = parseFinalTag(response.content);
      if (codeBlocks.length === 0) {
        if (parsedFinalTag) {
          return {
            query,
            answer:
              parsedFinalTag.kind === "final"
                ? parsedFinalTag.answer
                : await this.runtime.resolveFinalVar(parsedFinalTag.name),
            traceId,
            iterations: iteration + 1,
            trace: [
              ...trace,
              {
                iteration,
                messagesBeforeModel,
                modelOutput: response.content,
                observation: "Detected final tag in assistant response."
              }
            ]
          };
        }

        const observation = renderMissingCodeObservation();
        trace.push({
          iteration,
          messagesBeforeModel,
          modelOutput: response.content,
          observation
        });
        messages.push({
          role: "user",
          content: observation
        });
        continue;
      }

      const joinedCode = codeBlocks.join("\n\n");
      if (previousCode !== undefined && joinedCode.trim() === previousCode.trim()) {
        throw new Error(`identical code generated in consecutive iterations (${iteration})`);
      }
      previousCode = joinedCode;

      const cellResult = await this.runtime.executeCell(joinedCode);
      const observation = renderObservation(cellResult, this.maxObservationChars);
      trace.push({
        iteration,
        messagesBeforeModel,
        modelOutput: response.content,
        cellResult,
        observation
      });
      messages.push({
        role: "user",
        content: observation
      });

      if (cellResult.finalAnswer !== undefined) {
        return {
          query,
          answer: cellResult.finalAnswer,
          traceId,
          iterations: iteration + 1,
          trace
        };
      }

      if (parsedFinalTag) {
        return {
          query,
          answer:
            parsedFinalTag.kind === "final"
              ? parsedFinalTag.answer
              : await this.runtime.resolveFinalVar(parsedFinalTag.name),
          traceId,
          iterations: iteration + 1,
          trace: [
            ...trace,
            {
              iteration,
              messagesBeforeModel,
              modelOutput: response.content,
              cellResult,
              observation: "Detected final tag in assistant response after code execution."
            }
          ]
        };
      }
    }

    throw new Error(`maxIterations exceeded (${this.maxIterations}) before FINAL(...)`);
  }
}

export function createReplController(
  options: ReplControllerOptions
): ReplController {
  return new ReplController(options);
}

export function createReplChatModelAdapter(
  model: ReplChatLikeModel
): ReplModel {
  return {
    async complete(input: ReplModelInput): Promise<ReplModelOutput> {
      return await model.complete({
        messages: input.messages
      });
    }
  };
}

export function createReplLeafCallHandler(
  options: ReplLeafCallHandlerOptions
): (input: ReplLeafCallRequest) => Promise<ReplLeafCallResult> {
  const maxContextBytes = Math.max(512, Math.floor(options.maxContextBytes ?? DEFAULT_LEAF_CONTEXT_BYTES));
  const systemPrompt = options.systemPrompt ?? DEFAULT_LEAF_SYSTEM_PROMPT;

  return async (input: ReplLeafCallRequest): Promise<ReplLeafCallResult> => {
    const materialized = await input.context.materialize({
      limitBytes: maxContextBytes
    });
    const response = await options.model.complete({
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: [
            `Question: ${input.query}`,
            "",
            "Context:",
            materialized.text || "(empty context)"
          ].join("\n")
        }
      ]
    });

    return {
      answer: response.content.trim()
    };
  };
}

export function buildReplCallGraph(
  result: ReplControllerResult,
  recordedRuns?: ReadonlyMap<string, ReplControllerResult>
): ReplCallGraphNode {
  const children: ReplCallGraphChild[] = [];
  for (const step of result.trace) {
    for (const childCall of step.cellResult?.childCalls ?? []) {
      const childNode =
        childCall.traceId && recordedRuns?.has(childCall.traceId)
          ? buildReplCallGraph(recordedRuns.get(childCall.traceId)!, recordedRuns)
          : undefined;
      children.push({
        query: childCall.query,
        depth: childCall.depth,
        chunkIds: childCall.chunkIds ? [...childCall.chunkIds] : undefined,
        traceId: childCall.traceId,
        answer: childCall.answer,
        node: childNode
      });
    }
  }

  return {
    traceId: result.traceId,
    query: result.query,
    answer: result.answer,
    iterations: result.iterations,
    children
  };
}

export function buildReplRunHistory(
  result: ReplControllerResult,
  recordedRuns?: ReadonlyMap<string, ReplControllerResult>,
  depth = 0
): ReplRunHistoryNode {
  const steps: ReplRunHistoryStep[] = result.trace.map((step) => ({
    iteration: step.iteration,
    messages: cloneMessages(step.messagesBeforeModel),
    modelOutput: step.modelOutput,
    observation: step.observation,
    childCalls: step.cellResult?.childCalls.map((childCall) => ({ ...childCall })) ?? [],
    prints: step.cellResult?.prints ? [...step.cellResult.prints] : undefined,
    finalAnswer: step.cellResult?.finalAnswer,
    error: step.cellResult?.error,
    result: step.cellResult?.result,
    ok: step.cellResult?.ok
  }));

  const childTraceIds = new Set<string>();
  const children: ReplRunHistoryNode[] = [];
  for (const step of result.trace) {
    for (const childCall of step.cellResult?.childCalls ?? []) {
      if (!childCall.traceId || childTraceIds.has(childCall.traceId)) {
        continue;
      }
      const childResult = recordedRuns?.get(childCall.traceId);
      if (!childResult) {
        continue;
      }
      childTraceIds.add(childCall.traceId);
      children.push(buildReplRunHistory(childResult, recordedRuns, childCall.depth));
    }
  }

  return {
    traceId: result.traceId,
    query: result.query,
    answer: result.answer,
    depth,
    iterations: result.iterations,
    steps,
    children
  };
}

export function createReplModelStack(
  options: ReplModelStackOptions
): ReplModelStack {
  const rootModel = createReplChatModelAdapter(options.model);
  const recursiveChatModel = options.recursiveModel ?? options.model;
  const recursiveModel = createReplChatModelAdapter(recursiveChatModel);
  const leafModel = options.leafModel ?? recursiveChatModel;
  const recordedRuns = new Map<string, ReplControllerResult>();

  return {
    model: rootModel,
    onRecursiveCall: async ({ query, runtime }) => {
      const childController = new ReplController({
        runtime,
        model: recursiveModel,
        maxIterations: options.recursiveMaxIterations,
        maxObservationChars: options.recursiveMaxObservationChars,
        systemPrompt: options.recursiveSystemPrompt
      });
      const childResult = await childController.run(query);
      recordedRuns.set(childResult.traceId, childResult);
      return {
        answer: childResult.answer,
        traceId: childResult.traceId
      };
    },
    onLeafCall: createReplLeafCallHandler({
      model: leafModel,
      systemPrompt: options.leafSystemPrompt,
      maxContextBytes: options.maxLeafContextBytes
    }),
    buildCallGraph(result) {
      recordedRuns.set(result.traceId, result);
      return buildReplCallGraph(result, recordedRuns);
    },
    buildRunHistory(result) {
      recordedRuns.set(result.traceId, result);
      return buildReplRunHistory(result, recordedRuns);
    },
    getRecordedRuns() {
      return new Map(recordedRuns);
    },
    clearRecordedRuns() {
      recordedRuns.clear();
    }
  };
}

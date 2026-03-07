import { ContextHandle, MemoryCorpusStore, type CorpusStore } from "./corpus.js";
import type { ReplStateStore } from "./repl-state-store.js";

const AsyncFunction = Object.getPrototypeOf(async function noop() {
  return undefined;
}).constructor as new (
  ...args: string[]
) => (
  state: Record<string, unknown>,
  context: ContextHandle,
  callRlm: (query: string, options?: ReplChildCallOptions) => Promise<ReplChildCallResult>,
  FINAL: (answer: unknown) => string,
  FINAL_VAR: (name: string) => string,
  print: (...args: unknown[]) => void
) => Promise<unknown>;

const SHADOWED_GLOBAL_NAMES = [
  "globalThis",
  "global",
  "self",
  "window",
  "document",
  "fetch",
  "Function",
  "XMLHttpRequest",
  "WebSocket",
  "Worker",
  "navigator",
  "location",
  "indexedDB",
  "localStorage",
  "sessionStorage",
  "process",
  "Buffer",
  "postMessage",
  "importScripts",
  "module",
  "require"
] as const;

const FORBIDDEN_SOURCE_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /\bimport\s*\(/,
    message: "dynamic import is not available in the browser REPL runtime"
  },
  {
    pattern: /\bimport\.meta\b/,
    message: "import.meta is not available in the browser REPL runtime"
  },
  {
    pattern: /\bconstructor\s*\.\s*constructor\s*\(/,
    message: "constructor-based global escapes are not available in the browser REPL runtime"
  }
];

export type ReplChildCallOptions = {
  context?: ContextHandle;
  chunkIds?: string[];
  text?: string;
};

export type ReplChildCallRequest = {
  query: string;
  context: ContextHandle;
  depth: number;
  runtime: ReplRuntime;
};

export type ReplChildCallResult = {
  answer: string;
  traceId?: string;
};

export type ReplLeafCallRequest = {
  query: string;
  context: ContextHandle;
  depth: number;
};

export type ReplLeafCallResult = ReplChildCallResult;

export type ReplChildCallTrace = {
  query: string;
  depth: number;
  chunkIds?: string[];
  traceId?: string;
  answer?: string;
};

export type ReplCellTrace = {
  code: string;
  prints: string[];
  elapsedMs: number;
  finalAnswer?: string;
  result?: unknown;
  error?: string;
  childCalls: ReplChildCallTrace[];
};

export type ReplCellResult = {
  ok: boolean;
  prints: string[];
  elapsedMs: number;
  finalAnswer?: string;
  result?: unknown;
  error?: string;
  childCalls: ReplChildCallTrace[];
  stateKeys: string[];
};

export type ReplContextStats = {
  chunkCount: number;
  charLength: number;
};

export type ReplRuntimeOptions = {
  context: ContextHandle | CorpusStore;
  onRecursiveCall?: (input: ReplChildCallRequest) => Promise<ReplChildCallResult>;
  onLeafCall?: (input: ReplLeafCallRequest) => Promise<ReplLeafCallResult>;
  initialState?: Record<string, unknown>;
  sessionId?: string;
  stateStore?: ReplStateStore;
  maxChildCalls?: number;
  // This limit is cooperative in the inline restricted runtime. It cannot preempt
  // synchronous infinite loops and should not be treated as a hard isolation boundary.
  maxExecutionMs?: number;
  // Defaults to 1 to match the depth-1 setup described in the original RLM blog.
  // Larger values are supported here as an explicit extension of that baseline.
  maxDepth?: number;
  depth?: number;
};

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`cooperative cell execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function assertSupportedSource(source: string): void {
  for (const rule of FORBIDDEN_SOURCE_PATTERNS) {
    if (rule.pattern.test(source)) {
      throw new Error(rule.message);
    }
  }
}

function createEphemeralContext(
  text: string,
  depth: number,
  childCallIndex: number
): { context: ContextHandle; chunkId: string } {
  const chunkId = `ephemeral:${depth}:${childCallIndex}`;
  const store = new MemoryCorpusStore();
  store.putChunks([
    {
      chunkId,
      sequence: 1,
      role: "derived",
      text
    }
  ]);
  return {
    context: new ContextHandle(store),
    chunkId
  };
}

export class ReplRuntime {
  private readonly rootContext: ContextHandle;
  private readonly onRecursiveCall?: (input: ReplChildCallRequest) => Promise<ReplChildCallResult>;
  private readonly onLeafCall?: (input: ReplLeafCallRequest) => Promise<ReplLeafCallResult>;
  private readonly sessionId?: string;
  private readonly stateStore?: ReplStateStore;
  private readonly maxChildCalls: number;
  private readonly maxExecutionMs: number;
  private readonly maxDepth: number;
  private readonly depth: number;
  private readonly state: Record<string, unknown>;
  private readonly trace: ReplCellTrace[] = [];
  private budgetState = {
    totalChildCalls: 0
  };
  private stateLoaded = false;
  private stateLoadPromise: Promise<void> | null = null;

  constructor(options: ReplRuntimeOptions) {
    this.rootContext =
      options.context instanceof ContextHandle
        ? options.context
        : new ContextHandle(options.context);
    this.onRecursiveCall = options.onRecursiveCall;
    this.onLeafCall = options.onLeafCall;
    this.sessionId = options.sessionId?.trim() || undefined;
    this.stateStore = options.stateStore;
    this.maxChildCalls = Math.max(0, Math.floor(options.maxChildCalls ?? 8));
    this.maxExecutionMs = Math.max(1, Math.floor(options.maxExecutionMs ?? 5_000));
    this.maxDepth = Math.max(0, Math.floor(options.maxDepth ?? 1));
    this.depth = Math.max(0, Math.floor(options.depth ?? 0));
    this.state = { ...(options.initialState ?? {}) };
  }

  getContext(): ContextHandle {
    return this.rootContext;
  }

  async getStateSnapshot(): Promise<Record<string, unknown>> {
    await this.ensureStateLoaded();
    return { ...this.state };
  }

  getDepth(): number {
    return this.depth;
  }

  getMaxDepth(): number {
    return this.maxDepth;
  }

  async getContextStats(): Promise<ReplContextStats> {
    const chunks = await this.rootContext.list();
    return {
      chunkCount: chunks.length,
      charLength: chunks.reduce((total, chunk) => total + chunk.text.length, 0)
    };
  }

  async hydrateState(): Promise<void> {
    await this.ensureStateLoaded();
  }

  async resolveFinalVar(name: string): Promise<string> {
    await this.ensureStateLoaded();
    return this.resolveFinalVarLoaded(name);
  }

  private resolveFinalVarLoaded(name: string): string {
    const key = String(name ?? "").trim();
    if (!key || !(key in this.state)) {
      throw new Error(`state variable not found: ${key}`);
    }
    return formatValue(this.state[key]);
  }

  private async ensureStateLoaded(): Promise<void> {
    if (this.stateLoaded) {
      return;
    }

    if (!this.stateStore || !this.sessionId) {
      this.stateLoaded = true;
      return;
    }

    if (!this.stateLoadPromise) {
      this.stateLoadPromise = (async () => {
        const loaded = await this.stateStore?.loadState(this.sessionId!);
        if (loaded) {
          for (const key of Object.keys(this.state)) {
            delete this.state[key];
          }
          Object.assign(this.state, loaded);
        }
        this.stateLoaded = true;
      })();
    }

    await this.stateLoadPromise;
  }

  private async persistStateIfConfigured(): Promise<void> {
    if (!this.stateStore || !this.sessionId) {
      return;
    }

    await this.stateStore.saveState(this.sessionId, this.state);
  }

  private createChildRuntime(context: ContextHandle, depth: number): ReplRuntime {
    const childRuntime = new ReplRuntime({
      context,
      depth,
      maxDepth: this.maxDepth,
      maxChildCalls: this.maxChildCalls,
      maxExecutionMs: this.maxExecutionMs,
      onRecursiveCall: this.onRecursiveCall,
      onLeafCall: this.onLeafCall
    });
    childRuntime.budgetState = this.budgetState;
    return childRuntime;
  }

  getTrace(): ReplCellTrace[] {
    return this.trace.map((entry) => ({
      ...entry,
      prints: [...entry.prints],
      childCalls: entry.childCalls.map((call) => ({ ...call }))
    }));
  }

  async executeCell(code: string): Promise<ReplCellResult> {
    await this.ensureStateLoaded();
    const source = code.trim();
    const prints: string[] = [];
    const childCalls: ReplChildCallTrace[] = [];
    const startedAt = Date.now();
    let finalAnswer: string | undefined;

    const FINAL = (answer: unknown): string => {
      finalAnswer = formatValue(answer);
      return finalAnswer;
    };

    const FINAL_VAR = (name: string): string => {
      finalAnswer = this.resolveFinalVarLoaded(name);
      return finalAnswer;
    };

    const print = (...args: unknown[]) => {
      prints.push(args.map((arg) => formatValue(arg)).join(" "));
    };

    const callRlm = async (
      query: string,
      options?: ReplChildCallOptions
    ): Promise<ReplChildCallResult> => {
      if (!this.onRecursiveCall) {
        if (!this.onLeafCall) {
          throw new Error("callRlm is not configured for this runtime");
        }
      }
      if (this.budgetState.totalChildCalls >= this.maxChildCalls) {
        throw new Error(`maxChildCalls exceeded (${this.maxChildCalls})`);
      }

      const childCallIndex = this.budgetState.totalChildCalls + 1;
      const childDepth = this.depth + 1;
      const ephemeralContext =
        typeof options?.text === "string"
          ? createEphemeralContext(options.text, childDepth, childCallIndex)
          : undefined;
      const childContext =
        ephemeralContext?.context ??
        options?.context ??
        (options?.chunkIds ? this.rootContext.select(options.chunkIds) : this.rootContext);

      const traceEntry: ReplChildCallTrace = {
        query: String(query ?? ""),
        depth: childDepth,
        chunkIds: ephemeralContext ? [ephemeralContext.chunkId] : childContext.getChunkIds()
      };
      childCalls.push(traceEntry);
      this.budgetState.totalChildCalls = childCallIndex;

      if (childDepth >= this.maxDepth) {
        if (!this.onLeafCall) {
          throw new Error(`leaf call handler is not configured at depth ${childDepth}`);
        }
        const result = await this.onLeafCall({
          query: traceEntry.query,
          context: childContext,
          depth: traceEntry.depth
        });
        traceEntry.traceId = result.traceId;
        traceEntry.answer = result.answer;
        return result;
      }

      if (!this.onRecursiveCall) {
        throw new Error("recursive child call handler is not configured for this runtime");
      }

      const childRuntime = this.createChildRuntime(childContext, traceEntry.depth);

      const result = await this.onRecursiveCall({
        query: traceEntry.query,
        context: childContext,
        depth: traceEntry.depth,
        runtime: childRuntime
      });
      traceEntry.traceId = result.traceId;
      traceEntry.answer = result.answer;
      return result;
    };

    try {
      assertSupportedSource(source);
      const run = new AsyncFunction(
        "state",
        "context",
        "callRlm",
        "FINAL",
        "FINAL_VAR",
        "print",
        ...SHADOWED_GLOBAL_NAMES,
        `"use strict";\n${source}`
      );
      const invokeRun = run as (...args: unknown[]) => Promise<unknown>;
      const result = await withTimeout(
        invokeRun(
          this.state,
          this.rootContext,
          callRlm,
          FINAL,
          FINAL_VAR,
          print,
          ...SHADOWED_GLOBAL_NAMES.map(() => undefined)
        ),
        this.maxExecutionMs
      );
      const elapsedMs = Date.now() - startedAt;
      const cellResult: ReplCellResult = {
        ok: true,
        prints,
        elapsedMs,
        finalAnswer,
        result,
        childCalls,
        stateKeys: Object.keys(this.state).sort()
      };
      try {
        await this.persistStateIfConfigured();
      } catch (persistError) {
        const persistMessage =
          persistError instanceof Error ? persistError.message : "state persistence failed";
        cellResult.ok = false;
        cellResult.error = persistMessage;
      }
      this.trace.push({
        code,
        prints,
        elapsedMs,
        finalAnswer,
        result,
        error: cellResult.error,
        childCalls
      });
      return cellResult;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "cell execution failed";
      const cellResult: ReplCellResult = {
        ok: false,
        prints,
        elapsedMs,
        finalAnswer,
        error: message,
        childCalls,
        stateKeys: Object.keys(this.state).sort()
      };
      try {
        await this.persistStateIfConfigured();
      } catch (persistError) {
        const persistMessage =
          persistError instanceof Error ? persistError.message : "state persistence failed";
        cellResult.error = `${message}; persistence: ${persistMessage}`;
      }
      this.trace.push({
        code,
        prints,
        elapsedMs,
        finalAnswer,
        error: cellResult.error,
        childCalls
      });
      return cellResult;
    }
  }
}

export function createReplRuntime(options: ReplRuntimeOptions): ReplRuntime {
  return new ReplRuntime(options);
}

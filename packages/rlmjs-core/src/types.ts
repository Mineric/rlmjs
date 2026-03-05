export type RlmRole = "system" | "user" | "assistant" | "tool";

export type RlmMessage = {
  role: RlmRole;
  content: string;
  name?: string;
};

export type RlmRunLimits = {
  maxDepth: number;
  maxIterations: number;
  maxTimeMs: number;
  maxLoadedBytes: number;
};

export type RlmToolCall = {
  name: string;
  args: Record<string, unknown>;
};

export type RlmToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  loadedBytes?: number;
};

export type JsonLike =
  | string
  | number
  | boolean
  | null
  | JsonLike[]
  | { [key: string]: JsonLike };

export type RlmProviderAction =
  | {
      type: "final";
      answer: string;
      citations?: Array<{ id: string; start?: number; end?: number }>;
    }
  | {
      type: "tool_call";
      call: RlmToolCall;
      rationale?: string;
    };

export type RlmProviderInput = {
  query: string;
  depth: number;
  iteration: number;
  messages: RlmMessage[];
  traceId: string;
};

export interface RlmProvider {
  complete(input: RlmProviderInput): Promise<RlmProviderAction>;
}

export type RlmToolRuntimeState = {
  depth: number;
  iteration: number;
  traceId: string;
  loadedBytes: number;
};

export interface RlmToolRuntime {
  invoke(call: RlmToolCall, state: RlmToolRuntimeState): Promise<RlmToolResult>;
}

export type RlmSliceSearchArgs = {
  query: string;
  k?: number;
  filters?: Record<string, JsonLike>;
};

export type RlmSliceLoadArgs = {
  sliceId: string;
  start?: number;
  end?: number;
};

export type RlmSliceNeighborArgs = {
  sliceId: string;
  radius?: number;
};

export type RlmSliceSummaryArgs = {
  sliceId: string;
};

export type RlmSlice = {
  sliceId: string;
  text: string;
  metadata?: Record<string, JsonLike>;
};

export type RlmSliceSearchHit = {
  sliceId: string;
  score: number;
  summary?: string;
  metadata?: Record<string, JsonLike>;
};

export interface RlmStorageAdapter {
  searchSlices(args: RlmSliceSearchArgs): Promise<RlmSliceSearchHit[]>;
  loadSlice(args: RlmSliceLoadArgs): Promise<RlmSlice>;
  loadNeighbors(args: RlmSliceNeighborArgs): Promise<RlmSlice[]>;
  getSliceSummary(args: RlmSliceSummaryArgs): Promise<{ sliceId: string; summary: string }>;
}

export type RlmEngineInput = {
  query: string;
  systemPrompt?: string;
};

export type RlmEngineOutput = {
  answer: string;
  citations: Array<{ id: string; start?: number; end?: number }>;
  traceId: string;
  stats: {
    depth: number;
    iterations: number;
    loadedBytes: number;
    elapsedMs: number;
  };
};

export type RlmTraceStep = {
  depth: number;
  iteration: number;
  providerAction: RlmProviderAction;
  toolResult?: RlmToolResult;
};

export type RlmTrace = {
  traceId: string;
  steps: RlmTraceStep[];
};

import type {
  RlmStorageAdapter,
  RlmToolCall,
  RlmToolResult,
  RlmToolRuntime,
  RlmToolRuntimeState
} from "./types.js";

type StorageToolRuntimeOptions = {
  fallback?: RlmToolRuntime;
};

function estimateLoadedBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

export function createStorageToolRuntime(
  storage: RlmStorageAdapter,
  options?: StorageToolRuntimeOptions
): RlmToolRuntime {
  return {
    async invoke(call: RlmToolCall, state: RlmToolRuntimeState): Promise<RlmToolResult> {
      switch (call.name) {
        case "searchSlices": {
          const data = await storage.searchSlices({
            query: String(call.args.query ?? ""),
            k: typeof call.args.k === "number" ? call.args.k : undefined,
            filters:
              call.args.filters && typeof call.args.filters === "object"
                ? (call.args.filters as Record<string, string | number | boolean | null>)
                : undefined
          });
          return { ok: true, data, loadedBytes: estimateLoadedBytes(data) };
        }
        case "loadSlice": {
          const data = await storage.loadSlice({
            sliceId: String(call.args.sliceId ?? ""),
            start: typeof call.args.start === "number" ? call.args.start : undefined,
            end: typeof call.args.end === "number" ? call.args.end : undefined
          });
          return { ok: true, data, loadedBytes: estimateLoadedBytes(data.text) };
        }
        case "loadNeighbors": {
          const data = await storage.loadNeighbors({
            sliceId: String(call.args.sliceId ?? ""),
            radius: typeof call.args.radius === "number" ? call.args.radius : undefined
          });
          return { ok: true, data, loadedBytes: estimateLoadedBytes(data) };
        }
        case "getSliceSummary": {
          const data = await storage.getSliceSummary({
            sliceId: String(call.args.sliceId ?? "")
          });
          return { ok: true, data, loadedBytes: estimateLoadedBytes(data.summary) };
        }
        default:
          if (!options?.fallback) {
            return {
              ok: false,
              error: `unknown tool '${call.name}'`
            };
          }
          return options.fallback.invoke(call, state);
      }
    }
  };
}

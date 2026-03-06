import type {
  RlmStorageAdapter,
  RlmSubcontext,
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

function normalizeSliceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const cleaned = entry.trim();
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    output.push(cleaned);
  }
  return output;
}

function normalizeSubcontext(value: unknown): RlmSubcontext | undefined {
  if (value && typeof value === "object") {
    const candidate = value as { sliceIds?: unknown };
    const sliceIds = normalizeSliceIds(candidate.sliceIds);
    if (sliceIds.length > 0) {
      return {
        mode: "restricted",
        sliceIds
      };
    }
  }

  const sliceIds = normalizeSliceIds(value);
  if (sliceIds.length > 0) {
    return {
      mode: "restricted",
      sliceIds
    };
  }

  return undefined;
}

function mergeSubcontexts(
  parent: RlmSubcontext | undefined,
  child: RlmSubcontext | undefined
): RlmSubcontext | undefined {
  if (!parent) {
    return child;
  }
  if (!child) {
    return parent;
  }

  const allowed = new Set(parent.sliceIds);
  return {
    mode: "restricted",
    sliceIds: child.sliceIds.filter((sliceId) => allowed.has(sliceId))
  };
}

export function createStorageToolRuntime(
  storage: RlmStorageAdapter,
  options?: StorageToolRuntimeOptions
): RlmToolRuntime {
  return {
    async invoke(call: RlmToolCall, state: RlmToolRuntimeState): Promise<RlmToolResult> {
      const effectiveSubcontext = mergeSubcontexts(
        state.subcontext,
        normalizeSubcontext(call.args.subcontext)
      );

      switch (call.name) {
        case "searchSlices": {
          const data = await storage.searchSlices({
            query: String(call.args.query ?? ""),
            k: typeof call.args.k === "number" ? call.args.k : undefined,
            filters:
              call.args.filters && typeof call.args.filters === "object"
                ? (call.args.filters as Record<string, string | number | boolean | null>)
                : undefined,
            subcontext: effectiveSubcontext
          });
          return { ok: true, data, loadedBytes: estimateLoadedBytes(data) };
        }
        case "loadSlice": {
          const data = await storage.loadSlice({
            sliceId: String(call.args.sliceId ?? ""),
            start: typeof call.args.start === "number" ? call.args.start : undefined,
            end: typeof call.args.end === "number" ? call.args.end : undefined,
            subcontext: effectiveSubcontext
          });
          return { ok: true, data, loadedBytes: estimateLoadedBytes(data.text) };
        }
        case "loadNeighbors": {
          const data = await storage.loadNeighbors({
            sliceId: String(call.args.sliceId ?? ""),
            radius: typeof call.args.radius === "number" ? call.args.radius : undefined,
            subcontext: effectiveSubcontext
          });
          return { ok: true, data, loadedBytes: estimateLoadedBytes(data) };
        }
        case "getSliceSummary": {
          const data = await storage.getSliceSummary({
            sliceId: String(call.args.sliceId ?? ""),
            subcontext: effectiveSubcontext
          });
          return { ok: true, data, loadedBytes: estimateLoadedBytes(data.summary) };
        }
        case "composeSubcontext": {
          const sliceIds = normalizeSliceIds(call.args.sliceIds);
          const composed = mergeSubcontexts(
            state.subcontext,
            normalizeSubcontext(call.args.subcontext) ??
              (sliceIds.length > 0
                ? {
                    mode: "restricted",
                    sliceIds
                  }
                : undefined)
          );
          return {
            ok: true,
            data: {
              subcontext: composed ?? {
                mode: "restricted",
                sliceIds: []
              },
              count: composed?.sliceIds.length ?? 0
            },
            loadedBytes: estimateLoadedBytes(composed ?? [])
          };
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

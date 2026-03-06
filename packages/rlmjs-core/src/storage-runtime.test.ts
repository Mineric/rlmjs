import { test } from "node:test";
import assert from "node:assert/strict";

import { createStorageToolRuntime } from "./storage-runtime.js";
import type { RlmStorageAdapter } from "./types.js";

const adapter: RlmStorageAdapter = {
  async searchSlices(args) {
    return [{ sliceId: `s:${args.query}`, score: 1 }];
  },
  async loadSlice(args) {
    return { sliceId: args.sliceId, text: "abcdef" };
  },
  async loadNeighbors(args) {
    return [
      { sliceId: `${args.sliceId}-1`, text: "a" },
      { sliceId: `${args.sliceId}+1`, text: "b" }
    ];
  },
  async getSliceSummary(args) {
    return { sliceId: args.sliceId, summary: "summary" };
  }
};

test("storage runtime dispatches search/load tools", async () => {
  const runtime = createStorageToolRuntime(adapter);

  const search = await runtime.invoke(
    { name: "searchSlices", args: { query: "hello", k: 3 } },
    { depth: 0, iteration: 0, traceId: "t", loadedBytes: 0 }
  );
  assert.equal(search.ok, true);
  assert.equal((search.data as Array<{ sliceId: string }>)[0]?.sliceId, "s:hello");

  const load = await runtime.invoke(
    { name: "loadSlice", args: { sliceId: "s1", start: 0, end: 2 } },
    { depth: 0, iteration: 1, traceId: "t", loadedBytes: 0 }
  );
  assert.equal(load.ok, true);
  assert.equal((load.data as { sliceId: string }).sliceId, "s1");
  assert.ok((load.loadedBytes ?? 0) > 0);
});

test("storage runtime composes subcontexts and forwards restricted scope", async () => {
  let seenSubcontext: unknown = null;
  const scopedRuntime = createStorageToolRuntime({
    async searchSlices(args) {
      seenSubcontext = args.subcontext;
      return [{ sliceId: "s:scoped", score: 1 }];
    },
    async loadSlice(args) {
      return { sliceId: args.sliceId, text: "abcdef" };
    },
    async loadNeighbors() {
      return [];
    },
    async getSliceSummary(args) {
      return { sliceId: args.sliceId, summary: "summary" };
    }
  });

  const composed = await scopedRuntime.invoke(
    { name: "composeSubcontext", args: { sliceIds: ["s1", "s2", "s2"] } },
    {
      depth: 1,
      iteration: 0,
      traceId: "t",
      loadedBytes: 0,
      subcontext: {
        mode: "restricted",
        sliceIds: ["s2", "s3"]
      }
    }
  );

  assert.equal(composed.ok, true);
  assert.deepEqual(
    (composed.data as { subcontext: { sliceIds: string[] } }).subcontext.sliceIds,
    ["s2"]
  );

  await scopedRuntime.invoke(
    {
      name: "searchSlices",
      args: {
        query: "hello",
        subcontext: {
          mode: "restricted",
          sliceIds: ["s1", "s2"]
        }
      }
    },
    {
      depth: 1,
      iteration: 1,
      traceId: "t",
      loadedBytes: 0,
      subcontext: {
        mode: "restricted",
        sliceIds: ["s2", "s3"]
      }
    }
  );

  assert.deepEqual(seenSubcontext, {
    mode: "restricted",
    sliceIds: ["s2"]
  });
});

test("storage runtime uses fallback for unknown tools", async () => {
  const runtime = createStorageToolRuntime(adapter, {
    fallback: {
      async invoke(call) {
        return { ok: true, data: { tool: call.name } };
      }
    }
  });

  const out = await runtime.invoke(
    { name: "customTool", args: {} },
    { depth: 0, iteration: 0, traceId: "t", loadedBytes: 0 }
  );

  assert.equal(out.ok, true);
  assert.equal((out.data as { tool: string }).tool, "customTool");
});

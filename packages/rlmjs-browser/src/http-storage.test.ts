import { test } from "node:test";
import assert from "node:assert/strict";

import { HttpStorageAdapter } from "./http-storage.js";

test("http storage adapter posts to expected endpoint", async () => {
  const adapter = new HttpStorageAdapter({
    baseUrl: "https://storage.example",
    fetchImpl: (async (url, init) => {
      assert.equal(url, "https://storage.example/searchSlices");
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify([{ sliceId: "s1", score: 1 }]), { status: 200 });
    }) as typeof fetch
  });

  const hits = await adapter.searchSlices({ query: "hello" });
  assert.equal(hits[0]?.sliceId, "s1");
});

test("http storage adapter throws on non-2xx", async () => {
  const adapter = new HttpStorageAdapter({
    baseUrl: "https://storage.example",
    fetchImpl: (async () => new Response("bad", { status: 500 })) as typeof fetch
  });

  await assert.rejects(() => adapter.loadSlice({ sliceId: "x" }), /storage HTTP 500/);
});

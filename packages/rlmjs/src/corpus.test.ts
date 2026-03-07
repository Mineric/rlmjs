import { test } from "node:test";
import assert from "node:assert/strict";

import { ContextHandle, MemoryCorpusStore } from "./corpus.js";

function createStore(): MemoryCorpusStore {
  const store = new MemoryCorpusStore();
  store.putChunks([
    {
      chunkId: "c1",
      sequence: 1,
      role: "user",
      text: "Customer asked about the launch date for Project Atlas."
    },
    {
      chunkId: "c2",
      sequence: 2,
      role: "assistant",
      text: "Project Atlas launches on April 12 according to the latest plan."
    },
    {
      chunkId: "c3",
      sequence: 3,
      role: "user",
      text: "There was also a refund issue in a separate thread."
    }
  ]);
  return store;
}

test("memory corpus store searches by lexical relevance", async () => {
  const store = createStore();

  const hits = await store.searchChunks({ query: "launch atlas", k: 2 });

  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.chunkId, "c1");
  assert.equal(hits[1]?.chunkId, "c2");
});

test("context handle can derive restricted subviews", async () => {
  const context = new ContextHandle(createStore());

  const focused = context.select(["c2", "c3"]);
  const chunks = await focused.list();

  assert.deepEqual(
    chunks.map((chunk) => chunk.chunkId),
    ["c2", "c3"]
  );
  assert.equal(await focused.get("c1"), undefined);
  assert.equal(Reflect.has(focused as object, "getStore"), false);
});

test("context handle can produce windows and ranges", async () => {
  const context = new ContextHandle(createStore());

  const windowed = await context.window("c2", 1);
  const ranged = await context.range(2, 3);

  assert.deepEqual(
    (await windowed.list()).map((chunk) => chunk.chunkId),
    ["c1", "c2", "c3"]
  );
  assert.deepEqual(
    (await ranged.list()).map((chunk) => chunk.chunkId),
    ["c2", "c3"]
  );
});

test("context handle materializes bounded text views", async () => {
  const context = new ContextHandle(createStore());

  const out = await context.materialize({ limitBytes: 90 });

  assert.equal(out.chunkIds.length, 2);
  assert.equal(out.chunkIds[0], "c1");
  assert.equal(out.chunkIds[1], "c2");
  assert.equal(out.truncated, true);
  assert.equal(out.loadedBytes, 90);
  assert.match(out.text, /Project Atlas/);
});

test("context handle materializes partial text from oversized chunks", async () => {
  const store = new MemoryCorpusStore();
  store.putChunks([
    {
      chunkId: "big",
      sequence: 1,
      role: "user",
      text: "x".repeat(5_000)
    }
  ]);

  const out = await new ContextHandle(store).materialize({ limitBytes: 2_000 });

  assert.equal(out.chunkIds[0], "big");
  assert.equal(out.truncated, true);
  assert.ok(out.text.length > 0);
  assert.match(out.text, /^\[1:big user\] x+/);
});

test("context handle can create focused views from search hits", async () => {
  const context = new ContextHandle(createStore());

  const focused = await context.subviewFromSearch("refund", { k: 2 });

  assert.deepEqual(
    (await focused.list()).map((chunk) => chunk.chunkId),
    ["c3"]
  );
});

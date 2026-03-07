import { test } from "node:test";
import assert from "node:assert/strict";

import { MemoryCorpusStore } from "./corpus.js";
import { SemanticCorpusStore } from "./semantic-corpus-store.js";

function createEmbedding(text: string): number[] {
  const lower = text.toLowerCase();
  const launchish =
    lower.includes("launch") || lower.includes("launches") || lower.includes("go live");
  const dateish =
    lower.includes("april 12") || lower.includes("date");
  const refundish =
    lower.includes("refund") || lower.includes("billing");

  return [
    launchish ? 1 : 0,
    dateish ? 1 : 0,
    refundish ? 1 : 0
  ];
}

test("semantic corpus store delegates storage operations to the base store", async () => {
  const baseStore = new MemoryCorpusStore();
  const store = new SemanticCorpusStore({
    baseStore,
    embedText: async ({ text }) => createEmbedding(text)
  });

  await store.putChunks([
    {
      chunkId: "c1",
      sequence: 1,
      text: "Atlas launches on April 12."
    }
  ]);

  const listed = await store.listChunks();
  const chunk = await store.getChunk("c1");

  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.chunkId, "c1");
  assert.equal(chunk?.text, "Atlas launches on April 12.");
});

test("semantic corpus store can retrieve paraphrased matches without lexical overlap", async () => {
  const baseStore = new MemoryCorpusStore();
  const store = new SemanticCorpusStore({
    baseStore,
    embedText: async ({ text }) => createEmbedding(text)
  });

  await store.putChunks([
    {
      chunkId: "launch",
      sequence: 1,
      text: "Project Atlas launches on April 12."
    },
    {
      chunkId: "refund",
      sequence: 2,
      text: "The billing issue was resolved in a separate thread."
    }
  ]);

  const hits = await store.searchChunks({
    query: "What is the go live date for Atlas?",
    k: 2
  });

  assert.equal(hits[0]?.chunkId, "launch");
  assert.equal(hits[1], undefined);
});

test("semantic corpus store fails clearly when semantic search is not configured", async () => {
  const baseStore = new MemoryCorpusStore();
  const store = new SemanticCorpusStore({
    baseStore
  });

  await assert.rejects(
    () => store.searchChunks({ query: "launch" }),
    /semantic search is not configured/
  );
});

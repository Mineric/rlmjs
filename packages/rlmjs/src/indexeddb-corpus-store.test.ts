import { test } from "node:test";
import assert from "node:assert/strict";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import { IndexedDbCorpusStore } from "./indexeddb-corpus-store.js";

test("indexeddb corpus store fails clearly when IndexedDB is unavailable", async () => {
  const store = new IndexedDbCorpusStore({ dbName: "test-db" });

  await assert.rejects(
    () => store.searchChunks({ query: "hello" }),
    /IndexedDB is not available in this runtime/
  );
});

test("indexeddb corpus store can persist and retrieve chunks", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = fakeIndexedDB;

  try {
    const dbName = `test-db-${Date.now()}`;
    const writer = new IndexedDbCorpusStore({ dbName });
    await writer.putChunks([
      {
        chunkId: "c1",
        sequence: 1,
        text: "Project Atlas launches on April 12."
      },
      {
        chunkId: "c2",
        sequence: 2,
        text: "The billing issue was unrelated."
      }
    ]);

    const reader = new IndexedDbCorpusStore({ dbName });
    const chunk = await reader.getChunk("c1");
    const hits = await reader.searchChunks({ query: "launch april", k: 2 });

    assert.equal(chunk?.text, "Project Atlas launches on April 12.");
    assert.equal(hits[0]?.chunkId, "c1");
    assert.equal((await reader.listChunks()).length, 2);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

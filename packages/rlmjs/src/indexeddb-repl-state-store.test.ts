import { test } from "node:test";
import assert from "node:assert/strict";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import { IndexedDbReplStateStore } from "./indexeddb-repl-state-store.js";

test("indexeddb repl state store fails clearly when IndexedDB is unavailable", async () => {
  const store = new IndexedDbReplStateStore({ dbName: "test-state-db" });

  await assert.rejects(
    () => store.loadState("session-1"),
    /IndexedDB is not available in this runtime/
  );
});

test("indexeddb repl state store can persist spilled runtime state", async () => {
  const originalIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = fakeIndexedDB;

  try {
    const dbName = `test-state-db-${Date.now()}`;
    const writer = new IndexedDbReplStateStore({
      dbName,
      inlineValueBytes: 32
    });

    await writer.saveState("session-1", {
      answer: "April 12",
      large: "x".repeat(5_000)
    });

    const reader = new IndexedDbReplStateStore({
      dbName,
      inlineValueBytes: 32
    });
    const loaded = await reader.loadState("session-1");

    assert.equal(loaded?.answer, "April 12");
    assert.equal(loaded?.large, "x".repeat(5_000));

    await reader.deleteState?.("session-1");
    assert.equal(await reader.loadState("session-1"), undefined);
  } finally {
    globalThis.indexedDB = originalIndexedDb;
  }
});

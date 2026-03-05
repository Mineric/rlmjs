import { test } from "node:test";
import assert from "node:assert/strict";

import { IndexedDbStorageAdapter } from "./indexeddb-storage.js";

test("indexeddb adapter fails clearly when IndexedDB is unavailable", async () => {
  const adapter = new IndexedDbStorageAdapter({ dbName: "test-db" });

  await assert.rejects(
    () => adapter.searchSlices({ query: "hello" }),
    /IndexedDB is not available in this runtime/
  );
});

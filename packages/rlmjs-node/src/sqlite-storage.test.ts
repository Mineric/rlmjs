import { test } from "node:test";
import assert from "node:assert/strict";

import { SqliteStorageAdapter } from "./sqlite-storage.js";

test("sqlite adapter stores and searches slices", async () => {
  const adapter = new SqliteStorageAdapter();
  try {
    adapter.putSlices([
      {
        sliceId: "s1",
        sequence: 1,
        text: "Alice discussed launch plan with Bob",
        metadata: { conversationId: "c1" }
      },
      {
        sliceId: "s2",
        sequence: 2,
        text: "Budget follow-up happened on Tuesday",
        metadata: { conversationId: "c1" }
      },
      {
        sliceId: "s3",
        sequence: 3,
        text: "Unrelated gardening notes",
        metadata: { conversationId: "c2" }
      }
    ]);

    const hits = await adapter.searchSlices({
      query: "launch bob",
      k: 2,
      filters: { conversationId: "c1" }
    });

    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.sliceId, "s1");

    const slice = await adapter.loadSlice({ sliceId: "s1", start: 0, end: 5 });
    assert.equal(slice.text, "Alice");
  } finally {
    adapter.close();
  }
});

test("sqlite adapter loads neighbors by sequence radius", async () => {
  const adapter = new SqliteStorageAdapter();
  try {
    adapter.putSlices([
      { sliceId: "n1", sequence: 10, text: "one" },
      { sliceId: "n2", sequence: 11, text: "two" },
      { sliceId: "n3", sequence: 12, text: "three" },
      { sliceId: "n4", sequence: 13, text: "four" }
    ]);

    const neighbors = await adapter.loadNeighbors({ sliceId: "n2", radius: 1 });
    assert.deepEqual(
      neighbors.map((n) => n.sliceId),
      ["n1", "n2", "n3"]
    );

    const summary = await adapter.getSliceSummary({ sliceId: "n4" });
    assert.equal(summary.sliceId, "n4");
    assert.ok(summary.summary.length > 0);
  } finally {
    adapter.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { createToolRegistry, errorToolResult, okToolResult } from "./registry.js";

test("registry returns unknown tool error", async () => {
  const runtime = createToolRegistry({});
  const out = await runtime.invoke(
    { name: "missing", args: {} },
    { depth: 0, iteration: 0, traceId: "t", loadedBytes: 0 }
  );

  assert.equal(out.ok, false);
  assert.match(String(out.error), /unknown tool/);
});

test("registry catches thrown handler errors", async () => {
  const runtime = createToolRegistry({
    fail: () => {
      throw new Error("boom");
    }
  });

  const out = await runtime.invoke(
    { name: "fail", args: {} },
    { depth: 0, iteration: 0, traceId: "t", loadedBytes: 0 }
  );

  assert.equal(out.ok, false);
  assert.equal(out.error, "boom");
});

test("okToolResult normalizes loadedBytes", () => {
  const out = okToolResult({ value: 1 }, 12.8);

  assert.equal(out.ok, true);
  assert.equal(out.loadedBytes, 12);
});

test("errorToolResult wraps error", () => {
  const out = errorToolResult("bad");

  assert.equal(out.ok, false);
  assert.equal(out.error, "bad");
});

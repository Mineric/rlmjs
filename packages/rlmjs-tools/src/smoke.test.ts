import { test } from "node:test";
import assert from "node:assert/strict";

import { createToolRegistry } from "./index.js";

test("tools exports registry", () => {
  assert.equal(typeof createToolRegistry, "function");
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { RlmEngine } from "./index.js";

test("core exports engine", () => {
  assert.equal(typeof RlmEngine, "function");
});

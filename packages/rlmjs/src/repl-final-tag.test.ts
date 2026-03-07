import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFinalTag, parseFinalTagLine } from "./repl-final-tag.js";

test("parseFinalTagLine parses FINAL string literals", () => {
  assert.deepEqual(parseFinalTagLine('FINAL("April 12")'), {
    kind: "final",
    answer: "April 12"
  });
  assert.deepEqual(parseFinalTagLine("FINAL('April 12')"), {
    kind: "final",
    answer: "April 12"
  });
});

test("parseFinalTagLine parses FINAL_VAR string literals", () => {
  assert.deepEqual(parseFinalTagLine('FINAL_VAR("answer")'), {
    kind: "final_var",
    name: "answer"
  });
});

test("parseFinalTag finds trailing final tags outside code blocks", () => {
  assert.deepEqual(
    parseFinalTag(['```js', 'state.answer = "April 12";', "```", 'FINAL_VAR("answer")'].join("\n")),
    {
      kind: "final_var",
      name: "answer"
    }
  );
  assert.deepEqual(parseFinalTag('Answer found.\nFINAL("April 12")'), {
    kind: "final",
    answer: "April 12"
  });
});

test("parseFinalTag ignores malformed tags", () => {
  assert.equal(parseFinalTag("FINAL(answer)"), undefined);
  assert.equal(parseFinalTag("No final tag here"), undefined);
});

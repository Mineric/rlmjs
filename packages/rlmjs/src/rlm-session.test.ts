import { test } from "node:test";
import assert from "node:assert/strict";

import { MemoryCorpusStore } from "./corpus.js";
import { createRlm } from "./rlm-session.js";

function createStore(): MemoryCorpusStore {
  const store = new MemoryCorpusStore();
  store.putChunks([
    {
      chunkId: "m1",
      sequence: 1,
      text: "The Atlas launch date is discussed in this thread."
    },
    {
      chunkId: "m2",
      sequence: 2,
      text: "Atlas launches on April 12."
    }
  ]);
  return store;
}

test("createRlm wraps the common runtime/controller/model-stack path", async () => {
  const session = createRlm({
    context: createStore(),
    model: {
      async complete({ messages }) {
        if (messages.some((message) => message.content.includes("child confirm"))) {
          return {
            content: [
              "```js",
              'state.answer = "child-final";',
              'FINAL_VAR("answer");',
              "```"
            ].join("\n")
          };
        }

        return {
          content: [
            "```js",
            'const focused = await context.subviewFromSearch("April 12", { k: 2 });',
            'const child = await callRlm("child confirm", { context: focused });',
            "state.answer = child.answer;",
            'FINAL_VAR("answer");',
            "```"
          ].join("\n")
        };
      }
    },
    maxDepth: 2
  });

  const out = await session.run("When does Atlas launch?");

  assert.equal(out.answer, "child-final");
  assert.equal(out.graph.query, "When does Atlas launch?");
  assert.equal(out.graph.children[0]?.query, "child confirm");
  assert.equal(out.history.children[0]?.answer, "child-final");
  assert.ok(session.getRecordedRuns().size >= 1);
});

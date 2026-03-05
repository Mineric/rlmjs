import { test } from "node:test";
import assert from "node:assert/strict";

import { LlamaCppProvider } from "./llama-cpp-provider.js";

const ORIGINAL_FETCH = globalThis.fetch;

test("llama adapter parses function tool call", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "loadSlice",
                    arguments: JSON.stringify({ sliceId: "abc" })
                  }
                }
              ]
            }
          }
        ]
      }),
      { status: 200 }
    )) as typeof fetch;

  const provider = new LlamaCppProvider({
    model: "local-model"
  });

  const out = await provider.complete({
    query: "q",
    depth: 0,
    iteration: 0,
    traceId: "t",
    messages: [{ role: "user", content: "q" }]
  });

  assert.equal(out.type, "tool_call");
  if (out.type === "tool_call") {
    assert.equal(out.call.name, "loadSlice");
  }

  globalThis.fetch = ORIGINAL_FETCH;
});

test("llama adapter falls back to final answer text", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "fallback answer"
            }
          }
        ]
      }),
      { status: 200 }
    )) as typeof fetch;

  const provider = new LlamaCppProvider({
    model: "local-model"
  });

  const out = await provider.complete({
    query: "q",
    depth: 0,
    iteration: 0,
    traceId: "t",
    messages: [{ role: "user", content: "q" }]
  });

  assert.equal(out.type, "final");
  if (out.type === "final") {
    assert.equal(out.answer, "fallback answer");
  }

  globalThis.fetch = ORIGINAL_FETCH;
});

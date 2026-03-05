import { test } from "node:test";
import assert from "node:assert/strict";

import { OpenAiCompatibleProvider } from "./openai-provider.js";

const ORIGINAL_FETCH = globalThis.fetch;

test("openai adapter parses tool_call JSON response", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "tool_call",
                call: {
                  name: "searchSlices",
                  args: { query: "abc" }
                }
              })
            }
          }
        ]
      }),
      { status: 200 }
    )) as typeof fetch;

  const provider = new OpenAiCompatibleProvider({
    baseUrl: "https://example.test/v1",
    model: "fake"
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
    assert.equal(out.call.name, "searchSlices");
  }

  globalThis.fetch = ORIGINAL_FETCH;
});

test("openai adapter falls back to final text when JSON is invalid", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "plain answer"
            }
          }
        ]
      }),
      { status: 200 }
    )) as typeof fetch;

  const provider = new OpenAiCompatibleProvider({
    baseUrl: "https://example.test/v1",
    model: "fake"
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
    assert.equal(out.answer, "plain answer");
  }

  globalThis.fetch = ORIGINAL_FETCH;
});

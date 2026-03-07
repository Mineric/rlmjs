import { test } from "node:test";
import assert from "node:assert/strict";

import { LlamaCppChatModel } from "./llama-cpp-chat-model.js";

test("llama.cpp chat model uses the default local base URL", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";

  globalThis.fetch = (async (input) => {
    seenUrl = String(input);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "ok"
            }
          }
        ]
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const model = new LlamaCppChatModel({
      model: "demo"
    });
    const out = await model.complete({
      messages: [{ role: "user", content: "hi" }]
    });

    assert.equal(out.content, "ok");
    assert.equal(seenUrl, "http://127.0.0.1:8080/v1/chat/completions");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

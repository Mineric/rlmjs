import { test } from "node:test";
import assert from "node:assert/strict";

import { OpenAiCompatibleChatModel } from "./openai-chat-model.js";

test("openai chat model returns plain assistant text", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "```js\nFINAL(\"done\")\n```"
            }
          }
        ]
      }),
      { status: 200 }
    )) as typeof fetch;

  try {
    const model = new OpenAiCompatibleChatModel({
      baseUrl: "https://api.example",
      model: "demo"
    });
    const out = await model.complete({
      messages: [{ role: "user", content: "hi" }]
    });

    assert.match(out.content, /FINAL/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai chat model flattens multipart text content", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [{ text: "```js" }, { text: 'FINAL("x")' }, { text: "```" }]
            }
          }
        ]
      }),
      { status: 200 }
    )) as typeof fetch;

  try {
    const model = new OpenAiCompatibleChatModel({
      baseUrl: "https://api.example",
      model: "demo"
    });
    const out = await model.complete({
      messages: [{ role: "user", content: "hi" }]
    });

    assert.match(out.content, /FINAL\("x"\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

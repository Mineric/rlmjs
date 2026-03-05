import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RlmEngine,
  createStorageToolRuntime,
  type RlmProvider,
  type RlmProviderAction,
  type RlmProviderInput
} from "../../rlmjs-core/dist/index.js";
import { SqliteStorageAdapter } from "./sqlite-storage.js";

function toolMessages(input: RlmProviderInput): Array<{ name?: string; content: string }> {
  return input.messages.filter((m) => m.role === "tool");
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

test("node sqlite adapter works end-to-end with core engine", async () => {
  const storage = new SqliteStorageAdapter();
  try {
    storage.putSlices([
      { sliceId: "a", sequence: 1, text: "The launch date is April 12." },
      { sliceId: "b", sequence: 2, text: "Ignore this unrelated note." }
    ]);

    const provider: RlmProvider = {
      async complete(input): Promise<RlmProviderAction> {
        const tools = toolMessages(input);
        if (tools.length === 0) {
          return {
            type: "tool_call",
            call: { name: "searchSlices", args: { query: input.query, k: 1 } }
          };
        }

        if (tools.length === 1 && tools[0]?.name === "searchSlices") {
          const hits = parseJson(tools[0].content) as { data?: Array<{ sliceId: string }> } | null;
          const first = hits?.data?.[0]?.sliceId;
          return {
            type: "tool_call",
            call: { name: "loadSlice", args: { sliceId: first ?? "" } }
          };
        }

        const last = tools[tools.length - 1];
        const payload = parseJson(last?.content ?? "") as { data?: { text?: string } } | null;
        const text = payload?.data?.text ?? "unknown";

        return {
          type: "final",
          answer: `Found: ${text}`
        };
      }
    };

    const engine = new RlmEngine({
      provider,
      tools: createStorageToolRuntime(storage)
    });

    const out = await engine.run({ query: "launch date" });
    assert.match(out.answer, /April 12/);
    assert.ok(out.stats.loadedBytes > 0);
  } finally {
    storage.close();
  }
});

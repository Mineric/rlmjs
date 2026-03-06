# rlmjs

Reusable JS/TS Recursive Language Model (RLM) runtime packages.

## Packages

- `@software-machines/rlmjs-core`
- `@software-machines/rlmjs-tools`
- `@software-machines/rlmjs-browser`
- `@software-machines/rlmjs-node`
- `@software-machines/rlmjs-adapter-openai`
- `@software-machines/rlmjs-adapter-llama-cpp`

## Local Dev (this repo)

```bash
cd packages
npm run validate
```

## Install (future, after publish)

```bash
npm install @software-machines/rlmjs-core @software-machines/rlmjs-tools
npm install @software-machines/rlmjs-browser @software-machines/rlmjs-adapter-openai
```

## Minimal Usage (core + tools)

```ts
import { RlmEngine } from "@software-machines/rlmjs-core";
import { createToolRegistry, okToolResult } from "@software-machines/rlmjs-tools";

const provider = {
  async complete(input) {
    const sawTool = input.messages.some((m) => m.role === "tool");
    if (!sawTool) {
      return {
        type: "tool_call",
        call: { name: "searchSlices", args: { query: input.query } }
      };
    }
    return { type: "final", answer: "Done." };
  }
};

const tools = createToolRegistry({
  async searchSlices(args) {
    return okToolResult([{ sliceId: "s1", score: 1, summary: `hit for ${String(args.query ?? "")}` }], 128);
  }
});

const engine = new RlmEngine({ provider, tools });
const out = await engine.run({ query: "Find launch date" });
console.log(out.answer, out.citations, out.stats);
```

## Recursive Subcontexts

`recursive_query` can carry a restricted child subcontext:

```ts
{
  type: "tool_call",
  call: {
    name: "recursive_query",
    args: {
      query: "Check only the shortlisted evidence",
      subcontext: {
        mode: "restricted",
        sliceIds: ["slice-12", "slice-19", "slice-44"]
      }
    }
  }
}
```

Use `composeSubcontext` when the model wants to narrow a child run to selected slice IDs before recursing.

## Reliability Options (minimal)

```ts
const engine = new RlmEngine({
  provider,
  tools,
  policy: {
    requireToolCallBeforeFinal: true,
    maxPrematureFinals: 2
  }
});
```

```ts
const llamaProvider = new LlamaCppProvider({
  baseUrl: "http://127.0.0.1:8080/v1",
  model: "your-model",
  maxRetries: 3,
  retryDelayMs: 250
});
```

## Browser Static Usage (IndexedDB + OpenAI-compatible provider)

```ts
import { RlmEngine, createStorageToolRuntime } from "@software-machines/rlmjs-core";
import { createIndexedDbStorageAdapter } from "@software-machines/rlmjs-browser";
import { OpenAiCompatibleProvider } from "@software-machines/rlmjs-adapter-openai";

const storage = createIndexedDbStorageAdapter({ dbName: "rlmjs-demo", storeName: "chat_slices" });
await storage.putSlices([
  { sliceId: "slice-1", sequence: 1, text: "Alice: Launch is April 12." }
]);

const provider = new OpenAiCompatibleProvider({
  baseUrl: "http://127.0.0.1:8080/v1",
  model: "your-model",
  temperature: 0
});

const engine = new RlmEngine({
  provider,
  tools: createStorageToolRuntime(storage)
});

const out = await engine.run({ query: "When is launch?" });
console.log(out);
```

## Example

- Browser static demo: `examples/browser-static-demo`

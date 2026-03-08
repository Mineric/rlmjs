# rlmjs

Reusable JS/TS RLM-inspired runtime toolkit.

## Packages

- `@software-machines/rlmjs`
- `@software-machines/rlmjs-chat-adapter`

## Local Dev (this repo)

```bash
cd packages
npm run validate
```

## Install (future, after publish)

```bash
npm install @software-machines/rlmjs @software-machines/rlmjs-chat-adapter
```

Default path: use `createRlm(...)` for the common setup. `ReplRuntime`, `ReplController`, and `createReplModelStack(...)` remain available for lower-level control.

## Browser REPL Usage (minimal)

```ts
import {
  createRlm,
  MemoryCorpusStore,
  createIndexedDbReplStateStore
} from "@software-machines/rlmjs";
import { OpenAiCompatibleChatModel } from "@software-machines/rlmjs-chat-adapter";

const store = new MemoryCorpusStore();
store.putChunks([
  { chunkId: "m1", sequence: 1, text: "Alice: Launch is April 12." }
]);

const chatModel = new OpenAiCompatibleChatModel({
  baseUrl: "http://127.0.0.1:8080/v1",
  model: "your-model",
  temperature: 0
});
const runtimeStateStore = createIndexedDbReplStateStore({
  dbName: "rlmjs-runtime-state"
});

const session = createRlm({
  context: store,
  model: chatModel,
  sessionId: "launch-session",
  stateStore: runtimeStateStore,
  maxDepth: 2
});

const out = await session.run("When is launch?");
console.log(out.answer, out.graph, out.history);
```

Note: `ReplRuntime` is an inline restricted JavaScript runtime for browser-side experimentation. It is not a hard isolation boundary, and its execution timeout is cooperative.

`ReplRuntime` defaults to `maxDepth: 1`, where `callRlm(...)` falls back to a plain leaf-model completion handler instead of another notebook child. The built-in leaf helper now materializes up to about 512 KB of child context by default; set `maxDepth: 2` or higher if you want nested REPL-driven child calls.

`ReplController` prefers in-code `FINAL(...)` / `FINAL_VAR(...)` calls, but also accepts plain assistant-side final tags for compatibility. `callRlm(...)` can recurse over narrowed context views or ephemeral derived text via `{ text: "..." }`. Consecutive identical code blocks now fail early instead of burning the full iteration budget.

The controller also surfaces current depth and context size to the model on each turn.

`createRlm(...)` is the simplest path for common usage. It wraps `ReplRuntime`, `ReplController`, and `createReplModelStack(...)` into one session object while preserving access to the lower-level pieces when needed.

`session.run(...)` returns both `graph` and `history`. `buildReplCallGraph(...)` and `buildReplRunHistory(...)` remain available when you need to reconstruct those views from lower-level controller results.

`ContextHandle` child views keep chunk selection isolated at the handle API level and `materialize(...)` can partially slice oversized chunks instead of returning empty output when the first chunk exceeds the byte budget.

The built-in `MemoryCorpusStore` and `IndexedDbCorpusStore` use simple lexical search as the baseline. `SemanticCorpusStore` is an embedding-backed wrapper over any `CorpusStore`, so you can add semantic retrieval without changing the runtime/controller APIs.

`IndexedDbReplStateStore` is available when you want notebook `state` to persist across reloads. Persisted runtime state must stay JSON-like; large strings are automatically spilled into a separate blob store.

## Browser Static Usage (IndexedDB + OpenAI-compatible chat model)

```ts
import {
  createRlm,
  createIndexedDbCorpusStore,
  createIndexedDbReplStateStore
} from "@software-machines/rlmjs";
import { OpenAiCompatibleChatModel } from "@software-machines/rlmjs-chat-adapter";

const storage = createIndexedDbCorpusStore({ dbName: "rlmjs-demo", storeName: "chat_chunks" });
const runtimeStateStore = createIndexedDbReplStateStore({ dbName: "rlmjs-demo-state" });
await storage.putChunks([
  { chunkId: "chunk-1", sequence: 1, role: "message", text: "Alice: Launch is April 12." }
]);

const chatModel = new OpenAiCompatibleChatModel({
  baseUrl: "http://127.0.0.1:8080/v1",
  model: "your-model",
  temperature: 0
});

const session = createRlm({
  context: storage,
  model: chatModel,
  sessionId: "launch-session",
  stateStore: runtimeStateStore,
  maxDepth: 2
});

const out = await session.run("When is launch?");
console.log(out.answer, out.graph, out.history);
```

## Example

- Browser static demo: `examples/browser-static-demo`
- Browser REPL design notes: `docs/browser-repl-runtime-plan.md`

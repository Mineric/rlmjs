# @mineric/rlmjs

Main browser-first runtime package for `rlmjs`.

This package is an RLM-inspired runtime toolkit, not a paper-faithful drop-in reimplementation of the full original RLM stack.

Default path: use `createRlm(...)`. Reach for `ReplRuntime`, `ReplController`, and `createReplModelStack(...)` only when you need lower-level control.

Provided:
- `ContextHandle` and `MemoryCorpusStore` for browser-first virtualized context access.
- `IndexedDbCorpusStore` for persisted long-context storage behind the same `CorpusStore` contract.
- `IndexedDbReplStateStore` for persisted notebook/runtime state behind a small `ReplStateStore` contract.
- `SemanticCorpusStore` as an embedding-backed wrapper for semantic retrieval over the same `CorpusStore` contract.
- `ReplController` for a minimal code-block-driven LM loop over the notebook runtime, with plain `FINAL(...)` / `FINAL_VAR(...)` tag support and truncated execution feedback.
- `ReplRuntime` for notebook-style JS execution with persistent state, `FINAL(...)`, `FINAL_VAR(...)`, and recursive child-call hooks over narrowed or ephemeral derived context.
- `createRlm(...)` / `RlmSession` for the common "give me a context and a chat model" path.
- `createReplModelStack(...)` for the common "root model + optional cheaper recursive model + default leaf handler" wiring pattern.
- `buildReplCallGraph(...)` and `buildReplRunHistory(...)` for reconstructing recursive call trees and prompt/observation history from controller results.
- `ReplRuntime` defaults to `maxDepth: 1`, where `callRlm(...)` falls back to a plain leaf-model completion with roughly 512 KB of child context by default; deeper recursion is supported as an explicit extension.
- `ContextHandle` child views keep selection isolated at the handle API level, and `materialize(...)` can partially slice oversized chunks under a byte budget.

The built-in in-memory and IndexedDB stores currently use lexical search as the default baseline. `SemanticCorpusStore` adds embedding-based semantic search on top of any base store via a pluggable `embedText(...)` function.

When you need notebook state to survive reloads, `IndexedDbReplStateStore` can checkpoint `state` by session ID. Persisted state must remain JSON-like; large strings are automatically spilled to a blob store.

The controller exposes current depth and context size to the model each turn and rejects identical consecutive code blocks early.

Usage example:
- `examples/browser-static-demo/README.md`

Minimal REPL-style example:

```ts
import {
  createRlm,
  MemoryCorpusStore,
  createIndexedDbReplStateStore
} from "@mineric/rlmjs";

const store = new MemoryCorpusStore();
store.putChunks([
  { chunkId: "m1", sequence: 1, text: "Atlas launches on April 12." },
  { chunkId: "m2", sequence: 2, text: "Billing issue was unrelated." }
]);

const runtimeStateStore = createIndexedDbReplStateStore({
  dbName: "rlmjs-runtime-state"
});

const session = createRlm({
  context: store,
  sessionId: "atlas-session",
  stateStore: runtimeStateStore,
  maxDepth: 2,
  model: {
    async complete() {
      return {
        content: [
          "```js",
          'const focused = await context.subviewFromSearch("launch");',
          'const child = await callRlm("confirm launch", { context: focused });',
          "state.answer = child.answer;",
          'FINAL_VAR("answer");',
          "```"
        ].join("\\n")
      };
    }
  },
  recursiveModel: {
    async complete() {
      return {
        content: [
          "```js",
          'state.answer = "Atlas launches on April 12.";',
          'FINAL_VAR("answer");',
          "```"
        ].join("\\n")
      };
    }
  }
});

const out = await session.run("When does Atlas launch?");
console.log(out.answer, out.graph, out.history);
```

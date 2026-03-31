# rlmjs packages

This directory contains the modular `rlmjs` implementation intended for future npm publishing.

The runtime is browser-first and RLM-inspired, but it is not a paper-faithful reproduction of the original research stack or benchmarks.

## Packages

- `@mineric/rlmjs`
  - Browser-first runtime: virtualized context, notebook controller/runtime, IndexedDB-backed corpus/state stores, a thin `createRlm(...)` facade, and helpers like `buildReplCallGraph(...)` / `buildReplRunHistory(...)`.
- `@mineric/rlmjs-chat-adapter`
  - OpenAI-compatible chat model adapter, with llama.cpp convenience wrappers.

## Validation

Run full package validation:

```bash
./packages/scripts/validate-all.sh
```

This script typechecks and tests each package in dependency order.

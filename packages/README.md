# rlmjs packages

This directory contains the modular `rlmjs` implementation intended for future npm publishing.

## Packages

- `@software-machines/rlmjs-core`
  - Recursive execution engine, limits, trace model, storage-tool runtime bridge.
- `@software-machines/rlmjs-tools`
  - Tool registry helpers.
- `@software-machines/rlmjs-browser`
  - Browser adapters: IndexedDB storage, worker runtime bridge, optional HTTP storage bridge.
- `@software-machines/rlmjs-node`
  - Node reference storage adapter over SQLite.
- `@software-machines/rlmjs-adapter-openai`
  - OpenAI-compatible provider adapter.
- `@software-machines/rlmjs-adapter-llama-cpp`
  - llama.cpp OpenAI-format provider adapter.

## Validation

Run full package validation:

```bash
./packages/scripts/validate-all.sh
```

This script typechecks and tests each package in dependency order.

# rlmjs Browser Static Demo

Static demo that uses:
- `@software-machines/rlmjs`
- `@software-machines/rlmjs-chat-adapter`

It stores context in IndexedDB and boots a dedicated runtime Worker on page load.

## 1. Build package artifacts

From repo root:

```bash
./packages/scripts/validate-all.sh
```

## 2. Serve static files

From repo root:

```bash
python3 -m http.server 5173 -d examples/browser-static-demo
```

Open:
- http://127.0.0.1:5173

## 3. Run

1. Set provider base URL/model.
2. Click "Load Context Into IndexedDB".
3. Click "Run RLM".

Notes:
- For local llama.cpp, base URL should be your OpenAI-format endpoint (for example `http://127.0.0.1:8080/v1`).
- API key is optional for local endpoints.
- This is a dev demo; keys entered in browser are user-visible by design.
- The demo uses the same `createRlm(...)` path documented in the main package, backed by IndexedDB corpus/state stores.
- The model must be willing to emit JavaScript code blocks that use the notebook runtime APIs (`context`, `state`, `callRlm`, `FINAL`, `FINAL_VAR`).
- The Worker boots eagerly when the page opens, but IndexedDB context access stays lazy until you load context or run a query.

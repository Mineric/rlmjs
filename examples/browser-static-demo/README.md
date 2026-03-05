# rlmjs Browser Static Demo

Static demo that uses:
- `@software-machines/rlmjs-core`
- `@software-machines/rlmjs-browser`
- `@software-machines/rlmjs-adapter-openai`

It stores context in IndexedDB and runs tool calls through a Web Worker.

## 1. Build package artifacts

From repo root:

```bash
./packages/scripts/validate-all.sh
```

## 2. Serve static files

From repo root:

```bash
python3 -m http.server 5173 -d experiments/rlmjs-browser-static-demo
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

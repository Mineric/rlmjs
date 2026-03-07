# @software-machines/rlmjs-chat-adapter

OpenAI-compatible chat model adapter for `rlmjs`.

Behavior:
- Calls `/chat/completions` against an OpenAI-compatible endpoint.
- Returns plain assistant-text completions.
- Suitable for `createRlm(...)` and the lower-level browser REPL controller/model-stack APIs.
- Also exports `LlamaCppChatModel` as a small convenience wrapper with the default local llama.cpp base URL.

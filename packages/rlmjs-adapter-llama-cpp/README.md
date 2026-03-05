# @software-machines/rlmjs-adapter-llama-cpp

llama.cpp provider adapter for `rlmjs` using OpenAI-format HTTP endpoints.

Behavior:
- Targets local llama.cpp server (`/v1/chat/completions`).
- Uses the same JSON action protocol as other adapters.
- Supports tool-call and final-answer parsing.

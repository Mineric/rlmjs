# @software-machines/rlmjs-adapter-openai

OpenAI-compatible provider adapter for `rlmjs`.

Behavior:
- Calls `/chat/completions` against an OpenAI-compatible endpoint.
- Expects JSON action protocol (`tool_call` or `final`).
- Supports fallback to plain-text final answer.

# @software-machines/rlmjs-core

Core contracts and recursive execution loop for `rlmjs`.

Status:
- Early scaffold for architecture implementation.
- API is intentionally small and expected to evolve.

Provided:
- RLM contracts (`RlmProvider`, `RlmToolRuntime`, `RlmRunLimits`).
- `RlmEngine` with:
  - iterative loop,
  - recursive sub-query support via `recursive_query` tool call,
  - hard budget checks (`maxDepth`, `maxIterations`, `maxTimeMs`, `maxLoadedBytes`),
  - trace capture.

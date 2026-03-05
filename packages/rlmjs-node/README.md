# @software-machines/rlmjs-node

Node runtime package for `rlmjs`.

Provided:
- `SqliteStorageAdapter` (reference persistent storage adapter).
- `createSqliteStorageAdapter()` factory.

Notes:
- SQLite is reference and optional; storage remains pluggable via `RlmStorageAdapter`.

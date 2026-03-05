#!/usr/bin/env bash
set -euo pipefail

pkgs=(
  "rlmjs-core"
  "rlmjs-tools"
  "rlmjs-node"
  "rlmjs-browser"
  "rlmjs-adapter-openai"
  "rlmjs-adapter-llama-cpp"
)

echo "==> prebuild: rlmjs-core"
npm --prefix "packages/rlmjs-core" run build
echo

for pkg in "${pkgs[@]}"; do
  echo "==> ${pkg}: typecheck"
  npm --prefix "packages/${pkg}" run typecheck
  echo "==> ${pkg}: test"
  npm --prefix "packages/${pkg}" run test
  echo
 done

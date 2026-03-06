#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "${script_dir}/.." && pwd)"

pkgs=(
  "rlmjs-core"
  "rlmjs-tools"
  "rlmjs-node"
  "rlmjs-browser"
  "rlmjs-adapter-openai"
  "rlmjs-adapter-llama-cpp"
)

echo "==> prebuild: rlmjs-core"
npm --prefix "${root_dir}/rlmjs-core" run build
echo

for pkg in "${pkgs[@]}"; do
  echo "==> ${pkg}: typecheck"
  npm --prefix "${root_dir}/${pkg}" run typecheck
  echo "==> ${pkg}: test"
  npm --prefix "${root_dir}/${pkg}" run test
  echo
 done

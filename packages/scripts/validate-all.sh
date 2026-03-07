#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "${script_dir}/.." && pwd)"

pkgs=(
  "rlmjs"
  "rlmjs-chat-adapter"
)

for pkg in "${pkgs[@]}"; do
  echo "==> ${pkg}: typecheck"
  npm --prefix "${root_dir}/${pkg}" run typecheck
  echo "==> ${pkg}: test"
  npm --prefix "${root_dir}/${pkg}" run test
  echo
 done

#!/usr/bin/env bash
# Compiler wrapper for Lean's stage1 library build (LEAN_CC). A few generated
# C files (e.g. Lean/Server/Test/Runner.c) make clang's wasm backend use more
# than 13 GB at -O3 and -O1. Each compile gets a memory cap; one that fails
# under it is retried at -O1 and then -O0, which needs little memory.
cap_kb="${LEANDOKU_CC_MEM_KB:-5000000}"
with_opt() {
  local level="$1"; shift
  for a in "$@"; do
    case "$a" in -O1|-O2|-O3) printf '%s\0' "$level" ;; *) printf '%s\0' "$a" ;; esac
  done
}
if (ulimit -v "$cap_kb"; exec emcc "$@") 2>/dev/null; then exit 0; fi
mapfile -d '' o1 < <(with_opt -O1 "$@")
echo "emcc-capped: retrying at -O1: ${*: -1}" >&2
if (ulimit -v "$cap_kb"; exec emcc "${o1[@]}") 2>/dev/null; then exit 0; fi
mapfile -d '' o0 < <(with_opt -O0 "$@")
echo "emcc-capped: retrying at -O0: ${*: -1}" >&2
exec emcc "${o0[@]}"

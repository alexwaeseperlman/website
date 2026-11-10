#!/bin/sh
# Builds turns.cpp as WebAssembly (WASI) for the level builder's "Run solver" button.
# Needs zig for its bundled wasm C++ toolchain:  pip install ziglang
set -e
cd "$(dirname "$0")"
python3 -m ziglang c++ -target wasm32-wasi -O2 -fno-exceptions -s \
  -Wl,--max-memory=1073741824 -o ../../public/turns/solver.wasm turns.cpp
ls -l ../../public/turns/solver.wasm

#!/usr/bin/env bash
# Print the version of the in-browser runtime: a hash of everything that goes
# into it. The deploy pins the page to this version, and CI publishes the
# runtime as the GitHub release `leandoku-runtime-<version>`.
set -euo pipefail
cd "$(dirname "$0")/.."
git ls-files -- lean/lean-toolchain lean/lakefile.toml lean/lake-manifest.json 'lean/*.lean' 'lean/**/*.lean' \
  wasm/lean-emscripten.patch wasm/build-runtime.sh wasm/glue.c wasm/pack-library.ts src/engine/library-pack.ts \
  | sort -u | xargs sha256sum | sha256sum | cut -c1-12

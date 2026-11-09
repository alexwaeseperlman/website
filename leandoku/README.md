# Leandoku

A mobile proof game built on real Lean. The player taps tactics and
arguments; Lean checks every step and reports the proof state.

This is a rebuild of Proof Paths. The architecture plan, and the reasons
behind it, are in the [design doc](https://claude.ai/artifact/K3GPQ4TBKLyc4hFq8o1Xx8).

## Layout

| Path | What it owns |
| --- | --- |
| `lean/` | The Lean bridge: elaborates a proof and returns goals per tactic as JSON, read from Lean's info trees (no `trace_state` parsing). |
| `src/core/catalog/` | Tactics as data: slots, templates, help. Adding a tactic is one entry. |
| `src/core/document/` | The proof as structure: steps with stable ids, branches, undo. |
| `src/core/serializer/` | Document → ordinary Lean + a source map. Every generated line is visible to the player. |
| `src/core/evaluate/` | Matches Lean's results to visible steps and decides complete / incomplete / rejected. |
| `src/core/play/` | What the player sees at a point in the proof, and previews: candidate steps are written out as `example`s, checked by Lean, and shown with the goals Lean reports for them. |
| `src/core/policy/` | Per-level limits applied on top of the catalog, and checked again at completion. |
| `src/core/course/` | Levels, prerequisite graph, and each level's Lean environment. |
| `src/engine/` | The `Engine` interface and the versioned, validated wire protocol. |
| `src/session/` | Engine lifetime, stale-result guards, bounded cache, retry. |
| `server/` | Native engine for development and tests. |
| `content/` | Course content. Every level has a reference solution written as builder actions. |

`src/core` has no DOM, worker, or network imports.

## Working on it

Needs [elan](https://github.com/leanprover/elan) and Node 22.

```sh
npm install
npm run bridge:build   # builds lean/.lake/build/bin/leandoku-bridge
npm test               # unit tests, plus Lean tests if the bridge is built
npm run test:lean      # Lean tests only; fails if the bridge is missing
npm run typecheck
```

The Lean tests replay every level's reference solution the way a player
would: commit one action, ask Lean, open branches only from the goals Lean
reports, and require the result to be complete under the level's policy.

To play with real checking, run the engine and the dev server together:

```sh
npm run engine:serve &   # Lean on 127.0.0.1:8787 (local pages only)
npm run dev              # http://localhost:5173, proxies /engine to it
```

The engine elaborates arbitrary Lean, which can run code, so it listens on
loopback only and refuses requests from any non-local origin.

## Deployment

The site's deploy workflow runs `npm run build` with
`LEANDOKU_OUT_DIR=../public/leandoku`, so the game is served at
`/leandoku/`.

## Lean in the browser

The published page runs the bridge as WebAssembly in a Web Worker
(`src/engine/wasm-client.ts`, `src/engine/wasm-worker.ts`). It is
single-threaded, so the page needs no cross-origin isolation.

- `wasm/build-runtime.sh <work> <out>` builds it: Lean v4.24.0 from source
  with `wasm/lean-emscripten.patch` (a native 32-bit stage0, then Lean's
  libraries through emscripten), the bridge's C, and a symbol table that
  replaces `dlsym` (`wasm/gen-symbols.py`). Output: `leandoku-bridge.js`,
  `leandoku-bridge.wasm.gz` (21 MB) and `library.ldpk` (Init's `.olean` and
  `.ir` files, 25 MB). It takes one to two hours from scratch.
- `wasm/runtime-key.sh` hashes every input. The *Leandoku runtime* workflow
  publishes each version once as the release `leandoku-runtime-<key>`;
  deploy downloads it into `public/runtime/<key>/` and pins the page to it
  with `VITE_LEANDOKU_RUNTIME`.
- `LEANDOKU_WASM_RUNTIME=<out> npm run test:lean` runs the Lean tests against
  the browser runtime, and `wasm/smoke-test.ts <out>` is a quick check.
- Locally: copy a runtime into `public/runtime/local/` and run
  `VITE_LEANDOKU_RUNTIME=local npm run dev`, then open `/?engine=wasm`.

## Status

Done: core, native bridge, mobile UI, and Lean in the browser. Next:
parameter probes for `apply`/`exact`.

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
`/leandoku/`. Until Lean runs in the browser, the published page lets you
build proofs and says plainly that they are not checked.

## Status

Done: core, native bridge, and the mobile UI (map, code pane, proof state,
tactic composer). Next: Lean compiled to WebAssembly so the published page
checks proofs, then parameter probes for `apply`/`exact`.

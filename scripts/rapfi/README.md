# Rapfi browser engine

The AI match uses upstream Rapfi Alpha-Beta search and the trained Mix9SVQ
freestyle NNUE network. The 15×15 freestyle referee and existing saved match
format are unchanged. Puzzle responses retain the separate exact VCT solver.
The old handwritten match AI is removed; errors pause play and allow retry.

## Pinned sources

- Engine: https://github.com/dotb1ue/rapfi/tree/1387d11312190ec66665d361ff07a7c70221b78a
  (GPL-3.0-or-later; no C++ source changes).
- Networks: https://github.com/dotb1ue/rapfi-networks/tree/7eeb19b55219a48138756293f92211a1539bab4d
  (CC0). Only `mix9svq/mix9svqfreestyle_bsmix.bin.lz4` and
  `classical/model210901.bin` are shipped. The classical tables are an upstream
  search dependency, not a fallback to the removed application AI.
- Emscripten 3.1.74, reused from `.cache/pikafish-port/emsdk-main`.
- Exact binary sizes and SHA-256 values: `manifest.json`.

## Reproduce

Clone the pinned engine into `.cache/rapfi` and the pinned network repository
into `.cache/rapfi-networks` (check out the exact commits above). Activate the
Emscripten SDK, then run:

```
node scripts/rapfi/build.cjs
node scripts/rapfi/package.cjs
npm run prepare:assets
npm run prepare:assets
```

The existing asset generator builds runtimes before the game catalog; a second
pass incorporates a changed catalog into the generated runtime.
The single-threaded SIMD build runs in a Blob Worker without SharedArrayBuffer,
cross-origin isolation, native installation, or a remote inference service.
`config.toml` preserves the upstream search configuration with one freestyle
network, direct coordinates, and a 16 MB transposition table.

HTTP loads separate WASM/model binaries (about 11.3 MB combined), verifies
SHA-256, shares downloads, and caches them in `dependencies/rapfi/` when a runtime
folder is available, otherwise Cache Storage. Folder persistence removes the
duplicate browser copy. Downloads happen when AI is first used.
`file://` instead loads the bundled `offline.js` compatibility script. These
resources are omitted from data backups. Cancel, undo, restart, backgrounding
and leaving the game terminate the Worker and discard stale responses.

All levels use the same trained network:

| Level | Time budget per move | Maximum search depth |
| --- | ---: | ---: |
| Normal | 200 ms | 4 |
| Hard | 1000 ms | 12 |
| Master | 3000 ms | 99 |

Budgets exclude initialization. Forced moves may finish early. Depths are caps,
not guaranteed completed depths or ratings.

## Verify

```
node scripts/rapfi/verify.cjs
node scripts/verify-gomoku.cjs
node scripts/verify-ai-thinking.cjs
npm run prepare:site
node scripts/rapfi/verify.cjs _site
node scripts/verify-gomoku.cjs _site
```

The engine tests use real WASM and trained weights, covering both colors, all
levels, nontrivial searches, wins/blocks, cancellation, reload after cancel,
cache reuse and corruption repair in HTTP and file entry points. These checks
do not establish an Elo or human rank.

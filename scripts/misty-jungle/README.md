# Offline MistyJungle

Upstream: https://github.com/brianhliou/misty-jungle

Pinned commit: `5717f7f8db386a0ec38ec73c1df58920beb32591` (MIT).
`upstream/engine.rs` is the unmodified upstream source at that commit.
The corresponding license is `licenses/misty-jungle.txt`.

## Build

Install Rust 1.94.0 and its `wasm32-unknown-unknown` target, then run
`node scripts/misty-jungle/build.cjs` from the repository root. The bridge has
no external Cargo dependencies. Cargo.lock and rust-toolchain.toml pin the build.
The build script applies asserted source transformations to the pinned original,
then compiles the WASM and packages it with the worker into a classic script.
The manifest records both source and WASM SHA-256 hashes. HTTP loads the separate
103 KB WASM binary, verifies its SHA-256, and caches it in
`dependencies/misty-jungle/misty-jungle.wasm` when the runtime folder is authorized,
otherwise in browser Cache Storage. Idle prefetch prepares the binary without
starting a Worker. Folder reads are verified; missing or corrupt files are
downloaded again. Folder persistence removes the browser binary copy. Cache
failures do not prevent play. `file://` retains the self-contained `engine.js`
compatibility script. The same WASM and search budgets apply to both paths;
storage location does not affect playing strength. Rust is required only for rebuilding.

## Local adaptations

- Import the worker's monotonic clock instead of the upstream WASM no-op clock.
- Match the referee's 100-ply no-capture limit (upstream uses 200).
- Forbid captures by an animal weakened in an enemy trap, except the existing
  target-in-friendly-trap rule takes precedence, matching jungle-rules.js.
- Count three occurrences, including the actual game history and search path,
  instead of treating the first return to a position as a draw.
- Include history counts and the no-capture clock in transposition-table values.
- Check terminal states and immediate den threats during tactical search.
- Add a small raw WASM ABI and incremental single-best-move session in bridge.rs.
  The upstream negamax, quiescence, evaluation and move ordering remain the core.
  Root progress survives slices; incomplete root searches can restart with their
  populated table. Only fully completed depths supply moves. Each slice checks
  its 18 ms limit every 1024 nodes; the main thread can terminate the worker.

The application sends the actual board and repetition frames, not the upstream
starting position. Squares are reflected vertically, and positive/red animals
map to upstream red. FEN letters are R/C/D/W/P/T/L/E. Saving remains version 1.

## Verification

`node scripts/misty-jungle/verify.cjs` checks compiled rules, terminal states,
tactics, timing and allocation reuse. `node scripts/verify-jungle.cjs` tests
file:// play with blocked HTTP(S), real WASM responses, cancellation, reload,
failure/retry, local play, locales, animation and board rotation.

`node scripts/misty-jungle/bakeoff.cjs` plays 20 seeded asymmetric openings in
both colors (40 complete games), refereed by the application. New AI uses the
production 3-second budget; the preserved legacy source uses its original hard
settings. It writes full paths and results to test-results/misty-jungle-bakeoff.json
and requires at least a 65% score. The legacy snapshot is test-only.

Recorded run on 2026-11-11: **38 wins, 2 draws, 0 losses; score 97.5%**.
All 40 complete games are preserved in `tests/bakeoff-results.json`, including
the opening, colors, full move paths, search budgets and binary hash. The
verification script replays these paths through the current referee. This is
a comparison against the former AI under the stated budgets, not an Elo rating.

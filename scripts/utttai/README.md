# Ultimate Tic-Tac-Toe AI

Upstream: https://github.com/arnowaczynski/utttai

Pinned reference commit: `622dae66b18198f6f12aef0a0bccd5bd40de2d8e` (Apache-2.0).
The input encoding and NMCTS2/PUCT design follow the upstream
`website/src/game/helpers.js` and `website/src/selfplay/NeuralMonteCarloTreeSearch.js`.
The application referee, search adapter and UI are maintained locally.

## Assets and reproducibility

- Trained NMCTS2 stage2-100000 ONNX: https://www.uttt.ai/policy_value_net_stage2.onnx
  (the upstream build copies `training/stage2/policy_value_net_100000.onnx`).
  Size: 19,983,650 bytes; SHA-256:
  `81161d2e262c9904dbb9a14961a2fcd043009fab4fd4f76b41451587f89c60d2`.
- ONNX Runtime Web 1.10.0: https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.10.0.tgz
  Use `dist/ort.wasm.min.js` and `dist/ort-wasm-simd.wasm`, with one thread.
  WASM SHA-256: `1e9d1928b147829dc6bd6542b5f9cb5eabf85008fd4b97235f74b38cab8eeb57`.
- Licenses: `licenses/utttai.txt`, `licenses/onnxruntime.txt`, and
  `licenses/onnxruntime-third-party.txt`.

Place those three upstream files under `assets/vendor/utttai/`, then run
`node scripts/utttai/package.cjs`. It emits the manifest, Blob Worker source
and `file://` compatibility script. The Worker embeds the exact application
referee, ensuring clearing, terminal rewards and legality match the UI.
Re-run packaging after editing the referee or worker.

HTTP uses separately downloaded model/WASM binaries with SHA-256 validation.
Startup prefetch waits for asset-network idle and does not instantiate ORT.
Shared requests save to `dependencies/utttai/` where available, otherwise Cache
Storage; a successful folder save removes the duplicate browser resource.
The offline compatibility script is only requested by `file://` AI play.
All inference is local. No random-initialized `init.onnx` model is used.

The trained model supplies priors and leaf values; the application referee
supplies exact terminal values for both rules. The model was trained on the
upstream standard rules, so these results are specific to this adaptation.

## Verification

- `node scripts/verify-ultimate-ttt.cjs` — rules, six locales, responsive UI,
  persistence, real offline NMCTS2 at all levels, tactics, cancellation,
  failure/retry and human-vs-AI undo. Add `--unit` for referee-only tests;
  pass `_site` to validate the published artifact.
- `node scripts/utttai/verify-resources.cjs` — HTTP inference, startup prefetch,
  shared downloads, corruption repair, folder/cache deduplication and retry.
- `node scripts/utttai/bakeoff.cjs` — resumable full-budget difficulty matches.
  Results are saved in `bakeoff-results.json`; delete that result explicitly
  before intentionally starting a new evaluation.

Recorded 160-game run: each rule uses 20 seeded distinct late-midgame openings,
with colors swapped, for each adjacent difficulty pairing. Search budgets are
200/1000/3000 ms, excluding initialization. Eight independent workers run games
concurrently. Easy chooses among the top five candidates; stronger levels use
visit count. Tactical wins and one-ply loss prevention apply to all levels.

| Rules | Pairing | Wins | Draws | Losses | Score |
| --- | --- | ---: | ---: | ---: | ---: |
| Regular | Normal vs Easy | 36 | 3 | 1 | 93.75% |
| Regular | Hard vs Normal | 20 | 9 | 11 | 61.25% |
| Chain Reset | Normal vs Easy | 26 | 9 | 5 | 76.25% |
| Chain Reset | Hard vs Normal | 20 | 10 | 10 | 62.5% |

Score awards half a point for draws. These are regression comparisons, not Elo
ratings or guarantees against human players. Full openings, paths, engine
statistics, budgets and model hash are preserved in the result JSON.

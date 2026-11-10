# Exact minimum-move solver

Requires the .NET 10 SDK for offline calculation only. The website has no .NET dependency.

Run from the repository root in PowerShell:

```powershell
dotnet build tools/sokoban-solver/Solver.csproj -c Release -o test-results/sokoban-native
$env:SOKOBAN_SEARCH_MS = "180000"
node scripts/generate-sokoban-optima.cjs --large-patterns --export-native test-results/sokoban-native/input.json
dotnet test-results/sokoban-native/Solver.dll test-results/sokoban-native/input.json test-results/sokoban-native/results.jsonl
node scripts/generate-sokoban-optima.cjs --import-native test-results/sokoban-native/results.jsonl test-results/sokoban-native/input.json
node scripts/import-sokoban.cjs
npm run prepare:assets
node scripts/generate-sokoban-optima.cjs --check --require-complete
node scripts/verify-sokoban-optimal.cjs
```

Use a fresh results filename for each batch. Results are appended after each level. A null result means the search did not prove an optimum. Increase the budget and export again to retry only unfinished levels. Keep each input file with its results: import checks geometry and replays every route before accepting it. `--require-complete` fails if any of the 140 levels remains unproven.

Without `--large-patterns`, database construction has a 120-second / 3 GiB managed-memory budget and A* has a 4 GiB memory budget. With the option, the budgets are 300 seconds / 12 GiB for construction and 14 GiB for A*. The per-level A* time budget is set separately by `SOKOBAN_SEARCH_MS`. An unfinished database is discarded completely, so its missing states never cause false deadlock pruning.

A* keeps exact player position and sorted box positions. Each edge consists of a shortest walk followed by one push, weighted by its complete movement count. Reverse-push distances and minimum-cost one-to-one box/goal matching give an admissible push-count bound. Static dead squares, impossible matchings and blocked 2x2 squares are pruned. Reopening lower-cost states supports inconsistent admissible bounds. The first goal removed from the queue proves the global minimum movement count. The stored push count is measured on that route; equal-length optimal routes may have different push counts.

The solver also builds exact reverse-search databases on projected two-, three- and four/five/six-box boards with other boxes removed. Impossible projections prove deadlocks. Push counts for disjoint pairs may be summed; movement distances are combined only by their maximum. A next-push approach bound is added only to push-count bounds to avoid counting walking twice. Up to 128 representative large subsets are evaluated at each state.

The larger database allocates only reachable box layouts, using a layout ID plus a player-cell offset into segmented 16-bit storage. Values beyond 65534 are conservatively saturated; that only weakens the lower bound and never caps the answer or changes optimality. Board floor count is limited to 512 to keep packed state keys lossless.

Independent regression checks (use a fresh results file):

```powershell
node scripts/verify-sokoban-optimal.cjs --export-native-fixtures test-results/sokoban-native/fixtures.json
dotnet test-results/sokoban-native/Solver.dll test-results/sokoban-native/fixtures.json test-results/sokoban-native/fixture-results.jsonl
node scripts/verify-sokoban-optimal.cjs --check-native-fixtures test-results/sokoban-native/fixture-results.jsonl
node scripts/verify-sokoban.cjs --theory-only
```

The fixture oracle searches elementary moves without shared push macros, heuristic matching, pattern databases or deadlock pruning. It covers solvable two-, three-, five- and six-box positions and a blocked four-box position.


For difficult levels, `--near-full-projections` replaces `--large-patterns` and keeps all but two boxes in each projected board. Set `SOKOBAN_NATIVE_MEMORY_GIB` (2 through 14) to override the managed-memory cap. The cap is checked periodically and is not a bound on total process memory. An unfinished projection remains unusable.

Native input additionally supports `reverse: true`, enabling exact elementary-move bidirectional BFS from the initial state and all solved player positions. It expands a complete layer of the smaller frontier, checks intersections and reconstructs both halves using stored distances. Safe static dead-square and blocked-2x2 pruning applies to forward pushes. It uses the same time/memory budget, returns null on exhaustion and replays through the regular importer before acceptance. This is an independent search route for levels where A* bounds are too weak.

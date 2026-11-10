"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");
const assert = require("node:assert/strict");
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("node:worker_threads");
const { harness } = require("./verify.cjs");
const root = path.resolve(__dirname, "../..");
if (isMainThread) {
  const concurrency = Math.min(12, Math.max(1, os.availableParallelism() - 2));
  const results = [],
    output = path.join(root, "test-results/misty-jungle-bakeoff.json");
  let next = 0;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  function start() {
    if (next >= 40) return;
    const id = next++;
    const worker = new Worker(__filename, { workerData: { id } });
    worker.on("message", (result) => {
      results.push(result);
      results.sort((a, b) => a.id - b.id);
      const wins = results.filter((r) => r.result === 1).length,
        draws = results.filter((r) => r.result === 0).length;
      fs.writeFileSync(
        output,
        JSON.stringify(
          {
            games: results.length,
            wins,
            draws,
            losses: results.length - wins - draws,
            score: (wins + draws / 2) / results.length,
            concurrency,
            settings: {
              newMs: 3000,
              legacyMs: 1000,
              openings: 20,
              seed: "0x4d495354 + opening",
            },
            results,
          },
          null,
          2,
        ) + "\n",
      );
      console.log(
        `${results.length}/40: game ${id} ${result.result > 0 ? "win" : result.result < 0 ? "loss" : "draw"}, ${result.plies} plies; score ${wins + draws / 2}/${results.length}`,
      );
      if (results.length === 40)
        assert(
          (wins + draws / 2) / 40 >= 0.65,
          "new engine must score at least 65%",
        );
      else start();
    });
    worker.on("error", (e) => {
      console.error(e);
      process.exitCode = 1;
    });
    worker.on("exit", (code) => {
      if (code) process.exitCode = code;
    });
  }
  for (let i = 0; i < concurrency; i++) start();
} else {
  (async () => {
    const { R, search } = await harness();
    const old = vm.createContext({ WorkTimeApp: { games: {} } });
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "tests/legacy-rules.txt"), "utf8"),
      old,
    );
    const legacy = old.WorkTimeApp.games.jungleRules;
    const opening = Math.floor(workerData.id / 2),
      newSide = workerData.id % 2 ? -1 : 1;
    let seed = (0x4d495354 + opening) >>> 0,
      state = R.create();
    // Same deterministic asymmetric opening for both colors. All play adjudicated by UI rules.
    for (let i = 0; i < 8 + (opening % 5) * 2; i++) {
      const moves = R.legal(state.board, state.turn);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      state = R.move(state, ...moves[seed % moves.length]);
    }
    const openingPath = JSON.parse(JSON.stringify(state.path));
    let nodes = 0,
      depth = 0;
    while (state.status === "playing") {
      let move;
      if (state.turn === newSide) {
        const r = search(state, 3000);
        move = r.move;
        nodes += r.nodes;
        depth = Math.max(depth, r.depth);
      } else {
        const iterator = legacy.search(state, "hard");
        let r;
        do {
          r = iterator.next();
        } while (!r.done);
        move = r.value;
      }
      const next = R.move(state, ...move);
      assert(next, "engine proposed illegal move");
      state = next;
      // This is a diagnostic failure, never an artificial draw adjudication.
      assert(state.path.length < 1500, "excessively long game");
    }
    parentPort.postMessage({
      id: workerData.id,
      opening,
      newSide,
      openingPath,
      result: state.winner === 0 ? 0 : state.winner === newSide ? 1 : -1,
      plies: state.path.length,
      nodes,
      maxDepth: depth,
      path: state.path,
    });
  })().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

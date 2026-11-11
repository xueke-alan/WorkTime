"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
async function harness(site = root) {
  const sandbox = vm.createContext({ WorkTimeApp: { games: {} } });
  for (const file of [
    "assets/js/games/jungle-rules.js",
    "assets/js/games/jungle-engine.js",
    "assets/vendor/misty-jungle/engine.js",
  ])
    vm.runInContext(fs.readFileSync(path.join(site, file), "utf8"), sandbox);
  const G = sandbox.WorkTimeApp.games;
  const bytes = Buffer.from(G.mistyJungleAssets.wasm, "base64");
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(site, "assets/vendor/misty-jungle/manifest.json"),
      "utf8",
    ),
  );
  assert.equal(
    crypto.createHash("sha256").update(bytes).digest("hex"),
    manifest.wasmSha256,
  );
  assert.equal(manifest.commit, "5717f7f8db386a0ec38ec73c1df58920beb32591");
  for (const file of ["manifest.js", "worker-source.js"])
    vm.runInContext(
      fs.readFileSync(
        path.join(site, "assets/vendor/misty-jungle", file),
        "utf8",
      ),
      sandbox,
    );
  assert.deepEqual(
    fs.readFileSync(
      path.join(site, "assets/vendor/misty-jungle/misty-jungle.wasm"),
    ),
    bytes,
    "HTTP and file entry points use identical WASM",
  );
  assert.equal(G.mistyJungleResources.hash, manifest.wasmSha256);
  assert.equal(G.mistyJungleResources.size, bytes.length);
  assert.equal(G.mistyJungleWorker, G.mistyJungleAssets.worker);
  const E = (
    await WebAssembly.instantiate(bytes, {
      host: { now: () => performance.now() },
    })
  ).instance.exports;
  const R = G.jungleRules,
    A = G.jungleEngine;
  const session = (state) => {
    const bytes = Buffer.from(A.positions(state));
    const ptr = E.allocate(bytes.length);
    new Uint8Array(E.memory.buffer, ptr, bytes.length).set(bytes);
    const s = E.session_new(ptr, bytes.length);
    E.release(ptr, bytes.length);
    assert(s);
    return s;
  };
  function search(state, ms = 3000, nodeLimit = Infinity) {
    const s = session(state),
      start = performance.now();
    try {
      do {
        E.session_step(s, Math.min(100000, nodeLimit - E.session_nodes(s)));
      } while (
        performance.now() - start < ms &&
        !E.session_finished(s) &&
        E.session_nodes(s) < nodeLimit
      );
      return {
        move: [A.flip(E.session_from(s)), A.flip(E.session_to(s))],
        depth: E.session_depth(s),
        nodes: E.session_nodes(s),
        score: E.session_score(s),
        elapsed: performance.now() - start,
      };
    } finally {
      E.session_free(s);
    }
  }
  function position(pieces, turn = 1) {
    const s = R.create();
    s.board.fill(0);
    for (const [p, v] of Object.entries(pieces)) s.board[p] = v;
    s.turn = turn;
    s.positions = [s.board.join(",") + ":" + turn];
    return s;
  }
  function parity(state) {
    const s = session(state);
    try {
      const moves = [];
      for (let from = 0; from < 63; from++) {
        const mask = E.legal_mask(s, A.flip(from));
        for (let to = 0; to < 63; to++)
          if (mask & (1n << BigInt(A.flip(to))))
            moves.push([from, to].join(","));
      }
      assert.deepEqual(
        moves.sort(),
        Array.from(R.legal(state.board, state.turn), (m) =>
          Array.from(m).join(","),
        ).sort(),
      );
      const actual = E.position_status(s);
      const expected =
        state.status === "won" ? state.winner : state.status === "draw" ? 2 : 0;
      assert.equal(actual, expected, "terminal status parity");
    } finally {
      E.session_free(s);
    }
  }
  return {
    E,
    R,
    A,
    session,
    search,
    position,
    parity,
    assets: G.mistyJungleAssets,
  };
}
async function verify(site = root) {
  const H = await harness(site),
    { E, R, A, search, position, parity } = H;
  await require("./tests/adapter.cjs")(R, site);
  const archived = JSON.parse(
    fs.readFileSync(path.join(__dirname, "tests/bakeoff-results.json"), "utf8"),
  );
  assert.equal(
    archived.wasmSha256,
    H.assets.wasmSha256,
    "recorded bakeoff matches shipped engine",
  );
  let wins = 0,
    draws = 0;
  for (const game of archived.results) {
    const steps = game.path.split(" ").map((m) => m.split("-").map(Number));
    const final = R.replay(steps);
    assert(
      final && final.status !== "playing",
      "archived games replay to a real terminal state",
    );
    assert.equal(final.path.length, game.plies);
    const result =
      final.winner === 0 ? 0 : final.winner === game.newSide ? 1 : -1;
    assert.equal(result, game.result);
    if (result === 1) wins++;
    if (result === 0) draws++;
  }
  assert.equal(archived.results.length, 40);
  assert.equal(wins, archived.wins);
  assert.equal(draws, archived.draws);
  assert((wins + draws / 2) / 40 >= 0.65);
  for (let p = 0; p < 63; p++) assert.equal(A.flip(A.flip(p)), p);
  const special = [
    { 2: 8, 1: -2, 62: -1 },
    { 58: 8, 57: -2 },
    { 51: 2, 52: -8 },
    { 14: 1, 15: -8 },
    { 14: 8, 15: -1 },
    { 22: 1, 23: -1 },
    { 22: 1, 21: -1 },
    { 21: 6, 24: -2 },
    { 21: 7, 22: 1, 24: -2 },
    { 15: 6, 29: -1, 0: -2 },
    { 15: 7, 0: -2 },
    { 2: 1, 62: -1 },
  ];
  for (const pieces of special)
    for (const side of [1, -1]) parity(position(pieces, side));
  let seed = 0x4d495354,
    frames = 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let game = 0; game < 12; game++) {
    let state = R.create();
    while (state.status === "playing" && state.path.length < 200) {
      parity(state);
      frames++;
      const moves = R.legal(state.board, state.turn);
      state = R.move(state, ...moves[random() % moves.length]);
    }
    parity(state);
  }
  for (const s of [
    R.move(position({ 2: 1, 62: -1 }), 2, 3),
    R.move(position({ 14: 3, 15: -2 }), 14, 15),
    R.move(position({ 14: -2, 7: 3, 15: 3, 21: 3, 42: 3 }), 42, 35),
  ])
    parity(s);
  let repeated = R.create();
  for (const m of [
    [56, 57],
    [6, 5],
    [57, 56],
    [5, 6],
    [56, 57],
    [6, 5],
    [57, 56],
    [5, 6],
  ])
    repeated = R.move(repeated, ...m);
  parity(repeated);
  const quiet = position({ 14: 1, 48: -1 });
  quiet.quiet = 99;
  parity(R.move(quiet, 14, 7));
  // Winning no-move capture takes precedence over the quiet clock.
  const threat = position({ 10: -2, 17: 8, 42: 1, 48: -1 });
  assert.deepEqual(
    search(threat, 700).move,
    [17, 10],
    "defends immediate den threat",
  );
  assert.deepEqual(search(position({ 2: 1, 62: -1 }), 100).move, [2, 3]);
  assert.deepEqual(search(position({ 14: 3, 15: -2 }), 100).move, [14, 15]);
  const poisoned = position({ 14: 3, 15: -2, 16: -8, 48: 1 });
  assert.notDeepEqual(
    search(poisoned, 700).move,
    [14, 15],
    "does not lose dog for a defended cat",
  );
  const combination = position({ 42: 1, 43: -8, 44: -3, 50: 7 });
  assert.deepEqual(
    search(combination, 700).move,
    [42, 43],
    "rat takes elephant with a recapture available",
  );
  const recapture = R.move(R.move(combination, 42, 43), 44, 43);
  assert.deepEqual(
    search(recapture, 700).move,
    [50, 43],
    "lion completes the capture combination",
  );
  const timings = [];
  for (const [difficulty, ms] of Object.entries(A.budgets)) {
    const result = search(R.create(), ms);
    assert(result.depth > 0 && result.nodes > 0);
    assert(R.move(R.create(), ...result.move));
    assert(result.elapsed < ms + 250);
    timings.push({ difficulty, ...result });
  }
  const before = E.memory.buffer.byteLength;
  for (let i = 0; i < 80; i++) {
    const s = H.session(R.create());
    E.session_step(s, 1000);
    E.session_free(s);
  }
  assert(
    E.memory.buffer.byteLength <= before + 65536,
    "session allocations are reused",
  );
  console.log(
    JSON.stringify(
      {
        engine: H.assets.name,
        commit: H.assets.commit,
        frames,
        timings,
        memoryBytes: E.memory.buffer.byteLength,
      },
      null,
      2,
    ),
  );
}
module.exports = { harness, verify };
if (require.main === module)
  verify().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });

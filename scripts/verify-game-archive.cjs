"use strict";
const { launchGame } = require("./game-test-helpers.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const siteRoot =
  process.argv[2] && !process.argv[2].startsWith("--")
    ? path.resolve(process.argv[2])
    : root;
const copy = (v) => JSON.parse(JSON.stringify(v));
function environment() {
  const sandbox = vm.createContext({
    WorkTimeApp: {
      data: {},
      games: {},
      services: {},
      i18n: { t: (key) => key },
    },
    window: { navigator: {}, dispatchEvent() {} },
    TextEncoder,
    Response,
    Blob,
    CompressionStream,
    DecompressionStream,
    btoa,
    atob,
    Event,
  });
  const load = (file) =>
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, {
      filename: file,
    });
  load("assets/js/games/registry.js");
  for (const name of ["sudoku", "sokoban", "xiangqi"])
    load("assets/data/" + name + ".js");
  for (const name of [
    "2048",
    "minesweeper",
    "snake",
    "sudoku",
    "sokoban",
    "link",
    "garden",
    "xiangqi",
  ])
    load("assets/js/games/" + name + "-rules.js");
  load("assets/js/backup.js");
  load("assets/js/services/game-archive.js");
  return sandbox.WorkTimeApp;
}
function memory() {
  const values = new Map();
  return {
    values,
    fault: null,
    getItem(key) {
      if (this.fault) this.fault("get", key);
      return values.get(key) ?? null;
    },
    setItem(key, text) {
      if (this.fault) this.fault("set", key);
      values.set(key, String(text));
    },
    removeItem(key) {
      if (this.fault) this.fault("remove", key);
      values.delete(key);
    },
  };
}
async function unit() {
  const app = environment(),
    S = app.services.gameArchive,
    G = app.games;
  const storage = memory(),
    owner = S.create(() => storage);
  const group = app.data.sudoku.groups[0],
    puzzle = group.puzzles[0];
  const nextPuzzle = group.puzzles[1];

  // Keep the v1 transport for all seven Sokoban chapters, including old saves.
  for (const chapter of [0, 1, 2, 3, 4, 5, 6]) {
    const level = app.data.sokoban.levels[chapter * 20 + 19];
    const save = {
      version: 1,
      chapter,
      current: level.id,
      completed: {},
      drafts: { [level.id]: { path: level.solution.slice(0, -1) } },
    };
    const restored = S.normalize("game-sokoban", copy(save));
    assert.equal(restored.version, 1);
    assert.equal(restored.chapter, chapter);
    assert.equal(restored.current, level.id);
    assert.equal(restored.drafts[level.id].path, save.drafts[level.id].path);
    assert.deepEqual(
      copy(S.normalize("game-sokoban", copy(restored))),
      copy(restored),
    );
  }
  {
    const previousIds = require("./sokoban-selection.json").previousOrder;
    const oldCurrent = previousIds[99];
    const oldLevel = app.data.sokoban.levels.find(
      (level) => level.id === oldCurrent,
    );
    const completed = Object.fromEntries(
      previousIds.slice(0, 99).map((id) => [
        id,
        {
          path: app.data.sokoban.levels.find((level) => level.id === id)
            .solution,
        },
      ]),
    );
    const migrated = S.normalize("game-sokoban", {
      version: 1,
      chapter: 4,
      current: oldCurrent,
      completed,
      drafts: { [oldCurrent]: { path: oldLevel.solution.slice(0, -1) } },
    });
    assert.equal(migrated.current, oldCurrent);
    assert.equal(Object.keys(migrated.completed).length, 99);
    assert.equal(
      migrated.chapter,
      Math.floor(app.data.sokoban.levels.indexOf(oldLevel) / 20),
    );
    assert.equal(migrated.version, 1);
  }
  assert.throws(() =>
    S.normalize("game-sokoban", {
      version: 1,
      chapter: 7,
      current: null,
      drafts: {},
      completed: {},
    }),
  );

  {
    const triple = app.data.sudoku.groups.find((g) => g.id === "triple");
    assert.equal(triple.puzzles.length, 20);
    assert.equal(triple.legacyPuzzles.length, 20);
    const old = triple.legacyPuzzles[0],
      state = G.sudokuRules.create(old);
    state.replay = G.sudokuRules.startReplay(old, state);
    const index = old.givens.lastIndexOf("0");
    G.sudokuRules.enter(old, state, index, Number(old.solution[index]));
    G.sudokuRules.recordEdit(
      state.replay,
      index,
      Number(old.solution[index]),
      false,
    );
    const save = {
      version: 1,
      group: "triple",
      current: old.id,
      drafts: { [old.id]: state },
      completed: {},
    };
    const normalized = S.normalize("game-sudoku", copy(save));
    assert.equal(normalized.current, old.id);
    assert.equal(normalized.drafts[old.id].values.length, 225);
    assert.ok(normalized.drafts[old.id].replay);
    const restored = S.validate({
      type: S.TYPE,
      version: 1,
      exportedAt: new Date().toISOString(),
      games: { "game-sudoku": save },
    });
    assert.equal(restored.games["game-sudoku"].current, old.id);
  }

  const draft = G.sudokuRules.create(puzzle);
  draft.elapsed = 100;
  draft.replay = G.sudokuRules.startReplay(puzzle, draft);
  const log = { moves: "", finishedAt: 1000 };
  for (let i = 0; i < 81; i++)
    if (puzzle.givens[i] === "0")
      G.sudokuRules.recordEdit(log, i, Number(puzzle.solution[i]), false);
  const mineStats = G.minesweeperRules.emptyStats();
  const difficulty = Object.keys(mineStats)[0];
  mineStats[difficulty] = { best: 1000, wins: 4 };
  const garden = G.gardenRules.create(0, 42);
  const link = {
    mode: "zen",
    level: 0,
    cols: G.linkRules.size(0).cols,
    board: G.linkRules.create(0, () => 0.4),
    phase: "playing",
    score: 10,
    remaining: 100000,
    hints: 3,
    shuffles: 2,
  };
  const firstLevel = app.data.sokoban.levels[0];
  const map = G.sokobanRules.parse(firstLevel);
  const sokoban = G.sokobanRules.create();
  const direction = Object.keys(G.sokobanRules.directions).find((d) =>
    G.sokobanRules.move(map, sokoban, d),
  );
  assert.ok(direction);
  const [mate] = app.data.xiangqi;
  const oldStalemate = {
    version: 1,
    current: "xq-20",
    drafts: { "xq-20": { path: [1093] } },
    completed: {},
  };
  const wonStalemate = S.normalize("game-xiangqi", oldStalemate);
  assert.equal(wonStalemate.current, null);
  assert.deepEqual(copy(wonStalemate.drafts), {});
  assert.deepEqual(copy(wonStalemate.completed["xq-20"]), { path: [1093] });
  assert.deepEqual(
    copy(S.normalize("game-xiangqi", wonStalemate)),
    copy(wonStalemate),
  );
  assert.throws(() =>
    S.normalize("game-xiangqi", {
      ...oldStalemate,
      drafts: { "xq-20": { path: [1093, 0] } },
    }),
  );
  const twoMoves = app.data.xiangqi.find(({ id }) => id === "xq-07");
  const [winningMove, alternative] = Object.keys(mate.tree[1]).map(Number);
  const [opening, otherOpening] = Object.keys(twoMoves.tree[1]).map(Number);
  const round = (move) => [move, G.xiangqiRules.reply(twoMoves.tree[1][move])];
  const xiangqi = {
    version: 1,
    current: twoMoves.id,
    drafts: { [twoMoves.id]: { path: round(opening) } },
    completed: { [mate.id]: { path: [winningMove] } },
  };
  const retired = app.data.xiangqiRetired;
  assert.equal(retired.length, 20);
  const retiredMate = retired.find(({ goal }) => goal === 1);
  const retiredBoard = G.xiangqiRules.parse(retiredMate.position);
  const retiredWin = G.xiangqiRules
    .legalMoves(retiredBoard, true)
    .find(
      (move) =>
        G.xiangqiRules.result(
          G.xiangqiRules.apply(retiredBoard, move),
          false,
        ) === "mate",
    );
  assert(Number.isInteger(retiredWin));
  const oldSave = {
    ...xiangqi,
    current: retired.at(-1).id,
    drafts: { ...xiangqi.drafts, [retired.at(-1).id]: { path: [] } },
    completed: {
      ...xiangqi.completed,
      [retiredMate.id]: { path: [retiredWin] },
    },
  };
  const migrated = S.normalize("game-xiangqi", oldSave);
  assert.equal(migrated.current, null);
  assert.deepEqual(copy(migrated.drafts), oldSave.drafts);
  assert.deepEqual(copy(migrated.completed), oldSave.completed);
  const historicalStorage = new Map([
    [S.keys["game-xiangqi"], JSON.stringify(oldSave)],
  ]);
  const historicalOwner = S.create(() => ({
    getItem: (key) => historicalStorage.get(key) ?? null,
  }));
  const loadedBank = app.data.xiangqi;
  delete app.data.xiangqi;
  assert.deepEqual(copy(historicalOwner.progressSummary("game-xiangqi")), {
    kind: "completed",
    value: 1,
  });
  for (const level of retired) {
    historicalStorage.set(
      S.keys["game-xiangqi"],
      JSON.stringify({
        version: 1,
        completed: { [level.id]: {} },
        drafts: { [level.id]: { path: [1] } },
      }),
    );
    assert.deepEqual(copy(historicalOwner.progressSummary("game-xiangqi")), {
      kind: "empty",
    });
  }
  app.data.xiangqi = loadedBank;
  const saves = {
    "game-2048": {
      version: 1,
      state: { ...G.rules2048.create(() => 0), score: 4 },
      previous: null,
      best: 100,
    },
    "game-minesweeper": {
      version: 1,
      state: G.minesweeperRules.create(),
      stats: mineStats,
      elapsed: 0,
      manualPaused: false,
    },
    "game-snake": {
      version: 1,
      state: G.snakeRules.create("classic", () => 0.4),
      best: { classic: 100, wrap: 30, rush: 10 },
    },
    "game-sudoku": {
      version: 1,
      current: puzzle.id,
      group: group.id,
      drafts: { [puzzle.id]: draft },
      completed: { [puzzle.id]: { elapsed: 1000, hints: 2, replay: log } },
    },
    "game-jump": 120,
    "game-sokoban": {
      version: 1,
      current: firstLevel.id,
      chapter: 0,
      drafts: { [firstLevel.id]: { path: sokoban.path } },
      completed: {},
    },
    "game-link": { state: link, best: { zen: 100, quest: 30, tide: 10 } },
    "game-garden": {
      version: 1,
      state: garden,
      previous: null,
      records: Array(G.gardenRules.levelCount).fill(1),
    },
    "game-tank": { best: 100, custom: Array(2704).fill(0), muted: false },
    "game-xiangqi": xiangqi,
  };
  const archive = (games) => ({
    type: S.TYPE,
    version: 1,
    exportedAt: "2026-10-22T00:00:00.000Z",
    games,
  });
  for (const [id, value] of Object.entries(saves))
    storage.setItem(S.keys[id], JSON.stringify(value));
  for (const [id, kind, value] of [
    ["game-2048", "best", 100],
    ["game-minesweeper", "wins", 4],
    ["game-snake", "best", 100],
    ["game-sudoku", "completed", 1],
    ["game-jump", "best", 120],
    ["game-sokoban", "empty"],
    ["game-link", "best", 100],
    ["game-garden", "completed", G.gardenRules.levelCount],
    ["game-tank", "best", 100],
    ["game-xiangqi", "completed", 1],
  ]) {
    const progress = owner.progressSummary(id);
    assert.equal(progress.kind, kind, id);
    assert.equal(progress.value, value, id);
  }
  const unavailable = S.create(() => {
    throw Error("Storage denied");
  });
  assert.equal(unavailable.progressSummary("game-2048").kind, "unavailable");
  storage.setItem("worktime.unrelated", "keep");
  const historicalArchive = archive({ "game-xiangqi": migrated });
  assert.deepEqual(
    copy(await S.decode(await S.encode(historicalArchive))),
    copy(historicalArchive),
  );
  const packed = owner.exportArchive();
  assert.equal(Object.keys(packed.games).length, 10);
  assert.deepEqual(copy(await S.decode(await S.encode(packed))), copy(packed));
  assert.deepEqual(
    copy(await S.decode(S.PREFIX + "JSON:" + JSON.stringify(packed))),
    copy(packed),
  );
  assert.deepEqual(copy(await S.decode(JSON.stringify(packed))), copy(packed));
  const { ["game-xiangqi"]: savedXiangqi, ...legacy } = packed.games;
  assert.deepEqual(copy(savedXiangqi), xiangqi);
  assert.deepEqual(copy(S.validate(archive(legacy)).games), copy(legacy));
  const legacyStorage = memory();
  legacyStorage.setItem(S.keys["game-xiangqi"], JSON.stringify(xiangqi));
  const legacyBefore = Object.fromEntries(
    Object.keys(legacy).map((id) => [id, null]),
  );
  legacyStorage.setItem(
    S.JOURNAL,
    JSON.stringify({
      version: 1,
      revision: "legacy",
      before: legacyBefore,
    }),
  );
  const legacyOwner = S.create(() => legacyStorage);
  legacyOwner.recover();
  assert.deepEqual(copy(legacyOwner.read().games), { "game-xiangqi": xiangqi });
  const otherMate = app.data.xiangqi[1];
  const otherWin = Number(Object.keys(otherMate.tree[1])[0]);
  const incomingXiangqi = {
    ...xiangqi,
    drafts: { [twoMoves.id]: { path: round(otherOpening) } },
    completed: { [otherMate.id]: { path: [otherWin] } },
  };
  const xiangqiArchive = archive({ "game-xiangqi": incomingXiangqi });
  const [defaultChoice] = owner.preview(xiangqiArchive).rows;
  assert.equal(defaultChoice.conflict, true);
  assert.deepEqual(copy(defaultChoice.value.drafts), xiangqi.drafts);
  const [importedChoice] = owner.preview(xiangqiArchive, {
    "game-xiangqi": "incoming",
  }).rows;
  assert.deepEqual(copy(importedChoice.value.drafts), incomingXiangqi.drafts);
  assert.equal(importedChoice.completedAdded, 1);
  const freePlay = {
    version: 1,
    current: mate.id,
    drafts: { [mate.id]: { path: [90, 283] } },
    completed: { [mate.id]: { path: [90, 283, 2460] } },
  };
  const freeArchive = archive({ "game-xiangqi": freePlay });
  assert.deepEqual(
    copy(await S.decode(await S.encode(freeArchive))),
    freeArchive,
  );
  const [freeChoice] = owner.preview(freeArchive, {
    "game-xiangqi": "incoming",
  }).rows;
  assert.deepEqual(copy(freeChoice.value.drafts), {
    ...xiangqi.drafts,
    ...freePlay.drafts,
  });
  assert.throws(
    () =>
      S.normalize("game-xiangqi", {
        ...freePlay,
        completed: freePlay.drafts,
      }),
    { code: "invalid" },
  );
  assert.throws(
    () =>
      S.normalize("game-xiangqi", {
        ...xiangqi,
        completed: { [mate.id]: { path: [alternative, winningMove] } },
      }),
    { code: "invalid" },
  );
  assert.throws(
    () =>
      S.normalize("game-xiangqi", {
        ...xiangqi,
        drafts: { [twoMoves.id]: { path: [opening] } },
      }),
    { code: "invalid" },
  );
  const legacySudoku = {
    ...copy(saves["game-sudoku"]),
    group: "fog",
    current: "fog-2",
  };
  for (let n = 1; n <= 6; n++) {
    legacySudoku.drafts["fog-" + n] = copy(draft);
    legacySudoku.completed["fog-" + n] = { elapsed: 10, hints: 0 };
  }
  const migratedSudoku = S.normalize("game-sudoku", legacySudoku);
  assert.equal(migratedSudoku.group, group.id);
  assert.equal(migratedSudoku.current, null);
  assert.deepEqual(
    migratedSudoku.drafts,
    S.normalize("game-sudoku", saves["game-sudoku"]).drafts,
  );
  assert.deepEqual(
    migratedSudoku.completed,
    S.normalize("game-sudoku", saves["game-sudoku"]).completed,
  );
  assert.throws(
    () =>
      S.normalize("game-sudoku", { ...legacySudoku, current: "unknown-level" }),
    { code: "invalid" },
  );
  for (const variant of ["parity", "thermo"]) {
    const legacy = copy(saves["game-sudoku"]);
    legacy.group = variant;
    const levels = app.data.sudoku.groups
      .find((g) => g.id === variant)
      .puzzles.slice(15, 20);
    legacy.current = levels.at(-1).id;
    for (const level of levels) {
      const progress = G.sudokuRules.create(level);
      const cell = level.givens.indexOf("0");
      G.sudokuRules.enter(level, progress, cell, Number(level.solution[cell]));
      legacy.drafts[level.id] = copy(progress);
      legacy.completed[level.id] = { elapsed: 10, hints: 0 };
    }
    const normalized = S.normalize("game-sudoku", legacy);
    assert.equal(normalized.current, levels.at(-1).id);
    assert.equal(normalized.group, variant);
    for (const { id } of levels) {
      assert.deepEqual(
        copy(normalized.drafts[id].values),
        legacy.drafts[id].values,
      );
      assert.deepEqual(copy(normalized.completed[id]), {
        elapsed: 10,
        hints: 0,
      });
    }
    assert.throws(
      () =>
        S.normalize("game-sudoku", {
          ...legacy,
          current: variant + "-unknown",
        }),
      { code: "invalid" },
    );
  }
  const compressed = await app.services.backup.encode(JSON.stringify(packed));
  await assert.rejects(() =>
    app.services.backup.decode(JSON.stringify(packed), (v) => v),
  );
  await assert.rejects(() => S.decode(compressed));
  await assert.rejects(() => app.services.backup.decode(compressed, (v) => v), {
    code: "gameOnly",
  });
  await assert.rejects(() => S.decode(JSON.stringify({ days: {} })), {
    code: "wrongType",
  });
  await assert.rejects(
    () => S.decode(JSON.stringify({ ...packed, version: 2 })),
    { code: "version" },
  );
  await assert.rejects(
    () => S.decode(JSON.stringify(archive({ "unknown-game": {} }))),
    { code: "invalid" },
  );
  await assert.rejects(() => S.decode("x".repeat(S.MAX_BYTES + 1)), {
    code: "tooLarge",
  });
  await assert.rejects(() => S.decode(S.PREFIX + "GZIP:broken!"), {
    code: "invalid",
  });
  const oversized = await app.services.backup.encode(
    // The decompressed limit is independent of the small compressed input.
    " ".repeat(S.MAX_BYTES + 1),
  );
  await assert.rejects(() =>
    S.decode(
      S.PREFIX + "GZIP:" + oversized.slice(app.services.backup.PREFIX.length),
    ),
  );
  const clean = S.normalize("game-snake", {
    ...saves["game-snake"],
    state: { ...saves["game-snake"].state, secret: "discard" },
  });
  assert.equal(clean.state.secret, undefined);
  const incoming = copy(saves);
  incoming["game-2048"].state.score = 8;
  incoming["game-2048"].best = 200;
  incoming["game-jump"] = 90;
  incoming["game-minesweeper"].stats[difficulty] = { best: 800, wins: 3 };
  incoming["game-snake"].best = { classic: 90, wrap: 60, rush: 50 };
  incoming["game-link"].best = { zen: 90, quest: 60, tide: 50 };
  incoming["game-garden"].records[0] = 3;
  incoming["game-garden"].records[1] = 0;
  incoming["game-sudoku"].completed[puzzle.id] = { elapsed: 2000, hints: 1 };
  incoming["game-sudoku"].drafts[puzzle.id].elapsed = 300;
  incoming["game-sudoku"].drafts[nextPuzzle.id] =
    G.sudokuRules.create(nextPuzzle);
  incoming["game-tank"].custom[0] = 1;
  const before = [...storage.values];
  const preview = owner.preview(archive(incoming));
  assert.deepEqual([...storage.values], before, "preview never writes");
  assert.equal(preview.rows.find((r) => r.id === "game-2048").conflict, true);
  assert.equal(
    preview.rows.find((r) => r.id === "game-2048").value.state.score,
    4,
  );
  const chosen = owner.preview(archive(incoming), {
    "game-2048": "incoming",
    "game-sudoku": "incoming",
    "game-tank": "incoming",
  });
  owner.commit(chosen);
  const merged = owner.read().games;
  assert.equal(merged["game-2048"].state.score, 8);
  assert.equal(merged["game-2048"].best, 200);
  assert.equal(merged["game-jump"], 120);
  assert.equal(merged["game-minesweeper"].stats[difficulty].best, 800);
  assert.equal(merged["game-minesweeper"].stats[difficulty].wins, 4);
  assert.equal(merged["game-snake"].best.wrap, 60);
  assert.equal(merged["game-link"].best.quest, 60);
  assert.equal(merged["game-garden"].records[0], 3);
  assert.equal(merged["game-garden"].records[1], 1);
  assert.equal(merged["game-sudoku"].drafts[puzzle.id].elapsed, 300);
  assert.ok(merged["game-sudoku"].drafts[nextPuzzle.id]);
  assert.equal(merged["game-sudoku"].completed[puzzle.id].hints, 1);
  assert.deepEqual(
    copy(merged["game-sudoku"].completed[puzzle.id].replay),
    log,
  );
  const sudoku = copy(merged["game-sudoku"]);
  const newer = copy(sudoku);
  newer.completed[puzzle.id] = {
    elapsed: 9999,
    hints: 2,
    replay: { ...log, finishedAt: 2000 },
  };
  const replayMerge = S.merge("game-sudoku", sudoku, newer).value;
  assert.equal(replayMerge.completed[puzzle.id].elapsed, 2000);
  assert.equal(replayMerge.completed[puzzle.id].replay.finishedAt, 2000);
  assert.deepEqual(copy(replayMerge.drafts[puzzle.id].replay), { moves: "" });
  newer.completed[puzzle.id].replay.moves = "zzz";
  newer.drafts[puzzle.id].replay.moves = log.moves;
  const sanitized = S.normalize("game-sudoku", newer);
  assert.equal(sanitized.completed[puzzle.id].elapsed, 9999);
  assert.equal(sanitized.completed[puzzle.id].replay, undefined);
  assert.equal(sanitized.drafts[puzzle.id].replay, undefined);
  assert.equal(merged["game-tank"].custom[0], 1);
  const secondLevel = app.data.sokoban.levels[1];
  const thirdLevel = app.data.sokoban.levels[2];
  const a = {
    ...copy(saves["game-sokoban"]),
    completed: { [secondLevel.id]: { path: secondLevel.solution } },
  };
  const b = {
    ...copy(a),
    completed: {
      [secondLevel.id]: { path: secondLevel.solution },
      [thirdLevel.id]: { path: thirdLevel.solution },
    },
  };
  const union = S.merge(
    "game-sokoban",
    S.normalize("game-sokoban", a),
    S.normalize("game-sokoban", b),
  );
  assert.equal(Object.keys(union.value.completed).length, 2);
  assert.equal(
    union.value.completed[secondLevel.id].path,
    secondLevel.solution,
  );
  const cleanLocal = {
    ...copy(saves["game-2048"]),
    state: G.rules2048.create(),
    previous: null,
  };
  const withUndo = {
    ...copy(saves["game-2048"]),
    previous: saves["game-2048"].state,
  };
  const filled = S.merge("game-2048", cleanLocal, withUndo);
  assert.equal(
    filled.conflict,
    false,
    "a best score without current progress is not a conflict",
  );
  assert.deepEqual(copy(filled.value.previous), copy(withUndo.previous));
  assert.equal(storage.getItem("worktime.unrelated"), "keep");
  assert.equal(owner.previousBackup().games["game-2048"].best, 100);
  const after = [...storage.values];
  assert.ok(
    owner
      .commit(owner.preview(archive(incoming)))
      .every((r) => r.status === "unchanged"),
  );
  assert.deepEqual(
    [...storage.values],
    after,
    "repeat imports do not replace backup or revision",
  );
  const stale = owner.preview(archive({ "game-jump": 500 }));
  storage.setItem(S.keys["game-jump"], "121");
  assert.throws(() => owner.commit(stale), { code: "changed" });
  const session = owner.session();
  owner.commit(owner.preview(archive({ "game-jump": 500 })));
  assert.throws(() => session.setItem(S.keys["game-jump"], "1"), {
    code: "stale",
  });
  const original = owner.read().raw;
  let failed = false;
  storage.fault = (op, key) => {
    if (!failed && op === "set" && key === S.keys["game-tank"]) {
      failed = true;
      throw Error("quota");
    }
  };
  assert.throws(() =>
    owner.commit(
      owner.preview(
        archive({
          "game-jump": 600,
          "game-tank": { best: 500, custom: null, muted: false },
        }),
      ),
    ),
  );
  storage.fault = null;
  assert.deepEqual(
    copy(owner.read().raw),
    copy(original),
    "mid-write failure rolls back all games",
  );
  assert.equal(storage.getItem(S.JOURNAL), null);
  storage.fault = (op, key) => {
    if (op === "set" && key === S.BACKUP) throw Error("quota");
  };
  assert.throws(() =>
    owner.commit(owner.preview(archive({ "game-jump": 900 }))),
  );
  storage.fault = null;
  assert.deepEqual(
    copy(owner.read().raw),
    copy(original),
    "failed backup prevents writes",
  );
  storage.setItem(
    S.JOURNAL,
    JSON.stringify({ version: 1, revision: "interrupted", before: original }),
  );
  storage.setItem(S.keys["game-jump"], "9999");
  const reloaded = S.create(() => storage);
  reloaded.recover();
  assert.deepEqual(
    copy(reloaded.read().raw),
    copy(original),
    "reload recovers an interrupted import",
  );
  storage.setItem(
    S.JOURNAL,
    JSON.stringify({
      version: 1,
      revision: "retry-recovery",
      before: original,
    }),
  );
  storage.fault = (op, key) => {
    if (op === "set" && key === S.keys["game-jump"]) throw Error("still full");
  };
  assert.throws(() => reloaded.recover(), { code: "recovery" });
  assert.ok(storage.getItem(S.JOURNAL), "failed recovery retains its journal");
  assert.throws(() => reloaded.read(), { code: "recovery" });
  assert.throws(() => reloaded.session().setItem(S.keys["game-jump"], "0"), {
    code: "stale",
  });
  storage.fault = null;
  reloaded.recover();
  assert.deepEqual(copy(reloaded.read().raw), copy(original));
  storage.setItem(S.keys["game-tank"], "broken");
  assert.throws(() => owner.exportArchive(), {
    code: "localInvalid",
    game: "game-tank",
  });
  assert.equal(storage.getItem(S.keys["game-tank"]), "broken");
  const empty = memory(),
    fresh = S.create(() => empty);
  empty.setItem(
    S.keys["game-2048"],
    JSON.stringify({
      ...saves["game-2048"],
      best: 0,
      state: G.rules2048.create(),
      previous: null,
    }),
  );
  assert.throws(() => fresh.exportArchive(), { code: "empty" });
  const locked = S.create(() => {
    throw Error("unavailable");
  });
  assert.throws(() => locked.read());
  assert.throws(() => locked.session().setItem(S.keys["game-jump"], "1"));
  const firstImport = memory(),
    firstOwner = S.create(() => firstImport);
  firstOwner.commit(firstOwner.preview(archive({ "game-jump": 10 })));
  assert.equal(
    Object.keys(firstOwner.previousBackup().games).length,
    0,
    "empty pre-import backups can still be downloaded",
  );
  const replacement = memory(),
    replacementOwner = S.create(() => replacement);
  assert.equal(
    Object.keys(replacementOwner.exportArchive({ allowEmpty: true }).games)
      .length,
    0,
  );
  replacement.setItem(S.keys["game-jump"], "70");
  replacement.setItem(S.keys["game-tank"], JSON.stringify(saves["game-tank"]));
  const beforeReplacement = copy(replacementOwner.read().raw);
  const workFailure = { persisted: false, error: Error("work storage full") };
  assert.equal(
    await replacementOwner.replace(
      archive({ "game-jump": 10 }),
      async () => workFailure,
    ),
    workFailure,
  );
  assert.deepEqual(copy(replacementOwner.read().raw), beforeReplacement);
  await assert.rejects(
    replacementOwner.replace(archive({ "game-jump": 10 }), async () => {
      throw Error("work restore failed");
    }),
    /work restore failed/,
  );
  assert.deepEqual(copy(replacementOwner.read().raw), beforeReplacement);
  const staleReplacement = replacementOwner.session();
  let applyCalls = 0;
  replacement.fault = (op, key) => {
    if (op === "set" && key === S.BACKUP) throw Error("backup full");
  };
  await assert.rejects(
    replacementOwner.replace(archive({ "game-jump": 10 }), async () => {
      applyCalls++;
      return { persisted: true };
    }),
    /backup full/,
  );
  replacement.fault = null;
  assert.equal(applyCalls, 0);
  assert.deepEqual(copy(replacementOwner.read().raw), beforeReplacement);
  await replacementOwner.replace(archive({ "game-jump": 10 }), async () => ({
    persisted: true,
  }));
  assert.equal(replacement.getItem(S.keys["game-jump"]), "10");
  assert.equal(replacement.getItem(S.keys["game-tank"]), null);
  assert.throws(() => staleReplacement.setItem(S.keys["game-jump"], "100"), {
    code: "stale",
  });
  await replacementOwner.replace(archive({}), async () => ({
    persisted: true,
  }));
  assert.equal(Object.keys(replacementOwner.read().games).length, 0);
  await replacementOwner.replace(archive(saves), async () => ({
    persisted: true,
  }));
  assert.deepEqual(
    copy(replacementOwner.read().games),
    copy(S.validate(archive(saves)).games),
  );
  assert.ok(
    Object.keys(
      fresh.exportArchive({ allowEmpty: true, includeDefaults: true }).games,
    ).includes("game-2048"),
  );
  const rawFull = JSON.stringify({
    format: "worktime-full-backup",
    games: archive(saves),
  });
  const compact = await app.services.backup.encodeCompact(rawFull);
  assert.ok(
    compact.length <= (await app.services.backup.encode(rawFull)).length,
  );
  assert.deepEqual(
    copy(await app.services.backup.decode(compact, (v) => v)),
    JSON.parse(rawFull),
  );
  assert.equal(await app.services.backup.encodeCompact("1"), "1");
  await assert.rejects(
    () =>
      app.services.backup.decode(compact, (v) => v, {
        maxBytes: compact.length + 1,
      }),
    { code: "tooLarge" },
  );
  console.log(
    "Game transport, validation, merge policy, idempotence, preview isolation, rollback, recovery and stale sessions passed.",
  );
}
async function ui() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 2560, height: 1440 },
      reducedMotion: "reduce",
    });
    await context.addInitScript(() => {
      let text = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          readText: async () => {
            if (window.rejectClipboard) throw Error("denied");
            return text;
          },
          writeText: async (value) => {
            text = value;
            window.copiedGameSave = value;
          },
        },
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    const url = pathToFileURL(path.join(siteRoot, "index.html")).href;
    await page.goto(url);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#date-tab-games").click();
    const save = page.locator('#gamesPanel [data-game-archive="save"]');
    const restore = page.locator('#gamesPanel [data-game-archive="import"]');
    await save.click();
    await page.waitForFunction(() =>
      /暂无|No game/.test(
        document.querySelector("#gamesPanel .game-menu-archive-status")
          .textContent,
      ),
    );
    assert.match(
      await page.locator("#gamesPanel .game-menu-archive-status").textContent(),
      /暂无|No game/,
    );
    const xiangqi = await page.evaluate(async () => {
      localStorage.setItem("worktime.games.jump.best.v1", "10");
      await WorkTimeApp.games.prepareArchive(["game-xiangqi"]);
      const [level] = WorkTimeApp.data.xiangqi;
      const save = {
        version: 1,
        current: null,
        drafts: {},
        completed: {
          [level.id]: { path: [Number(Object.keys(level.tree[1])[0])] },
        },
      };
      localStorage.setItem(
        WorkTimeApp.services.gameArchive.keys["game-xiangqi"],
        JSON.stringify(save),
      );
      return save;
    });
    await save.click();
    await page.waitForFunction(() =>
      window.copiedGameSave?.startsWith("WORKTIME:GAMES:1:"),
    );
    await page.setViewportSize({ width: 320, height: 740 });
    const copyStatus = page.locator("#gamesPanel .game-menu-archive-status");
    for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"]) {
      await page.evaluate((id) => WorkTimeApp.i18n.setLanguage(id), language);
      await save.click();
      await page.waitForFunction(
        () =>
          document.querySelector("#gamesPanel .game-menu-archive-status")
            .textContent === WorkTimeApp.i18n.t("gameArchive.copied"),
      );
      const lines = await copyStatus.evaluate((status) => {
        const range = document.createRange();
        range.selectNodeContents(status);
        return range.getClientRects().length;
      });
      assert.equal(lines, 1, `Copy confirmation fits at 320px in ${language}`);
    }
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    await page.setViewportSize({ width: 2560, height: 1440 });
    const xiangqiKey = "worktime.games.xiangqi.v1";
    await page.evaluate((key) => localStorage.removeItem(key), xiangqiKey);
    await restore.click();
    const dialog = page.locator(".game-archive-dialog");
    const confirm = dialog.locator(".game-archive-footer .primary");
    await confirm.waitFor({ state: "visible" });
    await page.waitForFunction(
      () => !document.querySelector(".game-archive-footer .primary").disabled,
    );
    await confirm.click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await dialog.isVisible(), false);
    assert.deepEqual(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        xiangqiKey,
      ),
      xiangqi,
    );
    await restore.click();
    const raw = JSON.stringify({
      type: "worktime-games",
      version: 1,
      exportedAt: new Date().toISOString(),
      games: { "game-jump": 50 },
    });
    await dialog.locator("textarea").fill(raw);
    await dialog
      .getByRole("button", { name: /预览合并|Preview merge/ })
      .click();
    await page.waitForFunction(
      () => !document.querySelector(".game-archive-footer .primary").disabled,
    );
    await page.evaluate(() =>
      localStorage.setItem("worktime.games.jump.best.v1", "20"),
    );
    await confirm.click();
    await page.waitForFunction(() =>
      document
        .querySelector(".game-archive-error")
        .textContent.includes("预览已刷新"),
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.jump.best.v1"),
      ),
      "20",
    );
    await confirm.click();
    await page.waitForFunction(
      () => !document.querySelector(".game-archive-dialog").open,
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.jump.best.v1"),
      ),
      "50",
    );
    await restore.click();
    const backupDownload = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: /下载导入前备份|Download pre-import/ })
      .click();
    assert.match((await backupDownload).suggestedFilename(), /before/);
    await page.evaluate(() => {
      window.archiveDialogClosed = false;
      document.querySelector(".game-archive-dialog").addEventListener(
        "close",
        () => {
          window.archiveDialogClosed = true;
        },
        { once: true },
      );
    });
    await dialog.getByRole("button", { name: /取消|Cancel/ }).click();
    // Native close dispatch restores focus asynchronously. Wait for that event
    // before starting a keyboard hold on a different button.
    await page.waitForFunction(() => window.archiveDialogClosed);
    const holdDownload = page.waitForEvent("download");
    await save.focus();
    await page.keyboard.down("Space");
    await holdDownload;
    await page.keyboard.up("Space");
    await page.evaluate(() => {
      window.rejectClipboard = true;
    });
    await restore.click();
    await page.waitForFunction(() =>
      document
        .querySelector(".game-archive-error")
        .textContent.includes("剪贴板"),
    );
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "games.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ ...JSON.parse(raw), games: { "game-jump": 100 } }),
      ),
    });
    await page.waitForFunction(
      () => !document.querySelector(".game-archive-footer .primary").disabled,
    );
    await dialog.getByRole("button", { name: /取消|Cancel/ }).click();
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("worktime.games.jump.best.v1"),
      ),
      "50",
      "cancel does not write",
    );
    const conflictArchive = await page.evaluate(() => {
      const S = WorkTimeApp.services.gameArchive;
      const state = WorkTimeApp.games.rules2048.create(() => 0.4);
      const local = {
        version: 1,
        state: { ...state, score: 4 },
        best: 4,
        previous: null,
      };
      localStorage.setItem(S.keys["game-2048"], JSON.stringify(local));
      return {
        type: S.TYPE,
        version: 1,
        exportedAt: new Date().toISOString(),
        games: {
          "game-2048": {
            ...local,
            state: { ...state, score: 8 },
            best: 8,
            previous: local.state,
          },
        },
      };
    });
    await restore.click();
    await dialog.locator("textarea").fill(JSON.stringify(conflictArchive));
    await dialog.getByRole("button", { name: "预览合并", exact: true }).click();
    const choice = dialog.getByRole("checkbox", { name: /2048/ });
    await choice.waitFor();
    assert.equal(await choice.isChecked(), false);
    await page.setViewportSize({ width: 320, height: 360 });
    await choice.press("Space");
    assert.equal(await choice.isChecked(), true);
    assert.equal(
      await choice.evaluate((el) => el === document.activeElement),
      true,
    );
    await choice.press("Space");
    assert.equal(await choice.isChecked(), false);
    await choice.locator("..").click();
    assert.equal(await choice.isChecked(), true);
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("en"));
    assert.equal(await choice.isChecked(), true);
    assert.equal(
      await choice.evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(
      await dialog.evaluate((element) => {
        const body = element.querySelector(".game-archive-body");
        const footer = element.querySelector(".game-archive-footer");
        const top = footer.getBoundingClientRect().top;
        body.scrollTop = body.scrollHeight;
        return (
          body.scrollTop > 0 &&
          top === footer.getBoundingClientRect().top &&
          footer.getBoundingClientRect().bottom <= window.innerHeight &&
          body.scrollWidth <= body.clientWidth
        );
      }),
      true,
    );
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    await page.setViewportSize({ width: 2560, height: 1440 });
    fs.mkdirSync(path.join(root, "test-results/game-archive"), {
      recursive: true,
    });
    await dialog.screenshot({
      path: path.join(root, "test-results/game-archive/merge-2560.png"),
    });
    await confirm.click();
    await page.waitForFunction(
      () => !document.querySelector(".game-archive-dialog").open,
    );
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.2048.v1")).state
            .score,
      ),
      8,
    );
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.2048.v1")).previous
            .score,
      ),
      4,
    );
    // A second window must return to the menu and never write stale state back.
    const other = await context.newPage();
    await other.route(/^https?:/, (route) => route.abort());
    await other.goto(url);
    await other.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await other.locator("#date-tab-games").click();
    await launchGame(other, "game-2048");
    await other.waitForFunction(
      () => document.getElementById("gameShell").dataset.state === "open",
    );
    await page.evaluate(async () => {
      const S = WorkTimeApp.services.gameArchive;
      const prior = JSON.parse(localStorage.getItem(S.keys["game-2048"]));
      await S.commit(
        S.preview(
          {
            type: S.TYPE,
            version: 1,
            exportedAt: new Date().toISOString(),
            games: {
              "game-jump": 200,
              "game-2048": {
                ...prior,
                best: 16,
                state: { ...prior.state, score: 16 },
              },
            },
          },
          { "game-2048": "incoming" },
        ),
      );
    });
    await other.waitForFunction(
      () => document.getElementById("gameShell").dataset.state === "closed",
    );
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime.games.2048.v1")).state
            .score,
      ),
      16,
      "the old game instance cannot overwrite imported progress",
    );
    for (const width of [2560, 1920, 390, 320]) {
      await page.setViewportSize({ width, height: width > 1000 ? 1440 : 844 });
      await restore.click();
      for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
        await page.evaluate(
          (language) => WorkTimeApp.i18n.setLanguage(language),
          language,
        );
        assert.ok(
          await page.evaluate(
            () =>
              document.querySelector(".game-archive-dialog").scrollWidth <=
              document.querySelector(".game-archive-dialog").clientWidth,
          ),
        );
      }
      await page.keyboard.press("Escape");
    }
    assert.deepEqual(errors, []);
    const restricted = await browser.newContext({ reducedMotion: "reduce" });
    await restricted.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("Storage blocked", "SecurityError");
        },
      });
    });
    const restrictedPage = await restricted.newPage();
    await restrictedPage.route(/^https?:/, (route) => route.abort());
    await restrictedPage.goto(url);
    await restrictedPage.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await restrictedPage.locator("#date-tab-games").click();
    await launchGame(restrictedPage, "game-2048");
    await restrictedPage.waitForFunction(
      () => document.getElementById("gameShell").dataset.state === "open",
    );
    assert.equal(await restrictedPage.locator(".game-2048").count(), 1);
    await restricted.close();
    await context.close();
    console.log(
      "Clipboard, hold download, file and paste preview, confirmation refresh, cancellation, backup download, external import and six-language responsive dialog passed.",
    );
  } finally {
    await browser.close();
  }
}
(async () => {
  await unit();
  if (!process.argv.includes("--unit")) await ui();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

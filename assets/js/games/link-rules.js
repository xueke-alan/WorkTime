"use strict";
/** A padded empty ring allows routes outside the board; at most two turns. */
WorkTimeApp.games.linkRules = (() => {
  const boardSize = Object.freeze({ cols: 20, rows: 12 });
  const kinds = 48;
  const family = (value) => Math.floor((value - 1) / 12);
  const directions = ["down", "left", "up", "right"];
  const size = () => boardSize;
  function route(board, a, b, cols = boardSize.cols) {
    if (a === b || !board[a] || board[a] !== board[b]) return null;
    const rows = board.length / cols,
      width = cols + 2;
    const point = (i) => [(i % cols) + 1, Math.floor(i / cols) + 1];
    const start = point(a),
      end = point(b);
    const directions = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ];
    const queue = [
      { x: start[0], y: start[1], d: -1, turns: 0, path: [start] },
    ];
    const seen = new Map();
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      for (let d = 0; d < 4; d++) {
        const turns =
          current.turns + (current.d >= 0 && current.d !== d ? 1 : 0);
        if (turns > 2) continue;
        const [dx, dy] = directions[d];
        const x = current.x + dx,
          y = current.y + dy;
        if (x < 0 || x >= width || y < 0 || y > rows + 1) continue;
        const path = [...current.path, [x, y]];
        if (x === end[0] && y === end[1]) return path;
        if (
          x > 0 &&
          x <= cols &&
          y > 0 &&
          y <= rows &&
          board[(y - 1) * cols + x - 1]
        )
          continue;
        const key = (y * width + x) * 4 + d;
        if ((seen.get(key) ?? 3) <= turns) continue;
        seen.set(key, turns);
        queue.push({ x, y, d, turns, path });
      }
    }
    return null;
  }
  function find(board, cols = boardSize.cols) {
    for (let a = 0; a < board.length; a++)
      if (board[a])
        for (let b = a + 1; b < board.length; b++)
          if (board[a] === board[b]) {
            const path = route(board, a, b, cols);
            if (path) return { a, b, path };
          }
    return null;
  }
  function shuffle(board, random = Math.random, cols = boardSize.cols) {
    const values = board.filter(Boolean);
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    // Compact occupied slots: if randomness has no move, force the first two
    // slots to be a matching adjacent pair. Multiset and empties are preserved.
    const result = [...values, ...Array(board.length - values.length).fill(0)];
    if (values.length && !find(result, cols)) {
      const mate = result.findIndex((value, i) => i > 0 && value === result[0]);
      [result[1], result[mate]] = [result[mate], result[1]];
    }
    return result;
  }
  function create(level, random = Math.random) {
    const { cols, rows } = size(level);
    return shuffle(
      Array.from(
        { length: rows * cols },
        (_, i) => ((Math.floor(i / 2) + level * 16) % kinds) + 1,
      ),
      random,
      cols,
    );
  }
  function fall(board, cols = boardSize.cols, direction = "down") {
    const result = Array(board.length).fill(0),
      rows = board.length / cols;
    const vertical = direction === "up" || direction === "down";
    const lanes = vertical ? cols : rows,
      length = vertical ? rows : cols;
    for (let lane = 0; lane < lanes; lane++) {
      const index = (offset) =>
        vertical ? offset * cols + lane : lane * cols + offset;
      const values = Array.from({ length }, (_, i) => board[index(i)]).filter(
        Boolean,
      );
      const start =
        direction === "down" || direction === "right"
          ? length - values.length
          : 0;
      values.forEach((value, i) => {
        result[index(start + i)] = value;
      });
    }
    return result;
  }
  function routeInfo(path, cols = boardSize.cols, rows = boardSize.rows) {
    let turns = 0,
      previous = "";
    for (let i = 1; i < path.length; i++) {
      const direction = `${path[i][0] - path[i - 1][0]},${path[i][1] - path[i - 1][1]}`;
      if (previous && previous !== direction) turns++;
      previous = direction;
    }
    const outside = path.some(
      ([x, y]) => x === 0 || y === 0 || x === cols + 1 || y === rows + 1,
    );
    return {
      turns,
      outside,
      base: 100 + (2 - turns) * 30 + (outside ? 40 : 0),
    };
  }
  function advanceTarget(state) {
    if (state.board.some((value) => value && family(value) === state.target))
      return;
    for (let n = 1; n <= 4; n++) {
      const next = (state.target + n) % 4;
      if (state.board.some((value) => value && family(value) === next)) {
        state.target = next;
        state.targetProgress = 0;
        return;
      }
    }
  }
  function match(state, a, b, multiplier = 1) {
    if (state.phase !== "playing") return null;
    const path = route(state.board, a, b, state.cols);
    if (!path) return null;
    const info = routeInfo(path, state.cols, state.board.length / state.cols);
    const points = info.base * Math.min(5, Math.max(1, Math.floor(multiplier)));
    const matchedFamily = family(state.board[a]);
    state.board[a] = state.board[b] = 0;
    state.score += points;
    state.energy = Math.min(6, state.energy + 1);
    if (state.mode !== "zen")
      state.remaining = Math.min(240000, state.remaining + 4000);
    let completedMission = false;
    if (matchedFamily === state.target) {
      state.targetProgress++;
      if (state.targetProgress === 3) {
        completedMission = true;
        state.missions++;
        state.score += 600;
        state.energy = Math.min(6, state.energy + 2);
        if (state.mode !== "zen")
          state.remaining = Math.min(240000, state.remaining + 8000);
        state.targetProgress = 0;
        state.target = (state.target + 1) % 4;
      }
    }
    const gravity = directions[state.tideStep];
    if (state.mode === "tide") {
      state.board = fall(state.board, state.cols, gravity);
      state.tideStep = (state.tideStep + 1) % 4;
    }
    advanceTarget(state);
    if (!state.board.some(Boolean)) {
      state.score += 500;
      state.phase = state.level === 2 ? "won" : "cleared";
    }
    return { path, points, completedMission, gravity, ...info };
  }
  function swap(state, a, b) {
    if (
      state.phase !== "playing" ||
      state.energy < 3 ||
      a === b ||
      !state.board[a] ||
      !state.board[b] ||
      state.board[a] === state.board[b]
    )
      return false;
    [state.board[a], state.board[b]] = [state.board[b], state.board[a]];
    state.energy -= 3;
    return true;
  }
  function restore(value) {
    if (
      !value ||
      !["zen", "quest", "tide"].includes(value.mode) ||
      !Number.isInteger(value.level) ||
      value.level < 0 ||
      value.level > 2 ||
      !Array.isArray(value.board) ||
      value.board.some((v) => !Number.isInteger(v) || v < 0 || v > kinds) ||
      !["playing", "cleared", "won", "lost"].includes(value.phase)
    )
      return null;
    // Saves without a column count belong to the original six-column boards.
    const cols = value.cols ?? 6;
    const expected =
      cols === 6
        ? (6 + value.level * 2) * 6
        : cols === 12
          ? 96
          : boardSize.rows * boardSize.cols;
    if (
      !Number.isInteger(cols) ||
      ![6, 12, boardSize.cols].includes(cols) ||
      value.board.length !== expected
    )
      return null;
    const counts = Array(kinds + 1).fill(0);
    value.board.forEach((v) => counts[v]++);
    if (counts.slice(1).some((n) => n % 2)) return null;
    for (const [name, max] of [
      ["score", 10000000],
      ["remaining", 240000],
      ["hints", 3],
      ["shuffles", 2],
    ])
      if (
        !Number.isFinite(value[name]) ||
        value[name] < 0 ||
        value[name] > max ||
        (name !== "remaining" && !Number.isInteger(value[name]))
      )
        return null;
    const empty = !value.board.some(Boolean);
    const strategy = {
      energy: value.energy ?? 3,
      target: value.target ?? value.level % 4,
      targetProgress: value.targetProgress ?? 0,
      tideStep: value.tideStep ?? 0,
      missions: value.missions ?? 0,
    };
    for (const [name, max] of [
      ["energy", 6],
      ["target", 3],
      ["targetProgress", 2],
      ["tideStep", 3],
      ["missions", 1000],
    ])
      if (
        !Number.isInteger(strategy[name]) ||
        strategy[name] < 0 ||
        strategy[name] > max
      )
        return null;
    if (
      (value.phase === "playing" && (empty || value.remaining <= 0)) ||
      (["cleared", "won"].includes(value.phase) && !empty) ||
      (value.phase === "cleared" && value.level === 2) ||
      (value.phase === "won" && value.level !== 2)
    )
      return null;
    const restored = {
      mode: value.mode,
      level: value.level,
      cols,
      board: [...value.board],
      phase: value.phase,
      score: value.score,
      remaining: value.remaining,
      hints: value.hints,
      shuffles: value.shuffles,
      ...strategy,
    };
    advanceTarget(restored);
    return restored;
  }
  return {
    kinds,
    family,
    directions,
    size,
    route,
    routeInfo,
    find,
    shuffle,
    create,
    fall,
    match,
    swap,
    restore,
  };
})();

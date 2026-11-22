"use strict";
/** Pure geometry and replay validation. No solver is shipped to players. */
WorkTimeApp.games.klotskiRules = (() => {
  const directions = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };
  const bands = [
    [2, 10],
    [11, 20],
    [21, 40],
    [41, 60],
    [61, 80],
    [81, 1000],
  ];
  const groups = bands.flatMap((_, difficulty) => [
    { difficulty, part: 1 },
    { difficulty, part: 2 },
  ]);
  const integer = (v, max = 315360000000) =>
    Number.isSafeInteger(v) && v >= 0 && v <= max;
  const plain = (v) => v && typeof v === "object" && !Array.isArray(v);
  function valid(level, positions) {
    if (
      !Array.isArray(positions) ||
      positions.length !== 10 ||
      level.pieces.length !== 10
    )
      return false;
    const occupied = new Set();
    for (let i = 0; i < positions.length; i++) {
      const [w, h] = level.pieces[i],
        p = positions[i];
      if (!integer(p, 19) || (p % 4) + w > 4 || Math.floor(p / 4) + h > 5)
        return false;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const cell = p + x + 4 * y;
          if (occupied.has(cell)) return false;
          occupied.add(cell);
        }
    }
    return occupied.size === 18;
  }
  const won = (state) => state.positions[0] === 13;
  function create(level) {
    return {
      positions: level.pieces.map((p) => p[2]),
      path: [],
      elapsed: 0,
      started: false,
    };
  }
  function move(level, state, piece, direction) {
    const delta = directions[direction];
    if (
      !integer(piece, 9) ||
      !delta ||
      won(state) ||
      state.path.length >= 10000
    )
      return false;
    const position = state.positions[piece];
    const x = (position % 4) + delta[0],
      y = Math.floor(position / 4) + delta[1];
    const [w, h] = level.pieces[piece];
    if (x < 0 || y < 0 || x + w > 4 || y + h > 5) return false;
    const positions = [...state.positions];
    positions[piece] = x + 4 * y;
    if (!valid(level, positions)) return false;
    if (state.path.reduce((n, step) => n + step.route.length, 0) >= 100000)
      return false;
    const last = state.path.at(-1);
    if (last?.piece === piece) {
      if (last.route.length >= 10000) return false;
      last.route += direction;
    } else state.path.push({ piece, route: direction });
    state.positions = positions;
    state.started = true;
    return true;
  }
  function undo(level, state) {
    const last = state.path.pop();
    if (!last) return false;
    for (const direction of last.route) {
      const [dx, dy] = directions[direction];
      state.positions[last.piece] -= dx + 4 * dy;
    }
    return true;
  }
  function replay(level, path) {
    if (!Array.isArray(path) || path.length > 10000) return null;
    const state = create(level);
    let total = 0,
      previous = -1;
    for (const step of path) {
      if (
        !plain(step) ||
        !integer(step.piece, 9) ||
        step.piece === previous ||
        typeof step.route !== "string" ||
        !/^[lrud]+$/.test(step.route) ||
        step.route.length > 10000 ||
        (total += step.route.length) > 100000
      )
        return null;
      for (const d of step.route)
        if (!move(level, state, step.piece, d)) return null;
      previous = step.piece;
    }
    return state;
  }
  function restoreState(level, input) {
    if (
      !plain(input) ||
      !integer(input.elapsed) ||
      typeof input.started !== "boolean"
    )
      return null;
    const state = replay(level, input.path);
    if (
      !state ||
      !valid(level, input.positions) ||
      state.positions.some((v, i) => v !== input.positions[i]) ||
      (!input.started && (state.path.length || input.elapsed))
    )
      return null;
    state.elapsed = input.elapsed;
    state.started = input.started;
    return state;
  }
  function restore(input) {
    const active = WorkTimeApp.data.klotski;
    const bank = [...active, ...(WorkTimeApp.data.klotskiRetired || [])];
    const regrouped = input?.grouping === 2;
    if (
      !plain(input) ||
      input.version !== 1 ||
      !(input.grouping === undefined || regrouped) ||
      !integer(input.chapter, regrouped ? groups.length - 1 : 5) ||
      typeof input.classics !== "boolean" ||
      !plain(input.drafts) ||
      !plain(input.completed) ||
      !(input.current === null || bank.some((l) => l.id === input.current))
    )
      return null;
    const out = {
      version: 1,
      grouping: 2,
      chapter: regrouped ? input.chapter : input.chapter * 2,
      classics: input.classics,
      current: input.current,
      drafts: {},
      completed: {},
    };
    for (const kind of ["drafts", "completed"])
      for (const [id, value] of Object.entries(input[kind])) {
        const level = bank.find((l) => l.id === id),
          state = level && restoreState(level, value);
        if (!state || (kind === "completed" && !won(state))) return null;
        out[kind][id] = state;
      }
    if (
      out.current &&
      (!out.drafts[out.current] || !active.some((l) => l.id === out.current))
    )
      out.current = null;
    if (out.current)
      out.chapter = bank.find((l) => l.id === out.current).chapter;
    return out;
  }
  const better = (a, b) =>
    !b ||
    a.path.length < b.path.length ||
    (a.path.length === b.path.length && a.elapsed < b.elapsed);
  return {
    bands,
    groups,
    directions,
    valid,
    won,
    create,
    move,
    undo,
    replay,
    restoreState,
    restore,
    better,
  };
})();

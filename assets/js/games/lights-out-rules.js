"use strict";
/** Binary arrays keep all 49 cells intact; no 32-bit board masks. */
WorkTimeApp.games.lightsOutRules = (() => {
  const sizes = [4, 5, 6, 7];
  const perChapter = 25;
  const integer = (v, max = Number.MAX_SAFE_INTEGER) =>
    Number.isSafeInteger(v) && v >= 0 && v <= max;
  const plain = (v) => v && typeof v === "object" && !Array.isArray(v);
  const won = (board) => board.every((v) => v === 0);
  function neighbors(index, size) {
    const row = Math.floor(index / size),
      col = index % size;
    return [
      index,
      ...(row ? [index - size] : []),
      ...(row < size - 1 ? [index + size] : []),
      ...(col ? [index - 1] : []),
      ...(col < size - 1 ? [index + 1] : []),
    ];
  }
  function flip(board, index, size) {
    for (const cell of neighbors(index, size)) board[cell] = 1 - board[cell];
  }
  /** RREF over GF(2), followed by exact enumeration of the null space. */
  function solve(board, size) {
    const n = size * size;
    const rows = Array.from({ length: n }, (_, i) => {
      const row = Array(n + 1).fill(0);
      for (const j of neighbors(i, size)) row[j] = 1;
      row[n] = board[i];
      return row;
    });
    const pivots = [];
    for (let col = 0; col < n; col++) {
      const pivot = rows.findIndex((row, i) => i >= pivots.length && row[col]);
      if (pivot < 0) continue;
      const rank = pivots.length;
      [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
      for (let i = 0; i < n; i++) {
        if (i === rank || !rows[i][col]) continue;
        for (let j = col; j <= n; j++) rows[i][j] ^= rows[rank][j];
      }
      pivots.push(col);
    }
    if (rows.some((row) => !row.slice(0, n).some(Boolean) && row[n]))
      return null;
    const free = Array.from({ length: n }, (_, i) => i).filter(
      (i) => !pivots.includes(i),
    );
    let best = null;
    function enumerate(index, values) {
      if (index < free.length) {
        values[free[index]] = 0;
        enumerate(index + 1, values);
        values[free[index]] = 1;
        enumerate(index + 1, values);
        return;
      }
      pivots.forEach((col, i) => {
        values[col] = rows[i][n];
        for (const f of free) values[col] ^= rows[i][f] & values[f];
      });
      const path = values.flatMap((v, i) => (v ? [i] : []));
      if (!best || path.length < best.length) best = path;
    }
    enumerate(0, Array(n).fill(0));
    return best;
  }
  function create(level) {
    return {
      board: Array.from(level.board, Number),
      path: [],
      elapsed: 0,
      started: false,
    };
  }
  function move(state, index, size) {
    if (
      !integer(index, size * size - 1) ||
      won(state.board) ||
      state.path.length >= 100000
    )
      return false;
    flip(state.board, index, size);
    state.path.push(index);
    state.started = true;
    return true;
  }
  function undo(state, size) {
    if (!state.path.length) return false;
    flip(state.board, state.path.pop(), size);
    return true;
  }
  function restoreState(level, input) {
    if (
      !plain(input) ||
      !Array.isArray(input.path) ||
      input.path.length > 100000 ||
      !integer(input.elapsed, 315360000000) ||
      typeof input.started !== "boolean" ||
      (!input.started && (input.path.length || input.elapsed))
    )
      return null;
    const state = create(level);
    for (const index of input.path)
      if (!move(state, index, level.size)) return null;
    if (
      !Array.isArray(input.board) ||
      input.board.length !== state.board.length ||
      input.board.some((v, i) => v !== state.board[i]) ||
      (state.path.length && !input.started)
    )
      return null;
    state.elapsed = input.elapsed;
    state.started = input.started;
    return state;
  }
  function restore(input) {
    const levels = WorkTimeApp.data.lightsOut;
    const bank = [...levels, ...(WorkTimeApp.data.lightsOutRetired || [])];
    if (
      !plain(input) ||
      input.version !== 1 ||
      !integer(input.chapter, 4) ||
      !plain(input.drafts) ||
      !plain(input.completed) ||
      !(input.current === null || bank.some((l) => l.id === input.current))
    )
      return null;
    const out = {
      version: 1,
      chapter: Math.min(input.chapter, sizes.length - 1),
      current: levels.some((l) => l.id === input.current)
        ? input.current
        : null,
      drafts: {},
      completed: {},
    };
    for (const kind of ["drafts", "completed"]) {
      for (const [id, value] of Object.entries(input[kind])) {
        const level = bank.find((l) => l.id === id);
        const state = level && restoreState(level, value);
        if (!state || (kind === "completed" && !won(state.board))) return null;
        out[kind][id] = state;
      }
    }
    if (out.current && !out.drafts[out.current]) out.current = null;
    return out;
  }
  const better = (a, b) =>
    !b ||
    a.path.length < b.path.length ||
    (a.path.length === b.path.length && a.elapsed < b.elapsed);
  return {
    sizes,
    perChapter,
    neighbors,
    flip,
    solve,
    won,
    create,
    move,
    undo,
    restoreState,
    restore,
    better,
  };
})();

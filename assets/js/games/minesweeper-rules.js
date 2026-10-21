"use strict";
/** Immutable rules. Mine locations are chosen only on the first reveal. */
WorkTimeApp.games.minesweeperRules = (() => {
  const levels = Object.freeze({
    easy: Object.freeze({ columns: 9, rows: 9, count: 10 }),
    medium: Object.freeze({ columns: 16, rows: 16, count: 40 }),
    hard: Object.freeze({ columns: 30, rows: 16, count: 99 }),
  });
  const validIndex = (state, index) =>
    Number.isInteger(index) && index >= 0 && index < state.revealed.length;
  const active = (state) => ["ready", "playing"].includes(state.status);
  function create(difficulty = "easy") {
    if (!Object.hasOwn(levels, difficulty)) throw Error("Unknown difficulty");
    const { columns, rows } = levels[difficulty];
    return {
      difficulty,
      mines: null,
      revealed: Array(columns * rows).fill(false),
      flagged: Array(columns * rows).fill(false),
      first: -1,
      exploded: -1,
      status: "ready",
    };
  }
  function neighbors(state, index) {
    const { columns, rows } = levels[state.difficulty];
    const x = index % columns,
      y = Math.floor(index / columns),
      result = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (
          (dx || dy) &&
          x + dx >= 0 &&
          x + dx < columns &&
          y + dy >= 0 &&
          y + dy < rows
        )
          result.push((y + dy) * columns + x + dx);
    return result;
  }
  const adjacent = (state, index) =>
    neighbors(state, index).reduce(
      (sum, cell) => sum + (state.mines?.[cell] || 0),
      0,
    );
  const copy = (state) => ({
    ...state,
    revealed: state.revealed.slice(),
    flagged: state.flagged.slice(),
  });
  function plant(state, index, random) {
    const safe = new Set([index, ...neighbors(state, index)]);
    const candidates = state.revealed.flatMap((_, cell) =>
      safe.has(cell) ? [] : [cell],
    );
    const mines = Array(state.revealed.length).fill(0);
    for (let i = 0; i < levels[state.difficulty].count; i++) {
      const value = random();
      if (!Number.isFinite(value) || value < 0 || value >= 1)
        throw Error("Invalid random source");
      const target = i + Math.floor(value * (candidates.length - i));
      [candidates[i], candidates[target]] = [candidates[target], candidates[i]];
      mines[candidates[i]] = 1;
    }
    state.mines = mines;
    state.first = index;
    state.status = "playing";
  }
  function open(state, targets) {
    const next = copy(state),
      pending = targets.slice();
    while (pending.length) {
      const cell = pending.pop();
      if (next.flagged[cell] || next.revealed[cell]) continue;
      next.revealed[cell] = true;
      if (next.mines[cell]) {
        next.status = "lost";
        next.exploded = cell;
        return next;
      }
      if (!adjacent(next, cell)) pending.push(...neighbors(next, cell));
    }
    if (next.revealed.every((shown, cell) => shown || next.mines[cell]))
      next.status = "won";
    return next;
  }
  function reveal(state, index, random = Math.random) {
    if (
      !active(state) ||
      !validIndex(state, index) ||
      state.flagged[index] ||
      state.revealed[index]
    )
      return state;
    const next = copy(state);
    if (!next.mines) plant(next, index, random);
    return open(next, [index]);
  }
  function flag(state, index) {
    if (!active(state) || !validIndex(state, index) || state.revealed[index])
      return state;
    const next = copy(state);
    next.flagged[index] = !next.flagged[index];
    return next;
  }
  function chord(state, index) {
    if (
      state.status !== "playing" ||
      !validIndex(state, index) ||
      !state.revealed[index] ||
      !adjacent(state, index)
    )
      return state;
    const cells = neighbors(state, index);
    if (
      cells.filter((cell) => state.flagged[cell]).length !==
      adjacent(state, index)
    )
      return state;
    return open(state, cells);
  }
  function emptyStats() {
    return Object.fromEntries(
      Object.keys(levels).map((level) => [level, { best: null, wins: 0 }]),
    );
  }
  function restore(saved) {
    if (
      !saved ||
      saved.version !== 1 ||
      !saved.state ||
      !Object.hasOwn(levels, saved.state.difficulty)
    )
      return null;
    const state = saved.state,
      { columns, rows, count } = levels[state.difficulty];
    const size = columns * rows;
    const booleans = (values) =>
      Array.isArray(values) &&
      values.length === size &&
      values.every((value) => typeof value === "boolean");
    if (
      !booleans(state.revealed) ||
      !booleans(state.flagged) ||
      state.flagged.some((flagged, cell) => flagged && state.revealed[cell]) ||
      !["ready", "playing", "won", "lost"].includes(state.status)
    )
      return null;
    if (
      !Number.isSafeInteger(saved.elapsed) ||
      saved.elapsed < 0 ||
      typeof saved.manualPaused !== "boolean"
    )
      return null;
    if (
      !saved.stats ||
      Object.keys(levels).some((level) => {
        const record = saved.stats[level];
        return (
          !record ||
          !Number.isSafeInteger(record.wins) ||
          record.wins < 0 ||
          !(
            record.best === null ||
            (Number.isSafeInteger(record.best) && record.best >= 0)
          ) ||
          (record.wins === 0) !== (record.best === null)
        );
      })
    )
      return null;
    if (state.status === "ready") {
      if (
        state.mines !== null ||
        state.first !== -1 ||
        state.exploded !== -1 ||
        state.revealed.some(Boolean) ||
        saved.elapsed !== 0 ||
        saved.manualPaused
      )
        return null;
    } else {
      if (
        !Array.isArray(state.mines) ||
        state.mines.length !== size ||
        !state.mines.every((value) => value === 0 || value === 1) ||
        state.mines.reduce((sum, value) => sum + value, 0) !== count ||
        !validIndex(state, state.first) ||
        !state.revealed[state.first] ||
        [state.first, ...neighbors(state, state.first)].some(
          (cell) => state.mines[cell],
        )
      )
        return null;
      const hit = state.revealed.flatMap((shown, cell) =>
        shown && state.mines[cell] ? [cell] : [],
      );
      const complete = state.revealed.every(
        (shown, cell) => shown || state.mines[cell],
      );
      if (
        state.status === "lost"
          ? hit.length !== 1 || hit[0] !== state.exploded
          : hit.length || state.exploded !== -1
      )
        return null;
      if (
        (state.status === "won") !== complete ||
        (saved.manualPaused && state.status !== "playing")
      )
        return null;
    }
    // Copy only owned fields; never retain objects supplied by storage callers.
    return {
      version: 1,
      state: {
        difficulty: state.difficulty,
        mines: state.mines?.slice() || null,
        revealed: state.revealed.slice(),
        flagged: state.flagged.slice(),
        first: state.first,
        exploded: state.exploded,
        status: state.status,
      },
      elapsed: saved.elapsed,
      manualPaused: saved.manualPaused,
      stats: Object.fromEntries(
        Object.keys(levels).map((level) => [
          level,
          { best: saved.stats[level].best, wins: saved.stats[level].wins },
        ]),
      ),
    };
  }
  return Object.freeze({
    levels,
    create,
    neighbors,
    adjacent,
    reveal,
    flag,
    chord,
    restore,
    emptyStats,
  });
})();

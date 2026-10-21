"use strict";
/** Pure 2048 rules. Boards are row-major arrays; animation paths describe sources. */
WorkTimeApp.games.rules2048 = (() => {
  const directions = ["left", "right", "up", "down"];
  function move(board, direction) {
    if (!directions.includes(direction)) throw Error("Unknown 2048 direction");
    const next = Array(16).fill(0),
      paths = [];
    let gain = 0;
    for (let line = 0; line < 4; line++) {
      const indices = Array.from({ length: 4 }, (_, offset) => {
        const step =
          direction === "right" || direction === "down" ? 3 - offset : offset;
        return direction === "left" || direction === "right"
          ? line * 4 + step
          : step * 4 + line;
      });
      const sources = indices.filter((index) => board[index]);
      let target = 0;
      for (let i = 0; i < sources.length; i++) {
        const from = sources[i],
          to = indices[target++];
        const merged = board[from] === board[sources[i + 1]];
        next[to] = board[from] * (merged ? 2 : 1);
        paths.push({ from, to, value: board[from], merged });
        if (merged) {
          paths.push({ from: sources[++i], to, value: board[from], merged });
          gain += next[to];
        }
      }
    }
    return {
      board: next,
      gain,
      paths,
      changed: next.some((value, index) => value !== board[index]),
    };
  }
  function spawn(board, random = Math.random) {
    const empty = board.flatMap((value, index) => (value ? [] : [index]));
    const next = board.slice();
    if (!empty.length) return { board: next, index: -1 };
    const index = empty[Math.floor(random() * empty.length)];
    next[index] = random() < 0.9 ? 2 : 4;
    return { board: next, index };
  }
  function create(random = Math.random) {
    return {
      board: spawn(spawn(Array(16).fill(0), random).board, random).board,
      score: 0,
      continued: false,
    };
  }
  const won = (state) =>
    state.board.some((value) => value >= 2048) && !state.continued;
  const lost = (board) =>
    !board.includes(0) &&
    !directions.some((direction) => move(board, direction).changed);
  const snapshot = (state) => ({
    board: state.board.slice(),
    score: state.score,
    continued: state.continued,
  });
  function turn(state, direction, random = Math.random) {
    if (won(state) || lost(state.board)) return null;
    const result = move(state.board, direction);
    if (!result.changed) return null;
    const added = spawn(result.board, random);
    return {
      state: {
        board: added.board,
        score: state.score + result.gain,
        continued: state.continued,
      },
      previous: snapshot(state),
      paths: result.paths,
      spawned: added.index,
    };
  }
  const validNumber = (value) => Number.isSafeInteger(value) && value >= 0;
  function validState(state) {
    return (
      !!state &&
      Array.isArray(state.board) &&
      state.board.length === 16 &&
      state.board.every(
        (value) =>
          validNumber(value) &&
          (value === 0 || (value >= 2 && Number.isInteger(Math.log2(value)))),
      ) &&
      state.board.filter(Boolean).length >= 2 &&
      validNumber(state.score) &&
      typeof state.continued === "boolean" &&
      (!state.continued || state.board.some((value) => value >= 2048))
    );
  }
  function restore(value) {
    if (
      !value ||
      value.version !== 1 ||
      !validState(value.state) ||
      !validNumber(value.best) ||
      (value.previous !== null && !validState(value.previous))
    )
      return null;
    return {
      state: snapshot(value.state),
      best: Math.max(value.best, value.state.score),
      previous: value.previous && snapshot(value.previous),
    };
  }
  return { move, spawn, create, won, lost, snapshot, turn, restore };
})();

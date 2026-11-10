"use strict";
WorkTimeApp.games.slidingPuzzleRules = (() => {
  const sizes = [3, 4, 5, 6, 7];
  // Keep earlier sessions readable even when their sizes leave the menu.
  const storedSizes = [...sizes, 8, 9];
  const integer = (n) => Number.isSafeInteger(n) && n >= 0;
  const record = (value) =>
    value && typeof value === "object" && !Array.isArray(value);
  const solved = (board) => board.every((n, i) => n === (i + 1) % board.length);
  function valid(board, size) {
    return (
      Array.isArray(board) &&
      board.length === size * size &&
      new Set(board).size === board.length &&
      board.every((n) => integer(n) && n < board.length)
    );
  }
  function solvable(board, size) {
    let inversions = 0;
    for (let i = 0; i < board.length; i++)
      for (let j = i + 1; j < board.length; j++)
        if (board[i] && board[j] && board[i] > board[j]) inversions++;
    return size % 2
      ? inversions % 2 === 0
      : (inversions + size - Math.floor(board.indexOf(0) / size)) % 2 === 1;
  }
  function adjacent(a, b, size) {
    return (
      Math.abs(Math.floor(a / size) - Math.floor(b / size)) +
        Math.abs((a % size) - (b % size)) ===
      1
    );
  }
  function create(size, random = Math.random) {
    const board = Array.from({ length: size * size }, (_, i) => i);
    for (let i = board.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [board[i], board[j]] = [board[j], board[i]];
    }
    if (!solvable(board, size)) {
      const indices = board.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
      [board[indices[0]], board[indices[1]]] = [
        board[indices[1]],
        board[indices[0]],
      ];
    }
    if (solved(board))
      [board[board.length - 1], board[board.length - 2]] = [
        board[board.length - 2],
        board[board.length - 1],
      ];
    return {
      initial: [...board],
      board,
      history: [],
      elapsed: 0,
      started: false,
      awarded: false,
    };
  }
  function move(state, index, size) {
    const blank = state.board.indexOf(0);
    if (
      !integer(index) ||
      index >= state.board.length ||
      !adjacent(index, blank, size) ||
      solved(state.board)
    )
      return false;
    state.history.push(index);
    [state.board[blank], state.board[index]] = [state.board[index], 0];
    state.started = true;
    return true;
  }
  function undo(state) {
    if (!state.history.length) return false;
    state.history.pop();
    const index = state.history.at(-1) ?? state.initial.indexOf(0),
      blank = state.board.indexOf(0);
    [state.board[blank], state.board[index]] = [state.board[index], 0];
    return true;
  }
  function restart(state) {
    return {
      ...state,
      board: [...state.initial],
      history: [],
      elapsed: 0,
      started: false,
      awarded: false,
    };
  }
  function restore(input) {
    try {
      if (
        !input ||
        input.version !== 1 ||
        !storedSizes.includes(input.size) ||
        !record(input.sessions) ||
        !record(input.best) ||
        [...Object.keys(input.sessions), ...Object.keys(input.best)].some(
          (size) => !storedSizes.some((n) => String(n) === size),
        )
      )
        return null;
      const out = { version: 1, size: input.size, sessions: {}, best: {} };
      for (const size of storedSizes) {
        const state = input.sessions[size],
          best = input.best[size];
        if (best) {
          if (
            !record(best) ||
            ![best.moves, best.time].every(integer) ||
            best.moves === 0
          )
            return null;
          out.best[size] = { moves: best.moves, time: best.time };
        }
        if (!state) continue;
        if (
          !valid(state.initial, size) ||
          !valid(state.board, size) ||
          !solvable(state.initial, size) ||
          solved(state.initial) ||
          !Array.isArray(state.history) ||
          !integer(state.elapsed) ||
          typeof state.started !== "boolean" ||
          typeof state.awarded !== "boolean"
        )
          return null;
        const replay = {
          board: [...state.initial],
          history: [],
          started: false,
        };
        for (const index of state.history)
          if (!move(replay, index, size)) return null;
        if (
          replay.board.some((n, i) => n !== state.board[i]) ||
          (!state.started && (state.elapsed || state.history.length)) ||
          (solved(state.board) && !state.awarded) ||
          (state.awarded && (!state.started || !best))
        )
          return null;
        out.sessions[size] = {
          initial: [...state.initial],
          board: [...state.board],
          history: [...state.history],
          elapsed: state.elapsed,
          started: state.started,
          awarded: state.awarded,
        };
      }
      if (!out.sessions[out.size]) return null;
      return out;
    } catch {
      return null;
    }
  }
  return {
    sizes,
    solved,
    valid,
    solvable,
    adjacent,
    create,
    move,
    undo,
    restart,
    restore,
  };
})();

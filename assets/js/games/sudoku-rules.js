"use strict";
/** Pure Sudoku rules shared by the offline game, importer and verification. */
WorkTimeApp.games.sudokuRules = (() => {
  const peers = Array.from({ length: 81 }, (_, i) =>
    Array.from({ length: 81 }, (_, j) => j).filter(
      (j) =>
        j !== i &&
        (Math.floor(i / 9) === Math.floor(j / 9) ||
          i % 9 === j % 9 ||
          (Math.floor(i / 27) === Math.floor(j / 27) &&
            Math.floor((i % 9) / 3) === Math.floor((j % 9) / 3))),
    ),
  );
  function allowed(board, index, value, puzzle) {
    if (peers[index].some((j) => board[j] === value)) return false;
    const parity = puzzle.parity?.[index];
    if (parity && value % 2 !== (parity === "o" ? 1 : 0)) return false;
    for (const path of puzzle.thermos || []) {
      const position = path.indexOf(index);
      if (position < 0) continue;
      if (value < position + 1 || value > 9 - (path.length - position - 1))
        return false;
      for (let k = 0; k < path.length; k++) {
        if (!board[path[k]] || k === position) continue;
        if (k < position && value - board[path[k]] < position - k) return false;
        if (k > position && board[path[k]] - value < k - position) return false;
      }
    }
    return true;
  }
  function solve(puzzle, limit = 2) {
    const board = Array.from(puzzle.givens, Number),
      solutions = [];
    if (
      board.length !== 81 ||
      board.some(
        (n, i) =>
          !Number.isInteger(n) ||
          n < 0 ||
          n > 9 ||
          (n && !allowed(board, i, n, puzzle)),
      )
    )
      return solutions;
    function visit() {
      let index = -1,
        candidates = [];
      for (let i = 0; i < 81; i++) {
        if (board[i]) continue;
        const values = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) =>
          allowed(board, i, n, puzzle),
        );
        if (!values.length) return;
        if (index < 0 || values.length < candidates.length) {
          index = i;
          candidates = values;
        }
        if (values.length === 1) break;
      }
      if (index < 0) {
        solutions.push(board.join(""));
        return;
      }
      for (const value of candidates) {
        board[index] = value;
        visit();
        board[index] = 0;
        if (solutions.length >= limit) return;
      }
    }
    visit();
    return solutions;
  }
  const create = (puzzle) => ({
    values: Array.from(puzzle.givens, Number),
    notes: Array(81).fill(0),
    elapsed: 0,
    hints: 0,
    history: [],
  });
  function restore(puzzle, value) {
    if (
      !value ||
      !Array.isArray(value.values) ||
      value.values.length !== 81 ||
      !Array.isArray(value.notes) ||
      value.notes.length !== 81 ||
      !value.values.every(
        (n, i) =>
          Number.isInteger(n) &&
          n >= 0 &&
          n <= 9 &&
          (puzzle.givens[i] === "0" || n === Number(puzzle.givens[i])),
      ) ||
      !value.notes.every(
        (n, i) =>
          Number.isInteger(n) &&
          n >= 0 &&
          n <= 511 &&
          (!value.values[i] || n === 0),
      ) ||
      !Number.isFinite(value.elapsed) ||
      value.elapsed < 0 ||
      value.elapsed > 315360000 ||
      !Number.isInteger(value.hints) ||
      value.hints < 0 ||
      value.hints > 1000000
    )
      return null;
    return {
      values: [...value.values],
      notes: [...value.notes],
      elapsed: value.elapsed,
      hints: value.hints,
      history: [],
    };
  }
  function enter(puzzle, state, index, digit, pencil = false) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= 81 ||
      puzzle.givens[index] !== "0" ||
      !Number.isInteger(digit) ||
      digit < 0 ||
      digit > 9
    )
      return false;
    if (pencil && digit && state.values[index]) return false;
    const values = [...state.values],
      notes = [...state.notes];
    if (pencil && digit) state.notes[index] ^= 1 << (digit - 1);
    else {
      if (state.values[index] === digit && !state.notes[index]) return false;
      state.values[index] = digit;
      state.notes[index] = 0;
      if (digit)
        for (const peer of peers[index])
          state.notes[peer] &= ~(1 << (digit - 1));
    }
    state.history.push({ values, notes });
    if (state.history.length > 200) state.history.shift();
    return true;
  }
  function undo(state) {
    const previous = state.history.pop();
    if (previous) Object.assign(state, previous);
    return !!previous;
  }
  const conflicts = (puzzle, state) =>
    state.values.map((n, i) => !!n && !allowed(state.values, i, n, puzzle));
  const won = (puzzle, state) =>
    state.values.every((n, i) => n > 0 && allowed(state.values, i, n, puzzle));
  return {
    peers,
    allowed,
    solve,
    create,
    restore,
    enter,
    undo,
    conflicts,
    won,
  };
})();

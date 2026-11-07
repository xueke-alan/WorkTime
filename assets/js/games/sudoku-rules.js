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
  const skyline = Array.from({ length: 4 }, (_, side) =>
    Array.from({ length: 9 }, (_, line) =>
      Array.from({ length: 9 }, (_, step) => {
        const offset = side < 2 ? step : 8 - step;
        return side % 2 ? line * 9 + offset : offset * 9 + line;
      }),
    ),
  );
  function skyscraperAllowed(board, index, value, side, line, clue) {
    const heights = skyline[side][line].map((i) =>
      i === index ? value : board[i],
    );
    let tallestMissing = 9;
    while (heights.includes(tallestMissing)) tallestMissing--;
    let low = tallestMissing === 9 ? 1 : 0,
      high = 0,
      gap = false,
      fixedMaximum = 0;
    for (const height of heights) {
      if (!height) gap = true;
      // A fixed record above every possible earlier height must be visible.
      if (height > fixedMaximum && (!gap || height > tallestMissing)) low++;
      // A gap can add at most one building above the fixed skyline.
      if ((height || tallestMissing) > fixedMaximum) high++;
      fixedMaximum = Math.max(fixedMaximum, height);
    }
    return clue >= low && clue <= high;
  }
  const peerCache = new WeakMap();
  function puzzlePeers(puzzle) {
    if (!puzzle.regions && !puzzle.antiKnight) return peers;
    if (!peerCache.has(puzzle))
      peerCache.set(
        puzzle,
        Array.from({ length: 81 }, (_, i) =>
          Array.from({ length: 81 }, (_, j) => j).filter(
            (j) =>
              j !== i &&
              ((puzzle.regions
                ? Math.floor(i / 9) === Math.floor(j / 9) ||
                  i % 9 === j % 9 ||
                  puzzle.regions[i] === puzzle.regions[j]
                : peers[i].includes(j)) ||
                (puzzle.antiKnight &&
                  Math.abs(Math.floor(i / 9) - Math.floor(j / 9)) *
                    Math.abs((i % 9) - (j % 9)) ===
                    2)),
          ),
        ),
      );
    return peerCache.get(puzzle);
  }
  function sumPossible(values, target, distinct) {
    const fixed = values.filter(Boolean),
      empty = values.length - fixed.length;
    if (distinct && new Set(fixed).size !== fixed.length) return false;
    const remaining = target - fixed.reduce((a, b) => a + b, 0);
    if (!empty) return remaining === 0;
    if (!distinct) return remaining >= empty && remaining <= empty * 9;
    const choices = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(
      (n) => !fixed.includes(n),
    );
    function choose(start, count, total) {
      if (!count) return total === 0;
      for (let k = start; k <= choices.length - count; k++) {
        if (choices[k] > total) break;
        if (choose(k + 1, count - 1, total - choices[k])) return true;
      }
      return false;
    }
    return choose(0, empty, remaining);
  }
  function sandwichAllowed(values, clue) {
    const one = values.indexOf(1),
      nine = values.indexOf(9);
    // Test every still-possible position of the two crust digits.
    for (let a = 0; a < 9; a++) {
      if (one >= 0 ? a !== one : values[a]) continue;
      for (let b = 0; b < 9; b++) {
        if (a === b || (nine >= 0 ? b !== nine : values[b])) continue;
        const inside = values.slice(Math.min(a, b) + 1, Math.max(a, b));
        const fixed = inside.filter(Boolean),
          missing = inside.length - fixed.length;
        const available = [2, 3, 4, 5, 6, 7, 8].filter(
          (n) => !values.includes(n),
        );
        const rest = clue - fixed.reduce((x, y) => x + y, 0);
        if (
          available.length >= missing &&
          rest >= available.slice(0, missing).reduce((x, y) => x + y, 0) &&
          rest <=
            (missing ? available.slice(-missing).reduce((x, y) => x + y, 0) : 0)
        )
          return true;
      }
    }
    return false;
  }
  function allowed(board, index, value, puzzle) {
    if (puzzlePeers(puzzle)[index].some((j) => board[j] === value))
      return false;
    const read = (i) => (i === index ? value : board[i]);
    for (const cage of puzzle.cages || [])
      if (
        cage.cells.includes(index) &&
        !sumPossible(cage.cells.map(read), cage.sum, true)
      )
        return false;
    for (const arrow of puzzle.arrows || []) {
      if (arrow.circle !== index && !arrow.cells.includes(index)) continue;
      const total = read(arrow.circle);
      const values = arrow.cells.map(read);
      if (
        total
          ? !sumPossible(values, total, false)
          : values.reduce((a, b) => a + b, 0) +
              values.filter((n) => !n).length >
            9
      )
        return false;
    }
    for (const path of puzzle.whispers || []) {
      const at = path.indexOf(index);
      if (at < 0) continue;
      for (const j of [path[at - 1], path[at + 1]])
        if (j !== undefined && read(j) && Math.abs(value - read(j)) < 5)
          return false;
    }
    for (const path of puzzle.renbans || []) {
      if (!path.includes(index)) continue;
      const digits = path.map(read).filter(Boolean);
      if (
        new Set(digits).size !== digits.length ||
        Math.max(...digits) - Math.min(...digits) >= path.length
      )
        return false;
    }
    for (const dot of puzzle.kropki || []) {
      if (!dot.cells.includes(index)) continue;
      const [a, b] = dot.cells.map(read);
      if (
        a &&
        b &&
        (dot.kind === "white"
          ? Math.abs(a - b) !== 1
          : Math.max(a, b) !== 2 * Math.min(a, b))
      )
        return false;
    }
    if (puzzle.xsums) {
      for (let side = 0; side < 2; side++) {
        const line = side ? Math.floor(index / 9) : index % 9;
        const clue = puzzle.xsums[side][line];
        if (clue === null) continue;
        const values = skyline[side][line].map(read);
        const lengths = values[0] ? [values[0]] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
        if (
          !lengths.some((n) =>
            sumPossible([n, ...values.slice(1, n)], clue, true),
          )
        )
          return false;
      }
    }
    if (puzzle.sandwich) {
      for (let side = 0; side < 2; side++) {
        const line = side ? Math.floor(index / 9) : index % 9;
        const clue = puzzle.sandwich[side][line];
        if (
          clue !== null &&
          !sandwichAllowed(skyline[side][line].map(read), clue)
        )
          return false;
      }
    }
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
    if (puzzle.skyscrapers) {
      for (let side = 0; side < 4; side++) {
        const line = side % 2 ? Math.floor(index / 9) : index % 9;
        const clue = puzzle.skyscrapers[side][line];
        if (clue && !skyscraperAllowed(board, index, value, side, line, clue))
          return false;
      }
    }
    return true;
  }
  function solve(puzzle, limit = 2, maxNodes = Infinity) {
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
    let nodes = 0;
    function visit() {
      if (++nodes > maxNodes) throw Error("Sudoku search limit exceeded");
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
        for (const peer of puzzlePeers(puzzle)[index])
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
  const replayLimit = 2048;
  const editsPerCell = 19;
  const undoEdit = 81 * editsPerCell;
  function startReplay(puzzle, state) {
    const replay = { moves: "" };
    if (state.values.join("") !== puzzle.givens || state.notes.some(Boolean))
      replay.base = { values: [...state.values], notes: [...state.notes] };
    return replay;
  }
  function recordEdit(replay, index, digit, pencil) {
    if (!replay || replay.moves.length >= replayLimit * 3) return null;
    // Three base-36 characters encode a cell and an edit, or the undo marker.
    const edit =
      index === undefined
        ? undoEdit
        : index * editsPerCell + digit + (pencil && digit ? 9 : 0);
    replay.moves += edit.toString(36).padStart(3, "0");
    return replay;
  }
  function replayStart(puzzle, replay) {
    return replay.base
      ? restore(puzzle, { ...replay.base, elapsed: 0, hints: 0 })
      : create(puzzle);
  }
  function replayStep(puzzle, state, moves, step) {
    const edit = parseInt(moves.slice(step * 3, step * 3 + 3), 36);
    if (edit === undoEdit) return undo(state);
    const action = edit % editsPerCell;
    const pencil = action > 9;
    return enter(
      puzzle,
      state,
      Math.floor(edit / editsPerCell),
      pencil ? action - 9 : action,
      pencil,
    );
  }
  function restoreReplay(puzzle, replay, draft) {
    if (
      !replay ||
      typeof replay.moves !== "string" ||
      replay.moves.length > replayLimit * 3 ||
      replay.moves.length % 3 ||
      /[^0-9a-z]/.test(replay.moves) ||
      (!draft &&
        (!replay.moves.length ||
          !Number.isSafeInteger(replay.finishedAt) ||
          replay.finishedAt <= 0))
    )
      return null;
    const state = replayStart(puzzle, replay);
    if (!state) return null;
    const clean = startReplay(puzzle, state);
    for (let step = 0; step < replay.moves.length / 3; step++) {
      if (won(puzzle, state) || !replayStep(puzzle, state, replay.moves, step))
        return null;
    }
    if (
      draft
        ? state.values.some((value, i) => value !== draft.values[i]) ||
          state.notes.some((note, i) => note !== draft.notes[i])
        : !won(puzzle, state)
    )
      return null;
    clean.moves = replay.moves;
    if (!draft) clean.finishedAt = replay.finishedAt;
    return clean;
  }
  return {
    peers,
    puzzlePeers,
    allowed,
    solve,
    create,
    restore,
    enter,
    undo,
    conflicts,
    won,
    startReplay,
    recordEdit,
    replayStart,
    replayStep,
    restoreReplay,
  };
})();

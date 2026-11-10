"use strict";

// Authoritative referee and version-1 save replay; AI runs in jungle-engine.js.
WorkTimeApp.games.createJungleRules = function () {
  const columns = 7,
    rows = 9;
  const dens = [3, 59];
  const traps = [
    [2, 4, 10],
    [52, 58, 60],
  ];
  const rank = (piece) => Math.abs(piece);
  const side = (piece) => Math.sign(piece);
  const water = (p) => p >= 21 && p < 42 && [1, 2, 4, 5].includes(p % 7);
  const key = (board, turn) => board.join(",") + ":" + turn;
  function initial() {
    const board = Array(63).fill(0);
    // Blue is at the top, red at the bottom; red moves first.
    for (const [p, animal] of [
      [0, 6],
      [6, 7],
      [8, 2],
      [12, 3],
      [14, 8],
      [16, 4],
      [18, 5],
      [20, 1],
    ]) {
      board[p] = -animal;
      board[62 - p] = animal;
    }
    return board;
  }
  function canCapture(board, from, to) {
    const a = board[from],
      b = board[to];
    if (!b) return true;
    if (side(a) === side(b) || water(from) !== water(to)) return false;
    const enemyTrap = traps[side(a) === 1 ? 0 : 1].includes(from);
    const captive = traps[side(a) === 1 ? 1 : 0].includes(to);
    if (captive) return true;
    if (enemyTrap) return false;
    if (rank(a) === 1 && rank(b) === 8) return true;
    if (rank(a) === 8 && rank(b) === 1) return false;
    return rank(a) >= rank(b);
  }
  function legal(board, turn) {
    const moves = [];
    for (let from = 0; from < 63; from++) {
      if (side(board[from]) !== turn) continue;
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ]) {
        let x = (from % 7) + dx,
          y = Math.floor(from / 7) + dy;
        if (x < 0 || x >= 7 || y < 0 || y >= 9) continue;
        let to = y * 7 + x;
        if (water(to) && [6, 7].includes(rank(board[from]))) {
          let blocked = false;
          while (water(to)) {
            if (board[to]) blocked = true;
            x += dx;
            y += dy;
            to = y * 7 + x;
          }
          if (blocked) continue;
        } else if (water(to) && rank(board[from]) !== 1) continue;
        if (to === dens[turn === 1 ? 1 : 0]) continue;
        if (canCapture(board, from, to)) moves.push([from, to]);
      }
    }
    return moves;
  }
  function apply(board, [from, to]) {
    const next = board.slice();
    next[to] = next[from];
    next[from] = 0;
    return next;
  }
  function create() {
    const board = initial();
    return {
      board,
      turn: 1,
      path: [],
      quiet: 0,
      positions: [key(board, 1)],
      status: "playing",
      winner: 0,
    };
  }
  function move(state, from, to) {
    if (
      state.status !== "playing" ||
      !legal(state.board, state.turn).some((m) => m[0] === from && m[1] === to)
    )
      return null;
    const board = apply(state.board, [from, to]);
    const turn = -state.turn,
      quiet = state.board[to] ? 0 : state.quiet + 1;
    const position = key(board, turn),
      positions = [...state.positions, position];
    const won =
      to === dens[state.turn === 1 ? 0 : 1] || !legal(board, turn).length;
    const draw =
      !won &&
      (quiet >= 100 || positions.filter((p) => p === position).length >= 3);
    return {
      board,
      turn,
      path: [...state.path, [from, to]],
      quiet,
      positions,
      status: won ? "won" : draw ? "draw" : "playing",
      winner: won ? state.turn : 0,
    };
  }
  function restore(input) {
    if (
      !input ||
      input.version !== 1 ||
      !["ai", "local"].includes(input.state?.mode) ||
      !["easy", "normal", "hard"].includes(input.state.difficulty) ||
      ![1, -1].includes(input.state.human) ||
      !Array.isArray(input.state.path) ||
      input.state.path.length > 4096
    )
      return null;
    let state = create();
    for (const step of input.state.path) {
      if (
        !Array.isArray(step) ||
        step.length !== 2 ||
        !step.every((p) => Number.isInteger(p) && p >= 0 && p < 63)
      )
        return null;
      state = move(state, ...step);
      if (!state) return null;
    }
    return {
      version: 1,
      state: {
        mode: input.state.mode,
        difficulty: input.state.difficulty,
        human: input.state.human,
        path: state.path,
      },
    };
  }
  function replay(path) {
    return path.reduce(
      (state, [from, to]) => state && move(state, from, to),
      create(),
    );
  }
  return {
    columns,
    rows,
    dens,
    traps,
    water,
    initial,
    legal,
    apply,
    create,
    move,
    restore,
    replay,
  };
};
WorkTimeApp.games.jungleRules = WorkTimeApp.games.createJungleRules();

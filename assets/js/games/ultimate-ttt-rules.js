"use strict";

WorkTimeApp.games.ultimateTttRules = (() => {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  const winner = (cells) => {
    for (const [a, b, c] of lines)
      if (
        Math.abs(cells[a]) === 1 &&
        cells[a] === cells[b] &&
        cells[b] === cells[c]
      )
        return cells[a];
    return 0;
  };
  function create(chain = false) {
    return {
      board: Array(81).fill(0),
      regions: Array(9).fill(0),
      turn: 1,
      target: -1,
      chain,
      status: "playing",
      winner: 0,
      reason: "",
      path: [],
      cleared: [],
    };
  }
  function legal(state) {
    if (state.status !== "playing") return [];
    const moves = [];
    for (let i = 0; i < 81; i++) {
      const region = Math.floor(i / 9);
      if (
        !state.board[i] &&
        !state.regions[region] &&
        (state.target === -1 || state.target === region)
      )
        moves.push(i);
    }
    return moves;
  }
  function counts(state) {
    return [
      state.regions.filter((n) => n === 1).length,
      state.regions.filter((n) => n === -1).length,
    ];
  }
  function move(state, index, history = true) {
    if (!Number.isInteger(index) || !legal(state).includes(index)) return null;
    const next = {
      ...state,
      board: state.board.slice(),
      regions: state.regions.slice(),
      path: history ? [...state.path, index] : [],
      cleared: [],
      turn: -state.turn,
    };
    next.board[index] = state.turn;
    const region = Math.floor(index / 9);
    const small = next.board.slice(region * 9, region * 9 + 9);
    const captured = winner(small);
    next.regions[region] = captured || (small.every(Boolean) ? 2 : 0);
    next.winner = winner(next.regions);
    if (next.winner) {
      next.status = "won";
      next.reason = "line";
      return next;
    }
    if (captured && next.chain) {
      for (let r = 0; r < 9; r++) {
        if (Math.abs(next.regions[r]) === 1) continue;
        next.regions[r] = 0;
        for (let p = r * 9; p < r * 9 + 9; p++) {
          if (next.board[p]) next.cleared.push(p);
          next.board[p] = 0;
        }
      }
    }
    next.target = next.regions[index % 9] ? -1 : index % 9;
    if (!legal(next).length) {
      const [x, o] = counts(next);
      next.winner = Math.sign(x - o);
      next.status = next.winner ? "won" : "draw";
      next.reason = "territory";
    }
    return next;
  }
  function lockedResult(state) {
    if (state.status !== "playing") return null;
    const [x, o] = counts(state);
    const leader = Math.sign(x - o);
    // A drawn region can reopen when a later capture clears the board.
    const contestable = (owner) => owner === 0 || (state.chain && owner === 2);
    if (
      Math.abs(x - o) > state.regions.filter(contestable).length &&
      !lines.some((line) =>
        line.every(
          (r) => state.regions[r] === -leader || contestable(state.regions[r]),
        ),
      )
    )
      return leader;

    const openCells = state.board.filter(
      (piece, p) => !piece && !state.regions[Math.floor(p / 9)],
    ).length;
    if (openCells > 12) return null;

    let remaining = 3000;
    function solve(position) {
      if (remaining-- <= 0) return null;
      if (position.status !== "playing") return position.winner;
      let result;
      for (const p of legal(position)) {
        const outcome = solve(move(position, p, false));
        if (outcome === null || (result !== undefined && result !== outcome))
          return null;
        result = outcome;
      }
      return result ?? null;
    }
    return solve(state);
  }
  function replay(path, chain = false) {
    // At most nine captures, each clearing at most 81 cells: 810 is a safe upper bound.
    if (!Array.isArray(path) || path.length > 810 || typeof chain !== "boolean")
      return null;
    let state = create(chain);
    for (const index of path) {
      state = move(state, index);
      if (!state) return null;
    }
    return state;
  }
  function restore(input) {
    const s = input?.state;
    if (
      input?.version !== 1 ||
      !s ||
      !["ai", "local"].includes(s.mode) ||
      !["easy", "normal", "hard"].includes(s.difficulty) ||
      ![1, -1].includes(s.human) ||
      typeof s.chain !== "boolean" ||
      !replay(s.path, s.chain)
    )
      return null;
    return {
      version: 1,
      state: {
        mode: s.mode,
        difficulty: s.difficulty,
        human: s.human,
        chain: s.chain,
        path: s.path.slice(),
      },
    };
  }
  const flat = (p) => {
    const r = Math.floor(p / 9),
      c = p % 9;
    return (
      (Math.floor(r / 3) * 3 + Math.floor(c / 3)) * 9 + (r % 3) * 3 + (c % 3)
    );
  };
  function encode(state) {
    const input = new Float32Array(324);
    input.fill(state.turn, 162, 243);
    state.board.forEach((piece, p) => {
      if (piece) input[flat(p) + (piece === state.turn ? 0 : 81)] = 1;
    });
    for (const p of legal(state)) input[243 + flat(p)] = 1;
    return input;
  }
  return {
    create,
    legal,
    move,
    lockedResult,
    replay,
    restore,
    counts,
    lines,
    winner,
    flat,
    encode,
  };
})();

"use strict";
/** Freestyle Gomoku. Positions and replay paths contain no UI state. */
WorkTimeApp.games.gomokuRules = (() => {
  const size = 15;
  const lines = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [-1, 1],
      ]) {
        if (x + dx * 4 < 0 || x + dx * 4 >= size || y + dy * 4 >= size)
          continue;
        lines.push(
          Array.from({ length: 5 }, (_, n) => (y + dy * n) * size + x + dx * n),
        );
      }
  function winningLine(board, side) {
    return lines.find((line) => line.every((p) => board[p] === side)) ?? [];
  }
  function threats(board, side) {
    const result = new Set();
    for (const line of lines) {
      let count = 0,
        empty = -1;
      for (const p of line) {
        if (board[p] === side) count++;
        else if (!board[p]) empty = p;
        else break;
      }
      if (count === 4 && empty !== -1) result.add(empty);
    }
    return [...result];
  }
  function candidates(board) {
    const result = new Set();
    board.forEach((stone, p) => {
      if (!stone) return;
      const x = p % size,
        y = Math.floor(p / size);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx,
            yy = y + dy;
          const q = yy * size + xx;
          if (xx >= 0 && xx < size && yy >= 0 && yy < size && !board[q])
            result.add(q);
        }
    });
    return [...result];
  }
  // Complete test for winning within two attacking moves, against every reply.
  function winInTwo(board, side = 1) {
    const wins = threats(board, side);
    if (wins.length) return wins[0];
    const enemy = threats(board, 3 - side);
    if (enemy.length > 1) return null;
    for (const p of enemy.length ? enemy : candidates(board)) {
      board[p] = side;
      const forced = threats(board, side).length >= 2;
      board[p] = 0;
      if (forced) return p;
    }
    return null;
  }
  function score(board, p, side) {
    let total = 0;
    for (const line of lines) {
      if (!line.includes(p)) continue;
      let own = 0,
        other = 0;
      for (const q of line) {
        if (board[q] === side) own++;
        else if (board[q]) other++;
      }
      if (!other) total += [0, 2, 18, 160, 20000, 100000][own];
      if (!own) total += [0, 1, 15, 180, 22000, 100000][other];
    }
    return total;
  }
  function reply(board, remaining) {
    const wins = threats(board, 2);
    if (wins.length) return wins[0];
    const blocks = threats(board, 1);
    if (blocks.length) return blocks[0];
    const own = winInTwo(board, 2);
    if (own !== null) return own;
    const choices = candidates(board).sort(
      (a, b) => score(board, b, 2) - score(board, a, 2) || a - b,
    );
    // Prefer a defense that actually refutes a two-move attack, if one exists.
    if (remaining >= 2 && winInTwo(board, 1) !== null) {
      for (const p of choices) {
        board[p] = 2;
        const safe = winInTwo(board, 1) === null;
        board[p] = 0;
        if (safe) return p;
      }
    }
    return choices[0] ?? board.indexOf(0);
  }
  function create(level) {
    return { board: [...level.board], status: "playing", path: [], line: [] };
  }
  function move(level, state, p) {
    if (
      state.status !== "playing" ||
      !Number.isInteger(p) ||
      p < 0 ||
      p >= size * size ||
      state.board[p]
    )
      return null;
    const board = [...state.board],
      path = [...state.path, p];
    board[p] = 1;
    let line = winningLine(board, 1);
    if (line.length) return { board, path, status: "won", line };
    const white = level.vct
      ? vctReply(level, board, path)
      : reply(board, level.goal - Math.ceil(path.length / 2));
    if (white < 0) return { board, path, status: "draw", line: [] };
    board[white] = 2;
    path.push(white);
    line = winningLine(board, 2);
    return {
      board,
      path,
      status: line.length ? "lost" : board.includes(0) ? "playing" : "draw",
      line,
    };
  }
  function restore(level, path) {
    if (
      !Array.isArray(path) ||
      path.length > level.board.filter((s) => !s).length
    )
      return null;
    if (level.vct) {
      const state = create(level);
      for (let i = 0; i < path.length; i++) {
        const p = path[i],
          side = (i % 2) + 1;
        if (
          state.status !== "playing" ||
          !Number.isInteger(p) ||
          p < 0 ||
          p >= 225 ||
          state.board[p]
        )
          return null;
        state.board[p] = side;
        state.path.push(p);
        state.line = winningLine(state.board, side);
        if (state.line.length) state.status = side === 1 ? "won" : "lost";
        else if (!state.board.includes(0)) state.status = "draw";
      }
      if (state.status === "playing" && path.length % 2) {
        // Earlier saves stopped before White's reply at the old move limit.
        if (path.length !== level.goal * 2 - 1) return null;
        return move(level, restore(level, path.slice(0, -1)), path.at(-1));
      }
      return state;
    }
    let state = create(level);
    for (let n = 0; n < path.length;) {
      const next = move(level, state, path[n]);
      if (
        next &&
        n === path.length - 1 &&
        path.length === level.goal * 2 - 1 &&
        next.path.length === path.length + 1 &&
        path.every((p, i) => next.path[i] === p)
      )
        return next;
      if (
        !next ||
        next.path.some((p, i) => p !== path[i]) ||
        next.path.length > path.length
      )
        return null;
      state = next;
      n = next.path.length;
    }
    return state;
  }
  function vctReply(level, board, path) {
    const wins = threats(board, 2);
    if (wins.length) return wins[0];
    const blocks = threats(board, 1);
    if (blocks.length) return blocks[0];
    if (path.every((p, i) => p === level.solution[i]))
      return level.solution[path.length];
    // Off the principal variation, probe promising defenses with a bounded
    // search so an exploratory move cannot stall the offline UI.
    const remaining = Math.max(2, level.goal - Math.ceil(path.length / 2));
    const search = WorkTimeApp.games.gomokuSearch;
    const pos = new search.Position(board);
    const double = pos.doubles();
    const choices = candidates(board)
      .map((p) => ({
        p,
        value: score(board, p, 2) + (double.includes(p) ? 1000 : 0),
      }))
      .sort((a, b) => b.value - a.value || a.p - b.p);
    let hardest = null,
      unresolved = null;
    for (const { p } of choices.slice(0, 4)) {
      board[p] = 2;
      const result = search.solve(board, remaining, { budget: 120 });
      board[p] = 0;
      if (!result.result && !result.cutoff) return p;
      if (result.cutoff) unresolved ??= p;
      if (result.result && (!hardest || result.result.depth > hardest.depth))
        hardest = { p, depth: result.result.depth };
    }
    return unresolved ?? hardest?.p ?? choices[0]?.p ?? board.indexOf(0);
  }
  return {
    restoreMatch(input) {
      if (
        !input ||
        !["normal", "hard", "master"].includes(input.difficulty) ||
        ![1, 2].includes(input.human) ||
        !Array.isArray(input.path) ||
        input.path.length > 225
      )
        return null;
      const state = {
        board: Array(225).fill(0),
        path: [],
        status: "playing",
        line: [],
      };
      for (const p of input.path) {
        if (
          state.status !== "playing" ||
          !Number.isInteger(p) ||
          p < 0 ||
          p >= 225 ||
          state.board[p]
        )
          return null;
        const side = (state.path.length % 2) + 1;
        state.board[p] = side;
        state.path.push(p);
        state.line = winningLine(state.board, side);
        if (state.line.length)
          state.status = side === input.human ? "won" : "lost";
        else if (state.path.length === 225) state.status = "draw";
      }
      return state;
    },
    size,
    winningLine,
    threats,
    candidates,
    winInTwo,
    reply,
    create,
    move,
    restore,
  };
})();

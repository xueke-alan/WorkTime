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
      (value.aiBest !== undefined && !validNumber(value.aiBest)) ||
      (value.aiDemo != null &&
        (!validState(value.aiDemo.state) ||
          !validNumber(value.aiDemo.steps))) ||
      (value.previous !== null && !validState(value.previous))
    )
      return null;
    return {
      state: snapshot(value.state),
      best: Math.max(value.best, value.state.score),
      aiBest: value.aiBest || 0,
      aiDemo: value.aiDemo
        ? { state: snapshot(value.aiDemo.state), steps: value.aiDemo.steps }
        : null,
      previous: value.previous && snapshot(value.previous),
    };
  }
  // Evaluation weights follow nneonneo/2048-ai (MIT; licenses/2048-ai.txt).
  // Row heuristics favor empty cells, merge opportunities and monotone edges.
  // Cached row moves keep the deeper expectimax search cheap enough for playback.
  let rowScores, rowMoves;
  const lines = directions.map((direction) =>
    Array.from({ length: 4 }, (_, line) =>
      Array.from({ length: 4 }, (_, offset) => {
        const step =
          direction === "right" || direction === "down" ? 3 - offset : offset;
        return direction === "left" || direction === "right"
          ? line * 4 + step
          : step * 4 + line;
      }),
    ),
  );
  function slideRow(row) {
    const filled = row.filter(Boolean),
      next = [];
    for (let i = 0; i < filled.length; i++) {
      if (filled[i] === filled[i + 1]) {
        next.push(filled[i] + 1);
        i++;
      } else next.push(filled[i]);
    }
    while (next.length < 4) next.push(0);
    return next;
  }
  function scoreRow(row) {
    let empty = 0,
      merges = 0,
      sum = 0,
      increasing = 0,
      decreasing = 0,
      last = 0;
    for (let i = 0; i < 4; i++) {
      const rank = row[i];
      sum += rank ** 3.5;
      if (!rank) empty++;
      else {
        if (last === rank) merges++;
        last = rank;
      }
      if (i < 3) {
        const delta = rank ** 4 - row[i + 1] ** 4;
        if (delta > 0) decreasing += delta;
        else increasing -= delta;
      }
    }
    return (
      200000 +
      empty * 270 +
      merges * 700 -
      Math.min(increasing, decreasing) * 47 -
      sum * 11
    );
  }
  function prepareSearch() {
    if (rowScores) return;
    rowScores = new Float64Array(65536);
    rowMoves = new Uint32Array(65536);
    for (let code = 0; code < 65536; code++) {
      const row = [
        code & 15,
        (code >>> 4) & 15,
        (code >>> 8) & 15,
        code >>> 12,
      ];
      rowScores[code] = scoreRow(row);
      const next = slideRow(row);
      rowMoves[code] =
        next[0] | (next[1] << 5) | (next[2] << 10) | (next[3] << 15);
    }
  }
  function searchMove(board, direction) {
    const next = Array(16).fill(0);
    let changed = false;
    for (const indices of lines[direction]) {
      const row = [
        board[indices[0]],
        board[indices[1]],
        board[indices[2]],
        board[indices[3]],
      ];
      let shifted;
      if ((row[0] | row[1] | row[2] | row[3]) < 16) {
        const packed =
          rowMoves[row[0] | (row[1] << 4) | (row[2] << 8) | (row[3] << 12)];
        shifted = [
          packed & 31,
          (packed >>> 5) & 31,
          (packed >>> 10) & 31,
          (packed >>> 15) & 31,
        ];
      } else shifted = slideRow(row);
      for (let i = 0; i < 4; i++) {
        next[indices[i]] = shifted[i];
        if (shifted[i] !== row[i]) changed = true;
      }
    }
    return changed ? next : null;
  }
  function evaluateBoard(board) {
    let total = 0;
    for (let i = 0; i < 4; i++) {
      total += rowScore(
        board[i * 4],
        board[i * 4 + 1],
        board[i * 4 + 2],
        board[i * 4 + 3],
      );
      total += rowScore(board[i], board[i + 4], board[i + 8], board[i + 12]);
    }
    return total;
  }
  function rowScore(a, b, c, d) {
    return (a | b | c | d) < 16
      ? rowScores[a | (b << 4) | (c << 8) | (d << 12)]
      : scoreRow([a, b, c, d]);
  }
  function chooseMove(board) {
    prepareSearch();
    const ranks = board.map((value) => (value ? Math.log2(value) : 0));
    const emptyCount = ranks.filter((value) => !value).length;
    const depth = emptyCount >= 7 ? 2 : 3;
    const cache = new Map();
    function player(values, remaining, probability) {
      if (remaining === 0 || probability < 0.0001) return evaluateBoard(values);
      let best = -Infinity;
      for (let direction = 0; direction < 4; direction++) {
        const next = searchMove(values, direction);
        if (next)
          best = Math.max(best, chance(next, remaining - 1, probability));
      }
      return best === -Infinity ? -10000000 : best;
    }
    function chance(values, remaining, probability) {
      if (remaining === 0) return evaluateBoard(values);
      const key =
        values.join(",") +
        ":" +
        remaining +
        ":" +
        Math.floor(Math.log10(probability));
      if (cache.has(key)) return cache.get(key);
      const empty = values.flatMap((value, index) => (value ? [] : [index]));
      if (!empty.length) return player(values, remaining, probability);
      let total = 0;
      for (const index of empty) {
        for (const [rank, weight] of [
          [1, 0.9],
          [2, 0.1],
        ]) {
          values[index] = rank;
          total +=
            (weight *
              player(
                values,
                remaining,
                (probability * weight) / empty.length,
              )) /
            empty.length;
        }
        values[index] = 0;
      }
      cache.set(key, total);
      return total;
    }
    let best = -Infinity,
      chosen = null;
    for (let direction = 0; direction < 4; direction++) {
      const next = searchMove(ranks, direction);
      if (!next) continue;
      const value = chance(next, depth, 1);
      if (value > best) {
        best = value;
        chosen = directions[direction];
      }
    }
    return chosen;
  }
  return {
    move,
    spawn,
    create,
    won,
    lost,
    snapshot,
    turn,
    restore,
    chooseMove,
  };
})();

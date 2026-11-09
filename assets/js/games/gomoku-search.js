WorkTimeApp.games.gomokuSearch = (() => {
  "use strict";
  // Exact AND/OR search over forcing threes and fours. All defender replies are
  // considered at a three; a four has exactly one mandatory block (unless won).
  const lines = [],
    around = Array.from({ length: 225 }, () => []);
  for (let y = 0; y < 15; y++)
    for (let x = 0; x < 15; x++)
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [-1, 1],
      ]) {
        if (x + dx * 4 < 0 || x + dx * 4 >= 15 || y + dy * 4 >= 15) continue;
        const line = Array.from(
          { length: 5 },
          (_, n) => (y + dy * n) * 15 + x + dx * n,
        );
        const i = lines.length;
        lines.push(line);
        for (const p of line) around[p].push(i);
      }
  class Position {
    constructor(board) {
      this.board = [...board];
      this.a = new Int8Array(lines.length);
      this.b = new Int8Array(lines.length);
      for (let i = 0; i < lines.length; i++)
        for (const p of lines[i]) {
          if (board[p] === 1) this.a[i]++;
          if (board[p] === 2) this.b[i]++;
        }
    }
    put(p, s) {
      this.board[p] = s;
      for (const i of around[p]) (s === 1 ? this.a : this.b)[i]++;
    }
    pop(p) {
      const s = this.board[p];
      for (const i of around[p]) (s === 1 ? this.a : this.b)[i]--;
      this.board[p] = 0;
    }
    wins(s) {
      const a = s === 1 ? this.a : this.b,
        b = s === 1 ? this.b : this.a,
        out = new Set();
      for (let i = 0; i < lines.length; i++)
        if (a[i] === 4 && !b[i])
          for (const p of lines[i]) if (!this.board[p]) out.add(p);
      return [...out];
    }
    moves() {
      const out = new Set();
      for (let i = 0; i < lines.length; i++)
        if (this.a[i] >= 2 && !this.b[i])
          for (const p of lines[i]) if (!this.board[p]) out.add(p);
      return [...out];
    }
    doubles() {
      const out = [];
      for (const p of this.moves()) {
        this.put(p, 1);
        if (this.wins(1).length >= 2) out.push(p);
        this.pop(p);
      }
      return out;
    }
  }
  function solve(
    board,
    depth,
    { budget = 50000, first = null, foursOnly = false } = {},
  ) {
    const pos = new Position(board),
      memo = new Map();
    let nodes = 0,
      cutoff = false;
    function visit(left) {
      if (++nodes > budget) {
        cutoff = true;
        return null;
      }
      const win = pos.wins(1);
      if (win.length)
        return { move: win[0], depth: 1, pv: [win[0]], threes: 0, branches: 0 };
      if (left < 2) return null;
      const enemy = pos.wins(2);
      if (enemy.length > 1) return null;
      const key = pos.board.join("") + left;
      if (memo.has(key)) return memo.get(key);
      const moves = enemy.length ? enemy : pos.moves();
      // Fours first, then threes. No non-threatening development moves admitted.
      const options = [];
      for (const p of moves) {
        pos.put(p, 1);
        const wins = pos.wins(1);
        const danger = pos.wins(2);
        let doubles = [];
        if (!foursOnly && !wins.length && !danger.length && left >= 3)
          doubles = pos.doubles();
        pos.pop(p);
        if (!danger.length && (wins.length || doubles.length))
          options.push({ p, wins, doubles });
      }
      options.sort(
        (a, b) =>
          b.wins.length - a.wins.length ||
          b.doubles.length - a.doubles.length ||
          a.p - b.p,
      );
      if (first !== null && left === depth)
        options.sort((a, b) => Number(b.p === first) - Number(a.p === first));
      for (const { p, wins, doubles } of options) {
        pos.put(p, 1);
        if (wins.length >= 2) {
          pos.pop(p);
          const result = {
            move: p,
            depth: 2,
            pv: [p, wins[0], wins[1]],
            threes: 0,
            branches: 0,
          };
          memo.set(key, result);
          return result;
        }
        const defenses = wins.length
          ? wins
          : Array.from({ length: 225 }, (_, i) => i).filter(
              (i) => !pos.board[i],
            );
        if (!wins.length)
          defenses.sort(
            (a, b) =>
              Number(doubles.includes(b)) - Number(doubles.includes(a)) ||
              a - b,
          );
        let worst = null,
          ok = true;
        for (const q of defenses) {
          pos.put(q, 2);
          const child = visit(left - 1);
          pos.pop(q);
          if (!child) {
            ok = false;
            break;
          }
          if (!worst || child.depth > worst.child.depth) worst = { q, child };
        }
        pos.pop(p);
        if (ok && worst) {
          const child = worst.child;
          const result = {
            move: p,
            depth: child.depth + 1,
            pv: [p, worst.q, ...child.pv],
            threes: child.threes + Number(!wins.length),
            branches: Math.max(
              child.branches,
              wins.length ? 1 : defenses.length,
            ),
          };
          memo.set(key, result);
          return result;
        }
        if (cutoff) break;
      }
      memo.set(key, null);
      return null;
    }
    const result = visit(depth);
    return { result, nodes, cutoff };
  }
  return { solve, Position, lines, around };
})();

// Self-contained so the same engine can run in an offline Blob worker.
WorkTimeApp.games.gomokuAI = function chooseMove(input, side, difficulty) {
  "use strict";
  const board = [...input],
    enemy = 3 - side;
  const lines = [],
    around = Array.from({ length: 225 }, () => []);
  for (let y = 0; y < 15; y++)
    for (let x = 0; x < 15; x++)
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [-1, 1],
      ]) {
        if (x + 4 * dx < 0 || x + 4 * dx >= 15 || y + 4 * dy >= 15) continue;
        const line = Array.from(
          { length: 5 },
          (_, n) => (y + n * dy) * 15 + x + n * dx,
        );
        const i = lines.length;
        lines.push(line);
        for (const p of line) around[p].push(i);
      }
  const counts = [
    null,
    new Int8Array(lines.length),
    new Int8Array(lines.length),
  ];
  for (let i = 0; i < lines.length; i++)
    for (const p of lines[i]) if (board[p]) counts[board[p]][i]++;
  function put(p, s) {
    board[p] = s;
    for (const i of around[p]) counts[s][i]++;
  }
  function pop(p) {
    for (const i of around[p]) counts[board[p]][i]--;
    board[p] = 0;
  }
  function wins(s) {
    const out = new Set();
    for (let i = 0; i < lines.length; i++)
      if (counts[s][i] === 4 && !counts[3 - s][i])
        for (const p of lines[i]) if (!board[p]) out.add(p);
    return [...out];
  }
  const weights = [0, 3, 35, 550, 35000, 10000000];
  function value(p, s) {
    let score = 0;
    for (const i of around[p]) {
      if (!counts[3 - s][i]) score += weights[counts[s][i] + 1];
      if (!counts[s][i]) score += weights[counts[3 - s][i] + 1] * 0.95;
    }
    return score;
  }
  function moves(s, limit) {
    const win = wins(s);
    if (win.length) return win;
    const block = wins(3 - s);
    if (block.length) return block;
    const set = new Set();
    board.forEach((stone, p) => {
      if (stone)
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const x = (p % 15) + dx,
              y = Math.floor(p / 15) + dy,
              q = y * 15 + x;
            if (x >= 0 && x < 15 && y >= 0 && y < 15 && !board[q]) set.add(q);
          }
    });
    return [...set]
      .sort(
        (a, b) =>
          value(b, s) - value(a, s) ||
          Math.abs((a % 15) - 7) +
            Math.abs(Math.floor(a / 15) - 7) -
            Math.abs((b % 15) - 7) -
            Math.abs(Math.floor(b / 15) - 7) ||
          a - b,
      )
      .slice(0, limit);
  }
  if (!board.some(Boolean)) return 112;
  const immediate = wins(side);
  if (immediate.length) return immediate[0];
  const defense = wins(enemy);
  if (defense.length) return defense[0];
  const options = moves(side, 18);
  if (!options.length) return -1;
  if (difficulty === "normal") return options[0];
  const deadline = Date.now() + (difficulty === "master" ? 2200 : 450);
  let nodes = 0;
  const timeout = {};
  function check() {
    if ((++nodes & 63) === 0 && Date.now() > deadline) throw timeout;
  }
  // VCF: a four forces its unique block; two winning points prove a kill.
  function forcing(s, depth) {
    check();
    const win = wins(s);
    if (win.length) return win[0];
    if (depth <= 0 || wins(3 - s).length > 1) return -1;
    for (const p of moves(s, 20)) {
      put(p, s);
      const threats = wins(s),
        danger = wins(3 - s);
      let result = -1;
      if (!danger.length && threats.length > 1) result = p;
      else if (!danger.length && threats.length === 1) {
        put(threats[0], 3 - s);
        try {
          if (forcing(s, depth - 1) >= 0) result = p;
        } finally {
          pop(threats[0]);
        }
      }
      pop(p);
      if (result >= 0) return result;
    }
    return -1;
  }
  function evaluate(s) {
    let score = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!counts[3 - s][i]) score += weights[counts[s][i]];
      if (!counts[s][i]) score -= weights[counts[3 - s][i]] * 1.1;
    }
    return score;
  }
  const cache = new Map();
  function search(s, depth, alpha, beta) {
    check();
    if (wins(s).length) return 9000000 + depth;
    if (wins(3 - s).length > 1) return -9000000 - depth;
    if (!board.includes(0)) return 0;
    if (!depth) return evaluate(s);
    const key = board.join("") + s + ":" + depth;
    if (cache.has(key)) return cache.get(key);
    let best = -Infinity,
      cut = false;
    for (const p of moves(s, depth > 2 ? 10 : 7)) {
      put(p, s);
      let score;
      try {
        score = -search(3 - s, depth - 1, -beta, -alpha);
      } finally {
        pop(p);
      }
      best = Math.max(best, score);
      alpha = Math.max(alpha, score);
      if (alpha >= beta) {
        cut = true;
        break;
      }
    }
    // Cache only exact values: fail-low and cutoff scores are bounds.
    if (!cut && best > arguments[2]) cache.set(key, best);
    return best;
  }
  let best = options[0];
  try {
    if (difficulty === "master") {
      const kill = forcing(side, 5);
      if (kill >= 0) return kill;
      const danger = forcing(enemy, 4);
      if (danger >= 0) {
        for (const p of options) {
          put(p, side);
          let safe;
          try {
            safe = forcing(enemy, 4) < 0;
          } finally {
            pop(p);
          }
          if (safe) {
            best = p;
            break;
          }
        }
        options.splice(options.indexOf(best), 1);
        options.unshift(best);
      }
    }
    for (let depth = 1; depth <= (difficulty === "master" ? 7 : 3); depth++) {
      let iteration = best,
        score = -Infinity;
      for (const p of [best, ...options.filter((p) => p !== best)]) {
        put(p, side);
        let candidate;
        try {
          candidate = -search(enemy, depth - 1, -Infinity, -score);
        } finally {
          pop(p);
        }
        if (candidate > score) {
          score = candidate;
          iteration = p;
        }
      }
      best = iteration;
      if (score > 8000000) break;
    }
  } catch (error) {
    if (error !== timeout) throw error;
  }
  return best;
};

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

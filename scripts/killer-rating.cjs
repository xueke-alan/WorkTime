"use strict";
// Deterministic CSP rating, not a human or competition difficulty grade.
const units = [];
for (let n = 0; n < 9; n++) {
  units.push(Array.from({ length: 9 }, (_, j) => n * 9 + j));
  units.push(Array.from({ length: 9 }, (_, j) => j * 9 + n));
  units.push(
    Array.from(
      { length: 9 },
      (_, j) =>
        (Math.floor(n / 3) * 3 + Math.floor(j / 3)) * 9 + (n % 3) * 3 + (j % 3),
    ),
  );
}
const bitLists = Array.from({ length: 512 }, (_, mask) =>
  Array.from({ length: 9 }, (_, i) => 1 << i).filter((b) => mask & b),
);
const bits = (mask) => bitLists[mask];
const digit = (bit) => Math.log2(bit) + 1;
const single = (m) => m && !(m & (m - 1));
function constraints(p) {
  const result = p.cages.map((c) => ({ ...c, distinct: true }));
  // 45 rule: subtract wholly internal cages (innies), or a covering union (outies).
  for (const u of units) {
    const inside = p.cages.filter((c) => c.cells.every((i) => u.includes(i)));
    const cells = u.filter((i) => !inside.some((c) => c.cells.includes(i)));
    if (cells.length && cells.length <= 5)
      result.push({
        cells,
        sum: 45 - inside.reduce((s, c) => s + c.sum, 0),
        distinct: true,
      });
    const touching = p.cages.filter((c) => c.cells.some((i) => u.includes(i)));
    const outside = touching
      .flatMap((c) => c.cells)
      .filter((i) => !u.includes(i));
    if (outside.length && outside.length <= 4)
      result.push({
        cells: outside,
        sum: touching.reduce((s, c) => s + c.sum, 0) - 45,
        distinct: false,
      });
  }
  return result.map((c) => ({
    ...c,
    conflicts: c.cells.map((i, k) =>
      c.cells
        .slice(0, k)
        .map((j, n) =>
          units.some((u) => u.includes(i) && u.includes(j)) ? n : -1,
        )
        .filter((n) => n >= 0),
    ),
  }));
}
function propagate(m, sums) {
  let changed = true;
  const restrict = (i, mask) => {
    const v = m[i] & mask;
    if (v !== m[i]) {
      m[i] = v;
      changed = true;
    }
    return !!v;
  };
  while (changed) {
    changed = false;
    for (const u of units) {
      let fixed = 0;
      for (const i of u)
        if (single(m[i])) {
          if (fixed & m[i]) return false;
          fixed |= m[i];
        }
      for (const i of u)
        if (!single(m[i]) && !restrict(i, 511 ^ fixed)) return false;
      for (let b = 1; b <= 256; b *= 2) {
        const places = u.filter((i) => m[i] & b);
        if (!places.length) return false;
        if (places.length === 1 && !restrict(places[0], b)) return false;
      }
      // Naked pairs/triples.
      for (const i of u) {
        const mask = m[i],
          size = bits(mask).length;
        if (size < 2 || size > 3) continue;
        const subset = u.filter((j) => (m[j] | mask) === mask);
        if (subset.length > size) return false;
        if (subset.length === size)
          for (const j of u)
            if (!subset.includes(j) && !restrict(j, 511 ^ mask)) return false;
      }
    }
    for (const c of sums) {
      const support = c.cells.map(() => 0),
        chosen = [];
      let found = false;
      function visit(k, rest, used) {
        if (k === c.cells.length) {
          if (rest) return;
          found = true;
          chosen.forEach((b, j) => (support[j] |= b));
          return;
        }
        let min = 0,
          max = 0;
        for (let j = k; j < c.cells.length; j++) {
          const values = bits(m[c.cells[j]] & (c.distinct ? 511 ^ used : 511));
          if (!values.length) return;
          min += digit(values[0]);
          max += digit(values.at(-1));
        }
        if (rest < min || rest > max) return;
        for (const b of bits(m[c.cells[k]] & (c.distinct ? 511 ^ used : 511))) {
          // Even outies respect shared row/column/box peers.
          if (!c.distinct && c.conflicts[k].some((j) => chosen[j] === b))
            continue;
          chosen[k] = b;
          visit(k + 1, rest - digit(b), used | b);
          chosen.length = k;
        }
      }
      visit(0, c.sum, 0);
      if (!found) return false;
      for (let j = 0; j < c.cells.length; j++)
        if (!restrict(c.cells[j], support[j])) return false;
    }
  }
  return true;
}
function rate(p, maxNodes = 20000) {
  const sums = constraints(p),
    m = Array.from(p.givens, (n) => (+n ? 1 << (+n - 1) : 511));
  const stats = { nodes: 0, branches: 0, backtracks: 0, depth: 0 };
  const solutions = [];
  const valid = propagate(m, sums);
  const logicalFilled = m.filter(single).length;
  function search(masks, depth) {
    if (++stats.nodes > maxNodes) throw Error("Killer rating search limit");
    stats.depth = Math.max(stats.depth, depth);
    if (!propagate(masks, sums)) {
      stats.backtracks++;
      return;
    }
    let index = -1,
      size = 10;
    masks.forEach((mask, i) => {
      const n = bits(mask).length;
      if (n > 1 && n < size) {
        index = i;
        size = n;
      }
    });
    if (index < 0) {
      solutions.push(masks.map(digit).join(""));
      return;
    }
    stats.branches++;
    for (const b of bits(masks[index])) {
      const next = [...masks];
      next[index] = b;
      search(next, depth + 1);
      if (solutions.length >= 2) return;
    }
  }
  if (valid) search(m, 0);
  return {
    givens: p.givens.replace(/0/g, "").length,
    singleCages: p.cages.filter((c) => c.cells.length === 1).length,
    logicalFilled,
    remaining: 81 - logicalFilled,
    ...stats,
    score: stats.branches + stats.backtracks + stats.depth * 5,
    solutions,
  };
}
function signature(p) {
  // Canonical cage geometry under all eight square symmetries; digit relabeling cannot bypass this.
  return Array.from({ length: 8 }, (_, t) =>
    p.cages
      .map((c) =>
        c.cells
          .map((i) => {
            let r = Math.floor(i / 9),
              col = i % 9;
            if (t >= 4) col = 8 - col;
            for (let k = 0; k < t % 4; k++) [r, col] = [col, 8 - r];
            return r * 9 + col;
          })
          .sort((a, b) => a - b)
          .join(","),
      )
      .sort()
      .join(";"),
  ).sort()[0];
}
module.exports = { rate, signature };

"use strict";
/** Offline bank utilities. Search is bounded and does not claim optimality. */
function originals(text) {
  const parts = text.split(/^;[ \t]*(\d+)[^\r\n]*\r?\n/m);
  const maps = new Map();
  for (let i = 1; i < parts.length; i += 2)
    maps.set(
      Number(parts[i]),
      parts[i + 1]
        .split(/\r?\n/)
        .filter((row) => row.includes("#"))
        .map((row) => row.trimEnd()),
    );
  return maps;
}
function signature(rows) {
  let grid = rows.map((row) => [
    ...row.padEnd(Math.max(...rows.map((r) => r.length)), " "),
  ]);
  const variants = [];
  for (let turn = 0; turn < 4; turn++) {
    for (const mirrored of [grid, grid.map((row) => [...row].reverse())]) {
      const occupied = mirrored.flatMap((row, y) =>
        row.flatMap((v, x) => (v === " " ? [] : [[x, y]])),
      );
      const left = Math.min(...occupied.map(([x]) => x)),
        right = Math.max(...occupied.map(([x]) => x));
      const top = Math.min(...occupied.map(([, y]) => y)),
        bottom = Math.max(...occupied.map(([, y]) => y));
      variants.push(
        mirrored
          .slice(top, bottom + 1)
          .map((row) => row.slice(left, right + 1).join(""))
          .join("\n"),
      );
    }
    grid = grid[0].map((_, x) => grid.map((row) => row[x]).reverse());
  }
  return variants.sort()[0];
}
function solveAdvanced(map, rules, maxNodes = 100000, timeout = 2000) {
  const offsets = Object.entries(rules.directions).map(([d, [x, y]]) => [
    d,
    x + y * map.width,
  ]);
  const distances = new Map();
  for (const goal of map.goals) {
    const dist = new Map([[goal, 0]]),
      pending = [goal];
    for (let i = 0; i < pending.length; i++)
      for (const [, delta] of offsets) {
        const b = pending[i] - delta;
        if (map.floors.has(b) && map.floors.has(b - delta) && !dist.has(b)) {
          dist.set(b, dist.get(pending[i]) + 1);
          pending.push(b);
        }
      }
    distances.set(goal, dist);
  }
  const minDistance = new Map(
    [...map.floors].map((b) => [
      b,
      Math.min(...[...distances.values()].map((d) => d.get(b) ?? Infinity)),
    ]),
  );
  // Minimum-cost box/goal matching prevents several boxes from all chasing
  // the same goal. Reverse-push distances also reject unreachable assignments.
  const goalDistances = [...distances.values()];
  const matchingCache = new Map();
  function matching(boxes) {
    const key = [...boxes].sort((a, b) => a - b).join(",");
    if (matchingCache.has(key)) return matchingCache.get(key);
    const n = boxes.length,
      u = new Float64Array(n + 1),
      v = new Float64Array(n + 1),
      p = new Int32Array(n + 1),
      way = new Int32Array(n + 1);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      const best = new Float64Array(n + 1).fill(Infinity),
        used = new Uint8Array(n + 1);
      let j0 = 0;
      do {
        used[j0] = 1;
        const i0 = p[j0];
        let delta = Infinity,
          j1 = 0;
        for (let j = 1; j <= n; j++)
          if (!used[j]) {
            const cost =
              (goalDistances[j - 1].get(boxes[i0 - 1]) ?? 1000000) -
              u[i0] -
              v[j];
            if (cost < best[j]) {
              best[j] = cost;
              way[j] = j0;
            }
            if (best[j] < delta) {
              delta = best[j];
              j1 = j;
            }
          }
        for (let j = 0; j <= n; j++) {
          if (used[j]) {
            u[p[j]] += delta;
            v[j] -= delta;
          } else best[j] -= delta;
        }
        j0 = j1;
      } while (p[j0]);
      do {
        const j1 = way[j0];
        p[j0] = p[j1];
        j0 = j1;
      } while (j0);
    }
    const value = -v[0] >= 1000000 ? Infinity : -v[0];
    matchingCache.set(key, value);
    return value;
  }
  const heap = [],
    seen = new Map(),
    start = Date.now();
  function add(v) {
    heap.push(v);
    let i = heap.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p].score <= v.score) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = v;
  }
  function pop() {
    const top = heap[0],
      tail = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let c = i * 2 + 1;
        if (c + 1 < heap.length && heap[c + 1].score < heap[c].score) c++;
        if (heap[c].score >= tail.score) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = tail;
    }
    return top;
  }
  add({
    player: map.player,
    boxes: [...map.boxes],
    pushes: 0,
    parent: null,
    segment: "",
    score: 0,
  });
  let nodes = 0;
  while (heap.length && nodes < maxNodes && Date.now() - start < timeout) {
    const cur = pop();
    if (cur.boxes.every((b) => map.goals.has(b))) {
      let solution = "",
        step = cur;
      while (step.parent) {
        solution = step.segment + solution;
        step = step.parent;
      }
      return { solution, solutionPushes: cur.pushes, searchNodes: nodes };
    }
    const paths = new Map([[cur.player, ""]]),
      pending = [cur.player],
      boxes = new Set(cur.boxes);
    for (let i = 0; i < pending.length; i++)
      for (const [d, delta] of offsets) {
        const next = pending[i] + delta;
        if (map.floors.has(next) && !boxes.has(next) && !paths.has(next)) {
          paths.set(next, paths.get(pending[i]) + d);
          pending.push(next);
        }
      }
    const key =
      [...boxes].sort((a, b) => a - b).join(",") + ":" + Math.min(...pending);
    if ((seen.get(key) ?? Infinity) <= cur.pushes) continue;
    seen.set(key, cur.pushes);
    nodes++;
    for (const box of boxes)
      for (const [d, delta] of offsets) {
        const dest = box + delta;
        if (
          !paths.has(box - delta) ||
          boxes.has(dest) ||
          !Number.isFinite(minDistance.get(dest))
        )
          continue;
        const next = cur.boxes.map((b) => (b === box ? dest : b));
        if (rules.deadlocked(map, { history: [{ player: box, boxes: next }] }))
          continue;
        const h = matching(next);
        if (!Number.isFinite(h)) continue;
        add({
          player: box,
          boxes: next,
          pushes: cur.pushes + 1,
          parent: cur,
          segment: paths.get(box - delta) + d,
          score: cur.pushes + 1 + 3 * h,
        });
      }
  }
  return null;
}
/** Same replay-based rubric for every source; not an author's rating. */
function assess(level, rules) {
  const map = rules.parse(level),
    state = rules.create();
  let boxSwitches = 0,
    goalWithdrawals = 0,
    previousBox = -1;
  for (const direction of level.solution) {
    const before = rules.position(map, state);
    if (!rules.move(map, state, direction))
      throw Error("Invalid solution: " + level.id);
    const after = rules.position(map, state);
    if (after.pushes > before.pushes) {
      const box = before.boxes.findIndex(
        (position, index) => position !== after.boxes[index],
      );
      if (previousBox >= 0 && box !== previousBox) boxSwitches++;
      if (map.goals.has(before.boxes[box]) && !map.goals.has(after.boxes[box]))
        goalWithdrawals++;
      previousBox = box;
    }
  }
  if (!rules.won(map, state)) throw Error("Unsolved replay: " + level.id);
  const metrics = {
    pushes: state.pushes,
    boxSwitches,
    goalWithdrawals,
    boxes: map.boxes.length,
  };
  return {
    metrics,
    score:
      metrics.pushes +
      3 * boxSwitches +
      12 * goalWithdrawals +
      5 * map.boxes.length,
  };
}
module.exports = { originals, signature, solveAdvanced, assess };

"use strict";
// Exact A* over pushes. Walking paths are shortest paths for each push;
// moves retain the exact player cell, pushes merge reachable player regions.
// A budget expiry yields null, never an unproven optimum.
function optimal(map, metric, { milliseconds = 1000, maxNodes = 150000 } = {}) {
  const offsets = [
    ["u", -map.width],
    ["r", 1],
    ["d", map.width],
    ["l", -1],
  ];
  const distance = new Map(),
    goalDistances = [];
  for (const goal of map.goals) {
    const distances = new Map();
    goalDistances.push(distances);
    const queue = [[goal, 0]],
      seen = new Set([goal]);
    for (let i = 0; i < queue.length; i++) {
      const [cell, cost] = queue[i];
      distances.set(cell, cost);
      distance.set(cell, Math.min(distance.get(cell) ?? Infinity, cost));
      for (const [, delta] of offsets) {
        const next = cell - delta;
        if (
          map.floors.has(next) &&
          map.floors.has(next - delta) &&
          !seen.has(next)
        ) {
          seen.add(next);
          queue.push([next, cost + 1]);
        }
      }
    }
  }
  // Minimum-cost one-to-one box/goal matching (Hungarian algorithm).
  // Reverse-push distances ignore other boxes, so this is an admissible bound.
  const estimates = new Map();
  function heuristic(boxes) {
    const key = boxes.join(",");
    if (estimates.has(key)) return estimates.get(key);
    const n = boxes.length,
      u = new Float64Array(n + 1),
      v = new Float64Array(n + 1),
      p = new Int32Array(n + 1),
      way = new Int32Array(n + 1);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Float64Array(n + 1).fill(Infinity),
        used = new Uint8Array(n + 1);
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
            if (cost < minv[j]) {
              minv[j] = cost;
              way[j] = j0;
            }
            if (minv[j] < delta) {
              delta = minv[j];
              j1 = j;
            }
          }
        for (let j = 0; j <= n; j++) {
          if (used[j]) {
            u[p[j]] += delta;
            v[j] -= delta;
          } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0]);
      do {
        const j1 = way[j0];
        p[j0] = p[j1];
        j0 = j1;
      } while (j0);
    }
    const result = -v[0] >= 1000000 ? Infinity : -v[0];
    if (estimates.size < 500000) estimates.set(key, result);
    return result;
  }
  const heap = [],
    best = new Map(),
    started = Date.now();
  function add(node) {
    // Record tentative costs before queueing to avoid duplicate heap entries.
    if (metric === "moves") {
      const key = node.boxes.join(",") + ":" + node.player;
      if ((best.get(key) ?? Infinity) <= node.cost) return;
      best.set(key, node.cost);
    }
    let i = heap.length;
    heap.push(node);
    while (i) {
      const parent = (i - 1) >> 1;
      if (heap[parent].score <= node.score) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = node;
  }
  function pop() {
    const head = heap[0],
      tail = heap.pop();
    if (heap.length) {
      let i = 0;
      while (2 * i + 1 < heap.length) {
        let child = 2 * i + 1;
        if (
          child + 1 < heap.length &&
          heap[child + 1].score < heap[child].score
        )
          child++;
        if (heap[child].score >= tail.score) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = tail;
    }
    return head;
  }
  add({
    player: map.player,
    boxes: [...map.boxes].sort((a, b) => a - b),
    cost: 0,
    score: heuristic(map.boxes),
    parent: null,
    segment: "",
  });
  let nodes = 0;
  while (heap.length) {
    if (++nodes > maxNodes || Date.now() - started > milliseconds) return null;
    const cur = pop();
    const paths = new Map([[cur.player, ""]]),
      queue = [cur.player];
    for (let i = 0; i < queue.length; i++)
      for (const [direction, delta] of offsets) {
        const next = queue[i] + delta;
        if (
          map.floors.has(next) &&
          !cur.boxes.includes(next) &&
          !paths.has(next)
        ) {
          paths.set(next, paths.get(queue[i]) + direction);
          queue.push(next);
        }
      }
    const key =
      cur.boxes.join(",") +
      ":" +
      (metric === "moves" ? cur.player : Math.min(...queue));
    if (metric === "moves") {
      if (best.get(key) < cur.cost) continue;
    } else {
      if ((best.get(key) ?? Infinity) <= cur.cost) continue;
      best.set(key, cur.cost);
    }
    if (cur.boxes.every((b) => map.goals.has(b))) {
      let path = "",
        node = cur;
      while (node.parent) {
        path = node.segment + path;
        node = node.parent;
      }
      return { value: cur.cost, path };
    }
    for (const box of cur.boxes)
      for (const [direction, delta] of offsets) {
        const dest = box + delta;
        if (
          !paths.has(box - delta) ||
          !map.floors.has(dest) ||
          cur.boxes.includes(dest) ||
          !distance.has(dest)
        )
          continue;
        const boxes = cur.boxes
          .map((b) => (b === box ? dest : b))
          .sort((a, b) => a - b);
        // A filled 2x2 square cannot release any of its boxes.
        let dead = false;
        for (const dx of [-1, 1])
          for (const dy of [-map.width, map.width]) {
            const cells = [dest, dest + dx, dest + dy, dest + dx + dy];
            if (
              cells.every((c) => !map.floors.has(c) || boxes.includes(c)) &&
              cells.some((c) => boxes.includes(c) && !map.goals.has(c))
            )
              dead = true;
          }
        if (dead) continue;
        const bound = heuristic(boxes);
        if (!Number.isFinite(bound)) continue;
        const segment = paths.get(box - delta) + direction;
        const cost = cur.cost + (metric === "moves" ? segment.length : 1);
        add({
          player: box,
          boxes,
          cost,
          score: cost + bound,
          parent: cur,
          segment,
        });
      }
  }
  return null;
}
module.exports = { optimal };

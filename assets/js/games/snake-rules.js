"use strict";
/** Fixed grid simulation; rendering and wall-clock time never affect the rules. */
WorkTimeApp.games.snakeRules = (() => {
  const size = 20;
  const columns = 24,
    rows = 20;
  const vectors = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
  const modes = { classic: 150, wrap: 150, rush: 100 };
  const same = (a, b) => a?.x === b?.x && a?.y === b?.y;
  function neighbors(state, cell) {
    const width = state.columns || size,
      height = state.rows || size;
    return Object.values(vectors)
      .map(([dx, dy]) => {
        const x = cell.x + dx,
          y = cell.y + dy;
        return state.mode === "wrap"
          ? { x: (x + width) % width, y: (y + height) % height }
          : { x, y };
      })
      .filter((p) => p.x >= 0 && p.x < width && p.y >= 0 && p.y < height);
  }
  /** Conservative current-body reachability; the moving tail is a fallback. */
  function candidates(state, avoid = []) {
    const width = state.columns || size,
      height = state.rows || size;
    const id = (p) => p.y * width + p.x;
    const occupied = new Set(state.body.map(id));
    function flood(freeTail) {
      const blocked = new Set(
        state.body.slice(1, freeTail ? -1 : undefined).map(id),
      );
      const distance = new Map([[id(state.body[0]), 0]]),
        queue = [state.body[0]];
      for (let i = 0; i < queue.length; i++) {
        const cell = queue[i],
          d = distance.get(id(cell));
        for (const next of neighbors(state, cell)) {
          if (!d) {
            const [dx, dy] = vectors[state.direction];
            const behind = neighbors(state, cell).find((p) =>
              same(p, state.body[1]),
            );
            if (
              same(next, behind) ||
              (state.mode !== "wrap" &&
                next.x === cell.x - dx &&
                next.y === cell.y - dy)
            )
              continue;
          }
          if (blocked.has(id(next)) || distance.has(id(next))) continue;
          distance.set(id(next), d + 1);
          queue.push(next);
        }
      }
      return distance;
    }
    let distance = flood(false);
    const free = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const p = { x, y };
        if (!occupied.has(id(p)) && !avoid.some((other) => same(other, p)))
          free.push({ ...p, distance: distance.get(id(p)) });
      }
    let reachable = free.filter((p) => p.distance !== undefined);
    if (!reachable.length) {
      distance = flood(true);
      for (const cell of free) cell.distance = distance.get(id(cell));
      reachable = free.filter((p) => p.distance !== undefined);
    }
    let pool = reachable.length ? reachable : free;
    const areas = new Map();
    for (const start of free) {
      if (areas.has(id(start))) continue;
      const region = [start];
      areas.set(id(start), 0);
      for (let i = 0; i < region.length; i++)
        for (const next of neighbors(state, region[i])) {
          if (occupied.has(id(next)) || areas.has(id(next))) continue;
          areas.set(id(next), 0);
          region.push(next);
        }
      for (const part of region) areas.set(id(part), region.length);
    }
    const spacious = pool.filter(
      (p) => areas.get(id(p)) >= state.body.length + 2,
    );
    if (spacious.length) pool = spacious;
    const open = pool.filter(
      (p) =>
        neighbors(state, p).filter((n) => !occupied.has(id(n))).length >= 2,
    );
    return open.length ? open : pool;
  }
  function choose(state, avoid = [], random = Math.random, separate = null) {
    let pool = candidates(state, avoid);
    const room = pool.filter((p) => p.distance >= 3);
    if (room.length) pool = room;
    if (separate) {
      const spaced = pool.filter((p) => {
        let dx = Math.abs(p.x - separate.x),
          dy = Math.abs(p.y - separate.y);
        if (state.mode === "wrap") {
          dx = Math.min(dx, state.columns - dx);
          dy = Math.min(dy, state.rows - dy);
        }
        return dx + dy >= 4;
      });
      if (spaced.length) pool = spaced;
    }
    const p =
      pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
    return p ? { x: p.x, y: p.y } : null;
  }
  function refreshFood(state, random) {
    state.food = choose(state, [state.bonus], random);
    if (!state.food && state.bonus) {
      state.bonus = null;
      state.food = choose(state, [], random);
    }
    state.alternative = choose(
      state,
      [state.food, state.bonus],
      random,
      state.food,
    );
    if (!state.food) {
      state.status = "won";
      state.bonus = null;
    }
  }
  function create(mode = "classic", random = Math.random) {
    if (!Object.hasOwn(modes, mode)) mode = "classic";
    const body = [9, 8, 7, 6].map((x) => ({ x, y: 10 }));
    const state = {
      mode,
      columns,
      rows,
      body,
      direction: "right",
      food: null,
      alternative: null,
      combo: 0,
      bonus: null,
      score: 0,
      eaten: 0,
      ticks: 0,
      status: "ready",
    };
    refreshFood(state, random);
    return state;
  }
  function canTurn(from, to) {
    return (
      Object.hasOwn(vectors, to) &&
      Object.hasOwn(vectors, from) &&
      vectors[from][0] * vectors[to][0] + vectors[from][1] * vectors[to][1] ===
        0
    );
  }
  const interval = (state) =>
    Math.round(
      1.08 *
        Math.max(
          state.mode === "rush" ? 62 : 78,
          modes[state.mode] - Math.floor(state.eaten / 4) * 7,
        ),
    );
  function step(input, direction = input.direction, random = Math.random) {
    if (input.status !== "playing") return input;
    const state = JSON.parse(JSON.stringify(input));
    const width = state.columns || size,
      height = state.rows || size;
    if (canTurn(state.direction, direction)) state.direction = direction;
    const [dx, dy] = vectors[state.direction];
    const head = { x: state.body[0].x + dx, y: state.body[0].y + dy };
    state.ticks++;
    if (state.mode === "wrap") {
      head.x = (head.x + width) % width;
      head.y = (head.y + height) % height;
    }
    const eating = same(head, state.food) || same(head, state.alternative);
    if (
      head.x < 0 ||
      head.x >= width ||
      head.y < 0 ||
      head.y >= height ||
      state.body
        .slice(0, eating ? undefined : -1)
        .some((part) => same(part, head))
    ) {
      state.status = "lost";
      return state;
    }
    state.body.unshift(head);
    if (!eating) state.body.pop();
    if (state.bonus && same(head, state.bonus)) {
      state.combo = Math.min(5, (state.combo || 0) + 1);
      state.score += 50 * state.combo;
      state.bonus = null;
    }
    if (state.bonus && --state.bonus.ttl <= 0) {
      state.bonus = null;
      state.combo = 0;
    }
    if (eating) {
      state.score += 10;
      state.eaten++;
      refreshFood(state, random);
      if (state.status !== "won" && state.eaten % 5 === 0 && !state.bonus) {
        const avoid = [state.food, state.alternative];
        const pool = candidates(state, avoid).filter(
          (p) => p.distance !== undefined,
        );
        if (pool.length) {
          const cell =
            pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
          const duration = Math.max(65, cell.distance + 16);
          state.bonus = { x: cell.x, y: cell.y, ttl: duration, duration };
        }
      }
    }
    return state;
  }
  function restore(save) {
    if (!save || save.version !== 1) return null;
    const s = save.state;
    const width = s?.columns ?? size,
      height = s?.rows ?? size;
    if (![size, columns].includes(width) || height !== rows) return null;
    const cell = (p) =>
      p &&
      Number.isInteger(p.x) &&
      Number.isInteger(p.y) &&
      p.x >= 0 &&
      p.x < width &&
      p.y >= 0 &&
      p.y < height;
    if (
      !s ||
      !Object.hasOwn(modes, s.mode) ||
      !Object.hasOwn(vectors, s.direction) ||
      !["ready", "playing", "lost", "won"].includes(s.status) ||
      !Array.isArray(s.body) ||
      s.body.length < 4 ||
      s.body.length > width * height ||
      !s.body.every(cell) ||
      new Set(s.body.map((p) => p.y * width + p.x)).size !== s.body.length
    )
      return null;
    for (let i = 1; i < s.body.length; i++) {
      let dx = Math.abs(s.body[i].x - s.body[i - 1].x),
        dy = Math.abs(s.body[i].y - s.body[i - 1].y);
      if (s.mode === "wrap") {
        dx = Math.min(dx, width - dx);
        dy = Math.min(dy, height - dy);
      }
      if (dx + dy !== 1) return null;
    }
    if (
      ![s.score, s.eaten, s.ticks].every(
        (v) => Number.isSafeInteger(v) && v >= 0,
      ) ||
      s.body.length !== s.eaten + 4 ||
      s.score < s.eaten * 10 ||
      (s.combo !== undefined &&
        (!Number.isInteger(s.combo) || s.combo < 0 || s.combo > 5)) ||
      (s.status === "won"
        ? s.body.length !== width * height || s.food !== null
        : !cell(s.food) || s.body.some((p) => same(p, s.food))) ||
      (s.bonus &&
        (!cell(s.bonus) ||
          !Number.isInteger(s.bonus.ttl) ||
          s.bonus.ttl < 1 ||
          s.bonus.ttl > Math.max(65, width * height + 16) ||
          (s.bonus.duration !== undefined &&
            (!Number.isInteger(s.bonus.duration) ||
              s.bonus.duration < s.bonus.ttl ||
              s.bonus.duration < 65 ||
              s.bonus.duration > Math.max(65, width * height + 16))) ||
          same(s.bonus, s.food) ||
          s.body.some((p) => same(p, s.bonus)))) ||
      (s.alternative != null &&
        (!cell(s.alternative) ||
          same(s.alternative, s.food) ||
          same(s.alternative, s.bonus) ||
          s.body.some((p) => same(p, s.alternative)))) ||
      (s.status === "won" && s.alternative != null)
    )
      return null;
    const best = {};
    for (const mode of Object.keys(modes))
      best[mode] =
        Number.isSafeInteger(save.best?.[mode]) && save.best[mode] >= 0
          ? save.best[mode]
          : 0;
    best[s.mode] = Math.max(best[s.mode], s.score);
    // Preserve a legacy wrap seam until the player starts a new run.
    const canExpand =
      width === size &&
      s.status !== "won" &&
      !(
        s.mode === "wrap" &&
        s.body.some(
          (part, index) =>
            index > 0 && Math.abs(part.x - s.body[index - 1].x) === size - 1,
        )
      );
    const state = {
      ...JSON.parse(JSON.stringify(s)),
      columns: canExpand ? columns : width,
      rows: height,
      combo: s.combo ?? 0,
    };
    if (state.bonus) state.bonus.duration ??= Math.max(65, state.bonus.ttl);
    if (s.alternative === undefined)
      state.alternative =
        state.status === "won"
          ? null
          : choose(state, [state.food, state.bonus], () => 0.5, state.food);
    return { state, best };
  }
  return {
    size,
    columns,
    rows,
    modes,
    vectors,
    same,
    create,
    canTurn,
    interval,
    step,
    restore,
  };
})();

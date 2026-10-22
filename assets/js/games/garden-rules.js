"use strict";
/** Seeded, solvable layered triple matching. No DOM or storage dependencies. */
WorkTimeApp.games.gardenRules = (() => {
  const levels = [
    [
      [4, 4, 1, 1],
      [3, 2, 1.5, 2.5],
      [2, 1, 2, 3],
    ],
    [
      [6, 5, 0, 0.5],
      [5, 4, 0.5, 1],
      [5, 2, 0.5, 2],
    ],
    [
      [6, 6, 0, 0],
      [5, 4, 0.5, 1],
      [6, 4, 0, 1.5],
      [5, 2, 0.5, 2.5],
    ],
  ];
  const levelCount = 18,
    typeCount = 27;
  const difficulty = (level) => ({
    chapter: Math.floor(level / 6),
    kinds: [4, 7, 9, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 14, 15, 15, 16][
      level
    ],
    tools: 3 - Math.floor(level / 6),
  });
  function randomizer(seed) {
    let value = seed >>> 0;
    return () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }
  function available(tiles, removed) {
    const gone = new Set(removed);
    return tiles.filter(
      (tile) => !gone.has(tile.id) && tile.above.every((id) => gone.has(id)),
    );
  }
  function layout(level, seed) {
    const random = randomizer(seed),
      tiles = [];
    const layers =
      levels[level] ||
      Array.from({ length: 3 + Math.floor(level / 4) }, (_, z) => {
        const span = z % 2 ? 5 : 6;
        return [span, span, z % 2 ? 0.5 : 0, z % 2 ? 0.5 : 0];
      });
    layers.forEach(([cols, rows, ox, oy], z) => {
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          if (level >= 3) {
            const edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
            const middle =
              Math.abs(x - (cols - 1) / 2) < 1 ||
              Math.abs(y - (rows - 1) / 2) < 1;
            const keep = [
              edge || middle,
              z % 2 ? !edge : true,
              Math.abs(x - y) <= 2,
              edge || (x + y + z) % 3 === 0,
              x + y >= z % 3 && x + y <= cols + rows - 2 - (z % 3),
              !middle || z % 2 === 0,
            ][level % 6];
            if (!keep) continue;
          }
          tiles.push({
            id: tiles.length,
            x: x + ox,
            y: y + oy,
            z,
            type: 0,
            above: [],
          });
        }
    });
    while (tiles.length % 3) tiles.pop();
    for (const tile of tiles)
      tile.above = tiles
        .filter(
          (other) =>
            other.z > tile.z &&
            Math.abs(other.x - tile.x) < 0.99 &&
            Math.abs(other.y - tile.y) < 0.99,
        )
        .map((other) => other.id);
    const order = [],
      gone = [];
    while (gone.length < tiles.length) {
      const options = available(tiles, gone);
      const tile = options[Math.floor(random() * options.length)];
      order.push(tile.id);
      gone.push(tile.id);
    }
    const kinds = difficulty(level).kinds,
      remaining = Array(kinds).fill(0),
      tray = Array(kinds).fill(0);
    const palette = Array.from(
      { length: level < 6 ? 18 : typeCount },
      (_, i) => i,
    );
    if (level >= 3) {
      for (let i = palette.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [palette[i], palette[j]] = [palette[j], palette[i]];
      }
    }
    for (let i = 0; i < tiles.length / 3; i++)
      remaining[level < 3 ? Math.floor(random() * kinds) : i % kinds] += 3;
    for (const id of order) {
      const occupied = tray.reduce((a, b) => a + b, 0);
      let options = remaining
        .map((n, i) => (n > 0 ? i : -1))
        .filter((i) => i >= 0);
      // Close existing groups before opening another when the witness tray is tight.
      if (occupied >= (level < 3 ? 4 : 5)) {
        options = options.filter((i) => tray[i] > 0);
        const most = Math.max(...options.map((i) => tray[i]));
        options = options.filter((i) => tray[i] === most);
      }
      const type = options[Math.floor(random() * options.length)];
      remaining[type]--;
      tray[type] = (tray[type] + 1) % 3;
      tiles[id].type = palette[type];
    }
    return { tiles, solution: order };
  }
  const create = (
    level = 0,
    seed = Math.floor(Math.random() * 4294967296),
  ) => ({
    level,
    seed: seed >>> 0,
    removed: [],
    tray: [],
    reserve: [],
    undoLeft: difficulty(level).tools,
    hintsLeft: difficulty(level).tools,
    moves: 0,
  });
  const copy = (state) => ({
    ...state,
    removed: [...state.removed],
    tray: [...state.tray],
    reserve: [...state.reserve],
  });
  function phase(state, tiles) {
    if (
      state.removed.length === tiles.length &&
      !state.tray.length &&
      !state.reserve.length
    )
      return "won";
    return state.tray.length >= 7 ? "blocked" : "playing";
  }
  function collect(state, tiles, id) {
    state.tray.push(id);
    const type = tiles[id].type;
    const group = state.tray.filter((i) => tiles[i].type === type);
    if (group.length === 3)
      state.tray = state.tray.filter((i) => !group.includes(i));
    state.tray.sort((a, b) => tiles[a].type - tiles[b].type);
  }
  function move(state, tiles, action, id) {
    if (!Number.isInteger(id) || !tiles[id]) return null;
    const next = copy(state);
    if (action === "pick") {
      if (
        phase(state, tiles) !== "playing" ||
        !available(tiles, state.removed).some((tile) => tile.id === id)
      )
        return null;
      next.removed.push(id);
      collect(next, tiles, id);
    } else if (action === "store") {
      if (state.reserve.length >= 2 || !state.tray.includes(id)) return null;
      next.tray.splice(next.tray.indexOf(id), 1);
      next.reserve.push(id);
    } else if (action === "return") {
      if (state.tray.length >= 7 || !state.reserve.includes(id)) return null;
      next.reserve.splice(next.reserve.indexOf(id), 1);
      collect(next, tiles, id);
    } else return null;
    next.moves++;
    return next;
  }
  function hint(state, tiles) {
    if (phase(state, tiles) !== "playing") return null;
    const counts = Array(typeCount).fill(0);
    state.tray.forEach((id) => counts[tiles[id].type]++);
    const options = [
      ...state.reserve.map((id) => ({ action: "return", id })),
      ...available(tiles, state.removed).map(({ id }) => ({
        action: "pick",
        id,
      })),
    ];
    const before = available(tiles, state.removed).length;
    const rank = ({ action, id }) => {
      const next = move(state, tiles, action, id);
      const matches = counts[tiles[id].type];
      const opened =
        available(tiles, next.removed).length -
        before +
        (action === "pick" ? 1 : 0);
      return (
        (matches === 2 ? 1000 : matches * 30) +
        opened * 5 -
        (phase(next, tiles) === "blocked" ? 500 : 0)
      );
    };
    options.sort((a, b) => rank(b) - rank(a));
    return options[0] || null;
  }
  function restore(value) {
    if (
      !value ||
      !Number.isInteger(value.level) ||
      value.level < 0 ||
      value.level >= levelCount ||
      !Number.isInteger(value.seed) ||
      value.seed < 0 ||
      value.seed > 4294967295
    )
      return null;
    const { tiles } = layout(value.level, value.seed);
    for (const name of ["removed", "tray", "reserve"]) {
      const list = value[name];
      if (
        !Array.isArray(list) ||
        list.length > tiles.length ||
        new Set(list).size !== list.length ||
        list.some((id) => !Number.isInteger(id) || id < 0 || id >= tiles.length)
      )
        return null;
    }
    if (
      value.tray.length > 7 ||
      value.reserve.length > 2 ||
      new Set([...value.tray, ...value.reserve]).size !==
        value.tray.length + value.reserve.length ||
      [...value.tray, ...value.reserve].some(
        (id) => !value.removed.includes(id),
      )
    )
      return null;
    const seen = [];
    for (const id of value.removed) {
      if (!tiles[id].above.every((above) => seen.includes(above))) return null;
      seen.push(id);
    }
    const unmatched = new Set([...value.tray, ...value.reserve]);
    const counts = Array(typeCount).fill(0),
      trayCounts = Array(typeCount).fill(0);
    value.removed
      .filter((id) => !unmatched.has(id))
      .forEach((id) => counts[tiles[id].type]++);
    value.tray.forEach((id) => trayCounts[tiles[id].type]++);
    if (counts.some((n) => n % 3) || trayCounts.some((n) => n >= 3))
      return null;
    for (const [name, max] of [
      ["undoLeft", 3],
      ["hintsLeft", 3],
      ["moves", 100000],
    ])
      if (
        !Number.isInteger(value[name]) ||
        value[name] < 0 ||
        value[name] > max
      )
        return null;
    if (value.moves < value.removed.length) return null;
    return {
      ...create(value.level, value.seed),
      ...Object.fromEntries(
        ["removed", "tray", "reserve"].map((name) => [name, [...value[name]]]),
      ),
      undoLeft: value.undoLeft,
      hintsLeft: value.hintsLeft,
      moves: value.moves,
    };
  }
  function stars(state, tiles) {
    if (phase(state, tiles) !== "won") return 0;
    const budget = difficulty(state.level).tools;
    return (
      1 + Number(state.hintsLeft === budget) + Number(state.undoLeft === budget)
    );
  }
  return {
    create,
    layout,
    available,
    move,
    phase,
    hint,
    restore,
    copy,
    levelCount,
    typeCount,
    difficulty,
    stars,
  };
})();

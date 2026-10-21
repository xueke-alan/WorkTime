"use strict";
/** Pure rules shared by the UI, importer and offline verification. */
WorkTimeApp.games.sokobanRules = (() => {
  const directions = { u: [0, -1], r: [1, 0], d: [0, 1], l: [-1, 0] };
  function parse(level) {
    const rows = level.rows;
    const width = Math.max(...rows.map((row) => row.length));
    const height = rows.length;
    const floors = new Set(),
      goals = new Set(),
      boxes = [];
    let player = -1,
      players = 0;
    rows.forEach((row, y) =>
      Array.from(row).forEach((tile, x) => {
        const index = y * width + x;
        if (".@+$*".includes(tile)) floors.add(index);
        if (".+*".includes(tile)) goals.add(index);
        if ("$*".includes(tile)) boxes.push(index);
        if ("@+".includes(tile)) {
          player = index;
          players++;
        }
        if (!" #.@+$*".includes(tile)) throw Error("Invalid level tile");
      }),
    );
    if (players !== 1 || !boxes.length || boxes.length !== goals.size)
      throw Error("Invalid level occupants");
    const pending = [...floors];
    for (let i = 0; i < pending.length; i++) {
      const index = pending[i],
        x = index % width,
        y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
        throw Error("Open level boundary");
      for (const [dx, dy] of Object.values(directions)) {
        const next = index + dx + dy * width;
        if (rows[y + dy]?.[x + dx] === " " && !floors.has(next)) {
          floors.add(next);
          pending.push(next);
        }
      }
    }
    return { width, height, floors, goals, boxes, player };
  }
  function create() {
    return { path: "", history: [], moves: 0, pushes: 0 };
  }
  function position(map, state) {
    return (
      state.history.at(-1) || {
        player: map.player,
        boxes: [...map.boxes],
        pushes: 0,
      }
    );
  }
  function won(map, state) {
    return position(map, state).boxes.every((box) => map.goals.has(box));
  }
  function move(map, state, direction) {
    if (!directions[direction] || state.path.length >= 20000 || won(map, state))
      return false;
    const [dx, dy] = directions[direction],
      offset = dx + dy * map.width;
    const before = position(map, state),
      next = before.player + offset;
    if (!map.floors.has(next)) return false;
    const boxes = [...before.boxes],
      index = boxes.indexOf(next);
    if (
      index >= 0 &&
      (!map.floors.has(next + offset) || boxes.includes(next + offset))
    )
      return false;
    if (index >= 0) boxes[index] += offset;
    state.pushes = before.pushes + Number(index >= 0);
    state.history.push({ player: next, boxes, pushes: state.pushes });
    state.path += direction;
    state.moves = state.path.length;
    return true;
  }
  function undo(state) {
    if (!state.history.length) return false;
    state.history.pop();
    state.path = state.path.slice(0, -1);
    state.moves = state.path.length;
    state.pushes = state.history.at(-1)?.pushes || 0;
    return true;
  }
  function restore(map, saved) {
    if (
      !saved ||
      typeof saved.path !== "string" ||
      saved.path.length > 20000 ||
      /[^urdl]/.test(saved.path)
    )
      return null;
    const state = create();
    for (const direction of saved.path)
      if (!move(map, state, direction)) return null;
    return state;
  }
  function deadlocked(map, state) {
    const boxes = position(map, state).boxes;
    return boxes.some(
      (box) =>
        !map.goals.has(box) &&
        [1, -1].some((dx) => !map.floors.has(box + dx)) &&
        [map.width, -map.width].some((dy) => !map.floors.has(box + dy)),
    );
  }
  return {
    directions,
    parse,
    create,
    position,
    move,
    undo,
    restore,
    won,
    deadlocked,
  };
})();

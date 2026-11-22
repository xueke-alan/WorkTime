"use strict";
// One deterministic rules implementation, shared by training, Workers and UI.
WorkTimeApp.games.aeroplaneRulesFactory = function () {
  const VERSION = 2,
    END = 56;
  const colors = ["red", "yellow", "blue", "green"];
  const quarter = [
    [7.5, 16],
    [6.5, 16],
    [5.35, 15.65],
    [5, 14.5],
    [5, 13.5],
    [5.35, 12.5],
    [4.5, 11.65],
    [3.5, 12],
    [2.5, 12],
    [1.35, 11.65],
    [1, 10.5],
    [1, 9.5],
    [1, 8.5],
  ];
  const rectangles = [
    [7, 15, 1, 2],
    [6, 15, 1, 2],
    null,
    [4, 14, 2, 1],
    [4, 13, 2, 1],
    null,
    null,
    [3, 11, 1, 2],
    [2, 11, 1, 2],
    null,
    [0, 10, 2, 1],
    [0, 9, 2, 1],
    [0, 8, 2, 1],
  ];
  const triangles = {
    2: [
      [4, 15],
      [6, 15],
      [6, 17],
    ],
    5: [
      [4, 13],
      [6, 13],
      [6, 11],
    ],
    6: [
      [4, 13],
      [4, 11],
      [6, 11],
    ],
    9: [
      [0, 11],
      [2, 11],
      [2, 13],
    ],
  };
  function rotate(point, n) {
    let [x, y] = point;
    for (let i = 0; i < n; i++) [x, y] = [17 - y, x];
    return [x, y];
  }
  const track = colors.flatMap((_, p) => quarter.map((q) => rotate(q, p)));
  const polygons = colors.flatMap((_, p) =>
    quarter.map((q, i) => {
      const box = rectangles[i];
      const points = box
        ? [
            [box[0], box[1]],
            [box[0] + box[2], box[1]],
            [box[0] + box[2], box[1] + box[3]],
            [box[0], box[1] + box[3]],
          ]
        : triangles[i];
      return points.map((point) => rotate(point, p));
    }),
  );
  const global = (p, n) => (p * 13 + 1 + n) % 52;
  const squareColor = (i) => (i + 1) % 4;
  function coordinate(p, n, plane = 0) {
    if (n === -2)
      return rotate([1 + (plane % 2) * 2, 14 + Math.floor(plane / 2) * 2], p);
    if (n === -1) return rotate([4.65, 16.35], p);
    if (n <= 50) return track[global(p, n)];
    if (n === END)
      return rotate(
        [
          8.5 + [-0.55, 0.55, -0.23, 0.23][plane],
          [9.65, 9.65, 9.18, 9.18][plane],
        ],
        p,
      );
    return rotate([8.5, 65.5 - n], p);
  }
  function create(seats = ["human", "ai", "ai", "ai"], difficulty = "normal") {
    return {
      version: VERSION,
      pieces: Array(16).fill(-2),
      seats: seats.slice(),
      difficulty,
      turn: 0,
      die: 0,
      phase: "roll",
      winner: null,
      actions: 0,
      rolls: [],
    };
  }
  function legal(s) {
    if (s.phase !== "move") return [];
    return [0, 1, 2, 3].filter((i) => {
      const n = s.pieces[s.turn * 4 + i];
      return n !== END && (n !== -2 || s.die === 6);
    });
  }
  function landing(p, n, die) {
    if (n === -2) return { to: -1, path: [-1], hits: [], special: "takeoff" };
    // -1 is an apron sentinel, not an outer-track step. The first counted
    // square is step 1, adjoining the apron; step 0 lies before the entrance.
    const from = n === -1 ? 0 : n;
    let to = from + die;
    const path = [];
    for (let j = 1; j <= die; j++) {
      const k = from + j;
      path.push(k > END ? 2 * END - k : k);
    }
    if (to > END)
      return { to: 2 * END - to, path, hits: [], special: "bounce" };
    if (to > 50)
      return { to, path, hits: [], special: to === END ? "finish" : "walk" };
    // Capture at every landing, including the square before a bonus jump.
    // A jump may enter the express lane; flight never triggers another jump.
    let special = "walk";
    const hits = [global(p, to)];
    let crossing = null;
    if (to !== 18 && squareColor(global(p, to)) === p && to + 4 <= 50) {
      to += 4;
      path.push(to);
      hits.push(global(p, to));
      special = "jump";
    }
    if (to === 18) {
      crossing = { player: (p + 2) % 4, step: 53 };
      to = 30;
      path.push(to);
      special = "fly";
      hits.push(global(p, to));
    }
    return { to, path, hits, special, crossing };
  }
  function advance(s) {
    s.die = 0;
    s.phase = "roll";
    s.turn = (s.turn + 1) % 4;
  }
  function roll(input, die) {
    if (input.phase !== "roll" || !Number.isInteger(die) || die < 1 || die > 6)
      throw Error("Invalid roll");
    const s = {
      ...input,
      pieces: input.pieces.slice(),
      die,
      phase: "move",
      actions: input.actions + 1,
      rolls: [...(input.rolls || []).slice(-63), [input.turn, die]],
    };
    if (!legal(s).length) {
      if (die === 6) {
        s.die = 0;
        s.phase = "roll";
      } else advance(s);
    }
    return s;
  }
  function move(input, plane) {
    if (!legal(input).includes(plane)) throw Error("Illegal plane");
    const p = input.turn,
      idx = p * 4 + plane;
    const effect = landing(p, input.pieces[idx], input.die);
    const s = {
      ...input,
      pieces: input.pieces.slice(),
      actions: input.actions + 1,
    };
    s.pieces[idx] = effect.to;
    const captured = [];
    for (let i = 0; i < 16; i++)
      if (
        Math.floor(i / 4) !== p &&
        ((s.pieces[i] >= 0 &&
          s.pieces[i] <= 50 &&
          effect.hits.includes(global(Math.floor(i / 4), s.pieces[i]))) ||
          (effect.crossing?.player === Math.floor(i / 4) &&
            s.pieces[i] === effect.crossing.step))
      ) {
        s.pieces[i] = -2;
        captured.push(i);
      }
    if (s.pieces.slice(p * 4, p * 4 + 4).every((n) => n === END)) {
      s.winner = p;
      s.phase = "won";
      s.die = 0;
    } else if (input.die === 6) {
      s.die = 0;
      s.phase = "roll";
    } else advance(s);
    return { state: s, effect: { ...effect, player: p, plane, captured } };
  }
  function restore(v) {
    // Collapse the duplicated gate square from the first preview. Completed
    // planes and old terminal games remain completed after migration.
    if (v?.version === 1) {
      if (
        !Array.isArray(v.pieces) ||
        v.pieces.length !== 16 ||
        !v.pieces.every((n) => Number.isInteger(n) && n >= -2 && n <= 57)
      )
        return null;
      v = {
        ...v,
        version: VERSION,
        pieces: v.pieces.map((n) => (n >= 51 ? n - 1 : n)),
      };
    }
    // Repair the erroneous first-square position written by earlier previews.
    if (v?.version === VERSION && Array.isArray(v.pieces))
      v = { ...v, pieces: v.pieces.map((n) => (n === 0 ? 1 : n)) };
    if (
      !v ||
      v.version !== VERSION ||
      !Array.isArray(v.pieces) ||
      v.pieces.length !== 16 ||
      !v.pieces.every((n) => Number.isInteger(n) && n >= -2 && n <= END)
    )
      return null;
    if (
      !Array.isArray(v.seats) ||
      v.seats.length !== 4 ||
      !v.seats.every((s) => ["human", "ai"].includes(s)) ||
      !v.seats.includes("human")
    )
      return null;
    if (
      !["easy", "normal", "hard"].includes(v.difficulty) ||
      !Number.isInteger(v.turn) ||
      v.turn < 0 ||
      v.turn > 3 ||
      !Number.isSafeInteger(v.actions) ||
      v.actions < 0
    )
      return null;
    if (
      !["roll", "move", "won"].includes(v.phase) ||
      !Number.isInteger(v.die) ||
      v.die < 0 ||
      v.die > 6
    )
      return null;
    const winners = [0, 1, 2, 3].filter((p) =>
      v.pieces.slice(p * 4, p * 4 + 4).every((n) => n === END),
    );
    if (
      v.phase === "won"
        ? winners.length !== 1 ||
          v.winner !== v.turn ||
          winners[0] !== v.winner ||
          v.die !== 0
        : winners.length !== 0 ||
          v.winner !== null ||
          (v.phase === "roll" ? v.die !== 0 : v.die === 0 || !legal(v).length)
    )
      return null;
    if (
      !Array.isArray(v.rolls) ||
      v.rolls.length > 64 ||
      !v.rolls.every(
        (r) =>
          Array.isArray(r) &&
          r.length === 2 &&
          Number.isInteger(r[0]) &&
          r[0] >= 0 &&
          r[0] < 4 &&
          Number.isInteger(r[1]) &&
          r[1] >= 1 &&
          r[1] <= 6,
      )
    )
      return null;
    return {
      version: VERSION,
      pieces: v.pieces.slice(),
      seats: v.seats.slice(),
      difficulty: v.difficulty,
      turn: v.turn,
      die: v.die,
      phase: v.phase,
      winner: v.winner,
      actions: v.actions,
      rolls: v.rolls.map((r) => r.slice()),
    };
  }
  function random(seed) {
    let n = seed >>> 0 || 1;
    return () => {
      n ^= n << 13;
      n ^= n >>> 17;
      n ^= n << 5;
      return (n >>> 0) / 4294967296;
    };
  }
  return {
    VERSION,
    END,
    colors,
    track,
    polygons,
    global,
    squareColor,
    coordinate,
    rotate,
    create,
    legal,
    landing,
    roll,
    move,
    restore,
    random,
  };
};
WorkTimeApp.games.aeroplaneRules = WorkTimeApp.games.aeroplaneRulesFactory();

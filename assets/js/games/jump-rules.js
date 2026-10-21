"use strict";
/** Ground coordinates stay independent of the isometric camera and frame rate. */
WorkTimeApp.games.jumpRules = (() => {
  const maxCharge = 1300;
  const distance = (milliseconds) =>
    40 + Math.max(0, Math.min(maxCharge, milliseconds)) * 0.32;
  function nextPlatform(from, score, random = Math.random) {
    const gap = 180 + random() * Math.min(120, 45 + score * 2);
    const axis = random() < 0.5 ? "x" : "z";
    return {
      x: from.x + (axis === "x" ? gap : 0),
      z: from.z + (axis === "z" ? gap : 0),
      size: Math.max(76, 112 - score * 0.65) + random() * 12,
      kind: random() < 0.35 ? "round" : "box",
      tone: Math.floor(random() * 5),
    };
  }
  function create(random = Math.random) {
    const first = { x: 0, z: 0, size: 120, kind: "box", tone: 0 };
    return {
      platforms: [first, nextPlatform(first, 0, random)],
      position: { x: 0, z: 0 },
      score: 0,
      combo: 0,
      status: "playing",
    };
  }
  function contains(platform, point) {
    const dx = point.x - platform.x,
      dz = point.z - platform.z,
      radius = platform.size / 2;
    return platform.kind === "round"
      ? Math.hypot(dx, dz) <= radius
      : Math.abs(dx) <= radius && Math.abs(dz) <= radius;
  }
  function jump(state, milliseconds, random = Math.random) {
    if (state.status !== "playing" || !Number.isFinite(milliseconds))
      return null;
    const target = state.platforms.at(-1),
      current = state.platforms.at(-2),
      dx = target.x - state.position.x,
      dz = target.z - state.position.z,
      length = Math.hypot(dx, dz),
      travel = distance(milliseconds),
      position = {
        x: state.position.x + (dx / length) * travel,
        z: state.position.z + (dz / length) * travel,
      };
    if (contains(target, position)) {
      const perfect =
        Math.hypot(position.x - target.x, position.z - target.z) <= 12;
      const combo = perfect ? state.combo + 1 : 0;
      const gain = perfect ? Math.min(10, combo * 2) : 1;
      const score = state.score + gain;
      return {
        state: {
          platforms: [
            ...state.platforms.slice(-4),
            nextPlatform(target, score, random),
          ],
          position,
          score,
          combo,
          status: "playing",
        },
        position,
        gain,
        perfect,
        advanced: true,
      };
    }
    const safe = contains(current, position);
    return {
      state: { ...state, position, status: safe ? "playing" : "lost" },
      position,
      gain: 0,
      perfect: false,
      advanced: false,
    };
  }
  return { create, jump, contains, distance, maxCharge };
})();

"use strict";
WorkTimeApp.games.unoAiFactory = function (R) {
  function sample(o, rng) {
    const known = new Set([...o.hand, ...o.discard]);
    const unknown = R.shuffle(
      R.cards.map((c) => c.id).filter((id) => !known.has(id)),
      rng,
    );
    const hands = o.counts.map((count, i) =>
      i === o.turn ? o.hand.slice() : unknown.splice(0, count),
    );
    return {
      ...o,
      hands,
      deck: unknown,
      discard: o.discard.slice(),
      rng: rng.rng,
      status: "playing",
      winner: null,
      log: [],
    };
  }
  function score(o, a) {
    if (a.type !== "play") return a.type === "pass" ? -10 : -20;
    const c = R.cards[a.card];
    const remaining = o.hand.filter((id) => id !== a.card);
    const same = remaining.filter((id) => R.cards[id].color === a.color).length;
    const next = (o.turn + o.direction + o.counts.length) % o.counts.length;
    const threat = o.counts[next] <= 2;
    return (
      20 +
      same * 3 +
      (c.value <= 9 ? c.value * 0.12 : 2) -
      (c.value >= 13 ? 9 : 0) +
      (threat && [10, 12, 14].includes(c.value) ? 18 : 0) +
      (c.value === 11 && (o.counts.length === 2 || threat) ? 10 : 0) +
      (!remaining.length ? 1000 : 0)
    );
  }
  function choose(o, difficulty = "normal", seed = 1, budget = 250) {
    if (o.openingColor) {
      const color = R.colors
        .slice()
        .sort(
          (a, b) =>
            o.hand.filter((id) => R.cards[id].color === b).length -
            o.hand.filter((id) => R.cards[id].color === a).length,
        )[0];
      return { type: "color", color };
    }
    const rng = { rng: seed >>> 0 || 1 };
    const candidates = R.legal(sample(o, rng));
    if (!candidates.length) return null;
    if (difficulty === "easy") {
      const plays = candidates.filter((a) => a.type === "play");
      const pool = plays.length && R.random(rng) > 0.12 ? plays : candidates;
      return pool[Math.floor(R.random(rng) * pool.length)];
    }
    const ranked = candidates
      .map((action) => ({ action, value: score(o, action), total: 0, n: 0 }))
      .sort((a, b) => b.value - a.value);
    if (difficulty !== "hard" || ranked[0].value >= 1000 || ranked.length === 1)
      return ranked[0].action;
    const start = performance.now();
    const pool = ranked.filter((r) => r.action.type === "play");
    if (!pool.length) return ranked[0].action;
    for (
      let round = 0;
      round < 64 && performance.now() - start < budget;
      round++
    ) {
      const world = sample(o, rng);
      for (const candidate of pool) {
        if (performance.now() - start >= budget) break;
        let s = R.apply(world, candidate.action);
        for (
          let depth = 0;
          depth < o.counts.length * 3 && s.status === "playing";
          depth++
        ) {
          if (performance.now() - start >= budget) break;
          const obs = R.observe(s);
          const action = R.legal(s).sort(
            (a, b) => score(obs, b) - score(obs, a),
          )[0];
          s = R.apply(s, action);
        }
        const own = s.hands[o.turn].length;
        const opponent = Math.min(
          ...s.hands.filter((_, i) => i !== o.turn).map((h) => h.length),
        );
        candidate.total +=
          s.status === "won"
            ? s.winner === o.turn
              ? 120
              : -120
            : (opponent - own) * 5;
        candidate.n++;
      }
    }
    return pool.sort(
      (a, b) =>
        b.value +
        (b.n ? b.total / b.n : 0) -
        (a.value + (a.n ? a.total / a.n : 0)),
    )[0].action;
  }
  return { choose, sample, score };
};
WorkTimeApp.games.unoAi = WorkTimeApp.games.unoAiFactory(
  WorkTimeApp.games.unoRules,
);

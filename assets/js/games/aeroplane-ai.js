"use strict";
WorkTimeApp.games.aeroplaneAiFactory = function (R) {
  const FEATURES = 14;
  const attacks = Array.from({ length: 4 }, (_, p) =>
    Array.from({ length: 53 }, (_, v) => {
      const masks = Array(56).fill(0);
      for (let d = 1; d <= 6; d++) {
        const effect = R.landing(p, v - 2, d);
        for (const t of effect.hits) masks[t] |= 1 << (d - 1);
        if (effect.crossing) masks[52 + effect.crossing.player] |= 1 << (d - 1);
      }
      return masks;
    }),
  );
  const counts = Array.from(
    { length: 64 },
    (_, n) => n.toString(2).replaceAll("0", "").length,
  );
  // Risk uses only public pieces and all six possible opponent dice.
  function danger(s, p, n) {
    if (n < 0 || (n > 50 && n !== 53)) return 0;
    const target = n === 53 ? 52 + p : R.global(p, n);
    let risk = 0;
    for (let q = 0; q < 4; q++)
      if (q !== p) {
        let mask = 0;
        for (let j = 0; j < 4; j++) {
          const v = s.pieces[q * 4 + j];
          if (v >= -1 && v < 51) mask |= attacks[q][v + 2][target];
        }
        risk += counts[mask] / 6;
      }
    return risk;
  }
  function features(s, a) {
    const p = s.turn,
      n = s.pieces[p * 4 + a],
      result = R.move(s, a),
      next = result.state,
      to = result.effect.to;
    const active = s.pieces
      .slice(p * 4, p * 4 + 4)
      .filter((v) => v >= -1 && v < R.END).length;
    const capture = result.effect.captured.reduce(
      (v, i) => v + (s.pieces[i] + 8) / 65,
      0,
    );
    const risk = danger(next, p, to),
      old = danger(s, p, n);
    return [
      1,
      (to - n) / 60,
      capture,
      to === R.END ? 1 : 0,
      n === -2 ? 1 : 0,
      (old * (n + 8)) / 65,
      (risk * (to + 8)) / 65,
      to > 50 && n <= 50 ? 1 : 0,
      (to / R.END) ** 2 - (Math.max(n, 0) / R.END) ** 2,
      n === -2 ? (4 - active) / 4 : 0,
      result.effect.special === "fly" ? 1 : 0,
      next.winner === p ? 1 : 0,
      to >= 51 && to < R.END ? (to - 50) / (R.END - 50) : 0,
      risk *
        next.pieces.filter(
          (v, i) => Math.floor(i / 4) === p && i !== p * 4 + a && v === to,
        ).length,
    ];
  }
  const dot = (w, x) => w.reduce((v, n, i) => v + n * x[i], 0);
  function validate(model) {
    return (
      model?.format === 1 &&
      model.rules === R.VERSION &&
      model.features === FEATURES &&
      ["policy", "value"].every(
        (k) =>
          Array.isArray(model[k]) &&
          model[k].length === FEATURES &&
          model[k].every(Number.isFinite),
      )
    );
  }
  function rank(s, model) {
    if (!validate(model)) throw Error("Invalid aeroplane model");
    return R.legal(s)
      .map((a) => {
        const x = features(s, a);
        return {
          a,
          x,
          score: dot(model.policy, x) + Math.tanh(dot(model.value, x)),
        };
      })
      .sort((a, b) => b.score - a.score || a.a - b.a);
  }
  // Fixed, deliberately transparent evaluation opponent; never used in play.
  function baseline(s) {
    return R.legal(s)
      .map((a) => {
        const r = R.move(s, a),
          n = s.pieces[s.turn * 4 + a];
        return {
          a,
          v:
            (r.effect.to === R.END ? 100 : 0) +
            r.effect.captured.length * 16 +
            (n === -2 ? 9 : 0) +
            (r.effect.to - n),
        };
      })
      .sort((a, b) => b.v - a.v || a.a - b.a)[0]?.a;
  }
  function choose(s, model, difficulty = "normal", seed = 1, options = {}) {
    const ranked = rank(s, model);
    if (ranked.length < 2) return ranked[0]?.a ?? null;
    const rng = R.random(seed),
      start = performance.now();
    const budget =
      options.budget ?? { easy: 100, normal: 500, hard: 1500 }[difficulty];
    const rounds =
      options.rounds ?? { easy: 0, normal: 2, hard: 16 }[difficulty];
    const temperature = { easy: 4, normal: 0.7, hard: 0 }[difficulty] ?? 0;
    function select(rows) {
      if (!temperature) return rows[0].a;
      const weights = rows.map((r) =>
        Math.exp((r.total - rows[0].total) / temperature),
      );
      let value = rng() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < rows.length; i++) {
        value -= weights[i];
        if (value <= 0) return rows[i].a;
      }
      return rows.at(-1).a;
    }
    if (!rounds) return select(ranked.map((r) => ({ ...r, total: r.score })));
    const p = s.turn;
    const sums = ranked.map(() => 0);
    let completed = 0;
    // Common random numbers compare candidate moves under identical futures.
    for (let k = 0; k < rounds; k++) {
      if (performance.now() - start >= budget) break;
      const dice = Array.from({ length: 12 }, () => 1 + Math.floor(rng() * 6));
      for (let c = 0; c < ranked.length; c++) {
        let v = R.move(s, ranked[c].a).state,
          utility = 0;
        for (let d = 0; d < dice.length && v.phase !== "won"; d++) {
          if (v.phase === "roll") v = R.roll(v, dice[d]);
          if (v.phase === "move") {
            const choices = rank(v, model),
              best = choices[0];
            if (v.turn === p) utility += best.score * 0.35;
            else utility -= best.score * 0.08;
            v = R.move(v, best.a).state;
          }
        }
        if (v.phase === "won") utility += v.winner === p ? 100 : -35;
        // Lost progress and finished aircraft dominate speculative gains.
        for (let i = 0; i < 16; i++) {
          const owner = Math.floor(i / 4),
            weight = owner === p ? 1 : -0.24;
          const value = (n) =>
            n === R.END ? 95 : n > 50 ? 65 + (n - 50) * 3 : Math.max(n + 3, 0);
          utility += weight * (value(v.pieces[i]) - value(s.pieces[i])) * 0.12;
        }
        sums[c] += utility;
      }
      completed++;
    }
    return select(
      ranked
        .map((r, i) => ({
          ...r,
          total: r.score + 0.08 * (completed ? sums[i] / completed : 0),
        }))
        .sort((a, b) => b.total - a.total || a.a - b.a),
    );
  }
  return { FEATURES, features, danger, dot, validate, rank, baseline, choose };
};
WorkTimeApp.games.aeroplaneAi = WorkTimeApp.games.aeroplaneAiFactory(
  WorkTimeApp.games.aeroplaneRules,
);

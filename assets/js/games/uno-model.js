"use strict";

WorkTimeApp.games.unoModelFactory = function (R, baseline) {
  const inputSize = 26;
  const hiddenSize = 16;
  const parameterCount = hiddenSize * (inputSize + 2);
  const defaults = { temperature: 6, rounds: 64, horizon: 3, blend: 0.09 };

  const features = baseline.actionFeatures;

  function predict(weights, input, hidden) {
    let score = 0;
    for (let h = 0, offset = 0; h < hiddenSize; h++, offset += inputSize + 2) {
      let sum = weights[offset + inputSize];
      for (let i = 0; i < inputSize; i++) sum += input[i] * weights[offset + i];
      const activation = Math.tanh(sum);
      if (hidden) hidden[h] = activation;
      score += activation * weights[offset + inputSize + 1];
    }
    return score;
  }

  function valid(model) {
    return (
      model?.version === 1 &&
      Array.isArray(model.weights) &&
      model.weights.length === parameterCount &&
      model.weights.every(Number.isFinite) &&
      Object.keys(defaults).every(
        (key) =>
          Number.isFinite(model.settings?.[key]) && model.settings[key] > 0,
      ) &&
      Number.isInteger(model.settings.rounds) &&
      Number.isInteger(model.settings.horizon)
    );
  }

  function legal(o) {
    // The rule only reads the active seat's hand when generating actions.
    const hands = [];
    hands[o.turn] = o.hand;
    return R.legal({ ...o, hands, status: "playing" });
  }

  function rank(o, actions, model) {
    if (actions.length < 2)
      return actions.map((action) => ({ action, score: 0 }));
    const encode = features(o);
    return actions
      .map((action) => ({
        action,
        score: predict(model.weights, encode(action)),
      }))
      .sort((a, b) => b.score - a.score);
  }

  function distribution(scores, temperature) {
    const max = Math.max(...scores);
    const weights = scores.map((score) =>
      Math.exp((score - max) / temperature),
    );
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map((weight) => weight / sum);
  }

  function draw(distribution, rng) {
    let x = R.random(rng);
    const index = distribution.findIndex((p) => (x -= p) <= 0);
    return index < 0 ? distribution.length - 1 : index;
  }

  function rolloutAction(s) {
    const o = {
      hand: s.hands[s.turn],
      counts: s.hands.map((hand) => hand.length),
      turn: s.turn,
      direction: s.direction,
    };
    let best;
    let bestScore = -Infinity;
    for (const action of R.legal(s)) {
      const score =
        action.type === "color"
          ? o.hand.filter((id) => R.cards[id].color === action.color).length
          : baseline.score(o, action);
      if (score > bestScore) {
        best = action;
        bestScore = score;
      }
    }
    return best;
  }

  function ownEndgameAction(s) {
    const hand = s.hands[s.turn];
    if (hand.length !== 2) return rolloutAction(s);
    const options = R.legal(s);
    return (
      options.find((action) => {
        if (action.type !== "play") return false;
        const remaining = R.cards[hand.find((id) => id !== action.card)];
        const played = R.cards[action.card];
        if (remaining.value === 13) return true;
        if (remaining.value === 14 && remaining.color !== action.color)
          return true;
        return (
          s.hands.length === 2 &&
          played.value >= 10 &&
          ![13].includes(played.value) &&
          (remaining.color === action.color || remaining.value === played.value)
        );
      }) || rolloutAction(s)
    );
  }

  function outcome(s, seat) {
    if (s.status === "won") {
      const limit = Math.max(...s.scores.filter((_, i) => i !== seat));
      const won = s.winner === seat;
      const points = s.roundPoints.reduce((sum, value) => sum + value, 0);
      return (
        (won ? 1 : -1 / (s.hands.length - 1)) *
          (1.6 + Math.min(points / s.targetScore, 0.6)) +
        (s.matchWinner === null ? 0 : won ? 0.8 : -0.8) +
        ((s.scores[seat] - limit) / s.targetScore) * 0.15
      );
    }
    if (s.status !== "playing") return 0;
    const position = (cards) => {
      let flexibility = 0;
      for (const id of cards) {
        const value = R.cards[id].value;
        if (value >= 13) flexibility += 1.05;
        else if (value >= 10) flexibility += 0.32;
      }
      return 1 / (0.9 + Math.max(0.75, cards.length - flexibility));
    };
    const chances = s.hands.map(position);
    return (
      1.6 *
      (chances[seat] / chances.reduce((sum, value) => sum + value, 0) -
        1 / chances.length)
    );
  }

  function choose(o, difficulty, seed, model, budget = 250) {
    const deadline = performance.now() + budget;
    const actions = legal(o);
    if (actions.length <= 1) return actions[0] ?? null;
    const finishes =
      o.hand.length === 1 && actions.filter((a) => a.type === "play");
    const ranked = rank(o, finishes?.length ? finishes : actions, model);
    const rng = { rng: seed >>> 0 || 1 };
    const { temperature, rounds, horizon, blend } = model.settings;
    if (difficulty === "easy")
      return ranked[
        draw(
          distribution(
            ranked.map((item) => item.score),
            temperature,
          ),
          rng,
        )
      ].action;
    if (difficulty !== "hard" || finishes?.length) return ranked[0].action;

    // Duplicate copies have identical effects and should not consume search slots.
    const keys = new Set();
    const pool = ranked
      .filter(({ action }) => {
        const key =
          action.type === "play"
            ? R.cards[action.card].value + ":" + action.color
            : action.type + ":" + action.color;
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      })
      .slice(0, 4);
    if (pool.length === 1) return pool[0].action;
    const totals = pool.map(() => 0);
    let complete = 0;
    for (
      let round = 0;
      round < rounds && performance.now() < deadline;
      round++
    ) {
      const world = baseline.sample(o, rng);
      const results = [];
      for (const { action } of pool) {
        let s = R.apply(world, action, true);
        for (
          let step = 0;
          step < horizon * o.counts.length && s.status === "playing";
          step++
        ) {
          if (performance.now() >= deadline) break;
          const next =
            s.turn === o.turn && s.hands[s.turn].length <= 2
              ? ownEndgameAction(s)
              : rolloutAction(s);
          s = R.apply(s, next, true);
        }
        if (performance.now() >= deadline) break;
        results.push(outcome(s, o.turn));
      }
      if (results.length !== pool.length) break;
      results.forEach((value, i) => {
        totals[i] += value;
      });
      complete++;
    }
    if (!complete) return pool[0].action;
    let best = 0;
    for (let i = 1; i < pool.length; i++) {
      if (
        totals[i] / complete + blend * pool[i].score >
        totals[best] / complete + blend * pool[best].score
      )
        best = i;
    }
    return pool[best].action;
  }

  return {
    inputSize,
    hiddenSize,
    parameterCount,
    defaults,
    features,
    predict,
    valid,
    legal,
    distribution,
    draw,
    choose,
  };
};

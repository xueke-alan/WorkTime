"use strict";
WorkTimeApp.games.unoAiFactory = function (R) {
  const cardIds = R.cards.map((card) => card.id);
  const colorSlots = R.cards.map((card) => R.colors.indexOf(card.color));
  const isSkip = (value) => value === 10 || value === 12 || value === 14;
  const rulePriorWeight = 0.0005;
  // Linear action values fitted to paired, eight-player match-equity samples.
  // The coefficients follow the order of actionFeatures.
  const eightPlayerValues = [
    0.016801544213324537, 0, -0.012171306317618194, -0.0046302378956002786,
    0.0010154162516725954, -0.0001355622529795288, 0.0014172550022236098,
    -0.012421202502258206, -0.003433318305184216, 0.003928658397390467,
    -0.06929446856018921, -0.020311492442463008, -0.011193644110587939,
    -0.003190838248438253, -0.0026885893137320784, 0, 0, 0,
    0.012510148007101774, 0.006247841472886247, 0.08388248090712849, 0, 0,
    1.554557629598577e-33, -5.810401159967237e-33, -0.019616179231159166,
  ];

  function lastCardBelief(o) {
    const log = o.log ?? [];
    const clues = o.counts.map(() => []);
    const olderDrawsHidden = o.counts.map(
      (count, seat) => count !== 1 || seat === o.turn,
    );
    const priorTops = [];
    let value;
    let color;
    for (const event of log) {
      priorTops.push({ value, color });
      if (event.type === "play") value = R.cards[event.card].value;
      if (event.type === "play" || event.type === "color") color = event.color;
    }

    for (let i = log.length - 1; i >= 0; i--) {
      const { type, player, count, target } = log[i];
      if (type === "play" && count > 0 && target !== undefined)
        olderDrawsHidden[target] = true;
      if (type !== "draw" || count !== 1 || olderDrawsHidden[player]) continue;
      const next = log[i + 1];
      // A draw followed by a play from the same seat used the card just drawn.
      // Otherwise this seat may have acquired its remaining card at this draw.
      if (next?.type !== "play" || next.player !== player) {
        olderDrawsHidden[player] = true;
        continue;
      }
      if (priorTops[i].value !== undefined) clues[player].push(priorTops[i]);
    }

    const seats = o.counts.length;
    const urgency = (seat) =>
      (((seat - o.turn) * o.direction + seats) % seats) -
      o.scores[seat] / o.targetScore;
    let seat = -1;
    for (let i = 0; i < seats; i++) {
      if (clues[i].length && (seat === -1 || urgency(i) < urgency(seat)))
        seat = i;
    }
    if (seat === -1) return null;

    const known = new Set([...o.hand, ...o.discard]);
    const ids = [];
    const cumulative = [];
    let total = 0;
    for (const card of R.cards) {
      if (known.has(card.id)) continue;
      const wasPlayable =
        card.value >= 13 ||
        clues[seat].some(
          (top) => card.color === top.color || card.value === top.value,
        );
      // Voluntary draws are allowed even with a playable card.
      total += wasPlayable ? 0.18 : 1;
      ids.push(card.id);
      cumulative.push(total);
    }
    return { seat, ids, cumulative, total };
  }

  function sample(o, rng, belief) {
    const known = new Set([...o.hand, ...o.discard]);
    const unknown = R.shuffle(
      cardIds.filter((id) => !known.has(id)),
      rng,
    );
    const hands = o.counts.map((count, i) =>
      i === o.turn ? o.hand.slice() : unknown.splice(0, count),
    );
    if (belief) {
      const { seat, ids, cumulative, total } = belief;
      const draw = R.random(rng) * total;
      let low = 0;
      let high = ids.length - 1;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (cumulative[middle] <= draw) low = middle + 1;
        else high = middle;
      }
      const selected = ids[low];
      const hand = hands[seat];
      if (selected !== hand[0]) {
        // Condition on the selected last card while keeping the rest shuffled.
        const pile = hands.find((cards) => cards.includes(selected)) ?? unknown;
        pile[pile.indexOf(selected)] = hand[0];
        hand[0] = selected;
      }
    }
    return {
      ...o,
      hands,
      deck: unknown,
      discard: o.discard.slice(),
      rng: rng.rng,
      status: "playing",
      winner: null,
      matchWinner: null,
      log: [],
    };
  }
  function score(o, a) {
    if (a.type !== "play") return a.type === "pass" ? -10 : -20;
    const next = (o.turn + o.direction + o.counts.length) % o.counts.length;
    return playScore(o.hand, a, o.counts[next] <= 2, o.counts.length === 2);
  }

  function playScore(hand, a, threat, duel) {
    const c = R.cards[a.card];
    let same = 0;
    for (const id of hand)
      if (id !== a.card && R.cards[id].color === a.color) same++;
    return evaluatePlay(c.value, same, threat, duel, hand.length === 1);
  }

  function evaluatePlay(value, same, threat, duel, last) {
    return (
      20 +
      same * 3 +
      (value <= 9 ? value * 0.12 : 2) -
      (value >= 13 ? 9 : 0) +
      (threat && isSkip(value) ? 18 : 0) +
      (value === 11 && (duel || threat) ? 10 : 0) +
      (last ? 1000 : 0)
    );
  }

  function actionFeatures(o) {
    const total = o.counts.length;
    const seat = (step) => (o.turn + o.direction * step + total) % total;
    const next = seat(1);
    const previous = seat(-1);
    const minimum = Math.min(...o.counts.filter((_, i) => i !== o.turn));
    const colors = [0, 0, 0, 0];
    const power = [0, 0, 0, 0];
    const values = Array(15).fill(0);
    for (const id of o.hand) {
      const card = R.cards[id];
      const i = R.colors.indexOf(card.color);
      values[card.value]++;
      if (i < 0) continue;
      colors[i]++;
      if (card.value >= 10) power[i]++;
    }
    const handScale = Math.max(4, o.hand.length);
    const points = (value) => (value < 10 ? value : value < 13 ? 20 : 50);
    const ownScore = o.scores[o.turn] / o.targetScore;
    const lead =
      Math.max(...o.scores.filter((_, i) => i !== o.turn)) / o.targetScore;

    return (action) => {
      const play = action.type === "play";
      const c = play ? R.cards[action.card] : null;
      const value = c?.value ?? -1;
      const color = R.colors.indexOf(action.color);
      const regular = play && value < 13;
      const wild = value >= 13;
      const reverse = value === 11;
      const skips =
        value === 10 ||
        value === 12 ||
        value === 14 ||
        (reverse && total === 2);
      const penalty = value === 12 ? 2 : value === 14 ? 4 : 0;
      const same = (colors[color] ?? 0) - Number(regular);
      const rest = o.hand.length - Number(play);
      const offColor = [...colors];
      if (regular) offColor[color]--;
      const lastValue =
        rest === 1 && play
          ? R.cards[o.hand.find((id) => id !== action.card)].value
          : -1;
      return [
        Number(play),
        Number(action.type === "color"),
        Number(action.type === "draw"),
        Number(action.type === "pass"),
        Number(value === 10),
        Number(reverse),
        penalty / 4,
        Number(wild),
        same / handScale,
        ((power[color] ?? 0) - Number(regular && value >= 10)) / handScale,
        Math.max(...offColor) / handScale,
        offColor.filter(Boolean).length / 4,
        regular ? (values[value] - 1) / handScale : 0,
        play ? points(value) / 50 : 0,
        Math.min(rest, 12) / 12,
        Math.min(minimum, 8) / 8,
        Math.min(o.counts[next], 8) / 8,
        Math.min(o.counts[previous], 8) / 8,
        Number(skips && o.counts[next] <= 2),
        Number(reverse && o.counts[next] < o.counts[previous]),
        Number(lastValue >= 13),
        Number(rest === 1 && skips && total === 2),
        (total - 2) / 6,
        ownScore,
        lead,
        play ? score(o, action) / 35 : (2 * same) / handScale,
      ];
    };
  }

  const rolloutPlays = R.cards.map((card) => {
    const colors = card.value >= 13 ? R.colors : [card.color];
    return colors.map((color) =>
      Object.freeze({ type: "play", card: card.id, color }),
    );
  });
  const rolloutDraw = Object.freeze({ type: "draw" });
  const rolloutPass = Object.freeze({ type: "pass" });

  function rolloutAction(state, seat) {
    const hand = state.hands[state.turn];
    const cards = R.cards;
    const activeColor = R.colors.indexOf(state.color);
    const topValue = cards[state.discard[state.discard.length - 1]].value;
    const counts = [0, 0, 0, 0];
    for (const id of hand) {
      const color = colorSlots[id];
      if (color >= 0) counts[color]++;
    }
    const canDrawFour = !counts[activeColor];
    const players = state.hands.length;
    const duel = players === 2;
    const ownTurn = state.turn === seat && hand.length > 1;
    const next = R.next(state);
    const threat = state.hands[next].length <= 2;
    const danger = (player) =>
      state.hands[player].length === 1
        ? 12 + (12 * state.scores[player]) / state.targetScore
        : 0;
    let bestAction = state.drawn === null ? rolloutDraw : rolloutPass;
    let bestScore = -Infinity;
    const drawn = state.drawn;

    for (let index = 0; index < hand.length; index++) {
      const id = hand[index];
      if (drawn !== null && drawn !== id) continue;
      const value = cards[id].value;
      const color = colorSlots[id];
      const legal =
        value === 14
          ? canDrawFour
          : R.matches(cards[id], state.color, topValue);
      if (!legal) continue;
      const skips = isSkip(value);
      let defense = 0;
      if (ownTurn && !duel && (skips || value === 11)) {
        const recipient =
          value === 11
            ? (state.turn - state.direction + players) % players
            : R.next(state, 2);
        defense = danger(next) - danger(recipient);
      }
      for (const action of rolloutPlays[id]) {
        const slot = color < 0 ? R.colors.indexOf(action.color) : color;
        const same = counts[slot] - Number(color === slot);
        let score = evaluatePlay(value, same, threat, duel, hand.length === 1);
        if (
          ownTurn &&
          hand.length === 2 &&
          canPlayOn(cards[hand[1 - index]], action.color, value)
        ) {
          score += 6;
          if (duel && (skips || value === 11)) score += 100;
        }
        score += defense;
        if (score > bestScore) {
          bestScore = score;
          bestAction = action;
        }
      }
    }
    // Play scores are positive on every legal play, above draw and pass.
    return bestAction;
  }

  function canPlayOn(card, color, value) {
    return card.value >= 13 || card.color === color || card.value === value;
  }

  function matchEquity(state, seat, evaluator) {
    if (state.matchWinner !== null) return Number(state.matchWinner === seat);
    const { weights, total, exponential } = evaluator;
    if (state.status !== "playing") {
      const winner = state.winner;
      if (winner === null) return weights[seat] / total;
      const winningWeight = exponential(state.scores[winner]);
      let sum = 0;
      for (let i = 0; i < weights.length; i++)
        sum += i === winner ? winningWeight : weights[i];
      return (winner === seat ? winningWeight : weights[seat]) / sum;
    }

    // Resolve an immediate finish with the real rules, including penalty cards.
    const multiplayer = state.hands.length > 2;
    if (multiplayer && state.hands[state.turn].length === 1) {
      const finish = R.legal(state).find((action) => action.type === "play");
      if (finish)
        return matchEquity(R.apply(state, finish, true), seat, evaluator);
    }

    // At the rollout limit, project the points for each possible winner and
    // weight those outcomes by how close each hand is to going out.
    const handPoints = state.hands.map(R.points);
    const pointsInPlay = handPoints.reduce((sum, points) => sum + points, 0);
    const top = R.cards[state.discard.at(-1)];
    let chanceTotal = 0;
    let equity = 0;
    for (let player = 0; player < state.hands.length; player++) {
      const hand = state.hands[player];
      const wilds = hand.filter((id) => R.cards[id].value >= 13).length;
      let turns = hand.length - wilds * 0.7;
      if (multiplayer) {
        const distance =
          ((player - state.turn) * state.direction + state.hands.length) %
          state.hands.length;
        const canPlay = hand.some((id) =>
          canPlayOn(R.cards[id], state.color, top.value),
        );
        // The current card matters less for players farther away in turn order.
        turns +=
          (distance + Number(!canPlay) * (state.hands.length - distance)) /
          state.hands.length;
      }
      const chance = 1 / (1 + turns) ** 2;
      const points = pointsInPlay - handPoints[player];
      const winnerWeight = weights[player] * exponential(points);
      const projected =
        state.scores[player] + points >= state.targetScore
          ? Number(player === seat)
          : (player === seat ? winnerWeight : weights[seat]) /
            (total - weights[player] + winnerWeight);
      equity += chance * projected;
      chanceTotal += chance;
    }
    return equity / chanceTotal;
  }

  function search(o, ranked, rng, budget, rounds) {
    const deadline =
      performance.now() +
      (o.counts.length === 4 ? Math.min(budget, 590) : budget);
    const seen = new Set();
    const pool = ranked.filter(({ action }) => {
      const card = action.type === "play" ? R.cards[action.card] : null;
      const key = card
        ? `${card.color}:${card.value}:${action.color}`
        : action.type;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (pool.length <= 1) return pool[0]?.action;
    const horizon = o.counts.length * 12;
    const belief = o.counts.length === 8 ? lastCardBelief(o) : null;
    const exponentials = [];
    const exponential = (points) =>
      exponentials[points] ??
      (exponentials[points] = Math.exp((3 * points) / o.targetScore));
    const weights = o.scores.map(exponential);
    const evaluator = {
      weights,
      total: weights.reduce((sum, value) => sum + value, 0),
      exponential,
    };
    const results = Array(pool.length).fill(0);
    let completed = 0;
    // Compare every action against the same sampled hand and deck. A timeout
    // discards the partial sample so each action has the same evidence.
    sampling: for (; completed < rounds; completed++) {
      if (performance.now() >= deadline) break;
      const world = sample(o, rng, belief);
      for (let i = 0; i < pool.length; i++) {
        if (performance.now() >= deadline) break sampling;
        const state = R.apply(world, pool[i].action, true);
        for (
          let depth = 0;
          depth < horizon && state.status === "playing";
          depth++
        ) {
          if (depth % 4 === 0 && performance.now() >= deadline) break sampling;
          // The first action cloned the sampled world for this candidate.
          R.apply(state, rolloutAction(state, o.turn), true, true);
        }
        results[i] = matchEquity(state, o.turn, evaluator);
      }
      if (performance.now() >= deadline) break;
      for (let i = 0; i < pool.length; i++) pool[i].total += results[i];
    }
    if (!completed) return pool[0].action;
    // Use the rule score to break close calls in the rollout estimates.
    return pool.sort(
      (a, b) =>
        b.total / completed +
        b.value * rulePriorWeight -
        (a.total / completed + a.value * rulePriorWeight),
    )[0].action;
  }

  function choose(
    o,
    difficulty = "normal",
    seed = 1,
    budget = 250,
    rounds = difficulty === "hard" && o.counts.length === 4
      ? 2048
      : o.counts.length >= 4
        ? 256
        : 64,
  ) {
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
    const encode =
      difficulty === "hard" && o.counts.length === 8 && o.hand.length > 1
        ? actionFeatures(o)
        : null;
    const ranked = candidates
      .map((action) => {
        let value = score(o, action);
        if (encode) {
          const estimate = encode(action).reduce(
            (sum, feature, i) => sum + feature * eightPlayerValues[i],
            0,
          );
          value += (0.65 * estimate) / rulePriorWeight;
        }
        return { action, value, total: 0 };
      })
      .sort((a, b) => b.value - a.value);

    if (difficulty !== "hard" || ranked[0].value >= 1000 || ranked.length === 1)
      return ranked[0].action;
    return search(o, ranked, rng, budget, rounds);
  }
  return { choose, sample, score, actionFeatures };
};
WorkTimeApp.games.unoAi = WorkTimeApp.games.unoAiFactory(
  WorkTimeApp.games.unoRules,
);

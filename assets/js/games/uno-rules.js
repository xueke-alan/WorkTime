"use strict";

// Self-contained so the same rules can run in the simulation worker.
WorkTimeApp.games.unoRulesFactory = function () {
  const MAX_PLAYERS = 8;
  const DISCARD_LIMIT = 10;
  const TARGET_SCORES = [100, 200, 300, 500, 750, 1000];
  const colors = ["red", "yellow", "green", "blue"];
  const cards = [];
  for (const color of colors) {
    for (let value = 0; value <= 12; value++) {
      for (let copy = 0; copy < (value ? 2 : 1); copy++)
        cards.push({ id: cards.length, color, value });
    }
  }
  for (const value of [13, 14])
    for (let i = 0; i < 4; i++)
      cards.push({ id: cards.length, color: "wild", value });
  function random(s) {
    let x = s.rng >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    s.rng = x >>> 0 || 1;
    return s.rng / 4294967296;
  }
  function shuffle(a, s) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random(s) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const next = (s, steps = 1) =>
    (s.turn + s.direction * steps + s.hands.length * 2) % s.hands.length;
  function create(
    count = 4,
    difficulty = "normal",
    seed = 1,
    targetScore = 500,
  ) {
    if (!Number.isInteger(count) || count < 2 || count > MAX_PLAYERS)
      throw Error("Invalid player count");
    if (!["easy", "normal", "hard"].includes(difficulty))
      throw Error("Invalid difficulty");
    if (!TARGET_SCORES.includes(targetScore))
      throw Error("Invalid target score");
    const s = {
      hands: Array.from({ length: count }, () => []),
      deck: [],
      discard: [],
      color: "red",
      turn: 0,
      direction: 1,
      drawn: null,
      blocked: 0,
      status: "playing",
      winner: null,
      difficulty,
      rng: seed >>> 0 || 1,
      appearanceSeed: seed >>> 0 || 1,
      discardLimit: DISCARD_LIMIT,
      targetScore,
      actions: 0,
      log: [],
    };
    s.rulesVersion = 2;
    s.round = 1;
    s.scores = Array(count).fill(0);
    s.roundPoints = null;
    s.matchWinner = null;
    // Draw from a complete shuffled pack; only players tied for highest redraw.
    let contenders = s.hands.map((_, i) => i);
    while (contenders.length > 1) {
      const pack = shuffle(
        cards.map((c) => c.id),
        s,
      );
      const draws = contenders.map((player) => {
        const value = cards[pack.pop()].value;
        return { player, value: value <= 9 ? value : 0 };
      });
      const highest = Math.max(...draws.map((d) => d.value));
      contenders = draws
        .filter((d) => d.value === highest)
        .map((d) => d.player);
    }
    s.dealer = contenders[0];
    return deal(s);
  }
  function deal(s) {
    s.hands = s.hands.map(() => []);
    s.deck = shuffle(
      cards.map((c) => c.id),
      s,
    );
    s.discard = [];
    s.direction = 1;
    s.drawn = null;
    s.blocked = 0;
    s.status = "playing";
    s.winner = null;
    s.roundPoints = null;
    s.openingColor = false;
    s.actions = 0;
    s.log = [];
    for (let round = 0; round < 7; round++)
      for (let offset = 1; offset <= s.hands.length; offset++)
        s.hands[(s.dealer + offset) % s.hands.length].push(s.deck.pop());
    let opening;
    do {
      opening = s.deck.pop();
      if (cards[opening].value === 14) {
        s.deck.push(opening);
        shuffle(s.deck, s);
      }
    } while (cards[opening].value === 14);
    s.discard = [opening];
    const card = cards[opening];
    s.color = card.color === "wild" ? "red" : card.color;
    s.turn = (s.dealer + 1) % s.hands.length;
    if (card.value === 13) s.openingColor = true;
    if (card.value === 11) {
      s.direction = -1;
      s.turn = s.dealer;
    }
    if (card.value === 12) {
      take(s, s.turn, 2);
      s.log.push({ player: s.turn, type: "draw", count: 2 });
    }
    if (card.value === 10 || card.value === 12) s.turn = next(s);
    return s;
  }
  const points = (hand) =>
    hand.reduce((total, id) => {
      const value = cards[id].value;
      return total + (value <= 9 ? value : value >= 13 ? 50 : 20);
    }, 0);
  function settle(s, winner) {
    s.status = "won"; // A completed round; matchWinner distinguishes the final round.
    s.winner = winner;
    s.roundPoints = s.hands.map(points);
    s.scores[winner] += s.roundPoints.reduce((a, b) => a + b, 0);
    s.matchWinner = s.scores[winner] >= (s.targetScore ?? 500) ? winner : null;
  }
  function nextRound(state) {
    if (!["won", "draw"].includes(state.status) || state.matchWinner !== null)
      return null;
    const s = JSON.parse(JSON.stringify(state));
    s.round++;
    s.dealer = (s.dealer + 1) % s.hands.length;
    return deal(s);
  }
  function playable(s, id) {
    const c = cards[id],
      top = cards[s.discard[s.discard.length - 1]];
    if (!c) return false;
    if (c.value === 14)
      return !s.hands[s.turn].some((other) => cards[other].color === s.color);
    return c.value === 13 || c.color === s.color || c.value === top.value;
  }
  function legal(s) {
    if (s.status !== "playing") return [];
    if (s.openingColor)
      return colors.map((color) => ({ type: "color", color }));
    const result = [];
    for (const id of s.hands[s.turn]) {
      if ((s.drawn !== null && id !== s.drawn) || !playable(s, id)) continue;
      for (const color of cards[id].value >= 13 ? colors : [cards[id].color])
        result.push({ type: "play", card: id, color });
    }
    result.push({ type: s.drawn === null ? "draw" : "pass" });
    return result;
  }
  function recycle(s) {
    if (s.deck.length || s.discard.length < 2) return false;
    const top = s.discard.at(-1);
    s.deck = shuffle(s.discard.slice(0, -1), s);
    s.discard = [top];
    return true;
  }
  function refill(state) {
    if (
      state.status !== "playing" ||
      state.deck.length ||
      state.discard.length < 2
    )
      return null;
    const s = JSON.parse(JSON.stringify(state));
    recycle(s);
    return s;
  }
  function take(s, player, count) {
    const taken = [];
    while (taken.length < count) {
      recycle(s);
      if (!s.deck.length) break;
      const id = s.deck.pop();
      s.hands[player].push(id);
      taken.push(id);
      recycle(s);
    }
    return taken;
  }
  function apply(state, action) {
    if (
      !action ||
      !legal(state).some(
        (a) =>
          a.type === action.type &&
          a.card === action.card &&
          a.color === action.color,
      )
    )
      return null;
    const s = JSON.parse(JSON.stringify(state));
    const player = s.turn;
    const event = { player, type: action.type };
    s.actions++;
    if (action.type === "color") {
      s.color = action.color;
      s.openingColor = false;
      event.color = action.color;
    } else if (action.type === "play") {
      const card = cards[action.card];
      s.hands[player].splice(s.hands[player].indexOf(card.id), 1);
      s.discard.push(card.id);
      s.color = action.color;
      s.drawn = null;
      s.blocked = 0;
      event.card = card.id;
      event.color = action.color;
      let steps = 1;
      if (card.value === 11) {
        s.direction *= -1;
        if (s.hands.length === 2) steps = 2;
      }
      if (card.value === 10) steps = 2;
      if (card.value === 12 || card.value === 14) {
        event.target = next(s);
        event.count = take(s, event.target, card.value === 12 ? 2 : 4).length;
        steps = 2;
      }
      if (!s.hands[player].length) settle(s, player);
      else s.turn = next(s, steps);
      event.uno = s.hands[player].length === 1;
    } else if (action.type === "draw") {
      const taken = take(s, player, 1);
      event.count = taken.length;
      if (taken.length) {
        s.blocked = 0;
        s.drawn = taken[0];
        if (!playable(s, s.drawn)) {
          s.drawn = null;
          s.turn = next(s);
        }
      } else {
        const hasPlay = legal(state).some((a) => a.type === "play");
        s.blocked = hasPlay ? 0 : s.blocked + 1;
        s.turn = next(s);
        if (s.blocked >= s.hands.length) s.status = "draw";
      }
    } else {
      s.drawn = null;
      s.turn = next(s);
    }
    recycle(s);
    s.log = [...s.log, event].slice(-16);
    return s;
  }
  function observe(s) {
    return {
      rulesVersion: s.rulesVersion,
      targetScore: s.targetScore ?? 500,
      round: s.round,
      dealer: s.dealer,
      scores: s.scores.slice(),
      roundPoints: null,
      matchWinner: null,
      openingColor: s.openingColor,
      hand: s.hands[s.turn].slice(),
      counts: s.hands.map((h) => h.length),
      discard: s.discard.slice(),
      color: s.color,
      turn: s.turn,
      direction: s.direction,
      drawn: s.drawn,
      blocked: s.blocked,
      difficulty: s.difficulty,
      actions: s.actions,
      log: JSON.parse(JSON.stringify(s.log)),
    };
  }
  function restore(input) {
    if (!input || typeof input !== "object") return null;
    const s = { ...input };
    const legacy = s.rulesVersion === undefined;
    const appearanceSeed = s.appearanceSeed ?? s.rng;
    const discardLimit = s.discardLimit ?? DISCARD_LIMIT;
    const targetScore = s.targetScore === undefined ? 500 : s.targetScore;
    const uint = (x) => Number.isSafeInteger(x) && x >= 0;
    if (
      !Array.isArray(s.hands) ||
      s.hands.length < 2 ||
      s.hands.length > MAX_PLAYERS ||
      !s.hands.every(Array.isArray) ||
      !Array.isArray(s.deck) ||
      !Array.isArray(s.discard) ||
      !s.discard.length
    )
      return null;
    const all = [...s.hands.flat(), ...s.deck, ...s.discard];
    if (
      all.length !== 108 ||
      new Set(all).size !== 108 ||
      !all.every((id) => uint(id) && id < 108) ||
      !uint(s.turn) ||
      s.turn >= s.hands.length ||
      ![1, -1].includes(s.direction) ||
      !colors.includes(s.color) ||
      !["easy", "normal", "hard"].includes(s.difficulty) ||
      !uint(s.rng) ||
      s.rng === 0 ||
      s.rng > 4294967295 ||
      !uint(appearanceSeed) ||
      appearanceSeed > 4294967295 ||
      !TARGET_SCORES.includes(targetScore) ||
      !uint(discardLimit) ||
      discardLimit < 1 ||
      discardLimit > 15 ||
      !uint(s.actions) ||
      !uint(s.blocked) ||
      s.blocked > s.hands.length ||
      !["playing", "won", "draw"].includes(s.status)
    )
      return null;
    if (s.status === "won") {
      if (
        !uint(s.winner) ||
        s.winner !== s.turn ||
        s.hands[s.winner].length !== 0 ||
        s.hands.some((h, i) => i !== s.winner && !h.length)
      )
        return null;
    } else if (s.winner !== null || s.hands.some((h) => !h.length)) return null;
    if (
      s.drawn !== null &&
      (s.status !== "playing" ||
        !s.hands[s.turn].includes(s.drawn) ||
        !playable(s, s.drawn))
    )
      return null;
    const top = cards[s.discard[s.discard.length - 1]];
    if (top.value < 13 && top.color !== s.color) return null;
    if (
      s.status === "draw" &&
      (s.blocked !== s.hands.length ||
        s.deck.length ||
        s.discard.length !== 1 ||
        s.hands.some((_, turn) =>
          legal({ ...s, status: "playing", turn }).some(
            (a) => a.type === "play",
          ),
        ))
    )
      return null;
    if (
      !Array.isArray(s.log) ||
      s.log.length > 16 ||
      !s.log.every(
        (e) =>
          e &&
          uint(e.player) &&
          e.player < s.hands.length &&
          ["play", "draw", "pass", "color"].includes(e.type) &&
          (e.type !== "color" || colors.includes(e.color)) &&
          (e.type !== "play" ||
            (uint(e.card) && e.card < 108 && colors.includes(e.color))) &&
          (e.count === undefined || (uint(e.count) && e.count <= 4)) &&
          (e.target === undefined ||
            (uint(e.target) && e.target < s.hands.length)),
      )
    )
      return null;
    if (legacy) {
      Object.assign(s, {
        rulesVersion: 2,
        round: 1,
        dealer: (s.turn + s.hands.length - 1) % s.hands.length,
        scores: s.hands.map(() => 0),
        roundPoints: null,
        matchWinner: null,
        openingColor: false,
      });
      if (s.status === "won") settle(s, s.winner);
    }
    if (
      s.rulesVersion !== 2 ||
      !uint(s.round) ||
      s.round < 1 ||
      !uint(s.dealer) ||
      s.dealer >= s.hands.length ||
      typeof s.openingColor !== "boolean" ||
      !Array.isArray(s.scores) ||
      s.scores.length !== s.hands.length ||
      !s.scores.every(uint) ||
      (s.matchWinner !== null && s.matchWinner !== s.winner)
    )
      return null;
    if (s.status === "won") {
      const expected = s.hands.map(points);
      const earned = expected.reduce((a, b) => a + b, 0);
      if (
        !Array.isArray(s.roundPoints) ||
        JSON.stringify(s.roundPoints) !== JSON.stringify(expected) ||
        s.scores[s.winner] < earned ||
        s.scores[s.winner] - earned >= targetScore ||
        s.matchWinner !==
          (s.scores[s.winner] >= targetScore ? s.winner : null) ||
        s.scores.some((score, i) => i !== s.winner && score >= targetScore)
      )
        return null;
    } else if (
      s.roundPoints !== null ||
      s.matchWinner !== null ||
      s.scores.some((score) => score >= targetScore)
    )
      return null;
    if (
      s.openingColor &&
      (s.status !== "playing" ||
        top.value !== 13 ||
        s.discard.length !== 1 ||
        s.drawn !== null ||
        s.actions !== 0 ||
        s.turn !== (s.dealer + 1) % s.hands.length ||
        s.direction !== 1 ||
        s.hands.some((h) => h.length !== 7) ||
        s.log.length)
    )
      return null;
    // Keep only the supported schema when importing untrusted backups.
    return JSON.parse(
      JSON.stringify(
        Object.fromEntries(
          [
            "rulesVersion",
            "round",
            "dealer",
            "scores",
            "roundPoints",
            "matchWinner",
            "openingColor",
            "hands",
            "deck",
            "discard",
            "color",
            "turn",
            "direction",
            "drawn",
            "blocked",
            "status",
            "winner",
            "difficulty",
            "rng",
            "actions",
            "log",
          ]
            .map((key) => [key, s[key]])
            .concat([
              ["appearanceSeed", appearanceSeed],
              ["discardLimit", DISCARD_LIMIT],
              ["targetScore", targetScore],
            ]),
        ),
      ),
    );
  }
  return {
    MAX_PLAYERS,
    DISCARD_LIMIT,
    TARGET_SCORES,
    cards,
    colors,
    create,
    nextRound,
    points,
    legal,
    apply,
    refill,
    observe,
    restore,
    random,
    shuffle,
    next,
  };
};
WorkTimeApp.games.unoRules = WorkTimeApp.games.unoRulesFactory();

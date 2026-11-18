"use strict";

// Match statistics and ranking are separate from the UNO card rules and AI.
WorkTimeApp.games.unoRanking = (() => {
  const LIMIT = 1500;
  const HISTORY_LIMIT = 200;
  const BASE = {
    4: Object.freeze([24, 8, -8, -22]),
    6: Object.freeze([24, 14, 5, -5, -14, -22]),
    8: Object.freeze([24, 17, 10, 3, -3, -10, -16, -22]),
  };
  const rankedCount = (count) => Object.hasOwn(BASE, count);
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  const integer = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
  const isMode = (mode) => mode === "normal" || mode === "ranked";
  const validId = (id) => typeof id === "string" && /^[\w-]{1,128}$/.test(id);
  const emptyProfile = () => ({ rating: 0, history: [] });
  const newMatch = (id, mode) => ({
    id,
    mode,
    completedRounds: 0,
    decisive: 0,
    wins: 0,
    burden: 0,
    settled: false,
  });

  function tier(rating) {
    const step = Math.min(14, Math.floor(rating / 100));
    return {
      name: ["iron", "silver", "gold", "diamond", "king"][Math.floor(step / 3)],
      division: ["III", "II", "I"][step % 3],
      progress: rating === LIMIT ? 100 : rating % 100,
    };
  }

  function rankedSettings(rating) {
    if (rating < 300) return { players: 4, difficulty: "easy" };
    if (rating < 900) return { players: 6, difficulty: "normal" };
    return { players: 8, difficulty: "hard" };
  }

  function matchesRankedSettings(players, rating, difficulty) {
    const expected = rankedSettings(rating);
    // Earlier ranked saves had four players, and originally used normal AI.
    if (players === 4)
      return (
        difficulty === undefined ||
        difficulty === "normal" ||
        difficulty === expected.difficulty
      );
    return (
      players === expected.players &&
      (difficulty === undefined || difficulty === expected.difficulty)
    );
  }

  function countRound(match, state) {
    if (state.status === "playing") return;
    match.completedRounds++;
    if (state.status !== "won") return;
    match.decisive++;
    if (state.winner === 0) match.wins++;
    else if (match.mode === "ranked") {
      const otherLosers = state.roundPoints.filter(
        (_, i) => i !== 0 && i !== state.winner,
      );
      // Store the numerator so the aggregate stays an exact integer.
      match.burden +=
        otherLosers.reduce((sum, points) => sum + points, 0) -
        otherLosers.length * state.roundPoints[0];
    }
  }

  function placement(scores) {
    return {
      place: 1 + scores.filter((score) => score > scores[0]).length,
      tied: scores.filter((score) => score === scores[0]).length,
    };
  }

  function ratingChange(sum) {
    return clamp(Math.sign(sum) * Math.round(Math.abs(sum)), -32, 36);
  }

  function basePoints(players, place, tied) {
    return (
      BASE[players]
        .slice(place - 1, place - 1 + tied)
        .reduce((a, b) => a + b, 0) / tied
    );
  }

  function adjustment(match, players, place, tied) {
    const base = basePoints(players, place, tied);
    const winRate = clamp(
      ((match.decisive ? match.wins / match.decisive : 0) - 1 / players) * 16,
      -4,
      8,
    );
    const losses = match.decisive - match.wins;
    const hand = losses
      ? clamp(match.burden / (10 * (players - 2) * losses), -6, 6)
      : 0;
    const requested = ratingChange(base + winRate + hand);
    return { base, winRate, hand, requested };
  }

  function settle(profile, match, state, endedAt, abandoned = false) {
    if (
      match.settled ||
      profile.history.some((record) => record.id === match.id) ||
      (abandoned
        ? match.mode !== "ranked" || state.matchWinner !== null
        : state.matchWinner === null)
    )
      return null;
    const { place, tied } = placement(state.scores);
    const detail =
      match.mode !== "ranked" || abandoned
        ? null
        : adjustment(match, state.hands.length, place, tied);
    const requested = abandoned ? -15 : (detail?.requested ?? 0);
    const before = profile.rating;
    const after = clamp(before + requested, 0, LIMIT);
    const record = {
      id: match.id,
      mode: match.mode,
      endedAt,
      result: abandoned
        ? "abandoned"
        : state.matchWinner === 0
          ? "victory"
          : "defeat",
      place: abandoned ? null : place,
      tied: abandoned ? null : tied,
      points: state.scores[0],
      rounds: match.completedRounds,
      players: state.hands.length,
      before,
      after,
      delta: after - before,
      detail,
    };
    match.settled = true;
    profile.rating = after;
    profile.history = [record, ...profile.history].slice(0, HISTORY_LIMIT);
    return record;
  }

  function restoreProfile(raw) {
    if (raw === undefined) return emptyProfile();
    if (
      !raw ||
      !integer(raw.rating, LIMIT) ||
      !Array.isArray(raw.history) ||
      raw.history.length > HISTORY_LIMIT
    )
      return null;
    const ids = new Set();
    const history = [];
    for (const row of raw.history) {
      if (
        !row ||
        !validId(row.id) ||
        ids.has(row.id) ||
        !isMode(row.mode) ||
        !integer(row.endedAt, 8640000000000000) ||
        !integer(row.players, 8) ||
        row.players < 2 ||
        (row.mode === "ranked" && !rankedCount(row.players)) ||
        !integer(row.points, 65535) ||
        !integer(row.rounds, 4294967295) ||
        !integer(row.before, LIMIT) ||
        !integer(row.after, LIMIT) ||
        row.delta !== row.after - row.before ||
        (row.mode === "ranked" &&
          !matchesRankedSettings(row.players, row.before))
      )
        return null;
      const {
        id,
        mode,
        endedAt,
        result,
        place,
        tied,
        points,
        rounds,
        players,
        before,
        after,
        delta,
      } = row;
      const detail = row.detail;
      if (result === "abandoned") {
        if (
          mode !== "ranked" ||
          place !== null ||
          tied !== null ||
          detail !== null ||
          after !== clamp(before - 15, 0, LIMIT)
        )
          return null;
      } else {
        if (
          !(result === "victory" || result === "defeat") ||
          !integer(place, players) ||
          place < 1 ||
          !integer(tied, players - place + 1) ||
          tied < 1 ||
          (place === 1) !== (result === "victory")
        )
          return null;
        if (mode === "normal") {
          if (detail !== null || delta !== 0) return null;
        } else {
          const expectedBase = basePoints(players, place, tied);
          if (
            !detail ||
            detail.base !== expectedBase ||
            !Number.isFinite(detail.winRate) ||
            detail.winRate < -4 ||
            detail.winRate > 8 ||
            !Number.isFinite(detail.hand) ||
            detail.hand < -6 ||
            detail.hand > 6
          )
            return null;
          const sum = detail.base + detail.winRate + detail.hand;
          if (
            detail.requested !== ratingChange(sum) ||
            after !== clamp(before + detail.requested, 0, LIMIT)
          )
            return null;
        }
      }
      ids.add(id);
      history.push({
        id,
        mode,
        endedAt,
        result,
        place,
        tied,
        points,
        rounds,
        players,
        before,
        after,
        delta,
        detail: detail && {
          base: detail.base,
          winRate: detail.winRate,
          hand: detail.hand,
          requested: detail.requested,
        },
      });
    }
    if (
      (history[0]?.after ?? 0) !== raw.rating ||
      history.some((row, i) => i > 0 && row.after !== history[i - 1].before)
    )
      return null;
    return { rating: raw.rating, history };
  }

  function restoreMatch(raw, state, profile) {
    if (
      !raw ||
      !validId(raw.id) ||
      !isMode(raw.mode) ||
      typeof raw.settled !== "boolean" ||
      !integer(raw.completedRounds, state.round) ||
      !integer(raw.decisive, raw.completedRounds) ||
      !integer(raw.wins, raw.decisive) ||
      !Number.isSafeInteger(raw.burden) ||
      Math.abs(raw.burden) >
        5400 * Math.max(2, state.hands.length - 2) * (raw.decisive - raw.wins)
    )
      return null;
    const record = profile.history.find((entry) => entry.id === raw.id);
    if (
      raw.mode === "ranked" &&
      (!matchesRankedSettings(
        state.hands.length,
        record?.before ?? profile.rating,
        state.difficulty,
      ) ||
        state.targetScore !== 500 ||
        raw.completedRounds !==
          state.round - (state.status === "playing" ? 1 : 0))
    )
      return null;
    if (
      raw.settled !== Boolean(record) ||
      raw.settled !== (state.matchWinner !== null) ||
      (record &&
        (record.mode !== raw.mode ||
          record.result !== (state.matchWinner === 0 ? "victory" : "defeat") ||
          record.points !== state.scores[0] ||
          record.rounds !== raw.completedRounds ||
          record.players !== state.hands.length))
    )
      return null;
    if (record) {
      const { place, tied } = placement(state.scores);
      if (record.place !== place || record.tied !== tied) return null;
      if (raw.mode === "ranked") {
        const expected = adjustment(raw, state.hands.length, place, tied);
        if (
          Object.keys(expected).some(
            (key) => expected[key] !== record.detail?.[key],
          )
        )
          return null;
      }
    }
    const { id, mode, completedRounds, decisive, wins, burden, settled } = raw;
    return { id, mode, completedRounds, decisive, wins, burden, settled };
  }

  return {
    emptyProfile,
    newMatch,
    tier,
    rankedSettings,
    countRound,
    settle,
    restoreProfile,
    restoreMatch,
  };
})();

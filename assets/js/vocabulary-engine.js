"use strict";
WorkTimeApp.services.vocabularyEngine = (() => {
  const key = (id, mode) => mode + ":" + id;
  const day = (now) => {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const normalize = (text) =>
    text
      .normalize("NFKC")
      .trim()
      .replace(/[’‘]/g, "'")
      .replace(/[.!?]+$/, "")
      .toLowerCase();
  function correct(entry, answer) {
    return [entry.word, ...(entry.variants || [])].some(
      (word) => normalize(word) === normalize(answer),
    );
  }
  // Intraday retrieval practice is separate from the long-term FSRS card.
  function familiarity(card) {
    if (!card) return 0;
    return (
      0.65 * Math.min(1, Math.log1p(card.stability) / Math.log(31)) +
      (0.25 * (10 - card.difficulty)) / 9 +
      0.1 / (1 + card.lapses)
    );
  }
  function practiceGap(practice, grade) {
    const f = familiarity(practice.baseline);
    const base = grade === 1 ? 2 + 4 * f : grade === 2 ? 4 + 6 * f : 6 + 6 * f;
    return Math.max(
      1,
      Math.round(base * 0.75 ** Math.max(0, practice.failures - 1)),
    );
  }
  function preview(data, entry, mode, grade, now = Date.now()) {
    const id = key(entry.id, mode);
    const existing = data.reinforcement?.[id];
    const practice = existing
      ? structuredClone(existing)
      : {
          baseline: data.cards[id] ?? null,
          required: 1,
          successes: 0,
          failures: 0,
        };
    if (grade < 3) {
      practice.failures++;
      practice.successes = 0;
      if (grade === 1) practice.required = 2;
    } else if (existing) practice.successes++;
    if (grade < 3 || (existing && practice.successes < practice.required))
      return {
        gap: practiceGap(practice, grade),
        remaining: practice.required - practice.successes,
      };
    return {
      gap: 0,
      remaining: 0,
      card: existing
        ? data.cards[id]
        : schedule(data.cards[id], grade, now).card,
    };
  }
  function queue(data, entries, now = Date.now()) {
    const { book, mode } = data.settings;
    const dailyTotal = data.settings.dailyTotal ?? data.settings.dailyNew;
    const eligible = entries.filter(
      (e) =>
        e.books.includes(book) && !(e.kind === "phrase" && mode === "spelling"),
    );
    const completed = new Set(
      data.logs.filter((l) => day(l.at) === day(now)).map((l) => l.id),
    );
    for (const pending of Object.values(data.reinforcement || {}))
      completed.add(pending.id);
    const allDue = eligible.filter(
      (e) =>
        !data.reinforcement?.[key(e.id, mode)] &&
        data.cards[key(e.id, mode)] &&
        day(data.cards[key(e.id, mode)].last_review) !== day(now) &&
        Date.parse(data.cards[key(e.id, mode)].due) <= +new Date(now),
    );
    allDue.sort(
      (a, b) =>
        Date.parse(data.cards[key(a.id, mode)].due) -
        Date.parse(data.cards[key(b.id, mode)].due),
    );
    const available = Math.max(0, dailyTotal - completed.size);
    const due = allDue.slice(0, available);
    const candidates = eligible.filter((e) => !data.cards[key(e.id, mode)]);
    if (data.settings.wordOrder === "random") {
      const rank = (id) => {
        let hash = (data.settings.orderSeed ?? 0) >>> 0;
        for (let i = 0; i < id.length; i++)
          hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
        hash ^= hash >>> 16;
        hash = Math.imul(hash, 0x85ebca6b);
        hash ^= hash >>> 13;
        return hash >>> 0;
      };
      const ranks = new Map(
        candidates.map((entry) => [entry.id, rank(entry.id)]),
      );
      candidates.sort(
        (a, b) => ranks.get(a.id) - ranks.get(b.id) || a.id.localeCompare(b.id),
      );
    }
    const fresh = candidates.slice(0, available - due.length);
    const practice = eligible.filter(
      (e) => data.reinforcement?.[key(e.id, mode)],
    );
    // Earlier deadlines win. At the tail, prefer a different word whenever possible.
    practice.sort((a, b) => {
      const pa = data.reinforcement[key(a.id, mode)];
      const pb = data.reinforcement[key(b.id, mode)];
      return (
        pa.gap - pa.seen.length - (pb.gap - pb.seen.length) ||
        Date.parse(pa.lastAt) - Date.parse(pb.lastAt) ||
        a.id.localeCompare(b.id)
      );
    });
    const ready = practice.filter((e) => {
      const p = data.reinforcement[key(e.id, mode)];
      return p.seen.length >= p.gap;
    });
    const waiting = practice.filter((e) => !ready.includes(e));
    const regular = [...due, ...fresh];
    let items = [...ready, ...regular, ...waiting];
    const last = data.logs.findLast((log) => log.mode === mode)?.id;
    if (
      !ready.length &&
      !regular.length &&
      items.length > 1 &&
      items[0].id === last
    )
      items = [...items.slice(1), items[0]];
    return {
      due,
      fresh,
      allDue: allDue.length,
      practice,
      early: !ready.length && !regular.length && waiting.length > 0,
      items,
    };
  }
  function bookDistribution(data, entries, book = data.settings.book) {
    const counts = { familiar: 0, average: 0, unfamiliar: 0, unlearned: 0 };
    for (const entry of entries) {
      if (!entry.books.includes(book)) continue;
      const card = data.cards[key(entry.id, data.settings.mode)];
      if (!card) counts.unlearned++;
      else if (card.state !== 2 || card.scheduled_days < 7) counts.unfamiliar++;
      else if (card.scheduled_days < 30) counts.average++;
      else counts.familiar++;
    }
    return counts;
  }
  function schedule(previous, grade, now = Date.now()) {
    const result = globalThis.WorkTimeFSRS.review(previous, grade, now);
    const earliest = new Date(now);
    earliest.setDate(earliest.getDate() + 1);
    if (Date.parse(result.card.due) < +earliest) {
      result.card.due = earliest.toISOString();
      result.card.scheduled_days = 1;
    }
    return result;
  }
  function estimateLearningDays(data, entries, book = data.settings.book) {
    const counts = bookDistribution(
      data,
      entries.filter(
        (entry) =>
          !(entry.kind === "phrase" && data.settings.mode === "spelling"),
      ),
      book,
    );
    // Remaining practice workload, not calendar duration or a memory prediction.
    const workload =
      counts.unlearned * 4 + counts.unfamiliar * 3 + counts.average;
    return Math.ceil(
      workload / (data.settings.dailyTotal ?? data.settings.dailyNew),
    );
  }
  function review(data, entry, mode, grade, now = Date.now()) {
    const next = structuredClone(data),
      id = key(entry.id, mode),
      previous = next.cards[id];
    if (![1, 2, 3, 4].includes(grade)) throw Error("Invalid review grade");
    next.reinforcement ??= {};
    const existing = next.reinforcement[id];
    const at = new Date(now).toISOString();
    for (const [otherKey, pending] of Object.entries(next.reinforcement)) {
      if (
        otherKey !== id &&
        pending.mode === mode &&
        pending.id !== entry.id &&
        pending.seen.length < pending.gap &&
        !pending.seen.includes(entry.id)
      )
        pending.seen.push(entry.id);
    }
    let pending = existing;
    if (!existing) next.cards[id] = schedule(previous, grade, now).card;
    if (grade < 3) {
      pending ??= {
        id: entry.id,
        mode,
        baseline: previous ?? null,
        firstAt: at,
        worstGrade: grade,
        required: 1,
        successes: 0,
        failures: 0,
      };
      if (grade < pending.worstGrade) {
        pending.worstGrade = grade;
        next.cards[id] = schedule(
          pending.baseline,
          grade,
          Date.parse(pending.firstAt),
        ).card;
      }
      pending.failures++;
      pending.successes = 0;
      if (grade === 1) pending.required = 2;
    } else if (pending) pending.successes++;
    const complete = !pending || pending.successes >= pending.required;
    if (complete) {
      delete next.reinforcement[id];
      const earliest = new Date(now);
      earliest.setDate(earliest.getDate() + 1);
      if (Date.parse(next.cards[id].due) < +earliest) {
        next.cards[id].due = earliest.toISOString();
        next.cards[id].scheduled_days = Math.max(
          1,
          Math.ceil(
            (+earliest - Date.parse(next.cards[id].last_review)) / 86400000,
          ),
        );
      }
    } else {
      pending.gap = practiceGap(pending, grade);
      pending.seen = [];
      pending.lastAt = at;
      next.reinforcement[id] = pending;
    }
    next.logs.push({
      id: entry.id,
      mode,
      grade,
      at,
      first: !data.logs.some((log) => log.id === entry.id),
      practice: !!existing,
      completed: complete,
    });
    // Keep aggregates accurate: stop accepting reviews at the archive limit instead of silently dropping history.
    if (next.logs.length > 200000) throw Error("Review log limit reached");
    next.draft = null;
    return next;
  }
  function statistics(data, now = Date.now()) {
    const today = data.logs.filter((l) => day(l.at) === day(now));
    const pending = new Set(
      Object.values(data.reinforcement || {}).map((p) => p.id),
    );
    const completed = new Set(
      today
        .filter((l) => l.completed !== false && !pending.has(l.id))
        .map((l) => l.id),
    );
    const newIds = new Set(today.filter((l) => l.first).map((l) => l.id));
    const days = new Set(data.logs.map((l) => day(l.at)));
    let streak = 0,
      cursor = new Date(now);
    if (!days.has(day(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (days.has(day(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return {
      today: completed.size,
      newLearned: [...completed].filter((id) => newIds.has(id)).length,
      reviewCount: [...completed].filter((id) => !newIds.has(id)).length,
      correct: new Set(
        today
          .filter((l) => l.grade > 1 && completed.has(l.id))
          .map((l) => l.id),
      ).size,
      learned: new Set(data.logs.map((l) => l.id)).size,
      streak,
    };
  }
  function analysis(data, now = Date.now()) {
    const days = [];
    for (let offset = 34; offset >= 0; offset--) {
      const date = new Date(now);
      date.setDate(date.getDate() - offset);
      days.push({ day: day(date), fresh: 0, reviews: 0, correct: 0 });
    }
    const indexed = new Map(days.map((row) => [row.day, row]));
    const latest = new Map();
    for (const log of data.logs) {
      const row = indexed.get(day(log.at));
      if (row && !log.practice) {
        if (log.first) row.fresh++;
        else row.reviews++;
        if (log.grade > 1) row.correct++;
      }
      if (!log.practice || log.grade < 3) latest.set(log.id, log.grade);
    }
    const feedback = [0, 0, 0, 0];
    for (const grade of latest.values()) feedback[grade - 1]++;
    return { days, feedback, total: data.logs.length, learned: latest.size };
  }
  return {
    key,
    day,
    normalize,
    correct,
    preview,
    familiarity,
    queue,
    bookDistribution,
    estimateLearningDays,
    schedule,
    review,
    statistics,
    analysis,
  };
})();

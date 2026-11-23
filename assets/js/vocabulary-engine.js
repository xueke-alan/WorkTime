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
  function queue(data, entries, now = Date.now()) {
    const { book, mode, dailyNew } = data.settings;
    const eligible = entries.filter(
      (e) =>
        e.books.includes(book) && !(e.kind === "phrase" && mode === "spelling"),
    );
    const introduced = new Set(
      data.logs
        .filter((l) => l.first && day(l.at) === day(now))
        .map((l) => l.id),
    );
    const due = eligible.filter(
      (e) =>
        data.cards[key(e.id, mode)] &&
        Date.parse(data.cards[key(e.id, mode)].due) <= +new Date(now),
    );
    due.sort(
      (a, b) =>
        Date.parse(data.cards[key(a.id, mode)].due) -
        Date.parse(data.cards[key(b.id, mode)].due),
    );
    const known = new Set(data.logs.map((l) => l.id));
    let available = Math.max(0, dailyNew - introduced.size);
    const fresh = eligible.filter((e) => {
      if (data.cards[key(e.id, mode)]) return false;
      if (known.has(e.id)) return true;
      if (available > 0) {
        available--;
        return true;
      }
      return false;
    });
    return { due, fresh, items: [...due, ...fresh] };
  }
  function review(data, entry, mode, grade, now = Date.now()) {
    const next = structuredClone(data),
      id = key(entry.id, mode),
      previous = next.cards[id];
    const result = globalThis.WorkTimeFSRS.review(previous, grade, now);
    next.cards[id] = result.card;
    next.logs.push({
      id: entry.id,
      mode,
      grade,
      at: new Date(now).toISOString(),
      first: !data.logs.some((log) => log.id === entry.id),
    });
    // Keep aggregates accurate: stop accepting reviews at the archive limit instead of silently dropping history.
    if (next.logs.length > 200000) throw Error("Review log limit reached");
    next.draft = null;
    return next;
  }
  function statistics(data, now = Date.now()) {
    const today = data.logs.filter((l) => day(l.at) === day(now));
    const days = new Set(data.logs.map((l) => day(l.at)));
    let streak = 0,
      cursor = new Date(now);
    if (!days.has(day(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (days.has(day(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return {
      today: today.length,
      correct: today.filter((l) => l.grade > 1).length,
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
      if (row) {
        if (log.first) row.fresh++;
        else row.reviews++;
        if (log.grade > 1) row.correct++;
      }
      latest.set(log.id, log.grade);
    }
    const feedback = [0, 0, 0, 0];
    for (const grade of latest.values()) feedback[grade - 1]++;
    return { days, feedback, total: data.logs.length, learned: latest.size };
  }
  return { key, day, normalize, correct, queue, review, statistics, analysis };
})();

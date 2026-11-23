"use strict";
WorkTimeApp.services.vocabularyStorage = (() => {
  const ID = "worktime.vocabulary";
  let owner,
    commit = (operation) => operation;
  const defaults = () => ({
    version: 1,
    settings: {
      book: "daily",
      mode: "recall",
      accent: "us",
      dailyNew: 20,
      autoRead: true,
    },
    cards: {},
    logs: [],
    // Legacy archive field; retained for compatibility with version 1 backups.
    favorites: [],
    draft: null,
  });
  const modes = ["recall", "spelling", "dictation"];
  const books = ["daily", "cet6", "kaoyan", "toefl", "ielts"];
  function validate(data) {
    const bad = () => {
      throw Error("Invalid vocabulary archive / 单词学习存档无效");
    };
    const object = (v) => v && typeof v === "object" && !Array.isArray(v);
    const text = (v, max = 250) =>
      typeof v === "string" && v.length > 0 && v.length <= max;
    const date = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
    function safe(v) {
      if (!v || typeof v !== "object") return;
      for (const key of Object.keys(v)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) bad();
        safe(v[key]);
      }
    }
    safe(data);
    if (!object(data) || data.version !== 1 || !object(data.settings)) bad();
    // Migrate the retired book without discarding learning history.
    if (data.settings.book === "cet4") {
      data = structuredClone(data);
      data.settings.book = "daily";
      data.draft = null;
    }
    const s = data.settings;
    if (s.autoRead !== undefined && typeof s.autoRead !== "boolean") bad();
    if (
      !books.includes(s.book) ||
      !modes.includes(s.mode) ||
      !["us", "uk"].includes(s.accent) ||
      !Number.isInteger(s.dailyNew) ||
      s.dailyNew < 1 ||
      s.dailyNew > 200
    )
      bad();
    if (!object(data.cards) || Object.keys(data.cards).length > 150000) bad();
    for (const [key, c] of Object.entries(data.cards)) {
      if (
        !text(key, 300) ||
        !object(c) ||
        !date(c.due) ||
        !date(c.last_review) ||
        !Number.isInteger(c.state) ||
        c.state < 0 ||
        c.state > 3
      )
        bad();
      for (const name of [
        "stability",
        "difficulty",
        "elapsed_days",
        "scheduled_days",
        "reps",
        "lapses",
      ])
        if (!Number.isFinite(c[name]) || c[name] < 0) bad();
      if (c.difficulty > 10 || c.reps < 1) bad();
    }
    if (
      !Array.isArray(data.logs) ||
      data.logs.length > 200000 ||
      !Array.isArray(data.favorites) ||
      data.favorites.length > 50000 ||
      data.favorites.some((id) => !text(id))
    )
      bad();
    for (const log of data.logs)
      if (
        !object(log) ||
        !text(log.id) ||
        !modes.includes(log.mode) ||
        !date(log.at) ||
        !Number.isInteger(log.grade) ||
        log.grade < 1 ||
        log.grade > 4 ||
        typeof log.first !== "boolean"
      )
        bad();
    if (
      data.draft !== null &&
      (!object(data.draft) ||
        !text(data.draft.id) ||
        !modes.includes(data.draft.mode) ||
        typeof data.draft.answer !== "string" ||
        data.draft.answer.length > 500 ||
        typeof data.draft.revealed !== "boolean" ||
        ![null, true, false].includes(data.draft.correct))
    )
      bad();
    return structuredClone(data);
  }
  const find = (state) =>
    state?._archive?.unknownModules?.find((m) => m.id === ID);
  function validateModule(module) {
    if (
      module.version !== 1 ||
      !Array.isArray(module.records) ||
      module.records.length !== 1 ||
      module.records[0].id !== "main"
    )
      throw Error("Unsupported vocabulary module");
    return validate(module.records[0].data);
  }
  function attach(state, data) {
    return {
      ...state,
      _archive: {
        ...state._archive,
        unknownModules: [
          ...(state._archive?.unknownModules || []).filter((m) => m.id !== ID),
          {
            id: ID,
            version: 1,
            records: [{ id: "main", order: 0, data: validate(data) }],
          },
        ],
      },
    };
  }
  return {
    ID,
    defaults,
    validate,
    find,
    attach,
    validateModule,
    read() {
      const module = find(owner?.state);
      return module ? validateModule(module) : defaults();
    },
    bind(value, save = (operation) => operation) {
      owner = value;
      commit = save;
    },
    save(data) {
      if (!owner) throw Error("Vocabulary storage is not ready");
      return commit(owner.saveVocabulary(validate(data)));
    },
    subscribe(listener) {
      return owner.subscribe(listener);
    },
  };
})();

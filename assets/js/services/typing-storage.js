"use strict";
/** Learning data lives in the existing archive transaction and backup pipeline. */
WorkTimeApp.services.typingStorage = (() => {
  const ID = "worktime.typing";
  const defaults = () => ({
    version: 1,
    settings: {
      language: "en",
      dailyMinutes: 10,
      keyboard: true,
      fingers: true,
      sound: false,
    },
    unlocked: { en: 1, zh: 1 },
    lessons: {},
    attempts: [],
    articles: [],
    daily: {},
    weak: { en: {}, zh: {} },
    best: {},
    draft: null,
  });
  let owner = null,
    commit = (operation) => operation;
  function validate(value) {
    const invalid = () => {
      throw Error("Invalid typing archive / 打字学习存档无效");
    };
    const object = (v) => v && typeof v === "object" && !Array.isArray(v);
    const integer = (v, min, max) =>
      Number.isSafeInteger(v) && v >= min && v <= max;
    const number = (v, max = 1e12) => Number.isFinite(v) && v >= 0 && v <= max;
    const text = (v, max) => typeof v === "string" && v.length <= max;
    const forbidden = (v) => {
      if (!v || typeof v !== "object") return;
      for (const key of Object.keys(v)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) invalid();
        forbidden(v[key]);
      }
    };
    if (!object(value) || value.version !== 1) invalid();
    forbidden(value);
    const s = value.settings;
    if (
      !object(s) ||
      !["en", "zh"].includes(s.language) ||
      !integer(s.dailyMinutes, 1, 120) ||
      ["keyboard", "fingers", "sound"].some(
        (key) => typeof s[key] !== "boolean",
      )
    )
      invalid();
    if (
      !object(value.unlocked) ||
      !integer(value.unlocked.en, 1, 600) ||
      !integer(value.unlocked.zh, 1, 100)
    )
      invalid();
    if (!object(value.lessons) || Object.keys(value.lessons).length > 700)
      invalid();
    for (const [id, row] of Object.entries(value.lessons)) {
      if (
        !/^(en-\d{3}|zh-\d{3})$/.test(id) ||
        Number(id.slice(3)) < 1 ||
        Number(id.slice(3)) > (id.startsWith("en") ? 600 : 100) ||
        !object(row) ||
        !integer(row.stars, 0, 5) ||
        !number(row.speed) ||
        !number(row.accuracy, 100)
      )
        invalid();
    }
    if (
      !Array.isArray(value.attempts) ||
      value.attempts.length > 10000 ||
      !Array.isArray(value.articles) ||
      value.articles.length > 100
    )
      invalid();
    function session(row, draft = false) {
      if (
        !object(row) ||
        ((draft || row.events !== undefined) &&
          (!text(row.text, 20000) || !row.text.length)) ||
        !["en", "zh"].includes(row.language) ||
        ![
          "lesson",
          "test",
          "custom",
          "weak",
          "placement",
          "words",
          "race",
        ].includes(row.mode) ||
        !number(row.elapsed, 86400000) ||
        !number(row.goal, 1000) ||
        row.goal <= 0 ||
        !number(row.limit, 3600000)
      )
        invalid();
      if (
        draft &&
        (!Array.isArray(row.events) ||
          typeof row.started !== "boolean" ||
          typeof row.finished !== "boolean" ||
          (row.accounted !== undefined &&
            !integer(row.accounted, 0, Math.floor(row.elapsed))))
      )
        invalid();
      if (
        row.lessonId !== null &&
        (typeof row.lessonId !== "string" ||
          !new RegExp("^" + row.language + "-\\d{3}$").test(row.lessonId) ||
          !integer(
            Number(row.lessonId.slice(3)),
            1,
            row.language === "en" ? 600 : 100,
          ))
      )
        invalid();
      if (row.mode === "lesson" && row.lessonId === null) invalid();
      if (
        row.mode === "placement" &&
        !integer(row.placementChapter, 0, row.language === "en" ? 11 : 4)
      )
        invalid();
      if (
        ["words", "race"].includes(row.mode) &&
        !["easy", "normal", "hard"].includes(row.difficulty)
      )
        invalid();
      if (["words", "race", "test"].includes(row.mode) && row.limit === 0)
        invalid();
      if (
        draft &&
        (!text(row.input, 20000) ||
          !integer(row.attempts, 0, 1000000) ||
          !integer(row.correct, 0, row.attempts) ||
          !object(row.errors) ||
          Array.from(row.input).length > Array.from(row.text).length)
      )
        invalid();
      if (
        row.errors !== undefined &&
        (!object(row.errors) ||
          Object.entries(row.errors).some(
            ([key, n]) => !text(key, 4) || !integer(n, 0, 1000000),
          ))
      )
        invalid();
      if (row.events !== undefined) {
        if (!Array.isArray(row.events) || row.events.length > 20000) invalid();
        let previous = 0,
          length = 0;
        for (const event of row.events) {
          if (
            !object(event) ||
            !number(event.t, row.elapsed) ||
            event.t < previous ||
            !integer(event.from, 0, length) ||
            !text(event.insert, 20000)
          )
            invalid();
          previous = event.t;
          length = event.from + Array.from(event.insert).length;
          if (length > 20000) invalid();
        }
      }
    }
    for (const row of value.attempts) {
      session(row);
      if (
        !text(row.id, 100) ||
        !text(row.date, 10) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        !number(row.speed) ||
        !number(row.accuracy, 100) ||
        !integer(row.stars, 0, 5)
      )
        invalid();
    }
    if (value.attempts.filter((row) => row.events !== undefined).length > 200)
      invalid();
    for (const article of value.articles)
      if (
        !object(article) ||
        !text(article.id, 100) ||
        !text(article.title, 100) ||
        !text(article.text, 10000) ||
        !article.text.trim() ||
        !["en", "zh"].includes(article.language)
      )
        invalid();
    for (const key of ["daily", "best"]) {
      if (
        !object(value[key]) ||
        Object.values(value[key]).some((v) => !number(v))
      )
        invalid();
    }
    if (!object(value.weak)) invalid();
    for (const language of ["en", "zh"])
      if (
        !object(value.weak[language]) ||
        Object.entries(value.weak[language]).some(
          ([key, n]) => !text(key, 4) || !number(n),
        )
      )
        invalid();
    if (value.draft !== null) session(value.draft, true);
    return structuredClone(value);
  }
  function find(state) {
    return state?._archive?.unknownModules?.find((m) => m.id === ID);
  }
  function read() {
    const module = find(owner?.state);
    return module ? validateModule(module) : defaults();
  }
  function validateModule(module) {
    if (
      module.version !== 1 ||
      module.records.length !== 1 ||
      module.records[0].id !== "main"
    )
      throw Error("Unsupported typing module / 打字学习模块无效");
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
  async function save(data) {
    if (!owner) throw Error("Learning storage is not ready");
    return commit(owner.saveTyping(validate(data)));
  }
  return {
    ID,
    defaults,
    validate,
    validateModule,
    find,
    attach,
    read,
    save,
    subscribe(listener) {
      return owner.subscribe(listener);
    },
    bind(value, save = (operation) => operation) {
      commit = save;
      owner = value;
    },
  };
})();

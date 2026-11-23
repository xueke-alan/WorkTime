"use strict";
/** Deterministic typing rules. No DOM, timers, storage, or input-method assumptions. */
WorkTimeApp.services.typingEngine = (() => {
  const characters = (text) => Array.from(text.normalize("NFC"));
  const count = (text, language) =>
    language === "zh"
      ? characters(text).filter((c) => /[\p{L}\p{N}]/u.test(c)).length
      : characters(text).length / 5;
  function create({
    text,
    language = "en",
    goal = 10,
    mode = "lesson",
    limit = 0,
    lessonId = null,
  }) {
    return {
      text,
      language,
      goal,
      mode,
      limit,
      lessonId,
      input: "",
      elapsed: 0,
      attempts: 0,
      correct: 0,
      errors: {},
      events: [],
      started: false,
      finished: false,
    };
  }
  function input(state, value) {
    if (state.finished) return;
    value = value.normalize("NFC");
    const before = characters(state.input),
      after = characters(value),
      target = characters(state.text);
    let prefix = 0;
    while (
      prefix < before.length &&
      prefix < after.length &&
      before[prefix] === after[prefix]
    )
      prefix++;
    if (after.length > target.length) return;
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      suffix < after.length - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    )
      suffix++;
    // Editing an earlier character must not count the unchanged tail again.
    for (let i = prefix; i < after.length - suffix; i++) {
      state.attempts++;
      if (after[i] === target[i]) state.correct++;
      else if (target[i])
        state.errors[target[i]] = (state.errors[target[i]] || 0) + 1;
    }
    state.started ||= after.length > 0;
    state.input = value;
    state.events.push({
      t: Math.floor(state.elapsed),
      from: prefix,
      insert: after.slice(prefix).join(""),
    });
    // Bound pathological edit sessions while retaining a complete replay from the checkpoint.
    if (state.events.length > 20000)
      state.events = [{ t: Math.floor(state.elapsed), from: 0, insert: value }];
  }
  function metrics(state) {
    const target = characters(state.text),
      typed = characters(state.input);
    let correctText = "";
    for (let i = 0; i < typed.length; i++)
      if (typed[i] === target[i]) correctText += typed[i];
    return {
      speed:
        state.elapsed > 0
          ? (count(correctText, state.language) * 60000) / state.elapsed
          : 0,
      accuracy: state.attempts ? (state.correct / state.attempts) * 100 : 100,
      progress: target.length ? typed.length / target.length : 0,
      units: count(correctText, state.language),
    };
  }
  function stars(speed, accuracy, goal) {
    if (accuracy < 95 || speed < goal) return 0;
    let result = 1;
    [
      [1.1, 96],
      [1.25, 97],
      [1.5, 98],
      [1.75, 99],
    ].forEach(([ratio, minimum], i) => {
      if (speed >= goal * ratio && accuracy >= minimum) result = i + 2;
    });
    return result;
  }
  function complete(state) {
    return (
      state.input === state.text ||
      (state.limit > 0 && state.elapsed >= state.limit)
    );
  }
  function replay(events, time) {
    let value = "";
    for (const event of events) {
      if (event.t > time) break;
      value = characters(value).slice(0, event.from).join("") + event.insert;
    }
    return value;
  }
  const rows = ["`1234567890-=", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./"];
  const shifted = '~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:"ZXCVBNM<>?';
  const plain = rows.join("");
  const fingers = {
    1: 0,
    2: 1,
    3: 2,
    4: 3,
    5: 3,
    6: 6,
    7: 6,
    8: 7,
    9: 8,
    0: 9,
  };
  [
    "`qaz",
    "wsx",
    "edc",
    "rfvtgb",
    " ",
    " ",
    "yhnujm",
    "ik,",
    "ol.",
    "p;/'[]\\-=",
  ].forEach((keys, index) => {
    for (const key of keys) if (key !== " ") fingers[key] = index;
  });
  function keyHint(character) {
    if (!character) return null;
    const index = shifted.indexOf(character),
      key = index >= 0 ? plain[index] : character;
    return {
      key,
      shift: index >= 0,
      finger: key === " " ? 4 : (fingers[key] ?? 9),
      shiftHand: (fingers[key] ?? 9) < 5 ? "right" : "left",
    };
  }
  return {
    create,
    input,
    metrics,
    stars,
    complete,
    replay,
    characters,
    count,
    keyHint,
    rows,
  };
})();

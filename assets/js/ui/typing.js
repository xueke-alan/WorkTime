"use strict";
/** Offline typing workspace. Input, rendering, and persistence have separate lifetimes. */
WorkTimeApp.ui.typing = (() => {
  const E = WorkTimeApp.services.typingEngine,
    store = WorkTimeApp.services.typingStorage;
  const t = (key, values) => WorkTimeApp.i18n.t("typing." + key, values);
  const events = WorkTimeApp.ui.createEventScope();
  let data = store.read(),
    page = "courses",
    chapter = 0,
    session = null,
    paused = false,
    composing = false,
    result = null;
  data.settings.language = "en";
  let saveGeneration = 0;
  let disposed = false,
    saveTimer = null,
    saveChain = Promise.resolve(),
    saveIssue = false,
    writing = 0,
    frame = null,
    stamp = 0,
    replayState = null,
    loadToken = 0;
  let textArea = null,
    textView = null,
    liveStats = null,
    keyboard = null,
    fingerView = null,
    progressView = null;
  const loads = new Map();
  const workspace = document.querySelector(".workspace");
  const shell = node("section", "typing-dialog game-shell");
  shell.id = "typingDialog";
  shell.hidden = true;
  shell.tabIndex = -1;
  shell.setAttribute("role", "dialog");
  shell.setAttribute("aria-modal", "true");
  shell.setAttribute("aria-labelledby", "typingTitle");
  const surface = node("div", "game-surface", shell);
  surface.setAttribute("aria-hidden", "true");
  const toolbar = node("header", "typing-toolbar workspace-toolbar", shell);
  const heading = node("div", "typing-heading", toolbar);
  const title = node("h2", "", heading);
  title.id = "typingTitle";
  const close = button(
    "back",
    () => {
      pause();
      expansion.close();
    },
    toolbar,
  );
  close.id = "typingExitButton";
  close.className = "ui-button icon-only workspace-toolbar-action";
  close.replaceChildren(WorkTimeApp.games.createIcon("calendar-month"));
  toolbar.prepend(close);
  const body = node("div", "typing-main", shell);
  const sectionBar = node("div", "typing-section-bar", body);
  const nav = node("nav", "typing-navigation", sectionBar);
  const content = node("div", "typing-content", body);
  const status = node("div", "typing-notice", body);
  status.hidden = true;
  status.setAttribute("role", "status");
  workspace.append(shell);
  const expansion = WorkTimeApp.ui.createWorkspaceExpansion({
    shell,
    surface,
    toolbar,
    content: body,
    returnFocus: () =>
      document.getElementById(
        WorkTimeApp.ui.dateInfo.isDevelopmentEnabled()
          ? "typingOpen"
          : "date-tab-tools",
      ),
    onChange() {
      if (
        shell.dataset.state === "closing" ||
        shell.dataset.state === "closed"
      ) {
        clearTimeout(frame);
        pause();
        if (shell.dataset.state === "closed")
          WorkTimeApp.ui.dateInfo.showToolsPanel();
      }
    },
  });
  function node(tag, cls = "", parent, text) {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (text !== undefined) element.textContent = text;
    parent?.append(element);
    return element;
  }
  function button(key, action, parent, primary = false) {
    const element = node(
      "button",
      "typing-button" + (primary ? " is-primary" : ""),
      parent,
      t(key),
    );
    element.type = "button";
    element.onclick = action;
    return element;
  }
  function card(parent = content, cls = "") {
    return node("section", "typing-card " + cls, parent);
  }
  function label(text, control, parent) {
    const row = node("label", "typing-field", parent);
    node("span", "", row, text);
    row.append(control);
    return row;
  }
  function language() {
    return "en";
  }
  function unit(lang = language()) {
    return t(lang === "zh" ? "unitZh" : "unitEn");
  }
  function dayKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function duration(ms) {
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  function rows() {
    return WorkTimeApp.data.typingCatalog[language()];
  }
  function totals() {
    const values = Object.entries(data.lessons)
      .filter(([id]) => id.startsWith("en-"))
      .map(([, row]) => row);
    let cursor = new Date(),
      streak = 0;
    if (!(data.daily[dayKey(cursor)] > 0)) cursor.setDate(cursor.getDate() - 1);
    while (data.daily[dayKey(cursor)] > 0) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    let longest = 0,
      run = 0,
      previous = null;
    for (const key of Object.keys(data.daily)
      .filter((key) => data.daily[key] > 0)
      .sort()) {
      const date = Date.parse(key + "T00:00:00Z");
      run = previous !== null && date - previous === 86400000 ? run + 1 : 1;
      longest = Math.max(longest, run);
      previous = date;
    }
    return {
      longest,
      passed: values.filter((r) => r.stars > 0).length,
      stars: values.reduce((sum, r) => sum + r.stars, 0),
      streak,
    };
  }
  function updateStatus() {
    status.replaceChildren();
    status.hidden = !saveIssue;
    if (saveIssue) {
      node("span", "", status, t("saveFailed"));
      button("retry", () => persist(), status);
    }
  }
  function notice(message) {
    status.textContent = message;
    status.hidden = false;
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const snapshot = structuredClone(data),
      generation = saveGeneration;
    writing++;
    updateStatus();
    const job = saveChain
      .catch(() => {})
      .then(() =>
        generation === saveGeneration
          ? store.save(snapshot)
          : { persisted: true },
      );
    saveChain = job
      .then((saved) => {
        saveIssue = !saved.persisted;
      })
      .catch(() => {
        saveIssue = true;
      })
      .finally(() => {
        writing--;
        if (!disposed) updateStatus();
      });
    return saveChain;
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 350);
    updateStatus();
  }
  function accountTime() {
    if (!session) return;
    const delta = Math.max(
      0,
      Math.floor(session.elapsed) - (session.accounted || 0),
    );
    data.daily[dayKey()] = (data.daily[dayKey()] || 0) + delta;
    session.accounted = Math.floor(session.elapsed);
  }
  function checkpoint() {
    accountTime();
    if (session && !session.finished) {
      data.draft = structuredClone(session);
      scheduleSave();
    }
  }
  async function lessons(lang, index) {
    if (WorkTimeApp.data.typingLessons[lang][index])
      return WorkTimeApp.data.typingLessons[lang][index];
    const id = lang + index;
    if (!loads.has(id))
      loads.set(
        id,
        WorkTimeApp.services.assets
          .script(WorkTimeApp.data.typingCatalog[lang][index].path)
          .catch((error) => {
            loads.delete(id);
            throw error;
          }),
      );
    await loads.get(id);
    return WorkTimeApp.data.typingLessons[lang][index];
  }
  function stopReplay() {
    if (replayState) replayState.playing = false;
    replayState = null;
  }
  function navigate(next) {
    ++loadToken;
    pause();
    session = null;
    result = null;
    stopReplay();
    page = next;
    render();
  }
  function render() {
    if (disposed) return;
    title.textContent = t("title");
    close.title = WorkTimeApp.i18n.t("workspace.returnCalendar");
    close.setAttribute("aria-label", close.title);
    nav.setAttribute("aria-label", t("title"));
    nav.replaceChildren();
    for (const key of ["courses", "practice", "challenges", "statistics"]) {
      const item = button(key, () => navigate(key), nav);
      item.setAttribute("aria-current", key === page ? "page" : "false");
    }
    body.insertBefore(sectionBar, status);
    content.replaceChildren();
    content.dataset.view = replayState
      ? "replay"
      : result
        ? "result"
        : session
          ? "session"
          : page;
    content.scrollTop = 0;
    textArea =
      textView =
      liveStats =
      keyboard =
      fingerView =
      progressView =
        null;
    if (replayState) renderReplay();
    else if (result) renderResult();
    else if (session) renderSession();
    else if (page === "courses") renderCourses();
    else if (page === "practice") renderPractice();
    else if (page === "challenges") renderChallenges();
    else renderStatistics();
    updateStatus();
  }
  function metric(parent, name, value) {
    const item = node("div", "typing-metric", parent);
    node("span", "typing-muted", item, t(name));
    return node("strong", "", item, value);
  }
  function renderCourses() {
    const summary = card(content, "typing-hero");
    const overview = node("div", "typing-hero-body", summary);
    const intro = node("div", "", overview);
    const action = node("div", "typing-actions", intro);
    button(
      "continue",
      () => openNumber(data.unlocked[language()]),
      action,
      true,
    );
    if (data.draft?.language === "en") button("resume", resumeDraft, action);
    const summaryMetrics = node("div", "typing-summary", overview),
      total = totals();
    metric(summaryMetrics, "completed", `${total.passed} / 600`);
    metric(summaryMetrics, "stars", String(total.stars));
    metric(summaryMetrics, "streak", t("days", { n: total.streak }));
    const daily = card(overview, "typing-daily");
    const minutes = node("input");
    minutes.type = "number";
    minutes.min = "1";
    minutes.max = "120";
    minutes.value = String(data.settings.dailyMinutes);
    minutes.onchange = () => {
      data.settings.dailyMinutes = Math.min(
        120,
        Math.max(1, Math.round(Number(minutes.value) || 10)),
      );
      minutes.value = String(data.settings.dailyMinutes);
      dailyProgress.max = data.settings.dailyMinutes * 60000;
      scheduleSave();
    };
    label(t("daily"), minutes, daily);
    const dailyProgress = node("progress", "", daily);
    dailyProgress.max = data.settings.dailyMinutes * 60000;
    dailyProgress.value = data.daily[dayKey()] || 0;
    dailyProgress.setAttribute("aria-label", t("daily"));
    node(
      "span",
      "typing-muted",
      daily,
      `${duration(data.daily[dayKey()] || 0)} / ${data.settings.dailyMinutes}:00`,
    );
    overview.append(sectionBar);
    const layout = node("div", "typing-course-layout", content),
      sidebar = node("aside", "typing-course-sidebar", layout),
      chapters = node("nav", "typing-chapters", sidebar),
      list = card(layout, "typing-lessons-card");
    for (let index = 0; index < rows().length; index++) {
      const item = node("button", "typing-chapter", chapters);
      item.type = "button";
      item.setAttribute("aria-current", chapter === index ? "true" : "false");
      item.title = t(rows()[index].key);
      node(
        "span",
        "typing-chapter-number",
        item,
        String(index + 1).padStart(2, "0"),
      );
      const caption = node("span", "", item);
      node("strong", "", caption, t(rows()[index].key));
      const first = rows()[index].first,
        count = rows()[index].count;
      const done = Object.keys(data.lessons).filter(
        (id) =>
          id.startsWith(language() + "-") &&
          Number(id.slice(3)) >= first &&
          Number(id.slice(3)) < first + count &&
          data.lessons[id].stars > 0,
      ).length;
      node("small", "typing-muted", caption, `${done} / ${count}`);
      item.onclick = () => {
        chapter = index;
        render();
      };
    }
    node("h3", "", list, t(rows()[chapter].key));
    node(
      "p",
      "typing-muted",
      list,
      `${rows()[chapter].low}–${rows()[chapter].high} ${unit()} · ${t("accuracy")} ≥ 95%`,
    );
    const grid = node("div", "typing-lesson-grid", list),
      token = ++loadToken,
      lang = language(),
      index = chapter;
    grid.style.setProperty("--lesson-rows", lang === "en" ? "5" : "2");
    grid.setAttribute("aria-busy", "true");
    node("p", "typing-muted", grid, t("loading"));
    lessons(lang, index)
      .then((items) => {
        if (token !== loadToken || disposed || !grid.isConnected) return;
        grid.replaceChildren();
        grid.removeAttribute("aria-busy");
        for (const lesson of items) {
          const record = data.lessons[lesson.id],
            locked = lesson.number > data.unlocked[lang];
          const entry = node(
            "button",
            "typing-lesson" +
              (record?.stars ? " is-complete" : "") +
              (locked ? " is-locked" : ""),
            grid,
          );
          entry.type = "button";
          entry.disabled = locked;
          entry.setAttribute(
            "aria-label",
            `${t("lesson", { n: lesson.number })} · ${lesson.goal} ${unit(lang)} · ${record?.stars || 0}/5`,
          );
          if (locked) entry.title = t("locked");
          node("strong", "", entry, String(lesson.number).padStart(2, "0"));
          node(
            "small",
            "typing-muted",
            entry,
            t(lesson.type === "words" ? "textDrill" : lesson.type),
          );
          node(
            "span",
            "typing-stars",
            entry,
            "★".repeat(record?.stars || 0) +
              "☆".repeat(5 - (record?.stars || 0)),
          );
          entry.onclick = () => startLesson(lesson);
        }
      })
      .catch(() => {
        if (token === loadToken) {
          grid.replaceChildren();
          grid.removeAttribute("aria-busy");
          button("loadFailed", () => render(), grid);
        }
      });
  }
  async function openNumber(number) {
    const lang = language(),
      index = Math.floor((number - 1) / (lang === "en" ? 50 : 20)),
      token = ++loadToken;
    try {
      const items = await lessons(lang, index);
      if (!disposed && token === loadToken)
        startLesson(items.find((l) => l.number === number));
    } catch {
      notice(t("loadFailed"));
    }
  }
  function startLesson(lesson) {
    begin({
      text: lesson.text,
      language: lesson.language,
      goal: lesson.goal,
      mode: "lesson",
      lessonId: lesson.id,
    });
  }
  function begin(options) {
    ++loadToken;
    pause();
    stopReplay();
    result = null;
    session = E.create(options);
    Object.assign(session, options);
    paused = false;
    composing = false;
    stamp = performance.now();
    data.draft = structuredClone(session);
    scheduleSave();
    render();
    requestAnimationFrame(() => textArea?.focus({ preventScroll: true }));
  }
  function resumeDraft() {
    if (!data.draft || data.draft.language !== "en") return;
    session = structuredClone(data.draft);
    // Old placement drafts remain readable as ordinary practice; no jump is awarded.
    if (session.mode === "placement") {
      session.mode = "custom";
      delete session.placementChapter;
    }
    data.settings.language = session.language;
    session.finished = false;
    result = null;
    paused = true;
    render();
  }
  function options(parent) {
    const controls = node("div", "typing-options", parent);
    for (const key of session?.language === "zh"
      ? ["sound"]
      : ["keyboard", "fingers", "sound"]) {
      const field = node("label", "typing-check", controls),
        input = node("input", "", field);
      input.type = "checkbox";
      input.checked = data.settings[key];
      node("span", "", field, t(key));
      input.onchange = () => {
        data.settings[key] = input.checked;
        scheduleSave();
        updateLive();
      };
    }
  }
  function renderSession() {
    const rail = node("aside", "typing-session-rail", content);
    const bar = node("div", "typing-session-header", rail);
    const names = session.lessonId
      ? t("lesson", { n: Number(session.lessonId.slice(3)) })
      : t(
          session.mode === "test"
            ? "test"
            : session.mode === "placement"
              ? "placement"
              : session.mode === "custom"
                ? "custom"
                : session.mode === "weak"
                  ? "weak"
                  : session.mode,
        );
    node("h3", "", bar, names);
    const controls = node("div", "typing-actions", bar);
    button(
      paused ? "continue" : "pause",
      () => {
        if (paused) unpause();
        else pause();
        render();
        if (!paused) textArea?.focus();
      },
      controls,
    );
    button(
      "back",
      () => {
        navigate(page);
        notice(t("replaceDraft"));
      },
      controls,
    );
    liveStats = node("div", "typing-session-stats", rail);
    options(rail);
    const writingCard = card(content, "typing-writing");
    writingCard.dataset.language = session.language;
    const writingArea = node("div", "typing-writing-area", writingCard);
    const guidance = node("aside", "typing-guidance", writingCard);
    node(
      "p",
      "typing-muted",
      writingArea,
      t(session.language === "zh" ? "hintZh" : "hintEn"),
    );
    if (session.mode === "race") {
      progressView = node("div", "typing-race", writingArea);
      for (const name of ["you", "opponent"]) {
        const row = node("label", "", progressView);
        node("span", "", row, t(name));
        const progress = node("progress", "", row);
        progress.max = 1;
      }
    }
    if (session.mode === "words")
      node("p", "typing-muted", writingArea, t("wordsInfo"));
    textView = node(
      "div",
      "typing-text" + (session.mode === "words" ? " typing-word-cloud" : ""),
      writingArea,
    );
    textView.setAttribute("aria-label", t("input"));
    if (
      session.language === "en" &&
      session.mode === "lesson" &&
      Number(session.lessonId?.slice(3)) <= 250
    )
      textView.classList.add("typing-character-cards");
    textArea = node("textarea", "typing-input", writingArea);
    textArea.id = "typingInput";
    textArea.setAttribute("aria-label", t("input"));
    textArea.spellcheck = false;
    textArea.autocomplete = "off";
    textArea.setAttribute("autocapitalize", "off");
    textArea.setAttribute("autocorrect", "off");
    textArea.setAttribute("data-typing-input", "");
    textArea.value = session.input;
    textArea.disabled = paused;
    const focusInput = () => {
      if (paused) return;
      textArea.focus({ preventScroll: true });
      textArea.setSelectionRange(textArea.value.length, textArea.value.length);
    };
    writingCard.onclick = (event) => {
      if (!event.target.closest("button,input,select,textarea")) focusInput();
    };
    textArea.onpaste = textArea.ondrop = (event) => {
      event.preventDefault();
      notice(t("paste"));
    };
    textArea.onbeforeinput = (event) => {
      if (
        event.inputType === "insertFromPaste" ||
        event.inputType === "insertFromDrop"
      ) {
        event.preventDefault();
        notice(t("paste"));
      }
    };
    textArea.onkeydown = (event) => {
      if (event.repeat && !event.isComposing) event.preventDefault();
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        pause();
        render();
      }
    };
    textArea.addEventListener("compositionstart", () => {
      if (!paused) {
        tickTime();
        composing = true;
        if (!session.started) {
          session.started = true;
          stamp = performance.now();
        }
      }
    });
    textArea.addEventListener("compositionend", () => {
      composing = false;
      writingArea.querySelector(".typing-composition")?.remove();
      if (!session || !textArea) return;
      if (paused) {
        textArea.value = session.input;
        return;
      }
      acceptInput();
    });
    textArea.addEventListener("compositionupdate", (event) => {
      let preview = writingArea.querySelector(".typing-composition");
      if (!preview) preview = node("span", "typing-composition", writingArea);
      preview.textContent = event.data;
      positionInput();
    });
    textArea.oninput = (event) => {
      if (!composing && !event.isComposing) acceptInput();
    };
    const inputElement = textArea;
    textArea.onblur = () => {
      setTimeout(() => {
        if (
          !disposed &&
          textArea === inputElement &&
          session &&
          !session.finished &&
          !paused
        ) {
          pause();
          render();
        }
      }, 0);
    };
    if (paused) {
      const cover = node("div", "typing-pause", writingArea);
      node("p", "", cover, t("paused"));
      button(
        "continue",
        () => {
          unpause();
          render();
          textArea?.focus();
        },
        cover,
        true,
      );
    }
    keyboard = node("div", "typing-keyboard", guidance);
    fingerView = node("div", "typing-finger-guide", guidance);
    updateLive();
  }
  function positionInput() {
    if (!textArea || !textView) return;
    const cursor = textView.querySelector(".is-cursor");
    const area = textArea.parentElement.getBoundingClientRect();
    const rect = (cursor || textView).getBoundingClientRect();
    const top = Math.max(0, Math.min(area.height - 24, rect.top - area.top));
    const left = Math.max(0, Math.min(area.width - 24, rect.left - area.left));
    textArea.style.top = top + "px";
    textArea.style.left = left + "px";
    const preview = textArea.parentElement.querySelector(".typing-composition");
    if (preview) {
      preview.style.top = top + 28 + "px";
      preview.style.left = left + "px";
    }
  }
  function tickTime() {
    const now = performance.now();
    if (
      session &&
      session.started &&
      !session.finished &&
      !paused &&
      !document.hidden
    ) {
      session.elapsed += Math.max(0, now - stamp);
      if (session.limit)
        session.elapsed = Math.min(session.elapsed, session.limit);
    }
    stamp = now;
  }
  function pause() {
    tickTime();
    if (session && !session.finished) {
      paused = true;
      composing = false;
      checkpoint();
      void persist();
    }
  }
  function unpause() {
    paused = false;
    stamp = performance.now();
  }
  function acceptInput() {
    if (!session || paused || session.finished || !textArea) return;
    tickTime();
    if (session.limit && session.started && session.elapsed >= session.limit) {
      finish();
      return;
    }
    const value = textArea.value.replace(/\r\n/g, "\n").normalize("NFC");
    if (value === session.input) return;
    E.input(session, value);
    if (textArea.value !== session.input) textArea.value = session.input;
    if (data.settings.sound) sound();
    checkpoint();
    if (E.complete(session)) finish();
    else updateLive();
  }
  let audio = null;
  function sound() {
    try {
      audio ||= new AudioContext();
      void audio.resume();
      const oscillator = audio.createOscillator(),
        gain = audio.createGain();
      oscillator.frequency.value = 480;
      gain.gain.setValueAtTime(0.025, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.035);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.04);
    } catch {}
  }
  function paintText(target, typed, view, words = false) {
    if (!view) return;
    const layoutWidth = String(view.clientWidth);
    if (view.dataset.value === typed && view.dataset.width === layoutWidth)
      return;
    view.dataset.value = typed;
    view.dataset.width = layoutWidth;
    const chars = E.characters(target),
      input = E.characters(typed),
      cards = view.classList.contains("typing-character-cards"),
      offset = cards
        ? 0
        : words
          ? Math.max(0, typed.lastIndexOf(" ") + 1)
          : Math.max(0, input.length - 160);
    const end = cards
      ? chars.length
      : words
        ? Math.min(chars.length, offset + 240)
        : Math.min(chars.length, Math.max(600, input.length + 400));
    const fragment = document.createDocumentFragment();
    for (let i = offset; i < end; i++) {
      const span = node(
        "span",
        i < input.length
          ? input[i] === chars[i]
            ? "is-correct"
            : "is-error"
          : i === input.length
            ? "is-cursor"
            : "",
      );
      span.textContent = chars[i];
      if (cards) {
        const width = view.clientWidth || 700;
        const visible = Math.max(3, Math.min(7, Math.floor(width / 92)));
        const start = Math.max(
          0,
          Math.min(chars.length - visible, input.length - 1),
        );
        span.hidden = i < start || i >= start + visible;
        if (chars[i] === " ") span.classList.add("is-space");
      }
      fragment.append(span);
    }
    view.replaceChildren(fragment);
    const cursor = view.querySelector(".is-cursor");
    if (
      cursor &&
      cursor.offsetTop - view.offsetTop >
        view.scrollTop + view.clientHeight - 45
    )
      view.scrollTop =
        cursor.offsetTop - view.offsetTop - view.clientHeight + 60;
  }
  function updateLive() {
    if (!session || session.finished || !liveStats) return;
    const m = E.metrics(session);
    liveStats.replaceChildren();
    metric(
      liveStats,
      "speed",
      `${m.speed.toFixed(1)} ${unit(session.language)}`,
    );
    metric(liveStats, "accuracy", `${m.accuracy.toFixed(1)}%`);
    metric(
      liveStats,
      "time",
      duration(
        session.limit
          ? Math.max(0, session.limit - session.elapsed)
          : session.elapsed,
      ),
    );
    metric(liveStats, "goal", `${session.goal} ${unit(session.language)}`);
    if (session.mode === "words")
      metric(liveStats, "points", String(wordPoints(session)));
    paintText(session.text, session.input, textView, session.mode === "words");
    positionInput();
    if (progressView) {
      const bars = progressView.querySelectorAll("progress");
      bars[0].value = Math.min(
        1,
        m.units / Math.max(1, E.count(session.text, session.language)),
      );
      bars[1].value = Math.min(1, session.elapsed / session.limit);
    }
    const hint = E.keyHint(
      E.characters(session.text)[E.characters(session.input).length],
    );
    keyboard.hidden = session.language !== "en" || !data.settings.keyboard;
    fingerView.hidden = session.language !== "en" || !data.settings.fingers;
    keyboard.parentElement.hidden = keyboard.hidden && fingerView.hidden;
    if (!keyboard.hidden) renderKeyboard(keyboard, hint);
    if (!fingerView.hidden) renderFingers(hint);
  }
  function renderKeyboard(parent, hint, heat = null) {
    if (parent.childElementCount && !heat) {
      for (const cap of parent.querySelectorAll(".typing-key")) {
        const key = cap.dataset.key;
        cap.classList.toggle(
          "is-next",
          key === hint?.key ||
            (hint?.shift && key === "shift-" + hint.shiftHand),
        );
      }
      return;
    }
    parent.replaceChildren();
    for (const row of E.rows) {
      const line = node("div", "typing-key-row", parent);
      for (const key of row) {
        const cap = node(
          "span",
          "typing-key" + (hint?.key === key ? " is-next" : ""),
          line,
          key,
        );
        cap.dataset.key = key;
        if (heat) {
          const n = (heat[key] || 0) + (heat[key.toUpperCase()] || 0);
          if (n) {
            cap.style.setProperty(
              "--key-intensity",
              String(Math.min(0.8, 0.15 + n / 20)),
            );
            cap.classList.add("has-errors");
          }
          cap.title = `${key}: ${n}`;
        }
      }
    }
    const bottom = node("div", "typing-key-row", parent);
    const leftShift = node(
      "span",
      "typing-key typing-shift" +
        (hint?.shift && hint.shiftHand === "left" ? " is-next" : ""),
      bottom,
      "Shift",
    );
    leftShift.dataset.key = "shift-left";
    const space = node(
      "span",
      "typing-key typing-space" + (hint?.key === " " ? " is-next" : ""),
      bottom,
      "␣",
    );
    space.dataset.key = " ";
    const rightShift = node(
      "span",
      "typing-key typing-shift" +
        (hint?.shift && hint.shiftHand === "right" ? " is-next" : ""),
      bottom,
      "Shift",
    );
    rightShift.dataset.key = "shift-right";
  }
  function renderFingers(hint) {
    if (!fingerView.childElementCount) {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 800 360");
      svg.setAttribute("aria-hidden", "true");
      svg.classList.add("typing-hand-diagram");
      fingerView.append(svg);
      const outlines = [
        "M132 356 C127 314 130 278 141 242 L156 164 Q161 146 174 151 Q186 155 183 173 L175 213 L199 112 Q204 93 218 98 Q231 102 227 121 L210 201 L240 88 Q245 69 260 74 Q274 79 269 98 L245 198 L280 108 Q287 91 300 98 Q313 106 306 124 L274 228 Q269 245 283 247 L316 211 Q330 198 343 211 Q353 222 341 237 L303 294 Q292 313 292 356",
        "M668 356 C673 314 670 278 659 242 L644 164 Q639 146 626 151 Q614 155 617 173 L625 213 L601 112 Q596 93 582 98 Q569 102 573 121 L590 201 L560 88 Q555 69 540 74 Q526 79 531 98 L555 198 L520 108 Q513 91 500 98 Q487 106 494 124 L526 228 Q531 245 517 247 L484 211 Q470 198 457 211 Q447 222 459 237 L497 294 Q508 313 508 356",
      ];
      for (const d of outlines) {
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        path.classList.add("typing-hand-outline");
        svg.append(path);
      }
      const traces = [
        "M151 270 Q154 211 169 164",
        "M183 264 Q199 173 213 110",
        "M211 265 Q236 158 254 87",
        "M240 275 Q271 173 292 111",
        "M278 303 Q307 254 330 222",
        "M522 303 Q493 254 470 222",
        "M560 275 Q529 173 508 111",
        "M589 265 Q564 158 546 87",
        "M617 264 Q601 173 587 110",
        "M649 270 Q646 211 631 164",
      ];
      traces.forEach((d, i) => {
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", d);
        path.dataset.finger = String(i);
        path.classList.add("typing-hand-finger");
        svg.append(path);
      });
      node("p", "typing-muted", fingerView);
    }
    for (const finger of fingerView.querySelectorAll("[data-finger]")) {
      const index = Number(finger.dataset.finger);
      finger.classList.toggle(
        "is-next",
        hint?.finger === index ||
          (hint?.shift && index === (hint.shiftHand === "left" ? 0 : 9)),
      );
      if (finger.classList.contains("is-next") && !keyboard.hidden) {
        const targetKey =
          index === hint?.finger ? hint.key : "shift-" + hint.shiftHand;
        const cap = Array.from(keyboard.querySelectorAll(".typing-key")).find(
          (key) => key.dataset.key === targetKey,
        );
        if (cap) {
          const svg = finger.ownerSVGElement;
          const bounds = svg.getBoundingClientRect();
          const keyBounds = cap.getBoundingClientRect();
          if (bounds.width && bounds.height) {
            const x =
              ((keyBounds.left + keyBounds.width / 2 - bounds.left) * 800) /
              bounds.width;
            const y =
              ((keyBounds.top + keyBounds.height / 2 - bounds.top) * 360) /
              bounds.height;
            const baseX = [151, 183, 211, 240, 278, 522, 560, 589, 617, 649][
              index
            ];
            finger.setAttribute(
              "d",
              `M${baseX} 290 Q${baseX} ${y + 80} ${x} ${y}`,
            );
          }
        }
      }
    }
    fingerView.querySelector("p").textContent = hint
      ? `${t("finger" + hint.finger)}${hint.shift ? " · " + t("shift" + hint.shiftHand) : ""}`
      : t("fingerGuide");
  }
  function wordPoints(row) {
    const parts = row.text.split(" ");
    let cursor = 0,
      points = 0;
    for (const part of parts) {
      if (
        row.input.slice(cursor, cursor + part.length) !== part ||
        row.input.length < cursor + part.length
      )
        break;
      points++;
      cursor += part.length + 1;
    }
    return points;
  }
  function finish() {
    if (!session || session.finished) return;
    tickTime();
    session.elapsed = Math.floor(session.elapsed);
    session.finished = true;
    paused = true;
    const m = E.metrics(session),
      stars = E.stars(m.speed, m.accuracy, session.goal);
    const attempt = {
      ...structuredClone(session),
      ...m,
      id: crypto.randomUUID(),
      date: dayKey(),
      stars,
      points: session.mode === "words" ? wordPoints(session) : m.speed,
    };
    delete attempt.input;
    delete attempt.correct;
    delete attempt.attempts;
    delete attempt.started;
    delete attempt.finished;
    data.attempts.push(attempt);
    data.attempts = data.attempts.slice(-10000);
    data.attempts.slice(0, -200).forEach((row) => {
      delete row.events;
      delete row.text;
    });
    accountTime();
    for (const [key, n] of Object.entries(session.errors))
      data.weak[session.language][key] =
        (data.weak[session.language][key] || 0) + n;
    if (session.mode === "lesson") {
      const old = data.lessons[session.lessonId] || {
        stars: 0,
        speed: 0,
        accuracy: 0,
      };
      data.lessons[session.lessonId] = {
        stars: Math.max(old.stars, stars),
        speed: Math.max(old.speed, m.speed),
        accuracy: Math.max(old.accuracy, m.accuracy),
      };
      if (stars)
        data.unlocked[session.language] = Math.max(
          data.unlocked[session.language],
          Math.min(
            session.language === "en" ? 600 : 100,
            Number(session.lessonId.slice(3)) + 1,
          ),
        );
    }
    if (["words", "race"].includes(session.mode)) {
      const key = `${session.language}-${session.mode}-${session.difficulty}`;
      data.best[key] = Math.max(data.best[key] || 0, attempt.points);
    }
    data.draft = null;
    result = attempt;
    session = null;
    void persist();
    render();
  }
  function renderResult() {
    const panel = card(content, "typing-result");
    node("p", "typing-eyebrow", panel, t(result.language));
    node("h3", "", panel, t(result.stars ? "passed" : "notPassed"));
    node(
      "div",
      "typing-result-stars",
      panel,
      "★".repeat(result.stars) + "☆".repeat(5 - result.stars),
    );
    const metrics = node("div", "typing-session-stats", panel);
    metric(
      metrics,
      "speed",
      `${result.speed.toFixed(1)} ${unit(result.language)}`,
    );
    metric(metrics, "accuracy", `${result.accuracy.toFixed(1)}%`);
    metric(metrics, "time", duration(result.elapsed));
    if (result.mode === "words")
      metric(metrics, "points", String(result.points));
    if (result.mode === "race")
      node(
        "p",
        "typing-muted",
        panel,
        `${t(result.speed >= result.goal && result.progress >= 1 ? "you" : "opponent")} · ${t("passed")}`,
      );
    node("p", "typing-muted", panel, t("rule"));
    const actions = node("div", "typing-actions", panel);
    button(
      "retry",
      () =>
        begin({
          text: result.text,
          language: result.language,
          goal: result.goal,
          mode: result.mode,
          limit: result.limit,
          lessonId: result.lessonId,
          difficulty: result.difficulty,
        }),
      actions,
    );
    if (
      result.mode === "lesson" &&
      result.stars &&
      Number(result.lessonId.slice(3)) < (result.language === "en" ? 600 : 100)
    )
      button(
        "next",
        () => openNumber(Number(result.lessonId.slice(3)) + 1),
        actions,
        true,
      );
    button("replay", () => openReplay(result), actions);
    button("courses", () => navigate("courses"), actions);
  }
  async function practiceText(callback, size = 0) {
    const lang = language(),
      token = ++loadToken;
    try {
      const list = await lessons(lang, lang === "en" ? 10 : 3);
      if (token !== loadToken || disposed) return;
      let text = list.map((l) => l.text).join(lang === "en" ? " " : "");
      if (size)
        text = E.characters(text.repeat(Math.ceil(size / text.length)))
          .slice(0, size)
          .join("");
      callback(text, lang);
    } catch {
      notice(t("loadFailed"));
    }
  }
  function paginate(items, parent, list, pageSize, draw, emptyKey = "empty") {
    let current = 0;
    const total = Math.max(1, Math.ceil(items.length / pageSize));
    const controls = node("div", "typing-pagination", parent);
    const previous = button("previousPage", () => show(current - 1), controls);
    const count = node("span", "typing-muted", controls);
    count.setAttribute("role", "status");
    const next = button("nextPage", () => show(current + 1), controls);
    function show(index) {
      current = Math.min(total - 1, Math.max(0, index));
      list.replaceChildren();
      for (const item of items.slice(
        current * pageSize,
        (current + 1) * pageSize,
      ))
        draw(item);
      if (!items.length)
        node("p", "typing-muted typing-empty", list, t(emptyKey));
      previous.disabled = current === 0;
      next.disabled = current >= total - 1;
      count.textContent = t("pageCount", { current: current + 1, total });
      controls.hidden = items.length <= pageSize;
      list.scrollTop = 0;
    }
    show(0);
  }
  function renderPractice() {
    if (data.draft?.language === "en") button("resume", resumeDraft, content);
    const grid = node("div", "typing-two-columns", content),
      test = card(grid);
    node("h3", "", test, t("test"));
    const testActions = node("div", "typing-actions", test);
    for (const minutes of [1, 3, 5]) {
      const item = button(
        "test",
        () =>
          practiceText(
            (text, lang) =>
              begin({
                text,
                language: lang,
                goal: lang === "en" ? 35 : 50,
                mode: "test",
                limit: minutes * 60000,
              }),
            18000,
          ),
        testActions,
      );
      item.textContent = t("minutes", { n: minutes });
    }
    const weak = card(grid);
    node("h3", "", weak, t("weak"));
    const weakKeys = Object.entries(data.weak[language()])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([key]) => key);
    node(
      "p",
      "typing-muted",
      weak,
      weakKeys.length ? weakKeys.join(" · ") : t("weakEmpty"),
    );
    const weakStart = button(
      "start",
      () => {
        const text = Array.from({ length: 10 }, (_, i) =>
          weakKeys
            .slice(i % weakKeys.length)
            .concat(weakKeys.slice(0, i % weakKeys.length))
            .join(language() === "en" ? " " : ""),
        ).join(language() === "en" ? " " : "，");
        begin({
          text,
          language: language(),
          goal: language() === "en" ? 20 : 30,
          mode: "weak",
        });
      },
      weak,
      true,
    );
    weakStart.disabled = !weakKeys.length;
    const custom = card(content, "typing-custom-card");
    node("h3", "", custom, t("custom"));
    const customLayout = node("div", "typing-custom-layout", custom);
    const form = node("form", "typing-custom-form", customLayout),
      name = node("input");
    name.required = true;
    name.maxLength = 100;
    label(t("articleTitle"), name, form);
    const article = node("textarea");
    article.required = true;
    article.maxLength = 10000;
    article.rows = 5;
    label(t("articleText"), article, form);
    const submit = button("save", () => {}, form, true);
    submit.type = "submit";
    form.onsubmit = (event) => {
      event.preventDefault();
      if (data.articles.length >= 100) {
        notice(t("limitArticles"));
        return;
      }
      const text = article.value
        .normalize("NFC")
        .replace(/\r\n?/g, "\n")
        .replace(/\t/g, "    ")
        .trim();
      if (!text || !name.value.trim()) return;
      data.articles.push({
        id: crypto.randomUUID(),
        title: name.value.trim(),
        text,
        language: language(),
      });
      scheduleSave();
      render();
    };
    const library = node("section", "typing-article-library", customLayout);
    node("h4", "", library, t("savedArticles"));
    const articleList = node("div", "typing-article-list", library);
    const items = data.articles.filter((a) => a.language === language());
    paginate(
      items,
      library,
      articleList,
      6,
      (row) => {
        const line = node("div", "typing-article-row", articleList);
        node("strong", "", line, row.title);
        button(
          "start",
          () =>
            begin({
              text: row.text,
              language: row.language,
              goal: row.language === "en" ? 30 : 40,
              mode: "custom",
            }),
          line,
        );
        button(
          "delete",
          () => {
            data.articles = data.articles.filter((a) => a.id !== row.id);
            scheduleSave();
            render();
          },
          line,
        );
      },
      "noArticles",
    );
  }
  function renderChallenges() {
    const grid = node("div", "typing-two-columns", content);
    for (const mode of ["words", "race"]) {
      const panel = card(grid, "typing-challenge-card");
      node(
        "div",
        "typing-challenge-symbol",
        panel,
        mode === "words" ? "Aa" : "➜",
      );
      node("h3", "", panel, t(mode));
      node("p", "typing-muted", panel, t(mode + "Info"));
      for (const [index, difficulty] of ["easy", "normal", "hard"].entries()) {
        const line = node("div", "typing-challenge-row", panel),
          action = button(
            difficulty,
            () => {
              practiceText((text, lang) => {
                if (mode === "words")
                  text =
                    lang === "en"
                      ? text
                          .toLowerCase()
                          .replace(/[^a-z ]/g, "")
                          .split(/\s+/)
                          .filter((w) => w.length <= [4, 7, 20][index])
                          .join(" ")
                      : text
                          .split(/[，。！？；]/)
                          .filter((w) => w.length < [13, 22, 60][index])
                          .join(" ");
                const goal = (lang === "en" ? [20, 40, 60] : [25, 50, 80])[
                  index
                ];
                if (mode === "race")
                  text = E.characters(text)
                    .slice(
                      0,
                      lang === "en"
                        ? [160, 240, 320][index]
                        : [40, 65, 90][index],
                    )
                    .join("");
                if (!text) return;
                begin({
                  text,
                  language: lang,
                  goal,
                  mode,
                  difficulty,
                  limit:
                    mode === "words"
                      ? 60000
                      : Math.ceil((E.count(text, lang) / goal) * 60000),
                });
              });
            },
            line,
          );
        action.dataset.challenge = mode + "-" + difficulty;
        node(
          "small",
          "typing-muted",
          line,
          `${t("best")}: ${(data.best[`${language()}-${mode}-${difficulty}`] || 0).toFixed(mode === "words" ? 0 : 1)}${mode === "race" ? " " + unit() : ""}`,
        );
      }
    }
  }
  function chart(parent, attempts) {
    const panel = card(parent, "typing-trend-card");
    node("h3", "", panel, t("trend"));
    const recent = attempts.slice(-30);
    if (!recent.length) {
      node("p", "typing-muted typing-empty", panel, t("empty"));
      return;
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("typing-chart");
    svg.setAttribute("viewBox", "0 0 600 180");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", t("trend"));
    const maxSpeed = Math.max(60, ...recent.map((a) => a.speed));
    for (const [key, max, cls] of [
      ["speed", maxSpeed, "typing-speed-line"],
      ["accuracy", 100, "typing-accuracy-line"],
    ]) {
      const line = document.createElementNS(svg.namespaceURI, "polyline");
      line.setAttribute(
        "points",
        recent
          .map(
            (r, i) =>
              `${20 + (i / Math.max(1, recent.length - 1)) * 560},${160 - (r[key] / max) * 140}`,
          )
          .join(" "),
      );
      line.setAttribute("class", cls);
      svg.append(line);
    }
    panel.append(svg);
    node(
      "p",
      "typing-chart-legend",
      panel,
      `${t("speed")} 0–${Math.ceil(maxSpeed)} ${unit()} · ${t("accuracy")} 0–100%`,
    );
    const accessible = node("details", "typing-chart-details", panel);
    node("summary", "typing-muted", accessible, t("statistics"));
    for (const attempt of recent)
      node(
        "p",
        "typing-muted",
        accessible,
        `${attempt.date} · ${attempt.speed.toFixed(1)} ${unit()} · ${attempt.accuracy.toFixed(1)}%`,
      );
  }
  function renderStatistics() {
    const totalsData = totals(),
      summary = node(
        "div",
        "typing-session-stats typing-statistics-summary",
        content,
      );
    metric(summary, "completed", String(totalsData.passed));
    metric(summary, "stars", String(totalsData.stars));
    metric(summary, "streak", t("days", { n: totalsData.streak }));
    metric(
      summary,
      "time",
      duration(Object.values(data.daily).reduce((a, b) => a + b, 0)),
    );
    const badges = card(content, "typing-badges");
    for (const [key, earned] of [
      ["badge1", data.attempts.length > 0],
      ["badge10", totalsData.passed >= 10],
      ["badge100", totalsData.passed >= 100],
      ["badge7", totalsData.longest >= 7],
    ])
      node(
        "span",
        "typing-badge" + (earned ? " is-earned" : ""),
        badges,
        `${earned ? "✦" : "◇"} ${t(key)}`,
      );
    const attempts = data.attempts.filter((a) => a.language === language());
    chart(content, attempts);
    const daily = card(content, "typing-activity-card");
    node("h3", "", daily, t("time"));
    const calendar = node("div", "typing-activity", daily);
    for (let i = 27; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = dayKey(date),
        ms = data.daily[key] || 0;
      const square = node("span", "", calendar, String(date.getDate()));
      square.title = `${key} · ${duration(ms)}`;
      if (ms > 0) square.className = "is-active";
    }
    const weak = card(content, "typing-weak-card");
    node("h3", "", weak, t(language() === "en" ? "heatmap" : "wrongChars"));
    if (language() === "en")
      renderKeyboard(node("div", "typing-keyboard", weak), null, data.weak.en);
    else {
      const chars = Object.entries(data.weak.zh)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30);
      for (const [key, n] of chars)
        node("span", "typing-error-chip", weak, `${key} · ${n}`);
      if (!chars.length) node("p", "typing-muted", weak, t("empty"));
    }
    const history = card(content, "typing-history-card");
    node("h3", "", history, t("history"));
    const list = node("div", "typing-history", history);
    const recent = attempts.slice().reverse();
    paginate(recent, history, list, 6, (row) => {
      const line = node("div", "typing-history-row", list);
      node("span", "typing-muted", line, row.date);
      node(
        "strong",
        "",
        line,
        row.lessonId
          ? t("lesson", { n: Number(row.lessonId.slice(3)) })
          : t(
              row.mode === "test"
                ? "test"
                : row.mode === "placement"
                  ? "placement"
                  : row.mode === "custom"
                    ? "custom"
                    : row.mode === "weak"
                      ? "weak"
                      : row.mode,
            ),
      );
      node(
        "span",
        "",
        line,
        `${row.speed.toFixed(1)} ${unit()} · ${row.accuracy.toFixed(1)}% · ${duration(row.elapsed)}`,
      );
      if (row.events) button("replay", () => openReplay(row), line);
    });
  }
  function openReplay(attempt) {
    pause();
    session = null;
    result = null;
    replayState = { attempt, time: 0, speed: 1, playing: false };
    render();
  }
  function renderReplay() {
    const panel = card(content, "typing-replay");
    node("h3", "", panel, t("replay"));
    textView = node("div", "typing-text", panel);
    const controls = node("div", "typing-actions", panel);
    const play = button(
      "continue",
      () => {
        replayState.playing = !replayState.playing;
        if (replayState.time >= replayState.attempt.elapsed)
          replayState.time = 0;
        play.textContent = t(replayState.playing ? "pause" : "continue");
        stamp = performance.now();
      },
      controls,
    );
    play.id = "typingReplayPlay";
    const speed = node("select", "typing-select", controls);
    speed.setAttribute("aria-label", t("speed"));
    for (const value of [1, 2, 4]) {
      const option = node("option", "", speed, value + "×");
      option.value = String(value);
    }
    speed.onchange = () => {
      replayState.speed = Number(speed.value);
    };
    const slider = node("input", "typing-replay-slider", panel);
    slider.type = "range";
    slider.min = "0";
    slider.max = String(Math.max(1, replayState.attempt.elapsed));
    slider.step = "1";
    slider.value = "0";
    slider.setAttribute("aria-label", t("timeline"));
    slider.oninput = () => {
      replayState.time = Number(slider.value);
      updateReplay();
    };
    button(
      "back",
      () => {
        stopReplay();
        render();
      },
      controls,
    );
    updateReplay();
  }
  function updateReplay() {
    if (!replayState) return;
    const { attempt, time } = replayState;
    paintText(attempt.text, E.replay(attempt.events, time), textView);
    const slider = content.querySelector(".typing-replay-slider");
    if (slider) slider.value = String(time);
    if (time >= attempt.elapsed) {
      replayState.playing = false;
      const play = document.getElementById("typingReplayPlay");
      if (play) play.textContent = t("continue");
    }
  }
  function tick() {
    if (disposed || !expansion.isOpen) return;
    const now = performance.now(),
      delta = Math.max(0, now - stamp);
    if (replayState?.playing && !document.hidden && expansion.isOpen) {
      replayState.time = Math.min(
        replayState.attempt.elapsed,
        replayState.time + delta * replayState.speed,
      );
      updateReplay();
    }
    tickTime();
    if (session?.started && !paused && !session.finished) {
      if (E.complete(session)) finish();
      else if (!composing) updateLive();
    }
    frame = setTimeout(tick, 100);
  }
  events.listen(document, "visibilitychange", () => {
    if (document.hidden) {
      pause();
      if (replayState) replayState.playing = false;
      if (session) render();
    }
    stamp = performance.now();
  });
  events.listen(window, "pagehide", () => {
    pause();
  });
  events.listen(window, "resize", () => {
    if (session && expansion.isOpen) updateLive();
  });
  events.listen(window, "beforeunload", (event) => {
    if (saveIssue || writing || saveTimer) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  events.listen(document, "worktime:languagechange", () => {
    pause();
    render();
  });
  const unsubscribe = store.subscribe((changes, reset) => {
    if (!reset || disposed) return;
    ++loadToken;
    ++saveGeneration;
    clearTimeout(saveTimer);
    saveTimer = null;
    session = null;
    result = null;
    stopReplay();
    data = store.read();
    data.settings.language = "en";
    saveIssue = false;
    render();
  });
  stamp = performance.now();
  tick();
  function refresh() {}
  async function open() {
    if (disposed || !WorkTimeApp.ui.dateInfo.isDevelopmentEnabled()) return;
    WorkTimeApp.ui.dateInfo.showToolsPanel();
    render();
    expansion.open();
    clearTimeout(frame);
    stamp = performance.now();
    tick();
  }
  return {
    hasDraft: () => !!(saveIssue || writing || saveTimer),
    open,
    refresh,
    close() {
      pause();
      expansion.close();
    },
    dispose() {
      if (disposed) return;
      pause();
      disposed = true;
      clearTimeout(frame);
      clearTimeout(saveTimer);
      events.dispose();
      unsubscribe();
      expansion.dispose();
      shell.remove();
      void audio?.close();
    },
  };
})();

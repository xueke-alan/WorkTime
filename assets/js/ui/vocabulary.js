"use strict";
WorkTimeApp.ui.vocabulary = (() => {
  const S = WorkTimeApp.services.vocabularyStorage;
  const E = WorkTimeApp.services.vocabularyEngine;
  const speech = WorkTimeApp.services.vocabularySpeech;
  const speakerIcon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/></svg>';
  const idle = WorkTimeApp.services.vocabularyIdle;
  const models = WorkTimeApp.services.vocabularyModels;
  const entries = WorkTimeApp.data.vocabularyCatalog.entries;
  const lookup = new Map(entries.map((e) => [e.id, e]));
  let data = S.read(),
    panel,
    session = null,
    current = null,
    busy = false,
    failed = null;
  let query = "",
    shown = 40,
    disposed = false,
    draftTimer,
    inputDraft = null,
    renderCount = 0,
    viewedBook = null,
    viewedEntry = null,
    bookScroll = 0,
    studyActions = null,
    revealAnimation = false,
    previousReview = null,
    correction = null,
    advanceTimer,
    miniMode = false,
    advancePending = false,
    savedScroll = 0,
    settingsController;
  let modelBusy = false;
  let audioReady = false,
    view = "home",
    notice = "saved",
    speechStatus = speech.status;
  const t = (key, values) => WorkTimeApp.i18n.t("vocabulary." + key, values);
  const pageLabels = {
    learning: "navReview",
    books: "navWords",
    analysis: "navStatistics",
    preferences: "navSettings",
  };
  const host = document.getElementById("vocabularyPanel");
  const editor = host.closest(".editor");
  const content = node("div", undefined, "vocabulary-content");
  content.id = "vocabularyContent";
  const drawerViewport = node("div", undefined, "vocabulary-drawer-viewport");
  const drawerBody = node("div", undefined, "vocabulary-drawer-body");
  drawerViewport.append(drawerBody);
  const header = node(
    "header",
    undefined,
    "vocabulary-header page-settings-header editor-mode-header",
  );
  const headerTitle = node("h2");
  header.append(headerTitle);
  content.append(header, drawerViewport);
  host.replaceChildren(content);
  const fullHost = host.parentElement;
  const mini = node("div", undefined, "vocabulary-mini vocabulary-content");
  mini.dataset.page = "study";
  mini.hidden = true;
  const miniBack = node(
    "button",
    undefined,
    "ui-button icon-only vocabulary-mini-back",
  );
  miniBack.type = "button";
  miniBack.innerHTML =
    '<svg class="ui-icon" aria-hidden="true"><use href="#ms-arrow-back"/></svg>';
  miniBack.onclick = () => WorkTimeApp.ui.dateInfo.showToolsPanel("vocabulary");
  const miniExpand = node("button", undefined, "vocabulary-mini-expand");
  miniExpand.type = "button";
  miniExpand.onclick = () => setMini(false);
  const miniHeader = node("div", undefined, "vocabulary-study-header");
  mini.append(miniBack, miniExpand, miniHeader);
  host.append(mini);
  panel = content;
  const visible = () =>
    !miniMode &&
    !host.hidden &&
    !editor.classList.contains("is-settings-open") &&
    !editor.classList.contains("is-page-settings-open");
  let suspended = !visible();
  const animationCompat = WorkTimeApp.ui.animationCompat;
  const motionPreference = animationCompat.preference();
  let modeAnimations = [],
    modeSnapshots = [],
    movingSurface = null,
    movingTitle = null,
    movingDistance = 0;
  let modeStyles = [];
  function modeStyle(element, property, value) {
    if (
      !modeStyles.some(
        (item) => item.element === element && item.property === property,
      )
    )
      modeStyles.push({ element, property, value: element.style[property] });
    element.style[property] = value;
  }
  function stopModeAnimation() {
    modeAnimations.splice(0).forEach((animation) => animation.cancel());
    modeSnapshots.splice(0).forEach((snapshot) => snapshot.remove());
    modeStyles.splice(0).forEach(({ element, property, value }) => {
      element.style[property] = value;
    });
    movingSurface = movingTitle = null;
    movingDistance = 0;
    if (editor.classList.contains("is-vocabulary-drawer-moving"))
      editor.classList.remove("is-vocabulary-drawer-moving");
  }
  function drawerSnapshot(source, bounds = source?.getBoundingClientRect()) {
    if (!source || !bounds) return null;
    const frame = node(
      "div",
      undefined,
      "vocabulary-content vocabulary-drawer-snapshot",
    );
    frame.dataset.page = content.dataset.page;
    frame.inert = true;
    frame.setAttribute("aria-hidden", "true");
    const origin = editor.getBoundingClientRect();
    Object.assign(frame.style, {
      top: bounds.top - origin.top - editor.clientTop + editor.scrollTop + "px",
      left:
        bounds.left -
        origin.left -
        editor.clientLeft +
        editor.scrollLeft +
        "px",
      width: bounds.width + "px",
      height: bounds.height + "px",
    });
    const copy = source.cloneNode(true);
    for (const element of [copy, ...copy.querySelectorAll("*")]) {
      element.removeAttribute("id");
      element.removeAttribute("autofocus");
      // Cloning a revealed answer must not restart its CSS entrance animation
      // underneath the drawer's outgoing meaning fade.
      element.classList.remove("vocabulary-revealing");
    }
    Object.assign(copy.style, {
      width: "100%",
      height: "100%",
      flex: "none",
      margin: "0",
    });
    if (source !== drawerBody) {
      copy.style.background = "transparent";
      copy.style.border = "0";
    }
    frame.append(copy);
    editor.append(frame);
    const originals = [source, ...source.querySelectorAll("*")];
    [copy, ...copy.querySelectorAll("*")].forEach((element, index) => {
      element.scrollTop = originals[index].scrollTop;
      element.scrollLeft = originals[index].scrollLeft;
      if (element.matches(".vocabulary-meaning")) {
        const painted = getComputedStyle(originals[index]);
        element.style.opacity = painted.opacity;
        element.style.transform = painted.transform;
      }
    });
    modeSnapshots.push(frame);
    return copy;
  }
  const unlistenMotion = animationCompat.listen(motionPreference, () => {
    if (motionPreference.matches) stopModeAnimation();
  });
  function stopHiddenAnimation() {
    if (document.hidden) stopModeAnimation();
  }
  document.addEventListener("visibilitychange", stopHiddenAnimation);
  window.addEventListener("resize", stopModeAnimation);
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function button(text, fn, className = "ui-button") {
    const el = node("button", text, className);
    if (className.includes("vocabulary-primary")) el.classList.add("primary");
    el.type = "button";
    el.disabled = busy || !!failed;
    el.onclick = fn;
    return el;
  }
  async function persist(candidate, after, rerender = true) {
    if (busy) return false;
    clearTimeout(draftTimer);
    busy = true;
    const previousRender = renderCount;
    if (rerender) render();
    try {
      const result = await S.save(candidate);
      if (!result?.persisted) throw Error("Save not persisted");
      data = candidate;
      failed = null;
      notice = "saved";
      after?.();
      return true;
    } catch {
      if (candidate.draft && candidate.draft.id === current?.id)
        data.draft = structuredClone(candidate.draft);
      failed = { candidate, after };
      notice = "saveFailed";
      return false;
    } finally {
      busy = false;
      if (rerender || failed || renderCount !== previousRender) render();
    }
  }
  function updateSettings(key, value, after) {
    speech.stop();
    const next = structuredClone(data);
    if (key === "accent" && inputDraft?.id === next.draft?.id)
      next.draft.answer = inputDraft.answer;
    inputDraft = null;
    next.settings[key] = value;
    if (!["accent", "autoRead"].includes(key)) next.draft = null;
    const settingsPanel = view === "preferences" ? panel : null;
    if (settingsPanel) settingsPanel.inert = true;
    void persist(
      next,
      () => {
        if (!["accent", "autoRead"].includes(key)) {
          session = null;
          current = null;
          previousReview = correction = null;
        }
        audioReady = false;
        after?.();
      },
      !settingsPanel,
    ).finally(() => {
      if (settingsPanel) settingsPanel.inert = false;
    });
  }
  function phoneticText(entry) {
    const accent = data.settings.accent;
    const ipa =
      entry.phonetics?.[accent] ||
      entry.pronunciationVariants?.[accent]?.[0]?.ipa;
    return ipa ? "/" + ipa + "/" : "";
  }

  function select(key, values) {
    const label = node("label", t(key), "vocabulary-field");
    const control = node("select");
    control.setAttribute("aria-label", t(key));
    label.dataset.settingField = key;
    control.disabled = busy || !!failed;
    for (const value of values) {
      const option = node("option", t(value));
      option.value = value;
      control.append(option);
    }
    control.value = data.settings[key];
    control.onchange = () => updateSettings(key, control.value);
    label.append(control);
    return label;
  }
  function refreshStatus() {
    const status = panel?.querySelector(".vocabulary-speech-status");
    if (status) {
      status.textContent = t(speechStatus);
      status.hidden =
        view === "preferences" ||
        ["idle", "ready", "loading", "generating"].includes(speechStatus);
    }
  }
  const unsubscribe = speech.subscribe(() => {
    speechStatus = speech.status;
    refreshStatus();
  });
  function refreshCache() {
    const toggle = panel?.querySelector('[data-setting="autoCache"]');
    if (toggle) toggle.checked = idle.settings.enabled && !idle.settings.paused;
    const verify = panel?.querySelector(".vocabulary-verify-cache");
    if (verify) {
      verify.disabled = busy || idle.state.verifyingCache;
      verify.textContent = t(
        idle.state.verifyingCache ? "verifyingCache" : "verifyCache",
      );
    }
  }
  const unsubscribeCache = idle.subscribe(refreshCache);
  function refreshModels() {
    const status = content.querySelector(".vocabulary-model-status");
    const state = models.state;
    if (status)
      status.textContent =
        t("models_" + state.phase) +
        (state.phase === "downloading" && state.total
          ? " " + Math.floor((state.loaded / state.total) * 100) + "%"
          : "");
    for (const control of content.querySelectorAll("[data-model-action]"))
      control.disabled =
        modelBusy || ["downloading", "importing"].includes(state.phase);
    const cancel = content.querySelector(".vocabulary-model-cancel");
    if (cancel) cancel.hidden = state.phase !== "downloading";
  }
  const unsubscribeModels = models.subscribe(refreshModels);
  const unsubscribeStorage = S.subscribe((changes, reset) => {
    if (!reset || disposed) return;
    speech.stop();
    clearTimeout(draftTimer);
    data = S.read();
    current = null;
    session = null;
    previousReview = correction = null;
    clearTimeout(advanceTimer);
    view = "home";
    failed = null;
    render();
  });
  async function play(entry = current, miniPlayback = false) {
    if (
      !entry ||
      (miniPlayback
        ? !miniMode ||
          host.hidden ||
          editor.classList.contains("is-settings-open") ||
          editor.classList.contains("is-page-settings-open")
        : !visible())
    )
      return;
    const id = current?.id,
      mode = data.settings.mode;
    try {
      const played = await speech.play(entry, data.settings.accent);
      if (
        played &&
        !miniPlayback &&
        view === "study" &&
        current?.id === id &&
        mode === "dictation" &&
        entry.id === id
      ) {
        audioReady = true;
        const input = content.querySelector(".vocabulary-answer");
        if (input) {
          input.disabled = busy || !!failed;
          input.focus();
        }
        const check = content.querySelector("[data-action=check]");
        if (check) check.disabled = busy || !!failed;
      }
    } catch {
      /* Speech status exposes a retryable failure; no online fallback. */
    }
  }
  function controls() {
    const row = node("div", undefined, "vocabulary-controls");
    row.append(select("mode", ["recall", "spelling", "dictation"]));
    const label = node("label", t("dailyNew"), "vocabulary-field"),
      count = node("input");
    label.dataset.settingField = "dailyNew";
    count.type = "number";
    count.min = "1";
    count.max = "200";
    count.value = data.settings.dailyNew;
    count.disabled = busy || !!failed;
    count.onchange = () => {
      const n = Number(count.value);
      if (Number.isInteger(n) && n >= 1 && n <= 200)
        updateSettings("dailyNew", n);
      else count.value = data.settings.dailyNew;
    };
    label.append(count);
    row.append(label);
    return row;
  }
  function start() {
    if (busy || failed) return;
    panel.scrollTop = 0;
    speech.stop();
    previousReview = correction = null;
    const items = E.queue(data, entries).items;
    if (
      data.draft &&
      data.draft.mode === data.settings.mode &&
      lookup.has(data.draft.id)
    ) {
      const entry = lookup.get(data.draft.id);
      session = [entry, ...items.filter((e) => e.id !== entry.id)];
    } else session = items;
    view = "study";
    nextCard();
  }
  function nextCard() {
    if (miniMode) {
      advancePending = true;
      return;
    }
    advancePending = false;
    panel.scrollTop = 0;
    current = session?.[0] || null;
    audioReady = false;
    if (current) {
      const next = structuredClone(data);
      if (!next.draft || next.draft.id !== current.id)
        next.draft = {
          id: current.id,
          mode: data.settings.mode,
          answer: "",
          revealed: false,
          correct: null,
        };
      void persist(next, () => {
        if (!visible() || view !== "study") return;
        if (data.settings.mode === "dictation") void play();
      });
    } else {
      view = "home";
      render();
    }
  }
  function reveal() {
    if (busy || failed || !current || data.draft?.revealed) return;
    const next = structuredClone(data);
    const answer =
      content.querySelector(".vocabulary-answer")?.value ?? next.draft.answer;
    inputDraft = null;
    next.draft = {
      ...next.draft,
      answer,
      revealed: true,
      correct:
        data.settings.mode === "recall" ? null : E.correct(current, answer),
    };
    void persist(next, () => {
      revealAnimation = true;
      if (data.settings.autoRead !== false) void play();
    });
  }
  function grade(value) {
    if (busy || failed || !current || !data.draft?.revealed) return;
    if (data.draft.correct === false) value = 1;
    try {
      const entry = current;
      const mode = data.settings.mode;
      const key = E.key(entry.id, mode);
      const before = {
        entry,
        mode,
        key,
        card: structuredClone(data.cards[key]),
        draft: structuredClone(data.draft),
        session: [...session],
        grade: value,
      };
      const next = E.review(data, entry, mode, value);
      const correcting = correction?.id === entry.id;
      if (correcting && correction.resumeDraft)
        next.draft = correction.resumeDraft;
      before.log = structuredClone(next.logs.at(-1));
      void persist(next, () => {
        speech.stop();
        previousReview = correcting ? null : before;
        correction = null;
        session.shift();
        advanceTimer = setTimeout(nextCard, 0);
      });
    } catch {
      notice = "saveFailed";
      render();
    }
  }
  function undoReview() {
    if (busy || failed || !previousReview || correction) return;
    const previous = previousReview;
    if (
      previous.mode !== data.settings.mode ||
      JSON.stringify(data.logs.at(-1)) !== JSON.stringify(previous.log)
    )
      return;
    const next = structuredClone(data);
    if (previous.card === undefined) delete next.cards[previous.key];
    else next.cards[previous.key] = structuredClone(previous.card);
    next.logs.pop();
    const resumeDraft =
      next.draft?.id !== previous.entry.id ? next.draft : null;
    next.draft = structuredClone(previous.draft);
    inputDraft = null;
    void persist(next, () => {
      clearTimeout(advanceTimer);
      speech.stop();
      previousReview = null;
      correction = {
        id: previous.entry.id,
        grade: previous.grade,
        resumeDraft,
      };
      session = [...previous.session];
      current = previous.entry;
      audioReady = true;
      view = "study";
      panel.scrollTop = 0;
    });
  }
  function keyboard(event) {
    if (
      disposed ||
      !visible() ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      document.querySelector("dialog[open], .workspace.is-game-expanded") ||
      !["study", "home"].includes(view)
    )
      return;
    const target = event.target;
    if (
      target instanceof Element &&
      (target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
      ) ||
        (target !== document.body &&
          target !== document.documentElement &&
          !content.contains(target)))
    )
      return;
    const recognized = [
      " ",
      "ArrowLeft",
      "ArrowDown",
      "ArrowRight",
      "ArrowUp",
    ].includes(event.key);
    if (
      !recognized ||
      (view !== "study" && !(event.key === "ArrowUp" && previousReview))
    )
      return;
    event.preventDefault();
    if (event.repeat || busy || failed) return;
    if (event.key === "ArrowUp") {
      undoReview();
      return;
    }
    if (event.key === " ") {
      if (data.settings.mode === "recall") reveal();
      return;
    }
    const rating = { ArrowLeft: 3, ArrowDown: 2, ArrowRight: 1 }[event.key];
    const choice = content.querySelector(`[data-grade="${rating}"]`);
    if (choice && !choice.disabled) choice.click();
  }
  document.addEventListener("keydown", keyboard);
  function library(book = data.settings.book) {
    const box = node("section", undefined, "vocabulary-library");
    const search = node("input");
    search.type = "search";
    search.placeholder = t("search");
    search.setAttribute("aria-label", t("search"));
    search.value = query;
    const results = node("div", undefined, "vocabulary-list");
    function fill() {
      results.replaceChildren();
      const matching = entries.filter(
        (e) =>
          e.books.includes(book) &&
          (!query ||
            (e.word + " " + e.zh).toLowerCase().includes(query.toLowerCase())),
      );
      for (const entry of matching.slice(0, shown)) {
        const row = node("div", undefined, "vocabulary-row"),
          text = node("div");
        const open = () => {
          if (busy || failed) return;
          bookScroll = results.scrollTop;
          viewedEntry = entry;
          changePage("word");
          content
            .querySelector(".vocabulary-word-back")
            ?.focus({ preventScroll: true });
        };
        const word = button("", open, "vocabulary-word-open");
        word.dataset.word = entry.id;
        word.append(node("strong", entry.word));
        const pronunciation = node(
          "div",
          undefined,
          "vocabulary-list-pronunciation",
        );
        const playButton = button(
          "",
          () => play(entry),
          "vocabulary-list-play",
        );
        playButton.setAttribute("aria-label", t("play") + ": " + entry.word);
        playButton.innerHTML = speakerIcon;
        pronunciation.append(
          node("small", phoneticText(entry), "vocabulary-phonetic"),
          playButton,
        );
        const heading = node("div", undefined, "vocabulary-list-heading");
        heading.append(word, pronunciation);
        text.append(heading, node("p", entry.zh));
        row.append(text);
        row.onclick = (event) => {
          if (
            !event.target.closest("button") &&
            !window.getSelection()?.toString()
          )
            open();
        };
        results.append(row);
      }
      if (!matching.length) results.append(node("p", t("empty")));
      if (matching.length > shown)
        results.append(
          button(t("more"), () => {
            shown += 40;
            fill();
          }),
        );
    }
    search.oninput = () => {
      query = search.value;
      shown = 40;
      fill();
      results.scrollTop = 0;
    };
    box.append(search, results);
    fill();
    return box;
  }
  function home() {
    const stats = E.statistics(data);
    const today = data.logs.filter(
      (log) => E.day(log.at) === E.day(Date.now()),
    );
    const hero = node("section", undefined, "vocabulary-hero");
    hero.append(
      node("span", t("streak"), "vocabulary-eyebrow"),
      node(
        "strong",
        String(stats.streak).padStart(2, "0"),
        "vocabulary-streak",
      ),
    );
    panel.append(
      hero,
      node("h3", t("todayPlan")),
      metrics({
        newLearned: today.filter((log) => log.first).length,
        reviewCount: today.filter((log) => !log.first).length,
        today: stats.today,
      }),
    );
  }
  function metrics(values) {
    const row = node("div", undefined, "vocabulary-stats");
    for (const [key, value] of Object.entries(values)) {
      const item = node("div");
      item.append(node("strong", String(value)), node("span", t(key)));
      row.append(item);
    }
    return row;
  }
  function bookSummary(book) {
    const words = entries.filter((e) => e.books.includes(book)),
      known = new Set(data.logs.map((l) => l.id));
    return words.filter((e) => known.has(e.id)).length + " / " + words.length;
  }
  function books() {
    const list = node("div", undefined, "vocabulary-books");
    for (const [index, id] of [
      "daily",
      "cet6",
      "kaoyan",
      "toefl",
      "ielts",
    ].entries()) {
      const book = button(
        "",
        () => {
          viewedBook = id;
          query = "";
          shown = 40;
          changePage("book");
        },
        "vocabulary-book",
      );
      book.dataset.book = id;
      book.classList.toggle("is-current", id === data.settings.book);
      const cover = node("span", undefined, "vocabulary-book-cover");
      cover.dataset.color = String(index);
      cover.append(
        node("small", "ENGLISH"),
        node("strong", id === "daily" ? "Aa" : id.toUpperCase()),
        node("span", String(index + 1).padStart(2, "0")),
      );
      const info = node("span", undefined, "vocabulary-book-info");
      info.append(
        node("strong", t(id)),
        node("small", bookSummary(id)),
        node(
          "span",
          t(id === data.settings.book ? "currentBook" : "chooseBook"),
        ),
      );
      book.append(cover, info);
      list.append(book);
    }
    panel.append(list);
  }
  function bookDetail() {
    const id = viewedBook || data.settings.book;
    const heading = node("div", undefined, "vocabulary-book-heading");
    const title = node("div", undefined, "vocabulary-book-title");
    title.append(
      node("h3", t(id)),
      node("p", bookSummary(id), "vocabulary-muted"),
    );
    const use = button(
      t(id === data.settings.book ? "currentBook" : "useBook"),
      () => {
        if (id === data.settings.book) {
          enterReview();
          return;
        }
        updateSettings("book", id, () => {
          view = "home";
        });
      },
      "ui-button primary vocabulary-use-book",
    );
    use.dataset.action = "use-book";
    heading.append(title, use);
    panel.append(heading, library(id));
  }
  function analysis() {
    const stats = E.statistics(data),
      report = E.analysis(data);
    panel.append(
      metrics({
        learned: stats.learned,
        totalReviews: report.total,
        streak: stats.streak,
      }),
    );
    panel.append(node("h3", t("recentActivity")));
    const chart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chart.setAttribute("viewBox", "0 0 280 114");
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", t("recentActivity"));
    chart.classList.add("vocabulary-chart");
    const days = report.days.slice(-30),
      max = Math.max(1, ...days.map((d) => d.fresh + d.reviews));
    for (const [i, day] of days.entries()) {
      for (const [j, name] of ["fresh", "reviews"].entries()) {
        const bar = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "rect",
        );
        const height = (day[name] / max) * 85;
        bar.setAttribute("x", String(i * 9 + 6));
        bar.setAttribute(
          "y",
          String(94 - height - (j ? (day.fresh / max) * 85 : 0)),
        );
        bar.setAttribute("width", "5");
        bar.setAttribute("height", String(height));
        bar.setAttribute("rx", "1");
        bar.classList.add("vocabulary-bar-" + name);
        const title = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "title",
        );
        title.textContent = `${day.day} · ${t(j ? "reviewCount" : "newLearned")} ${day[name]}`;
        bar.append(title);
        chart.append(bar);
      }
    }
    panel.append(chart);
    const legend = node("div", undefined, "vocabulary-chart-legend");
    legend.append(
      node("span", t("newLearned"), "vocabulary-legend-new"),
      node("span", t("reviewCount"), "vocabulary-legend-review"),
    );
    panel.append(legend);
    if (!report.total)
      panel.append(node("p", t("noActivity"), "vocabulary-muted"));
    panel.append(node("h3", t("activityCalendar")));
    const calendar = node("div", undefined, "vocabulary-heatmap");
    calendar.setAttribute("aria-label", t("activityCalendar"));
    for (const day of report.days) {
      const cell = node("span", day.day.slice(-2));
      const count = day.fresh + day.reviews;
      cell.dataset.level = String(
        count === 0 ? 0 : count < 10 ? 1 : count < 30 ? 2 : 3,
      );
      cell.title = `${day.day} · ${t("today")} ${count}`;
      calendar.append(cell);
    }
    panel.append(calendar, node("h3", t("latestFeedback")));
    const feedback = node("div", undefined, "vocabulary-feedback");
    const total = Math.max(1, report.learned);
    ["again", "hard", "good", "easy"].forEach((key, i) => {
      const row = node("div");
      const bar = node("progress");
      bar.max = total;
      bar.value = report.feedback[i];
      bar.setAttribute("aria-label", t(key));
      row.append(
        node("span", t(key)),
        bar,
        node("strong", String(report.feedback[i])),
      );
      feedback.append(row);
    });
    panel.append(feedback, node("p", t("feedbackHint"), "vocabulary-muted"));
  }
  function preferences() {
    panel.classList.add("vocabulary-preferences");
    function toggle(key, checked, change) {
      const label = node("label", undefined, "vocabulary-switch-row");
      const input = node("input", undefined, "vocabulary-switch");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.dataset.setting = key;
      input.checked = checked;
      input.disabled = busy || !!failed;
      input.onchange = () => change(input.checked);
      label.append(node("span", t(key)), input);
      return label;
    }
    panel.append(
      controls(),
      (() => {
        const row = node("div", undefined, "vocabulary-switch-row");
        const accent = node("button", undefined, "vocabulary-accent-switch");
        accent.type = "button";
        accent.setAttribute("role", "switch");
        accent.setAttribute(
          "aria-label",
          t("accent") + ": " + t(data.settings.accent),
        );
        accent.setAttribute(
          "aria-checked",
          String(data.settings.accent === "us"),
        );
        accent.dataset.setting = "accent";
        accent.disabled = busy || !!failed;
        accent.append(node("span", t("shortUK")), node("span", t("shortUS")));
        accent.onclick = () => {
          const value = data.settings.accent === "us" ? "uk" : "us";
          accent.setAttribute("aria-checked", String(value === "us"));
          accent.setAttribute("aria-label", t("accent") + ": " + t(value));
          updateSettings("accent", value);
        };
        const accentLabel = node("span", t("accent"));
        accentLabel.append(
          node("small", t("accentCaution"), "vocabulary-accent-caution"),
        );
        row.append(accentLabel, accent);
        return row;
      })(),
      toggle("autoRead", data.settings.autoRead !== false, (checked) =>
        updateSettings("autoRead", checked),
      ),
      toggle(
        "autoCache",
        idle.settings.enabled && !idle.settings.paused,
        (checked) => idle.configure({ enabled: checked, paused: false }),
      ),
    );
    const capacity = node(
      "label",
      t("cacheCapacity"),
      "vocabulary-field vocabulary-capacity",
    );
    const size = node("select");
    size.setAttribute("aria-label", t("cacheCapacity"));
    size.disabled = busy || !!failed;
    for (const limit of idle.limits) {
      const option = node(
        "option",
        limit === Number.MAX_SAFE_INTEGER
          ? t("cacheUnlimited")
          : limit / 1024 ** 3 + " GiB",
      );
      option.value = String(limit);
      size.append(option);
    }
    size.value = String(idle.settings.limit);
    size.onchange = () => idle.configure({ limit: Number(size.value) });
    capacity.append(size);
    const clear = button(t("clear"), async () => {
      try {
        await speech.clear();
      } catch {
        speechStatus = "cacheWarning";
      }
      refreshCache();
    });
    clear.classList.add("vocabulary-clear-cache");
    const pool = node("label", t("workerPool"), "vocabulary-field");
    const poolSize = node("select");
    poolSize.setAttribute("aria-label", t("workerPool"));
    poolSize.disabled = busy || !!failed;
    for (const value of idle.poolSizes) {
      const option = node(
        "option",
        value === "auto" ? t("workerAuto") : String(value),
      );
      option.value = String(value);
      poolSize.append(option);
    }
    poolSize.value = String(idle.settings.poolSize);
    poolSize.onchange = () =>
      idle.configure({
        poolSize: poolSize.value === "auto" ? "auto" : Number(poolSize.value),
      });
    pool.append(poolSize);
    const verify = button(t("verifyCache"), async () => {
      try {
        await idle.verify();
      } catch {
        speechStatus = "cacheWarning";
      }
      refreshCache();
    });
    verify.classList.add("vocabulary-verify-cache");
    verify.disabled = busy || idle.state.verifyingCache;
    const resources = node("div", undefined, "vocabulary-resource-settings");
    resources.append(pool, capacity);
    const actions = node("div", undefined, "vocabulary-cache-actions");
    actions.append(verify, clear);
    panel.append(resources, actions);
    const modelSection = node(
      "section",
      undefined,
      "vocabulary-model-settings",
    );
    const modelStatus = node("p", "", "vocabulary-model-status");
    modelStatus.setAttribute("role", "status");
    const modelActions = node("div", undefined, "vocabulary-cache-actions");
    async function manageModel(action) {
      if (modelBusy) return;
      modelBusy = true;
      refreshModels();
      try {
        await action();
      } catch {
        /* The model status supplies the retry/import guidance. */
      } finally {
        modelBusy = false;
        refreshModels();
      }
    }
    const download = button(t("modelDownload"), () =>
      manageModel(() => models.prepare()),
    );
    download.dataset.modelAction = "download";
    const upload = node("input");
    upload.type = "file";
    upload.accept = ".wtmodels";
    upload.hidden = true;
    upload.onchange = () => {
      const file = upload.files[0];
      upload.value = "";
      if (file) void manageModel(() => models.install(file));
    };
    const importModel = button(t("modelImport"), () => upload.click());
    importModel.dataset.modelAction = "import";
    const cancelModel = button(t("modelCancel"), () => models.cancel());
    cancelModel.classList.add("vocabulary-model-cancel");
    download.textContent = t("modelDownloadShort");
    importModel.textContent = t("modelImportShort");
    verify.textContent = t("cacheVerifyShort");
    clear.textContent = t("cacheClearShort");
    modelActions.append(download, importModel);
    modelSection.append(node("h4", t("modelGroup")), modelActions);
    const cacheSection = node(
      "section",
      undefined,
      "vocabulary-cache-settings",
    );
    cacheSection.append(node("h4", t("cacheGroup")), actions);
    const groups = node("div", undefined, "vocabulary-management-groups");
    groups.append(modelSection, cacheSection);
    panel.append(groups, cancelModel, upload, modelStatus);
    refreshModels();
    settingsController = new AbortController();
    for (const [index, native] of [
      ...panel.querySelectorAll("select"),
    ].entries()) {
      const old = native.closest(".vocabulary-field");
      const field = node("div", undefined, old.className);
      Object.assign(field.dataset, old.dataset);
      const label = node("label", old.firstChild.textContent);
      native.id = "vocabularySetting" + index;
      label.id = native.id + "Label";
      old.replaceWith(field);
      field.append(label, native);
      WorkTimeApp.ui.createSelect({
        host: field,
        select: native,
        label,
        signal: settingsController.signal,
      });
    }
  }

  function enterReview() {
    if (busy || failed) return;
    if (session === null || session.length === 0) {
      start();
      return;
    }
    changePage("study");
  }
  function changePage(next) {
    flushInput();
    speech.stop();
    panel.scrollTop = 0;
    view = next;
    render();
  }
  function createWordHeader(entry, miniPlayback = false, showAnswer = false) {
    const wordHeader = node("div", undefined, "vocabulary-word-header");
    const mode = showAnswer ? "recall" : data.settings.mode;
    const draft = showAnswer
      ? { revealed: true }
      : data.draft || { revealed: false };
    if (mode === "recall" || draft.revealed)
      wordHeader.append(node("h3", entry.word));
    const voiceLabel = t(data.settings.accent === "uk" ? "shortUK" : "shortUS");
    const phonetic = phoneticText(entry);
    if (mode !== "spelling" || draft.revealed) {
      const pronunciation = node("div", undefined, "vocabulary-pronunciation");
      if ((draft.revealed || mode === "recall") && phonetic)
        pronunciation.append(node("span", phonetic, "vocabulary-phonetic"));
      const playButton = button(
        "",
        () => play(entry, miniPlayback),
        "vocabulary-pronunciation-play",
      );
      playButton.setAttribute("aria-label", t("play") + " · " + voiceLabel);
      playButton.innerHTML = speakerIcon;
      playButton.append(node("span", voiceLabel));
      pronunciation.append(playButton);
      wordHeader.append(pronunciation);
    }
    return wordHeader;
  }
  function study() {
    if (!current) {
      panel.append(node("p", t("complete"), "vocabulary-complete"));
      return;
    }
    const draft = data.draft || { answer: "", revealed: false, correct: null };
    const card = node("section", undefined, "vocabulary-card"),
      mode = data.settings.mode;
    studyActions = node("div", undefined, "vocabulary-study-actions");
    card.append(createWordHeader(current));
    if (mode === "spelling" || draft.revealed)
      card.append(node("p", current.zh, "vocabulary-meaning"));
    if (!draft.revealed && mode !== "recall")
      card.append(
        node(
          "p",
          t(mode === "recall" ? "tapReveal" : mode + "Prompt"),
          "vocabulary-muted vocabulary-study-prompt",
        ),
      );
    if (mode !== "recall" && !draft.revealed) {
      const input = node("input", undefined, "vocabulary-answer");
      input.type = "text";
      input.placeholder = t("answer");
      input.setAttribute("aria-label", t("answer"));
      input.autocomplete = "off";
      input.spellcheck = false;
      input.autocapitalize = "off";
      input.value =
        inputDraft?.id === current.id ? inputDraft.answer : draft.answer;
      input.disabled =
        busy || !!failed || (mode === "dictation" && !audioReady);
      input.oninput = () => {
        inputDraft = { id: current.id, answer: input.value };
        clearTimeout(draftTimer);
        draftTimer = setTimeout(flushInput, 500);
      };
      input.onkeydown = (event) => {
        if (event.key === "Enter" && !event.isComposing && !input.disabled)
          reveal();
      };
      card.append(input);
    }
    if (!draft.revealed && mode !== "recall") {
      const check = button(t("check"), reveal, "ui-button vocabulary-primary");
      check.dataset.action = "check";
      if (mode === "dictation" && !audioReady) check.disabled = true;
      studyActions.append(check);
    } else if (draft.revealed) {
      if (draft.correct !== null)
        card.append(
          node(
            "p",
            t(draft.correct ? "right" : "wrong") +
              (draft.answer ? " · " + draft.answer : ""),
            draft.correct ? "vocabulary-right" : "vocabulary-wrong",
          ),
        );
      const ratings = node("div", undefined, "vocabulary-ratings");
      const now = Date.now();
      [
        ["recognized", 3],
        ["uncertain", 2],
        ["forgotten", 1],
      ].forEach(([key, rating]) => {
        const b = button("", () => grade(rating), "vocabulary-rating");
        b.dataset.grade = String(rating);
        b.setAttribute(
          "aria-keyshortcuts",
          { 3: "ArrowLeft", 2: "ArrowDown", 1: "ArrowRight" }[rating],
        );
        if (correction?.id === current.id) {
          const selected = correction.grade === rating;
          b.classList.toggle("is-previous-choice", selected);
          b.setAttribute("aria-pressed", String(selected));
        }
        const result = globalThis.WorkTimeFSRS.review(
          data.cards[E.key(current.id, mode)],
          rating,
          now,
        );
        const minutes = Math.max(
          1,
          Math.ceil((Date.parse(result.card.due) - now) / 60000),
        );
        const delay =
          rating <= 2 || minutes < 1440
            ? t("reviewToday")
            : t("reviewDays", { n: Math.round(minutes / 1440) });
        b.append(node("strong", t(key)), node("small", delay));
        if (draft.correct === false && rating !== 1) b.disabled = true;
        ratings.append(b);
      });
      studyActions.append(ratings);
    }
    const studyHeader = node("div", undefined, "vocabulary-study-header");
    studyHeader.append(card);
    drawerBody.insertBefore(studyHeader, panel);
    if (!draft.revealed && mode === "recall") {
      studyActions = null;
      panel.classList.add("vocabulary-recall");
      const prompt = node("div", undefined, "vocabulary-recall-prompt");
      prompt.append(
        node("h4", t("recallPrompt")),
        node("p", t("tapReveal"), "vocabulary-muted"),
      );
      panel.append(prompt);
      panel.dataset.action = "reveal";
      panel.tabIndex = 0;
      panel.setAttribute("aria-label", t("tapReveal"));
      panel.onclick = (event) => {
        if (
          event.target.closest("button, input, a, select, textarea, label") ||
          window.getSelection()?.toString()
        )
          return;
        reveal();
      };
      panel.onkeydown = (event) => {
        if (event.target === panel && event.key === "Enter") {
          event.preventDefault();
          reveal();
        }
      };
      studyHeader.onclick = panel.onclick;
    }
    if (draft.revealed) {
      studyDetails();
      if (revealAnimation) {
        studyHeader.classList.add("vocabulary-revealing");
        panel.classList.add("vocabulary-revealing");
        revealAnimation = false;
      }
    }
  }
  function wordDetail() {
    if (!viewedEntry) {
      bookDetail();
      return;
    }
    const studyHeader = node("div", undefined, "vocabulary-study-header");
    const back = button(
      "",
      () => {
        const id = viewedEntry.id;
        changePage("book");
        panel.querySelector(".vocabulary-list").scrollTop = bookScroll;
        [...panel.querySelectorAll(".vocabulary-word-open")]
          .find((button) => button.dataset.word === id)
          ?.focus({ preventScroll: true });
      },
      "vocabulary-word-back",
    );
    back.setAttribute("aria-label", t("back"));
    back.innerHTML =
      '<svg class="ui-icon" aria-hidden="true"><use href="#ms-arrow-back"/></svg>';
    const card = node("section", undefined, "vocabulary-card");
    card.append(
      createWordHeader(viewedEntry, false, true),
      node("p", viewedEntry.zh, "vocabulary-meaning"),
    );
    studyHeader.append(back, card);
    drawerBody.insertBefore(studyHeader, panel);
    studyDetails(viewedEntry);
  }
  function studyDetails(entry = current) {
    function section(key) {
      const block = node("section", undefined, "vocabulary-detail-section");
      block.append(node("h4", t(key)));
      panel.append(block);
      return block;
    }
    const examples = section("examples");
    if (!entry.examples?.length)
      examples.append(node("p", t("noExamples"), "vocabulary-muted"));
    for (const example of entry.examples || []) {
      const item = node("div", undefined, "vocabulary-example");
      const english = node("p");
      const text = example.en,
        needle = entry.word.toLowerCase();
      const index = text.toLowerCase().indexOf(needle);
      if (index < 0) english.textContent = text;
      else
        english.append(
          document.createTextNode(text.slice(0, index)),
          node("mark", text.slice(index, index + needle.length)),
          document.createTextNode(text.slice(index + needle.length)),
        );
      const playButton = button(
        "",
        () => play({ word: example.en }),
        "vocabulary-example-play",
      );
      playButton.setAttribute("aria-label", t("play") + ": " + example.en);
      playButton.innerHTML = speakerIcon;
      english.prepend(playButton);
      item.append(
        english,
        node("p", example.zh, "vocabulary-example-translation"),
      );
      examples.append(item);
    }

    if (entry.mnemonic) section("mnemonic").append(node("p", entry.mnemonic));
    const forms = section("forms");
    if (entry.forms?.length)
      for (const form of entry.forms) forms.append(node("p", form));
    else forms.append(node("p", t("noForms"), "vocabulary-muted"));
  }
  function render() {
    if (miniMode) {
      renderMini();
      return;
    }
    if (disposed || !panel || !visible() || !data) return;
    if (view === "home" && session === null && !busy && !failed) {
      start();
      return;
    }
    settingsController?.abort();
    settingsController = null;
    renderCount++;
    studyActions = null;
    const scroll = (panel.querySelector(".vocabulary-list") || panel).scrollTop;
    const existingNav = drawerBody.querySelector(".vocabulary-navigation");

    for (const child of [...drawerBody.children]) {
      if (child !== existingNav) child.remove();
    }
    content.dataset.page = view;
    const activePage = ["home", "study"].includes(view)
      ? "learning"
      : ["books", "book", "word"].includes(view)
        ? "books"
        : view;
    const title = t(
      activePage === "learning" ? "title" : pageLabels[activePage],
    );
    if (headerTitle.textContent !== title) {
      const replacing = !!headerTitle.textContent;
      headerTitle.textContent = title;
      if (replacing) WorkTimeApp.ui.motion.play(headerTitle, "motion-title");
    }
    panel = node("div", undefined, "vocabulary-page");
    panel.id = "vocabularyPage";
    drawerBody.insertBefore(panel, existingNav);
    if (view === "study") study();
    else if (view === "books") books();
    else if (view === "book") bookDetail();
    else if (view === "word") wordDetail();
    else if (view === "analysis") analysis();
    else if (view === "preferences") preferences();
    else home();
    const status = node("p", t(speechStatus), "vocabulary-speech-status");
    status.setAttribute("role", "status");
    status.hidden =
      view === "preferences" ||
      ["idle", "ready", "loading", "generating"].includes(speechStatus);
    panel.append(status);
    const saved = node("p", t(notice), "vocabulary-save-status");
    saved.setAttribute("role", "status");
    saved.hidden = !failed;
    panel.append(saved);
    if (failed) {
      const retry = button(t("retry"), () => {
        const job = failed;
        failed = null;
        void persist(job.candidate, job.after);
      });
      retry.disabled = busy;
      panel.append(retry);
    }
    const nav = node("nav", undefined, "vocabulary-navigation");
    nav.setAttribute("aria-label", t("title"));
    const icons = {
      learning: "ms-menu-book",
      books: "ms-book-5",
      analysis: "ms-insert-chart",
      preferences: "ms-settings",
    };
    for (const id of ["learning", "books", "analysis", "preferences"]) {
      const tab = button(
        "",
        () => {
          if (!busy && !failed)
            id === "learning" ? enterReview() : changePage(id);
        },
        "vocabulary-nav-item",
      );
      tab.disabled = false;
      tab.dataset.page = id;
      tab.setAttribute("aria-current", activePage === id ? "page" : "false");
      tab.innerHTML =
        '<svg fill="currentColor" aria-hidden="true"><use href="#' +
        icons[id] +
        '"/></svg>';
      tab.append(node("span", t(pageLabels[id])));
      if (id === "learning") {
        const planned = new Set(
          E.queue(data, entries).items.map((entry) => entry.id),
        );
        if (
          data.draft &&
          data.draft.mode === data.settings.mode &&
          lookup.has(data.draft.id)
        )
          planned.add(data.draft.id);
        const remaining = session === null ? planned.size : session.length;
        const badge = node(
          "span",
          String(remaining),
          "vocabulary-review-badge",
        );
        badge.setAttribute("aria-label", t("remaining") + ": " + remaining);
        tab.append(badge);
      }
      nav.append(tab);
    }
    if (studyActions) drawerBody.insertBefore(studyActions, existingNav);
    if (existingNav) {
      for (const tab of nav.children) {
        const previous = existingNav.querySelector(
          `[data-page="${tab.dataset.page}"]`,
        );
        previous.setAttribute("aria-current", tab.getAttribute("aria-current"));
        previous.disabled = false;
        const label = previous.querySelector("span");
        if (label.textContent !== tab.querySelector("span").textContent)
          label.textContent = tab.querySelector("span").textContent;
        const badge = previous.querySelector(".vocabulary-review-badge"),
          nextBadge = tab.querySelector(".vocabulary-review-badge");
        if (badge && nextBadge) {
          if (badge.textContent !== nextBadge.textContent)
            badge.textContent = nextBadge.textContent;
          badge.setAttribute(
            "aria-label",
            nextBadge.getAttribute("aria-label"),
          );
        }
      }
    } else drawerBody.append(nav);
    (panel.querySelector(".vocabulary-list") || panel).scrollTop = scroll;
  }
  function flushInput() {
    clearTimeout(draftTimer);
    if (!inputDraft || disposed || failed) return;
    if (busy) {
      draftTimer = setTimeout(flushInput, 50);
      return;
    }
    const pending = inputDraft;
    inputDraft = null;
    if (
      !data.draft ||
      data.draft.id !== pending.id ||
      data.draft.revealed ||
      data.draft.answer === pending.answer
    )
      return;
    const next = structuredClone(data);
    next.draft.answer = pending.answer;
    void persist(next, null, false);
  }
  function synchronizeVisibility() {
    if (
      host.hidden ||
      (!miniMode &&
        (editor.classList.contains("is-settings-open") ||
          editor.classList.contains("is-page-settings-open")))
    )
      stopModeAnimation();
    const next = !visible();
    if (next && !suspended) {
      speech.stop();
      flushInput();
    }
    if (!next && suspended) render();
    suspended = next;
  }
  const observer = new MutationObserver(synchronizeVisibility);
  observer.observe(host, { attributes: true, attributeFilter: ["hidden"] });
  observer.observe(editor, { attributes: true, attributeFilter: ["class"] });
  function renderMini() {
    const entry = current || lookup.get(data.draft?.id);
    miniBack.setAttribute("aria-label", WorkTimeApp.i18n.t("tools.back"));
    miniBack.title = WorkTimeApp.i18n.t("tools.back");
    miniExpand.setAttribute("aria-label", t("expand"));
    miniHeader.replaceChildren();
    const card = node("section", undefined, "vocabulary-card");
    if (entry) {
      const wordHeader = createWordHeader(entry, true);
      wordHeader.querySelector("h3")?.classList.add("vocabulary-mini-word");
      wordHeader
        .querySelector(".vocabulary-phonetic")
        ?.classList.add("vocabulary-mini-phonetic");
      card.append(wordHeader);
    } else {
      const wordHeader = node("div", undefined, "vocabulary-word-header");
      wordHeader.append(node("h3", t("miniEmpty"), "vocabulary-mini-word"));
      card.append(wordHeader);
    }
    miniHeader.append(card);
  }
  function setMini(value) {
    if (disposed) return;
    const changed = miniMode !== value;
    const animate =
      changed && !host.hidden && !document.hidden && !motionPreference.matches;
    let progress = miniMode ? 1 : 0;
    let titleOpacity = miniMode ? 0 : 1;
    if (movingSurface) {
      const transform = getComputedStyle(movingSurface).transform;
      const height = movingDistance;
      if (height && transform !== "none")
        progress = Math.max(
          0,
          Math.min(1, new DOMMatrixReadOnly(transform).m42 / height),
        );
      if (movingTitle)
        titleOpacity = Number(getComputedStyle(movingTitle).opacity);
    }
    const beforeBody = drawerViewport.getBoundingClientRect();
    const sourceAnchor = (miniMode ? mini : drawerBody).querySelector(
      ".vocabulary-word-header",
    );
    let sourceTop = sourceAnchor?.getBoundingClientRect().top;
    if (sourceTop !== undefined && !miniMode && movingSurface === drawerBody) {
      const transform = getComputedStyle(drawerBody).transform;
      if (transform !== "none")
        sourceTop -= new DOMMatrixReadOnly(transform).m42;
    }
    if (changed) stopModeAnimation();
    const outgoingBody =
      animate && value
        ? drawerSnapshot(drawerBody, drawerViewport.getBoundingClientRect())
        : null;
    const editorHeader = () =>
      [
        ...editor.querySelectorAll(
          ".editor-content .editor-mode-header, .editor-content .year-analysis-header",
        ),
      ].find((element) => element.getBoundingClientRect().height > 0);
    const outgoingHeader = animate
      ? drawerSnapshot(
          value ? content.querySelector(".vocabulary-header") : editorHeader(),
        )
      : null;
    if (value && changed) savedScroll = panel.scrollTop;
    if (!value && changed) {
      if (view !== "study") savedScroll = 0;
      view = current ? "study" : "home";
    }
    miniMode = value;
    content.hidden = value;
    content.inert = value;
    mini.hidden = !value;
    if (!value) miniHeader.replaceChildren();
    host.classList.toggle("is-mini", value);
    (value ? editor.querySelector(".date-info-area") : fullHost).append(host);
    if (value) renderMini();
    WorkTimeApp.ui.dateInfo.showVocabularyPanel();
    synchronizeVisibility();
    if (!value && advancePending) nextCard();
    if (!value && changed) {
      panel.scrollTop = savedScroll;
      if (!panel.hasAttribute("tabindex")) panel.tabIndex = -1;
      panel.focus({ preventScroll: true });
    }
    if (animate) {
      editor.classList.add("is-vocabulary-drawer-moving");
      const surface = outgoingBody || drawerBody;
      const title = (
        value ? outgoingHeader : content.querySelector(".vocabulary-header")
      )?.querySelector("h2");
      const otherTitle = (
        value ? editorHeader() : outgoingHeader
      )?.querySelector(".editor-date, h2");
      movingSurface = surface;
      movingTitle = title;
      const targetAnchor = (value ? mini : drawerBody).querySelector(
        ".vocabulary-word-header",
      );
      const targetTop = targetAnchor?.getBoundingClientRect().top;
      const distance = Math.max(
        0,
        value
          ? (targetTop ?? beforeBody.bottom) - (sourceTop ?? beforeBody.top)
          : (sourceTop ?? beforeBody.bottom) - (targetTop ?? beforeBody.top),
      );
      movingDistance = distance;
      if (outgoingBody && targetAnchor) {
        // Keep the clipping frame large enough for the destination on narrow
        // layouts, without stretching the captured drawer's contents.
        const frame = outgoingBody.parentElement;
        const bounds = frame.getBoundingClientRect();
        outgoingBody.style.height = outgoingBody.offsetHeight + "px";
        frame.style.height =
          Math.max(
            bounds.height,
            targetAnchor.getBoundingClientRect().bottom - bounds.top,
          ) + "px";
      }
      const duration = Math.max(
        100,
        (value ? 280 : 340) * Math.abs((value ? 1 : 0) - progress),
      );
      modeStyle(surface, "transform", `translateY(${value ? distance : 0}px)`);
      const tracks = [
        animationCompat.animate(
          surface,
          [
            { transform: `translateY(${progress * distance}px)` },
            { transform: `translateY(${value ? distance : 0}px)` },
          ],
          { duration, easing: "cubic-bezier(.22,.8,.25,1)" },
        ),
      ];
      const titleMotion = WorkTimeApp.ui.motion.title;
      for (const [element, entering] of [
        [title, !value],
        [otherTitle, value],
      ]) {
        if (!element) continue;
        WorkTimeApp.ui.motion.stop(element);
        const end = entering ? titleMotion.enterTo : titleMotion.leaveTo;
        modeStyle(element, "opacity", String(end.opacity));
        modeStyle(element, "translate", end.translate);
        const initialOpacity =
          element === title ? titleOpacity : 1 - titleOpacity;
        const start = entering
          ? {
              ...titleMotion.enterFrom,
              opacity: Math.max(titleMotion.enterFrom.opacity, initialOpacity),
            }
          : {
              opacity: initialOpacity,
              translate: titleMotion.enterTo.translate,
            };
        tracks.push(
          animationCompat.animate(element, [start, end], {
            duration: titleMotion.duration,
            easing: titleMotion.easing,
            fill: "backwards",
          }),
        );
      }
      if (value) {
        for (const meaning of surface.querySelectorAll(".vocabulary-meaning")) {
          const opacity = getComputedStyle(meaning).opacity;
          modeStyle(meaning, "opacity", "0");
          tracks.push(
            animationCompat.animate(meaning, [{ opacity }, { opacity: 0 }], {
              duration: Math.min(duration, 180),
              easing: "ease-out",
            }),
          );
        }
      }
      const wordHeader = surface.querySelector(".vocabulary-word-header");
      if (wordHeader) {
        const border = getComputedStyle(wordHeader).borderBottomColor;
        modeStyle(
          wordHeader,
          "borderBottomColor",
          value ? "transparent" : border,
        );
        tracks.push(
          animationCompat.animate(
            wordHeader,
            [
              { borderBottomColor: value ? border : "transparent" },
              { borderBottomColor: value ? "transparent" : border },
            ],
            { duration, easing: "ease-out" },
          ),
        );
      }
      if (value) {
        if (!sourceAnchor) {
          modeStyle(surface, "opacity", "0");
          tracks.push(
            animationCompat.animate(surface, [{ opacity: 1 }, { opacity: 0 }], {
              duration,
              easing: "ease-out",
            }),
          );
        }
        for (const background of editor.querySelectorAll(
          ":scope > .editor-content, :scope > #agendaEditor",
        )) {
          if (getComputedStyle(background).display === "none") continue;
          modeStyle(background, "opacity", "1");
          tracks.push(
            animationCompat.animate(
              background,
              [{ opacity: 0 }, { opacity: 1 }],
              { duration, easing: "ease-out" },
            ),
          );
        }
      }
      modeAnimations = tracks;
      void Promise.all(tracks.map((track) => track.finished)).then(() => {
        if (modeAnimations === tracks) stopModeAnimation();
      });
    }
  }
  function collapseOnClick(event) {
    if (
      !miniMode &&
      visible() &&
      event.target instanceof Element &&
      event.target.closest("#pageSettingsOpen")
    ) {
      setMini(true);
      return;
    }
    if (
      miniMode ||
      !visible() ||
      !(event.target instanceof Element) ||
      !event.target.closest(
        ".workspace > .summary-sidebar, .workspace > section.panel",
      )
    )
      return;
    setMini(true);
  }
  document.addEventListener("click", collapseOnClick, true);
  return {
    get isMini() {
      return miniMode;
    },
    open() {
      if (disposed) return;
      void models.prepare().catch(() => {});
      setMini(false);
    },
    refresh() {
      synchronizeVisibility();
      render();
    },
    hasDraft() {
      return !!data?.draft;
    },
    dispose() {
      disposed = true;
      stopModeAnimation();
      unlistenMotion();
      document.removeEventListener("visibilitychange", stopHiddenAnimation);
      window.removeEventListener("resize", stopModeAnimation);
      clearTimeout(draftTimer);
      clearTimeout(advanceTimer);
      document.removeEventListener("keydown", keyboard);
      document.removeEventListener("click", collapseOnClick, true);
      observer.disconnect();
      settingsController?.abort();
      unsubscribe();
      unsubscribeStorage();
      unsubscribeCache();
      unsubscribeModels();
      speech.dispose();
      content.remove();
      mini.remove();
    },
  };
})();

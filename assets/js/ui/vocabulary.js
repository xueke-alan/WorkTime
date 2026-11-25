"use strict";
WorkTimeApp.ui.vocabulary = (() => {
  const S = WorkTimeApp.services.vocabularyStorage;
  const E = WorkTimeApp.services.vocabularyEngine;
  const speech = WorkTimeApp.services.vocabularySpeech;
  const speakerIcon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/></svg>';
  const synthesisIcon =
    '<svg class="site-audio-spinner" fill="currentColor" aria-hidden="true"><use href="#ms-progress-activity"/></svg>';
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
    booksQuery = "",
    booksShown = 40,
    wordReturn = "book",
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
  let closeCacheConfirmation = () => {};
  let modelImportStatus = "";
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
    movingStreak = null,
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
    movingSurface = null;
    movingStreak = null;
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
    if (key === "accent" && inputDraft && inputDraft.id === next.draft?.id)
      next.draft.answer = inputDraft.answer;
    inputDraft = null;
    next.settings[key] = value;
    if (key === "wordOrder" && value === "random")
      next.settings.orderSeed = crypto.getRandomValues(new Uint32Array(1))[0];
    if (!["accent", "autoRead"].includes(key)) next.draft = null;
    const settingsPanel =
      view === "preferences" ||
      (["wordOrder", "mode"].includes(key) && view === "books")
        ? panel
        : null;
    if (settingsPanel) settingsPanel.inert = true;
    return persist(
      next,
      () => {
        if (!["accent", "autoRead"].includes(key)) {
          session = null;
          current = null;
          previousReview = correction = null;
        }
        audioReady = false;
        if (key === "mode" && view === "books") refreshBookSelection();
        after?.();
      },
      !settingsPanel,
    ).finally(() => {
      if (settingsPanel) settingsPanel.inert = false;
      if (
        key === "mode" &&
        settingsPanel?.isConnected &&
        !failed &&
        document.activeElement === document.body
      )
        settingsPanel
          .querySelector('[data-setting-field="mode"] .shared-select-trigger')
          ?.focus({ preventScroll: true });
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
  }
  const unsubscribeCache = idle.subscribe(refreshCache);
  function refreshModels() {
    const status = content.querySelector(".vocabulary-model-status");
    const state = models.state;
    if (status)
      status.textContent = modelImportStatus ? t(modelImportStatus) : "";
    for (const control of content.querySelectorAll(
      '[data-model-action="import"]',
    ))
      control.disabled =
        modelImportStatus === "models_importing" ||
        ["downloading", "importing"].includes(state.phase);
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
  function playbackButton(entry, className, label, miniPlayback = false) {
    const control = button(
      "",
      () =>
        play(entry, miniPlayback, (synthesizing) => {
          control.firstElementChild.outerHTML = synthesizing
            ? synthesisIcon
            : speakerIcon;
          if (synthesizing) control.setAttribute("aria-busy", "true");
          else control.removeAttribute("aria-busy");
        }),
      className,
    );
    control.setAttribute("aria-label", label);
    control.innerHTML = speakerIcon;
    return control;
  }
  async function play(entry = current, miniPlayback = false, onSynthesis) {
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
      const played = await speech.play(
        entry,
        data.settings.accent,
        onSynthesis,
      );
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
    const row = node("div", undefined, "vocabulary-controls is-compact");
    const label = node(
        "label",
        undefined,
        "vocabulary-field vocabulary-plan-control",
      ),
      count = node("input");
    label.append(node("span", t("dailyTotal")));
    label.dataset.settingField = "dailyTotal";
    count.setAttribute("aria-label", t("dailyTotal"));
    count.type = "number";
    count.min = "1";
    count.value = data.settings.dailyTotal;
    count.disabled = busy || !!failed;
    count.onchange = () => {
      const n = Number(count.value);
      if (Number.isSafeInteger(n) && n >= 1) updateSettings("dailyTotal", n);
      else count.value = data.settings.dailyTotal;
    };
    label.append(count);
    row.append(label, select("mode", ["recall", "spelling", "dictation"]));
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
      items.some((entry) => entry.id === data.draft.id)
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
    if (session && !correction) {
      session = E.queue(data, entries).items;
      if (data.draft?.mode === data.settings.mode) {
        const index = session.findIndex((entry) => entry.id === data.draft.id);
        if (index > 0) session.unshift(...session.splice(index, 1));
      }
    }
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
        reinforcement: structuredClone(data.reinforcement),
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
        previousReview = before;
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
    if (previous.reinforcement === undefined) delete next.reinforcement;
    else next.reinforcement = structuredClone(previous.reinforcement);
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
      (event.key === " " &&
        target instanceof Element &&
        target.closest(".vocabulary-word-copy")) ||
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
    const globalSearch = book === null;
    let searchQuery = globalSearch ? booksQuery : query;
    let displayLimit = globalSearch ? booksShown : shown;
    const box = node("section", undefined, "vocabulary-library");
    const search = node("input");
    search.type = "search";
    search.placeholder = t("search");
    search.setAttribute("aria-label", t("search"));
    search.value = searchQuery;
    if (globalSearch) box.classList.add("vocabulary-global-search");
    const searchField = node("div", undefined, "vocabulary-search-field");
    searchField.innerHTML =
      '<svg class="ui-icon" aria-hidden="true"><use href="#ms-search"/></svg>';
    searchField.append(search);
    const results = node("div", undefined, "vocabulary-list");
    function fill() {
      results.replaceChildren();
      results.hidden = globalSearch && !searchQuery.trim();
      if (results.hidden) return;
      const matching = entries.filter(
        (e) =>
          (globalSearch || e.books.includes(book)) &&
          (!searchQuery.trim() ||
            (e.word + " " + e.zh)
              .toLowerCase()
              .includes(searchQuery.trim().toLowerCase())),
      );
      for (const entry of matching.slice(0, displayLimit)) {
        const row = node("div", undefined, "vocabulary-row"),
          text = node("div");
        const open = () => {
          if (busy || failed) return;
          bookScroll = globalSearch ? panel.scrollTop : results.scrollTop;
          wordReturn = globalSearch ? "books" : "book";
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
        const playButton = playbackButton(
          entry,
          "vocabulary-list-play",
          t("play") + ": " + entry.word,
        );
        pronunciation.append(
          node("small", phoneticText(entry), "vocabulary-phonetic"),
          playButton,
        );
        const heading = node("div", undefined, "vocabulary-list-heading");
        heading.append(word, pronunciation);
        text.append(heading);
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
      if (matching.length > displayLimit)
        results.append(
          button(t("more"), () => {
            displayLimit += 40;
            if (globalSearch) booksShown = displayLimit;
            else shown = displayLimit;
            fill();
          }),
        );
    }
    search.oninput = () => {
      searchQuery = search.value;
      if (globalSearch) booksQuery = searchQuery;
      else query = searchQuery;
      displayLimit = 40;
      if (globalSearch) booksShown = 40;
      else shown = 40;
      fill();
      results.scrollTop = 0;
      if (globalSearch)
        panel.querySelector(".vocabulary-books-overview").hidden =
          !!searchQuery.trim();
    };
    box.append(searchField, results);
    fill();
    return box;
  }
  function streakHero(streak) {
    const hero = node("section", undefined, "vocabulary-hero");
    hero.append(
      node("span", t("streak"), "vocabulary-eyebrow"),
      node("strong", String(streak).padStart(2, "0"), "vocabulary-streak"),
    );
    return hero;
  }
  function home() {
    const stats = E.statistics(data);
    const summary = node("div", undefined, "vocabulary-summary");
    summary.append(
      streakHero(stats.streak),
      metrics({
        newLearned: stats.newLearned,
        reviewCount: stats.reviewCount,
        today: stats.today,
        pendingPractice: E.queue(data, entries).practice.length,
      }),
    );
    panel.append(summary);
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
  function bookCover(id) {
    const index = ["daily", "cet6", "kaoyan", "toefl", "ielts"].indexOf(id);
    const cover = node("span", undefined, "vocabulary-book-cover");
    cover.dataset.color = String(index);
    cover.setAttribute("aria-hidden", "true");
    cover.append(
      node("small", "ENGLISH"),
      node("strong", id === "daily" ? "Aa" : id.toUpperCase()),
      node("span", String(index + 1).padStart(2, "0")),
    );
    return cover;
  }
  function refreshBookSelection() {
    const queue = E.queue(data, entries);
    const values = [
      queue.due.length + " / " + queue.allDue,
      String(queue.fresh.length),
      String(queue.practice.length),
    ];
    panel
      .querySelectorAll(".vocabulary-plan-counts strong")
      .forEach((element, index) => {
        element.textContent = values[index];
      });
    const distribution = E.bookDistribution(data, entries);
    const total = Object.values(distribution).reduce(
      (sum, count) => sum + count,
      0,
    );
    for (const [state, count] of Object.entries(distribution)) {
      panel.querySelector(
        `.vocabulary-distribution-bar [data-state="${state}"]`,
      ).style.width = (total ? (count / total) * 100 : 0) + "%";
      panel.querySelector(
        `.vocabulary-distribution-legend [data-state="${state}"]`,
      ).textContent = t(state) + " " + count;
    }
    panel.querySelector(".vocabulary-book-progress-line > span").textContent =
      total - distribution.unlearned + "/" + total;
    const days = E.estimateLearningDays(data, entries);
    panel.querySelector(".vocabulary-learning-estimate").textContent = days
      ? t("estimatedDays", { days })
      : t("estimateComplete");
    const badge = drawerBody.querySelector(".vocabulary-review-badge");
    if (badge) {
      badge.textContent = String(queue.items.length);
      badge.setAttribute(
        "aria-label",
        t("remaining") + ": " + queue.items.length,
      );
    }
  }
  function books() {
    panel.classList.add("vocabulary-book-selection");
    const search = library(null);
    const overview = node("div", undefined, "vocabulary-books-overview");
    overview.hidden = !!booksQuery.trim();
    const settings = controls();
    const queue = E.queue(data, entries);
    const counts = node("div", undefined, "vocabulary-plan-counts");
    for (const [name, value] of [
      ["pendingReviewShort", queue.due.length + " / " + queue.allDue],
      ["pendingNew", String(queue.fresh.length)],
      ["pendingPractice", String(queue.practice.length)],
    ]) {
      const item = node("div");
      item.append(node("span", t(name)), node("strong", value));
      counts.append(item);
    }
    counts.firstChild.title = t("pendingReview");
    const openCurrent = () => {
      if (busy || failed) return;
      viewedBook = data.settings.book;
      query = "";
      shown = 40;
      changePage("book");
    };
    const current = node("section", undefined, "vocabulary-current-book");
    current.onclick = (event) => {
      if (!event.target.closest("button")) openCurrent();
    };
    const distribution = E.bookDistribution(data, entries);
    const total = Object.values(distribution).reduce(
      (sum, count) => sum + count,
      0,
    );
    const bar = node("span", undefined, "vocabulary-distribution-bar");
    bar.setAttribute("aria-hidden", "true");
    const legend = node("span", undefined, "vocabulary-distribution-legend");
    for (const [state, count] of Object.entries(distribution)) {
      const segment = node("span");
      segment.dataset.state = state;
      segment.style.width = (total ? (count / total) * 100 : 0) + "%";
      bar.append(segment);
      const label = node("span", t(state) + " " + count);
      label.dataset.state = state;
      legend.append(label);
    }
    const currentInfo = node("span", undefined, "vocabulary-current-book-info");
    const currentTitle = node("strong");
    currentTitle.append(
      button(
        t(data.settings.book),
        openCurrent,
        "vocabulary-current-book-open",
      ),
    );
    currentInfo.append(
      node("small", t("currentBook")),
      currentTitle,
      bar,
      legend,
    );
    const days = E.estimateLearningDays(data, entries);
    const estimate = node(
      "small",
      days ? t("estimatedDays", { days }) : t("estimateComplete"),
      "vocabulary-learning-estimate",
    );
    estimate.title = t("estimateHint");
    const progress = node("small", undefined, "vocabulary-book-progress-line");
    progress.append(
      node("span", total - distribution.unlearned + "/" + total),
      estimate,
    );
    currentInfo.append(progress);
    const tools = node("span", undefined, "vocabulary-book-tools");
    const order = button(
      "",
      () => {
        if (busy || failed) return;
        void updateSettings(
          "wordOrder",
          data.settings.wordOrder === "random" ? "ordered" : "random",
          () => {
            order.setAttribute(
              "aria-checked",
              String(data.settings.wordOrder === "random"),
            );
            const remaining = E.queue(data, entries).items.length;
            const badge = drawerBody.querySelector(".vocabulary-review-badge");
            if (badge) {
              badge.textContent = String(remaining);
              badge.setAttribute(
                "aria-label",
                t("remaining") + ": " + remaining,
              );
            }
          },
        ).then(() => {
          if (
            order.isConnected &&
            view === "books" &&
            (document.activeElement === document.body ||
              document.activeElement === order)
          )
            order.focus({ preventScroll: true });
        });
      },
      "vocabulary-order-switch",
    );
    order.setAttribute("role", "switch");
    order.setAttribute("aria-label", t("wordOrder"));
    order.setAttribute(
      "aria-checked",
      String(data.settings.wordOrder === "random"),
    );
    order.title = t("wordOrderHint");
    order.disabled = busy || !!failed;
    order.append(node("span", t("ordered")), node("span", t("randomOrder")));
    tools.append(order, bookCover(data.settings.book));
    current.append(tools, currentInfo);
    current.title = t("familiarityHint");
    const list = node("div", undefined, "vocabulary-books");
    for (const id of ["daily", "cet6", "kaoyan", "toefl", "ielts"]) {
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
      const info = node("span", undefined, "vocabulary-book-info");
      info.append(node("strong", t(id)), node("small", bookSummary(id)));
      if (id === data.settings.book)
        info.append(node("span", t("currentBook")));
      book.append(bookCover(id), info);
      list.append(book);
    }
    overview.append(settings, counts, current, node("h3", t("allBooks")), list);
    panel.append(search, overview);
    settingsController = new AbortController();
    enhanceSettingsSelects();
    settings
      .querySelector(".shared-select-trigger")
      .classList.add("vocabulary-plan-control");
  }
  function bookDetail() {
    const id = viewedBook || data.settings.book;
    const heading = node("div", undefined, "vocabulary-book-heading");
    const back = button("", () => changePage("books"), "vocabulary-book-back");
    back.setAttribute("aria-label", t("backToSelection"));
    back.innerHTML =
      '<svg class="ui-icon" aria-hidden="true"><use href="#ms-arrow-back"/></svg>';
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
      "ui-button vocabulary-use-book",
    );
    use.dataset.action = "use-book";
    heading.append(back, title, use);
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
    const confirmation = node(
      "div",
      undefined,
      "vocabulary-cache-confirmation",
    );
    confirmation.id = "vocabularyCacheConfirmation";
    confirmation.setAttribute("popover", "auto");
    confirmation.setAttribute("role", "dialog");
    confirmation.setAttribute(
      "aria-describedby",
      "vocabularyCacheConfirmationText",
    );
    confirmation.setAttribute("aria-label", t("clear"));
    const prompt = node(
      "p",
      t("clearCacheConfirm").replace(/([?？])\s*/, "$1\n"),
    );
    prompt.id = "vocabularyCacheConfirmationText";
    const actions = node("div", undefined, "vocabulary-confirm-actions");
    const cancel = button(t("cancel"), () => closeCacheConfirmation());
    const accept = button(
      t("confirm"),
      async () => {
        closeCacheConfirmation();
        clear.disabled = true;
        try {
          await speech.clear();
        } catch {
          speechStatus = "cacheWarning";
        } finally {
          clear.disabled = busy || !!failed;
          refreshCache();
        }
      },
      "ui-button vocabulary-primary",
    );
    actions.append(cancel, accept);
    confirmation.append(prompt, actions);
    panel.append(confirmation);
    const clear = button(t("clear"), () => {
      if (popover.isOpen()) return closeCacheConfirmation();
      popover.show();
      positionConfirmation();
      cancel.focus({ preventScroll: true });
    });
    clear.setAttribute("aria-controls", confirmation.id);
    clear.setAttribute("aria-haspopup", "dialog");
    clear.setAttribute("aria-expanded", "false");
    const popover = WorkTimeApp.ui.popover.create(confirmation, {
      trigger: () => clear,
    });
    closeCacheConfirmation = () => popover.hide({ restoreFocus: true });
    function positionConfirmation() {
      if (!popover.isOpen()) return;
      if (!visible() || !clear.isConnected) return closeCacheConfirmation();
      const anchor = clear.getBoundingClientRect();
      const box = confirmation.getBoundingClientRect();
      const gap = 10;
      const left = Math.max(
        gap,
        Math.min(anchor.right - box.width, innerWidth - box.width - gap),
      );
      const below = anchor.bottom + gap;
      const top =
        below + box.height <= innerHeight - gap
          ? below
          : Math.max(gap, anchor.top - box.height - gap);
      confirmation.style.left = left + "px";
      confirmation.style.top = top + "px";
      WorkTimeApp.ui.popover.point(confirmation, clear);
    }
    confirmation.addEventListener("toggle", () => {
      clear.setAttribute("aria-expanded", String(popover.isOpen()));
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
    const resources = node("div", undefined, "vocabulary-resource-settings");
    resources.append(pool, capacity);
    panel.append(resources);
    const modelSection = node(
      "section",
      undefined,
      "vocabulary-model-settings",
    );
    const modelStatus = node("p", "", "vocabulary-model-status");
    modelStatus.setAttribute("role", "status");
    const modelActions = node("div", undefined, "vocabulary-cache-actions");
    async function importModels(file) {
      if (modelImportStatus === "models_importing") return;
      modelImportStatus = "models_importing";
      refreshModels();
      try {
        await models.install(file);
        modelImportStatus = "models_installed";
      } catch {
        modelImportStatus = "models_failed";
      } finally {
        refreshModels();
      }
    }
    const download = button(t("modelDownload"), () => {
      window.open(
        "https://github.com/xueke-alan/WorkTime/releases",
        "_blank",
        "noopener,noreferrer",
      );
    });
    download.dataset.modelAction = "download";
    const upload = node("input");
    upload.type = "file";
    upload.accept = ".wtmodels";
    upload.hidden = true;
    upload.onchange = () => {
      const file = upload.files[0];
      upload.value = "";
      if (file) void importModels(file);
    };
    const importModel = button(t("modelImport"), () => upload.click());
    importModel.dataset.modelAction = "import";
    download.textContent = t("modelDownloadShort");
    importModel.textContent = t("modelImportShort");
    clear.textContent = t("cacheClearShort");
    modelActions.append(download, importModel, clear);
    modelSection.append(node("h4", t("modelGroup")), modelActions);
    const groups = node("div", undefined, "vocabulary-management-groups");
    groups.append(modelSection);
    panel.append(groups, upload, modelStatus);
    refreshModels();
    settingsController = new AbortController();
    settingsController.signal.addEventListener(
      "abort",
      () => {
        popover.destroy();
        confirmation.remove();
        closeCacheConfirmation = () => {};
      },
      { once: true },
    );
    window.addEventListener("resize", positionConfirmation, {
      signal: settingsController.signal,
    });
    document.addEventListener("scroll", positionConfirmation, {
      capture: true,
      passive: true,
      signal: settingsController.signal,
    });
    enhanceSettingsSelects();
  }
  function enhanceSettingsSelects() {
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
    if (session && !correction) {
      session = E.queue(data, entries).items;
    }
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
    if (mode === "recall" || draft.revealed) {
      const heading = node("h3");
      const status = node("span", undefined, "vocabulary-word-copy-status");
      status.setAttribute("role", "status");
      let feedbackTimer;
      let copyAttempt = 0;
      const copy = button(
        entry.word,
        async () => {
          const attempt = ++copyAttempt;
          clearTimeout(feedbackTimer);
          status.textContent = "";
          status.classList.remove("is-error");
          let result = "wordCopied";
          try {
            await navigator.clipboard.writeText(entry.word);
          } catch {
            result = "wordCopyFailed";
          }
          if (attempt !== copyAttempt || !status.isConnected) return;
          status.classList.toggle("is-error", result === "wordCopyFailed");
          status.textContent = t(result);
          feedbackTimer = setTimeout(() => {
            status.textContent = "";
            status.classList.remove("is-error");
          }, 1800);
        },
        "vocabulary-word-copy",
      );
      copy.title = t("copyWord", { word: entry.word });
      copy.setAttribute("aria-label", copy.title);
      heading.append(copy);
      wordHeader.append(heading, status);
    }
    const voiceLabel = t(data.settings.accent === "uk" ? "shortUK" : "shortUS");
    const phonetic = phoneticText(entry);
    if (mode !== "spelling" || draft.revealed) {
      const pronunciation = node("div", undefined, "vocabulary-pronunciation");
      if ((draft.revealed || mode === "recall") && phonetic)
        pronunciation.append(node("span", phonetic, "vocabulary-phonetic"));
      const playButton = playbackButton(
        entry,
        "vocabulary-pronunciation-play",
        t("play") + " · " + voiceLabel,
        miniPlayback,
      );
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
      const today = Date.parse(E.day(now));
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
        const result = E.preview(data, current, mode, rating, now);
        const delay = result.gap
          ? t("reviewToday")
          : t("reviewDays", {
              n: Math.max(
                1,
                (Date.parse(E.day(result.card.due)) - today) / 86400000,
              ),
            });
        b.append(node("strong", t(key)), node("small", delay));
        if (draft.correct === false && rating !== 1) b.disabled = true;
        ratings.append(b);
      });
      studyActions.append(ratings);
    }
    if (
      data.reinforcement?.[E.key(current.id, mode)] &&
      E.queue(data, entries).early
    ) {
      card.append(node("p", t("practiceEarly"), "vocabulary-muted"));
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
        changePage(wordReturn);
        (wordReturn === "books"
          ? panel
          : panel.querySelector(".vocabulary-list")
        ).scrollTop = bookScroll;
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
    memoryHistory(viewedEntry);
  }
  function memoryHistory(entry) {
    const section = node("section", undefined, "vocabulary-detail-section");
    const results = node("div", undefined, "vocabulary-memory-history");
    const logs = data.logs
      .filter((log) => log.id === entry.id)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const date = new Intl.DateTimeFormat(WorkTimeApp.i18n.language, {
      dateStyle: "medium",
    });
    const calendarDay = (at) => Date.parse(E.day(at));
    const daysBetween = (later, earlier) =>
      (calendarDay(later) - calendarDay(earlier)) / 86400000;
    const ratings = ["forgotten", "uncertain", "recognized", "easy"];
    const batchSize = 24;

    if (logs.length) {
      const first = logs[0].at;
      const last = logs.at(-1).at;
      const start = date.format(new Date(first));
      const end = date.format(new Date(last));
      const range = E.day(first) === E.day(last) ? start : `${start} → ${end}`;
      results.append(
        node("p", t("memoryHistorySummary", { range, n: logs.length })),
      );
      const showMode = new Set(logs.map((log) => log.mode)).size > 1;
      const list = node("ol", undefined, "vocabulary-memory-events");
      list.setAttribute("role", "list");
      let from = logs.length;
      const more = button(t("memoryHistoryEarlier"), () => {
        prependEvents();
        if (more.hidden) list.focus();
      });
      more.classList.add("vocabulary-memory-earlier");
      list.tabIndex = -1;
      function prependEvents() {
        const start = Math.max(0, from - batchSize);
        const items = logs.slice(start, from).map(({ at, grade, mode }) => {
          const item = node("li");
          const rating = ratings[grade - 1];
          item.dataset.rating = rating;
          const time = node("time", `D${daysBetween(at, first) + 1}`);
          time.dateTime = at;
          time.title = date.format(new Date(at));
          item.append(time, " · ", t(rating));
          if (showMode) item.append(" · ", t(mode));
          return item;
        });
        list.prepend(...items);
        from = start;
        more.hidden = from === 0;
      }
      prependEvents();
      results.append(more, list);
    } else {
      results.append(node("p", t("memoryHistoryEmpty"), "vocabulary-muted"));
    }

    const now = Date.now();
    for (const mode of ["recall", "spelling", "dictation"]) {
      const key = E.key(entry.id, mode);
      const due = data.cards[key]?.due;
      const pending = data.reinforcement?.[key];
      if (!due && !pending) continue;
      let status = t("pendingPractice");
      let overdue = false;
      if (!pending) {
        const days = daysBetween(due, now);
        overdue = days < 0;
        status = overdue
          ? t("memoryHistoryOverdue", { n: -days })
          : days === 0
            ? t("memoryHistoryDueToday")
            : t("memoryHistoryNext", { date: date.format(new Date(due)) });
      }
      const line = node(
        "p",
        `${t(mode)} · ${status}`,
        "vocabulary-muted vocabulary-memory-due",
      );
      if (overdue) line.dataset.overdue = "true";
      results.append(line);
    }
    section.append(node("h4", t("memoryHistory")), results);
    panel.append(section);
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
      const playButton = playbackButton(
        { word: example.en, kind: "example" },
        "vocabulary-example-play",
        t("play") + ": " + example.en,
      );
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
      headerTitle.textContent = title;
      WorkTimeApp.ui.motion.refreshEditorTitle();
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
        const remaining = planned.size;
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
      closeCacheConfirmation();
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
    if (!entry) {
      miniHeader.append(streakHero(E.statistics(data).streak));
      return;
    }
    const card = node("section", undefined, "vocabulary-card");
    const wordHeader = createWordHeader(entry, true);
    wordHeader.querySelector("h3")?.classList.add("vocabulary-mini-word");
    wordHeader
      .querySelector(".vocabulary-phonetic")
      ?.classList.add("vocabulary-mini-phonetic");
    card.append(wordHeader);
    miniHeader.append(card);
  }
  function setMini(value) {
    if (disposed) return;
    const changed = miniMode !== value;
    const animate =
      changed && !host.hidden && !document.hidden && !motionPreference.matches;
    let progress = miniMode ? 1 : 0;
    if (movingSurface) {
      const transform = getComputedStyle(movingSurface).transform;
      const height = movingDistance;
      if (height && transform !== "none")
        progress = Math.max(
          0,
          Math.min(1, new DOMMatrixReadOnly(transform).m42 / height),
        );
    }
    const beforeBody = drawerViewport.getBoundingClientRect();
    const source = miniMode ? mini : drawerBody;
    const sourceAnchor = source.querySelector(".vocabulary-word-header");
    const sourceStreak =
      animate && (movingStreak || source.querySelector(".vocabulary-hero"));
    const streakBounds = sourceStreak && sourceStreak.getBoundingClientRect();
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
      movingSurface = surface;
      const destination = value ? mini : drawerBody;
      const targetAnchor = destination.querySelector(".vocabulary-word-header");
      const targetStreak = destination.querySelector(".vocabulary-hero");
      const targetStreakBounds = targetStreak?.getBoundingClientRect();
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
      if (streakBounds && targetStreakBounds) {
        movingStreak = drawerSnapshot(sourceStreak, streakBounds);
        movingStreak.style.boxSizing = "border-box";
        const outgoingStreak = outgoingBody?.querySelector(".vocabulary-hero");
        if (outgoingStreak) outgoingStreak.style.opacity = "0";
        modeStyle(targetStreak, "opacity", "0");
        const x =
          targetStreakBounds.left -
          streakBounds.left +
          (targetStreakBounds.width - streakBounds.width) / 2;
        const y =
          targetStreakBounds.top -
          streakBounds.top +
          (targetStreakBounds.height - streakBounds.height) / 2;
        tracks.push(
          animationCompat.animate(
            movingStreak.parentElement,
            [
              { transform: "translate(0px, 0px)" },
              { transform: `translate(${x}px, ${y}px)` },
            ],
            { duration, easing: "cubic-bezier(.22,.8,.25,1)" },
          ),
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
        for (const background of [
          ...editor.querySelectorAll(
            ":scope > .editor-content, :scope > #agendaEditor",
          ),
        ].flatMap(WorkTimeApp.ui.motion.editorContent)) {
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
    WorkTimeApp.ui.motion.refreshEditorTitle();
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
    open(options = {}) {
      if (disposed) return;
      if (!options.fromSettings) void models.prepare().catch(() => {});
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

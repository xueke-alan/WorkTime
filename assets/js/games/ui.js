"use strict";
/** Read-only playback: adapters render transient state without touching saves. */
WorkTimeApp.games.createCompletionHistory = function ({
  root,
  host,
  before = null,
  signal,
  records,
  steps,
  kind = "completion",
  title = null,
  playbackHost = null,
  onStart,
  onFrame,
  onExit,
}) {
  const panel = document.createElement("section");
  panel.className =
    kind === "match" ? "game-match-history" : "game-completion-history";
  host.insertBefore(panel, before);
  const heading = document.createElement("h3");
  const list = document.createElement("div");
  const transport = document.createElement("div");
  transport.className = "game-replay-controls";
  panel.append(heading, list);
  (playbackHost || panel).append(transport);
  const t = (name, params) =>
    WorkTimeApp.i18n.t("games.history." + name, params);
  let record = null,
    index = 0,
    timer = null,
    playing = false,
    source = null;
  let savedInert = [];
  const buttons = {};
  const progress = document.createElement("span");
  progress.className = "game-replay-progress";
  progress.setAttribute("role", "status");
  function pause() {
    clearTimeout(timer);
    timer = null;
    playing = false;
  }
  function paint() {
    transport.hidden = !record;
    if (!record) return;
    progress.textContent = `${index} / ${record.path.length}`;
    buttons.play.textContent = t(playing ? "pause" : "play");
    buttons.previous.textContent = t("previous");
    buttons.next.textContent = t("next");
    buttons.exit.textContent = t("exit");
    buttons.previous.disabled = index === 0;
    buttons.next.disabled = index === record.path.length;
  }
  function frame() {
    onFrame(record.path.slice(0, index), index === record.path.length);
    paint();
  }
  function schedule() {
    clearTimeout(timer);
    if (!playing || !record || document.hidden || signal.aborted) return;
    timer = setTimeout(() => {
      index++;
      if (index >= record.path.length) pause();
      frame();
      schedule();
    }, 700);
  }
  function play() {
    if (!record || document.hidden || signal.aborted) return;
    if (index === record.path.length) {
      index = 0;
      frame();
    }
    playing = true;
    paint();
    schedule();
  }
  function exit(restoreFocus = true) {
    if (!record) return;
    pause();
    record = null;
    delete root.dataset.replaying;
    savedInert.forEach(([element, inert]) => {
      element.inert = inert;
    });
    savedInert = [];
    onExit();
    render();
    if (restoreFocus) source?.focus({ preventScroll: true });
  }
  for (const [name, callback] of Object.entries({
    play: () => {
      if (playing) {
        pause();
        paint();
      } else play();
    },
    previous: () => {
      pause();
      index = Math.max(0, index - 1);
      frame();
    },
    next: () => {
      pause();
      index = Math.min(record.path.length, index + 1);
      frame();
    },
    exit: () => exit(),
  })) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-button";
    button.dataset.replayAction = name;
    button.addEventListener("click", callback, { signal });
    buttons[name] = button;
    transport.append(button);
  }
  transport.prepend(progress);
  let signature = "";
  function render() {
    const values = records();
    panel.hidden = values === null;
    heading.textContent = t(kind === "match" ? "matchHeading" : "heading");
    panel.setAttribute("aria-label", heading.textContent);
    const nextSignature = JSON.stringify(values) + heading.textContent;
    if (signature !== nextSignature) {
      signature = nextSignature;
      list.replaceChildren();
      if (!values?.length)
        list.textContent = t(kind === "match" ? "matchEmpty" : "empty");
      for (const value of values || []) {
        const row = document.createElement("div");
        row.className = "game-completion-row";
        const label = document.createElement("span");
        const date = new Date(value.finishedAt);
        const dateText =
          String(date.getFullYear()).padStart(4, "0") +
          String(date.getMonth() + 1).padStart(2, "0") +
          String(date.getDate()).padStart(2, "0");
        label.textContent = title
          ? title(value, dateText)
          : t("record", {
              steps: steps(value.path),
              date: dateText,
            });
        const button = document.createElement("button");
        button.type = "button";
        button.className = "game-button";
        button.dataset.replayRecord = value.id;
        button.textContent = t("replay");
        button.setAttribute(
          "aria-label",
          t("replay") + " · " + label.textContent,
        );
        button.addEventListener(
          "click",
          () => {
            if (record) return;
            source = button;
            record = value;
            index = 0;
            root.dataset.replaying = "true";
            onStart(record);
            if (playbackHost) playbackHost.append(transport);
            let branch = playbackHost ? transport : panel;
            while (branch !== root && branch.parentElement) {
              for (const sibling of branch.parentElement.children) {
                if (sibling === branch) continue;
                savedInert.push([sibling, sibling.inert]);
                sibling.inert = true;
              }
              branch = branch.parentElement;
            }
            frame();
            buttons.play.focus({ preventScroll: true });
            play();
          },
          { signal },
        );
        row.append(label, button);
        list.append(row);
      }
    }
    list.inert = !!record;
    paint();
  }
  for (const type of ["click", "keydown", "pointerdown", "pointerup"]) {
    root.addEventListener(
      type,
      (event) => {
        if (!record) return;
        if (event.type === "keydown" && event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          exit();
          return;
        }
        if (
          !panel.contains(event.target) &&
          !transport.contains(event.target)
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true, signal },
    );
  }
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        pause();
        paint();
      }
    },
    { signal },
  );
  document.addEventListener("worktime:languagechange", render, { signal });
  signal.addEventListener(
    "abort",
    () => {
      pause();
    },
    { once: true },
  );
  return {
    render,
    get active() {
      return !!record;
    },
    pause() {
      pause();
      paint();
    },
    exit,
    dispose() {
      pause();
    },
  };
};

WorkTimeApp.games.matchRecordTitle = function (id, record, date) {
  const t = (name, params) =>
    WorkTimeApp.i18n.t("games.history." + name, params);
  const config = record.config;
  let detail, result;
  if (config.mode === "local") {
    detail = t("local");
    const side =
      id === "game-jungle"
        ? WorkTimeApp.i18n.t(
            "games.jungle." + (record.winner === 1 ? "red" : "blue"),
          )
        : t(record.winner === 1 ? "xSide" : "oSide");
    result = t("sideVictory", { side });
  } else {
    const prefix = {
      "game-xiangqi": "xiangqi.ai",
      "game-gomoku": "gomoku.ai",
      "game-jungle": "jungle.",
      "game-ultimate-ttt": "uttt.",
    }[id];
    detail = WorkTimeApp.i18n.t("games." + prefix + config.difficulty);
    const human =
      id === "game-xiangqi" ? (config.humanRed ? 1 : -1) : config.human;
    result = t(record.winner === human ? "victory" : "defeat");
  }
  return t("matchRecord", { date, detail, result });
};

// Presentation pacing is independent of search strength and motion preferences.
WorkTimeApp.games.createThinkTurn = function ({
  simple = false,
  advanced = false,
} = {}) {
  const [minimum, maximum] = simple
    ? [600, 900]
    : advanced
      ? [1000, 1600]
      : [800, 1300];
  const duration = minimum + Math.random() * (maximum - minimum);
  let started = performance.now();
  let timer = null;
  let callback = null;
  let paused = false;
  let cancelled = false;
  function schedule() {
    clearTimeout(timer);
    if (cancelled || paused || !callback) return;
    const remaining = duration - (performance.now() - started);
    if (remaining <= 0) {
      const done = callback;
      callback = null;
      cancelled = true;
      done();
    } else timer = setTimeout(schedule, remaining);
  }
  return {
    wait(done) {
      if (cancelled) return;
      callback = done;
      schedule();
    },
    pause() {
      paused = true;
      clearTimeout(timer);
    },
    resume() {
      if (!paused || cancelled) return;
      paused = false;
      started = performance.now();
      schedule();
    },
    cancel() {
      cancelled = true;
      callback = null;
      clearTimeout(timer);
    },
  };
};
WorkTimeApp.games.paintDetailNumbers = function (element, text) {
  element.replaceChildren();
  for (const part of text.split(/(\d+)/u)) {
    if (/^\d+$/u.test(part)) {
      const number = document.createElement("strong");
      number.className = "game-detail-number";
      number.textContent = part;
      element.append(number);
    } else element.append(document.createTextNode(part));
  }
};
WorkTimeApp.games.setIcon = function (element, name) {
  if (
    element.querySelector("svg > use")?.getAttribute("href") !==
    "#ms-" + name
  )
    element.replaceChildren(WorkTimeApp.games.createIcon(name));
};
WorkTimeApp.games.paintCounter = function (element, value) {
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
  const size = Math.min(1.5, 6.5 / Math.max(4, text.length)) + "rem";
  if (element.style.fontSize !== size) element.style.fontSize = size;
  if (element.title !== text) element.title = text;
};
WorkTimeApp.games.createLevelPage = function (root, id, signal) {
  function node(parent, tag, className) {
    const element = document.createElement(tag);
    element.className = className;
    parent.append(element);
    return element;
  }
  const page = node(root, "section", "game-level-page");
  page.id = id;
  const header = node(page, "header", "game-level-page-header");
  const heading = node(header, "div", "game-level-page-heading");
  const back = node(
    heading,
    "button",
    "game-button game-icon-button game-level-return",
  );
  back.type = "button";
  back.hidden = true;
  back.append(WorkTimeApp.games.createIcon("chevron-left"));
  let returnToGame = null;
  back.addEventListener(
    "click",
    () => {
      if (!signal?.aborted) returnToGame?.();
    },
    { signal },
  );
  const title = node(heading, "h3", "game-level-page-title");
  title.id = id + "-title";
  page.setAttribute("aria-labelledby", title.id);
  const body = node(page, "div", "game-level-page-body");
  const categories = node(body, "div", "game-level-categories");
  categories.setAttribute("role", "group");
  categories.setAttribute("aria-labelledby", title.id);
  const entries = node(body, "div", "game-level-entries");
  entries.id = id + "-entries";
  // Match the header to the cards, including native/overlay scrollbar widths.
  const alignHeader = new ResizeObserver(() => {
    if (!entries.getClientRects().length) return;
    const padding = parseFloat(getComputedStyle(entries).paddingInlineEnd) || 0;
    page.style.setProperty(
      "--game-level-content-end",
      entries.offsetWidth - entries.clientWidth + padding + "px",
    );
  });
  alignHeader.observe(entries);
  signal?.addEventListener("abort", () => alignHeader.disconnect(), {
    once: true,
  });
  const compat = WorkTimeApp.ui.animationCompat;
  let selectedCategory, animation;
  signal?.addEventListener("abort", () => animation?.cancel(), { once: true });
  function selectCategory(key) {
    const changed = selectedCategory !== undefined && selectedCategory !== key;
    selectedCategory = key;
    if (!changed) return;
    animation?.cancel();
    entries.scrollTop = 0;
    if (page.hidden || compat.preference().matches || document.hidden) return;
    animation = compat.animate(
      entries,
      [
        { opacity: 0, transform: "translateX(14px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
      { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }
  // Games without named chapters use ranges without changing their level IDs.
  function addRanges(grid, size = 10) {
    const cards = [...grid.children];
    const buttons = [];
    function reveal(index) {
      const range = Math.floor(index / size);
      buttons.forEach((button, i) => {
        button.setAttribute("aria-pressed", String(i === range));
      });
      cards.forEach((card, i) => {
        card.hidden = Math.floor(i / size) !== range;
      });
      selectCategory(range);
    }
    for (let start = 0; start < cards.length; start += size) {
      const button = node(categories, "button", "game-button");
      button.type = "button";
      button.textContent =
        String(start + 1).padStart(2, "0") +
        "–" +
        String(Math.min(start + size, cards.length)).padStart(2, "0");
      button.setAttribute("aria-controls", entries.id);
      button.addEventListener("click", () => reveal(start), { signal });
      buttons.push(button);
    }
    reveal(0);
    return { reveal };
  }
  return {
    page,
    header,
    body,
    categories,
    entries,
    selectCategory,
    addRanges,
    back,
    setReturn(callback) {
      returnToGame = callback;
      back.hidden = !callback;
    },
    refresh() {
      title.textContent = WorkTimeApp.i18n.t("games.levelStatus.choose");
      const label = WorkTimeApp.i18n.t("games.levelStatus.returnGame");
      back.title = label;
      back.setAttribute("aria-label", label);
    },
  };
};
WorkTimeApp.games.paintLevelCard = function (
  button,
  {
    number,
    text: displayText,
    label,
    complete,
    draft,
    locked,
    current,
    stars = 0,
  },
) {
  const status = locked
    ? "locked"
    : complete || stars
      ? "complete"
      : draft
        ? "draft"
        : "available";
  const badgeState =
    stars && !locked
      ? "stars"
      : current && status === "available"
        ? "current"
        : status;
  const text = displayText ?? String(number).padStart(2, "0");
  let badge = button.querySelector(".game-level-badge");
  if (!badge) {
    button.classList.add("game-level-card");
    badge = document.createElement("span");
    badge.className = "game-level-badge";
    badge.setAttribute("aria-hidden", "true");
    button.replaceChildren(document.createTextNode(text), badge);
  } else if (button.firstChild.nodeValue !== text) {
    button.firstChild.nodeValue = text;
  }
  if (
    badge.dataset.state !== badgeState ||
    badge.dataset.stars !== String(stars)
  ) {
    badge.dataset.state = badgeState;
    badge.dataset.stars = String(stars);
    badge.hidden = badgeState === "available";
    badge.replaceChildren();
    if (badgeState === "stars")
      for (let index = 0; index < stars; index++) {
        const star = document.createElement("span");
        star.textContent = "★";
        badge.append(star);
      }
    if (badgeState === "complete" || badgeState === "draft")
      badge.append(
        WorkTimeApp.games.createIcon(
          badgeState === "complete" ? "check" : "play-arrow",
        ),
      );
    if (badgeState === "locked")
      badge.innerHTML =
        '<svg class="ui-icon" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.5" d="M5 7V5a3 3 0 0 1 6 0v2"/><rect x="3" y="7" width="10" height="7" rx="1.5"/></svg>';
  }
  const name =
    label + " · " + WorkTimeApp.i18n.t("games.levelStatus." + status);
  if (button.title !== name) {
    button.title = name;
    button.setAttribute("aria-label", name);
  }
  button.dataset.levelStatus = status;
  if (current) button.setAttribute("aria-current", "step");
  else button.removeAttribute("aria-current");
  button.disabled = !!locked;
};
/** Match the site's settings picker, retaining a native select as the value owner. */
WorkTimeApp.games.createSelect = function ({ host, select, label, signal }) {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = select.id + "Trigger";
  trigger.className = "game-button game-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  label.htmlFor = trigger.id;
  const valueLabel = document.createElement("span");
  valueLabel.id = select.id + "Value";
  valueLabel.className = "button-label";
  const chevron = WorkTimeApp.games.createIcon("chevron-right");
  chevron.classList.add("language-chevron");
  trigger.append(valueLabel, chevron);
  const list = document.createElement("div");
  list.id = select.id + "Options";
  list.className = "settings-select-options game-select-options";
  list.hidden = true;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-labelledby", label.id);
  trigger.setAttribute("aria-controls", list.id);
  trigger.setAttribute("aria-labelledby", label.id + " " + valueLabel.id);
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.classList.add("game-native-select");
  const listen = (element, name, callback, options = {}) =>
    element.addEventListener(name, callback, { ...options, signal });
  const items = [...select.options].map((option) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "game-button";
    item.tabIndex = -1;
    item.dataset.gameOption = option.value;
    item.setAttribute("role", "option");
    const text = document.createElement("span");
    text.className = "button-label";
    const check = WorkTimeApp.games.createIcon("check");
    check.classList.add("language-selected-icon");
    item.append(text, check);
    listen(item, "click", () => {
      select.value = option.value;
      close(true);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
    });
    list.append(item);
    return item;
  });
  host.append(trigger, list);
  function close(returnFocus = false) {
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (returnFocus) trigger.focus({ preventScroll: true });
  }
  function position() {
    if (list.hidden) return;
    const rect = trigger.getBoundingClientRect();
    const bounds = host.closest(".game-content").getBoundingClientRect();
    const top = Math.max(8, bounds.top),
      bottom = Math.min(window.innerHeight - 8, bounds.bottom);
    if (rect.top < top || rect.bottom > bottom) {
      close();
      return;
    }
    const gap = 8,
      below = bottom - rect.bottom - gap,
      above = rect.top - top - gap;
    list.style.width = rect.width + "px";
    list.style.maxHeight = Math.max(0, Math.max(below, above)) + "px";
    list.style.left =
      Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)) +
      "px";
    const height = list.getBoundingClientRect().height;
    list.style.top =
      (below >= height ? rect.bottom + gap : rect.top - height - gap) + "px";
    WorkTimeApp.ui.popover.point(list, trigger);
  }
  function sync() {
    trigger.disabled = select.disabled;
    valueLabel.textContent = select.selectedOptions[0]?.textContent || "";
    trigger.title = valueLabel.textContent;
    items.forEach((item, index) => {
      item.querySelector(".button-label").textContent =
        select.options[index].textContent;
      item.setAttribute(
        "aria-selected",
        String(select.value === select.options[index].value),
      );
    });
    if (trigger.disabled) close();
    else position();
  }
  function open() {
    if (trigger.disabled || signal.aborted) return;
    sync();
    list.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    position();
    if (!list.hidden)
      list
        .querySelector('[aria-selected="true"]')
        ?.focus({ preventScroll: true });
  }
  listen(trigger, "click", () => (list.hidden ? open() : close()));
  listen(host, "keydown", (event) => {
    if (event.key === "Escape" && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (list.hidden) {
        open();
        return;
      }
      const index = items.indexOf(document.activeElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
      items[next].focus({ preventScroll: true });
    } else if (event.key === "Tab" && !list.hidden) close(true);
  });
  listen(host, "focusout", (event) => {
    if (!host.contains(event.relatedTarget)) close();
  });
  listen(document, "pointerdown", (event) => {
    if (!host.contains(event.target)) close();
  });
  listen(
    document,
    "scroll",
    (event) => {
      if (!list.contains(event.target)) position();
    },
    { capture: true, passive: true },
  );
  listen(window, "resize", () => close());
  signal.addEventListener("abort", () => close(), { once: true });
  sync();
  return { trigger, sync, close };
};
/** Shared game controls and an in-place help screen that never reflows a board. */
WorkTimeApp.games.createHelp = function ({
  root,
  controls,
  signal,
  text,
  onChange,
}) {
  const t = (key) => WorkTimeApp.i18n.t("games." + key);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "game-button game-icon-button";
  button.dataset.gameHelp = "";
  button.append(WorkTimeApp.games.createIcon("help"));
  button.setAttribute("aria-expanded", "false");
  controls.append(button);
  const panel = document.createElement("section");
  panel.className = "game-help-screen";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  const heading = document.createElement("h3");
  const description = document.createElement("p");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "game-button";
  close.dataset.gameHelpClose = "";
  panel.append(heading, description, close);
  root.append(panel);
  let savedInert = [],
    opened = false;
  function refresh() {
    button.title = t("help");
    button.setAttribute("aria-label", t("help"));
    panel.setAttribute("aria-label", t("help"));
    heading.textContent = t("help");
    description.textContent = text();
    close.textContent = t("backToGame");
  }
  function toggle(value) {
    if (opened === value) return;
    opened = value;
    panel.hidden = !value;
    button.setAttribute("aria-expanded", String(value));
    if (value) {
      savedInert = [...root.children]
        .filter((child) => child !== panel)
        .map((child) => [child, child.inert]);
      savedInert.forEach(([child]) => (child.inert = true));
      onChange?.(true);
      refresh();
      close.focus({ preventScroll: true });
    } else {
      savedInert.forEach(([child, inert]) => (child.inert = inert));
      savedInert = [];
      onChange?.(false);
      button.focus({ preventScroll: true });
    }
  }
  button.addEventListener("click", () => toggle(true), { signal });
  close.addEventListener("click", () => toggle(false), { signal });
  panel.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") toggle(false);
        else close.focus({ preventScroll: true });
      }
    },
    { signal },
  );
  refresh();
  return { refresh, isOpen: () => opened };
};

/** A decorative, cancellable win effect shared by game sessions. */
WorkTimeApp.games.createCelebration = function (signal) {
  const compat = WorkTimeApp.ui.animationCompat;
  const reduced = compat.preference();
  let celebration = null,
    confettiMotions = [];
  function stop() {
    confettiMotions.forEach((motion) => motion.cancel());
    confettiMotions = [];
    celebration?.remove();
    celebration = null;
  }
  function play(target = null) {
    stop();
    if (reduced.matches || document.hidden || signal.aborted) return;
    const bounds = target?.getBoundingClientRect();
    if (bounds && (!bounds.width || !bounds.height)) return;
    const layer = document.createElement("div");
    layer.className = "game-celebration";
    layer.setAttribute("aria-hidden", "true");
    if (bounds) {
      Object.assign(layer.style, {
        inset: "auto",
        left: bounds.left + "px",
        top: bounds.top + "px",
        width: bounds.width + "px",
        height: bounds.height + "px",
        borderRadius: getComputedStyle(target).borderRadius,
      });
      layer.classList.add("game-celebration-ribbons");
    }
    document.body.append(layer);
    celebration = layer;
    const colors = [
      "#168b72",
      "#f2bb47",
      "#e57a80",
      "#6a9fe0",
      "#a583cd",
      "#f4d779",
    ];
    const width = bounds?.width || window.innerWidth,
      height = bounds?.height || window.innerHeight;
    for (let i = 0; i < 120; i++) {
      const piece = document.createElement("i");
      piece.className = "game-confetti";
      layer.append(piece);
      piece.style.background =
        colors[(bounds ? Math.floor(i / 2) : i) % colors.length];
      piece.style.borderRadius = bounds ? "1px" : i % 3 === 0 ? "50%" : "2px";
      if (bounds) {
        piece.style.width = 5 + (i % 4) * 2 + "px";
        piece.style.height = 16 + (i % 5) * 3 + "px";
      }
      const side = i % 2,
        startX = side ? width + 12 : -12;
      const targetX =
        width *
        (bounds ? 0.35 + Math.random() * 0.3 : 0.08 + Math.random() * 0.84);
      const startY = height * (0.7 + Math.random() * 0.2);
      const peakY = height * (0.02 + Math.random() * 0.28);
      const rotation = (Math.random() - 0.5) * 1440;
      const frames = Array.from({ length: 9 }, (_, step) => {
        const p = step / 8;
        const travel = bounds ? 1 - Math.pow(1 - p, 2) : p;
        const x = startX + (targetX - startX) * travel;
        const y =
          startY * (1 - p) +
          (height + 40) * p -
          ((startY + height + 40) / 2 - peakY) * 4 * p * (1 - p);
        return {
          transform: `translate3d(${x}px, ${y}px, 0) rotate(${rotation * p}deg) rotateY(${p * 720}deg)`,
          opacity: p > 0.75 ? (1 - p) * 4 : 1,
        };
      });
      confettiMotions.push(
        compat.animate(piece, frames, {
          duration: 2300 + Math.random() * 700,
          delay: Math.floor(i / 40) * 220,
          easing: "linear",
          fill: "both",
        }),
      );
    }
    return Promise.all(confettiMotions.map((motion) => motion.finished)).then(
      () => {
        if (celebration === layer) stop();
      },
    );
  }
  const unlisten = compat.listen(reduced, () => {
    if (reduced.matches) stop();
  });
  function dispose() {
    stop();
    unlisten();
    signal.removeEventListener("abort", dispose);
  }
  window.addEventListener("resize", stop, { signal });
  signal.addEventListener("abort", dispose, { once: true });
  return { play, stop, dispose };
};

/** Shared translucent pause state; the original HUD resumes play. */
WorkTimeApp.games.createPauseCover = (cover, signal) => {
  const content = document.createElement("div");
  content.className = "game-pause-content";
  const icon = WorkTimeApp.games.createIcon("hourglass-pause");
  icon.classList.add("game-pause-icon");
  icon.setAttribute("aria-hidden", "true");
  const caption = document.createElement("span");
  caption.className = "game-pause-caption";
  content.append(icon, caption);
  cover.prepend(content);
  const compat = WorkTimeApp.ui.animationCompat;
  const reduced = compat.preference();
  let previous = false,
    animation = null,
    outgoing = null;
  function clearMotion() {
    animation?.cancel();
    animation = null;
    outgoing?.remove();
    outgoing = null;
  }
  const unlisten = compat.listen(reduced, () => {
    if (reduced.matches) clearMotion();
  });
  signal.addEventListener(
    "abort",
    () => {
      clearMotion();
      unlisten();
    },
    { once: true },
  );
  const paint = (paused, label) => {
    if (signal.aborted) return;
    caption.textContent = WorkTimeApp.i18n.t("games.pauseOverlay");
    if (paused !== previous) {
      clearMotion();
      if (!reduced.matches && !signal.aborted && !document.hidden) {
        if (paused) {
          animation = compat.animate(cover, [{ opacity: 0 }, { opacity: 1 }], {
            duration: 220,
            easing: "ease-out",
          });
        } else if (!cover.hidden) {
          // The game can hide its real result/confirmation cover immediately.
          // A noninteractive snapshot finishes the pause fade without blocking input.
          const ghost = cover.cloneNode(false);
          ghost.hidden = false;
          ghost.classList.add("game-pause-outgoing");
          ghost.removeAttribute("role");
          ghost.removeAttribute("aria-label");
          ghost.setAttribute("aria-hidden", "true");
          ghost.inert = true;
          ghost.append(content.cloneNode(true));
          cover.after(ghost);
          outgoing = ghost;
          animation = compat.animate(ghost, [{ opacity: 1 }, { opacity: 0 }], {
            duration: 180,
            easing: "ease-in",
          });
          void animation.finished.then(() => {
            ghost.remove();
            if (outgoing === ghost) outgoing = null;
          });
        }
      }
      previous = paused;
    }
    cover.classList.toggle("game-pause-cover", paused);
    if (paused) {
      cover.setAttribute("role", "img");
      cover.setAttribute("aria-label", label);
    } else {
      cover.removeAttribute("role");
      cover.removeAttribute("aria-label");
    }
  };
  // A new board or catalog is a new presentation, not a resume animation.
  paint.reset = () => {
    clearMotion();
    previous = false;
    cover.classList.remove("game-pause-cover");
    cover.removeAttribute("role");
    cover.removeAttribute("aria-label");
    cover.hidden = true;
  };
  return paint;
};

/** Reuse real game actions while presenting every restart inside its board. */
WorkTimeApp.games.createRestartCover = function ({
  cover,
  cancel,
  accept,
  signal,
  labels,
}) {
  const content = document.createElement("div");
  content.className = "game-restart-content";
  const heading = labels
    ? document.createElement("h3")
    : WorkTimeApp.games.createIcon("restart-alt");
  heading.classList.add(labels ? "game-restart-message" : "game-restart-icon");
  const actions = document.createElement("div");
  actions.className = "game-restart-actions";
  content.append(heading, actions);
  cover.append(content);
  const buttons = [cancel, accept];
  const places = buttons.map(() => document.createComment("restart action"));
  let showing = false;
  let previousLabels = [];
  function paint(value) {
    value = !!value;
    cover.classList.toggle("game-restart-cover", value);
    content.hidden = !value;
    if (value !== showing) {
      showing = value;
      if (value) {
        previousLabels = buttons.map((button) =>
          button.getAttribute("aria-label"),
        );
        buttons.forEach((button, i) => {
          button.before(places[i]);
          actions.append(button);
        });
        cover.setAttribute("role", "dialog");
        cover.setAttribute("aria-modal", "true");
      } else {
        buttons.forEach((button, i) => {
          places[i].replaceWith(button);
          if (previousLabels[i] === null) button.removeAttribute("aria-label");
          else button.setAttribute("aria-label", previousLabels[i]);
        });
        cover.removeAttribute("role");
        cover.removeAttribute("aria-modal");
      }
    }
    if (!value) return;
    const copy = labels?.();
    const title = copy?.title ?? WorkTimeApp.i18n.t("games.restartNew");
    cover.setAttribute("aria-label", title);
    if (copy) heading.textContent = title;
    const buttonLabels = copy
      ? [copy.cancel, copy.accept]
      : ["games.restartCancel", "games.restartNew"].map((key) =>
          WorkTimeApp.i18n.t(key),
        );
    buttons.forEach((button, i) => {
      const label = buttonLabels[i];
      const text = button.querySelector(".button-label");
      if (text) text.textContent = label;
      else button.textContent = label;
      button.setAttribute("aria-label", label);
      button.hidden = false;
    });
  }
  cover.addEventListener(
    "keydown",
    (event) => {
      if (!showing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel.click();
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        (document.activeElement === cancel ? accept : cancel).focus();
      } else event.stopPropagation();
    },
    { capture: true, signal },
  );
  return paint;
};
/** Confirmation for games whose restart previously took effect immediately. */
WorkTimeApp.games.createRestartPrompt = function ({
  host,
  signal,
  labels,
  onOpen,
  onCancel,
  onConfirm,
}) {
  host.classList.add("game-restart-host");
  const cover = document.createElement("div");
  cover.className = "game-restart-panel";
  cover.hidden = true;
  const cancel = document.createElement("button");
  const accept = document.createElement("button");
  for (const [button, action] of [
    [cancel, "cancel"],
    [accept, "new"],
  ]) {
    button.type = "button";
    button.className = "game-button";
    button.dataset.gameRestart = action;
    cover.append(button);
  }
  host.append(cover);
  const paint = WorkTimeApp.games.createRestartCover({
    cover,
    cancel,
    accept,
    signal,
    labels,
  });
  let opened = false,
    source = null,
    savedInert = [];
  function close(confirmed) {
    if (!opened) return;
    opened = false;
    cover.hidden = true;
    paint(false);
    savedInert.forEach(([element, inert]) => {
      element.inert = inert;
    });
    savedInert = [];
    if (confirmed) onConfirm();
    else {
      onCancel?.();
      source?.focus({ preventScroll: true });
    }
  }
  cancel.addEventListener("click", () => close(false), { signal });
  accept.addEventListener("click", () => close(true), { signal });
  document.addEventListener("worktime:languagechange", () => paint(opened), {
    signal,
  });
  return {
    open(trigger) {
      if (opened || signal.aborted) return;
      source = trigger;
      onOpen?.();
      opened = true;
      let branch = cover;
      const root = host.closest(".game-session");
      while (branch.parentElement && branch !== root) {
        for (const sibling of branch.parentElement.children) {
          if (sibling === branch) continue;
          savedInert.push([sibling, sibling.inert]);
          sibling.inert = true;
        }
        branch = branch.parentElement;
      }
      cover.hidden = false;
      paint(true);
      cancel.focus({ preventScroll: true });
    },
    isOpen: () => opened,
  };
};

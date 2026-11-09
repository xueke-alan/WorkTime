"use strict";
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
  const title = node(header, "h3", "game-level-page-title");
  title.id = id + "-title";
  page.setAttribute("aria-labelledby", title.id);
  const summary = node(page, "div", "game-level-page-summary");
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
    summary,
    categories,
    entries,
    selectCategory,
    addRanges,
    refresh() {
      title.textContent = WorkTimeApp.i18n.t("games.levelStatus.choose");
    },
  };
};
WorkTimeApp.games.paintLevelCard = function (
  button,
  { number, label, complete, draft, locked, current, stars = 0 },
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
  const text = String(number).padStart(2, "0");
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
    if (badgeState === "stars") badge.textContent = "★".repeat(stars);
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
    const below = bottom - rect.bottom - 6,
      above = rect.top - top - 6;
    list.style.width = rect.width + "px";
    list.style.maxHeight = Math.max(0, Math.max(below, above)) + "px";
    list.style.left =
      Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)) +
      "px";
    const height = list.getBoundingClientRect().height;
    list.style.top =
      (below >= height ? rect.bottom + 6 : rect.top - height - 6) + "px";
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
  function play() {
    stop();
    if (reduced.matches || document.hidden || signal.aborted) return;
    const layer = document.createElement("div");
    layer.className = "game-celebration";
    layer.setAttribute("aria-hidden", "true");
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
    const width = window.innerWidth,
      height = window.innerHeight;
    for (let i = 0; i < 120; i++) {
      const piece = document.createElement("i");
      piece.className = "game-confetti";
      layer.append(piece);
      piece.style.background = colors[i % colors.length];
      piece.style.borderRadius = i % 3 === 0 ? "50%" : "2px";
      const side = i % 2,
        startX = side ? width + 12 : -12;
      const targetX = width * (0.08 + Math.random() * 0.84);
      const startY = height * (0.7 + Math.random() * 0.2);
      const peakY = height * (0.02 + Math.random() * 0.28);
      const rotation = (Math.random() - 0.5) * 1440;
      const frames = Array.from({ length: 9 }, (_, step) => {
        const p = step / 8;
        const x = startX + (targetX - startX) * p;
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
    void Promise.all(confettiMotions.map((motion) => motion.finished)).then(
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
  signal.addEventListener("abort", dispose, { once: true });
  return { play, stop, dispose };
};

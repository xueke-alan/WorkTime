"use strict";
/** Local popover adapter; unsupported selectors never escape feature detection. */
WorkTimeApp.ui.popover = (() => {
  let native = false;
  try {
    document.documentElement.matches(":popover-open");
    native =
      typeof HTMLElement.prototype.showPopover === "function" &&
      typeof HTMLElement.prototype.hidePopover === "function";
  } catch {
    // Older engines reject the pseudo-class even when matches itself exists.
  }
  const instances = new Set();
  const stack = [];
  // Keep arrows outside scrollable menus and attach them to animated hints.
  const pointers = new Map();
  let pointerFrame = 0;
  function point(element, anchor) {
    if (!element || !anchor) return;
    element.setAttribute("data-pop-surface", "");
    let entry = pointers.get(element);
    if (!entry) {
      const attached = element.matches(
        ".site-hint,.analysis-hover,.analysis-date-hint,.timetable-hint,.agenda-drag-hint",
      );
      let arrow = element;
      if (!attached) {
        arrow = document.createElement("div");
        arrow.className = "pop-arrow";
        arrow.setAttribute("aria-hidden", "true");
        const topLayer = typeof arrow.showPopover === "function";
        if (topLayer) arrow.setAttribute("popover", "manual");
        (element.closest("dialog[open]") || document.body).append(arrow);
        if (topLayer) arrow.showPopover();
      }
      entry = { arrow, anchor, attached };
      pointers.set(element, entry);
    }
    entry.anchor = anchor;
    updatePointers();
  }
  function updatePointers() {
    pointerFrame = 0;
    for (const [element, entry] of pointers) {
      const { arrow, anchor, attached } = entry;
      const bounds = element.getBoundingClientRect();
      if (
        !element.isConnected ||
        !element.getClientRects().length ||
        getComputedStyle(element).visibility === "hidden" ||
        !bounds.width ||
        !bounds.height ||
        (anchor instanceof Element &&
          (!anchor.isConnected || !anchor.getClientRects().length))
      ) {
        if (!attached) arrow.remove();
        pointers.delete(element);
        continue;
      }
      const origin =
        anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
      const x = (origin.left + origin.right) / 2;
      const y = (origin.top + origin.bottom) / 2;
      const side =
        y < bounds.top
          ? "top"
          : y > bounds.bottom
            ? "bottom"
            : x < bounds.left
              ? "left"
              : x > bounds.right
                ? "right"
                : y < bounds.top + bounds.height / 2
                  ? "top"
                  : "bottom";
      const clamp = (value, start, end) =>
        start > end ? (start + end) / 2 : Math.max(start, Math.min(value, end));
      const horizontal = side === "top" || side === "bottom";
      const left = horizontal
        ? clamp(x, bounds.left + 14, bounds.right - 14)
        : side === "left"
          ? bounds.left
          : bounds.right;
      const top = horizontal
        ? side === "top"
          ? bounds.top
          : bounds.bottom
        : clamp(y, bounds.top + 14, bounds.bottom - 14);
      if (attached) {
        const offset = horizontal
          ? left - bounds.left - element.clientLeft
          : top - bounds.top - element.clientTop;
        if (entry.offset !== offset) {
          element.style.setProperty("--pop-arrow-offset", offset + "px");
          entry.offset = offset;
        }
      } else {
        const style = getComputedStyle(element);
        const css = `left:${left - 7}px;top:${top - 7}px;--pop-fill:${style.backgroundColor};--pop-edge:${style.borderTopColor};z-index:${Math.max(20000, Number(style.zIndex) || 0) + 1};`;
        if (entry.css !== css) {
          arrow.style.cssText = css;
          entry.css = css;
        }
      }
      if (arrow.dataset.popArrowSide !== side)
        arrow.dataset.popArrowSide = side;
    }
  }
  function schedulePointers() {
    if (pointers.size && !pointerFrame)
      pointerFrame = requestAnimationFrame(updatePointers);
  }
  new MutationObserver((records) => {
    if (!pointers.size) return;
    if (records.some((record) => !record.target.closest?.(".pop-arrow")))
      schedulePointers();
  }).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["hidden", "open", "style", "class"],
  });
  window.addEventListener("resize", schedulePointers);
  document.addEventListener("worktime:themechange", schedulePointers);
  document.addEventListener("scroll", schedulePointers, {
    capture: true,
    passive: true,
  });
  document.addEventListener(
    "toggle",
    (event) => {
      const details = event.target;
      if (details instanceof HTMLDetailsElement && details.open) {
        const menu = details.querySelector(
          ":scope > :is(.music-menu-panel,.reader-menu,.analysis-date-hint)",
        );
        if (menu) point(menu, details.querySelector("summary"));
      }
      schedulePointers();
    },
    true,
  );
  function create(element, { trigger = () => null } = {}) {
    const scope = new AbortController();
    let opened = false,
      host = null,
      marker = null,
      parent = null,
      previousFocus = null,
      mountScope = null;
    const forms = new Map();
    const attribute = element.getAttribute("popover");
    if (!native) {
      element.removeAttribute("popover");
      element.classList.add("popover-compat");
      element.hidden = true;
    }
    const isOpen = () => (native ? element.matches(":popover-open") : opened);
    function notify() {
      element.dispatchEvent(new Event("toggle"));
    }
    function hide({ restoreFocus = false } = {}) {
      if (!isOpen()) return;
      if (native) element.hidePopover();
      else {
        for (const child of [...stack].reverse())
          if (child.parent() === api) child.hide();
        mountScope?.abort();
        mountScope = null;
        opened = false;
        stack.splice(stack.indexOf(api), 1);
        element.hidden = true;
        if (marker?.parentNode) marker.replaceWith(element);
        host?.remove();
        host = marker = parent = null;
        for (const [control, value] of forms) {
          if (value === null) control.removeAttribute("form");
          else control.setAttribute("form", value);
        }
        forms.clear();
        notify();
      }
      if (restoreFocus && previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
    }
    function show() {
      if (isOpen()) return;
      previousFocus = trigger() || document.activeElement;
      if (native) {
        element.showPopover();
        requestAnimationFrame(() => {
          if (isOpen()) point(element, trigger());
        });
        return;
      }
      parent = [...stack]
        .reverse()
        .find((item) => item.contains(previousFocus) || item.contains(element));
      const ancestors = new Set();
      for (let item = parent; item; item = item.parent()) ancestors.add(item);
      for (const item of [...stack].reverse())
        if (!ancestors.has(item)) item.hide();
      marker = document.createComment("popover location");
      element.before(marker);
      host = document.createElement("div");
      host.className = "popover-compat-host";
      // Preserve locally inherited theme tokens when escaping a clipped panel.
      const style = getComputedStyle(element);
      for (const name of style)
        if (name.startsWith("--"))
          host.style.setProperty(name, style.getPropertyValue(name));
      host.style.font = style.font;
      host.style.color = style.color;
      for (const control of element.querySelectorAll(
        "input,select,textarea,button",
      )) {
        if (control.form?.id) {
          forms.set(control, control.getAttribute("form"));
          control.setAttribute("form", control.form.id);
        }
      }
      const dialog = element.closest("dialog[open]");
      mountScope = new AbortController();
      dialog?.addEventListener("close", () => hide(), {
        signal: mountScope.signal,
      });
      (dialog || document.body).append(host);
      host.append(element);
      opened = true;
      element.hidden = false;
      stack.push(api);
      host.style.zIndex = String(10000 + stack.length);
      notify();
      requestAnimationFrame(() => {
        if (isOpen()) point(element, trigger());
      });
    }
    const api = {
      trigger,
      show,
      hide,
      isOpen,
      parent: () => parent,
      contains: (node) => node instanceof Node && element.contains(node),
      destroy() {
        hide();
        scope.abort();
        instances.delete(api);
        if (!native) {
          element.classList.remove("popover-compat");
          element.hidden = false;
          if (attribute !== null) element.setAttribute("popover", attribute);
        }
      },
    };
    if (!native) {
      document.addEventListener(
        "pointerdown",
        (event) => {
          if (!opened) return;
          const target = event.target;
          let inside = -1;
          stack.forEach((item, index) => {
            if (
              item.contains(target) ||
              item.trigger() === target ||
              item.trigger()?.contains(target)
            )
              inside = index;
          });
          if (stack.indexOf(api) > inside) hide();
        },
        { capture: true, signal: scope.signal },
      );
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "Escape" || stack[stack.length - 1] !== api) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          hide({ restoreFocus: true });
        },
        { capture: true, signal: scope.signal },
      );
    }
    instances.add(api);
    return api;
  }
  return {
    create,
    point,
    anyOpen: () => [...instances].some((item) => item.isOpen()),
  };
})();

/** Hints for detailed or clipped content and explicitly marked actions. */
(() => {
  const hint = document.createElement("div");
  hint.id = "siteHint";
  hint.className = "site-hint";
  hint.setAttribute("role", "tooltip");
  hint.hidden = true;
  const native = typeof hint.showPopover === "function";
  if (native) hint.setAttribute("popover", "manual");
  document.body.append(hint);
  let target = null,
    text = "",
    originalTitle = null,
    description = null,
    timer = null,
    motion = null,
    wordMotion = null,
    scrollMotion = null;
  const detailObserver = new MutationObserver(() => {
    if (!target || !target.isConnected) return close();
    if (target.hidden) {
      // Loading can briefly become ready before the queued synthesis starts.
      const hiddenTarget = target;
      requestAnimationFrame(() => {
        if (target === hiddenTarget && hiddenTarget.hidden) close();
      });
      return;
    }
    const label = target.dataset.dateMarkerHint;
    if (!label || label === text) return;
    text = label;
    if (!hint.hidden) show(false);
  });
  function close() {
    detailObserver.disconnect();
    clearTimeout(timer);
    timer = null;
    motion?.cancel();
    motion = null;
    wordMotion?.cancel();
    wordMotion = null;
    scrollMotion?.cancel();
    scrollMotion = null;
    if (native && !hint.hidden) hint.hidePopover();
    hint.hidden = true;
    if (target) {
      // Rendering may have supplied a newer title while this hint was open.
      if (originalTitle !== null && target.getAttribute("title") === "")
        target.setAttribute("title", originalTitle);
      if (description === null) target.removeAttribute("aria-describedby");
      else target.setAttribute("aria-describedby", description);
    }
    target = null;
  }
  function show(animate = true) {
    timer = null;
    if (!target?.isConnected || document.hidden) return close();
    const audioHint = target.matches(".site-audio-activity");
    let wordChanged = false;
    if (audioHint) {
      if (!hint.classList.contains("site-audio-hint")) {
        hint.replaceChildren(
          ...Array.from({ length: 3 }, () => document.createElement("span")),
        );
        hint.children[0].append(document.createElement("span"));
      }
      const lines = text.split("\n"),
        word = hint.children[0],
        changed = word.textContent !== lines[0];
      wordChanged = changed;
      if (changed) word.firstElementChild.textContent = lines[0] || "";
      for (const index of [1, 2])
        if (hint.children[index].textContent !== lines[index])
          hint.children[index].textContent = lines[index] || "";
      if (changed) {
        wordMotion?.cancel();
        wordMotion = null;
        if (!animate && !WorkTimeApp.ui.animationCompat.preference().matches)
          wordMotion = WorkTimeApp.ui.animationCompat.animate(
            word,
            [
              { opacity: 0.8, transform: "translateY(1px)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: 180, easing: "ease-out" },
          );
      }
    } else hint.textContent = text;
    hint.classList.toggle("site-audio-hint", audioHint);
    if (!native) (target.closest("dialog[open]") || document.body).append(hint);
    hint.hidden = false;
    if (native) hint.showPopover();
    if (audioHint && (wordChanged || animate)) {
      scrollMotion?.cancel();
      scrollMotion = null;
      const row = hint.children[0],
        content = row.firstElementChild,
        overflow = content.scrollWidth - row.clientWidth;
      if (overflow > 1 && !WorkTimeApp.ui.animationCompat.preference().matches)
        scrollMotion = WorkTimeApp.ui.animationCompat.animate(
          content,
          [
            { transform: "translateX(0)", offset: 0 },
            { transform: "translateX(0)", offset: 0.15 },
            { transform: `translateX(${-overflow}px)`, offset: 0.5 },
            { transform: `translateX(${-overflow}px)`, offset: 0.65 },
            { transform: "translateX(0)", offset: 1 },
          ],
          {
            duration: Math.max(6000, (overflow / 30 / 0.35) * 1000),
            iterations: Infinity,
            easing: "linear",
          },
        );
    }
    const rect = target.getBoundingClientRect(),
      box = hint.getBoundingClientRect();
    const inset = 10,
      gap = 8,
      anchorX = rect.left + rect.width / 2,
      left = Math.max(
        inset,
        Math.min(
          anchorX - box.width / 2,
          window.innerWidth - box.width - inset,
        ),
      ),
      above = rect.top >= box.height + gap + inset;
    hint.style.left = left + "px";
    hint.style.top =
      Math.max(
        inset,
        above
          ? rect.top - box.height - gap
          : Math.min(
              rect.bottom + gap,
              window.innerHeight - box.height - inset,
            ),
      ) + "px";
    WorkTimeApp.ui.popover.point(hint, target);
    if (animate && !WorkTimeApp.ui.animationCompat.preference().matches)
      motion = WorkTimeApp.ui.animationCompat.animate(
        hint,
        [
          { opacity: 0, transform: "translateY(3px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 160, easing: "ease-out" },
      );
  }
  function open(element, immediate = false) {
    if (element === target) return;
    close();
    if (
      !element ||
      element.closest(".agenda-content-outgoing,.calendar-navigation-copy")
    )
      return;
    const action = element.getAttribute("data-action-hint");
    const title = element.getAttribute("title");
    const label = action
      ? WorkTimeApp.i18n.t(action)
      : action === ""
        ? element.getAttribute("aria-label")?.trim()
        : (element.dataset.dateMarkerHint || title)?.trim();
    if (!label) return;
    target = element;
    if (element.matches(".site-audio-activity"))
      detailObserver.observe(element, {
        attributes: true,
        attributeFilter: ["data-date-marker-hint", "hidden"],
      });
    text = label;
    originalTitle = title;
    description = target.getAttribute("aria-describedby");
    // Suppress native bubbles even when a visible label makes the hint redundant.
    if (title !== null) target.setAttribute("title", "");
    // Bottom navigation never opens hints, including clipped or status labels.
    if (element.closest(".editor > .notification-tabs")) return;
    if (action !== null && element.matches(':disabled,[aria-disabled="true"]'))
      return;
    // Labels and routine action descriptions should never float over the layout,
    // even when their wording differs from the visible or accessible name.
    // Date markers contain details that otherwise have no visible text.
    if (
      action === null &&
      element.dataset.hint !== "detail" &&
      !element.matches(".date-markers") &&
      ![
        element,
        ...element.querySelectorAll(".button-label,.game-menu-name"),
      ].some(
        (node) =>
          node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1,
      )
    )
      return;
    target.setAttribute(
      "aria-describedby",
      [description, hint.id].filter(Boolean).join(" "),
    );
    timer = setTimeout(show, immediate ? 0 : 240);
  }
  const hintTrigger = "[title],[data-action-hint],[data-date-marker-hint]";
  document.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "touch")
      open(event.target.closest?.(hintTrigger));
  });
  document.addEventListener("pointerout", (event) => {
    if (target && !target.contains(event.relatedTarget)) close();
  });
  document.addEventListener("focusin", (event) =>
    open(event.target.closest?.(hintTrigger), true),
  );
  document.addEventListener("focusout", close);
  document.addEventListener("pointerdown", close, true);
  document.addEventListener(
    "click",
    (event) => {
      if (
        target?.hasAttribute("data-action-hint") &&
        target.contains(event.target)
      )
        close();
    },
    true,
  );
  document.addEventListener("pointerup", (event) => {
    if (
      event.target.closest?.(".site-audio-activity") ||
      (event.pointerType === "touch" && event.target.closest?.(".date-markers"))
    )
      open(event.target.closest(".date-markers,.site-audio-activity"), true);
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") close();
    },
    true,
  );
  document.addEventListener("scroll", close, { capture: true, passive: true });
  window.addEventListener("resize", close);
  document.addEventListener("visibilitychange", close);
  document.addEventListener("worktime:languagechange", close);
})();

/** Shared select adapter for settings and game controls. */
WorkTimeApp.ui.createSelect = function ({
  host,
  select,
  label,
  signal,
  buttonClass = "ui-button",
  prefix = "shared-select",
  bounds = host.closest(".vocabulary-page, .game-content"),
}) {
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ui-icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.innerHTML = `<use href="#ms-${name}"/>`;
    return svg;
  }
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = select.id + "Trigger";
  trigger.className =
    buttonClass + " shared-select-trigger " + prefix + "-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  label.htmlFor = trigger.id;
  const valueLabel = document.createElement("span");
  valueLabel.id = select.id + "Value";
  valueLabel.className = "button-label";
  const chevron = icon("chevron-right");
  chevron.classList.add("language-chevron");
  trigger.append(valueLabel, chevron);
  const list = document.createElement("div");
  list.id = select.id + "Options";
  list.className =
    "settings-select-options shared-select-options " + prefix + "-options";
  list.hidden = true;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-labelledby", label.id);
  trigger.setAttribute("aria-controls", list.id);
  trigger.setAttribute("aria-labelledby", label.id + " " + valueLabel.id);
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.classList.add("shared-native-select");
  const listen = (element, name, callback, options = {}) =>
    element.addEventListener(name, callback, { ...options, signal });
  const items = [...select.options].map((option) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className =
      "shared-select-option" +
      (buttonClass === "ui-button" ? "" : " " + buttonClass);
    item.tabIndex = -1;
    item.dataset.gameOption = option.value;
    item.setAttribute("role", "option");
    const text = document.createElement("span");
    text.className = "button-label";
    const check = icon("check");
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
    const rectBounds = bounds.getBoundingClientRect();
    const top = Math.max(8, rectBounds.top),
      bottom = Math.min(window.innerHeight - 8, rectBounds.bottom);
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

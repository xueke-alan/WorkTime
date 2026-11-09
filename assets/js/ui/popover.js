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
  // Arrows live outside scrolling surfaces, so long menus never clip them.
  const pointers = new Map();
  let pointerFrame = 0;
  function point(element, anchor) {
    if (!element || !anchor) return;
    element.setAttribute("data-pop-surface", "");
    let entry = pointers.get(element);
    if (!entry) {
      const arrow = document.createElement("div");
      arrow.className = "pop-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.innerHTML =
        '<svg viewBox="0 0 14 8" aria-hidden="true"><path d="M0 8 7 1 14 8"/></svg>';
      const topLayer = typeof arrow.showPopover === "function";
      if (topLayer) arrow.setAttribute("popover", "manual");
      (element.closest("dialog[open]") || document.body).append(arrow);
      entry = { arrow, anchor, topLayer };
      pointers.set(element, entry);
      if (topLayer) arrow.showPopover();
    }
    entry.anchor = anchor;
    updatePointers();
  }
  function updatePointers() {
    pointerFrame = 0;
    for (const [element, entry] of pointers) {
      const { arrow, anchor } = entry;
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
        arrow.remove();
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
        Math.max(start, Math.min(value, Math.max(start, end)));
      const horizontal = side === "top" || side === "bottom";
      const left = horizontal
        ? clamp(x, bounds.left + 12, bounds.right - 12) - 7
        : side === "left"
          ? bounds.left - 10
          : bounds.right - 4;
      const top = horizontal
        ? side === "top"
          ? bounds.top - 7
          : bounds.bottom - 1
        : clamp(y, bounds.top + 12, bounds.bottom - 12) - 4;
      const style = getComputedStyle(element);
      const css = `left:${left}px;top:${top}px;--pop-fill:${style.backgroundColor};--pop-edge:${style.borderTopColor};z-index:${Math.max(20000, Number(style.zIndex) || 0) + 1};`;
      if (entry.css !== css) {
        arrow.style.cssText = css;
        entry.css = css;
      }
      if (arrow.dataset.side !== side) arrow.dataset.side = side;
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
          ":scope > .music-menu-panel, :scope > .reader-menu",
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

/** Only detailed or clipped content gets a hint, including in lazy UI. */
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
    description = null,
    timer = null,
    motion = null;
  function close() {
    clearTimeout(timer);
    timer = null;
    motion?.cancel();
    motion = null;
    if (native && !hint.hidden) hint.hidePopover();
    hint.hidden = true;
    if (target) {
      // Rendering may have supplied a newer title while this hint was open.
      if (target.getAttribute("title") === "")
        target.setAttribute("title", text);
      if (description === null) target.removeAttribute("aria-describedby");
      else target.setAttribute("aria-describedby", description);
    }
    target = null;
  }
  function show() {
    timer = null;
    if (!target?.isConnected || document.hidden) return close();
    hint.textContent = text;
    if (!native) (target.closest("dialog[open]") || document.body).append(hint);
    hint.hidden = false;
    if (native) hint.showPopover();
    const rect = target.getBoundingClientRect(),
      box = hint.getBoundingClientRect();
    const inset = 10,
      gap = 8;
    hint.style.left =
      Math.max(
        inset,
        Math.min(
          rect.left + (rect.width - box.width) / 2,
          window.innerWidth - box.width - inset,
        ),
      ) + "px";
    hint.style.top =
      Math.max(
        inset,
        rect.top >= box.height + gap + inset
          ? rect.top - box.height - gap
          : Math.min(
              rect.bottom + gap,
              window.innerHeight - box.height - inset,
            ),
      ) + "px";
    WorkTimeApp.ui.popover.point(hint, target);
    if (!WorkTimeApp.ui.animationCompat.preference().matches)
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
    const title = element?.getAttribute("title")?.trim();
    if (
      !title ||
      element.closest(".agenda-content-outgoing,.calendar-navigation-copy")
    )
      return;
    target = element;
    text = title;
    description = target.getAttribute("aria-describedby");
    // Suppress native bubbles even when a visible label makes the hint redundant.
    target.setAttribute("title", "");
    // Bottom navigation never opens hints, including clipped or status labels.
    if (element.closest(".editor > .notification-tabs")) return;
    const clipped = [
      element,
      ...element.querySelectorAll(".button-label,.game-menu-name"),
    ].some(
      (node) => node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1,
    );
    // Labels and routine action descriptions should never float over the layout,
    // even when their wording differs from the visible or accessible name.
    // Date markers contain details that otherwise have no visible text.
    if (
      !clipped &&
      element.dataset.hint !== "detail" &&
      !element.matches(".date-markers")
    )
      return;
    target.setAttribute(
      "aria-describedby",
      [description, hint.id].filter(Boolean).join(" "),
    );
    timer = setTimeout(show, immediate ? 0 : 240);
  }
  document.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "touch") open(event.target.closest?.("[title]"));
  });
  document.addEventListener("pointerout", (event) => {
    if (target && !target.contains(event.relatedTarget)) close();
  });
  document.addEventListener("focusin", (event) =>
    open(event.target.closest?.("[title]"), true),
  );
  document.addEventListener("focusout", close);
  document.addEventListener("pointerdown", close, true);
  document.addEventListener("pointerup", (event) => {
    if (
      event.pointerType === "touch" &&
      event.target.closest?.(".date-markers")
    )
      open(event.target.closest(".date-markers"), true);
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

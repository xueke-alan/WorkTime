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
    anyOpen: () => [...instances].some((item) => item.isOpen()),
  };
})();

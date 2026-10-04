"use strict";
/** Field errors retain their cause independently of translated display text. */
WorkTimeApp.ui.fieldErrors = (() => {
  const errors = new WeakMap();
  function show(element, error) {
    if (error) errors.set(element, error);
    else errors.delete(element);
    element.textContent = error?.message || "";
  }
  return {
    show,
    clear: (element) => show(element, null),
    saved(element) {
      if (errors.get(element)?.code === "UNSAVED") show(element, null);
    },
    clearRelated(primary, secondary) {
      const error = errors.get(secondary);
      if (error && errors.get(primary) === error) show(primary, null);
      show(secondary, null);
    },
  };
})();
/** Each mounted controller owns its listeners and handler properties. */
WorkTimeApp.ui.createEventScope = function () {
  const cleanup = [];
  return {
    listen(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      cleanup.push(() => target.removeEventListener(type, listener, options));
    },
    handler(target, name, listener) {
      const previous = target[name];
      target[name] = listener;
      cleanup.push(() => {
        if (target[name] === listener) target[name] = previous;
      });
    },
    dispose() {
      for (const release of cleanup.splice(0).reverse()) release();
    },
  };
};
/** Common element lookup, escaping and icon slots; no application state. */
WorkTimeApp.ui.createElements = function (document) {
  const $ = (id) => document.getElementById(id),
    esc = (x) =>
      String(x ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const controlIconNames = {
    close: "close",
    previous: "chevron-left",
    next: "chevron-right",
    disclose: "chevron-right",
    plus: "add",
    more: "more-horiz",
    trash: "delete-outline",
  };
  function icon(name, className = "ui-icon") {
    return (
      '<svg class="' +
      className +
      '" aria-hidden="true"><use href="#ms-' +
      name +
      '"></use></svg>'
    );
  }
  function controlIcon(name) {
    return icon(controlIconNames[name]);
  }
  function trendIcon(direction) {
    return icon(
      "trending-" + direction,
      "ui-icon trend-icon trend-" + direction,
    );
  }
  function initialize() {
    for (const [id, name] of [
      ["prevMonth", "previous"],
      ["nextMonth", "next"],
      ["addTimeTemplate", "plus"],
      ["batchAddTimeTemplate", "plus"],
    ]) {
      const button = $(id);
      button.innerHTML = controlIcon(name);
      button.classList.add("icon-only");
    }
    document
      .querySelectorAll(".dialog-head button[data-close]")
      .forEach((button) => {
        button.innerHTML = controlIcon("close");
        button.classList.add("icon-only");
      });
  }
  return { element: $, escape: esc, icon, controlIcon, trendIcon, initialize };
};

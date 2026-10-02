"use strict";
/** Common element lookup, escaping and icon slots; no application state. */
WorkUI.createElements = function (document) {
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

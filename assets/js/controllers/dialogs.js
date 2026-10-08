"use strict";
/** dialogs controller. Instantiate once, then bind after all actions are connected. */
WorkTimeApp.ui.createDialogController = function (options) {
  const events = WorkTimeApp.ui.createEventScope();
  const { element: $ } = options;

  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    document
      .querySelectorAll("[data-close]")
      .forEach((b) =>
        events.handler(b, "onclick", () => $(b.dataset.close).close()),
      );
  }
  function dispose() {
    events.dispose();
    bound = false;
  }
  return { bind, dispose };
};

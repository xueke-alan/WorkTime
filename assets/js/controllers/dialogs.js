"use strict";
/** dialogs controller. Instantiate once, then bind after all actions are connected. */
WorkUI.createDialogController = function (options) {
  const { element: $, actions } = options;

  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    document
      .querySelectorAll("[data-close]")
      .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
    $("helpOpen").onclick = (event) => {
      event.preventDefault();
      actions.open("helpDialog");
    };
  }
  function dispose() {}
  return { bind, dispose };
};

"use strict";
/** No book engines, directory access or reading storage on calendar startup. */
WorkTimeApp.ui.reader = (() => {
  let pending;
  const loader = {
    refresh() {},
    close() {},
    get isMini() {
      return false;
    },
    async expand() {
      await this.open();
      if (WorkTimeApp.ui.reader !== loader)
        await WorkTimeApp.ui.reader.expand();
    },
    minimize() {},
    async open() {
      try {
        pending ||= WorkTimeApp.services.assets
          .scripts([
            "assets/js/services/reader-storage.js",
            "assets/js/services/reader-library.js",
            "assets/js/services/reader-adapters.js",
            "assets/js/controllers/reader.js",
            "assets/js/controllers/workspace-expansion.js",
            "assets/js/ui/reader.js",
          ])
          .catch((error) => {
            pending = null;
            throw error;
          });
        await pending;
        if (WorkTimeApp.ui.reader === loader)
          throw Error("Reader did not initialize");
        await WorkTimeApp.ui.reader.open();
      } catch {
        const entry = document.getElementById("readerOpen");
        if (entry)
          entry.title = entry.ariaLabel =
            WorkTimeApp.ui.readerText("loadFailed");
      }
    },
  };
  return loader;
})();

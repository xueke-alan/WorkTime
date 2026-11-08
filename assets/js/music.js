"use strict";
/** The calendar starts without loading the listening room or touching music storage. */
WorkTimeApp.ui.music = (() => {
  let pending = null;
  const loader = {
    refresh() {},
    async open() {
      try {
        if (!pending)
          pending = (async () => {
            await Promise.all(
              [
                "assets/js/services/music-library.js",
                "assets/js/services/music-storage.js",
                "assets/js/controllers/music.js",
                "assets/js/controllers/workspace-expansion.js",
              ].map((path) => WorkTimeApp.services.assets.script(path)),
            );
            await WorkTimeApp.services.assets.script("assets/js/ui/music.js");
          })().catch((error) => {
            pending = null;
            throw error;
          });
        await pending;
        if (WorkTimeApp.ui.music === loader)
          throw Error("Player did not initialize");
        await WorkTimeApp.ui.music.open();
      } catch {
        const entry = document.getElementById("musicOpen");
        if (entry) {
          entry.title = WorkTimeApp.ui.musicText("loadFailed");
          entry.setAttribute("aria-label", entry.title);
        }
      }
    },
  };
  return loader;
})();

"use strict";
/** The calendar starts without loading the listening room or touching music storage. */
WorkTimeApp.ui.music = (() => {
  let pending = null;
  const loader = {
    refresh() {},
    async open(options) {
      try {
        if (!pending)
          pending = (async () => {
            await Promise.all([
              WorkTimeApp.services.assets.style("assets/css/music.css"),
              WorkTimeApp.services.assets.script(
                "assets/js/ui/music-runtime.min.js",
              ),
            ]);
          })().catch((error) => {
            pending = null;
            throw error;
          });
        await pending;
        if (WorkTimeApp.ui.music === loader)
          throw Error("Player did not initialize");
        await WorkTimeApp.ui.music.open(options);
      } catch {
        const entry = document.getElementById("musicOpen");
        if (entry) {
          entry.dataset.hint = "detail";
          entry.title = WorkTimeApp.ui.musicText("loadFailed");
          entry.setAttribute("aria-label", entry.title);
        }
      }
    },
  };
  return loader;
})();

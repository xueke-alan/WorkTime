"use strict";
/** The calendar starts without loading the listening room or touching music storage. */
WorkTimeApp.ui.music = (() => {
  let pending = null;
  const loader = {
    refresh() {},
    async open(options) {
      const entry = document.getElementById("musicOpen");
      if (entry) entry.dataset.secondaryEntry = "music";
      let current = () => true;
      WorkTimeApp.ui.secondaryControllers.request(
        [],
        (valid) => {
          current = valid;
        },
        entry,
      );
      try {
        if (!pending)
          pending = (async () => {
            await WorkTimeApp.services.assets.script(
              "assets/js/ui/secondary-runtime.min.js",
              { fetchPriority: "high" },
            );
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
        if (!current()) return;
        if (WorkTimeApp.ui.music === loader)
          throw Error("Player did not initialize");
        await WorkTimeApp.ui.music.open(options);
      } catch {
        if (entry && current()) {
          entry.dataset.hint = "detail";
          entry.title = WorkTimeApp.ui.musicText("loadFailed");
          entry.setAttribute("aria-label", entry.title);
        }
      }
    },
  };
  return loader;
})();

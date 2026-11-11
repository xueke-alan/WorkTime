"use strict";
/** Compatibility entry; queue, retries and lifecycle belong to the shared scheduler. */
WorkTimeApp.services.utttaiPrefetch = {
  start() {
    void WorkTimeApp.services.assets
      .script("assets/js/services/game-prefetch.js", { fetchPriority: "low" })
      .then(() => WorkTimeApp.services.gamePrefetch.start("ultimate-ttt"))
      .catch(() => {});
  },
};

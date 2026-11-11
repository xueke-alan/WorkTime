"use strict";
/** Compatibility entry; queue, retries and lifecycle belong to the shared scheduler. */
WorkTimeApp.services.junglePrefetch = {
  start() {
    void WorkTimeApp.services.assets
      .script("assets/js/services/game-prefetch.js", { fetchPriority: "low" })
      .then(() => WorkTimeApp.services.gamePrefetch.start("jungle"))
      .catch(() => {});
  },
};

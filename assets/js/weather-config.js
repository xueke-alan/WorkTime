(function (g) {
  "use strict";
  WorkTimeApp.services.weatherConfig = {
    snapshotUrl:
      "https://raw.githubusercontent.com/xueke-alan/WorkTime/main/data/weather.json",
    staleAfterMs: 2 * 60 * 60 * 1000,
    refreshAfterMs: 5 * 60 * 1000,
  };
})(typeof window === "undefined" ? globalThis : window);

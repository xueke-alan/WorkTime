(function (g) {
  "use strict";
  g.WorkWeatherConfig = {
    pagesBaseUrl: "https://xueke-alan.github.io/WorkTime/",
    dataPath: "assets/data/weather/",
    staleAfterMs: 3 * 60 * 60 * 1000,
    refreshAfterMs: 60 * 60 * 1000,
  };
})(typeof window === "undefined" ? globalThis : window);

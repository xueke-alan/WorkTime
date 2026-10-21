"use strict";
/** Minimal mountable example; future games implement the same ownership contract. */
WorkTimeApp.games.register({
  id: "container-demo",
  nameKey: "games.demoName",
  descriptionKey: "games.demoDescription",
  icon: "sports-esports",
  create({ container, signal }) {
    const surface = document.createElement("div");
    surface.className = "game-demo";
    surface.append(WorkTimeApp.games.createIcon());
    const heading = document.createElement("h2");
    heading.textContent = WorkTimeApp.i18n.t("games.demoName");
    const hint = document.createElement("p");
    hint.textContent = WorkTimeApp.i18n.t("games.demoHint");
    surface.append(heading, hint);
    container.append(surface);
    const translate = () => {
      heading.textContent = WorkTimeApp.i18n.t("games.demoName");
      hint.textContent = WorkTimeApp.i18n.t("games.demoHint");
    };
    document.addEventListener("worktime:languagechange", translate, { signal });
    return { dispose: () => surface.remove() };
  },
});

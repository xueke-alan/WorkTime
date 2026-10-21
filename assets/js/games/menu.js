"use strict";
/** Stateless menu: both the sidebar and expanded shell use the same catalog. */
WorkTimeApp.ui.renderGameMenu = function (container, onSelect) {
  const t = WorkTimeApp.i18n.t;
  const title = document.createElement("h2");
  title.textContent = t("games.menu");
  const list = document.createElement("div");
  list.className = "game-menu-list";
  for (const entry of WorkTimeApp.games.list()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button game-menu-entry";
    button.dataset.game = entry.id;
    const name = document.createElement("strong");
    name.textContent = t(entry.nameKey);
    const description = document.createElement("span");
    description.className = "game-menu-description game-sr-only";
    description.textContent = t(entry.descriptionKey);
    button.title = t(entry.descriptionKey);
    const text = document.createElement("span");
    text.append(name, description);
    button.append(WorkTimeApp.games.createIcon(entry.icon), text);
    button.onclick = () => onSelect(entry.id);
    list.append(button);
  }
  if (!list.childElementCount) list.textContent = t("games.empty");
  container.replaceChildren(title, list);
};

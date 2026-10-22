"use strict";
/** Both menu surfaces share the catalog and keep their own selected game. */
WorkTimeApp.ui.renderGameMenu = function (container, onSelect, archiveUI) {
  const t = WorkTimeApp.i18n.t;
  const entries = WorkTimeApp.games.list();
  const title = document.createElement("h2");
  title.textContent = t("games.menu");
  const header = document.createElement("header");
  header.className = "game-menu-header";
  header.append(title);
  archiveUI?.decorate(container, header);
  const library = document.createElement("div");
  library.className = "game-library";
  const list = document.createElement("div");
  list.className = "game-menu-list";
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", t("games.menu"));
  const detail = document.createElement("section");
  detail.className = "game-menu-detail";
  const artwork = document.createElement("div");
  artwork.className = "game-menu-artwork";
  const name = document.createElement("h3");
  const heading = document.createElement("div");
  heading.className = "game-menu-detail-heading";
  heading.append(artwork, name);
  const play = document.createElement("button");
  play.type = "button";
  play.className = "ui-button primary game-menu-play";
  play.textContent = t("games.play");
  detail.append(heading, play);
  function select(entry, animate = false) {
    const changed = container.dataset.selectedGame !== entry.id;
    container.dataset.selectedGame = entry.id;
    for (const button of list.children)
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.game === entry.id),
      );
    artwork.replaceChildren(WorkTimeApp.games.createIcon(entry.icon));
    name.textContent = t(entry.nameKey);
    play.setAttribute("aria-label", t("games.play") + " · " + t(entry.nameKey));
    play.onclick = () => onSelect(entry.id);
    if (animate && changed) WorkTimeApp.ui.motion?.play(detail);
  }
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button game-menu-entry";
    button.dataset.game = entry.id;
    const label = document.createElement("span");
    label.textContent = t(entry.nameKey);
    button.append(WorkTimeApp.games.createIcon(entry.icon), label);
    button.onclick = () => select(entry, true);
    list.append(button);
  }
  list.onkeydown = (event) => {
    const buttons = [...list.children];
    const current = buttons.indexOf(event.target);
    if (current < 0) return;
    const next = {
      ArrowDown: Math.min(current + 1, buttons.length - 1),
      ArrowUp: Math.max(current - 1, 0),
      Home: 0,
      End: buttons.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    buttons[next].focus();
    buttons[next].click();
  };
  if (entries.length) {
    select(
      entries.find((entry) => entry.id === container.dataset.selectedGame) ||
        entries[0],
    );
    library.append(list, detail);
  } else library.textContent = t("games.empty");
  container.replaceChildren(header, library);
};

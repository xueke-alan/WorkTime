"use strict";
/** Both menu surfaces launch games directly from the shared card catalog. */
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
  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button game-menu-entry";
    button.dataset.game = entry.id;
    const artwork = document.createElement("span");
    artwork.className = "game-menu-artwork";
    artwork.setAttribute("aria-hidden", "true");
    artwork.append(WorkTimeApp.games.createIcon(entry.icon));
    const label = document.createElement("span");
    label.className = "game-menu-name";
    label.textContent = t(entry.nameKey);
    const description = document.createElement("span");
    description.className = "game-menu-description";
    const captionKey = "games.card." + entry.id;
    const caption = t(captionKey);
    description.textContent =
      caption === captionKey ? t(entry.descriptionKey) : caption;
    button.setAttribute(
      "aria-label",
      t("games.play") + " · " + t(entry.nameKey),
    );
    button.append(artwork, label, description);
    button.onclick = () => {
      container.dataset.selectedGame = entry.id;
      onSelect(entry.id);
    };
    list.append(button);
  }
  list.onkeydown = (event) => {
    const buttons = [...list.children];
    const current = buttons.indexOf(event.target);
    if (current < 0) return;
    const columns =
      getComputedStyle(list).gridTemplateColumns.split(" ").length;
    const next = {
      ArrowRight: Math.min(current + 1, buttons.length - 1),
      ArrowLeft: Math.max(current - 1, 0),
      ArrowDown: Math.min(current + columns, buttons.length - 1),
      ArrowUp: Math.max(current - columns, 0),
      Home: 0,
      End: buttons.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    buttons[next].focus();
  };
  if (entries.length) library.append(list);
  else library.textContent = t("games.empty");
  container.replaceChildren(header, library);
};

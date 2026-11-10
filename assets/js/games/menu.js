"use strict";
/** The menu previews the selected entry without loading its game. */
WorkTimeApp.ui.renderGameMenu = function (
  container,
  { selectedId, onSelect, onLaunch, archiveUI },
) {
  const { t, number } = WorkTimeApp.i18n;
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
  const scrollArea = document.createElement("div");
  scrollArea.className = "game-menu-scroll";
  const scrollTrack = document.createElement("div");
  scrollTrack.className = "game-menu-scroll-track";
  scrollTrack.setAttribute("aria-hidden", "true");
  const scrollThumb = document.createElement("div");
  scrollThumb.className = "game-menu-scroll-thumb";
  scrollTrack.append(scrollThumb);
  scrollArea.append(list, scrollTrack);
  function syncScrollbar() {
    const height = list.clientHeight;
    const range = list.scrollHeight - height;
    scrollTrack.hidden = range <= 1 || height === 0;
    if (scrollTrack.hidden) return;
    const trackHeight = scrollTrack.clientHeight;
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(24, (height / list.scrollHeight) * trackHeight),
    );
    scrollThumb.style.height = thumbHeight + "px";
    scrollThumb.style.transform =
      "translateY(" +
      (list.scrollTop / range) * (trackHeight - thumbHeight) +
      "px)";
  }
  list.addEventListener("scroll", syncScrollbar, { passive: true });
  const scrollObserver = new ResizeObserver(syncScrollbar);
  scrollObserver.observe(list);
  let drag = null;
  scrollTrack.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const bounds = scrollThumb.getBoundingClientRect();
    const travel = scrollTrack.clientHeight - bounds.height;
    if (travel <= 0) return;
    const ratio = (list.scrollHeight - list.clientHeight) / travel;
    if (event.target !== scrollThumb)
      list.scrollTop =
        (event.clientY -
          scrollTrack.getBoundingClientRect().top -
          bounds.height / 2) *
        ratio;
    drag = { y: event.clientY, top: list.scrollTop, ratio };
    scrollTrack.setPointerCapture(event.pointerId);
    scrollArea.classList.add("is-dragging");
  };
  scrollTrack.onpointermove = (event) => {
    if (drag) list.scrollTop = drag.top + (event.clientY - drag.y) * drag.ratio;
  };
  scrollTrack.onlostpointercapture = () => {
    drag = null;
    scrollArea.classList.remove("is-dragging");
  };
  const detail = document.createElement("section");
  detail.className = "game-menu-detail";
  const detailHeader = document.createElement("header");
  detailHeader.className = "game-menu-detail-header";
  const detailArtwork = document.createElement("span");
  detailArtwork.className = "game-menu-artwork";
  detailArtwork.setAttribute("aria-hidden", "true");
  const detailTitle = document.createElement("h3");
  detailHeader.append(detailArtwork, detailTitle);
  const description = document.createElement("p");
  description.className = "game-menu-description";
  // Scrollable text must not become an extra native Tab stop before Play.
  description.tabIndex = -1;
  const play = document.createElement("button");
  play.type = "button";
  play.className = "ui-button primary game-menu-play";
  play.textContent = t("games.play");
  play.onclick = () => onLaunch(selectedId);
  const progress = document.createElement("div");
  progress.className = "game-menu-progress";
  const progressTitle = document.createElement("h4");
  progressTitle.textContent = t("games.progress.title");
  const progressText = document.createElement("p");
  progress.append(progressTitle, progressText);
  detail.append(detailHeader, description, play, progress);

  function refreshProgress() {
    const { kind, value } =
      WorkTimeApp.services.gameArchive.progressSummary(selectedId);
    const message = t(
      "games.progress." + kind,
      value === undefined ? undefined : { n: number(value) },
    );
    if (progressText.textContent !== message)
      progressText.textContent = message;
  }

  const buttons = [];
  function setTabStop(active) {
    for (const button of buttons) button.tabIndex = button === active ? 0 : -1;
  }
  function select(id) {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const entry = entries[index];
    selectedId = id;
    for (const button of buttons)
      button.setAttribute("aria-pressed", String(button === buttons[index]));
    setTabStop(buttons[index]);
    const name = t(entry.nameKey);
    detail.setAttribute("aria-label", name);
    detailArtwork.replaceChildren(WorkTimeApp.games.createIcon(entry.icon));
    detailTitle.textContent = name;
    description.textContent = t(entry.descriptionKey);
    description.scrollTop = 0;
    play.setAttribute("aria-label", t("games.play") + " · " + name);
    refreshProgress();
    detail.scrollTop = 0;
  }
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
    button.append(artwork, label);
    button.onclick = () => {
      select(entry.id);
      onSelect(entry.id);
    };
    button.ondblclick = () => onLaunch(entry.id);
    button.onfocus = () => setTabStop(button);
    buttons.push(button);
    list.append(button);
    scrollObserver.observe(button);
  }
  list.onkeydown = (event) => {
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
  };
  if (entries.length) {
    library.append(scrollArea, detail);
    select(
      entries.some((entry) => entry.id === selectedId)
        ? selectedId
        : entries[0].id,
    );
  } else library.textContent = t("games.empty");
  container.replaceChildren(header, library);
  return {
    select,
    refreshProgress,
    dispose() {
      scrollObserver.disconnect();
    },
  };
};

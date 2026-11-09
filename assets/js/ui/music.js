"use strict";
/** A listening room that expands from the calendar without replacing its state. */
WorkTimeApp.ui.music = (() => {
  const t = (key, n) => {
    if (key === "choose")
      return WorkTimeApp.ui.runtimeFolderText("importFiles");
    if (key === "importFolder")
      return WorkTimeApp.ui.runtimeFolderText("importFolder");
    if (["folder", "manage"].includes(key))
      return WorkTimeApp.ui.runtimeFolderText("folderLabel");
    if (["accessHint", "chooseHint"].includes(key))
      return WorkTimeApp.services.runtimeFolder.state.status !== "available"
        ? ""
        : WorkTimeApp.ui.runtimeFolderText(
            key === "chooseHint" ? "emptyLibrary" : "mediaUnavailable",
          );
    if (["emptyText", "empty", "emptyFolder", "folderHint"].includes(key))
      return (
        WorkTimeApp.ui.runtimeFolderText("location", { name: "music/" }) +
        " · " +
        WorkTimeApp.ui.runtimeFolderText("importFiles")
      );
    return WorkTimeApp.ui.musicText(key, n);
  };
  const motionPreference = WorkTimeApp.ui.animationCompat.preference();
  const musicAnimations = new Map();
  const menuGhosts = new Set();
  const motionEase = "cubic-bezier(0.22, 1, 0.36, 1)";
  function stopMusicMotion() {
    for (const animation of musicAnimations.values()) animation.cancel();
    musicAnimations.clear();
    for (const ghost of menuGhosts) ghost.remove();
    menuGhosts.clear();
  }
  function musicMotion(element, frames, duration = 260) {
    if (!element || !element.getClientRects().length) return;
    const previous = musicAnimations.get(element);
    const painted = previous && getComputedStyle(element);
    const start = painted && {
      opacity: painted.opacity,
      transform: painted.transform,
    };
    previous?.cancel();
    musicAnimations.delete(element);
    if (
      motionPreference.matches ||
      document.hidden ||
      WorkTimeApp.i18n.changing
    )
      return;
    const animation = WorkTimeApp.ui.animationCompat.animate(
      element,
      start ? [start, frames[frames.length - 1]] : frames,
      { duration, easing: motionEase, fill: "backwards" },
    );
    musicAnimations.set(element, animation);
    animation.finished.then(() => {
      if (musicAnimations.get(element) === animation)
        musicAnimations.delete(element);
    });
    return animation;
  }
  function revealMusic(element, distance = 4) {
    if (dialog.dataset.state !== "open") return;
    for (const [child, animation] of musicAnimations)
      if (child !== element && element.contains(child)) {
        animation.cancel();
        musicAnimations.delete(child);
      }
    musicMotion(element, [
      { opacity: 0.4, transform: `translateY(${distance}px)` },
      { opacity: 1, transform: "none" },
    ]);
  }
  function pulseMusic(element) {
    musicMotion(
      element,
      [
        { opacity: 0.65, transform: "scale(.9)" },
        { opacity: 1, transform: "none" },
      ],
      160,
    );
  }
  const unlistenMusicMotion = WorkTimeApp.ui.animationCompat.listen(
    motionPreference,
    () => {
      stopMusicMotion();
      stopLyricScroll();
    },
  );
  function stopLyricScroll() {
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
    lyricView.scrollTo({ top: lyricView.scrollTop, behavior: "instant" });
  }
  function musicVisibility() {
    if (document.hidden) {
      stopMusicMotion();
      stopLyricScroll();
    }
  }
  document.addEventListener("visibilitychange", musicVisibility);
  function updateRange(input) {
    const span = Number(input.max) - Number(input.min);
    const fill =
      span > 0 ? ((Number(input.value) - Number(input.min)) / span) * 100 : 0;
    input.style.setProperty(
      "--range-fill",
      Math.max(0, Math.min(100, fill)) + "%",
    );
  }
  const controller = WorkTimeApp.ui.createMusicController();
  const dialog = document.createElement("section");
  dialog.id = "musicDialog";
  dialog.className = "game-shell music-dialog";
  dialog.hidden = true;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "musicTitle");
  const surface = document.createElement("div");
  surface.className = "game-surface";
  surface.setAttribute("aria-hidden", "true");
  dialog.append(surface);
  const bindings = [],
    labels = [];
  let registerBindings = true;
  function node(tag, cls, parent) {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    parent?.append(element);
    return element;
  }
  function copy(element, key, n) {
    if (registerBindings) bindings.push({ element, key, n });
    element.textContent = t(key, n);
    return element;
  }
  function accessible(element, key) {
    if (registerBindings) labels.push({ element, key });
    element.setAttribute("aria-label", t(key));
    if (key === "returnMain") element.removeAttribute("title");
    else element.title = t(key);
  }
  function icon(name) {
    const paths = {
      back: '<path d="m14 6-6 6 6 6"/>',
      play: '<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
      pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
      previous: '<path d="M6 5v14M19 5 9 12l10 7Z"/>',
      next: '<path d="M18 5v14M5 5l10 7-10 7Z"/>',
      heart:
        '<path d="M20.5 5.5a5 5 0 0 0-7 0L12 7l-1.5-1.5a5 5 0 0 0-7 7L12 21l8.5-8.5a5 5 0 0 0 0-7Z"/>',
      note: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/>',
      library: '<path d="M4 4v16M9 4v16M14 5l5-1 3 15-5 1Z"/>',
      folder: '<path d="M3 7V5h6l2 2h10v13H3Z"/><path d="M3 11h18"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
      locate:
        '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>',
      volume:
        '<path d="M3 9h4l5-5v16l-5-5H3ZM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
      muted: '<path d="M3 9h4l5-5v16l-5-5H3Zm13-1 6 8m0-8-6 8"/>',
      shuffle:
        '<path d="M3 6h3c4 0 8 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 4-3 6-6s4-6 6-6h3m-4-4 4 4-4 4"/>',
      repeat:
        '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>',
      lyrics:
        '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 8h10M7 12h7M7 16h10"/>',
      more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      minimize: '<path d="M5 17h14"/>',
      expand: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
    };
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (paths[name] || paths.note) +
      "</svg>"
    );
  }
  function glyphName(glyph) {
    return (
      {
        "‹": "back",
        "▶": "play",
        "⏮": "previous",
        "⏭": "next",
        "♡": "heart",
        "♪": "volume",
        "◎": "locate",
        "+": "plus",
      }[glyph] || glyph
    );
  }
  function setGlyph(element, name) {
    if (element.dataset.musicGlyph === name) return;
    const changed = Boolean(element.dataset.musicGlyph);
    element.dataset.musicGlyph = name;
    element.firstChild.innerHTML = icon(name);
    if (changed) pulseMusic(element.firstChild);
  }
  function button(parent, key, action, glyph) {
    const element = node("button", "music-button", parent);
    element.type = "button";
    if (["choose", "importFolder"].includes(key))
      element.dataset.runtimeAction = "import";
    if (glyph) {
      const glyphElement = node("span", "music-glyph", element);
      glyphElement.innerHTML = icon(glyphName(glyph));
      element.dataset.musicGlyph = glyphName(glyph);
      glyphElement.setAttribute("aria-hidden", "true");
      accessible(element, key);
    } else copy(element, key);
    element.addEventListener("click", (event) => {
      if (!element.disabled) pulseMusic(element.querySelector(".music-glyph"));
      action(event);
    });
    return element;
  }
  function select(parent, key, options, change) {
    const label = node("label", "music-select-label", parent);
    copy(node("span", "", label), key);
    const element = node("select", "", label);
    accessible(element, key);
    for (const [value, text, n] of options) {
      const option = node("option", "", element);
      option.value = value;
      copy(option, text, n);
    }
    element.onchange = () => change(element.value);
    return element;
  }
  const header = node("header", "music-header workspace-toolbar", dialog);
  const exitButton = button(header, "returnMain", () => expansion.close(), "‹");
  exitButton.id = "musicExitButton";
  exitButton.classList.add(
    "ui-button",
    "icon-only",
    "workspace-toolbar-action",
  );
  exitButton.replaceChildren(WorkTimeApp.games.createIcon("calendar-month"));
  const title = node("h2", "", header);
  title.id = "musicTitle";
  copy(title, "title");
  const searchBox = node("div", "music-search-box", header);
  const searchIcon = node("span", "music-glyph", searchBox);
  searchIcon.innerHTML = icon("search");
  searchIcon.setAttribute("aria-hidden", "true");
  const query = node("input", "music-search", searchBox);
  query.type = "search";
  accessible(query, "search");
  query.placeholder = t("search");
  const management = node("details", "music-menu music-management", header);
  const managementToggle = node("summary", "music-menu-toggle", management);
  managementToggle.innerHTML = icon("folder");
  accessible(managementToggle, "manage");
  managementToggle.classList.add("workspace-toolbar-action");
  const minimizeButton = button(
    header,
    "minimize",
    () => minimize(),
    "minimize",
  );
  minimizeButton.id = "musicMinimize";
  minimizeButton.classList.add(
    "ui-button",
    "icon-only",
    "workspace-toolbar-action",
  );
  minimizeButton.replaceChildren(
    WorkTimeApp.games.createIcon("horizontal-rule"),
  );
  const toolbar = node("div", "music-menu-panel music-toolbar", management);
  button(toolbar, "choose", () => void chooseFolder());
  button(toolbar, "importFolder", () => importer.open(true));
  const reconnect = button(toolbar, "access", async () => {
    if (!(await controller.rescan())) await chooseFolder();
    management.open = false;
  });
  reconnect.id = "musicReconnect";
  const rescan = button(toolbar, "rescan", async () => {
    if (!(await controller.rescan())) await chooseFolder();
    management.open = false;
  });
  const cancel = button(toolbar, "cancel", () => {
    controller.cancelScan();
    management.open = false;
  });
  const body = node("div", "music-body", dialog);
  const sidebar = node("aside", "music-sidebar", body);
  const libraryBrand = node("div", "music-sidebar-brand", sidebar);
  node("span", "music-glyph", libraryBrand).innerHTML = icon("library");
  copy(node("h3", "", libraryBrand), "library");
  const navigation = node("nav", "music-library-nav", sidebar);
  accessible(navigation, "library");
  const allSongs = button(navigation, "allSongs", () => {
    favoriteOnly = false;
    query.value = "";
    listSignature = "";
    setMobile("songs");
    render();
  });
  allSongs.id = "musicAllSongs";
  const favoritesButton = button(navigation, "collection", () => {
    favoriteOnly = !favoriteOnly;
    listSignature = "";
    setMobile("songs");
    render();
  });
  favoritesButton.id = "musicFavorites";
  const folderCard = node("div", "music-folder-card", sidebar);
  const folderArt = node("span", "music-folder-icon", folderCard);
  folderArt.innerHTML = icon("folder");
  folderArt.setAttribute("aria-hidden", "true");
  const directory = node("p", "music-directory", folderCard);
  const folderText = copy(
    node("p", "music-folder-hint", folderCard),
    "folderHint",
  );
  button(folderCard, "choose", () => void chooseFolder(), "+").classList.add(
    "music-add-folder",
  );
  copy(node("p", "music-local-note", sidebar), "localOnly");
  const library = node("section", "music-library", body);
  accessible(library, "songs");
  const hero = node("div", "music-library-hero", library);
  const heroArt = node("div", "music-hero-art", hero);
  heroArt.innerHTML = icon("library");
  heroArt.setAttribute("aria-hidden", "true");
  const heroText = node("div", "music-hero-text", hero);
  copy(node("p", "music-eyebrow", heroText), "library");
  const collectionTitle = node("h3", "", heroText);
  const collectionCount = node("p", "music-collection-count", heroText);
  const heroPlay = button(
    heroText,
    "playAll",
    () => {
      const state = controller.snapshot();
      const track = state.tracks.find(
        (item) => !favoriteOnly || controller.isFavorite(item),
      );
      if (track) controller.select(track);
    },
    "▶",
  );
  heroPlay.classList.add("music-hero-play");
  const onboarding = node("div", "music-onboarding", library);
  const emptyArt = node("div", "music-empty-art", onboarding);
  emptyArt.setAttribute("aria-hidden", "true");
  emptyArt.innerHTML =
    '<span class="music-record"></span><span class="music-note music-note-one">♪</span><span class="music-note music-note-two">♫</span>';
  copy(node("p", "music-eyebrow", onboarding), "localOnly");
  copy(node("h3", "", onboarding), "emptyTitle");
  copy(node("p", "music-onboarding-text", onboarding), "emptyText");
  const choose = button(onboarding, "choose", () => void chooseFolder());
  choose.id = "musicChoose";
  copy(node("p", "music-formats", onboarding), "fileFormats");
  const notice = node("p", "music-notice", library);
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  const storageNotice = copy(
    node("p", "music-notice", library),
    "storageIssue",
  );
  const statusActions = node("div", "music-status-actions", library);
  statusActions.append(reconnect, cancel);
  const filters = node("div", "music-filters", library);
  const filterRow = node("div", "music-filter-row", filters);
  const listHeading = copy(node("h4", "", filterRow), "songs");
  const sort = select(
    filterRow,
    "sort",
    [
      ["asc", "asc"],
      ["desc", "desc"],
    ],
    () => {
      listSignature = "";
      render();
    },
  );
  button(
    filterRow,
    "locate",
    () => {
      query.value = "";
      favoriteOnly = false;
      listSignature = "";
      setMobile("songs");
      render();
      list.querySelector('[aria-current="true"]')?.scrollIntoView({
        block: "center",
        behavior: motionPreference.matches ? "instant" : "smooth",
      });
    },
    "◎",
  );
  const columns = node("div", "music-list-columns", library);
  node("span", "", columns).textContent = "#";
  copy(node("span", "", columns), "trackTitle");
  copy(node("span", "", columns), "albumLabel");
  const list = node("div", "music-tracks", library);
  list.setAttribute("role", "list");
  const inspector = node("section", "music-inspector", body);
  const inspectorTabs = node("div", "music-inspector-tabs", inspector);
  const nowTab = button(inspectorTabs, "nowPlaying", () => setInspector("now"));
  nowTab.id = "musicNowTab";
  const lyricTab = button(inspectorTabs, "lyrics", () =>
    setInspector("lyrics"),
  );
  lyricTab.id = "musicLyricsTab";
  const now = node("section", "music-now", inspector);
  const art = node("div", "music-art", now);
  const placeholder = node("span", "music-art-placeholder", art);
  placeholder.innerHTML = '<span class="music-record"></span>';
  placeholder.setAttribute("aria-hidden", "true");
  const cover = node("img", "music-cover", art);
  cover.alt = "";
  cover.hidden = true;
  const nowInfo = node("div", "music-now-info", now);
  const song = node("h3", "music-song-title", nowInfo);
  const artist = node("p", "music-artist", nowInfo);
  const album = node("p", "music-album", nowInfo);
  const favorite = button(
    now,
    "favorite",
    () => {
      const track = controller.snapshot().current;
      if (track) controller.favorite(track);
    },
    "♡",
  );
  favorite.id = "musicFavorite";
  favorite.classList.add("music-favorite");
  copy(node("p", "music-now-caption", now), "localOnly");
  const lyricPane = node("section", "music-lyrics-pane", inspector);
  accessible(lyricPane, "lyrics");
  const lyricSong = node("h3", "music-lyric-song", lyricPane);
  const lyricView = node("div", "music-lyrics", lyricPane);
  const tabs = node("div", "music-mobile-tabs", header);
  const songsTab = button(tabs, "songs", () => setMobile("songs"));
  const lyricsTab = button(tabs, "lyrics", () => setMobile("lyrics"));
  const footer = node("div", "music-controls", dialog);
  const currentInfo = node("div", "music-current", footer);
  const miniArt = node("button", "music-mini-art", currentInfo);
  miniArt.type = "button";
  miniArt.innerHTML = icon("note");
  accessible(miniArt, "nowPlaying");
  miniArt.onclick = () => setInspector("now");
  const miniCover = node("img", "", miniArt);
  miniCover.alt = "";
  miniCover.hidden = true;
  const currentText = node("div", "music-current-text", currentInfo);
  const compactSong = node("p", "music-compact-song", currentText);
  const compactArtist = node("p", "music-compact-artist", currentText);
  const currentFavorite = button(
    currentInfo,
    "favorite",
    () => {
      const track = controller.snapshot().current;
      if (track) controller.favorite(track);
    },
    "♡",
  );
  currentFavorite.classList.add("music-favorite");
  currentFavorite.id = "musicCurrentFavorite";
  const centerControls = node("div", "music-player-center", footer);
  const transport = node("div", "music-transport", centerControls);
  const shuffle = button(
    transport,
    "shuffle",
    () =>
      controller.mode(
        controller.snapshot().mode === "shuffle" ? "list" : "shuffle",
      ),
    "shuffle",
  );
  shuffle.id = "musicShuffle";
  const previous = button(
    transport,
    "previous",
    () => controller.previous(),
    "⏮",
  );
  const play = button(transport, "play", () => controller.toggle(), "▶");
  play.id = "musicPlay";
  play.classList.add("music-play");
  const next = button(transport, "next", () => controller.next(), "⏭");
  const repeat = button(
    transport,
    "list",
    () => {
      const value = controller.snapshot().mode;
      controller.mode(
        value === "list" ? "one" : value === "one" ? "order" : "list",
      );
    },
    "repeat",
  );
  repeat.id = "musicRepeat";
  const progressRow = node("div", "music-progress-row", centerControls);
  const elapsed = node("output", "music-time", progressRow);
  const progress = node("input", "music-progress media-range", progressRow);
  progress.type = "range";
  progress.min = "0";
  progress.step = "0.1";
  progress.value = "0";
  accessible(progress, "progress");
  const duration = node("output", "music-time", progressRow);
  const controls = node("div", "music-control-row", footer);
  const lyricToggle = button(
    controls,
    "lyrics",
    () =>
      setInspector(dialog.dataset.inspector === "lyrics" ? "now" : "lyrics"),
    "lyrics",
  );
  lyricToggle.id = "musicLyricsToggle";
  const volumeGroup = node("div", "music-volume", controls);
  const mute = button(volumeGroup, "mute", () => controller.mute(), "♪");
  const volume = node("input", "media-range", volumeGroup);
  volume.type = "range";
  volume.min = "0";
  volume.max = "1";
  volume.step = "0.01";
  accessible(volume, "volume");
  volume.oninput = () => {
    updateRange(volume);
    controller.volume(volume.value);
  };
  const settings = node("details", "music-menu music-settings", controls);
  const settingsToggle = node("summary", "music-menu-toggle", settings);
  settingsToggle.innerHTML = icon("more");
  accessible(settingsToggle, "options");
  const settingPanel = node("div", "music-menu-panel", settings);
  const mode = select(
    settingPanel,
    "mode",
    ["order", "list", "one", "shuffle"].map((value) => [value, value]),
    (value) => controller.mode(value),
  );
  const speed = select(settingPanel, "speed", [], (value) =>
    controller.rate(value),
  );
  for (const value of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
    const option = node("option", "", speed);
    option.value = String(value);
    option.textContent = value + "×";
  }
  const timer = select(
    settingPanel,
    "sleep",
    [
      ["off", "off"],
      ["15", "minutes", 15],
      ["30", "minutes", 30],
      ["60", "minutes", 60],
      ["90", "minutes", 90],
      ["track", "track"],
    ],
    (value) => controller.setSleep(value),
  );
  copy(node("p", "music-shortcut", settingPanel), "shortcut");
  const miniHost = document.getElementById("musicPanel");
  const mini = node("div", "music-mini-player", miniHost);
  const miniHeader = node("div", "music-mini-header", mini);
  copy(node("span", "music-mini-label", miniHeader), "nowPlaying");
  const miniExpand = button(
    miniHeader,
    "expand",
    () => void expand(),
    "expand",
  );
  miniExpand.id = "musicMiniExpand";
  const miniInfo = node("div", "music-mini-info", mini);
  const miniSong = node("h3", "music-mini-song", miniInfo);
  const miniArtist = node("p", "music-mini-artist", miniInfo);
  const miniProgressRow = node(
    "div",
    "music-mini-progress music-progress-row",
    mini,
  );
  const miniElapsed = node("output", "music-time", miniProgressRow);
  const miniProgress = node(
    "input",
    "music-progress media-range",
    miniProgressRow,
  );
  miniProgress.id = "musicMiniProgress";
  miniProgress.type = "range";
  miniProgress.min = "0";
  miniProgress.step = "0.1";
  miniProgress.value = "0";
  accessible(miniProgress, "progress");
  const miniDuration = node("output", "music-time", miniProgressRow);
  const miniTransport = node("div", "music-mini-transport", mini);
  const miniPrevious = button(
    miniTransport,
    "previous",
    () => controller.previous(),
    "previous",
  );
  miniPrevious.id = "musicMiniPrevious";
  const miniPlay = button(
    miniTransport,
    "play",
    () => controller.toggle(),
    "play",
  );
  miniPlay.id = "musicMiniPlay";
  const miniNext = button(
    miniTransport,
    "next",
    () => controller.next(),
    "next",
  );
  miniNext.id = "musicMiniNext";
  const miniStatus = node("p", "music-mini-status", mini);
  miniStatus.setAttribute("role", "status");
  document.querySelector(".workspace").append(dialog);
  const importer = WorkTimeApp.ui.createRuntimeImport({
    host: dialog,
    statusHost: library,
    kind: "music",
    refresh: (result) => controller.rescan(result),
  });
  registerBindings = false;
  let favoriteOnly = false,
    listSignature = "",
    lastLyrics = null,
    lastCover = "",
    lyricIndex = -1,
    dragging = null,
    coverFailed = false,
    disposed = false;
  let userScrollUntil = 0,
    lastStatus = "",
    scrollFrame = null,
    renderTimer = null;
  let presentation = "full",
    pendingMini = false;
  let presentationIssue = false,
    presentationWrites = Promise.resolve();
  const presentationReady = WorkTimeApp.services.musicStorage
    .readPresentation()
    .then((value) => {
      presentation = value === "mini" || value === "full" ? "mini" : "full";
    })
    .catch(() => {
      presentationIssue = true;
    });
  function rememberPresentation(value) {
    if (presentation === value) return;
    presentation = value;
    presentationWrites = presentationWrites
      .catch(() => {})
      .then(() => WorkTimeApp.services.musicStorage.writePresentation(value))
      .catch(() => {
        presentationIssue = true;
        render();
      });
  }
  const main = node("div", "music-main");
  for (const child of [...dialog.children])
    if (child !== surface && child !== header) main.append(child);
  dialog.append(main);
  const expansion = WorkTimeApp.ui.createWorkspaceExpansion({
    shell: dialog,
    surface,
    toolbar: header,
    content: main,
    returnFocus: () => document.getElementById("musicOpen"),
    onChange() {
      if (dialog.dataset.state !== "open") {
        stopMusicMotion();
        stopLyricScroll();
      }
      if (dialog.dataset.state === "closing" && pendingMini)
        WorkTimeApp.ui.dateInfo.showMusicPanel();
      if (!expansion.isOpen && scrollFrame) {
        cancelAnimationFrame(scrollFrame);
        scrollFrame = null;
      }
      if (!expansion.isOpen && pendingMini) {
        pendingMini = false;
        WorkTimeApp.ui.dateInfo.showMusicPanel();
      }
      render();
    },
  });
  function format(seconds) {
    const value = Math.floor(seconds || 0);
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
  }
  function dynamicLabel(element, key) {
    if (key === "returnMain") element.removeAttribute("title");
    else element.title = t(key);
    element.setAttribute("aria-label", t(key));
  }
  function setMobile(view) {
    const previousView = dialog.dataset.mobileView;
    dialog.dataset.mobileView = view;
    songsTab.setAttribute("aria-pressed", String(view === "songs"));
    lyricsTab.setAttribute("aria-pressed", String(view === "lyrics"));
    if (innerWidth <= 700)
      setInspector(view === "lyrics" ? "lyrics" : "now", false);
    if (previousView && previousView !== view && innerWidth <= 700)
      revealMusic(view === "songs" ? library : lyricPane);
  }
  function setInspector(view, updateMobile = true) {
    const previousView = dialog.dataset.inspector;
    dialog.dataset.inspector = view;
    now.hidden = view !== "now";
    lyricPane.hidden = view !== "lyrics";
    nowTab.setAttribute("aria-pressed", String(view === "now"));
    lyricTab.setAttribute("aria-pressed", String(view === "lyrics"));
    lyricToggle.setAttribute("aria-pressed", String(view === "lyrics"));
    if (updateMobile) {
      dialog.dataset.mobileView = view === "lyrics" ? "lyrics" : "songs";
      songsTab.setAttribute("aria-pressed", String(view !== "lyrics"));
      lyricsTab.setAttribute("aria-pressed", String(view === "lyrics"));
    }
    lyricIndex = -1;
    if (expansion.isOpen) render();
    if (previousView && previousView !== view)
      revealMusic(
        innerWidth <= 700 && view === "now"
          ? library
          : view === "now"
            ? now
            : lyricPane,
      );
  }
  setInspector("now", false);
  setMobile("songs");
  cover.onload = () => revealMusic(cover);
  cover.onerror = miniCover.onerror = () => {
    coverFailed = true;
    render();
  };
  dialog.addEventListener("click", (event) => {
    if (!management.contains(event.target)) management.open = false;
    if (!settings.contains(event.target)) settings.open = false;
  });
  function animateMenu(menu, panel, other) {
    let snapshot = null;
    menu.addEventListener("toggle", () => {
      if (menu.open) {
        other.open = false;
        for (const ghost of menuGhosts) ghost.remove();
        menuGhosts.clear();
        const rect = panel.getBoundingClientRect();
        const style = getComputedStyle(panel);
        snapshot = { rect, display: style.display, gap: style.gap };
        revealMusic(panel, menu === settings ? 4 : -4);
      } else if (snapshot) {
        const { rect, display, gap } = snapshot;
        const content = panel.cloneNode(true);
        snapshot = null;
        if (motionPreference.matches || dialog.dataset.state !== "open") return;
        content.removeAttribute("id");
        for (const child of content.querySelectorAll("[id]"))
          child.removeAttribute("id");
        content.inert = true;
        content.setAttribute("aria-hidden", "true");
        content.classList.add("music-menu-leaving");
        Object.assign(content.style, {
          position: "fixed",
          display,
          gap,
          top: `${rect.top}px`,
          left: `${rect.left}px`,
          bottom: "auto",
          right: "auto",
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          pointerEvents: "none",
        });
        dialog.append(content);
        menuGhosts.add(content);
        const animation = musicMotion(
          content,
          [
            { opacity: 1, transform: "none" },
            {
              opacity: 0,
              transform: `translateY(${menu === settings ? 4 : -4}px)`,
            },
          ],
          160,
        );
        const remove = () => {
          content.remove();
          menuGhosts.delete(content);
        };
        if (animation) animation.finished.then(remove);
        else remove();
      }
    });
  }
  animateMenu(management, toolbar, settings);
  animateMenu(settings, settingPanel, management);
  function chooseFolder() {
    management.open = false;
    importer.open();
  }
  query.oninput = () => {
    listSignature = "";
    render();
  };
  for (const [input, time] of [
    [progress, elapsed],
    [miniProgress, miniElapsed],
  ]) {
    input.addEventListener("pointerdown", () => {
      dragging = input;
    });
    input.oninput = () => {
      updateRange(input);
      time.textContent = format(Number(input.value));
      input.setAttribute(
        "aria-valuetext",
        `${format(Number(input.value))} / ${format(Number(input.max))}`,
      );
    };
    input.onchange = () => {
      dragging = null;
      controller.seek(Number(input.value));
    };
    input.addEventListener("pointercancel", () => {
      dragging = null;
      render();
    });
  }
  const endDrag = () => {
    if (dragging) {
      const input = dragging;
      dragging = null;
      controller.seek(Number(input.value));
    }
  };
  window.addEventListener("pointerup", endDrag);
  for (const event of ["wheel", "touchstart", "pointerdown"])
    lyricView.addEventListener(
      event,
      () => {
        stopLyricScroll();
        userScrollUntil = Date.now() + 4000;
      },
      { passive: true },
    );
  function visibleMusicRows() {
    const rows = list.children;
    const viewport = list.getBoundingClientRect();
    let low = 0,
      high = rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (rows[middle].getBoundingClientRect().bottom < viewport.top)
        low = middle + 1;
      else high = middle;
    }
    const visible = [];
    for (let index = low; index < rows.length; index++) {
      const row = rows[index],
        rect = row.getBoundingClientRect();
      if (rect.top > viewport.bottom) break;
      visible.push({ row, rect });
    }
    return visible;
  }
  let previousListOrder = "";
  function renderList(state) {
    const search = query.value.trim().toLocaleLowerCase();
    const signature = JSON.stringify([
      search,
      favoriteOnly,
      sort.value,
      state.tracks.map((track) => [
        track.path,
        track.title,
        track.artist,
        track.album,
        track.error,
        controller.isFavorite(track),
      ]),
      state.current?.path,
    ]);
    if (signature === listSignature) return;
    listSignature = signature;
    const oldRows = new Map();
    const viewport = list.getBoundingClientRect();
    for (const { row, rect } of visibleMusicRows()) {
      const item = row.querySelector("[data-music-path]");
      if (!item) continue;
      if (rect.bottom >= viewport.top && rect.top <= viewport.bottom)
        oldRows.set(item.dataset.musicPath, {
          top: rect.top,
          current: row.classList.contains("is-current"),
          favorite: row
            .querySelector("[data-music-favorite]")
            ?.getAttribute("aria-pressed"),
        });
    }
    const scroll = list.scrollTop,
      focused = document.activeElement?.dataset.musicPath,
      focusFavorite = document.activeElement?.dataset.musicFavorite;
    const fragment = document.createDocumentFragment();
    const filtered = state.tracks.filter(
      (track) =>
        (!favoriteOnly || controller.isFavorite(track)) &&
        (!search ||
          [track.title, track.artist, track.album, track.path].some((value) =>
            value?.toLocaleLowerCase().includes(search),
          )),
    );
    filtered.sort(
      (a, b) =>
        (sort.value === "desc" ? -1 : 1) *
          a.title.localeCompare(b.title, WorkTimeApp.i18n.locale, {
            numeric: true,
          }) || a.path.localeCompare(b.path),
    );
    for (const [position, track] of filtered.entries()) {
      const row = node("div", "music-track", fragment);
      row.setAttribute("role", "listitem");
      if (track === state.current) row.classList.add("is-current");
      const item = button(row, "play", () => controller.select(track));
      item.replaceChildren();
      item.className = "music-track-select";
      item.dataset.musicPath = track.path;
      item.setAttribute("aria-current", String(track === state.current));
      const number = node("span", "music-track-number", item);
      number.textContent = String(position + 1);
      number.setAttribute("aria-hidden", "true");
      const identity = node("span", "music-track-identity", item);
      node("strong", "", identity).textContent = track.title;
      node("span", "music-track-subtitle", identity).textContent =
        [track.artist, track.album].filter(Boolean).join(" · ") || track.path;
      node("span", "music-track-album", item).textContent = track.album || "—";
      item.title = track.path;
      if (track.error)
        node("span", "music-track-error", identity).textContent = t(
          track.error,
        );
      const star = button(
        row,
        "favorite",
        () => controller.favorite(track),
        "♡",
      );
      star.dataset.musicFavorite = track.path;
      star.classList.add("music-favorite");
      star.setAttribute("aria-pressed", String(controller.isFavorite(track)));
      dynamicLabel(
        star,
        controller.isFavorite(track) ? "unfavorite" : "favorite",
      );
      row.lastChild.classList.add("music-track-favorite");
    }
    if (!filtered.length && state.tracks.length) {
      const empty = node("div", "music-empty", fragment);
      copy(node("p", "", empty), "noResults");
      button(empty, "clearSearch", () => {
        query.value = "";
        favoriteOnly = false;
        listSignature = "";
        render();
      });
    }
    const order = JSON.stringify(filtered.map((track) => track.path));
    const oldOrder = previousListOrder;
    previousListOrder = order;
    for (const row of list.children) {
      for (const [element, animation] of musicAnimations)
        if (row === element || row.contains(element)) {
          animation.cancel();
          musicAnimations.delete(element);
        }
    }
    list.replaceChildren(fragment);
    list.scrollTop = scroll;
    if (oldOrder !== order && oldRows.size) {
      const oldPaths = new Set(JSON.parse(oldOrder));
      const reordered =
        oldPaths.size === filtered.length &&
        filtered.every((track) => oldPaths.has(track.path));
      if (reordered && dialog.dataset.state === "open") {
        const plans = visibleMusicRows().map(({ row, rect }) => {
          const path =
            row.querySelector("[data-music-path]")?.dataset.musicPath;
          return { row, rect, old: oldRows.get(path) };
        });
        for (const { row, rect, old } of plans)
          if (rect.bottom >= viewport.top && rect.top <= viewport.bottom) {
            if (old)
              musicMotion(row, [
                { transform: `translateY(${old.top - rect.top}px)` },
                { transform: "none" },
              ]);
            else revealMusic(row);
          }
      } else revealMusic(list);
    } else if (oldOrder === order) {
      for (const row of list.children) {
        const path = row.querySelector("[data-music-path]")?.dataset.musicPath;
        const old = oldRows.get(path);
        if (!old) continue;
        if (old.current !== row.classList.contains("is-current"))
          revealMusic(row, 2);
        const star = row.querySelector("[data-music-favorite]");
        if (old.favorite !== star?.getAttribute("aria-pressed"))
          pulseMusic(star?.firstChild);
      }
    } else revealMusic(list);
    if (focused || focusFavorite)
      [...list.querySelectorAll("button")]
        .find((item) =>
          focused
            ? item.dataset.musicPath === focused
            : item.dataset.musicFavorite === focusFavorite,
        )
        ?.focus({ preventScroll: true });
  }
  function renderLyrics(state) {
    const value = state.details?.lyrics;
    if (value !== lastLyrics) {
      lastLyrics = value;
      lyricIndex = -1;
      lyricView.replaceChildren();
      revealMusic(lyricView);
      if (value?.lines.length)
        for (const line of value.lines) {
          const item = node("button", "music-lyric-line", lyricView);
          item.type = "button";
          item.textContent = line.text || "♪";
          item.onclick = () => controller.seek(line.time);
        }
      else {
        const content = node("p", "music-plain-lyrics", lyricView);
        content.textContent = value?.text || t("noLyrics");
        if (!value?.text)
          copy(node("p", "music-lyric-hint", lyricView), "lyricHint");
      }
    }
    if (!value?.lines.length) return;
    let active = -1;
    for (let i = 0; i < value.lines.length; i++) {
      if (value.lines[i].time > state.position) break;
      active = i;
    }
    if (active === lyricIndex) return;
    lyricView.children[lyricIndex]?.classList.remove("is-current");
    lyricView.children[lyricIndex]?.removeAttribute("aria-current");
    lyricIndex = active;
    const line = lyricView.children[active];
    line?.classList.add("is-current");
    line?.setAttribute("aria-current", "true");
    if (
      line &&
      Date.now() > userScrollUntil &&
      lyricPane.getBoundingClientRect().width
    ) {
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        if (expansion.isOpen)
          lyricView.scrollTo({
            top:
              line.offsetTop -
              lyricView.offsetTop -
              lyricView.clientHeight / 2 +
              line.clientHeight / 2,
            behavior: motionPreference.matches ? "instant" : "smooth",
          });
      });
    }
  }
  function updateButton(state) {
    const entry = document.getElementById("musicOpen");
    if (!entry) return;
    entry.classList.toggle("is-playing", !state.paused);
    delete entry.dataset.hint;
    entry.title = `${t("title")}${state.current ? " · " + state.current.title : ""}`;
    entry.setAttribute(
      "aria-label",
      `${entry.title}${!state.paused ? " · " + t("play") : ""}`,
    );
    if (presentation === "mini") {
      entry.setAttribute("role", "tab");
      entry.removeAttribute("aria-haspopup");
      entry.setAttribute("aria-controls", "musicPanel");
      entry.setAttribute("aria-selected", String(!miniHost.hidden));
      entry.tabIndex = miniHost.hidden ? -1 : 0;
      if (!document.querySelector(".agenda-mode"))
        entry.removeAttribute("aria-expanded");
    } else {
      entry.removeAttribute("role");
      entry.removeAttribute("aria-selected");
      entry.setAttribute("aria-haspopup", "dialog");
      entry.setAttribute("aria-controls", "musicDialog");
      entry.setAttribute("aria-expanded", String(expansion.isOpen));
    }
  }
  function renderMini(state) {
    if (
      miniHost.hidden ||
      expansion.isOpen ||
      !miniHost.getClientRects().length
    )
      return;
    const name = state.current?.title || t("idle"),
      artist = state.current?.artist || (!state.current ? t("pickSong") : "");
    if (miniSong.textContent !== name) miniSong.textContent = name;
    miniSong.title = name;
    if (miniArtist.textContent !== artist) miniArtist.textContent = artist;
    miniArtist.title = artist;
    setGlyph(miniPlay, state.paused ? "play" : "pause");
    dynamicLabel(miniPlay, state.paused ? "play" : "pause");
    for (const control of [miniPlay, miniPrevious, miniNext])
      control.disabled = !state.current || state.needsAccess;
    const status = presentationIssue
      ? t("storageIssue")
      : [
            "accessHint",
            "allFailed",
            "skipError",
            "sleepDone",
            "loading",
          ].includes(state.status)
        ? t(state.status)
        : "";
    if (miniStatus.textContent !== status) miniStatus.textContent = status;
    miniStatus.hidden = !status;
  }
  let lastTrackPath;
  const visibleMusicStates = new WeakMap();
  function render() {
    if (disposed) return;
    const state = controller.snapshot();
    const trackChanged =
      lastTrackPath !== undefined &&
      lastTrackPath !== (state.current?.path || null);
    lastTrackPath = state.current?.path || null;
    updateButton(state);
    for (const [input, time, total] of [
      [progress, elapsed, duration],
      [miniProgress, miniElapsed, miniDuration],
    ]) {
      input.disabled = !state.current || !state.duration || state.needsAccess;
      input.max = String(state.duration || 1);
      if (dragging !== input) input.value = String(state.position);
      time.textContent = format(Number(input.value));
      total.textContent = format(state.duration);
      input.setAttribute(
        "aria-valuetext",
        `${format(Number(input.value))} / ${format(state.duration)}`,
      );
      updateRange(input);
    }
    renderMini(state);
    if (trackChanged && !expansion.isOpen && !miniHost.hidden) {
      musicMotion(miniInfo, [
        { opacity: 0.4, transform: "translateY(4px)" },
        { opacity: 1, transform: "none" },
      ]);
    }
    if (!expansion.isOpen) return;
    const empty = !state.tracks.length;
    dialog.classList.toggle("is-empty", empty);
    dialog.classList.toggle("is-playing", !state.paused);
    onboarding.hidden = !empty;
    hero.hidden = empty;
    filters.hidden = empty;
    columns.hidden = empty;
    list.hidden = empty;
    query.disabled = empty;
    shuffle.disabled = repeat.disabled = lyricToggle.disabled = empty;
    collectionTitle.textContent = favoriteOnly
      ? t("collection")
      : (state.directory === "files" ? t("files") : state.directory) ||
        t("allSongs");
    collectionCount.textContent = t(
      "count",
      favoriteOnly
        ? state.tracks.filter((track) => controller.isFavorite(track)).length
        : state.tracks.length,
    );
    listHeading.textContent = favoriteOnly ? t("collection") : t("allSongs");
    folderText.hidden = Boolean(state.directory);
    allSongs.setAttribute("aria-pressed", String(!favoriteOnly));
    heroPlay.disabled =
      state.needsAccess ||
      !state.tracks.some(
        (track) => !favoriteOnly || controller.isFavorite(track),
      );
    renderList(state);
    renderLyrics(state);
    directory.textContent = [
      state.directory === "files"
        ? t("files")
        : state.directory || t("library"),
      empty ? "" : t("count", state.tracks.length),
    ]
      .filter(Boolean)
      .join(" · ");
    const statusText =
      state.status && state.status !== "chooseHint"
        ? t(state.status) + (state.busy ? ` ${state.count}` : "")
        : "";
    if (statusText !== lastStatus) {
      notice.textContent = statusText;
      lastStatus = statusText;
    }
    notice.hidden = !statusText;
    storageNotice.hidden = !state.storageIssue && !presentationIssue;
    cancel.hidden = !state.busy && !state.readingTags;
    reconnect.hidden = !state.needsAccess;
    rescan.disabled = state.busy;

    title.textContent = t("title");
    song.textContent = state.current?.title || t("idle");
    compactSong.textContent = state.current?.title || t("idle");
    compactArtist.textContent =
      state.current?.artist ||
      (state.current ? state.current.path : t("pickSong"));
    lyricSong.textContent = state.current?.title || t("lyrics");
    artist.textContent = state.current?.artist || "";
    album.textContent = state.current?.album || "";
    if (state.coverURL !== lastCover) {
      lastCover = state.coverURL;
      coverFailed = false;
      if (lastCover) {
        cover.src = lastCover;
        miniCover.src = lastCover;
      } else {
        cover.removeAttribute("src");
        miniCover.removeAttribute("src");
      }
    }
    cover.hidden = miniCover.hidden = !state.coverURL || coverFailed;
    placeholder.hidden = Boolean(state.coverURL) && !coverFailed;
    const isFavorite = state.current && controller.isFavorite(state.current);
    currentFavorite.disabled = !state.current;
    currentFavorite.setAttribute("aria-pressed", String(Boolean(isFavorite)));
    dynamicLabel(currentFavorite, isFavorite ? "unfavorite" : "favorite");
    favorite.disabled = !state.current;
    favorite.setAttribute("aria-pressed", String(Boolean(isFavorite)));
    dynamicLabel(favorite, isFavorite ? "unfavorite" : "favorite");
    favoritesButton.setAttribute("aria-pressed", String(favoriteOnly));
    setGlyph(play, state.paused ? "play" : "pause");
    dynamicLabel(play, state.paused ? "play" : "pause");
    for (const element of [play, previous, next])
      element.disabled = !state.tracks.length || state.needsAccess;
    volume.value = String(state.volume);
    updateRange(volume);
    mute.setAttribute("aria-pressed", String(state.muted));
    setGlyph(mute, state.muted ? "muted" : "volume");
    dynamicLabel(mute, state.muted ? "unmute" : "mute");
    mode.value = state.mode;
    speed.value = String(state.rate);
    timer.value = state.sleep;
    shuffle.setAttribute("aria-pressed", String(state.mode === "shuffle"));
    repeat.setAttribute(
      "aria-pressed",
      String(state.mode === "list" || state.mode === "one"),
    );
    repeat.classList.toggle("is-repeat-one", state.mode === "one");
    dynamicLabel(
      repeat,
      state.mode === "one" ? "one" : state.mode === "list" ? "list" : "order",
    );
    settingsToggle.classList.toggle("has-timer", state.sleep !== "off");
    if (trackChanged) {
      for (const element of [
        song.parentElement,
        compactSong.parentElement,
        art,
      ])
        revealMusic(element);
    }
    for (const element of [
      onboarding,
      hero,
      notice,
      storageNotice,
      cancel,
      reconnect,
    ]) {
      const visible = !element.hidden;
      if (visible && visibleMusicStates.get(element) === false)
        revealMusic(element);
      visibleMusicStates.set(element, visible);
    }
  }
  function scheduleRender() {
    if (renderTimer === null)
      renderTimer = setTimeout(() => {
        renderTimer = null;
        render();
      }, 80);
  }
  const unsubscribe = controller.subscribe(scheduleRender);
  function language() {
    // Dynamic list buttons are rebuilt below; static nodes keep their identity/focus.
    for (const { element, key, n } of bindings)
      if (element.isConnected) element.textContent = t(key, n);
    for (const { element, key } of labels)
      if (element.isConnected) dynamicLabel(element, key);
    query.placeholder = t("search");
    listSignature = "";
    lastLyrics = null;
    render();
  }
  const unlanguage = WorkTimeApp.i18n.subscribe(language);
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (management.open || settings.open) {
        const toggle = management.open ? managementToggle : settingsToggle;
        management.open = settings.open = false;
        toggle.focus();
        return;
      }
      expansion.close();
      return;
    }
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.target.closest(
        "input,select,textarea,[contenteditable=true],button,summary",
      )
    )
      return;
    if (event.code === "Space") {
      event.preventDefault();
      controller.toggle();
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      controller.seek(
        controller.snapshot().position + (event.key === "ArrowRight" ? 5 : -5),
      );
    }
  });
  dialog.tabIndex = -1;
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(renderTimer);
    stopMusicMotion();
    stopLyricScroll();
    unlistenMusicMotion();
    document.removeEventListener("visibilitychange", musicVisibility);
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    unsubscribe();
    importer.dispose();
    unlanguage();
    expansion.dispose();
    controller.dispose();
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pagehide", dispose);
    dialog.remove();
    mini.remove();
    document.removeEventListener("worktime:failed", dispose);
  }
  document.addEventListener("worktime:failed", dispose);
  window.addEventListener("pagehide", dispose, { once: true });
  function minimize() {
    if (disposed) return;
    rememberPresentation("mini");
    pendingMini = true;
    if (expansion.isOpen) expansion.close();
    else {
      pendingMini = false;
      WorkTimeApp.ui.dateInfo.showMusicPanel();
      render();
    }
  }
  async function expand() {
    pendingMini = false;
    try {
      await presentationReady;
      await WorkTimeApp.services.assets.style("assets/css/music.css");
      if (disposed) return;
      expansion.open();
      if (expansion.isOpen) {
        rememberPresentation("full");
        WorkTimeApp.ui.dateInfo.rememberMedia("music");
      }
      render();
    } catch {
      const entry = document.getElementById("musicOpen");
      if (entry) {
        entry.title = t("loadFailed");
        entry.dataset.hint = "detail";
        entry.setAttribute("aria-label", entry.title);
      }
    }
  }
  return {
    get isMini() {
      return presentation === "mini";
    },
    async open({ mini: compact = false, restore = false } = {}) {
      await presentationReady;
      if (restore && !WorkTimeApp.ui.dateInfo.isActive("music")) return;
      if (compact) rememberPresentation("mini");
      if (presentation === "mini") {
        try {
          await WorkTimeApp.services.assets.style("assets/css/music.css");
          if (disposed) return;
          WorkTimeApp.ui.dateInfo.showMusicPanel();
          render();
        } catch {
          const entry = document.getElementById("musicOpen");
          if (entry) {
            entry.title = t("loadFailed");
            entry.dataset.hint = "detail";
            entry.setAttribute("aria-label", entry.title);
          }
        }
      } else await expand();
    },
    minimize,
    expand,
    refresh: () => render(),
    close: () => expansion.close(),
    dispose,
  };
})();

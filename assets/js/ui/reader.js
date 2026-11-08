"use strict";
/** Local library and reading desk, sharing the calendar workspace transition. */
WorkTimeApp.ui.reader = (() => {
  const t = WorkTimeApp.ui.readerText,
    controller = WorkTimeApp.ui.createReaderController();
  const bindings = [];
  let registerBindings = true;
  function node(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    parent?.append(e);
    return e;
  }
  function label(e, key) {
    e.textContent = t(key);
    if (registerBindings) bindings.push(() => (e.textContent = t(key)));
    return e;
  }
  function button(parent, key, action, id) {
    const e = node("button", "reader-button", parent);
    const paths = {
      exit: "m14 6-6 6 6 6",
      sidebar: "M3 4h18v16H3ZM9 4v16",
      shelf: "M4 4v16M9 4v16M14 5l5-1 3 15-5 1Z",
      fullscreen: "M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5",
      minimize: "M5 17h14",
      expand: "M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5",
      all: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
      recent: "M12 8v5l3 2M21 12a9 9 0 1 1-3-6.7M21 3v6h-6",
      favorites: "M12 21 3.5 12.5a5 5 0 0 1 7-7L12 7l1.5-1.5a5 5 0 0 1 7 7Z",
      unread: "M4 3h16v18H4ZM8 7h8M8 11h8",
      reading:
        "M12 5v16M3 3h3a9 9 0 0 1 6 2 9 9 0 0 1 6-2h3v16h-3a9 9 0 0 0-6 2 9 9 0 0 0-6-2H3Z",
      finished: "M5 12l4 4L19 6",
      choose: "M3 7V4h6l2 3h10v13H3ZM12 10v7M8.5 13.5h7",
      reconnect: "M9 8H6a4 4 0 0 0 0 8h3M15 8h3a4 4 0 0 1 0 8h-3M8 12h8",
      refresh: "M20 7a9 9 0 1 0 1 8M21 2v6h-6",
      cancel: "m6 6 12 12M18 6 6 18",
      newGroup: "M12 5v14M5 12h14",
      groups: "M3 7V4h6l2 3h10v13H3Z",
      stats: "M4 20V10M12 20V4M20 20v-7",
      export: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
      restore: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
      exportNotes: "M5 3h10l4 4v14H5ZM9 11h6M9 15h6",
      continue: "m9 5 11 7-11 7Z",
      toc: "M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1",
      bookmarks: "M6 3h12v18l-6-4-6 4Z",
      bookmark: "M6 3h12v18l-6-4-6 4ZM9 9h6M12 6v6",
      notes: "m4 16 12-12 4 4L8 20H4ZM13 7l4 4",
      note: "M5 3h14v18H5ZM8 8h8M8 12h8M8 16h5",
      search: "M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
      thumbnails: "M4 3h6v8H4ZM14 3h6v8h-6ZM4 15h6v6H4ZM14 15h6v6h-6Z",
      settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
      previous: "m14 6-6 6 6 6",
      next: "m10 6 6 6-6 6",
      back: "M9 5 3 11l6 6M3 11h12a6 6 0 0 1 6 6v3",
      previousChapter: "M5 5v14m14-14L9 12l10 7Z",
      nextChapter: "M19 5v14M5 5l10 7-10 7Z",
      highlight: "m5 15 10-12 6 6L9 19H3ZM3 21h18",
      copy: "M8 8h13v13H8ZM16 8V3H3v13h5",
      more: "M5 12h.01M12 12h.01M19 12h.01",
    };
    if (paths[key]) {
      const svg = node("span", "reader-glyph", e);
      svg.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
        paths[key] +
        '"/></svg>';
    }
    label(node("span", "reader-button-label", e), key);
    const accessible = () => {
      e.title = e.ariaLabel = t(key);
    };
    accessible();
    if (registerBindings) bindings.push(accessible);
    e.type = "button";
    if (id) e.id = id;
    e.addEventListener("click", () => {
      controller.activity();
      void action();
    });
    return e;
  }
  function field(parent, key, type = "text") {
    const wrap = node("label", "reader-field", parent);
    label(node("span", "", wrap), key);
    const e = node("input", "", wrap);
    e.type = type;
    e.ariaLabel = t(key);
    if (registerBindings) bindings.push(() => (e.ariaLabel = t(key)));
    return e;
  }
  function select(parent, key, options, action) {
    const wrap = node("label", "reader-field", parent);
    label(node("span", "", wrap), key);
    const e = node("select", "", wrap);
    e.ariaLabel = t(key);
    if (registerBindings) bindings.push(() => (e.ariaLabel = t(key)));
    for (const [value, name] of options) {
      const option = node("option", "", e);
      option.value = value;
      if (name.startsWith("=")) option.textContent = name.slice(1);
      else label(option, name);
    }
    e.onchange = () => void action(e.value);
    return e;
  }
  function download(name, value, type) {
    const url = URL.createObjectURL(new Blob([value], { type })),
      a = node("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const shell = node("section", "game-shell reader-dialog");
  shell.id = "readerDialog";
  shell.hidden = true;
  shell.tabIndex = -1;
  shell.setAttribute("role", "dialog");
  shell.setAttribute("aria-modal", "true");
  shell.setAttribute("aria-labelledby", "readerTitle");
  const surface = node("div", "game-surface", shell);
  surface.ariaHidden = "true";
  const header = node("header", "reader-header", shell);
  button(header, "exit", close, "readerExit").classList.add(
    "reader-icon-button",
  );
  const sidebarToggle = button(
    header,
    "sidebar",
    () => setSidebar(!sidebarVisible()),
    "readerSidebarToggle",
  );
  sidebarToggle.classList.add("reader-icon-button");
  const title = label(node("h2", "reader-title", header), "title");
  title.id = "readerTitle";
  const bookTitle = node("span", "reader-book-title", header);
  const shelfButton = button(header, "shelf", returnToShelf, "readerShelf");
  shelfButton.classList.add("reader-icon-button");
  const bookActions = node("details", "reader-book-actions", header);
  const bookActionsSummary = label(
    node("summary", "reader-more", bookActions),
    "more",
  );
  bookActionsSummary.ariaLabel = t("more");
  bindings.push(
    () => (bookActionsSummary.title = bookActionsSummary.ariaLabel = t("more")),
  );
  const bookActionsMenu = node("div", "reader-menu", bookActions);
  const addBookmark = button(bookActionsMenu, "bookmark", async () => {
    bookActions.open = false;
    const value = await ask("bookmark", new Date().toLocaleString());
    if (value !== null) controller.bookmark(value);
  });
  const markFinished = button(bookActionsMenu, "finished", () => {
    const b = controller.snapshot().current;
    if (b)
      controller.updateBook(b.id, {
        status: b.status === "finished" ? "reading" : "finished",
      });
  });
  button(bookActionsMenu, "exportNotes", exportNotes);
  const minimizeButton = button(header, "minimize", minimize, "readerMinimize");
  minimizeButton.classList.add("reader-icon-button");
  button(
    header,
    "fullscreen",
    async () => {
      try {
        if (document.fullscreenElement === shell)
          await document.exitFullscreen();
        else if (shell.requestFullscreen) await shell.requestFullscreen();
        else throw Error();
      } catch {
        localStatus = t("fullscreenFailed");
        render();
      }
    },
    "readerFullscreen",
  ).classList.add("reader-icon-button");
  const main = node("div", "reader-main", shell);
  const notices = node("div", "reader-notices", main);
  const status = node("p", "reader-status", notices);
  status.setAttribute("role", "status");
  status.ariaLive = "polite";
  const warning = label(node("p", "reader-warning", notices), "storageIssue");
  warning.hidden = true;
  const library = node("section", "reader-library", main);
  const librarySidebar = node("aside", "reader-library-sidebar", library);
  librarySidebar.id = "readerLibrarySidebar";
  label(node("h3", "reader-sidebar-brand", librarySidebar), "shelf");
  button(librarySidebar, "cancel", () => setSidebar(false)).classList.add(
    "reader-icon-button",
    "reader-drawer-close",
  );
  const libraryNav = node("nav", "reader-library-nav", librarySidebar);
  libraryNav.ariaLabel = t("shelf");
  const filter = { value: "all" },
    groupFilter = { value: "" };
  const categoryButtons = new Map();
  for (const key of [
    "all",
    "recent",
    "favorites",
    "unread",
    "reading",
    "finished",
  ]) {
    const b = button(libraryNav, key, () => selectCategory(key));
    b.classList.add("reader-nav-button");
    b.dataset.category = key;
    const count = node("span", "reader-nav-count", b);
    categoryButtons.set(key, { b, count });
  }
  const groupHeader = node("div", "reader-group-heading", librarySidebar);
  label(node("h4", "", groupHeader), "groups");
  button(
    groupHeader,
    "newGroup",
    async () => {
      const value = await ask("newGroup");
      if (value !== null) controller.group(value);
    },
    "readerNewGroup",
  ).classList.add("reader-icon-button");
  const groupNav = node("nav", "reader-group-nav", librarySidebar);
  const removeGroup = button(librarySidebar, "deleteGroup", () => {
    if (groupFilter.value) {
      const name = groupFilter.value;
      groupFilter.value = "";
      controller.removeGroup(name);
    }
  });
  const libraryFooter = node("div", "reader-library-footer", librarySidebar);
  button(
    libraryFooter,
    "stats",
    () => {
      showPanel("stats");
      if (narrow()) setSidebar(false);
    },
    "readerStats",
  ).classList.add("reader-nav-button");
  const sourceBar = node("details", "reader-source-bar", libraryFooter);
  label(node("summary", "", sourceBar), "folder");
  const directory = node("p", "reader-directory", sourceBar);
  button(sourceBar, "choose", choose, "readerChoose");
  const reconnectButton = button(
    sourceBar,
    "reconnect",
    async () => {
      if (!(await controller.reconnect())) await choose();
    },
    "readerReconnect",
  );
  button(
    sourceBar,
    "refresh",
    async () => {
      if (!(await controller.refresh())) await choose();
    },
    "readerRefresh",
  );
  const cancelScan = button(
    notices,
    "cancel",
    () => controller.cancelScan(),
    "readerCancelScan",
  );
  const backupMenu = node("details", "reader-backup-menu", libraryFooter);
  label(node("summary", "", backupMenu), "backup");
  button(
    backupMenu,
    "export",
    () =>
      download(
        "reading-backup-" + Date.now() + ".json",
        JSON.stringify(controller.backup(), null, 2),
        "application/json",
      ),
    "readerExport",
  );
  button(backupMenu, "restore", () => backupInput.click(), "readerRestore");
  button(backupMenu, "exportNotes", exportNotes);
  const libraryMain = node("div", "reader-library-main", library);
  const libraryHeader = node("div", "reader-library-header", libraryMain);
  const libraryIntro = node("div", "", libraryHeader);
  label(node("p", "reader-eyebrow", libraryIntro), "title");
  const categoryTitle = node("h3", "", libraryIntro),
    bookCount = node("p", "reader-book-count", libraryIntro);
  const continueButton = button(
    libraryHeader,
    "continue",
    () => {
      const snap = controller.snapshot();
      const book = Object.values(snap.state.books)
        .filter((b) => snap.entries.has(b.id))
        .sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0))[0];
      if (book) return open(book.id);
    },
    "readerContinue",
  );
  const filters = node("div", "reader-filters", libraryMain);
  const shelfQuery = field(filters, "searchBooks", "search");
  shelfQuery.id = "readerBookSearch";
  shelfQuery.placeholder = t("searchBooks");
  bindings.push(() => (shelfQuery.placeholder = t("searchBooks")));
  shelfQuery.oninput = () => {
    shelfSignature = "";
    libraryScroll.scrollTop = 0;
    render();
  };
  const sort = select(
    filters,
    "sort",
    ["recent", "name", "author", "progress"].map((x) => [x, x]),
    (value) => controller.settings({ sort: value }),
  );
  const view = select(
    filters,
    "view",
    [
      ["covers", "covers"],
      ["list", "list"],
    ],
    (value) => controller.settings({ view: value }),
  );
  const libraryScroll = node("div", "reader-library-content", libraryMain);
  const shelf = node("div", "reader-books", libraryScroll);
  shelf.id = "readerBooks";
  const emptyAction = button(
    libraryScroll,
    "choose",
    choose,
    "readerEmptyChoose",
  );
  const standalonePanel = node(
    "section",
    "reader-standalone-panel",
    libraryScroll,
  );
  standalonePanel.hidden = true;
  const desk = node("section", "reader-desk", main);
  desk.hidden = true;
  const body = node("div", "reader-body", desk);
  const panel = node("aside", "reader-side-panel", body);
  panel.id = "readerToolSidebar";
  const toolbar = node("nav", "reader-tool-nav", panel);
  for (const key of [
    "toc",
    "search",
    "bookmarks",
    "notes",
    "thumbnails",
    "settings",
  ]) {
    const b = button(toolbar, key, () => showPanel(key), "reader-" + key);
    b.setAttribute("aria-controls", "readerPanelContent");
  }
  const panelHeader = node("div", "reader-panel-header", panel),
    panelTitle = node("h3", "", panelHeader);
  button(panelHeader, "cancel", () => setSidebar(false)).classList.add(
    "reader-icon-button",
  );
  const panelContent = node("div", "reader-panel-content", panel);
  panelContent.id = "readerPanelContent";
  const readingMain = node("div", "reader-reading-main", body);
  const viewport = node("div", "reader-viewport", readingMain);
  viewport.id = "readerViewport";
  viewport.tabIndex = 0;
  viewport.ariaLabel = t("title");
  const selectionBar = node("div", "reader-selection", readingMain);
  selectionBar.hidden = true;
  selectionBar.setAttribute("role", "group");
  const selectedText = node("span", "reader-selection-text", selectionBar);
  const highlightColor = field(selectionBar, "color", "color");
  highlightColor.value = "#ffe08a";
  button(
    selectionBar,
    "highlight",
    () => controller.annotate(highlightColor.value, ""),
    "readerHighlight",
  ).classList.add("reader-icon-button");
  button(selectionBar, "note", async () => {
    const value = await ask("note");
    if (value !== null) await controller.annotate(highlightColor.value, value);
  }).classList.add("reader-icon-button");
  button(selectionBar, "copy", async () => {
    try {
      await navigator.clipboard.writeText(controller.snapshot().selection.text);
    } catch {
      localStatus = t("copyFailed");
      render();
    }
  }).classList.add("reader-icon-button");
  button(selectionBar, "cancel", () =>
    controller.clearSelection(),
  ).classList.add("reader-icon-button");
  const navigation = node("div", "reader-navigation", readingMain);
  const backButton = button(navigation, "back", () => controller.back());
  backButton.classList.add("reader-icon-button");
  button(
    navigation,
    "previous",
    () => controller.next(-1),
    "readerPrevious",
  ).classList.add("reader-icon-button");
  const progress = field(navigation, "progress", "range");
  progress.min = "0";
  progress.max = "1000";
  progress.step = "1";
  progress.onchange = () => controller.go(Number(progress.value) / 1000);
  const percent = node("output", "reader-percent", navigation);
  button(
    navigation,
    "next",
    () => controller.next(1),
    "readerNext",
  ).classList.add("reader-icon-button");
  const pageInput = field(navigation, "page", "number");
  pageInput.min = "1";
  pageInput.onchange = () => controller.go({ page: Number(pageInput.value) });
  const drawerBackdrop = node("button", "reader-drawer-backdrop", main);
  drawerBackdrop.type = "button";
  drawerBackdrop.tabIndex = -1;
  drawerBackdrop.ariaLabel = t("cancel");
  drawerBackdrop.onclick = () => setSidebar(false);
  const miniHost = document.getElementById("readerPanel");
  const mini = node("div", "reader-mini", miniHost);
  const miniHeader = node("header", "reader-mini-header", mini);
  const miniTitle = node("h3", "reader-mini-title", miniHeader);
  button(miniHeader, "expand", expand, "readerMiniExpand").classList.add(
    "reader-icon-button",
  );
  const miniViewport = node(
    "div",
    "reader-viewport reader-mini-viewport",
    mini,
  );
  miniViewport.id = "readerMiniViewport";
  miniViewport.tabIndex = 0;
  const miniEmpty = label(node("p", "reader-mini-empty", mini), "miniEmpty");
  const miniNavigation = node("div", "reader-mini-navigation", mini);
  const miniPrevious = button(
    miniNavigation,
    "previous",
    () => controller.next(-1),
    "readerMiniPrevious",
  );
  miniPrevious.classList.add("reader-icon-button");
  const miniProgress = field(miniNavigation, "progress", "range");
  miniProgress.id = "readerMiniProgress";
  miniProgress.min = "0";
  miniProgress.max = "1000";
  miniProgress.step = "1";
  miniProgress.onchange = () =>
    controller.go(Number(miniProgress.value) / 1000, false);
  const miniPercent = node("output", "reader-mini-percent", miniNavigation);
  const miniNext = button(
    miniNavigation,
    "next",
    () => controller.next(1),
    "readerMiniNext",
  );
  miniNext.classList.add("reader-icon-button");
  const miniStatus = node("p", "reader-mini-status", mini);
  miniStatus.setAttribute("role", "status");
  const input = node("input", "", shell);
  input.type = "file";
  input.multiple = true;
  input.hidden = true;
  if ("webkitdirectory" in input) input.webkitdirectory = true;
  input.accept = input.webkitdirectory ? "" : ".epub,.txt,.pdf";
  input.onchange = () => {
    controller.importFiles(input.files);
    input.value = "";
  };
  const backupInput = node("input", "", shell);
  backupInput.type = "file";
  backupInput.accept = ".json,application/json";
  backupInput.hidden = true;
  backupInput.onchange = async () => {
    const file = backupInput.files[0];
    backupInput.value = "";
    if (!file) return;
    try {
      if (file.size > 32 * 1024 * 1024) throw Error();
      await controller.restore(JSON.parse(await file.text()));
    } catch {
      localStatus = t("restoreFailed");
      render();
    }
  };
  document.querySelector(".workspace").append(shell);
  let panelName = "",
    panelSignature = "",
    shelfSignature = "",
    localStatus = "",
    lastLanguage = "",
    searchToken = 0,
    thumbnailToken = 0;
  let thumbnailObserver;
  let presentation = "full",
    presentationIssue = false,
    pendingMini = null,
    presentationRevision = 0,
    mounting = false;
  let presentationWrites = Promise.resolve();
  const presentationReady = WorkTimeApp.services.readerStorage
    .readPresentation()
    .then((value) => {
      presentation = value === "mini" ? "mini" : "full";
    })
    .catch(() => {
      presentationIssue = true;
    });
  function rememberPresentation(value) {
    if (presentation === value) return;
    presentation = value;
    presentationWrites = presentationWrites
      .catch(() => {})
      .then(() => WorkTimeApp.services.readerStorage.writePresentation(value))
      .catch(() => {
        presentationIssue = true;
        render();
      });
  }
  function miniVisible() {
    const rect = miniViewport.getBoundingClientRect();
    return (
      presentation === "mini" &&
      shell.hidden &&
      !miniHost.hidden &&
      !miniHost.closest("[inert]") &&
      !document.querySelector("dialog:modal") &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth
    );
  }
  function syncActivity() {
    controller.setActive(
      !mounting &&
        !document.hidden &&
        ((shell.dataset.state === "open" && presentation === "full") ||
          miniVisible()),
    );
  }
  function renderEntry() {
    const entry = document.getElementById("readerOpen");
    if (!entry) return;
    entry.title = entry.ariaLabel = t("title");
    if (presentation === "mini") {
      entry.setAttribute("role", "tab");
      entry.removeAttribute("aria-haspopup");
      entry.setAttribute("aria-controls", "readerPanel");
      entry.setAttribute("aria-selected", String(!miniHost.hidden));
      entry.tabIndex = miniHost.hidden ? -1 : 0;
      if (!document.querySelector(".agenda-mode"))
        entry.removeAttribute("aria-expanded");
    } else {
      entry.removeAttribute("role");
      entry.removeAttribute("aria-selected");
      entry.setAttribute("aria-haspopup", "dialog");
      entry.setAttribute("aria-controls", "readerDialog");
      entry.setAttribute("aria-expanded", String(expansion.isOpen));
    }
  }
  function renderMini(snap) {
    miniViewport.setAttribute("aria-busy", String(mounting || snap.loading));
    const recent =
      snap.current ||
      Object.values(snap.state.books).sort(
        (a, b) => (b.lastRead || 0) - (a.lastRead || 0),
      )[0];
    miniTitle.textContent = recent?.title || t("title");
    miniTitle.title = miniTitle.textContent;
    miniEmpty.hidden = !!snap.current || snap.loading || mounting;
    miniViewport.hidden = !snap.current && !snap.loading && !mounting;
    const disabled = !snap.current || !snap.adapter || snap.loading || mounting;
    for (const element of [miniPrevious, miniNext, miniProgress])
      element.disabled = disabled;
    if (document.activeElement !== miniProgress)
      miniProgress.value = Math.round((recent?.progress || 0) * 1000);
    miniPercent.textContent = Math.round((recent?.progress || 0) * 100) + "%";
    miniStatus.textContent =
      snap.storageIssue || presentationIssue
        ? t("storageIssue")
        : mounting || snap.loading
          ? t("opening")
          : snap.message && snap.message !== "chooseHint" && snap.current
            ? t(snap.message)
            : "";
    miniStatus.hidden = !miniStatus.textContent;
    const [bg, fg] = WorkTimeApp.services.readerAdapters.colors(snap.settings);
    miniViewport.style.backgroundColor = bg;
    miniViewport.style.color = fg;
    miniViewport.ariaLabel = t("title");
    syncActivity();
  }
  async function activateMini(revision) {
    if (revision !== presentationRevision || presentation !== "mini") return;
    mounting = !!controller.snapshot().current;
    WorkTimeApp.ui.dateInfo.showReaderPanel();
    render();
    await controller.remount(miniViewport, { mini: true });
    if (revision !== presentationRevision) return;
    mounting = false;
    render();
    const bounds = miniHost.getBoundingClientRect();
    if (!miniHost.hidden && (bounds.top >= innerHeight || bounds.bottom <= 0))
      miniHost.scrollIntoView({ block: "nearest", behavior: "instant" });
    if (
      !miniHost.hidden &&
      !miniHost.closest("[inert]") &&
      miniHost.getClientRects().length
    )
      (controller.snapshot().current
        ? miniViewport
        : document.getElementById("readerMiniExpand")
      ).focus({ preventScroll: true });
  }
  async function minimize() {
    if (controller.snapshot().loading || mounting) return;
    const revision = ++presentationRevision;
    pendingMini = revision;
    rememberPresentation("mini");
    const closed = await close();
    if (revision !== presentationRevision) return;
    if (!closed) {
      pendingMini = null;
      rememberPresentation("full");
      render();
      return;
    }
    if (!expansion.isOpen && pendingMini === revision) {
      pendingMini = null;
      await activateMini(revision);
    }
  }
  async function expand() {
    const revision = ++presentationRevision;
    pendingMini = null;
    ++closeRevision;
    await presentationReady;
    await WorkTimeApp.services.assets.style("assets/css/reader.css");
    await controller.ready;
    if (revision !== presentationRevision) return;
    desktopSidebar = controller.snapshot().settings.sidebarOpen !== false;
    mounting = !!controller.snapshot().current;
    expansion.open();
    if (!expansion.isOpen) {
      mounting = false;
      render();
      return;
    }
    rememberPresentation("full");
    WorkTimeApp.ui.dateInfo.hideReaderPanel();
    render();
    await controller.remount(viewport, { mini: false });
    if (revision !== presentationRevision) return;
    mounting = false;
    render();
  }
  let desktopSidebar = true,
    drawerOpen = false,
    shelfScroll = 0,
    groupSignature = "",
    closeRevision = 0;
  const mobile = matchMedia("(max-width: 700px)");
  const narrow = () => mobile.matches;
  const isReading = () => {
    const snap = controller.snapshot();
    return !!snap.current || snap.loading;
  };
  const sidebarVisible = () =>
    narrow() ? drawerOpen : isReading() ? desktopSidebar : true;
  function setSidebar(value) {
    if (narrow()) drawerOpen = value;
    else {
      desktopSidebar = value;
      void controller.settings({ sidebarOpen: value });
    }
    const active = isReading() ? panel : librarySidebar;
    if (!value && active.contains(document.activeElement))
      sidebarToggle.focus({ preventScroll: true });
    render();
    if (value && narrow())
      (
        active.querySelector('[aria-pressed="true"]') ||
        active.querySelector("button")
      )?.focus({ preventScroll: true });
  }
  function selectCategory(key, group = "") {
    filter.value = key;
    groupFilter.value = group;
    panelName = "";
    panelSignature = "";
    shelfSignature = "";
    libraryScroll.scrollTop = 0;
    render();
    if (narrow()) setSidebar(false);
  }
  async function returnToShelf() {
    bookActions.open = false;
    drawerOpen = false;
    panelName = "";
    panelSignature = "";
    await controller.closeBook();
    libraryScroll.scrollTop = shelfScroll;
    requestAnimationFrame(() => (libraryScroll.scrollTop = shelfScroll));
  }
  async function navigate(location) {
    await controller.go(location);
    if (narrow()) {
      setSidebar(false);
      viewport.focus({ preventScroll: true });
    }
  }
  async function close() {
    const revision = ++closeRevision;
    void controller.flush();
    if (document.fullscreenElement === shell) {
      try {
        await document.exitFullscreen();
        await new Promise((resolve) => {
          let previous = "",
            stable = 0,
            frames = 0;
          function frame() {
            const r = shell.getBoundingClientRect(),
              current = [r.x, r.y, r.width, r.height].join(":");
            stable = current === previous ? stable + 1 : 0;
            previous = current;
            if (++frames >= 12 || stable >= 2) resolve();
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });
      } catch {
        localStatus = t("fullscreenFailed");
        render();
        return false;
      }
    }
    if (revision === closeRevision) expansion.close();
    return revision === closeRevision;
  }
  let dialogPending = null;
  async function ask(key, initial = "", type = "text") {
    if (dialogPending) dialogPending(null);
    return new Promise((resolve) => {
      const modal = node("dialog", "reader-prompt", shell),
        form = node("form", "", modal);
      form.method = "dialog";
      const heading = node("h3", "", form, t(key));
      const value = node(type === "text" ? "textarea" : "input", "", form);
      value.value = initial;
      value.maxLength = key === "newGroup" ? 100 : 20000;
      value.ariaLabel = heading.textContent;
      if (type !== "text") value.type = type;
      const actions = node("div", "reader-prompt-actions", form);
      const done = (answer) => {
        dialogPending = null;
        modal.close();
        modal.remove();
        resolve(answer);
      };
      const no = node("button", "reader-button", actions, t("cancel"));
      no.type = "button";
      no.onclick = () => done(null);
      const yes = node("button", "reader-button", actions, t("save"));
      yes.type = "submit";
      form.onsubmit = (event) => {
        event.preventDefault();
        done(value.value);
      };
      modal.oncancel = (event) => {
        event.preventDefault();
        done(null);
      };
      dialogPending = done;
      modal.showModal();
      value.focus();
    });
  }
  const password = (reason) =>
    ask(reason === 2 ? "passwordWrong" : "password", "", "password");
  async function choose() {
    localStatus = "";
    if (!(await controller.choose())) input.click();
  }
  async function open(id) {
    thumbnailObserver?.disconnect();
    shelfScroll = libraryScroll.scrollTop;
    panelName = "toc";
    panelSignature = "";
    desktopSidebar = controller.snapshot().settings.sidebarOpen !== false;
    drawerOpen = false;
    localStatus = "";
    desk.hidden = false;
    library.hidden = true;
    await controller.open(id, viewport, password);
    render();
    viewport.focus({ preventScroll: true });
  }
  function chapter(direction) {
    const snap = controller.snapshot(),
      toc = snap.adapter?.toc || [];
    if (!toc.length) return;
    const pos = snap.adapter.position();
    let index = 0;
    if (pos.offset !== undefined)
      index = toc.findLastIndex((x) => x.location.offset <= pos.offset);
    else if (pos.page !== undefined)
      index = toc.findLastIndex((x) => x.location.page <= pos.page);
    else if (pos.spineIndex !== undefined) {
      index = toc.findLastIndex((x) => x.location.spineIndex <= pos.spineIndex);
    } else if (pos.cfi) {
      try {
        const parser = window.WorkTimeReaderEPUB.ePub.CFI;
        if (parser)
          index = toc.findLastIndex(
            (x) =>
              x.location.cfi &&
              new parser().compare(x.location.cfi, pos.cfi) <= 0,
          );
        else
          index = toc.findIndex(
            (x) => x.location.href?.split("#")[0] === snap.adapter.href,
          );
      } catch {
        index = 0;
      }
    }
    const target =
      toc[Math.max(0, Math.min(toc.length - 1, index + direction))];
    if (target) void controller.go(target.location);
  }
  function showPanel(name) {
    if (!name) {
      setSidebar(false);
      return;
    }
    thumbnailObserver?.disconnect();
    panelName = name;
    panelSignature = "";
    ++searchToken;
    ++thumbnailToken;
    controller.cancelSearch();
    if (controller.snapshot().current) {
      if (narrow()) drawerOpen = true;
      else desktopSidebar = true;
    }
    render();
  }
  function renderNavigation(snap) {
    const books = Object.values(snap.state.books);
    for (const [key, { b, count }] of categoryButtons) {
      count.textContent = books.filter(
        (book) =>
          key === "all" ||
          (key === "recent" && book.lastRead) ||
          (key === "favorites" && book.favorite) ||
          book.status === key,
      ).length;
      b.setAttribute(
        "aria-pressed",
        String(
          panelName !== "stats" && !groupFilter.value && filter.value === key,
        ),
      );
    }
    document
      .getElementById("readerStats")
      .setAttribute("aria-pressed", String(panelName === "stats"));
    const signature = JSON.stringify([
      snap.state.groups,
      books.map((b) => b.group),
      groupFilter.value,
      WorkTimeApp.i18n.language,
    ]);
    if (groupSignature !== signature) {
      groupSignature = signature;
      groupNav.replaceChildren();
      for (const group of snap.state.groups) {
        const b = button(groupNav, "groups", () =>
          selectCategory("all", group),
        );
        b.querySelector(".reader-button-label").textContent = group;
        b.title = b.ariaLabel = group;
        b.classList.add("reader-nav-button");
        b.setAttribute("aria-pressed", String(groupFilter.value === group));
        node(
          "span",
          "reader-nav-count",
          b,
          books.filter((book) => book.group === group).length,
        );
      }
    }
    removeGroup.hidden = !groupFilter.value;
    categoryTitle.textContent =
      panelName === "stats"
        ? t("stats")
        : groupFilter.value ||
          t(filter.value === "all" ? "shelf" : filter.value);
    standalonePanel.hidden = panelName !== "stats";
    shelf.hidden = filters.hidden = panelName === "stats";
    emptyAction.hidden = panelName === "stats" || books.length > 0;
  }
  function groupOptions(e, state, includeAll) {
    const value = e.value;
    e.replaceChildren();
    const first = node("option", "", e, t(includeAll ? "all" : "ungrouped"));
    first.value = "";
    for (const name of state.groups) {
      const option = node("option", "", e, name);
      option.value = name;
    }
    e.value = value;
  }
  function renderShelf(snap) {
    const signature = JSON.stringify([
      Object.values(snap.state.books).map((b) => [
        b.id,
        b.title,
        b.author,
        b.progress,
        b.favorite,
        b.group,
        b.status,
        b.lastRead,
      ]),
      snap.state.groups,
      snap.entries.size,
      [...snap.covers.keys()],
      shelfQuery.value,
      filter.value,
      groupFilter.value,
      snap.settings.view,
      snap.settings.sort,
      WorkTimeApp.i18n.language,
    ]);
    if (signature === shelfSignature) return;
    const active = document.activeElement,
      focusedBook = active?.closest(".reader-book"),
      focusedId = focusedBook?.dataset.bookId;
    const focusedControl = focusedBook
      ? [...focusedBook.querySelectorAll("button,select")].indexOf(active)
      : -1;
    const focusedMenu = active?.closest(".reader-card-more");
    shelfSignature = signature;
    shelf.replaceChildren();
    shelf.dataset.view = snap.settings.view;

    const query = shelfQuery.value.trim().toLocaleLowerCase();
    const books = Object.values(snap.state.books).filter(
      (b) =>
        (!query ||
          (b.title + " " + b.author).toLocaleLowerCase().includes(query)) &&
        (filter.value === "all" ||
          (filter.value === "recent" && b.lastRead) ||
          (filter.value === "favorites" && b.favorite) ||
          b.status === filter.value) &&
        (!groupFilter.value || b.group === groupFilter.value),
    );
    books.sort((a, b) =>
      snap.settings.sort === "name"
        ? a.title.localeCompare(b.title)
        : snap.settings.sort === "author"
          ? a.author.localeCompare(b.author)
          : snap.settings.sort === "progress"
            ? b.progress - a.progress
            : (b.lastRead || 0) - (a.lastRead || 0),
    );
    bookCount.textContent = t("bookCount").replace("{n}", books.length);
    if (!books.length)
      node(
        "p",
        "reader-empty",
        shelf,
        t(Object.keys(snap.state.books).length ? "noResults" : "chooseHint"),
      );
    for (const book of books) {
      const card = node("article", "reader-book", shelf);
      card.dataset.bookId = book.id;
      const coverButton = node("button", "reader-book-open", card);
      coverButton.type = "button";
      coverButton.ariaLabel = book.title;
      coverButton.onclick = () => void open(book.id);
      const cover = node("div", "reader-cover", coverButton);
      cover.style.setProperty(
        "--book-hue",
        String(parseInt(book.id.slice(0, 4), 16) % 360),
      );
      const url = snap.covers.get(book.id);
      if (url) {
        const image = node("img", "", cover);
        image.src = url;
        image.alt = book.title;
        image.loading = "lazy";
      } else {
        node("span", "reader-cover-format", cover, book.format.toUpperCase());
        node("strong", "", cover, book.title);
        node("span", "reader-cover-author", cover, book.author);
      }
      const info = node("div", "reader-book-info", coverButton);
      node("h4", "", info, book.title);
      node("p", "", info, book.author || book.format.toUpperCase());
      const meter = node("progress", "", info);
      meter.max = 1;
      meter.value = book.progress || 0;
      meter.ariaLabel = t("progress");
      node(
        "small",
        "",
        info,
        t(book.status) +
          " · " +
          Math.round((book.progress || 0) * 100) +
          "%" +
          (snap.entries.has(book.id) ? "" : " · " + t("unavailable")),
      );
      const tools = node("div", "reader-book-tools", card);
      const favorite = node(
        "button",
        "reader-button reader-heart",
        tools,
        book.favorite ? "♥" : "♡",
      );
      favorite.type = "button";
      favorite.ariaLabel = t("favorite");
      favorite.setAttribute("aria-pressed", String(!!book.favorite));
      favorite.onclick = () =>
        controller.updateBook(book.id, { favorite: !book.favorite });
      const more = node("details", "reader-card-more", tools);
      const summary = label(node("summary", "reader-more", more), "more");
      summary.ariaLabel = t("more");
      summary.title = t("more");
      const menu = node("div", "reader-menu", more);
      const groupLabel = node("label", "reader-field", menu);
      label(node("span", "", groupLabel), "groups");
      const group = node("select", "", groupLabel);
      group.ariaLabel = t("groups");
      groupOptions(group, snap.state, false);
      group.value = book.group || "";
      group.onchange = () =>
        controller.updateBook(book.id, { group: group.value });
      const stateLabel = node("label", "reader-field", menu);
      label(node("span", "", stateLabel), "progress");
      const state = node("select", "", stateLabel);
      state.ariaLabel = t("progress");
      for (const key of ["unread", "reading", "finished"]) {
        const option = node("option", "", state, t(key));
        option.value = key;
      }
      state.value = book.status;
      state.onchange = () =>
        controller.updateBook(book.id, { status: state.value });
    }
    if (focusedId) {
      const nextCard = shelf.querySelector(`[data-book-id="${focusedId}"]`);
      if (focusedMenu && nextCard)
        nextCard.querySelector("details").open = true;
      if (focusedControl >= 0)
        nextCard
          ?.querySelectorAll("button,select")
          [focusedControl]?.focus({ preventScroll: true });
      else if (focusedMenu)
        nextCard?.querySelector("summary")?.focus({ preventScroll: true });
      if (!nextCard) shelfQuery.focus({ preventScroll: true });
    }
  }
  function settingUI(snap, parent) {
    const s = snap.settings,
      reflow = snap.adapter?.capabilities.reflow;
    const set = (key, options) => {
      const e = select(parent, key, options, (value) =>
        controller.settings({ [key]: value }),
      );
      e.value = s[key];
      return e;
    };
    set("flow", [
      ["pages", "pages"],
      ["scroll", "scroll"],
    ]);
    set(
      "theme",
      ["light", "sepia", "dark", "custom"].map((x) => [x, x]),
    );
    for (const key of ["background", "foreground"]) {
      const e = field(parent, key, "color");
      e.value = /^#[a-f\d]{6}$/i.test(s[key]) ? s[key] : "#ffffff";
      e.onchange = () =>
        controller.settings({ [key]: e.value, theme: "custom" });
    }
    if (reflow) {
      set(
        "font",
        ["serif", "sans", "mono"].map((x) => [x, x]),
      );
      set("spread", [
        ["single", "single"],
        ["double", "double"],
      ]);
      for (const [key, min, max, step] of [
        ["fontSize", 12, 48, 1],
        ["lineHeight", 1.2, 3, 0.1],
        ["paragraph", 0, 40, 2],
        ["margin", 8, 100, 4],
        ["width", 360, 1400, 40],
      ]) {
        const e = field(parent, key, "number");
        e.min = min;
        e.max = max;
        e.step = step;
        e.value = s[key];
        e.onchange = () => {
          if (e.checkValidity())
            void controller.settings({ [key]: Number(e.value) });
        };
      }
    }
    if (snap.adapter?.capabilities.encoding) {
      const e = select(
        parent,
        "encoding",
        [
          ["auto", "auto"],
          ["utf-8", "=UTF-8"],
          ["utf-16le", "=UTF-16 LE"],
          ["utf-16be", "=UTF-16 BE"],
          ["gb18030", "=GB18030"],
        ],
        (value) => controller.encoding(value, viewport, password),
      );
      e.value = snap.current.encoding || "auto";
    }
    if (snap.adapter?.capabilities.pdf) {
      set("zoom", [
        ["width", "fitWidth"],
        ["page", "fitPage"],
        ["0.5", "=50%"],
        ["1", "=100%"],
        ["1.5", "=150%"],
        ["2", "=200%"],
        ["3", "=300%"],
      ]);
      button(parent, "rotate", () =>
        controller.settings({
          rotation: (controller.snapshot().settings.rotation + 90) % 360,
        }),
      );
    }
  }
  function dynamicButton(parent, text, action) {
    const b = node("button", "reader-button reader-result", parent, text);
    b.type = "button";
    b.onclick = () => void action();
    return b;
  }
  function stats(parent, state) {
    const entries = Object.entries(state.daily).sort(([a], [b]) =>
        b.localeCompare(a),
      ),
      seconds = entries.reduce((sum, [, value]) => sum + value, 0);
    let streak = 0;
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    const key = () =>
      `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    if (!state.daily[key()]) day.setDate(day.getDate() - 1);
    while (state.daily[key()]) {
      streak++;
      day.setDate(day.getDate() - 1);
    }
    node("h3", "", parent, t("stats"));
    node(
      "p",
      "reader-stat-total",
      parent,
      `${Math.floor(seconds / 60)} ${t("minutes")} · ${streak} ${t("days")} · ${Object.values(state.books).filter((b) => b.status === "finished").length} ${t("finished")}`,
    );
    for (const [date, value] of entries)
      node(
        "p",
        "reader-stat-day",
        parent,
        date + " · " + Math.floor(value / 60) + " " + t("minutes"),
      );
  }
  function renderPanel(snap) {
    if (shell.hidden || shell.dataset.state === "closing") return;
    if (!snap.current || panelName !== "thumbnails")
      thumbnailObserver?.disconnect();

    standalonePanel.hidden = panelName !== "stats" || !!snap.current;
    if (!panelName) return;
    const signature = JSON.stringify([
      panelName,
      snap.current?.id,
      snap.current?.annotations,
      snap.current?.bookmarks,
      panelName === "stats" ? snap.state.daily : null,
      WorkTimeApp.i18n.language,
    ]);
    if (signature === panelSignature) return;
    panelSignature = signature;
    panelContent.replaceChildren();
    standalonePanel.replaceChildren();
    panelTitle.textContent = t(panelName);
    const parent = snap.current ? panelContent : standalonePanel;
    if (panelName === "stats") {
      stats(parent, snap.state);
      return;
    }
    if (!snap.current) return;
    if (panelName === "settings") settingUI(snap, parent);
    if (panelName === "toc") {
      const chapterNav = node("div", "reader-chapter-nav", parent);
      button(chapterNav, "previousChapter", () => chapter(-1)).classList.add(
        "reader-icon-button",
      );
      button(chapterNav, "nextChapter", () => chapter(1)).classList.add(
        "reader-icon-button",
      );
      if (!snap.adapter.toc.length)
        node("p", "reader-empty", parent, t("noResults"));
      for (const entry of snap.adapter.toc)
        dynamicButton(parent, entry.label, () => navigate(entry.location));
    }
    if (panelName === "bookmarks" || panelName === "notes") {
      const key = panelName === "notes" ? "annotations" : "bookmarks",
        items = snap.current[key];
      if (!items.length) node("p", "reader-empty", parent, t("noResults"));
      for (const item of items) {
        const row = node("div", "reader-note", parent);
        if (item.color) row.style.borderLeftColor = item.color;
        dynamicButton(row, item.text, () => navigate(item.location));
        if (item.note) node("p", "", row, item.note);
        if (key === "annotations")
          button(row, "edit", async () => {
            const value = await ask("note", item.note || "");
            if (value !== null) await controller.editAnnotation(item.id, value);
          });
        button(row, "remove", () => controller.removeItem(key, item.id));
      }
      button(parent, "exportNotes", exportNotes);
    }
    if (panelName === "search") {
      const query = field(parent, "search", "search"),
        results = node("div", "reader-search-results", parent);
      query.id = "readerFulltextSearch";
      const cancel = button(parent, "cancel", () => {
        ++searchToken;
        controller.cancelSearch();
      });
      const run = async () => {
        const token = ++searchToken;
        results.replaceChildren();
        if (!query.value.trim()) {
          controller.cancelSearch();
          return;
        }
        node("p", "", results, t("searching"));
        cancel.disabled = false;
        const matches = await controller.search(query.value);
        if (token !== searchToken || !matches || !query.isConnected) return;
        results.replaceChildren();
        cancel.disabled = true;
        if (!matches.length) node("p", "", results, t("noResults"));
        if (matches.length >= 1000) node("p", "", results, t("searchLimit"));
        for (const result of matches)
          dynamicButton(results, result.label, () => navigate(result.location));
      };
      let debounce;
      query.oninput = () => {
        clearTimeout(debounce);
        controller.cancelSearch();
        debounce = setTimeout(run, 300);
      };
      query.onkeydown = (e) => {
        if (e.key === "Enter") {
          clearTimeout(debounce);
          void run();
        }
      };
      query.focus();
    }
    if (panelName === "thumbnails" && snap.adapter.capabilities.pdf) {
      const token = ++thumbnailToken;
      thumbnailObserver?.disconnect();
      const observer = (thumbnailObserver = new IntersectionObserver(
        async (items) => {
          for (const item of items)
            if (item.isIntersecting) {
              observer.unobserve(item.target);
              if (token !== thumbnailToken) {
                observer.disconnect();
                return;
              }
              try {
                const src = await snap.adapter.thumbnail(
                  Number(item.target.dataset.page),
                );
                if (token !== thumbnailToken) return;
                const image = node("img", "", item.target);
                image.src = src;
                image.alt = item.target.ariaLabel;
              } catch {
                /* Page remains navigable without a preview. */
              }
            }
        },
        { root: panelContent },
      ));
      for (let n = 1; n <= snap.adapter.total; n++) {
        const b = dynamicButton(parent, String(n), () => navigate({ page: n }));
        b.classList.add("reader-thumbnail");
        b.dataset.page = n;
        b.ariaLabel = t("page") + " " + n;
        observer.observe(b);
      }
    }
  }
  function exportNotes() {
    const snap = controller.snapshot(),
      books = snap.current ? [snap.current] : Object.values(snap.state.books);
    const escape = (value) =>
      String(value || "").replace(/[\\`*_{}[\]<>#]/g, "\\$&");
    const content = books
      .map(
        (b) =>
          "# " +
          escape(b.title) +
          "\n\n" +
          b.annotations
            .map(
              (a) =>
                "> " +
                escape(a.text).replace(/\n/g, "\n> ") +
                "\n\n" +
                escape(a.note) +
                "\n\n",
            )
            .join(""),
      )
      .join("\n");
    download("reading-notes.md", content, "text/markdown;charset=utf-8");
  }
  function render() {
    const snap = controller.snapshot(),
      reading = !!snap.current || snap.loading;
    renderEntry();
    renderMini(snap);
    minimizeButton.disabled = snap.loading || mounting;
    library.hidden = reading;
    desk.hidden = !reading;
    shelfButton.hidden = !reading;
    bookActions.hidden = !snap.current;
    const visible = sidebarVisible();
    shell.dataset.sidebar = String(visible);
    librarySidebar.hidden = !visible;
    panel.hidden = !visible;
    sidebarToggle.hidden = !reading && !narrow();
    sidebarToggle.setAttribute("aria-expanded", String(visible));
    sidebarToggle.setAttribute(
      "aria-controls",
      reading ? panel.id : librarySidebar.id,
    );
    drawerBackdrop.hidden = !narrow() || !visible;
    libraryMain.inert = !reading && narrow() && visible;
    readingMain.inert = reading && narrow() && visible;
    for (const b of toolbar.querySelectorAll("button"))
      b.setAttribute("aria-pressed", String(b.id === "reader-" + panelName));
    title.textContent = t("title");
    bookTitle.textContent = snap.current?.title || "";
    status.textContent =
      localStatus ||
      (snap.message &&
      !(snap.message === "chooseHint" && !Object.keys(snap.state.books).length)
        ? t(snap.message) +
          (snap.scanning ? ` ${snap.count}/${snap.total}` : "")
        : "");
    status.hidden = !status.textContent;
    notices.hidden =
      !status.textContent && !snap.storageIssue && !snap.scanning;
    warning.hidden = !snap.storageIssue && !presentationIssue;
    cancelScan.hidden = !snap.scanning;
    reconnectButton.hidden = !Object.keys(snap.state.books).length;
    continueButton.disabled = !snap.entries.size;
    directory.textContent = snap.state.directory || "EPUB · TXT · PDF";
    sort.value = snap.settings.sort;
    view.value = snap.settings.view;
    if (!reading) {
      renderNavigation(snap);
      renderShelf(snap);
    }
    bookCount.hidden = panelName === "stats";
    backButton.disabled = !snap.canBack;
    addBookmark.disabled = !snap.current;
    markFinished.setAttribute(
      "aria-pressed",
      String(snap.current?.status === "finished"),
    );
    selectionBar.hidden = !snap.selection || !snap.current;
    selectedText.textContent = snap.selection?.text.slice(0, 80) || "";
    progress.disabled = !snap.current;
    if (document.activeElement !== progress)
      progress.value = Math.round((snap.current?.progress || 0) * 1000);
    percent.textContent = Math.round((snap.current?.progress || 0) * 100) + "%";
    pageInput.parentElement.hidden = !snap.adapter?.capabilities.pdf;
    if (snap.adapter?.capabilities.pdf) {
      pageInput.max = snap.adapter.total;
      if (document.activeElement !== pageInput)
        pageInput.value = snap.adapter.position().page;
    }
    document.getElementById("reader-thumbnails").hidden =
      !snap.adapter?.capabilities.pdf;
    const [bg, fg] = WorkTimeApp.services.readerAdapters.colors(snap.settings);
    viewport.style.backgroundColor = bg;
    viewport.style.color = fg;
    renderPanel(snap);
  }
  const expansion = WorkTimeApp.ui.createWorkspaceExpansion({
    shell,
    surface,
    toolbar: header,
    content: main,
    returnFocus: () => document.getElementById("readerOpen"),
    onChange() {
      if (!expansion.isOpen && pendingMini !== null) {
        const revision = pendingMini;
        pendingMini = null;
        void activateMini(revision);
      }
      if (shell.dataset.state === "closing" || !expansion.isOpen) {
        thumbnailObserver?.disconnect();
        ++thumbnailToken;
        ++searchToken;
        controller.cancelSearch();
        if (panelName === "thumbnails") panelSignature = "";
      }
      render();
    },
  });
  shell.addEventListener("pointerdown", () => controller.activity());
  shell.addEventListener("readeractivity", () => controller.activity());
  shell.addEventListener("wheel", () => controller.activity(), {
    passive: true,
  });
  for (const name of ["pointerdown", "readeractivity", "wheel"])
    mini.addEventListener(name, () => controller.activity(), { passive: true });
  mini.addEventListener("keydown", (event) => {
    controller.activity();
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.target.matches("input,button")
    )
      return;
    if (["ArrowRight", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      void controller.next(1);
    }
    if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      void controller.next(-1);
    }
  });
  shell.addEventListener("keydown", (e) => {
    controller.activity();
    if (e.target.closest?.("dialog")) return;
    if (narrow() && drawerOpen && e.key === "Tab") {
      const aside = isReading() ? panel : librarySidebar;
      const focusable = [
        ...aside.querySelectorAll("button,summary,input,select,textarea"),
      ].filter(
        (element) => !element.disabled && element.getClientRects().length,
      );
      const at = focusable.indexOf(document.activeElement);
      if (e.shiftKey ? at <= 0 : at < 0 || at === focusable.length - 1) {
        e.preventDefault();
        (e.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
        return;
      }
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "f" &&
      controller.snapshot().current
    ) {
      e.preventDefault();
      showPanel("search");
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      const details = [...shell.querySelectorAll("details[open]")];
      if (details.length) {
        details.forEach((d) => (d.open = false));
        return;
      }
      if (narrow() && drawerOpen) setSidebar(false);
      else if (controller.snapshot().selection) controller.clearSelection();
      else if (controller.snapshot().current || controller.snapshot().loading)
        void returnToShelf();
      else void close();
      return;
    }
    if (
      e.target.matches?.("input,textarea,select,button") ||
      e.ctrlKey ||
      e.metaKey
    )
      return;
    if (["ArrowRight", "PageDown", " "].includes(e.key)) {
      e.preventDefault();
      void controller.next(1);
    }
    if (["ArrowLeft", "PageUp"].includes(e.key)) {
      e.preventDefault();
      void controller.next(-1);
    }
  });
  let resizeTimer;
  const observer = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const snap = controller.snapshot();
      if (
        !mounting &&
        snap.adapter &&
        ((presentation === "full" && expansion.isOpen) || miniVisible())
      )
        void controller.resize();
      syncActivity();
    }, 180);
  });
  observer.observe(viewport);
  observer.observe(miniViewport);
  const visibility = new IntersectionObserver(() => syncActivity());
  visibility.observe(miniViewport);
  const covered = new MutationObserver(() => syncActivity());
  covered.observe(miniHost.closest(".editor"), {
    attributes: true,
    attributeFilter: ["inert", "class"],
  });
  document.addEventListener("focusin", () => syncActivity());
  mobile.addEventListener("change", () => {
    drawerOpen = false;
    render();
  });
  document.addEventListener("pointerdown", (event) => {
    for (const detail of shell.querySelectorAll(
      ".reader-card-more[open],.reader-book-actions[open]",
    ))
      if (!detail.contains(event.target)) detail.open = false;
  });
  document.addEventListener("visibilitychange", () => {
    syncActivity();
    if (document.hidden) void controller.flush();
  });
  window.addEventListener("pagehide", () => void controller.flush());
  registerBindings = false;
  controller.subscribe(render);
  return {
    get isMini() {
      return presentation === "mini";
    },
    async open() {
      await presentationReady;
      await WorkTimeApp.services.assets.style("assets/css/reader.css");
      await controller.ready;
      this.refresh();
      if (presentation === "mini") {
        if (expansion.isOpen) await minimize();
        else await activateMini(++presentationRevision);
      } else await expand();
    },
    close,
    minimize,
    expand,
    refresh() {
      libraryNav.ariaLabel = t("shelf");
      groupNav.ariaLabel = t("groups");
      toolbar.ariaLabel = t("title");
      selectionBar.ariaLabel = t("notes");
      drawerBackdrop.ariaLabel = t("cancel");
      viewport.ariaLabel = t("title");
      if (lastLanguage !== WorkTimeApp.i18n.language) {
        lastLanguage = WorkTimeApp.i18n.language;
        bindings.forEach((fn) => fn());
        shelfSignature = panelSignature = "";
      }
      render();
    },
  };
})();

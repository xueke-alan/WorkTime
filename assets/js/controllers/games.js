"use strict";
/** Owns the shell, transitions and one game instance; never touches work records. */
WorkTimeApp.ui.createGamesController = function ({ document, window }) {
  const events = WorkTimeApp.ui.createEventScope();
  const compat = WorkTimeApp.ui.animationCompat;
  const reduced = compat.preference();
  const motion = {
    expandEase: "cubic-bezier(0.22, 1, 0.36, 1)",
    sideEase: "cubic-bezier(0.16, 1, 0.3, 1)",
    open: {
      surface: 380,
      surfaceFade: 90,
      sides: 240,
      center: 160,
      toolbar: 160,
      toolbarDelay: 160,
      content: 200,
      contentDelay: 220,
    },
    close: {
      surface: 360,
      surfaceFade: 260,
      sides: 340,
      center: 300,
      toolbar: 100,
      toolbarDelay: 0,
      content: 120,
      contentDelay: 0,
    },
  };
  const workspace = document.querySelector(".workspace");
  const origin = workspace.querySelector("section.panel");
  const panels = [...workspace.children];
  const sidebar = document.getElementById("gamesPanel");
  const archiveUI = WorkTimeApp.ui.createGameArchiveController({
    document,
    window,
  });
  const gameArchive = WorkTimeApp.services.gameArchive;
  let archiveReady = false,
    archiveFailure = null,
    handlingArchiveChange = false;
  gameArchive
    .initialize()
    .then(() => {
      archiveReady = true;
    })
    .catch((error) => {
      // Restricted storage must not stop games from running without persistence.
      archiveFailure = ["recovery", "invalid"].includes(error.code)
        ? error
        : null;
      archiveReady = true;
      archiveUI.report(error);
    });
  const shell = document.createElement("div");
  shell.className = "game-shell";
  shell.id = "gameShell";
  shell.hidden = true;
  shell.tabIndex = -1;
  shell.setAttribute("role", "dialog");
  shell.setAttribute("aria-modal", "true");
  shell.setAttribute("aria-labelledby", "gameTitle");
  const surface = document.createElement("div");
  surface.className = "game-surface";
  surface.setAttribute("aria-hidden", "true");
  const toolbar = document.createElement("header");
  toolbar.className = "game-toolbar";
  const title = document.createElement("h2");
  title.id = "gameTitle";
  const exitButton = document.createElement("button");
  exitButton.type = "button";
  exitButton.id = "gameExitButton";
  exitButton.className = "ui-button icon-only";
  exitButton.innerHTML =
    '<svg class="ui-icon" aria-hidden="true"><use href="#ms-chevron-left"/></svg>';
  toolbar.append(exitButton, title);
  const content = document.createElement("div");
  content.className = "game-content";
  shell.append(surface, toolbar, content);
  workspace.append(shell);

  let state = "closed",
    disposed = false,
    instance = null,
    abort = null,
    currentId = null,
    revision = 0,
    animations = [],
    savedInert = [],
    savedOverflow = "",
    savedScroll = null,
    lastSize = null,
    restingPanels = [];
  const t = (key) => WorkTimeApp.i18n.t(key);
  const setState = (value) => {
    state = value;
    shell.dataset.state = value;
  };
  setState("closed");
  function stopMotion() {
    animations.forEach((animation) => animation.cancel());
    animations = [];
    workspace.classList.remove("is-game-transitioning");
  }
  function call(name, value) {
    try {
      instance?.[name]?.(value);
    } catch (error) {
      console.error("Game lifecycle: " + name, error);
    }
  }
  function releaseGame() {
    archiveUI.detach(content);
    abort?.abort();
    abort = null;
    call("dispose");
    instance = null;
    currentId = null;
    lastSize = null;
    content.replaceChildren();
  }
  function translateToolbar() {
    title.textContent = t(
      WorkTimeApp.games.get(currentId)?.nameKey || "games.menu",
    );
    exitButton.setAttribute("aria-label", t("copy.11d0241540"));
    exitButton.title = t("copy.11d0241540");
  }
  function notifySize() {
    if (!instance || state === "closed") return;
    const style = window.getComputedStyle(content);
    const size = {
      width: Math.max(
        0,
        content.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
      ),
      height: Math.max(
        0,
        content.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom),
      ),
    };
    // ResizeObserver, transition completion and viewport events can report the
    // same box. Do not rebuild a board or cancel its motion for duplicate sizes.
    if (lastSize?.width === size.width && lastSize?.height === size.height)
      return;
    lastSize = size;
    call("resize", size);
  }
  function measure() {
    const bounds = workspace.getBoundingClientRect();
    const narrow = window.innerWidth <= 1150;
    shell.classList.toggle("game-shell-compact", narrow);
    if (narrow) {
      const viewport = window.visualViewport;
      const height = viewport?.height || window.innerHeight;
      const top = viewport?.offsetTop || 0;
      Object.assign(shell.style, {
        left: bounds.left + "px",
        top: top + "px",
        width: bounds.width + "px",
        height: height + "px",
      });
    } else {
      Object.assign(shell.style, {
        left: "0px",
        top: "0px",
        width: "100%",
        height: "100%",
      });
    }
  }
  function originClip() {
    const from = origin.getBoundingClientRect();
    const to = shell.getBoundingClientRect();
    const clamp = (value, max) => Math.max(0, Math.min(value, max));
    return `inset(${clamp(from.top - to.top, to.height)}px ${clamp(to.right - from.right, to.width)}px ${clamp(to.bottom - from.bottom, to.height)}px ${clamp(from.left - to.left, to.width)}px round 16px)`;
  }
  function readFrame(element, slide = false) {
    const style = window.getComputedStyle(element);
    return slide
      ? { opacity: style.opacity, transform: style.transform }
      : { opacity: style.opacity };
  }
  function insetDistance(clip) {
    const values =
      clip
        .split("round")[0]
        .match(/[\d.]+(?=px)/g)
        ?.map(Number) || [];
    if (values.length === 1) return 4 * values[0];
    if (values.length === 2) return 2 * (values[0] + values[1]);
    if (values.length === 3) return values[0] + 2 * values[1] + values[2];
    return values.reduce((sum, value) => sum + value, 0);
  }
  async function transition(opening, reversing = false) {
    const token = ++revision;
    // Snapshot all painted states and geometry together, before any cancellation
    // or style writes. A reversal then starts at exactly the interrupted frame.
    const collapsed = originClip();
    const clip = window.getComputedStyle(shell).clipPath;
    const painted = clip === "none" ? "inset(0px round 16px)" : clip;
    const background = panels.map((element, index) => ({
      element,
      slide: element !== origin,
      from: readFrame(element, element !== origin),
      to: opening
        ? element === origin
          ? { opacity: "0" }
          : {
              opacity: "0",
              transform: `translateX(${element.matches(".summary-sidebar") ? -28 : 28}px)`,
            }
        : restingPanels[index],
    }));
    const surfaceFrame = readFrame(surface);
    const toolbarFrame = readFrame(toolbar);
    const contentFrame = readFrame(content, true);
    const distance = insetDistance(collapsed);
    const scale =
      reversing && distance > 0
        ? Math.max(0.15, Math.min(1, 1 - insetDistance(painted) / distance))
        : 1;
    const timing = opening ? motion.open : motion.close;
    const hiddenContent = { opacity: "0", transform: "translateY(6px)" };
    const visibleContent = { opacity: "1", transform: "none" };
    stopMotion();
    workspace.classList.toggle("is-game-expanded", opening);
    origin.classList.toggle("game-origin-muted", opening);
    // Keep endpoints in ordinary styles: compatibility fallback, resize and
    // per-track completion can release fill effects without a flash or jump.
    surface.style.opacity = toolbar.style.opacity = opening ? "1" : "0";
    Object.assign(content.style, opening ? visibleContent : hiddenContent);
    if (!reduced.matches && !document.hidden) {
      workspace.classList.add("is-game-transitioning");
      const startTime = document.timeline?.currentTime;
      const track = (
        element,
        from,
        to,
        duration,
        delay = 0,
        easing = "ease-out",
      ) => {
        animations.push(
          compat.animate(
            element,
            [from, to],
            {
              duration: duration * scale,
              delay: delay * scale,
              easing,
              fill: "both",
            },
            startTime,
          ),
        );
      };
      for (const { element, slide, from, to } of background) {
        track(
          element,
          { opacity: from.opacity },
          { opacity: to.opacity },
          slide ? timing.sides : timing.center,
        );
        if (slide)
          track(
            element,
            { transform: from.transform },
            { transform: to.transform },
            timing.sides,
            0,
            motion.sideEase,
          );
      }
      track(
        shell,
        { clipPath: opening ? collapsed : painted },
        { clipPath: opening ? "inset(0px round 16px)" : collapsed },
        timing.surface,
        0,
        motion.expandEase,
      );
      track(
        surface,
        opening ? { opacity: "0" } : surfaceFrame,
        { opacity: surface.style.opacity },
        timing.surfaceFade,
      );
      track(
        toolbar,
        opening ? { opacity: "0" } : toolbarFrame,
        { opacity: toolbar.style.opacity },
        timing.toolbar,
        timing.toolbarDelay,
      );
      const from = opening ? hiddenContent : contentFrame;
      const to = opening ? visibleContent : hiddenContent;
      track(
        content,
        { opacity: from.opacity },
        { opacity: to.opacity },
        timing.content,
        timing.contentDelay,
      );
      track(
        content,
        { transform: from.transform },
        { transform: to.transform },
        timing.content,
        timing.contentDelay,
        motion.expandEase,
      );
      await Promise.all(animations.map((animation) => animation.finished));
    }
    if (disposed || token !== revision) return;
    stopMotion();
    if (opening) {
      setState("open");
      notifySize();
    } else restore();
  }
  function restore(focus = true) {
    releaseGame();
    shell.hidden = true;
    workspace.classList.remove("is-game-expanded");
    origin.classList.remove("game-origin-muted");
    panels.forEach((panel, index) => (panel.inert = savedInert[index]));
    document.documentElement.style.overflow = savedOverflow;
    if (savedScroll) window.scrollTo(savedScroll.x, savedScroll.y);
    savedScroll = null;
    setState("closed");
    if (focus) WorkTimeApp.ui.dateInfo.selectTab("games");
    if (focus)
      document.getElementById("date-tab-games")?.focus({ preventScroll: true });
  }
  function showMenu() {
    if (state !== "open") return;
    releaseGame();
    WorkTimeApp.ui.renderGameMenu(content, launch, archiveUI);
    translateToolbar();
    content.querySelector("button")?.focus({ preventScroll: true });
  }
  function launch(id) {
    if (!archiveReady) return;
    if (archiveFailure) {
      archiveUI.report(archiveFailure);
      return;
    }
    try {
      if (gameArchive.pendingRecovery()) {
        archiveUI.report({ code: "recovery" });
        return;
      }
    } catch {
      // Games remain playable when the browser blocks persistent storage.
    }
    if (disposed || !["closed", "open"].includes(state)) return;
    const entry = WorkTimeApp.games.get(id);
    if (!entry) return;
    const opening = state === "closed";
    if (opening) {
      savedInert = panels.map((panel) => panel.inert);
      savedOverflow = document.documentElement.style.overflow;
      savedScroll = { x: window.scrollX, y: window.scrollY };
      document.documentElement.style.overflow = "hidden";
      shell.hidden = false;
      setState("opening");
      // Focus leaves the underlying workspace before it becomes inert.
      shell.focus({ preventScroll: true });
      panels.forEach((panel) => (panel.inert = true));
      for (const panel of panels) WorkTimeApp.ui.motion?.stop(panel);
      restingPanels = panels.map((panel) => readFrame(panel, panel !== origin));
      measure();
    }
    releaseGame();
    currentId = id;
    abort = new window.AbortController();
    try {
      instance = entry.create({ container: content, signal: abort.signal });
      if (!instance || typeof instance.dispose !== "function")
        throw Error("Game must return a disposable instance");
      notifySize();
      call(document.hidden ? "pause" : "resume");
    } catch (error) {
      console.error("Game startup failed", error);
      releaseGame();
      const message = document.createElement("p");
      message.dataset.gameError = "";
      message.setAttribute("role", "alert");
      message.textContent = t("games.failed");
      content.append(message);
    }
    translateToolbar();
    exitButton.focus({ preventScroll: true });
    if (opening) void transition(true);
  }
  function exit() {
    if (disposed || state === "closed" || state === "closing") return;
    abort?.abort();
    call("pause");
    const reversing = state === "opening";
    setState("closing");
    void transition(false, reversing);
  }
  function onResize() {
    if (state === "closed") return;
    stopMotion();
    measure();
    notifySize();
  }
  function refreshLanguage() {
    const focused = document.activeElement;
    const gameId = focused?.dataset.game;
    const inMenu = sidebar.contains(focused) || content.contains(focused);
    WorkTimeApp.ui.renderGameMenu(sidebar, launch, archiveUI);
    if (state !== "closed") {
      translateToolbar();
      if (content.querySelector("[data-game-error]"))
        content.querySelector("[data-game-error]").textContent =
          t("games.failed");
      else if (!currentId)
        WorkTimeApp.ui.renderGameMenu(content, launch, archiveUI);
    }
    if (gameId && inMenu) {
      const target = state === "closed" ? sidebar : content;
      [...target.querySelectorAll("[data-game]")]
        .find((button) => button.dataset.game === gameId)
        ?.focus({ preventScroll: true });
    }
  }
  events.listen(exitButton, "click", exit);
  events.listen(shell, "keydown", (event) => {
    if (archiveUI.isOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (state === "open" && currentId) showMenu();
      else exit();
    }
    if (event.key !== "Tab") return;
    const buttons = [
      ...shell.querySelectorAll(
        "button, a[href], input, select, textarea, [tabindex]",
      ),
    ].filter(
      (element) =>
        !element.disabled &&
        element.tabIndex >= 0 &&
        element.getClientRects().length &&
        !element.closest("[inert]"),
    );
    const index = buttons.indexOf(document.activeElement);
    if (
      !buttons.length ||
      (event.shiftKey ? index <= 0 : index === buttons.length - 1 || index < 0)
    ) {
      event.preventDefault();
      (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
    }
  });
  events.listen(document, "focusin", (event) => {
    if (
      state !== "closed" &&
      !archiveUI.isOpen() &&
      !shell.contains(event.target)
    )
      exitButton.focus({ preventScroll: true });
  });
  events.listen(document, "visibilitychange", () => {
    if (state === "closed") return;
    call(document.hidden || state === "closing" ? "pause" : "resume");
    if (document.hidden) stopMotion();
  });
  events.listen(document, "worktime:languagechange", refreshLanguage);
  events.listen(window, "resize", onResize);
  function archiveChanged() {
    if (handlingArchiveChange || disposed || !currentId) return;
    handlingArchiveChange = true;
    try {
      revision++;
      stopMotion();
      restore(false);
      refreshLanguage();
    } finally {
      handlingArchiveChange = false;
    }
  }
  events.listen(window, "worktime:gamearchive", archiveChanged);
  events.listen(window, "storage", (event) => {
    if (event.key === gameArchive.REVISION || event.key === gameArchive.JOURNAL)
      archiveChanged();
  });
  if (window.visualViewport)
    events.listen(window.visualViewport, "resize", onResize);
  const unlisten = compat.listen(reduced, () => {
    if (reduced.matches) stopMotion();
  });
  const observer = new window.ResizeObserver(onResize);
  observer.observe(workspace);
  // Content dimensions also change when translated toolbar labels wrap.
  const contentObserver = new window.ResizeObserver(notifySize);
  contentObserver.observe(content);
  refreshLanguage();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      stopMotion();
      releaseGame();
      archiveUI.dispose();
      events.dispose();
      unlisten();
      observer.disconnect();
      contentObserver.disconnect();
      if (state !== "closed") restore(false);
      sidebar.replaceChildren();
      shell.remove();
    },
  };
};

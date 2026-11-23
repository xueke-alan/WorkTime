/* Shared motion keeps ordinary renders still; editor titles follow visible text changes. */
(() => {
  "use strict";
  const reduced = WorkTimeApp.ui.animationCompat.preference();
  const running = new Map();
  const title = Object.freeze({
    duration: 240,
    easing: "cubic-bezier(0.2, 0.65, 0.3, 1)",
    enterFrom: Object.freeze({ opacity: 0.4, translate: "6px 0" }),
    enterTo: Object.freeze({ opacity: 1, translate: "0px 0px" }),
    leaveTo: Object.freeze({ opacity: 0, translate: "-6px 0" }),
  });
  // Date surfaces share one rhythm across navigation, layout and content changes.
  const calendar = Object.freeze({
    duration: 520,
    leaveDuration: 400,
    navigationDuration: 320,
    pageNavigationDuration: 520,
    pageNavigationEasing: "cubic-bezier(0.4, 0, 0.2, 1)",
    contentDuration: 300,
    contentLeaveDuration: 200,
    analysisEnterDuration: 280,
    analysisLeaveDuration: 180,
    filteredPageDuration: 360,
    filteredPageEasing: "cubic-bezier(0.3, 0.12, 0.24, 1)",
    weekReturnDuration: 460,
    weekReturnEasing: "cubic-bezier(0.32, 0, 0.22, 1)",
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  });
  function animateCalendar(plans) {
    // All geometry must be read before this write-only phase. Pending native
    // animations resolve together on the next frame, without backdating their
    // clocks to the document-timeline timestamp from before a costly render.
    return plans.map(({ element, frames, options }) =>
      WorkTimeApp.ui.animationCompat.animate(element, frames, options),
    );
  }
  const contentMotions = new Set([
    "motion-content",
    "motion-title",
    "motion-card-content",
    "motion-sidebar-forward",
    "motion-sidebar-back",
    "motion-calendar-view",
    "motion-calendar-year",
  ]);
  let disposed = true,
    unlisten,
    titleObserver,
    editorHeading = null,
    editorHeadingText = "";
  const editorHeaders =
    ".editor-mode-header, .year-analysis-header, .analysis-sidebar-header";
  function editorContent(element) {
    if (!element || element.matches(editorHeaders)) return [];
    if (!element.querySelector(editorHeaders)) return [element];
    return [...element.children].flatMap(editorContent);
  }
  function refreshEditorTitle() {
    const editor = document.querySelector(".workspace > .editor");
    if (!editor || disposed) return;
    const heading = [
      ...editor.querySelectorAll(
        ".editor-mode-header h2, .editor-mode-header .editor-date, .year-analysis-header h2, .analysis-sidebar-header",
      ),
    ].find(
      (element) =>
        !element.closest(".vocabulary-drawer-snapshot") &&
        element.getClientRects().length &&
        getComputedStyle(element).visibility === "visible",
    );
    if (!heading) return;
    const text = heading.textContent;
    if (heading === editorHeading && text === editorHeadingText) return;
    // Optional panels can begin their reveal before exposing the new heading.
    // Keep that reveal on the body so it cannot multiply the title's motion.
    for (
      let parent = heading.parentElement;
      parent && parent !== editor;
      parent = parent.parentElement
    ) {
      const entry = running.get(parent);
      if (!entry?.animation) continue;
      const name = entry.name;
      stop(parent);
      for (const content of editorContent(parent)) play(content, name);
    }
    const previous = editorHeading;
    if (previous) stop(previous);
    editorHeading = heading;
    editorHeadingText = text;
    if (previous && !document.documentElement.classList.contains("app-loading"))
      play(heading, "motion-title");
  }
  function playEditorSurface(element, name) {
    stop(element);
    for (const content of editorContent(element)) play(content, name);
    refreshEditorTitle();
  }
  function stop(element) {
    const entry = running.get(element);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.animation?.cancel();
    element.classList.remove(entry.name);
    element.style.removeProperty("--motion-delay");
    running.delete(element);
  }
  function play(element, name = "motion-content", delay = 0) {
    if (!element || disposed || document.hidden) return;
    const restarting = running.has(element);
    // Continue from the painted state when a user changes tabs mid-transition.
    const current = running.get(element)?.animation
      ? getComputedStyle(element)
      : null;
    const start = current && {
      opacity: current.opacity,
      ...(name === "motion-title"
        ? { translate: current.translate }
        : { transform: current.transform }),
    };
    stop(element);
    if (reduced.matches || WorkTimeApp.i18n.changing) return;
    if (contentMotions.has(name)) {
      // A single surface owns the reveal; nested panes should not fade twice.
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (running.get(parent)?.animation) return;
      for (const child of running.keys())
        if (element.contains(child)) stop(child);
      const distance =
        name === "motion-calendar-year" &&
        getComputedStyle(element)
          .getPropertyValue("--motion-direction")
          .trim()
          .startsWith("-")
          ? "-6px"
          : "6px";
      const transform =
        name === "motion-card-content"
          ? "translateX(-6px)"
          : name === "motion-sidebar-forward"
            ? "translateX(6px)"
            : name === "motion-sidebar-back"
              ? "translateX(-6px)"
              : name === "motion-calendar-year"
                ? `translateX(${distance})`
                : "translateY(4px)";
      // Title transforms belong to ink alignment, which can refresh mid-animation.
      // Animate the independent translate property so releasing the effect never
      // restores a different vertical baseline.
      const frames =
        name === "motion-title"
          ? [start || title.enterFrom, title.enterTo]
          : [
              start || { opacity: 0.4, transform },
              { opacity: 1, transform: "none" },
            ];
      const animation = WorkTimeApp.ui.animationCompat.animate(
        element,
        frames,
        {
          duration: name.startsWith("motion-calendar")
            ? calendar.navigationDuration
            : name === "motion-card-content"
              ? calendar.contentDuration
              : name === "motion-title"
                ? title.duration
                : 240,
          easing:
            name.startsWith("motion-calendar") || name === "motion-card-content"
              ? calendar.easing
              : name === "motion-title"
                ? title.easing
                : "cubic-bezier(0.2, 0.65, 0.3, 1)",
          fill: "backwards",
        },
      );
      const entry = { name, animation };
      running.set(element, entry);
      animation.finished.then(() => {
        if (running.get(element) === entry) stop(element);
      });
      return;
    }
    // CSS effects restart only when explicitly triggered.
    if (restarting) void element.offsetWidth;
    element.style.setProperty("--motion-delay", delay + "ms");
    element.classList.add(name);
    running.set(element, { name, timer: setTimeout(() => stop(element), 700) });
  }
  function isAnimating(element) {
    for (let node = element; node; node = node.parentElement)
      if (running.has(node)) return true;
    return false;
  }
  function initial() {
    document
      .querySelectorAll(".workspace>.panel")
      .forEach((element, i) => play(element, "motion-enter", i * 60));
    document
      .querySelectorAll("#cards>.card")
      .forEach((element, i) => play(element, "motion-enter", 80 + i * 35));
    play(document.querySelector(".target-panel"), "motion-enter", 180);
    play(document.querySelector("footer"), "motion-enter", 220);
  }
  function onPreference() {
    if (reduced.matches) [...running.keys()].forEach(stop);
  }
  function onVisibility() {
    if (document.hidden) [...running.keys()].forEach(stop);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    [...running.keys()].forEach(stop);
    unlisten?.();
    unlisten = null;
    titleObserver?.disconnect();
    titleObserver = null;
    editorHeading = null;
    editorHeadingText = "";
    document.removeEventListener("visibilitychange", onVisibility);
  }
  function mount() {
    if (!disposed) return;
    disposed = false;
    unlisten = WorkTimeApp.ui.animationCompat.listen(reduced, onPreference);
    document.addEventListener("visibilitychange", onVisibility);
    const editor = document.querySelector(".workspace > .editor");
    if (editor) {
      refreshEditorTitle();
      titleObserver = new MutationObserver((records) => {
        if (
          records.some((record) => {
            const target =
              record.target.nodeType === 1
                ? record.target
                : record.target.parentElement;
            return (
              target?.closest(editorHeaders) ||
              target?.matches(
                ".editor, .editor-content, #dayEditor, #batchBar, #yearAnalysisSidebar, #analysisSidebar, #agendaEditor, #settingsPane, #vocabularyPanel, #vocabularyContent",
              )
            );
          })
        )
          refreshEditorTitle();
      });
      titleObserver.observe(editor, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["hidden", "class"],
      });
    }
  }
  WorkTimeApp.ui.motion = {
    title,
    editorContent,
    refreshEditorTitle,
    playEditorSurface,
    calendar,
    animateCalendar,
    play,
    stop,
    isAnimating,
    initial,
    mount,
    dispose,
  };
  mount();
})();

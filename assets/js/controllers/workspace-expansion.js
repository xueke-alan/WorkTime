"use strict";
/** A workspace surface expands from the calendar with the same motion as games. */
WorkTimeApp.ui.createWorkspaceExpansion = function ({
  shell,
  surface,
  toolbar,
  content,
  returnFocus,
  onChange = () => {},
}) {
  const workspace = document.querySelector(".workspace"),
    origin = workspace.querySelector("section.panel");
  const panels = [...workspace.children].filter((panel) =>
    panel.matches(".summary-sidebar, section.panel, .editor"),
  );
  const compat = WorkTimeApp.ui.animationCompat,
    motion = compat.workspaceMotion,
    reduced = compat.preference();
  let state = "closed",
    animations = [],
    revision = 0,
    disposed = false;
  let savedInert = [],
    savedOverflow = "",
    savedScroll = null,
    restingPanels = [];
  function setState(value) {
    state = value;
    shell.dataset.state = value;
    onChange();
  }
  function stopMotion() {
    animations.forEach((animation) => animation.cancel());
    animations = [];
    workspace.classList.remove("is-game-transitioning");
  }
  function readFrame(element, slide = false) {
    const style = getComputedStyle(element);
    return slide
      ? { opacity: style.opacity, transform: style.transform }
      : { opacity: style.opacity };
  }
  function measure() {
    const bounds = workspace.getBoundingClientRect(),
      compact = innerWidth <= 1150,
      edgeToEdge = innerWidth <= 850,
      viewport = window.visualViewport;
    shell.classList.toggle("game-shell-compact", compact);
    Object.assign(
      shell.style,
      compact
        ? {
            left: (edgeToEdge ? viewport?.offsetLeft || 0 : bounds.left) + "px",
            top: (viewport?.offsetTop || 0) + "px",
            width:
              (edgeToEdge ? viewport?.width || innerWidth : bounds.width) +
              "px",
            height: (viewport?.height || innerHeight) + "px",
          }
        : { left: "0px", top: "0px", width: "100%", height: "100%" },
    );
  }
  function originClip() {
    const from = origin.getBoundingClientRect(),
      to = shell.getBoundingClientRect();
    const clamp = (value, max) => Math.max(0, Math.min(value, max));
    return `inset(${clamp(from.top - to.top, to.height)}px ${clamp(to.right - from.right, to.width)}px ${clamp(to.bottom - from.bottom, to.height)}px ${clamp(from.left - to.left, to.width)}px round 16px)`;
  }
  function distance(clip) {
    return (clip.split("round")[0].match(/[\d.]+(?=px)/g) || []).reduce(
      (sum, value) => sum + Number(value),
      0,
    );
  }
  function restore(focus = true) {
    shell.hidden = true;
    workspace.classList.remove("is-game-expanded", "is-game-transitioning");
    origin.classList.remove("game-origin-muted");
    panels.forEach((panel, i) => {
      panel.inert = savedInert[i];
    });
    document.documentElement.style.overflow = savedOverflow;
    if (savedScroll) window.scrollTo(savedScroll.x, savedScroll.y);
    savedScroll = null;
    setState("closed");
    if (focus) returnFocus()?.focus({ preventScroll: true });
  }
  async function transition(opening, reversing = false) {
    const token = ++revision,
      collapsed = originClip(),
      clip = getComputedStyle(shell).clipPath;
    const expanded = `inset(0px round ${getComputedStyle(shell).borderRadius})`;
    const painted = clip === "none" ? expanded : clip;
    const background = panels.map((element, i) => ({
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
        : restingPanels[i],
    }));
    const surfaceFrame = readFrame(surface),
      toolbarFrame = readFrame(toolbar),
      contentFrame = readFrame(content, true);
    const scale =
      reversing && distance(collapsed) > 0
        ? Math.max(
            0.15,
            Math.min(
              1,
              opening
                ? distance(painted) / distance(collapsed)
                : 1 - distance(painted) / distance(collapsed),
            ),
          )
        : 1;
    const timing = opening ? motion.open : motion.close;
    const hiddenContent = { opacity: "0", transform: "translateY(6px)" },
      visibleContent = { opacity: "1", transform: "none" };
    stopMotion();
    workspace.classList.toggle("is-game-expanded", opening);
    origin.classList.toggle("game-origin-muted", opening);
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
      ) =>
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
        { clipPath: opening && !reversing ? collapsed : painted },
        { clipPath: opening ? expanded : collapsed },
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
      const from = opening ? hiddenContent : contentFrame,
        to = opening ? visibleContent : hiddenContent;
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
    if (opening) setState("open");
    else restore();
  }
  function close() {
    if (disposed || state === "closed" || state === "closing") return;
    const reversing = state === "opening";
    setState("closing");
    void transition(false, reversing);
  }
  function settle() {
    if (state === "closed") return;
    ++revision;
    stopMotion();
    if (state === "closing") restore();
    else {
      measure();
      setState("open");
    }
  }
  function focusable() {
    return [
      ...shell.querySelectorAll(
        "button, a[href], input, select, textarea, summary, [tabindex]",
      ),
    ].filter(
      (element) =>
        !element.disabled &&
        element.tabIndex >= 0 &&
        element.getClientRects().length &&
        !element.closest("[inert]"),
    );
  }
  function keydown(event) {
    if (event.key !== "Tab") return;
    const elements = focusable(),
      i = elements.indexOf(document.activeElement);
    if (
      !elements.length ||
      (event.shiftKey ? i <= 0 : i < 0 || i === elements.length - 1)
    ) {
      event.preventDefault();
      (event.shiftKey ? elements.at(-1) : elements[0])?.focus();
    }
  }
  function focusin(event) {
    if (
      state !== "closed" &&
      !shell.contains(event.target) &&
      !document.querySelector("dialog:modal")
    )
      (focusable()[0] || shell).focus({ preventScroll: true });
  }
  function visibility() {
    if (document.hidden) settle();
  }
  shell.addEventListener("keydown", keydown);
  document.addEventListener("focusin", focusin);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("resize", settle);
  window.visualViewport?.addEventListener("resize", settle);
  const observer = new ResizeObserver(() => {
    if (state !== "closed") measure();
  });
  observer.observe(workspace);
  const unlisten = compat.listen(reduced, () => {
    if (reduced.matches) settle();
  });
  shell.dataset.state = state;
  return {
    get isOpen() {
      return state !== "closed";
    },
    open() {
      if (disposed || state === "open" || state === "opening") return;
      if (state === "closing") {
        setState("opening");
        void transition(true, true);
        return;
      }
      if (
        [...workspace.querySelectorAll(".game-shell")].some(
          (element) => element !== shell && !element.hidden,
        )
      )
        return;
      savedInert = panels.map((panel) => panel.inert);
      savedOverflow = document.documentElement.style.overflow;
      savedScroll = { x: scrollX, y: scrollY };
      document.documentElement.style.overflow = "hidden";
      shell.hidden = false;
      shell.focus({ preventScroll: true });
      panels.forEach((panel) => {
        panel.inert = true;
        WorkTimeApp.ui.motion?.stop(panel);
      });
      restingPanels = panels.map((panel) => readFrame(panel, panel !== origin));
      measure();
      setState("opening");
      void transition(true);
    },
    close,
    dispose() {
      if (disposed) return;
      disposed = true;
      ++revision;
      stopMotion();
      if (state !== "closed") restore(false);
      observer.disconnect();
      unlisten();
      shell.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusin);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("resize", settle);
      window.visualViewport?.removeEventListener("resize", settle);
    },
  };
};

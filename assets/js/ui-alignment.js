/* Align single-line UI ink, keeping font metrics out of layout and paragraph flow. */
(() => {
  "use strict";
  const selectors = [
    "button.ui-button",
    ".month-title-year",
    ".month-title-month",
    ".calendar .daystatus .pill-text",
    ".year-day>span",
    ".day-date .daynum-text",
    ".calendar .daykind",
    ".calendar .day-average > span",
    ".summary-sidebar .card-label",
    ".summary-sidebar [data-number-ink]",
    ".sidebar-brand h1",
    ".editor-day-header .editor-date",
    ".batch-editor-header h2",
    ".page-settings-header h2",
    "dialog:not(#sourceDialog) .dialog-head h2",
    "#calendarFoot",
    ".almanac-watermark-text",
  ];
  const targetSelector = selectors.join(",");
  const scopeSelector =
    ".calendar .day,.summary-sidebar .card,.target-panel,.calendar-footer,.panel-head,.calendar,.summary-sidebar,.editor,dialog,.sidebar-brand,.sidebar-actions";
  const pendingScopes = new Set();
  let fullRefresh = false;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return;
  const dateInkHeights = new Map();
  const textMetrics = new Map();
  let dateRaster = null;
  let dateRasterContext = null;
  // Computed CSS can serialize keywords as percentages; Canvas only accepts keywords.
  const stretchKeywords = {
    "50%": "ultra-condensed",
    "62.5%": "extra-condensed",
    "75%": "condensed",
    "87.5%": "semi-condensed",
    "100%": "normal",
    "112.5%": "semi-expanded",
    "125%": "expanded",
    "150%": "extra-expanded",
    "200%": "ultra-expanded",
  };
  const validStretches = new Set(Object.values(stretchKeywords));
  function canvasFontStretch(value) {
    return (
      stretchKeywords[value] || (validStretches.has(value) ? value : "normal")
    );
  }
  // Font-size changes and historical labels must not grow these caches forever.
  function remember(cache, key, value, limit) {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > limit) cache.delete(cache.keys().next().value);
    return value;
  }
  function cachedMetrics(style, text) {
    const key = [context.font, style.fontStretch, text].join("|");
    if (textMetrics.has(key)) {
      const value = textMetrics.get(key);
      return remember(textMetrics, key, value, 512);
    }
    return remember(textMetrics, key, context.measureText(text), 512);
  }
  function dateInkHeight(style, text) {
    const scale = devicePixelRatio || 1,
      key = [context.font, style.fontStretch, text, scale].join("|");
    if (dateInkHeights.has(key))
      return remember(dateInkHeights, key, dateInkHeights.get(key), 128);
    const size = parseFloat(style.fontSize);
    if (!dateRaster) {
      dateRaster = document.createElement("canvas");
      dateRasterContext = dateRaster.getContext("2d", {
        willReadFrequently: true,
      });
    }
    const raster = dateRaster,
      ink = dateRasterContext,
      width = Math.ceil(
        Math.max(size * 5, cachedMetrics(style, text).width + 8) * scale,
      ),
      rasterHeight = Math.ceil(size * 3 * scale);
    if (raster.width !== width) raster.width = width;
    if (raster.height !== rasterHeight) raster.height = rasterHeight;
    ink.setTransform(1, 0, 0, 1, 0, 0);
    ink.clearRect(0, 0, width, rasterHeight);
    ink.setTransform(scale, 0, 0, scale, 0, 0);
    ink.font = context.font;
    if ("fontStretch" in ink)
      ink.fontStretch = canvasFontStretch(style.fontStretch);
    ink.fillText(text, 4, size * 2);
    const pixels = ink.getImageData(0, 0, raster.width, raster.height).data;
    let first = raster.height,
      last = -1;
    for (let y = 0; y < raster.height; y++)
      for (let x = 0; x < raster.width; x++)
        if (pixels[(y * raster.width + x) * 4 + 3] > 0) {
          first = Math.min(first, y);
          last = Math.max(last, y);
          break;
        }
    const height = last >= first ? (last - first + 1) / scale : size;
    const bounds = {
      height,
      center: last >= first ? (first + last + 1) / (2 * scale) - size * 2 : 0,
    };
    return remember(dateInkHeights, key, bounds, 128);
  }
  let scheduled = false;
  let frame = 0;
  let suspended = false;
  let disposed = true;
  const probe = document.createElement("i");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline;font-size:0;line-height:0";
  function alignTexts(targets) {
    const viewport = { left: scrollX, top: scrollY };
    const representatives = [],
      followers = [],
      years = new Map();
    for (const element of targets) {
      if (!element.matches(".year-day>span")) {
        representatives.push(element);
        continue;
      }
      const style = getComputedStyle(element);
      const key = [
        element.textContent.trim(),
        style.fontSize,
        style.fontFamily,
        style.fontWeight,
      ].join("|");
      if (years.has(key)) followers.push([element, years.get(key)]);
      else {
        years.set(key, element);
        representatives.push(element);
      }
    }
    // Read visibility before changing line boxes, then initialize all text layers.
    const visible = representatives.filter(
      (element) =>
        element.textContent.trim() && element.getClientRects().length,
    );
    for (const element of visible) {
      element.classList.add("ui-aligned-text");
      element.style.setProperty("--ui-ink-offset", "0px");
      if (element.matches(".year-day>span"))
        element.style.setProperty("--ui-ink-offset-x", "0px");
    }
    const measurements = [];
    for (const element of visible) {
      const style = getComputedStyle(element);
      if (
        element.matches(".calendar .daystatus .pill-text,.calendar .daykind")
      ) {
        const range = document.createRange();
        range.selectNodeContents(element);
        if (range.getClientRects().length > 1) continue;
      }
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      if ("fontStretch" in context)
        context.fontStretch = canvasFontStretch(style.fontStretch);
      const text = element.textContent.trim();
      measurements.push({
        element,
        metrics: cachedMetrics(style, text),
        dateBounds: element.matches(".day-date .daynum-text,.calendar .daykind")
          ? dateInkHeight(style, text)
          : null,
        baselineProbe: probe.cloneNode(),
      });
    }
    // Apply date geometry and add every zero-size baseline probe in one write phase.
    for (const item of measurements) {
      if (item.dateBounds && item.element.matches(".day-date .daynum-text"))
        item.element
          .closest(".day-date")
          .style.setProperty(
            "--date-ink-height",
            item.dateBounds.height.toFixed(3) + "px",
          );
      item.element.appendChild(item.baselineProbe);
    }
    // No DOM writes between the first and last geometry reads.
    for (const item of measurements) {
      item.box = item.element.getBoundingClientRect();
      item.baseline = item.baselineProbe.getBoundingClientRect().top;
    }
    for (const {
      element,
      metrics,
      dateBounds,
      baselineProbe,
      box,
      baseline,
    } of measurements) {
      baselineProbe.remove();
      const inkCenter =
        baseline +
        (dateBounds
          ? dateBounds.center
          : (metrics.actualBoundingBoxDescent -
              metrics.actualBoundingBoxAscent) /
            2);
      const offset = box.top + box.height / 2 - inkCenter;
      if (element.matches(".year-day>span")) {
        const x =
          (box.width +
            metrics.actualBoundingBoxLeft -
            metrics.actualBoundingBoxRight) /
          2;
        if (Number.isFinite(x))
          element.style.setProperty("--ui-ink-offset-x", x.toFixed(3) + "px");
      }
      if (Number.isFinite(offset))
        element.style.setProperty("--ui-ink-offset", offset.toFixed(3) + "px");
    }
    for (const [element, representative] of followers) {
      element.classList.add("ui-aligned-text");
      element.style.setProperty(
        "--ui-ink-offset",
        representative.style.getPropertyValue("--ui-ink-offset"),
      );
      element.style.setProperty(
        "--ui-ink-offset-x",
        representative.style.getPropertyValue("--ui-ink-offset-x"),
      );
    }
    // Temporary line-box changes must not move a focused mobile page's scroll anchor.
    if (scrollX !== viewport.left || scrollY !== viewport.top)
      window.scrollTo({ ...viewport, behavior: "instant" });
  }
  function refresh(scopes = null) {
    if (disposed || suspended || document.hidden) return;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    scheduled = false;
    pendingScopes.clear();
    fullRefresh = false;
    observer.disconnect();
    const targets = new Set();
    const candidates = new Set();
    for (const scope of scopes || [document]) {
      if (scope instanceof Element && scope.matches(targetSelector))
        candidates.add(scope);
      scope
        .querySelectorAll(targetSelector)
        .forEach((element) => candidates.add(element));
    }
    candidates.forEach((element) => {
      if (element.tagName === "BUTTON") {
        // Ordinary controls share a baseline. Per-string ink corrections break that contract.
        return;
      }
      // Components declare text layers; alignment never changes their structure.
      targets.add(element);
    });
    // Font profiles share a baseline; label structure belongs to each component.
    const buttonProfiles = [...candidates]
      .filter((element) => element.tagName === "BUTTON")
      .map((element) => {
        const size = parseFloat(getComputedStyle(element).fontSize);
        return { element, thirteen: size === 13, larger: size >= 14 };
      });
    for (const { element, thirteen, larger } of buttonProfiles) {
      element.classList.toggle("ui-font-13", thirteen);
      element.classList.toggle("ui-font-14-plus", larger);
    }
    alignTexts(targets);
    observe();
  }
  function queue(scope = null) {
    if (scope) pendingScopes.add(scope);
    else fullRefresh = true;
    if (!disposed && !suspended && !document.hidden && !scheduled) {
      scheduled = true;
      frame = requestAnimationFrame(() => {
        const scopes = fullRefresh
          ? null
          : [...pendingScopes].filter((root) => root.isConnected);
        refresh(scopes);
      });
    }
  }
  function schedule() {
    queue();
  }
  function observe() {
    const roots = [
      ...document.querySelectorAll(
        ".workspace,dialog,main.wrap > footer,.sidebar-brand",
      ),
    ];
    for (const root of roots) {
      if (roots.some((other) => other !== root && other.contains(root)))
        continue;
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ["class", "style", "open", "hidden"],
      });
    }
    // Root typography and replacement of component containers still require a full pass.
    observer.observe(document.documentElement, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["class", "style"],
    });
    observer.observe(document.body, {
      childList: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["class", "style"],
    });
    const main = document.querySelector("main.wrap");
    if (main)
      observer.observe(main, {
        childList: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ["class", "style"],
      });
  }
  // Surface motion does not change font or line boxes. Ignore its bookkeeping,
  // including cleanup, while still observing mixed motion/layout class changes.
  const motionClasses = new Set([
    "motion-enter",
    "motion-content",
    "motion-day",
    "motion-selection",
    "motion-calendar-view",
    "motion-calendar-year",
    "motion-year-month",
    "motion-startup",
    "motion-sidebar-forward",
    "motion-sidebar-back",
    "motion-dialog-preparing",
  ]);
  function isMotionMetadata(record) {
    if (record.type !== "attributes") return false;
    const element = record.target;
    if (record.attributeName === "class") {
      const before = new Set(
        (record.oldValue || "").split(/\s+/).filter(Boolean),
      );
      const after = new Set(element.classList);
      const changed = [...new Set([...before, ...after])].filter(
        (token) => before.has(token) !== after.has(token),
      );
      return (
        changed.length > 0 && changed.every((token) => motionClasses.has(token))
      );
    }
    if (record.attributeName !== "style") return false;
    const before = document.createElement("i").style;
    before.cssText = record.oldValue || "";
    const after = document.createElement("i").style;
    after.cssText = element.getAttribute("style") || "";
    for (const property of ["--motion-delay", "--motion-direction"]) {
      before.removeProperty(property);
      after.removeProperty(property);
    }
    return before.cssText === after.cssText;
  }
  function mutationsChanged(records) {
    for (const record of records) {
      if (isMotionMetadata(record)) continue;
      const element =
        record.target instanceof Element
          ? record.target
          : record.target.parentElement;
      if (!element) continue;
      const scope = element.closest(scopeSelector);
      if (scope) queue(scope);
      else queue();
    }
  }
  function stopWatching() {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    scheduled = false;
    pendingScopes.clear();
    fullRefresh = false;
  }
  function fontsLoaded() {
    textMetrics.clear();
    dateInkHeights.clear();
    schedule();
  }
  function visibilityChanged() {
    if (document.hidden) stopWatching();
    else schedule();
  }
  function pageHidden() {
    suspended = true;
    stopWatching();
  }
  function pageShown() {
    suspended = false;
    schedule();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    stopWatching();
    textMetrics.clear();
    dateInkHeights.clear();
    if (dateRaster) dateRaster.width = dateRaster.height = 0;
    dateRaster = dateRasterContext = null;
    probe.remove();
    window.removeEventListener("resize", schedule);
    window.removeEventListener("pagehide", pageHidden);
    window.removeEventListener("pageshow", pageShown);
    document.removeEventListener("visibilitychange", visibilityChanged);
    document.removeEventListener("worktime:failed", dispose);
    document.fonts.removeEventListener("loadingdone", fontsLoaded);
  }
  const observer = new MutationObserver(mutationsChanged);
  function mount() {
    if (!disposed || document.documentElement.dataset.appState === "failed")
      return;
    disposed = false;
    suspended = false;
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("pagehide", pageHidden);
    window.addEventListener("pageshow", pageShown);
    document.addEventListener("visibilitychange", visibilityChanged);
    document.addEventListener("worktime:failed", dispose);
    document.fonts.addEventListener("loadingdone", fontsLoaded);
    schedule();
  }
  document.fonts.ready.then(schedule);
  WorkTimeApp.ui.alignment = { refresh, mount, dispose };
  mount();
})();

"use strict";
/** Stable startup facades; optional forms are warmed only after the opening motion. */
WorkTimeApp.ui.secondary = {};
WorkTimeApp.ui.secondaryControllers = (() => {
  const records = new Map();
  let loading = null,
    failed = false,
    closed = false,
    eligible = false;
  let introTimer = 0;
  let idle = 0,
    timer = 0,
    frame = 0,
    sequence = 0;
  let pending = null,
    notice = null,
    origin = null;
  let completedAt = null,
    startedAt = null;
  const loaded = (names) => names.every((name) => records.get(name)?.value);
  function clearNotice() {
    origin?.removeAttribute("aria-busy");
    origin = null;
    notice?.remove();
    notice = null;
  }
  function cancel() {
    sequence++;
    pending = null;
    clearNotice();
  }
  function showNotice(entry, error = false) {
    clearNotice();
    origin = entry.origin;
    origin?.setAttribute("aria-busy", String(!error));
    notice = document.createElement("div");
    notice.className = "notice";
    notice.dataset.secondaryStatus = error ? "failed" : "loading";
    notice.setAttribute("role", "status");
    const box = origin?.getBoundingClientRect();
    notice.style.cssText = `position:fixed;z-index:10000;max-width:calc(100vw - 32px);width:300px;left:${Math.max(8, Math.min(box?.left || 16, innerWidth - 316))}px;top:${Math.max(8, Math.min((box?.bottom || 8) + 8, innerHeight - 100))}px`;
    const label = document.createElement("span");
    label.textContent = WorkTimeApp.i18n.t(
      error ? "secondary.failed" : "secondary.loading",
    );
    notice.append(label);
    if (error) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "ui-button";
      retry.textContent = WorkTimeApp.i18n.t("copy.e2d53a6d3a");
      retry.onclick = () => request(entry.names, entry.run, entry.origin);
      notice.append(retry);
    }
    document.body.append(notice);
  }
  function load(priority) {
    // Calling the shared loader again also promotes an in-flight idle request.
    const task = WorkTimeApp.services.assets.script(
      "assets/js/ui/secondary-runtime.min.js",
      { fetchPriority: priority },
    );
    if (!loading) {
      failed = false;
      loading = task.catch((error) => {
        loading = null;
        failed = true;
        throw error;
      });
    }
    return loading;
  }
  function initialize(name) {
    const record = records.get(name);
    if (closed || !record || record.disposed || record.value) return;
    const controller = WorkTimeApp.ui.secondary[name](record.options);
    try {
      controller.bind();
      record.value = controller;
    } catch (error) {
      controller.dispose();
      throw error;
    }
    if (
      records.size === 3 &&
      [...records.values()].every((item) => item.value) &&
      completedAt === null
    ) {
      completedAt = performance.now();
      document.dispatchEvent(new Event("worktime:prewarm-complete"));
    }
  }
  async function fulfill(entry) {
    try {
      await load("high");
      if (closed || sequence !== entry.id || document.hidden) return;
      entry.names.forEach(initialize);
      if (closed || sequence !== entry.id) return;
      pending = null;
      clearNotice();
      entry.run(() => !closed && sequence === entry.id);
      queueWarm();
    } catch {
      if (!closed && sequence === entry.id) {
        pending = entry;
        showNotice(entry, true);
      }
    }
  }
  function request(names, run, trigger = document.activeElement) {
    if (closed) return;
    failed = false;
    const entry = {
      id: ++sequence,
      names,
      run,
      origin: trigger instanceof HTMLElement ? trigger : null,
    };
    pending = null;
    clearNotice();
    if (loaded(names)) {
      run(() => !closed && sequence === entry.id);
      return;
    }
    pending = entry;
    showNotice(entry);
    void fulfill(entry);
  }
  function stopIdle() {
    if (idle) window.cancelIdleCallback(idle);
    clearTimeout(timer);
    idle = timer = 0;
  }
  function queueWarm() {
    if (
      closed ||
      !eligible ||
      document.hidden ||
      failed ||
      idle ||
      timer ||
      completedAt !== null
    )
      return;
    const run = () => {
      idle = timer = 0;
      void warmNext();
    };
    if (typeof window.requestIdleCallback === "function")
      idle = window.requestIdleCallback(run, { timeout: 2000 });
    else timer = setTimeout(run, 50);
  }
  async function warmNext() {
    if (closed || document.hidden) return;
    if (startedAt === null) {
      startedAt = performance.now();
      document.dispatchEvent(new Event("worktime:prewarm-start"));
    }
    try {
      await load("low");
      if (closed || document.hidden) return;
      const next = [...records.keys()].find(
        (name) => !records.get(name).value && !records.get(name).disposed,
      );
      if (next) initialize(next);
      queueWarm();
    } catch {
      // Background failures do not interrupt startup; the next explicit use retries.
      failed = true;
    }
  }
  function afterIntro() {
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (closed) return;
      const panels = [
        ...document.querySelectorAll(".workspace>.panel,main.wrap>footer"),
      ];
      const motions = panels
        .flatMap((panel) => panel.getAnimations?.() || [])
        .filter((animation) => animation.animationName === "motion-startup");
      let finished;
      if (panels.every((panel) => typeof panel.getAnimations === "function"))
        finished = Promise.all(
          motions.map((animation) => animation.finished.catch(() => {})),
        );
      else {
        const wait = Math.max(
          0,
          ...panels.map((panel) => {
            const style = getComputedStyle(panel);
            return (
              parseFloat(style.animationDuration) * 1000 +
              parseFloat(style.animationDelay) * 1000
            );
          }),
        );
        finished = new Promise((resolve) => {
          introTimer = setTimeout(() => {
            introTimer = 0;
            resolve();
          }, wait + 50);
        });
      }
      void finished.then(() => {
        if (closed) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          eligible = true;
          queueWarm();
        });
      });
    });
  }
  function visibility() {
    if (document.hidden) stopIdle();
    else if (pending) void fulfill(pending);
    else queueWarm();
  }
  function keydown(event) {
    if (event.key === "Escape") cancel();
  }
  function click(event) {
    if (
      !notice?.contains(event.target) &&
      !event.target.closest?.("[data-secondary-entry]")
    )
      cancel();
  }
  function languageChanged() {
    if (pending && notice)
      showNotice(pending, notice.dataset.secondaryStatus === "failed");
  }
  function dispose() {
    closed = true;
    cancel();
    stopIdle();
    clearTimeout(introTimer);
    if (frame) cancelAnimationFrame(frame);
    document.removeEventListener("visibilitychange", visibility);
    document.removeEventListener("keydown", keydown);
    document.removeEventListener("click", click, true);
    document.removeEventListener("worktime:languagechange", languageChanged);
    window.removeEventListener("pagehide", dispose);
    document.removeEventListener("worktime:failed", dispose);
  }
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("keydown", keydown);
  document.addEventListener("click", click, true);
  document.addEventListener("worktime:languagechange", languageChanged);
  window.addEventListener("pagehide", dispose, { once: true });
  document.addEventListener("worktime:failed", dispose, { once: true });
  return {
    afterIntro,
    request,
    cancel,
    get state() {
      return closed
        ? "closed"
        : completedAt !== null
          ? "ready"
          : failed
            ? "failed"
            : loading
              ? "loading"
              : "waiting";
    },
    get completedAt() {
      return completedAt;
    },
    get startedAt() {
      return startedAt;
    },
    deferSettings(run) {
      if (loaded(["settings", "personal"])) {
        cancel();
        return false;
      }
      request(
        ["settings", "personal"],
        run,
        document.getElementById("pageSettingsOpen"),
      );
      return true;
    },
    register(name, options) {
      const record = { options, value: null, disposed: false };
      records.set(name, record);
      return record;
    },
  };
})();

WorkTimeApp.ui.createSettingsController = function (options) {
  const manager = WorkTimeApp.ui.secondaryControllers,
    record = manager.register("settings", options),
    events = WorkTimeApp.ui.createEventScope();
  return {
    bind() {
      const button = options.element("setupButton");
      button.dataset.secondaryEntry = "settings";
      options.element("pageSettingsOpen").dataset.secondaryEntry = "settings";
      events.handler(button, "onclick", () => {
        if (options.model.batchMode) {
          if (options.model.batchSaving) return;
          options.actions.leaveBatch();
        }
        options.actions.open("settingsDialog");
      });
    },
    dispose() {
      record.disposed = true;
      record.value?.dispose();
      events.dispose();
    },
    hasDraft: () => record.value?.hasDraft() || false,
    hasScheduleDraft: () => record.value?.hasScheduleDraft() || false,
    onSaveRecovered: () => record.value?.onSaveRecovered(),
    refreshSettings: () => record.value?.refreshSettings(),
    requestSettingsLeave(continuation) {
      if (record.value) record.value.requestSettingsLeave(continuation);
      else continuation();
    },
    requestSettingsExit(continuation) {
      if (record.value) record.value.requestSettingsExit(continuation);
      else continuation();
    },
  };
};
WorkTimeApp.ui.createPersonalSettingsController = function (options) {
  const record = WorkTimeApp.ui.secondaryControllers.register(
    "personal",
    options,
  );
  return {
    bind() {},
    dispose() {
      record.disposed = true;
      record.value?.dispose();
    },
    hasDraft: () => record.value?.hasDraft() || false,
    onSaveRecovered: () => record.value?.onSaveRecovered(),
  };
};
WorkTimeApp.ui.createImportController = function (options) {
  const manager = WorkTimeApp.ui.secondaryControllers,
    record = manager.register("imports", options),
    events = WorkTimeApp.ui.createEventScope(),
    $ = options.element;
  let hold = null;
  let oaReturn = null;
  function readOnReturn() {
    const visit = oaReturn;
    if (
      !visit ||
      !visit.left ||
      visit.consumed ||
      document.hidden ||
      !document.hasFocus() ||
      !record.value ||
      !$("importDialog").open
    )
      return;
    visit.consumed = true;
    void record.value.readReturnedClipboard(() => oaReturn === visit);
  }
  function leftOAEntry() {
    if (oaReturn) oaReturn.left = true;
  }
  function run(method, trigger, ...args) {
    manager.request(
      ["imports"],
      (valid) => {
        record.value[method](...args, valid);
        if (method === "openImport") readOnReturn();
      },
      trigger,
    );
  }
  function editLink() {
    run("editOALink", $("oaShortcut"));
  }
  function openWebsite() {
    manager.cancel();
    if (!options.model.state.oaUrl) {
      editLink();
      return false;
    }
    try {
      const url = new URL(options.model.state.oaUrl);
      if (!["http:", "https:"].includes(url.protocol))
        throw Error(WorkTimeApp.i18n.t("copy.617fe2d78b"));
      options.actions.finishSidebarNavigation();
      window.open(url.href, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      editLink();
      return false;
    }
  }
  return {
    bind() {
      for (const id of [
        "importOpen",
        "sourceOpen",
        "oaShortcut",
        "importOASite",
      ])
        $(id).dataset.secondaryEntry = "imports";
      events.handler($("importOpen"), "onclick", () =>
        run("openImport", $("importOpen"), undefined),
      );
      events.handler($("sourceOpen"), "onclick", () =>
        run("showSources", $("sourceOpen")),
      );
      events.handler($("importOASite"), "onclick", () => {
        oaReturn = { left: false, consumed: false };
        if (record.value) {
          record.value.openImport({ motionDuration: 0 });
          if (!openWebsite()) oaReturn = null;
        } else if (openWebsite()) {
          run("openImport", $("importOASite"), { motionDuration: 0 });
        } else oaReturn = null;
      });
      events.listen(window, "blur", leftOAEntry);
      events.listen(window, "focus", readOnReturn);
      events.listen(document, "visibilitychange", () => {
        if (document.hidden) leftOAEntry();
        else readOnReturn();
      });
      hold = WorkTimeApp.ui.createHoldAction({
        button: $("oaShortcut"),
        enabled: () => !!options.model.state.oaUrl,
        onShort: openWebsite,
        onLong: editLink,
        cancelShortAfterFeedback: true,
      });
      events.listen($("importDialog"), "close", () => {
        hold.cancel();
        oaReturn = null;
      });
    },
    dispose() {
      oaReturn = null;
      record.disposed = true;
      record.value?.dispose();
      hold?.dispose();
      events.dispose();
    },
    hasDraft: () => record.value?.hasDraft() || false,
  };
};

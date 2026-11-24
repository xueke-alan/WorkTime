"use strict";
WorkTimeApp.services.vocabularyIdle = (() => {
  const id = "worktime.vocabulary.audio-settings";
  // A finite, JSON-safe ceiling represents no application-imposed limit.
  const limits = [
    5 * 1024 ** 3,
    15 * 1024 ** 3,
    20 * 1024 ** 3,
    Number.MAX_SAFE_INTEGER,
  ];
  const poolSizes = ["auto", 1, 2, 4, 8];
  const normalizeLimit = (value) =>
    limits.find((limit) => limit >= value) ?? limits[0];
  const normalizePool = (value) =>
    Number.isInteger(value) && value >= 1 && value <= 8
      ? poolSizes.find((size) => typeof size === "number" && size >= value)
      : "auto";
  let settings = {
    enabled: true,
    paused: false,
    limit: limits[0],
    poolSize: "auto",
  };
  function profile(accent, entry) {
    if (accent === "us")
      return {
        engine: "supertonic",
        voice: "F1",
        speed: entry?.kind === "example" ? 1 : 1.05,
        steps: 16,
      };
    return {
      voice: "en_GB-jenny_dioco-medium",
      speed: 1,
      speaker: 0,
      noiseScale: 0.5,
      noiseW: 0.333,
    };
  }
  let timer,
    loaded,
    stopped = true,
    running = false,
    resumeAt = Date.now() + 2000,
    epoch = 0;
  const pointers = new Map();
  let composing = false,
    nativeDragging = false,
    interactionObserver;
  const modelTasks = new Set();
  let layoutDragging = false;
  let queue,
    queueIndex = 0,
    signature = "",
    unsubscribe,
    unsubscribeFolder,
    unsubscribeSpeech,
    unsubscribeCache,
    folderRevision;
  let state = "waiting",
    preparation = "",
    completed = 0,
    total = 0,
    retryAt = 0;
  let errorDetail = "";
  let day = new Date().toDateString();
  let verification = false;
  const listeners = new Set();
  function readSettings() {
    try {
      const value = JSON.parse(localStorage.getItem(id));
      if (value)
        settings = {
          poolSize: normalizePool(value.poolSize),
          enabled: value.enabled !== false,
          paused: value.paused === true,
          limit: normalizeLimit(value.limit),
        };
      if (value && (value.models !== undefined || value.voices !== undefined))
        localStorage.setItem(id, JSON.stringify(settings));
    } catch {
      /* Device settings are optional. */
    }
  }
  readSettings();
  function notify(value = state) {
    state = value;
    listeners.forEach((fn) => fn());
  }
  function release() {
    WorkTimeApp.services.vocabularySpeech?.release();
  }
  function invalidate(releaseModel = true) {
    epoch++;
    queue = null;
    queueIndex = 0;
    completed = total = 0;
    retryAt = 0;
    errorDetail = "";
    if (releaseModel) release();
    notify("waiting");
  }
  function configure(value) {
    settings = {
      poolSize: poolSizes.includes(value.poolSize)
        ? value.poolSize
        : settings.poolSize,
      enabled:
        typeof value.enabled === "boolean" ? value.enabled : settings.enabled,
      paused:
        typeof value.paused === "boolean" ? value.paused : settings.paused,
      limit: value.limit === undefined ? settings.limit : value.limit,
    };
    settings.limit = normalizeLimit(settings.limit);
    try {
      localStorage.setItem(id, JSON.stringify(settings));
    } catch {
      /* Keep session settings. */
    }
    invalidate();
    schedule();
  }
  function observeSpeech() {
    if (stopped || unsubscribeSpeech || !WorkTimeApp.services.vocabularySpeech)
      return;
    unsubscribeSpeech = WorkTimeApp.services.vocabularySpeech.subscribe(() =>
      notify(),
    );
    unsubscribeCache = WorkTimeApp.services.vocabularyAudioCache.subscribe(() =>
      notify(),
    );
    notify();
  }
  async function load() {
    const assets = WorkTimeApp.services.assets;
    loaded ||= Promise.all([
      assets.script("assets/vendor/vocabulary/fsrs.js"),
      assets.script("assets/data/vocabulary/catalog.js"),
      assets.script("assets/js/vocabulary-engine.js"),
      assets.script("assets/js/services/vocabulary-file-index.js"),
    ])
      .then(() =>
        assets.scripts([
          "assets/js/services/vocabulary-audio-cache.js",
          "assets/js/services/vocabulary-models.js",
          "assets/js/services/vocabulary-speech.js",
        ]),
      )
      .then(observeSpeech)
      .catch((error) => {
        loaded = null;
        throw error;
      });
    return loaded;
  }
  function dataSignature(data) {
    return JSON.stringify([
      data.settings.book,
      data.settings.accent,
      profile(data.settings.accent),
      data.settings.mode,
      data.settings.dailyTotal ?? data.settings.dailyNew,
      data.settings.wordOrder,
      data.settings.orderSeed,
      data.logs.length,
      data.cards,
      new Date().toDateString(),
    ]);
  }
  function schedule(delay = 1000) {
    clearTimeout(timer);
    if (!stopped)
      timer = setTimeout(() => {
        void tick();
      }, delay);
  }
  function validTask(token) {
    return !stopped && token === epoch && settings.enabled && !settings.paused;
  }
  function allowed(token) {
    return validTask(token) && interactionAllowed();
  }
  function interactionAllowed() {
    return (
      Date.now() >= resumeAt &&
      !composing &&
      !nativeDragging &&
      !layoutDragging &&
      !modelTasks.size &&
      ![...pointers.values()].some((pointer) => pointer.dragging) &&
      !WorkTimeApp.services.vocabularySpeech?.active
    );
  }
  async function step(token) {
    const canMaintain = () =>
      !stopped &&
      token === epoch &&
      interactionAllowed() &&
      (verification || (settings.enabled && !settings.paused));
    if (!canMaintain()) return;
    preparation = "checkingFolder";
    notify("running");
    const folder = WorkTimeApp.services.runtimeFolder;
    await folder?.initialize();
    if (!folder || folder.state.status !== "available" || folder.state.busy) {
      release();
      notify("folder");
      return;
    }
    preparation = "loadingAssets";
    notify();
    await load();
    if (!canMaintain()) return;
    const cache = WorkTimeApp.services.vocabularyAudioCache;
    preparation = "indexingCache";
    const info = await cache.info({ canRun: canMaintain });
    if (!info.available) {
      release();
      notify("folder");
      return;
    }
    if (!info.bytesExact) {
      release();
      notify("indexing");
      return;
    }
    verification = false;
    if (!allowed(token)) {
      notify(settings.enabled ? "paused" : "disabled");
      return;
    }
    if (!queue) {
      preparation = "buildingQueue";
      notify();
      const data = WorkTimeApp.services.vocabularyStorage.read();
      const entries = WorkTimeApp.data.vocabularyCatalog.entries;
      const engine = WorkTimeApp.services.vocabularyEngine;
      const today = engine.queue(data, entries);
      const todayKey = engine.day(Date.now());
      const learnedToday = new Set(
        data.logs
          .filter((log) => engine.day(log.at) === todayKey)
          .map((log) => log.id),
      );
      const priority = [
        ...today.due,
        ...today.fresh,
        ...entries.filter((entry) => learnedToday.has(entry.id)),
      ];
      const selected = data.settings.accent;
      const other = selected === "us" ? "uk" : "us";
      const seen = new Set();
      queue = [];
      const append = (list, accent) => {
        for (const entry of list) {
          const identity = cache.key(entry, accent);
          if (seen.has(identity)) continue;
          seen.add(identity);
          queue.push({ entry, accent });
        }
      };
      const appendExamples = (list, accent) => {
        for (const entry of list)
          for (const example of entry.examples || [])
            append([{ word: example.en, kind: "example" }], accent);
      };
      append(priority, selected);
      append(priority, other);
      appendExamples(priority, selected);
      appendExamples(priority, other);
      append(entries, selected);
      append(entries, other);
      appendExamples(entries, selected);
      appendExamples(entries, other);
      completed = 0;
      queueIndex = 0;
      total = queue.length;
    }
    if (!allowed(token)) return;
    const speech = WorkTimeApp.services.vocabularySpeech;
    const batch = queue.slice(queueIndex, queueIndex + speech.poolSize);
    if (!batch.length) {
      release();
      notify("complete");
      return;
    }
    preparation = "";
    notify("running");
    const before = speech.metrics;
    const started = performance.now();
    let lag = 0,
      expected = performance.now() + 100;
    const probe = setInterval(() => {
      const now = performance.now();
      lag = Math.max(lag, now - expected);
      expected = now + 100;
    }, 100);
    let results;
    try {
      results = await Promise.allSettled(
        batch.map((item) =>
          speech.synthesize(item.entry, item.accent, {
            background: true,
            valid: () => validTask(token),
            canStart: () => allowed(token),
          }),
        ),
      );
    } finally {
      lag = Math.max(lag, performance.now() - expected);
      clearInterval(probe);
    }
    if (!validTask(token)) return;
    const after = speech.metrics;
    speech.recordBatch({
      count: after.generatedCount - before.generatedCount,
      milliseconds: performance.now() - started,
      cold: after.coldCount !== before.coldCount,
      lag,
    });
    // Advance only past a contiguous successful prefix. Later successes remain
    // cached and are cheap to revisit if an earlier task was deferred or failed.
    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) break;
      queueIndex++;
      completed++;
    }
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    if (queueIndex >= queue.length) {
      release();
      notify("complete");
    } else notify(allowed(token) ? "running" : "waiting");
  }

  async function tick() {
    if (stopped || running) return;
    if (day !== new Date().toDateString()) {
      day = new Date().toDateString();
      changed();
    }
    const token = epoch;
    if ((!settings.enabled || settings.paused) && !verification) {
      notify(settings.enabled ? "paused" : "disabled");
      schedule();
      return;
    }
    if (Date.now() < retryAt) {
      schedule();
      return;
    }
    if (!interactionAllowed()) {
      notify("waiting");
      schedule();
      return;
    }
    if (
      !verification &&
      state === "complete" &&
      queue &&
      queueIndex >= queue.length
    ) {
      schedule(10000);
      return;
    }
    running = true;
    try {
      // Without same-origin locks, background generation is disabled rather than duplicated.
      if (!navigator.locks) {
        notify("unsupported");
        return;
      }
      await navigator.locks.request(
        "worktime-vocabulary-generation",
        { ifAvailable: true },
        async (lock) => {
          if (lock) {
            await step(token);
            if (token === epoch) errorDetail = "";
          } else {
            release();
            notify("otherTab");
          }
        },
      );
    } catch (error) {
      release();
      if (token === epoch) {
        if (error.cacheCode === "models") {
          errorDetail = "";
          notify("waiting");
          retryAt = Date.now() + 10000;
        } else {
          errorDetail = error.name + ": " + error.message;
          console.warn("Vocabulary background generation failed", error);
          notify(error.cacheCode === "capacity" ? "capacity" : "error");
          retryAt =
            error.cacheCode === "capacity" ? Infinity : Date.now() + 60000;
        }
      }
    } finally {
      preparation = "";
      running = false;
      notify();
      // Yield to input and release the cross-tab lock without a per-word delay.
      schedule(state === "running" || state === "indexing" ? 0 : 1000);
    }
  }
  function defer() {
    resumeAt = Date.now() + 2000;
    if (!running && state !== "complete") notify("waiting");
    if (!running) schedule();
  }
  function editing(target) {
    return (
      target instanceof Element &&
      !!target.closest(
        'textarea, [contenteditable]:not([contenteditable="false"]), input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"])',
      )
    );
  }
  function activity(event) {
    if (["beforeinput", "input"].includes(event.type)) {
      if (editing(event.target)) defer();
    } else if (event.type === "compositionstart") {
      if (editing(event.target)) {
        composing = true;
        defer();
      }
    } else if (event.type === "compositionend") {
      composing = false;
      defer();
    } else if (event.type === "pointerdown") {
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        dragging: false,
      });
    } else if (event.type === "pointermove") {
      const pointer = pointers.get(event.pointerId);
      if (
        pointer &&
        (pointer.dragging ||
          Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6)
      ) {
        pointer.dragging = true;
        defer();
      }
    } else if (["pointerup", "pointercancel"].includes(event.type)) {
      if (pointers.get(event.pointerId)?.dragging) defer();
      pointers.delete(event.pointerId);
    } else if (event.type === "dragstart") {
      nativeDragging = true;
      defer();
    } else if (["dragend", "drop"].includes(event.type)) {
      nativeDragging = false;
      defer();
    } else if (event.type === "blur" && event.target === window) {
      if (composing || nativeDragging || pointers.size) defer();
      composing = nativeDragging = false;
      pointers.clear();
    }
  }
  function observeInteraction(records) {
    // Ignore unrelated animation and status mutations elsewhere in the page.
    if (
      records &&
      !records.some((record) =>
        record.type === "childList"
          ? [...record.addedNodes, ...record.removedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches("#gameShell,.workspace,.agenda-timetable") ||
                  node.querySelector("#gameShell,.agenda-timetable")),
            )
          : record.target === document.body ||
            record.target.matches(".workspace,#gameShell,.agenda-timetable"),
      )
    )
      return;
    const nextDrag =
      document.body.classList.contains("agenda-is-dragging") ||
      document.body.classList.contains("agenda-is-resizing") ||
      document.body.classList.contains("agenda-timetable-resizing") ||
      !!document.querySelector(".agenda-timetable.is-dragging");
    if (layoutDragging !== nextDrag) {
      layoutDragging = nextDrag;
      defer();
    }
  }
  function storage(event) {
    if (event.key === id) {
      WorkTimeApp.services.vocabularySpeech?.stop();
      readSettings();
      invalidate();
      schedule();
    }
  }
  function changed() {
    const next = dataSignature(WorkTimeApp.services.vocabularyStorage.read());
    if (next !== signature) {
      signature = next;
      invalidate();
      schedule();
    }
  }
  const events = [
    "beforeinput",
    "input",
    "compositionstart",
    "compositionend",
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
    "dragstart",
    "dragend",
    "drop",
    "blur",
  ];
  return {
    beginModelTask() {
      const token = {};
      modelTasks.add(token);
      defer();
      return () => {
        if (modelTasks.delete(token)) defer();
      };
    },
    trackModel(controller) {
      for (const name of ["load", "search"]) {
        const original = controller[name];
        if (!original) continue;
        controller[name] = (...args) => {
          const finish = this.beginModelTask();
          try {
            return Promise.resolve(original.apply(controller, args)).finally(
              finish,
            );
          } catch (error) {
            finish();
            throw error;
          }
        };
      }
      return controller;
    },
    // Resource warming shares interaction rules, independently of audio settings.
    whenIdle({ signal } = {}) {
      return new Promise((resolve, reject) => {
        let timeout;
        const finish = (error) => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve();
        };
        const abort = () => finish(new DOMException("Cancelled", "AbortError"));
        const check = () => {
          if (
            !stopped &&
            document.readyState === "complete" &&
            !document.documentElement.classList.contains("app-loading") &&
            interactionAllowed()
          )
            finish();
          else timeout = setTimeout(check, 100);
        };
        if (signal?.aborted) return abort();
        signal?.addEventListener("abort", abort, { once: true });
        check();
      });
    },
    load,
    profile,
    configure,
    async verify() {
      await load();
      invalidate(false);
      verification = true;
      try {
        if (!(await WorkTimeApp.services.vocabularyAudioCache.verify()))
          throw Error("Audio folder unavailable");
      } catch (error) {
        verification = false;
        throw error;
      }
      schedule();
    },
    limits,
    poolSizes,
    get settings() {
      return { ...settings };
    },
    get state() {
      const speech = WorkTimeApp.services.vocabularySpeech;
      let audioPhase =
        state === "running"
          ? "betweenWords"
          : state === "indexing"
            ? "indexingCache"
            : state;
      if (state === "waiting") {
        audioPhase = modelTasks.size
          ? "waitingGame"
          : composing
            ? "waitingInput"
            : nativeDragging ||
                layoutDragging ||
                [...pointers.values()].some((p) => p.dragging)
              ? "waitingDrag"
              : speech?.active
                ? "waitingPlayback"
                : "waitingIdle";
      }
      if (running && preparation) audioPhase = preparation;
      if (speech?.busy || ["loading", "generating"].includes(speech?.status))
        audioPhase = speech.phase === "idle" ? speech.status : speech.phase;
      return {
        status: state,
        audioPhase,
        errorDetail,
        poolSize:
          speech?.poolSize ??
          (settings.poolSize === "auto"
            ? (navigator.hardwareConcurrency || 2) <= 4
              ? 1
              : 2
            : settings.poolSize),
        speechStatus: WorkTimeApp.services.vocabularySpeech?.status || "idle",
        currentWord: WorkTimeApp.services.vocabularySpeech?.currentWord || "",
        audioGenerating:
          !!speech?.busy ||
          state === "running" ||
          ["loading", "generating"].includes(
            WorkTimeApp.services.vocabularySpeech?.status,
          ),
        completed,
        total,
        verifyingCache: verification,
        ...(WorkTimeApp.services.vocabularyAudioCache?.progress(
          WorkTimeApp.services.vocabularySpeech?.browserKeys || [],
        ) || { generatedTotal: 0, audioTotal: 0 }),
        ...(WorkTimeApp.services.vocabularyAudioCache?.state || {
          count: 0,
          bytes: 0,
          available: false,
        }),
      };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start() {
      if (!stopped) return;
      stopped = false;
      observeSpeech();
      resumeAt = Date.now() + 2000;
      composing = nativeDragging = false;
      pointers.clear();
      observeInteraction();
      interactionObserver = new MutationObserver(observeInteraction);
      interactionObserver.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "hidden"],
      });
      signature = dataSignature(WorkTimeApp.services.vocabularyStorage.read());
      unsubscribe = WorkTimeApp.services.vocabularyStorage.subscribe(changed);
      unsubscribeFolder = WorkTimeApp.services.runtimeFolder?.subscribe(() => {
        const folder = WorkTimeApp.services.runtimeFolder.state;
        if (
          folderRevision !== folder.revision ||
          folder.busy ||
          folder.status !== "available"
        ) {
          folderRevision = folder.revision;
          invalidate();
          schedule();
        }
      });
      for (const event of events)
        window.addEventListener(event, activity, {
          passive: true,
          capture: true,
        });
      window.addEventListener("storage", storage);
      window.addEventListener("pageshow", changed);
      window.addEventListener("pagehide", this.dispose, { once: true });
      schedule();
    },
    dispose() {
      stopped = true;
      epoch++;
      clearTimeout(timer);
      interactionObserver?.disconnect();
      pointers.clear();
      release();
      unsubscribe?.();
      unsubscribeFolder?.();
      unsubscribeSpeech?.();
      unsubscribeCache?.();
      unsubscribeCache = null;
      unsubscribeSpeech = null;
      verification = false;
      for (const event of events)
        window.removeEventListener(event, activity, true);
      window.removeEventListener("storage", storage);
      window.removeEventListener("pageshow", changed);
    },
  };
})();

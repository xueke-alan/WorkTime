"use strict";
WorkTimeApp.services.vocabularySpeech = (() => {
  // Resource scripts publish through a shared global; initialize lanes in order.
  let initializationQueue = Promise.resolve();
  const root = new URL("../../../", document.currentScript.src);
  const browserKeys = new Set();
  function createLane() {
    const filesCache = WorkTimeApp.services.vocabularyAudioCache;
    try {
      localStorage.removeItem("worktime.vocabulary.speech-model");
    } catch {
      /* Optional device preference. */
    }
    let releaseTimer,
      foreground = 0,
      working = false,
      releasePending = false;
    let worker,
      initialization,
      initializedEngine,
      audio,
      audioURL,
      playbackSynthesis,
      database,
      serial = Promise.resolve();
    let sequence = 0,
      workerEpoch = 0,
      generation = 0,
      playingGeneratedAudio = false,
      cacheHealthy = true,
      status = "idle",
      phase = "idle",
      currentSynthesis = null;
    const busyPhases = new Set([
      "checkingFiles",
      "checkingBrowser",
      "loadingResources",
      "loadingModel",
      "initializingModel",
      "generating",
      "savingFiles",
      "savingBrowser",
    ]);
    const pending = new Map(),
      listeners = new Set();
    const notify = (value, nextPhase = value) => {
      if (value === "ready" && !cacheHealthy) value = "cacheWarning";
      status = value;
      phase = nextPhase;
      if (!busyPhases.has(nextPhase)) currentSynthesis = null;
      listeners.forEach((fn) => fn(value));
    };
    const setPhase = (value) => notify(status, value);
    function db() {
      return (database ||= new Promise((resolve, reject) => {
        const r = indexedDB.open("worktime-vocabulary-audio", 2);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains("audio"))
            r.result.createObjectStore("audio", { keyPath: "key" });
          else r.transaction.objectStore("audio").clear();
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }).catch((error) => {
        database = null;
        throw error;
      }));
    }
    async function cache(action) {
      const database = await db();
      return new Promise((resolve, reject) => {
        const tx = database.transaction("audio", "readwrite");
        let result;
        action(tx.objectStore("audio"), (value) => {
          result = value;
        });
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () =>
          reject(tx.error || Error("Audio cache failed"));
      });
    }
    async function loadPart(path) {
      WorkTimeApp.data.vocabularyChunks = [];
      const url = new URL(path, root);
      const version = WorkTimeApp.data.assetVersions?.[path];
      if (version) url.searchParams.set("v", version);
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        const timer = setTimeout(
          () => finish(Error("Speech resource timed out")),
          30000,
        );
        function finish(error) {
          clearTimeout(timer);
          script.remove();
          if (error) reject(error);
          else resolve();
        }
        script.onload = () => finish();
        script.onerror = () => finish(Error("Speech resource missing"));
        script.src = url.href;
        document.head.append(script);
      });
      const encoded = WorkTimeApp.data.vocabularyChunks.pop();
      WorkTimeApp.data.vocabularyChunks = [];
      if (!encoded) throw Error("Empty speech resource");
      return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    }
    async function readBrowser(key) {
      try {
        const row = await cache((store, done) => {
          const request = store.get(key);
          request.onsuccess = () => {
            if (request.result) {
              request.result.used = Date.now();
              store.put(request.result);
            }
            done(request.result);
          };
        });
        if (!row) return null;
        const bytes = await row.blob.arrayBuffer();
        if (
          filesCache.validWav(bytes) &&
          row.sha256 === (await filesCache.hash(bytes))
        ) {
          browserKeys.add(key);
          return row.blob;
        }
        await cache((store) => store.delete(key));
        browserKeys.delete(key);
      } catch {
        cacheHealthy = false;
      }
      return null;
    }
    async function writeBrowser(key, blob) {
      try {
        const sha256 = await filesCache.hash(await blob.arrayBuffer());
        await cache((store) => {
          const request = store.getAll();
          request.onsuccess = () => {
            const rows = request.result
              .filter((row) => row.key !== key)
              .sort((a, b) => a.used - b.used);
            let bytes = rows.reduce((n, row) => n + row.size, blob.size);
            while (bytes > 200 * 1024 ** 2 && rows.length) {
              const row = rows.shift();
              bytes -= row.size;
              store.delete(row.key);
              browserKeys.delete(row.key);
            }
            store.put({ key, blob, sha256, size: blob.size, used: Date.now() });
            browserKeys.add(key);
          };
        });
      } catch {
        cacheHealthy = false;
      }
    }
    // Restore device-wide browser-cache progress without loading the model.
    void cache((store, done) => {
      const request = store.getAllKeys();
      request.onsuccess = () => {
        const keys = request.result.filter((key) => {
          if (!filesCache.obsolete(key)) return true;
          store.delete(key);
          return false;
        });
        done(keys);
      };
    })
      .then((keys) => {
        for (const key of keys || []) browserKeys.add(key);
        notify(status, phase);
      })
      .catch(() => {});
    function request(data, transfer = []) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("Speech generation timed out"));
          reset();
        }, 180000);
        pending.set(id, {
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
          reject(error) {
            clearTimeout(timer);
            reject(error);
          },
        });
        worker.postMessage({ ...data, id }, transfer);
      });
    }
    function reset() {
      workerEpoch++;
      clearTimeout(releaseTimer);
      worker?.terminate();
      worker = null;
      initialization = null;
      initializedEngine = null;
      for (const job of pending.values())
        job.reject(Error("Speech worker stopped"));
      pending.clear();
    }
    async function initialize(profile, allowDownload = true) {
      const engine = profile.engine || "piper";
      if (initialization && initializedEngine === engine) return initialization;
      if (initialization) reset();
      initializedEngine = engine;
      const epoch = workerEpoch;
      initialization = initializationQueue
        .catch(() => {})
        .then(async () => {
          if (epoch !== workerEpoch) throw Error("Speech worker changed");
          notify("loading", "loadingResources");
          await WorkTimeApp.services.assets.scripts([
            "assets/vendor/vocabulary/manifest.js",
            "assets/vendor/vocabulary/" +
              (engine === "piper"
                ? "worker-source.js"
                : "supertonic-worker-source.js"),
          ]);
          if (epoch !== workerEpoch) throw Error("Speech worker changed");
          const definition = WorkTimeApp.data.vocabularySpeech;
          const files = {};
          const required = new Set([
            ...(definition.groups?.[engine] || Object.keys(definition.files)),
            "mjs",
            "wasm",
          ]);
          for (const name of required) {
            const file = definition.files[name];
            setPhase("loadingModel");
            const bytes = await filesCache.part(
              name.replaceAll("/", "-"),
              file,
              async () => {
                if (file.url)
                  if (allowDownload)
                    return WorkTimeApp.services.vocabularyModels.download(file);
                  else
                    throw Object.assign(
                      Error("Speech models need download or import"),
                      { cacheCode: "models" },
                    );
                const bytes = new Uint8Array(file.bytes);
                let offset = 0;
                for (const part of file.parts) {
                  const chunk = await loadPart(part);
                  bytes.set(chunk, offset);
                  offset += chunk.length;
                }
                if (offset !== file.bytes)
                  throw Error("Incomplete speech resource");
                return bytes;
              },
              engine,
            );
            files[name] = bytes.buffer;
            if (epoch !== workerEpoch) throw Error("Speech worker changed");
          }
          const url = URL.createObjectURL(
            new Blob([WorkTimeApp.data.vocabularyWorkers[engine]], {
              type: "text/javascript",
            }),
          );
          try {
            worker = new Worker(url);
          } finally {
            URL.revokeObjectURL(url);
          }
          worker.onmessage = ({ data }) => {
            const job = pending.get(data.id);
            if (!job) return;
            pending.delete(data.id);
            if (data.type === "error") job.reject(Error(data.message));
            else job.resolve(data);
          };
          worker.onerror = () => {
            reset();
            notify("failed");
          };
          coldCount++;
          setPhase("initializingModel");
          await request({ type: "init", files }, Object.values(files));
          notify("ready");
        })
        .catch((error) => {
          if (epoch === workerEpoch) {
            reset();
            notify(error.cacheCode === "models" ? "idle" : "failed");
          }
          throw error;
        });
      initializationQueue = initialization.catch(() => {});
      return initialization;
    }
    function finishPlaybackSynthesis() {
      const listener = playbackSynthesis;
      playbackSynthesis = null;
      listener?.(false);
    }
    function stop() {
      generation++;
      finishPlaybackSynthesis();
      playingGeneratedAudio = false;
      if (currentSynthesis && !currentSynthesis.valid()) notify("idle");
      audio?.pause();
      audio = null;
      if (audioURL) URL.revokeObjectURL(audioURL);
      audioURL = null;
    }
    function synthesize(
      entry,
      accent,
      { background = false, valid = () => true, canStart = () => true } = {},
    ) {
      const profile = WorkTimeApp.services.vocabularyIdle.profile(
        accent,
        entry,
      );
      if (!background) foreground++;
      clearTimeout(releaseTimer);
      const job = serial
        .catch(() => {})
        .then(async () => {
          clearTimeout(releaseTimer);
          if (!background) releasePending = false;
          if (!valid()) return null;
          working = true;
          const current = () =>
            valid() &&
            JSON.stringify(profile) ===
              JSON.stringify(
                WorkTimeApp.services.vocabularyIdle.profile(accent, entry),
              );
          if (!current()) return null;
          currentSynthesis = { word: entry.word, valid: current };
          const key = filesCache.key(entry, accent, profile);
          const limit = WorkTimeApp.services.vocabularyIdle.settings.limit;
          let blob;
          try {
            setPhase("checkingFiles");
            blob = await filesCache.read(entry, accent, profile);
          } catch (error) {
            cacheHealthy = false;
            if (background) throw error;
          }
          if (blob) {
            notify("ready");
            return blob;
          }
          setPhase("checkingBrowser");
          blob = await readBrowser(key);
          if (blob) {
            if (!current()) return null;
            try {
              setPhase("savingFiles");
              if (
                await filesCache.write(
                  entry,
                  accent,
                  blob,
                  limit,
                  current,
                  profile,
                )
              )
                await cache((store) => store.delete(key));
              else if (background) throw Error("Speech folder unavailable");
            } catch (error) {
              cacheHealthy = false;
              if (background) throw error;
            }
            notify("ready");
            return blob;
          }
          if (!current()) return null;
          if (background && (foreground || !canStart())) return null;
          if (
            background &&
            (!filesCache.state.available || filesCache.state.bytes >= limit)
          )
            throw Object.assign(Error("Audio cache unavailable or full"), {
              cacheCode: filesCache.state.available ? "capacity" : "folder",
            });
          await initialize(profile, !background);
          if (!current() || (background && (foreground || !canStart())))
            return null;
          currentSynthesis = {
            word: entry.word,
            kind: entry.kind === "example" ? "example" : "word",
            valid: current,
          };
          notify("generating");
          const started = performance.now();
          const result = await request({
            type: "generate",
            text: entry.word,
            accent,
            ...profile,
          });
          generatedCount++;
          inferenceMilliseconds += performance.now() - started;
          blob = new Blob([result.buffer], { type: "audio/wav" });
          if (
            !filesCache.validWav(
              result.buffer,
              profile.engine === "supertonic" ? 44100 : 22050,
            )
          )
            throw Error("Invalid speech WAV");
          if (!current()) return null;
          let saved = false;
          try {
            setPhase("savingFiles");
            saved = await filesCache.write(
              entry,
              accent,
              blob,
              limit,
              current,
              profile,
            );
          } catch (error) {
            cacheHealthy = false;
            if (background) throw error;
          }
          if (!saved) {
            if (!current()) return null;
            if (background) throw Error("Speech folder unavailable");
            setPhase("savingBrowser");
            await writeBrowser(key, blob);
          }
          notify("ready");
          return blob;
        });
      serial = job
        .catch((error) => {
          releasePending = true;
          notify(error.cacheCode === "models" ? "idle" : "failed");
          throw error;
        })
        .finally(() => {
          if (currentSynthesis || busyPhases.has(phase)) notify("idle");
          working = false;
          if (!background) foreground--;
          if (releasePending && !foreground) {
            releasePending = false;
            reset();
            notify("idle", phase === "failed" ? "failed" : "idle");
          } else
            releaseTimer = setTimeout(() => {
              reset();
              notify("idle");
            }, 60000);
        });
      return serial;
    }
    return {
      get browserKeys() {
        return [...browserKeys];
      },
      initialize,
      synthesize,
      stop,
      get active() {
        return (
          foreground > 0 ||
          (playingGeneratedAudio && !!audio && !audio.paused && !audio.ended)
        );
      },
      release() {
        if (working || foreground) releasePending = true;
        else {
          reset();
          notify("idle");
        }
      },
      get status() {
        return status;
      },
      get phase() {
        return phase;
      },
      get busy() {
        return busyPhases.has(phase);
      },
      get currentWord() {
        return currentSynthesis?.valid() ? currentSynthesis.word : "";
      },
      get generatingKind() {
        return phase === "generating" && currentSynthesis?.valid()
          ? currentSynthesis.kind
          : "";
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async play(entry, accent, onSynthesis) {
        stop();
        const token = generation;
        try {
          // Cached playback bypasses the synthesis queue and its activity state.
          const profile = WorkTimeApp.services.vocabularyIdle.profile(
            accent,
            entry,
          );
          let blob;
          try {
            blob = await filesCache.read(entry, accent, profile);
          } catch {
            /* Try the browser cache before falling back to synthesis. */
          }
          if (token !== generation) return false;
          blob ||= await readBrowser(filesCache.key(entry, accent, profile));
          if (token !== generation) return false;
          const needsSynthesis = !blob;
          if (needsSynthesis) {
            playbackSynthesis = onSynthesis;
            try {
              onSynthesis?.(true);
              blob = await WorkTimeApp.services.vocabularySpeech.synthesize(
                entry,
                accent,
                { valid: () => token === generation },
              );
            } finally {
              if (token === generation) finishPlaybackSynthesis();
            }
          }
          if (!blob || token !== generation) return false;
          audioURL = URL.createObjectURL(blob);
          audio = new Audio(audioURL);
          playingGeneratedAudio = needsSynthesis;
          audio.addEventListener(
            "ended",
            () => {
              if (token === generation) stop();
            },
            { once: true },
          );
          await audio.play();
          return true;
        } catch (error) {
          if (token !== generation) return false;
          notify("failed");
          throw error;
        }
      },
      async prefetch(entries, accent) {
        const token = generation;
        for (const entry of entries.slice(0, 3)) {
          if (token !== generation) return;
          try {
            await WorkTimeApp.services.vocabularySpeech.synthesize(
              entry,
              accent,
            );
          } catch {
            return;
          }
        }
      },
      async clear() {
        WorkTimeApp.services.vocabularyIdle?.configure({ paused: true });
        stop();
        await serial.catch(() => {});
        reset();
        const cleared = await filesCache.clear();
        await cache((store) => store.clear());
        browserKeys.clear();
        cacheHealthy = cleared === true;
        notify(cacheHealthy ? "idle" : "cacheWarning");
      },
      dispose() {
        stop();
        reset();
        listeners.clear();
        void database?.then((d) => d.close());
        database = null;
      },
    };
  }
  let generatedCount = 0,
    inferenceMilliseconds = 0,
    coldCount = 0;
  let disposed = false,
    clearing = false,
    poolEpoch = 0;
  const slots = [],
    jobs = [],
    flights = new Map(),
    listeners = new Set();
  const cores = Math.max(1, navigator.hardwareConcurrency || 2);
  const autoMaximum = Math.max(1, Math.min(4, cores - 1));
  let automatic = cores <= 4 ? 1 : 2;
  let autoCeiling = autoMaximum,
    samples = 0,
    elapsed = 0,
    baseline = 0;
  let foregroundJobs = 0;
  const mode = () => WorkTimeApp.services.vocabularyIdle.settings.poolSize;
  const size = () =>
    mode() === "auto" ? Math.min(automatic, autoCeiling) : mode();
  function emit() {
    listeners.forEach((fn) => fn());
  }
  function addSlot() {
    const lane = createLane();
    const slot = { lane, busy: false };
    lane.subscribe(emit);
    slots.push(slot);
    return slot;
  }
  const primary = addSlot().lane;
  function trim() {
    // Keep the primary lane because it owns playback, even when shrinking.
    for (let i = slots.length - 1; i > 0 && slots.length > size(); i--)
      if (!slots[i].busy) slots.splice(i, 1)[0].lane.dispose();
  }
  function pump() {
    if (disposed || clearing) return;
    trim();
    while (jobs.length) {
      if (slots.filter((slot) => slot.busy).length >= size()) return;
      const slot = slots.find((slot) => !slot.busy) || addSlot();
      const index = jobs.findIndex((job) => !job.background);
      const job = jobs.splice(index < 0 ? 0 : index, 1)[0];
      slot.busy = true;
      slot.lane
        .synthesize(job.entry, job.accent, job.options)
        .then(job.resolve, (error) => {
          if (mode() === "auto" && !error.cacheCode) {
            automatic = Math.max(1, size() - 1);
            autoCeiling = automatic;
            samples = elapsed = baseline = 0;
          }
          job.reject(error);
        })
        .finally(() => {
          slot.busy = false;
          pump();
          emit();
        });
    }
  }
  function synthesize(entry, accent, options = {}) {
    if (disposed || clearing) return Promise.resolve(null);
    const key = filesCacheKey(entry, accent);
    const existing = flights.get(key);
    if (existing) {
      // A foreground request waiting for the same audio promotes queued work.
      if (!options.background) {
        foregroundJobs++;
        existing.background = false;
        existing.options = { ...existing.options, background: false };
      }
      return existing.promise
        .then((blob) => {
          if (options.valid && !options.valid()) return null;
          // An invalidated background owner may have produced no result.
          return (
            blob ||
            (options.background ? null : synthesize(entry, accent, options))
          );
        })
        .finally(() => {
          if (!options.background) foregroundJobs--;
        });
    }
    const epoch = poolEpoch;
    const valid = options.valid || (() => true);
    const canStart = options.canStart || (() => true);
    const job = { entry, accent, background: !!options.background };
    job.options = {
      ...options,
      valid: () => !disposed && epoch === poolEpoch && valid(),
      canStart: () => !foregroundJobs && canStart(),
    };
    if (!options.background) foregroundJobs++;
    job.promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    }).finally(() => {
      if (!options.background) foregroundJobs--;
      if (flights.get(key) === job) flights.delete(key);
    });
    flights.set(key, job);
    jobs.push(job);
    pump();
    return job.promise;
  }
  function filesCacheKey(entry, accent) {
    return WorkTimeApp.services.vocabularyAudioCache.key(entry, accent);
  }
  return {
    synthesize,
    play: (...args) => primary.play(...args),
    prefetch: (...args) => primary.prefetch(...args),
    stop: () => primary.stop(),
    initialize: (...args) => primary.initialize(...args),
    get poolSize() {
      return size();
    },
    get metrics() {
      return { generatedCount, inferenceMilliseconds, coldCount };
    },
    recordBatch({ count, milliseconds, cold, lag }) {
      if (mode() !== "auto" || !count) return;
      if (lag > 150) {
        automatic = Math.max(1, size() - 1);
        autoCeiling = automatic;
        samples = elapsed = baseline = 0;
      } else if (!cold) {
        samples += count;
        elapsed += milliseconds;
        if (samples >= 8 && elapsed > 0) {
          const throughput = samples / elapsed;
          if (baseline && throughput < baseline * 1.1) {
            automatic = Math.max(1, automatic - 1);
            autoCeiling = automatic;
            baseline = 0;
          } else if (automatic < autoCeiling) {
            baseline = throughput;
            automatic++;
          }
          samples = elapsed = 0;
        }
      }
      trim();
      emit();
    },
    get active() {
      return foregroundJobs > 0 || primary.active;
    },
    get busy() {
      return slots.some((slot) => slot.busy);
    },
    get status() {
      return slots.find((slot) => slot.busy)?.lane.status || primary.status;
    },
    get phase() {
      return slots.find((slot) => slot.busy)?.lane.phase || primary.phase;
    },
    get generatingKind() {
      let kind = "";
      for (const { lane, busy } of slots) {
        const next = busy && lane.generatingKind;
        if (!next) continue;
        if (kind && kind !== next) return "mixed";
        kind = next;
      }
      return kind;
    },
    get currentWord() {
      return slots
        .filter((slot) => slot.busy)
        .map((slot) => slot.lane.currentWord)
        .filter(Boolean)
        .join(" · ");
    },
    get browserKeys() {
      return [...new Set(slots.flatMap((slot) => slot.lane.browserKeys))];
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    release() {
      slots.forEach((slot) => slot.lane.release());
      trim();
    },
    async clear() {
      WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
      poolEpoch++;
      clearing = true;
      primary.stop();
      // Queued jobs must settle too; pump them as invalid jobs before clearing.
      jobs.splice(0).forEach((job) => job.resolve(null));
      await Promise.allSettled([...flights.values()].map((job) => job.promise));
      try {
        await primary.clear();
      } finally {
        clearing = false;
        pump();
      }
    },
    dispose() {
      disposed = true;
      poolEpoch++;
      jobs.splice(0).forEach((job) => job.resolve(null));
      slots.forEach((slot) => slot.lane.dispose());
      listeners.clear();
    },
  };
})();

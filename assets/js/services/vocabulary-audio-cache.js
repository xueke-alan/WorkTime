"use strict";
// Direct audio lookup; index maintenance is explicitly incremental.
WorkTimeApp.services.vocabularyAudioCache = (() => {
  const version = "piper-amy-aru-v1";
  const hash = async (bytes) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  const profileFor = (accent) =>
    WorkTimeApp.services.vocabularyIdle.profile(accent);
  const key = (entry, accent, profile = profileFor(accent)) =>
    profile.engine === "supertonic"
      ? JSON.stringify([
          "supertonic-3-v1",
          "aafc6e32416a594460b32413efc49d7fe4ce6d46",
          entry.word === "experience" ? "text-v2" : "text-v1",
          accent,
          profile.voice,
          profile.speed,
          profile.steps,
          entry.word,
        ])
      : JSON.stringify([
          version,
          "e9c8a39444359388adaa94255becb37a5a2b8e51",
          "espeak-phonemizer-1.2.1-v1",
          accent,
          profile.voice,
          profile.speed,
          profile.speaker,
          profile.noiseScale,
          profile.noiseW,
          entry.word,
        ]);
  function obsolete(identity) {
    try {
      return [
        "en_US-amy-medium",
        "en_GB-aru-medium",
        "M1",
        "M2",
        "M3",
        "M4",
        "M5",
        "F2",
        "F3",
        "F4",
        "F5",
      ].includes(JSON.parse(identity)[4]);
    } catch {
      return false;
    }
  }
  function validWav(buffer, sampleRate) {
    if (buffer.byteLength < 46 || buffer.byteLength % 2) return false;
    const v = new DataView(buffer),
      label = (n, s) =>
        [...s].every((c, i) => v.getUint8(n + i) === c.charCodeAt(0));
    return (
      label(0, "RIFF") &&
      label(8, "WAVEfmt ") &&
      label(36, "data") &&
      v.getUint32(4, true) === buffer.byteLength - 8 &&
      v.getUint32(16, true) === 16 &&
      v.getUint16(20, true) === 1 &&
      v.getUint16(22, true) === 1 &&
      [22050, 44100].includes(v.getUint32(24, true)) &&
      (sampleRate === undefined || v.getUint32(24, true) === sampleRate) &&
      v.getUint32(28, true) === v.getUint32(24, true) * 2 &&
      v.getUint16(32, true) === 2 &&
      v.getUint16(34, true) === 16 &&
      v.getUint32(40, true) === buffer.byteLength - 44
    );
  }
  let folderInfo = null,
    connection = null,
    revision = -1,
    epoch = 0;
  let iterator = null,
    clearing = false;
  let hydrationSerial = 0,
    hydrationChanges = null;
  let generated = new Set();
  const listeners = new Set();
  let catalog,
    expectedProfile,
    expected = new Set(),
    matched = 0;
  let snapshot = {
    count: 0,
    bytes: 0,
    available: false,
    indexStatus: "unavailable",
    bytesExact: false,
  };
  const index = () => WorkTimeApp.services.vocabularyFileIndex;
  const notify = () => listeners.forEach((fn) => fn());
  function rememberIdentity(identity, add) {
    if (identity && hydrationChanges) hydrationChanges.set(identity, add);
    if (!identity || generated.has(identity) === add) return;
    if (expected.has(identity)) matched += add ? 1 : -1;
    if (add) generated.add(identity);
    else generated.delete(identity);
  }
  function forget() {
    hydrationSerial++;
    hydrationChanges = null;
    generated.clear();
    matched = 0;
  }
  function selectedCount(summary) {
    const accent =
      WorkTimeApp.services.vocabularyStorage.read().settings.accent;
    const prefixes = new Set([
      index().prefix(key({ word: "" }, accent)),
      index().prefix(key({ word: "experience" }, accent)),
    ]);
    return [...prefixes].reduce((sum, p) => sum + (summary.counts[p] || 0), 0);
  }
  function updateSnapshot(summary) {
    folderInfo = summary;
    snapshot = {
      count: selectedCount(summary),
      bytes: summary.bytes,
      available: true,
      indexStatus: summary.indexStatus,
      bytesExact: summary.indexStatus === "ready",
    };
  }
  const channel =
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel("worktime-vocabulary-files")
      : null;
  function changed(result, broadcast = true) {
    if (result.summary.id !== folderInfo?.id) return;
    if (result.summary.revision < folderInfo.revision) return;
    updateSnapshot(result.summary);
    for (const item of result.changes || []) {
      rememberIdentity(item.old, !!item.oldPresent);
      rememberIdentity(item.next, true);
    }
    if (broadcast) channel?.postMessage(result);
    notify();
  }
  async function hydrate(id, token) {
    const serial = ++hydrationSerial,
      updates = new Map();
    hydrationChanges = updates;
    let after = "";
    let expectedSnapshot = expected,
      foundMatches = 0;
    const found = new Set();
    while (token === epoch && serial === hydrationSerial) {
      const rows = await index().list(id, after);
      for (const row of rows)
        if (row.identity && !found.has(row.identity)) {
          found.add(row.identity);
          if (expectedSnapshot.has(row.identity)) foundMatches++;
        }
      if (rows.length < 256) break;
      after = rows.at(-1).path;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    // The selected catalog may change while metadata loads. Recount in small
    // chunks as well, never in one synchronous pass over the complete index.
    while (
      token === epoch &&
      serial === hydrationSerial &&
      expectedSnapshot !== expected
    ) {
      expectedSnapshot = expected;
      foundMatches = 0;
      let count = 0;
      for (const identity of found) {
        if (expectedSnapshot.has(identity)) foundMatches++;
        if (++count % 256 === 0)
          await new Promise((resolve) => setTimeout(resolve, 0));
        if (token !== epoch || serial !== hydrationSerial) return;
      }
    }
    if (token !== epoch || serial !== hydrationSerial) return;
    hydrationChanges = null;
    for (const [identity, add] of updates) {
      if (expectedSnapshot.has(identity) && found.has(identity) !== add)
        foundMatches += add ? 1 : -1;
      if (add) found.add(identity);
      else found.delete(identity);
    }
    generated = found;
    matched = foundMatches;
    notify();
  }
  channel?.addEventListener("message", ({ data }) => {
    if (
      !data?.summary ||
      data.summary.id !== folderInfo?.id ||
      data.summary.revision <= folderInfo.revision
    )
      return;
    const contiguous = data.summary.revision === folderInfo.revision + 1;
    changed(data, false);
    if (!contiguous || data.reset) {
      iterator = null;
      void hydrate(folderInfo.id, epoch).catch(() => {});
    }
  });
  window.addEventListener("pagehide", () => channel?.close(), { once: true });
  function progress(browserKeys = []) {
    const entries = WorkTimeApp.data.vocabularyCatalog?.entries;
    const selection = JSON.stringify([profileFor("us"), profileFor("uk")]);
    if (catalog !== entries || expectedProfile !== selection) {
      catalog = entries;
      expectedProfile = selection;
      expected = new Set();
      for (const entry of entries || [])
        for (const accent of ["us", "uk"]) {
          expected.add(key(entry, accent));
          for (const example of entry.examples || [])
            expected.add(key({ word: example.en }, accent));
        }
      matched = 0;
      for (const identity of generated) if (expected.has(identity)) matched++;
    }
    let count = matched;
    for (const identity of new Set(browserKeys))
      if (!generated.has(identity) && expected.has(identity)) count++;
    return {
      generatedTotal: count,
      audioTotal: expected.size,
      progressExact: hydrationChanges === null,
    };
  }
  async function connect(root) {
    if (!connection) {
      const token = epoch;
      connection = index()
        .connect(root)
        .then((summary) => {
          if (token !== epoch)
            throw new DOMException("Folder changed", "AbortError");
          updateSnapshot(summary);
          void hydrate(summary.id, token).catch(() => {});
          return summary;
        })
        .catch((error) => {
          connection = null;
          throw error;
        });
    }
    await connection;
    return folderInfo;
  }
  async function directory(action) {
    const folder = WorkTimeApp.services.runtimeFolder;
    if (!folder) return null;
    const result = await folder.withEnglish(
      async (root, context = {}) => {
        if (revision !== folder.state.revision) {
          revision = folder.state.revision;
          epoch++;
          connection = null;
          folderInfo = null;
          iterator = null;
          forget();
          snapshot = {
            count: 0,
            bytes: 0,
            available: true,
            indexStatus: "loading",
            bytesExact: false,
          };
        }
        return { value: await action(root, context.legacy || null) };
      },
      { migrateLegacy: false, includeLegacy: true },
    );
    if (result === null) snapshot.available = false;
    return result?.value ?? null;
  }
  async function optional(dir, name) {
    try {
      return await (await dir.getFileHandle(name)).getFile();
    } catch (error) {
      if (error.name === "NotFoundError") return null;
      throw error;
    }
  }
  async function child(dir, name, create = false) {
    if (!dir) return null;
    try {
      return await dir.getDirectoryHandle(name, { create });
    } catch (error) {
      if (error.name === "NotFoundError") return null;
      throw error;
    }
  }
  async function at(root, parts, create = false) {
    let dir = root;
    for (const part of parts) {
      dir = await child(dir, part, create);
      if (!dir) return null;
    }
    return dir;
  }
  async function save(dir, name, bytes) {
    const stream = await (
      await dir.getFileHandle(name, { create: true })
    ).createWritable();
    try {
      await stream.write(bytes);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
  }
  function locations(root, legacy, name, accent, profile) {
    const model = profile.engine === "supertonic" ? "supertonic-3-v1" : version;
    const base = ["audio", model, accent];
    return [
      {
        root,
        parts: [...base, name.slice(0, 2)],
        path: "current/" + [...base, name.slice(0, 2), name].join("/"),
      },
      { root, parts: base, path: "current/" + [...base, name].join("/") },
      ...(legacy
        ? [
            {
              root: legacy,
              parts: [...base, name.slice(0, 2)],
              path: "legacy/" + [...base, name.slice(0, 2), name].join("/"),
            },
            {
              root: legacy,
              parts: base,
              path: "legacy/" + [...base, name].join("/"),
            },
          ]
        : []),
    ];
  }
  async function inspect(dir, name, path, validate = false) {
    const file = await optional(dir, name + ".wav");
    if (!file) return { path, remove: true };
    const row = {
      path,
      bytes: file.size,
      modified: file.lastModified,
      identity: null,
      sha256: null,
    };
    try {
      const meta = await optional(dir, name + ".json");
      const value = JSON.parse(await meta.text());
      if (
        typeof value.key === "string" &&
        (await hash(new TextEncoder().encode(value.key))) === name
      )
        row.retired = obsolete(value.key);
      if (
        typeof value.key === "string" &&
        /^[a-f0-9]{64}$/.test(value.sha256) &&
        (await hash(new TextEncoder().encode(value.key))) === name
      ) {
        row.identity = value.key;
        row.sha256 = value.sha256;
        if (validate) {
          const bytes = await file.arrayBuffer();
          const accent = JSON.parse(value.key)[3];
          if (
            !validWav(bytes, accent === "us" ? 44100 : 22050) ||
            (await hash(bytes)) !== value.sha256
          )
            row.identity = null;
        }
      }
    } catch {
      /* Damaged audio still occupies capacity, but is not a cache hit. */
    }
    return row;
  }
  async function observe(root, row, token) {
    try {
      const summary = await connect(root);
      if (token !== epoch) return;
      const old = await index().record(summary.id, row.path);
      if (
        old &&
        old.bytes === row.bytes &&
        old.modified === row.modified &&
        old.identity === row.identity &&
        old.sha256 === row.sha256
      )
        return;
      changed(await index().apply(summary.id, [{ ...row, observed: true }]));
    } catch {
      /* Index availability never blocks target-file playback. */
    }
  }
  async function recover(root, legacy, id) {
    for (const pending of await index().pending(id)) {
      const parts = pending.path.split("/");
      const selected = parts.shift() === "legacy" ? legacy : root;
      const name = parts.pop();
      const dir = await at(selected, parts);
      const row = dir
        ? await inspect(dir, name, pending.path, true)
        : { path: pending.path, remove: true };
      changed(await index().commit(id, row));
    }
  }
  async function* rebuild(root, legacy, id) {
    const completed = new Set(
      (await index().directories(id)).map((row) => row.path),
    );
    async function* walk(dir, path) {
      if (!dir || completed.has(path)) return;
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === "directory") yield* walk(handle, path + "/" + name);
        else if (name.endsWith(".wav")) {
          const base = name.slice(0, -4),
            target = path + "/" + base;
          const file = await handle.getFile();
          const old = await index().record(id, target);
          if (
            old &&
            old.bytes === file.size &&
            old.modified === file.lastModified
          ) {
            yield {};
            continue;
          }
          const row = /^[a-f0-9]{64}$/.test(base)
            ? await inspect(dir, base, target)
            : {
                path: target,
                bytes: file.size,
                modified: file.lastModified,
                identity: null,
              };
          if (row.retired) {
            await dir.removeEntry(name);
            await dir.removeEntry(base + ".json").catch(() => {});
            row.remove = true;
          }
          yield { row };
        }
      }
      yield { checkpoint: path };
    }
    for (const [label, selected] of [
      ["current", root],
      ["legacy", legacy],
    ]) {
      yield* walk(await child(selected, "audio"), label + "/audio");
      for (const resource of ["resources-piper", "resources-1939ad2a"]) {
        const dir = await child(selected, resource);
        if (!dir) continue;
        for await (const [name, handle] of dir.entries()) {
          const retired =
            resource === "resources-piper"
              ? /^en-en_(?:US-amy|GB-aru)-medium-.+-[a-f0-9]{64}\.bin$/.test(
                  name,
                )
              : /^(?:model|tokenizer|us|uk|mjs|wasm|pocket-.+|supertonic-(?:mjs|wasm))-[a-f0-9]{64}\.bin$/.test(
                  name,
                );
          if (handle.kind === "file" && retired) await dir.removeEntry(name);
          yield {};
        }
      }
    }
  }
  async function maintain(root, legacy, canRun) {
    const summary = await connect(root),
      id = summary.id;
    const token = epoch;
    const run = async (lock) => {
      if (!lock || !canRun() || token !== epoch) return;
      await recover(root, legacy, id);
      const current = await index().get(id);
      updateSnapshot(current);
      if (current.indexStatus === "ready") return;
      if (current.indexStatus === "clearing") {
        for (const selected of [root, legacy])
          if (selected) {
            try {
              await selected.removeEntry("audio", { recursive: true });
            } catch (error) {
              if (error.name !== "NotFoundError") throw error;
            }
          }
        epoch++;
        iterator = null;
        forget();
        changed({
          summary: await index().reset(id, "ready"),
          changes: [],
          reset: true,
        });
        return;
      }
      iterator ||= rebuild(root, legacy, id);
      const rows = [],
        checkpoints = [];
      const start = performance.now();
      let finished = false;
      for (let count = 0; count < 16 && canRun() && token === epoch; count++) {
        const next = await iterator.next();
        if (next.done) {
          finished = true;
          break;
        }
        if (next.value.row) rows.push(next.value.row);
        if (next.value.checkpoint) checkpoints.push(next.value.checkpoint);
        if (performance.now() - start >= 8) break;
      }
      if (rows.length) changed(await index().apply(id, rows));
      for (const path of checkpoints) await index().checkpoint(id, path);
      if (finished) {
        iterator = null;
        changed({ summary: await index().status(id, "ready"), changes: [] });
      }
    };
    if (navigator.locks)
      await navigator.locks.request(
        "worktime-vocabulary-index-" + id,
        { ifAvailable: true },
        run,
      );
    else await run(true);
  }
  return {
    key,
    obsolete,
    progress,
    hash,
    validWav,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get state() {
      return {
        ...snapshot,
        count: folderInfo ? selectedCount(folderInfo) : snapshot.count,
      };
    },
    async info({ canRun = () => true } = {}) {
      try {
        await directory((root, legacy) => maintain(root, legacy, canRun));
      } catch (error) {
        snapshot.indexStatus = "error";
        snapshot.bytesExact = false;
        notify();
        throw error;
      }
      return { ...snapshot };
    },
    async verify() {
      return directory(async (root) => {
        const summary = await connect(root);
        const run = async () => {
          epoch++;
          iterator = null;
          forget();
          changed({
            summary: await index().reset(summary.id),
            changes: [],
            reset: true,
          });
          return { ...snapshot };
        };
        return navigator.locks
          ? navigator.locks.request(
              "worktime-vocabulary-index-" + summary.id,
              run,
            )
          : run();
      });
    },
    async read(entry, accent, profile = profileFor(accent)) {
      if (clearing || folderInfo?.indexStatus === "clearing") return null;
      const identity = key(entry, accent, profile),
        name = await hash(new TextEncoder().encode(identity));
      return directory(async (root, legacy) => {
        const token = epoch,
          candidates = locations(root, legacy, name, accent, profile),
          missing = [];
        for (const location of candidates) {
          const dir = await at(location.root, location.parts);
          if (!dir) {
            missing.push({ path: location.path, remove: true });
            continue;
          }
          const file = await optional(dir, name + ".wav"),
            meta = await optional(dir, name + ".json");
          if (!file) {
            missing.push({ path: location.path, remove: true });
            continue;
          }
          let value;
          try {
            value = JSON.parse(await meta.text());
          } catch {
            value = null;
          }
          const bytes =
            value?.key === identity ? await file.arrayBuffer() : null;
          const valid =
            bytes &&
            validWav(bytes, profile.engine === "supertonic" ? 44100 : 22050) &&
            value.sha256 === (await hash(bytes));
          void observe(
            root,
            {
              path: location.path,
              bytes: file.size,
              modified: file.lastModified,
              identity: valid ? identity : null,
              sha256: valid ? value.sha256 : null,
            },
            token,
          );
          if (valid) {
            rememberIdentity(identity, true);
            return new Blob([bytes], { type: "audio/wav" });
          }
        }
        if (folderInfo && generated.has(identity)) {
          rememberIdentity(identity, false);
          const id = folderInfo.id;
          void index()
            .apply(id, missing)
            .then(changed)
            .catch(() => {});
        }
        return null;
      });
    },
    async write(
      entry,
      accent,
      blob,
      limit,
      valid = () => true,
      profile = profileFor(accent),
    ) {
      if (clearing) return false;
      const bytes = await blob.arrayBuffer();
      if (!validWav(bytes, profile.engine === "supertonic" ? 44100 : 22050))
        throw Error("Invalid speech WAV");
      const identity = key(entry, accent, profile),
        name = await hash(new TextEncoder().encode(identity)),
        sha256 = await hash(bytes);
      return directory(async (root, legacy) => {
        await connect(root);
        if (!valid()) return false;
        const id = folderInfo.id;
        const run = async () => {
          await recover(root, legacy, id);
          const summary = await index().get(id);
          updateSnapshot(summary);
          if (summary.indexStatus !== "ready" || !valid()) return false;
          const candidates = locations(root, legacy, name, accent, profile);
          let location = candidates[0],
            old = null,
            dir;
          for (const candidate of candidates) {
            const existing = await at(candidate.root, candidate.parts);
            const file = existing && (await optional(existing, name + ".wav"));
            if (file) {
              location = candidate;
              old = file;
              break;
            }
          }
          dir = await at(location.root, location.parts, true);
          if (old)
            changed(
              await index().apply(id, [
                await inspect(dir, name, location.path),
              ]),
            );
          const next = {
            path: location.path,
            bytes: blob.size,
            identity,
            sha256,
            modified: 0,
          };
          const reservation = await index().reserve(id, next, limit);
          if (!reservation) return false;
          changed({ summary: reservation, changes: [] });
          try {
            if (!valid()) {
              await recover(root, legacy, id);
              return false;
            }
            await save(dir, name + ".wav", blob);
            await save(
              dir,
              name + ".json",
              JSON.stringify({ key: identity, sha256 }),
            );
            next.modified = (await optional(dir, name + ".wav")).lastModified;
            changed(await index().commit(id, next));
          } catch (error) {
            await recover(root, legacy, id).catch(() => {});
            throw error;
          }
          return true;
        };
        return navigator.locks
          ? navigator.locks.request("worktime-vocabulary-index-" + id, run)
          : run();
      });
    },
    async part(name, spec, load, engine = "piper") {
      const label =
        engine === "supertonic" ? "resources-supertonic-3" : "resources-piper";
      const filename = name + "-" + spec.sha256 + ".bin";
      const resourceRevision =
        WorkTimeApp.services.runtimeFolder?.state.revision;
      let writable = false;
      try {
        const result = await directory(async (root, legacy) => {
          writable = true;
          for (const selected of [root, legacy]) {
            const resources = await child(selected, label);
            const file = resources && (await optional(resources, filename));
            if (file?.size === spec.bytes) {
              const bytes = new Uint8Array(await file.arrayBuffer());
              if ((await hash(bytes)) === spec.sha256) return bytes;
            }
          }
          return null;
        });
        if (result) return result;
      } catch (error) {
        if (spec.url) throw error;
      }
      if (spec.url && !writable)
        throw Error(
          "Choose an available runtime folder before installing speech models",
        );
      // Network transfer never holds the runtime-folder lock.
      const bytes = await load();
      if (
        bytes.byteLength !== spec.bytes ||
        (await hash(bytes)) !== spec.sha256
      )
        throw Error("Speech resource checksum mismatch");
      if (writable) {
        try {
          if (
            resourceRevision !==
            WorkTimeApp.services.runtimeFolder?.state.revision
          )
            throw Error("Runtime folder changed during model download");
          const saved = await directory(async (root) => {
            await save(await child(root, label, true), filename, bytes);
            return true;
          });
          if (spec.url && !saved)
            throw Error("Speech model could not be saved");
        } catch (error) {
          if (spec.url) throw error;
        }
      }
      return bytes;
    },
    async clear() {
      clearing = true;
      try {
        return await directory(async (root, legacy) => {
          const summary = await connect(root);
          const run = async () => {
            changed({
              summary: await index().status(summary.id, "clearing"),
              changes: [],
              reset: true,
            });
            for (const selected of [root, legacy])
              if (selected) {
                try {
                  await selected.removeEntry("audio", { recursive: true });
                } catch (error) {
                  if (error.name !== "NotFoundError") throw error;
                }
              }
            epoch++;
            iterator = null;
            forget();
            changed({
              summary: await index().reset(summary.id, "ready"),
              changes: [],
              reset: true,
            });
            return true;
          };
          return navigator.locks
            ? navigator.locks.request(
                "worktime-vocabulary-index-" + summary.id,
                run,
              )
            : run();
        });
      } finally {
        clearing = false;
      }
    },
  };
})();

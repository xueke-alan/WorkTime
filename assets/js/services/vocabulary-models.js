"use strict";
/** Pinned model downloads and independently distributed offline model packages. */
WorkTimeApp.services.vocabularyModels = (() => {
  const magic = "WTMODELS1\n";
  const listeners = new Set(),
    flights = new Map(),
    controllers = new Set();
  let state = { phase: "idle", loaded: 0, total: 0 };
  const notify = (next) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  async function definition() {
    await WorkTimeApp.services.assets.script(
      "assets/vendor/vocabulary/manifest.js",
    );
    return WorkTimeApp.data.vocabularySpeech;
  }
  async function download(spec) {
    if (flights.has(spec.sha256))
      return (await flights.get(spec.sha256)).slice();
    const operation = (async () => {
      const controller = new AbortController();
      controllers.add(controller);
      let timer;
      const heartbeat = () => {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), 60000);
      };
      try {
        notify({ phase: "downloading", loaded: 0, total: spec.bytes });
        heartbeat();
        const response = await fetch(spec.url, {
          signal: controller.signal,
          credentials: "omit",
        });
        if (!response.ok || !response.body)
          throw Error("Model download failed");
        const reader = response.body.getReader(),
          bytes = new Uint8Array(spec.bytes);
        let offset = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          heartbeat();
          if (offset + value.length > bytes.length) {
            await reader.cancel();
            throw Error("Model resource size mismatch");
          }
          bytes.set(value, offset);
          offset += value.length;
          notify({ loaded: offset });
        }
        if (
          offset !== spec.bytes ||
          (await WorkTimeApp.services.vocabularyAudioCache.hash(bytes)) !==
            spec.sha256
        )
          throw Error("Model resource checksum mismatch");
        notify({ phase: "idle" });
        return bytes;
      } catch (error) {
        notify({ phase: controller.signal.aborted ? "cancelled" : "failed" });
        throw error;
      } finally {
        clearTimeout(timer);
        controllers.delete(controller);
      }
    })();
    flights.set(spec.sha256, operation);
    try {
      return (await operation).slice();
    } finally {
      flights.delete(spec.sha256);
    }
  }
  async function install(file) {
    const header = new Uint8Array(await file.slice(0, 14).arrayBuffer());
    if (
      new TextDecoder().decode(header.subarray(0, 10)) !== magic ||
      header.length !== 14
    )
      throw Error("Invalid offline model package");
    const size = new DataView(header.buffer).getUint32(10, true);
    if (size > 65536 || size < 1 || 14 + size > file.size)
      throw Error("Invalid package header");
    const metadata = JSON.parse(await file.slice(14, 14 + size).text());
    if (
      metadata.format !== "worktime-speech-models" ||
      metadata.version !== 1 ||
      !Array.isArray(metadata.resources)
    )
      throw Error("Unsupported model package");
    const manifest = await definition(),
      resources = [],
      seen = new Set();
    let offset = 14 + size;
    for (const row of metadata.resources) {
      const identity = row.engine + ":" + row.name,
        spec = manifest.files[row.name];
      if (
        !manifest.groups[row.engine]?.includes(row.name) ||
        seen.has(identity) ||
        !spec?.url ||
        row.bytes !== spec.bytes ||
        row.sha256 !== spec.sha256
      )
        throw Error("Model package version mismatch");
      seen.add(identity);
      resources.push({ engine: row.engine, name: row.name, spec, offset });
      offset += spec.bytes;
    }
    if (!resources.length || offset !== file.size)
      throw Error("Incomplete model package");
    for (const engine of new Set(resources.map((row) => row.engine)))
      if (
        manifest.groups[engine].some((name) => !seen.has(engine + ":" + name))
      )
        throw Error("Incomplete model package");
    // Validate the entire package before touching any installed resource.
    notify({ phase: "importing", loaded: 0, total: resources.length });
    try {
      for (const row of resources) {
        const bytes = await file
          .slice(row.offset, row.offset + row.spec.bytes)
          .arrayBuffer();
        if (
          (await WorkTimeApp.services.vocabularyAudioCache.hash(bytes)) !==
          row.spec.sha256
        )
          throw Error("Model package checksum mismatch");
      }
      for (const [index, row] of resources.entries()) {
        await WorkTimeApp.services.vocabularyAudioCache.part(
          row.name.replaceAll("/", "-"),
          row.spec,
          async () =>
            new Uint8Array(
              await file
                .slice(row.offset, row.offset + row.spec.bytes)
                .arrayBuffer(),
            ),
          row.engine,
        );
        notify({ loaded: index + 1 });
      }
      notify({ phase: "installed" });
    } catch (error) {
      notify({ phase: "failed" });
      throw error;
    }
  }
  return {
    download,
    async install(file) {
      try {
        return await install(file);
      } catch (error) {
        notify({ phase: error.name === "AbortError" ? "cancelled" : "failed" });
        throw error;
      }
    },
    async prepare() {
      try {
        const manifest = await definition();
        for (const [engine, names] of Object.entries(manifest.groups))
          for (const name of names) {
            const spec = manifest.files[name];
            await WorkTimeApp.services.vocabularyAudioCache.part(
              name.replaceAll("/", "-"),
              spec,
              () => download(spec),
              engine,
            );
          }
        notify({ phase: "installed" });
      } catch (error) {
        notify({ phase: error.name === "AbortError" ? "cancelled" : "failed" });
        throw error;
      }
    },
    cancel() {
      for (const controller of controllers) controller.abort();
    },
    get state() {
      return { ...state };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();

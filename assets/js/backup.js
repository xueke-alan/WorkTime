"use strict";
/** Backup transport independent of DOM, storage and confirmation dialogs. */
WorkTimeApp.services.backup = (() => {
  const PREFIX = "WORKTIME:GZIP:1:";
  const DEFLATE_PREFIX = "WORKTIME:DEFLATE:1:";
  const MAX_BYTES = 100 * 1024 * 1024;
  async function compress(raw, format, prefix) {
    const bytes = new Uint8Array(
      await new Response(
        new Blob([raw]).stream().pipeThrough(new CompressionStream(format)),
      ).arrayBuffer(),
    );
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return prefix + btoa(binary);
  }
  const encode = (raw) => compress(raw, "gzip", PREFIX);
  async function encodeCompact(raw) {
    if (typeof CompressionStream !== "function") return raw;
    const candidates = [raw, await encode(raw)];
    try {
      candidates.push(await compress(raw, "deflate-raw", DEFLATE_PREFIX));
    } catch {
      // Older browsers still support the existing gzip transport.
    }
    return candidates.reduce((a, b) => (a.length <= b.length ? a : b));
  }
  async function decode(
    text,
    validate,
    { maxBytes = MAX_BYTES, allowGameArchive = false } = {},
  ) {
    if (typeof text !== "string")
      throw Error(WorkTimeApp.i18n.t("copy.91f8def561"));
    text = text.trim();
    if (!allowGameArchive && text.startsWith("WORKTIME:GAMES:")) {
      const error = Error(WorkTimeApp.i18n.t("gameArchive.gameOnly"));
      error.code = "gameOnly";
      throw error;
    }
    const limitError = () => {
      const error = Error(
        WorkTimeApp.i18n.t("backup.tooLarge", {
          size: Math.round(maxBytes / 1024 / 1024),
        }),
      );
      error.code = "tooLarge";
      return error;
    };
    if (new TextEncoder().encode(text).length > maxBytes) throw limitError();
    if (text.startsWith("WORKTIME:CHUNKS:")) {
      const value = await WorkTimeApp.services.backupChunks.decode(
        text,
        maxBytes,
      );
      return validate(value);
    }
    const prefix = [PREFIX, DEFLATE_PREFIX].find((p) => text.startsWith(p));
    if (prefix) {
      const binary = atob(text.slice(prefix.length));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const reader = new Blob([bytes])
        .stream()
        .pipeThrough(
          new DecompressionStream(prefix === PREFIX ? "gzip" : "deflate-raw"),
        )
        .getReader();
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxBytes) {
            await reader.cancel();
            throw limitError();
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      text = await new Blob(chunks).text();
    }
    if (new TextEncoder().encode(text).length > maxBytes) throw limitError();
    const value = JSON.parse(text);
    if (!allowGameArchive && value?.type === "worktime-games") {
      const error = Error(WorkTimeApp.i18n.t("gameArchive.gameOnly"));
      error.code = "gameOnly";
      throw error;
    }
    return validate(value);
  }
  return { PREFIX, MAX_BYTES, encode, encodeCompact, decode };
})();

/** Versioned, independently compressed parts. Also loaded by rescue/conversion tools. */
WorkTimeApp.services.backupChunks = (() => {
  const PREFIX = "WORKTIME:CHUNKS:1:";
  const invalid = () => {
    throw Error(WorkTimeApp.i18n.t("backup.unsupported"));
  };
  async function decode(text, maxBytes) {
    if (!text.startsWith(PREFIX)) invalid();
    const doc = JSON.parse(text.slice(PREFIX.length));
    if (
      doc.format !== "worktime-full-backup" ||
      doc.version !== 1 ||
      !Array.isArray(doc.modules) ||
      !Array.isArray(doc.gameParts) ||
      !Array.isArray(doc.chunks) ||
      !doc.work ||
      !doc.games
    )
      invalid();
    const chunks = new Map(),
      used = new Set(),
      moduleIds = new Set(),
      gameIds = new Set();
    let size = new TextEncoder().encode(
      JSON.stringify({ ...doc, chunks: [] }),
    ).length;
    for (const chunk of doc.chunks) {
      if (
        !chunk ||
        typeof chunk.id !== "string" ||
        chunks.has(chunk.id) ||
        !["gzip", "json"].includes(chunk.encoding) ||
        typeof chunk.payload !== "string"
      )
        invalid();
      chunks.set(chunk.id, chunk);
    }
    async function read(id) {
      if (typeof id !== "string" || used.has(id) || !chunks.has(id)) invalid();
      used.add(id);
      const chunk = chunks.get(id);
      if (chunk.encoding === "json" && chunk.payload.startsWith("WORKTIME:"))
        invalid();
      const value = await WorkTimeApp.services.backup.decode(
        chunk.encoding === "gzip"
          ? "WORKTIME:GZIP:1:" + chunk.payload
          : chunk.payload,
        (v) => v,
        { maxBytes: Math.max(0, maxBytes - size), allowGameArchive: true },
      );
      size += new TextEncoder().encode(JSON.stringify(value)).length;
      if (size > maxBytes)
        throw Object.assign(
          Error(
            WorkTimeApp.i18n.t("backup.tooLarge", {
              size: Math.round(maxBytes / 1024 / 1024),
            }),
          ),
          { code: "tooLarge" },
        );
      return value;
    }
    const modules = [];
    for (const module of doc.modules) {
      if (
        !module.header ||
        typeof module.header.id !== "string" ||
        moduleIds.has(module.header.id) ||
        !Array.isArray(module.parts) ||
        !Number.isSafeInteger(module.count) ||
        module.count < 0
      )
        invalid();
      moduleIds.add(module.header.id);
      const records = [];
      for (const id of module.parts) {
        const rows = await read(id);
        if (!Array.isArray(rows) || rows.length > 512) invalid();
        records.push(...rows);
      }
      if (records.length !== module.count) invalid();
      if (module.header.id === "worktime.days")
        records.sort((a, b) => a.order - b.order);
      modules.push({ ...module.header, records });
    }
    const games = [];
    for (const part of doc.gameParts) {
      if (typeof part.id !== "string" || gameIds.has(part.id)) invalid();
      gameIds.add(part.id);
      games.push([part.id, await read(part.part)]);
    }
    if (used.size !== chunks.size) invalid();
    const result = {
      format: doc.format,
      version: doc.version,
      work: { ...doc.work, modules, exportedAt: doc.exportedAt },
      games: {
        ...doc.games,
        games: Object.fromEntries(games),
        exportedAt: doc.exportedAt,
      },
    };
    if (new TextEncoder().encode(JSON.stringify(result)).length > maxBytes)
      throw Object.assign(
        Error(
          WorkTimeApp.i18n.t("backup.tooLarge", {
            size: Math.round(maxBytes / 1024 / 1024),
          }),
        ),
        { code: "tooLarge" },
      );
    return result;
  }
  return { PREFIX, decode };
})();

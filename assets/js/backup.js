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

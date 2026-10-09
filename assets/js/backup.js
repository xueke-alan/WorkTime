"use strict";
/** Backup transport independent of DOM, storage and confirmation dialogs. */
WorkTimeApp.services.backup = (() => {
  const PREFIX = "WORKTIME:GZIP:1:";
  const MAX_BYTES = 100 * 1024 * 1024;
  async function encode(raw) {
    const bytes = new Uint8Array(
      await new Response(
        new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return PREFIX + btoa(binary);
  }
  async function decode(text, validate, { maxBytes = MAX_BYTES } = {}) {
    if (typeof text !== "string") throw Error("备份内容必须为文本。");
    text = text.trim();
    const limitError = () =>
      Error("备份超过 " + Math.round(maxBytes / 1024 / 1024) + "MB 大小限制。");
    if (new TextEncoder().encode(text).length > maxBytes) throw limitError();
    if (text.startsWith(PREFIX)) {
      const binary = atob(text.slice(PREFIX.length));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const reader = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"))
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
    return validate(JSON.parse(text));
  }
  return { PREFIX, MAX_BYTES, encode, decode };
})();

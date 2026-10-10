"use strict";
/** Portable template transport. Never accepts or restores an application backup. */
WorkTimeApp.services.templateShare = (() => {
  const LIMIT = 6;
  const MAX_BYTES = 16 * 1024;
  const PREFIX = "WORKTIME:TEMPLATES:1:";
  function validate(templates) {
    if (
      !Array.isArray(templates) ||
      !templates.length ||
      templates.length > LIMIT
    )
      throw Error("分享内容须包含 1–6 个打卡模板。");
    return templates.map((template, index) => {
      if (!template || typeof template !== "object" || Array.isArray(template))
        throw Error("第 " + (index + 1) + " 个模板无效。");
      const { name, start, end, nextDay } =
        WorkTimeApp.domain.validation.validateTimeTemplate(
          { ...template, id: "shared-" + index },
          "第 " + (index + 1) + " 个模板",
        );
      return { name, start, end, nextDay };
    });
  }
  function checkSize(size) {
    if (size > MAX_BYTES) throw Error("模板分享内容超过 16 KiB 大小限制。");
  }
  function base64(bytes) {
    return btoa(String.fromCharCode(...bytes));
  }
  async function encode(templates) {
    const raw = new TextEncoder().encode(
      JSON.stringify({ templates: validate(templates) }),
    );
    checkSize(raw.length);
    const compressed = typeof CompressionStream === "function";
    const bytes = compressed
      ? new Uint8Array(
          await new Response(
            new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")),
          ).arrayBuffer(),
        )
      : raw;
    const result = PREFIX + (compressed ? "GZIP:" : "JSON:") + base64(bytes);
    checkSize(result.length);
    return result;
  }
  async function decode(text) {
    if (typeof text !== "string") throw Error("请粘贴模板分享字符串。");
    text = text.trim();
    checkSize(new TextEncoder().encode(text).length);
    const compressed = text.startsWith(PREFIX + "GZIP:");
    if (!compressed && !text.startsWith(PREFIX + "JSON:"))
      throw Error("不是支持的模板分享字符串，请检查内容及版本。");
    const encoded = text.slice(PREFIX.length + 5);
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        encoded,
      ) ||
      !encoded
    )
      throw Error("模板分享字符串已损坏。");
    let bytes;
    try {
      bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    } catch {
      throw Error("模板分享字符串已损坏。");
    }
    if (compressed) {
      if (typeof DecompressionStream !== "function")
        throw Error("当前浏览器不支持解压模板，请使用较新的浏览器。");
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
          if (size > MAX_BYTES) {
            await reader.cancel();
            checkSize(size);
          }
          chunks.push(value);
        }
        bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      } catch (error) {
        throw Error(
          error.message.includes("大小限制")
            ? error.message
            : "模板分享字符串已损坏，无法解压。",
        );
      } finally {
        reader.releaseLock();
      }
    }
    checkSize(bytes.length);
    let data;
    try {
      data = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw Error("模板分享内容已损坏，无法解析。");
    }
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      Object.keys(data).length !== 1 ||
      !Object.hasOwn(data, "templates")
    )
      throw Error("分享内容不是打卡模板清单。");
    return validate(data.templates);
  }
  return { LIMIT, MAX_BYTES, encode, decode, validate };
})();

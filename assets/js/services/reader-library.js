"use strict";
/** Read-only sources. Content identity survives directory changes and renames. */
WorkTimeApp.services.readerLibrary = (() => {
  const supported = /\.(epub|txt|pdf)$/i;
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  async function fingerprint(file) {
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  async function engine(format) {
    const asset = WorkTimeApp.services.assets;
    if (format === "epub") await asset.script("assets/vendor/reader/epub.js");
    if (format === "pdf") {
      await asset.script("assets/vendor/reader/pdf-worker.js");
      await asset.script("assets/vendor/reader/pdf.js");
    }
  }
  async function scan(
    handle,
    files,
    { cancelled = () => false, progress = () => {} } = {},
  ) {
    const entries = [],
      errors = [];
    const check = () => {
      if (cancelled()) throw new DOMException("Cancelled", "AbortError");
    };
    async function walk(dir, prefix = "") {
      for await (const child of dir.values()) {
        check();
        if (child.kind === "directory")
          await walk(child, prefix + child.name + "/");
        else if (supported.test(child.name))
          entries.push({
            path: prefix + child.name,
            getFile: () => child.getFile(),
          });
      }
    }
    if (handle) await walk(handle);
    else
      for (const file of files) {
        if (!supported.test(file.name)) continue;
        const relative = file.webkitRelativePath;
        entries.push({
          path: relative
            ? relative.slice(relative.indexOf("/") + 1)
            : file.name,
          getFile: () => Promise.resolve(file),
        });
      }
    const books = [];
    for (const entry of entries) {
      check();
      try {
        const file = await entry.getFile();
        const id = await fingerprint(file);
        check();
        books.push({
          ...entry,
          id,
          format: entry.path.split(".").pop().toLowerCase(),
          title: file.name.replace(supported, ""),
          author: "",
          size: file.size,
          modified: file.lastModified,
        });
      } catch (error) {
        if (
          error.name === "AbortError" ||
          error.name === "NotAllowedError" ||
          error.name === "SecurityError"
        )
          throw error;
        errors.push(entry.path);
      }
      progress(books.length, entries.length);
      await pause();
    }
    return { books, errors };
  }
  function decode(buffer, encoding = "auto") {
    const b = new Uint8Array(buffer);
    if (encoding === "auto") {
      if (b[0] === 255 && b[1] === 254) encoding = "utf-16le";
      else if (b[0] === 254 && b[1] === 255) encoding = "utf-16be";
      else {
        try {
          return {
            text: new TextDecoder("utf-8", { fatal: true }).decode(b),
            encoding: "utf-8",
          };
        } catch {
          encoding = "gb18030";
        }
      }
    }
    return { text: new TextDecoder(encoding).decode(b), encoding };
  }
  function chapters(text) {
    const entries = [];
    const pattern =
      /^(?:\s{0,4})(第[零〇一二三四五六七八九十百千万两\d]+[章回卷节部篇].{0,80}|(?:chapter|book|part)\s+[\divxlc]+.{0,80}|序章|序言|前言|后记|尾声)\s*$/gim;
    for (const match of text.matchAll(pattern))
      entries.push({ label: match[1], location: { offset: match.index } });
    if (!entries.length)
      for (let offset = 0; offset < text.length; offset += 12000)
        entries.push({
          label: String(entries.length + 1),
          location: { offset },
        });
    if (!entries.length || entries[0].location.offset > 0)
      entries.unshift({ label: "1", location: { offset: 0 } });
    return entries;
  }
  async function zip(file) {
    await engine("epub");
    const archive = await window.WorkTimeReaderEPUB.JSZip.loadAsync(
      await file.arrayBuffer(),
    );
    let total = 0;
    for (const entry of Object.values(archive.files)) {
      total += entry._data?.uncompressedSize || 0;
      if (
        total > 512 * 1024 * 1024 ||
        (entry._data?.uncompressedSize || 0) > 64 * 1024 * 1024
      )
        throw Error("EPUB resource limit");
    }
    if (Object.keys(archive.files).length > 20000)
      throw Error("EPUB resource limit");
    const encryption = archive.file("META-INF/encryption.xml");
    if (encryption && /EncryptedData/i.test(await encryption.async("string")))
      throw Error("DRM / encrypted EPUB");
    return archive;
  }
  async function metadata(entry) {
    if (entry.format !== "epub") return {};
    const archive = await zip(await entry.getFile());
    const parse = (text) =>
      new DOMParser().parseFromString(text, "application/xml");
    const container = parse(
      await archive.file("META-INF/container.xml").async("string"),
    );
    const opfPath = container
      .getElementsByTagName("rootfile")[0]
      ?.getAttribute("full-path");
    const opf = parse(await archive.file(opfPath).async("string"));
    const get = (name) =>
      opf.getElementsByTagNameNS("*", name)[0]?.textContent || "";
    const coverId = [...opf.getElementsByTagName("meta")]
      .find((m) => m.getAttribute("name") === "cover")
      ?.getAttribute("content");
    const image = [...opf.getElementsByTagName("item")].find(
      (i) =>
        i.getAttribute("id") === coverId ||
        /\bcover-image\b/.test(i.getAttribute("properties") || ""),
    );
    let cover = null;
    if (image) {
      const name = new URL(
        image.getAttribute("href"),
        "https://reader.invalid/" + opfPath,
      ).pathname.slice(1);
      const resource = archive.file(decodeURIComponent(name));
      if (
        resource &&
        /^image\/(png|jpeg|webp|gif)$/.test(image.getAttribute("media-type"))
      )
        cover = new Blob([await resource.async("uint8array")], {
          type: image.getAttribute("media-type"),
        });
    }
    return {
      title: get("title") || entry.title,
      author: get("creator"),
      cover,
    };
  }
  const cssSafe = (source) =>
    source
      .replace(/@import\s+[^;]+;?/gi, "")
      .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (all, quote, url) =>
        /^(?:https?:|\/\/|javascript:|file:)/i.test(url.trim())
          ? 'url("")'
          : all,
      );
  async function sanitized(file) {
    const archive = await zip(file);
    for (const entry of Object.values(archive.files)) {
      if (entry.dir) continue;
      if (/\.css$/i.test(entry.name))
        archive.file(entry.name, cssSafe(await entry.async("string")));
      if (!/\.(xhtml|html|htm|svg)$/i.test(entry.name)) continue;
      const xml = /\.(xhtml|svg)$/i.test(entry.name);
      const doc = new DOMParser().parseFromString(
        await entry.async("string"),
        xml ? "application/xhtml+xml" : "text/html",
      );
      doc
        .querySelectorAll(
          "script,iframe,object,embed,form,base,meta[http-equiv],audio,video",
        )
        .forEach((e) => e.remove());
      for (const e of doc.querySelectorAll("*"))
        for (const a of [...e.attributes]) {
          if (
            /^on/i.test(a.name) ||
            a.name === "srcset" ||
            (/^(src|href|xlink:href|action|poster)$/i.test(a.name) &&
              /^(?:https?:|\/\/|javascript:|file:)/i.test(a.value.trim()))
          )
            e.removeAttribute(a.name);
          if (a.name === "style") e.setAttribute("style", cssSafe(a.value));
        }
      doc
        .querySelectorAll("style")
        .forEach((e) => (e.textContent = cssSafe(e.textContent)));
      const head = doc.querySelector("head");
      if (head) {
        const meta = doc.createElementNS(head.namespaceURI, "meta");
        meta.setAttribute("http-equiv", "Content-Security-Policy");
        meta.setAttribute(
          "content",
          "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob:; font-src blob: data:; script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'",
        );
        head.prepend(meta);
      }
      archive.file(entry.name, new XMLSerializer().serializeToString(doc));
    }
    return archive.generateAsync({
      type: "arraybuffer",
      compression: "DEFLATE",
    });
  }
  return {
    scan,
    fingerprint,
    engine,
    decode,
    chapters,
    metadata,
    sanitized,
    pause,
  };
})();

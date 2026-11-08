"use strict";
/** Reading state is separate from work records; no source bytes or passwords. */
WorkTimeApp.services.readerStorage = (() => {
  let pending;
  const defaults = () => ({ books: {}, groups: [], daily: {}, settings: {} });
  function open() {
    if (!pending)
      pending = new Promise((resolve, reject) => {
        const request = indexedDB.open("worktime-reader", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("reader");
        request.onerror = request.onblocked = () => {
          pending = null;
          reject(request.error || Error("Storage blocked"));
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            pending = null;
          };
          resolve(db);
        };
      });
    return pending;
  }
  async function read(key = "state") {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction("reader").objectStore("reader").get(key);
      request.onsuccess = () => resolve(request.result || defaults());
      request.onerror = () => reject(request.error);
    });
  }
  async function write(state, key = "state") {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("reader", "readwrite");
      tx.objectStore("reader").put(state, key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(tx.error || Error("Storage unavailable"));
    });
  }
  const safeString = (v, max = 20000) =>
    typeof v === "string" && v.length <= max;
  function cleanSettings(input) {
    const result = {};
    const options = {
      font: ["serif", "sans", "mono"],
      flow: ["pages", "scroll"],
      spread: ["single", "double"],
      theme: ["light", "sepia", "dark", "custom"],
      view: ["covers", "list"],
      sort: ["recent", "name", "author", "progress"],
      zoom: ["width", "page", "0.5", "1", "1.5", "2", "3"],
    };
    for (const [key, values] of Object.entries(options))
      if (values.includes(input?.[key])) result[key] = input[key];
    for (const [key, min, max] of [
      ["fontSize", 12, 48],
      ["lineHeight", 1.2, 3],
      ["paragraph", 0, 40],
      ["margin", 8, 100],
      ["width", 360, 1400],
    ])
      if (Number.isFinite(input?.[key]))
        result[key] = Math.max(min, Math.min(max, input[key]));
    for (const key of ["background", "foreground"])
      if (/^#[a-f\d]{6}$/i.test(input?.[key])) result[key] = input[key];
    if ([0, 90, 180, 270].includes(input?.rotation))
      result.rotation = input.rotation;
    if (typeof input?.sidebarOpen === "boolean")
      result.sidebarOpen = input.sidebarOpen;
    return result;
  }
  function validate(value) {
    if (
      !value ||
      value.format !== "worktime-reader" ||
      value.version !== 1 ||
      !value.data ||
      typeof value.data.books !== "object" ||
      Array.isArray(value.data.books)
    )
      throw Error("Invalid reading backup");
    const data = value.data;
    if (
      !Array.isArray(data.groups) ||
      data.groups.length > 1000 ||
      !data.groups.every((g) => safeString(g, 100)) ||
      !data.daily ||
      typeof data.daily !== "object"
    )
      throw Error("Invalid reading backup");
    if (Object.keys(data.books).length > 100000)
      throw Error("Reading backup is too large");
    const books = {};
    for (const [id, book] of Object.entries(data.books)) {
      if (
        !/^[a-f0-9]{64}$/.test(id) ||
        !book ||
        !safeString(book.title, 1000) ||
        !["txt", "epub", "pdf"].includes(book.format) ||
        !Array.isArray(book.annotations) ||
        !Array.isArray(book.bookmarks)
      )
        throw Error("Invalid book record");
      const validPosition = (p) => {
        if (!p || typeof p !== "object" || JSON.stringify(p).length > 10000)
          return false;
        if (book.format === "txt")
          return (
            Number.isFinite(p.offset) &&
            p.offset >= 0 &&
            (p.end === undefined ||
              (Number.isFinite(p.end) && p.end >= p.offset))
          );
        if (book.format === "pdf")
          return (
            Number.isInteger(p.page) &&
            p.page >= 1 &&
            (p.fraction === undefined ||
              (Number.isFinite(p.fraction) &&
                p.fraction >= 0 &&
                p.fraction <= 1)) &&
            (p.rects === undefined ||
              (Array.isArray(p.rects) &&
                p.rects.every(
                  (r) =>
                    Array.isArray(r) &&
                    r.length === 4 &&
                    r.every(Number.isFinite),
                )))
          );
        return (
          (safeString(p.cfi, 4000) && p.cfi.startsWith("epubcfi(")) ||
          (safeString(p.href, 4000) && !/^(?:[a-z]+:|\/\/)/i.test(p.href))
        );
      };
      for (const item of [...book.annotations, ...book.bookmarks]) {
        if (
          !item ||
          !safeString(item.id, 100) ||
          !validPosition(item.location) ||
          !safeString(item.text || "") ||
          !safeString(item.note || "")
        )
          throw Error("Invalid annotation");
        if (item.color && !/^#[0-9a-f]{6}$/i.test(item.color))
          throw Error("Invalid annotation color");
      }
      books[id] = {
        id,
        title: book.title,
        author: String(book.author || "").slice(0, 1000),
        format: book.format,
        path: String(book.path || "").slice(0, 4000),
        favorite: !!book.favorite,
        group: data.groups.includes(book.group) ? book.group : "",
        status: ["unread", "reading", "finished"].includes(book.status)
          ? book.status
          : "unread",
        progress: Math.max(0, Math.min(1, Number(book.progress) || 0)),
        location: validPosition(book.location) ? book.location : null,
        lastRead: Number(book.lastRead) || 0,
        updated: Number(book.updated) || 0,
        encoding: ["auto", "utf-8", "utf-16le", "utf-16be", "gb18030"].includes(
          book.encoding,
        )
          ? book.encoding
          : "auto",
        annotations: book.annotations,
        bookmarks: book.bookmarks,
      };
    }
    const daily = {};
    for (const [day, seconds] of Object.entries(data.daily))
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(day) &&
        Number.isFinite(seconds) &&
        seconds >= 0
      )
        daily[day] = Math.min(86400, seconds);
    return {
      books,
      groups: data.groups,
      daily,
      settings: cleanSettings(data.settings),
    };
  }
  function backup(state) {
    const data = { ...state };
    delete data.handle;
    return {
      format: "worktime-reader",
      version: 1,
      exported: new Date().toISOString(),
      data,
    };
  }
  function merge(state, imported) {
    for (const [id, book] of Object.entries(imported.books)) {
      const old = state.books[id];
      if (!old) {
        state.books[id] = book;
        continue;
      }
      const newer = (book.updated || 0) > (old.updated || 0) ? book : old;
      const union = (key) => [
        ...new Map(
          [...old[key], ...book[key]]
            .sort((a, b) => (a.updated || 0) - (b.updated || 0))
            .map((x) => [x.id, x]),
        ).values(),
      ];
      state.books[id] = {
        ...old,
        ...newer,
        annotations: union("annotations"),
        bookmarks: union("bookmarks"),
      };
    }
    state.groups = [...new Set([...state.groups, ...imported.groups])];
    for (const [day, seconds] of Object.entries(imported.daily))
      state.daily[day] = Math.max(state.daily[day] || 0, seconds);
    state.settings = { ...state.settings, ...imported.settings };
    return state;
  }
  return {
    read,
    write,
    defaults,
    validate,
    backup,
    merge,
    cleanSettings,
    readPresentation: () => read("presentation"),
    writePresentation: (value) => write(value, "presentation"),
  };
})();

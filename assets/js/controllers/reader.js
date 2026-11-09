"use strict";
/** Owns directory permission, reading lifecycle, persistence and activity accounting. */
WorkTimeApp.ui.createReaderController = function () {
  const storage = WorkTimeApp.services.readerStorage,
    library = WorkTimeApp.services.readerLibrary;
  const defaults = {
    font: "serif",
    fontSize: 20,
    lineHeight: 1.8,
    paragraph: 12,
    margin: 36,
    width: 900,
    flow: "pages",
    spread: "single",
    theme: "light",
    background: "#ffffff",
    foreground: "#292c32",
    zoom: "width",
    rotation: 0,
    view: "covers",
    sort: "recent",
  };
  let state = storage.defaults(),
    entries = new Map(),
    adapter = null,
    current = null,
    active = false,
    loading = false,
    scanning = false,
    count = 0,
    total = 0,
    message = "chooseHint",
    storageIssue = false,
    scanRevision = 0,
    openRevision = 0,
    searchRevision = 0,
    saving,
    queue = Promise.resolve(),
    lastActivity = 0;
  let pendingOpen;
  let stage = null,
    openedFile = null,
    passwordPrompt = null,
    compact = false;
  let mountRevision = 0,
    mountQueue = Promise.resolve();
  const listeners = new Set(),
    covers = new Map(),
    navigation = [];
  const emit = () => listeners.forEach((fn) => fn());
  const settings = () => ({ ...defaults, ...state.settings });
  const renderSettings = () =>
    compact
      ? {
          ...settings(),
          spread: "single",
          margin: 12,
          lineHeight: 1.6,
          zoom: "width",
        }
      : settings();
  const touch = (book) => {
    if (book) book.updated = Date.now();
  };
  function persist(immediate = false) {
    clearTimeout(saving);
    const write = () => {
      let snapshot;
      try {
        snapshot = structuredClone(state);
      } catch {
        // Some browsers can read a directory but cannot clone its permission
        // handle. Still save reading records and make reconnection explicit.
        snapshot = structuredClone({ ...state, handle: null });
        storageIssue = true;
        emit();
      }
      queue = queue
        .catch(() => {})
        .then(() => storage.write(snapshot))
        .catch(() => {
          storageIssue = true;
          emit();
        });
      return queue;
    };
    if (immediate) return write();
    saving = setTimeout(write, 350);
    return queue;
  }
  const ready = storage
    .read()
    .then((value) => {
      state = { ...storage.defaults(), ...value };
      state.settings = storage.cleanSettings(state.settings);
      if (Object.keys(state.books).length) message = "accessHint";
      state.handle = null;
    })
    .catch(() => {
      storageIssue = true;
    })
    .then(() => {
      emit();
    });
  const libraryReady = ready.then(loadRuntime);
  const record = (entry) =>
    (state.books[entry.id] ||= {
      id: entry.id,
      path: entry.path,
      format: entry.format,
      title: entry.title,
      author: "",
      status: "unread",
      progress: 0,
      favorite: false,
      group: "",
      annotations: [],
      bookmarks: [],
      updated: Date.now(),
    });
  async function closeBook({ forget = false } = {}) {
    if (forget) state.resumeBookId = null;
    ++mountRevision;
    pendingOpen?.abort();
    pendingOpen = null;
    ++openRevision;
    ++searchRevision;
    loading = false;
    const previous = adapter;
    adapter = null;
    current = null;
    navigation.length = 0;
    await previous?.destroy();
    stage?.remove();
    stage = null;
    openedFile = null;
    await persist(true);
    emit();
  }
  async function scan(handle, files = []) {
    const token = ++scanRevision;
    scanning = true;
    count = total = 0;
    message = "scanning";
    emit();
    try {
      const result = await library.scan(handle, files, {
        cancelled: () => token !== scanRevision,
        progress(n, max) {
          count = n;
          total = max;
          emit();
        },
      });
      if (token !== scanRevision) return;
      if (!current || !result.books.some((entry) => entry.id === current.id))
        await closeBook();
      if (token !== scanRevision) return;
      entries = new Map(result.books.map((entry) => [entry.id, entry]));
      state.handle = handle || null;
      state.directory =
        handle?.name || files[0]?.webkitRelativePath?.split("/")[0] || "";
      let changedFiles = false;
      for (const entry of entries.values()) {
        if (
          Object.values(state.books).some(
            (b) => b.path === entry.path && b.id !== entry.id,
          )
        )
          changedFiles = true;
        record(entry).path = entry.path;
      }
      message = result.errors.length
        ? "partialScan"
        : changedFiles
          ? "changedFiles"
          : entries.size
            ? ""
            : "empty";
      persist();
      // Metadata and covers are memory-only, incremental, and cancellable.
      scanning = false;
      emit();
      for (const entry of entries.values()) {
        if (token !== scanRevision) return;
        if (entry.format === "epub") {
          try {
            const data = await library.metadata(entry);
            if (token !== scanRevision) return;
            Object.assign(record(entry), {
              title: data.title,
              author: data.author,
            });
            if (data.cover) {
              const old = covers.get(entry.id);
              if (old) URL.revokeObjectURL(old);
              covers.set(entry.id, URL.createObjectURL(data.cover));
            }
          } catch {
            entry.metadataFailed = true;
          }
          emit();
          await library.pause();
        }
      }
      persist();
    } catch (error) {
      if (token === scanRevision)
        message = error.name === "AbortError" ? "cancelled" : "accessHint";
    } finally {
      if (token === scanRevision) {
        scanning = false;
        emit();
      }
    }
  }
  async function loadRuntime() {
    try {
      const runtime = WorkTimeApp.services.runtimeFolder;
      const handle = await runtime.getDirectory("ebooks");
      await scan(handle);
      state.directory = runtime.state.name + "/ebooks";
      emit();
      return true;
    } catch {
      ++scanRevision;
      scanning = false;
      entries.clear();
      state.handle = null;
      state.directory = "";
      await closeBook();
      message = "accessHint";
      emit();
      return false;
    }
  }
  const runtimeChanged = () => {
    void ready.then(async () => {
      await closeBook();
      await loadRuntime();
    });
  };
  document.addEventListener("worktime:runtimefolderchange", runtimeChanged);
  async function open(id, host, password, file = null, keepNavigation = false) {
    await ready;
    if (!keepNavigation) ++mountRevision;
    const entry = entries.get(id);
    if (!entry) {
      message = "accessHint";
      emit();
      return;
    }
    pendingOpen?.abort();
    const abort = new AbortController();
    pendingOpen = abort;
    const token = ++openRevision;
    ++searchRevision;
    loading = true;
    message = "opening";
    emit();
    const old = adapter;
    adapter = null;
    current = null;
    if (!keepNavigation) navigation.length = 0;
    await old?.destroy();
    stage?.remove();
    stage = null;
    if (token !== openRevision) return false;
    const staging = document.createElement("div");
    staging.className = "reader-stage";
    staging.style.visibility = "hidden";
    host.replaceChildren(staging);
    try {
      const book = record(entry);
      const sourceFile = file || (await entry.getFile());
      const result = await WorkTimeApp.services.readerAdapters.create(
        entry.format,
        {
          signal: abort.signal,
          file: sourceFile,
          host: staging,
          settings: renderSettings(),
          location: book.location,
          encoding: book.encoding,
          changed(value) {
            if (token !== openRevision) return;
            book.location = value.location;
            book.progress = value.progress;
            touch(book);
            persist();
            if (current) emit();
          },
          selected(value) {
            if (token !== openRevision || compact) return;
            selection = value;
            lastActivity = Date.now();
            emit();
          },
          password,
        },
      );
      if (token !== openRevision) {
        await result.destroy();
        staging.remove();
        return;
      }
      adapter = result;
      stage = staging;
      openedFile = sourceFile;
      passwordPrompt = password;
      current = book;
      state.resumeBookId = book.id;
      current.lastRead = Date.now();
      if (current.status === "unread") current.status = "reading";
      staging.style.visibility = "";
      selection = null;
      loading = false;
      message = "";
      await adapter.annotations(current.annotations);
      persist();
      emit();
      return true;
    } catch (error) {
      staging.remove();
      if (token === openRevision) {
        const failed = adapter;
        adapter = null;
        current = null;
        await failed?.destroy();
        loading = false;
        message = /DRM|encrypt/i.test(error.message) ? "drm" : "openFailed";
        entry.error = true;
        emit();
      }
      return false;
    }
  }
  async function resize() {
    const renderer = adapter;
    if (!renderer || loading) return;
    try {
      await renderer.settings(renderSettings());
    } catch {
      if (renderer === adapter) {
        message = "locationFailed";
        emit();
      }
    }
  }
  function remount(host, { mini = false } = {}) {
    const wasCompact = compact;
    compact = mini;
    const revision = ++mountRevision;
    mountQueue = mountQueue
      .catch(() => {})
      .then(async () => {
        if (revision !== mountRevision || !adapter || !current) return false;
        // Re-entering the same auxiliary tab does not move or re-render its
        // iframe. The resize observer handles any actual geometry change.
        if (stage?.parentElement === host && wasCompact === mini) {
          emit();
          return true;
        }
        const id = current.id,
          file = openedFile,
          renderer = adapter;
        current.location = renderer.position();
        selection = null;
        compact = mini;
        try {
          if (stage.parentElement !== host) {
            if (typeof host.moveBefore === "function")
              host.moveBefore(stage, null);
            else if (!stage.querySelector("iframe")) host.append(stage);
            else
              throw new DOMException(
                "State-preserving move unavailable",
                "NotSupportedError",
              );
          }
          await new Promise(requestAnimationFrame);
          if (revision !== mountRevision || renderer !== adapter) return false;
          await resize();
          emit();
          return true;
        } catch {
          if (revision !== mountRevision) return false;
          return open(id, host, passwordPrompt, file, true);
        }
      });
    return mountQueue;
  }
  let selection = null;
  async function go(target, back = true) {
    if (!adapter || loading) return;
    if (back) navigation.push(adapter.position());
    if (navigation.length > 100) navigation.shift();
    try {
      await adapter.go(target);
      selection = null;
      lastActivity = Date.now();
      emit();
    } catch {
      message = "locationFailed";
      emit();
    }
  }
  function updateBook(id, values) {
    const book = state.books[id];
    if (!book) return;
    Object.assign(book, values);
    touch(book);
    persist();
    emit();
  }
  const timer = setInterval(() => {
    if (
      !active ||
      !current ||
      loading ||
      document.hidden ||
      Date.now() - lastActivity > 60000
    )
      return;
    const now = new Date(),
      day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.daily[day] = Math.min(86400, (state.daily[day] || 0) + 5);
    persist();
  }, 5000);
  return {
    ready,
    libraryReady,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    snapshot: () => ({
      state,
      entries,
      covers,
      current,
      adapter,
      selection,
      loading,
      scanning,
      count,
      total,
      message,
      storageIssue,
      settings: settings(),
      canBack: !!navigation.length,
      compact,
    }),
    reconnect: () => ready.then(loadRuntime),
    async importFiles(files, options) {
      await ready;
      const result = await WorkTimeApp.services.runtimeFolder.importFiles(
        "ebooks",
        files,
        options,
      );
      await loadRuntime();
      return result;
    },
    cancelScan() {
      ++scanRevision;
      scanning = false;
      message = "cancelled";
      emit();
    },
    refresh: () => ready.then(loadRuntime),
    open,
    remount,
    resize,
    closeBook,
    go,
    async next(direction) {
      if (adapter) {
        try {
          await adapter.next(direction);
          lastActivity = Date.now();
        } catch {
          message = "locationFailed";
          emit();
        }
      }
    },
    back() {
      const target = navigation.pop();
      if (target) void go(target, false);
    },
    async search(query) {
      const token = ++searchRevision,
        renderer = adapter;
      if (!query.trim() || !renderer) return [];
      try {
        const results = await renderer.search(
          query.trim(),
          () => token !== searchRevision,
        );
        return token === searchRevision ? results : null;
      } catch {
        if (token === searchRevision) {
          message = "searchFailed";
          emit();
        }
        return null;
      }
    },
    cancelSearch() {
      ++searchRevision;
    },
    async settings(values) {
      state.settings = { ...settings(), ...values };
      if (
        adapter &&
        Object.keys(values).some(
          (key) => !["view", "sort", "sidebarOpen"].includes(key),
        )
      ) {
        try {
          await adapter.settings(renderSettings());
          await adapter.annotations(current.annotations);
        } catch {
          message = "locationFailed";
        }
      }
      persist();
      emit();
    },
    async encoding(value, host, password) {
      if (!current) return;
      const id = current.id;
      updateBook(id, { encoding: value, location: null });
      await open(id, host, password);
    },
    updateBook,
    group(name) {
      const value = name.trim().slice(0, 100);
      if (value && !state.groups.includes(value)) {
        state.groups.push(value);
        persist();
        emit();
      }
    },
    removeGroup(name) {
      state.groups = state.groups.filter((g) => g !== name);
      for (const book of Object.values(state.books))
        if (book.group === name) {
          book.group = "";
          touch(book);
        }
      persist();
      emit();
    },
    bookmark(label) {
      if (!current || !adapter) return;
      current.bookmarks.push({
        id: crypto.randomUUID(),
        location: adapter.position(),
        text: label || current.title,
        updated: Date.now(),
      });
      touch(current);
      persist();
      emit();
    },
    async annotate(color, note) {
      if (!selection || !current) return;
      current.annotations.push({
        id: crypto.randomUUID(),
        ...selection,
        color,
        note: note || "",
        updated: Date.now(),
      });
      touch(current);
      selection = null;
      await adapter.annotations(current.annotations);
      persist();
      emit();
    },
    clearSelection() {
      selection = null;
      emit();
    },
    async editAnnotation(id, note) {
      const item = current?.annotations.find((a) => a.id === id);
      if (!item) return;
      item.note = note;
      item.updated = Date.now();
      touch(current);
      await adapter.annotations(current.annotations);
      persist();
      emit();
    },
    async removeItem(key, id) {
      if (!current) return;
      current[key] = current[key].filter((item) => item.id !== id);
      touch(current);
      if (key === "annotations") await adapter.annotations(current.annotations);
      persist();
      emit();
    },
    setActive(value) {
      if (active === value) return;
      active = value;
      lastActivity = Date.now();
      if (!value) {
        ++searchRevision;
        void persist(true);
      }
    },
    activity() {
      lastActivity = Date.now();
    },
    backup: () => storage.backup(state),
    async restore(value) {
      const imported = storage.validate(value);
      await closeBook();
      storage.merge(state, imported);
      await persist(true);
      message = "restored";
      emit();
    },
    flush: () => persist(true),
    dispose() {
      document.removeEventListener(
        "worktime:runtimefolderchange",
        runtimeChanged,
      );
      ++mountRevision;
      pendingOpen?.abort();
      clearInterval(timer);
      clearTimeout(saving);
      ++openRevision;
      ++scanRevision;
      ++searchRevision;
      void adapter?.destroy();
      for (const url of covers.values()) URL.revokeObjectURL(url);
      void persist(true);
      listeners.clear();
    },
  };
};

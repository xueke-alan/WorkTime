"use strict";
/** Isolated race/resource regressions: no browser profile or real media folders. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function musicFixture(value = {}) {
  const timers = new Set();
  const urls = new Set(),
    writes = [],
    audio = [];
  class Target extends EventTarget {
    listeners = new Set();
    addEventListener(type, fn) {
      super.addEventListener(type, fn);
      this.listeners.add(fn);
    }
    removeEventListener(type, fn) {
      super.removeEventListener(type, fn);
      this.listeners.delete(fn);
    }
  }
  class Audio extends Target {
    constructor() {
      super();
      this.paused = true;
      this.currentTime = 0;
      this.volume = 0.7;
      this.playbackRate = 1;
      audio.push(this);
    }
    pause() {
      this.paused = true;
    }
    play() {
      this.paused = false;
      return Promise.resolve();
    }
    load() {}
    removeAttribute() {
      this.src = "";
    }
  }
  const runtime = {
    state: { name: "fixture" },
    getDirectory: async () => ({}),
  };
  const library = {
    scan: async () => ({ tracks: [], index: new Map() }),
    details: async () => ({
      title: "track",
      artist: "",
      album: "",
      cover: new Blob(["cover"]),
    }),
    metadata: async () => ({}),
    lyrics: () => ({}),
  };
  const storage = {
    read: async () => value,
    write: async (item) => writes.push(item),
  };
  const window = new Target(),
    document = new Target();
  const context = vm.createContext({
    WorkTimeApp: {
      ui: {},
      services: {
        musicLibrary: library,
        musicStorage: storage,
        runtimeFolder: runtime,
      },
    },
    window,
    document,
    navigator: {},
    Audio,
    setTimeout(fn, delay, ...args) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn(...args);
      }, delay);
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) {
      timers.delete(timer);
      clearTimeout(timer);
    },
    Blob,
    URL: {
      createObjectURL() {
        const url = "blob:" + Math.random();
        urls.add(url);
        return url;
      },
      revokeObjectURL(url) {
        urls.delete(url);
      },
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets/js/controllers/music.js"), "utf8"),
    context,
  );
  return {
    create: context.WorkTimeApp.ui.createMusicController,
    runtime,
    library,
    storage,
    window,
    document,
    urls,
    timers,
    writes,
    audio,
  };
}
const track = (name) => ({
  path: name + ".wav",
  fingerprint: "10:1",
  title: name,
  getFile: async () => new Blob([name]),
});
async function music() {
  const savedTrack = track("saved");
  const value = {
    runtimeLibrary: true,
    tracks: [{ ...savedTrack, getFile: undefined }],
    current: "saved.wav|10:1",
    position: 42,
    favorites: ["saved.wav|10:1"],
    directory: "fixture/music",
  };
  const denied = musicFixture(value);
  denied.runtime.getDirectory = async () => {
    throw Error("permission");
  };
  const restored = denied.create();
  await restored.ready;
  assert.equal(
    restored.snapshot().current.path,
    "saved.wav",
    "permission failure must retain current track",
  );
  assert.equal(restored.snapshot().position, 42);
  assert.equal(restored.snapshot().needsAccess, true);
  restored.dispose();
  await tick();
  assert.equal(denied.writes.at(-1).current, value.current);
  assert.equal(denied.writes.at(-1).position, 42);

  const race = musicFixture(),
    controller = race.create();
  await controller.ready;
  const old = deferred(),
    latest = deferred();
  let calls = 0;
  race.runtime.getDirectory = () =>
    ++calls === 1 ? old.promise : latest.promise;
  race.library.scan = async () => ({
    tracks: [track("latest")],
    index: new Map(),
  });
  const first = controller.rescan(),
    second = controller.rescan();
  latest.resolve({});
  await second;
  old.reject(Error("old permission failure"));
  await first;
  assert.equal(
    controller.snapshot().current.path,
    "latest.wav",
    "stale failures must not erase a newer scan",
  );
  const pending = deferred();
  race.runtime.getDirectory = () => pending.promise;
  let scans = 0;
  race.library.scan = async () => {
    scans++;
    return { tracks: [], index: new Map() };
  };
  const task = controller.rescan();
  controller.dispose();
  pending.resolve({});
  await task;
  assert.equal(scans, 0, "disposed lookup must not start directory scans");
  assert.equal(race.urls.size, 0);

  const cycles = musicFixture();
  for (let cycle = 0; cycle < 20; cycle++) {
    const instance = cycles.create();
    await instance.ready;
    instance.select(track("cycle"));
    await tick();
    assert.equal(cycles.urls.size, 2);
    instance.dispose();
    instance.dispose();
    await tick();
    assert.equal(cycles.urls.size, 0, "audio and cover URLs must be released");
    assert.equal(cycles.window.listeners.size, 0);
    assert.equal(cycles.document.listeners.size, 0);
    assert.equal(cycles.audio.at(-1).listeners.size, 0);
    assert.equal(
      cycles.timers.size,
      0,
      "disposed controllers must leave no timers",
    );
  }
  console.log(
    "Music: permission recovery, stale scans, late disposal and 20 resource cycles passed.",
  );
}
async function musicStorage() {
  let request,
    closed = 0;
  const context = vm.createContext({
    WorkTimeApp: { services: {} },
    indexedDB: {
      open() {
        request = {};
        return request;
      },
    },
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(root, "assets/js/services/music-storage.js"),
      "utf8",
    ),
    context,
  );
  const read = context.WorkTimeApp.services.musicStorage.read();
  request.onblocked();
  await assert.rejects(read, /Storage blocked/);
  request.result = {
    close() {
      closed++;
    },
  };
  request.onsuccess();
  assert.equal(
    closed,
    1,
    "late IndexedDB success after blocked rejection must close its connection",
  );
  console.log("Music storage: blocked/late-open connection cleanup passed.");
}
async function saveSession() {
  for (const mode of ["revision", "draft", "dispose", "clean"]) {
    const loaded = deferred();
    let draft = false,
      reloads = 0,
      retries = 0,
      errors = 0,
      completed = 0;
    const owner = {
      revision: 0,
      dirty: false,
      loadCorrupt: false,
      reload() {
        reloads++;
      },
      retry() {
        retries++;
        return Promise.resolve({ persisted: true });
      },
      markUnsaved() {
        this.dirty = true;
      },
    };
    const persistence = {
      loadIssue: null,
      acquireWriteAccess: async () => ({ ok: true }),
      hasExternalUpdate: async () => true,
      load: () => loaded.promise,
    };
    const context = vm.createContext({ WorkTimeApp: { services: {} } });
    vm.runInContext(
      fs.readFileSync(
        path.join(root, "assets/js/services/save-session.js"),
        "utf8",
      ),
      context,
    );
    const session = context.WorkTimeApp.services.createSaveSession({
      owner,
      persistence,
      locks: {},
      hasDraft: () => draft,
      onCommit() {},
      onReload() {},
      onRecovered() {},
      onAccessError() {},
      onRecoveryError() {
        errors++;
      },
      onRecoveryDone() {
        completed++;
      },
    });
    const recovery = session.retry();
    await tick();
    if (mode === "revision") owner.revision++;
    if (mode === "draft") draft = true;
    if (mode === "dispose") session.dispose();
    loaded.resolve({ state: {} });
    await recovery;
    assert.equal(
      reloads,
      mode === "clean" ? 1 : 0,
      mode + ": no overwrite after async load",
    );
    assert.equal(retries, mode === "clean" ? 1 : 0);
    assert.equal(errors, ["revision", "draft"].includes(mode) ? 1 : 0);
    assert.equal(completed, mode === "dispose" ? 0 : 1);
  }
  console.log(
    "Save recovery: edits/drafts during load, disposal and clean reload passed.",
  );
}
async function shuffleCost() {
  const fixture = musicFixture();
  let reads = 0;
  const tracks = Array.from({ length: 400 }, (_, index) => ({
    ...track(String(index)),
    get path() {
      reads++;
      return index + ".wav";
    },
  }));
  fixture.library.scan = async () => ({ tracks, index: new Map() });
  const controller = fixture.create();
  await controller.ready;
  controller.mode("shuffle");
  reads = 0;
  controller.next();
  assert.ok(
    reads < tracks.length * 10,
    "shuffle must use linear membership checks, got " + reads,
  );
  controller.dispose();
  await tick();
  assert.equal(fixture.urls.size, 0);
  console.log(
    "Shuffle: 400-track next selection used " +
      reads +
      " path reads (linear bound).",
  );
}
async function serviceWorker() {
  const cacheName = "worktime-shell-" + require("../package.json").version;
  const handlers = new Map(),
    names = new Set(["worktime-shell-old", cacheName, "unrelated-cache"]);
  const requests = [];
  const context = vm.createContext({
    self: {
      location: { origin: "https://fixture.invalid" },
      clients: { claim: async () => {} },
      addEventListener: (type, handler) => handlers.set(type, handler),
    },
    caches: {
      keys: async () => [...names],
      delete: async (name) => names.delete(name),
      open: async (name) => ({
        match: async () => {
          requests.push(name);
          return "current response";
        },
      }),
    },
    fetch: async () => {
      throw Error("offline");
    },
    Response,
    URL,
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, "service-worker.js"), "utf8"),
    context,
  );
  let activation, response;
  handlers.get("activate")({
    waitUntil: (task) => {
      activation = task;
    },
  });
  await activation;
  assert.deepEqual([...names].sort(), ["unrelated-cache", cacheName]);
  handlers.get("fetch")({
    request: { method: "GET" },
    respondWith: (task) => {
      response = task;
    },
  });
  assert.equal(await response, "current response");
  assert.deepEqual(
    requests,
    [cacheName],
    "offline fallback must use the current cache only",
  );
  console.log(
    "Service worker: old owned caches removed, foreign caches preserved, current offline fallback passed.",
  );
}
async function main() {
  await music();
  await musicStorage();
  await saveSession();
  await shuffleCost();
  await serviceWorker();
  const footer = {
    getBoundingClientRect() {
      throw Error("Unexpected synchronous footer layout");
    },
  };
  const tabs = { style: {} };
  let callback,
    disconnected = false;
  const context = vm.createContext({ WorkTimeApp: { ui: {} } });
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets/js/ui/workspace.js"), "utf8"),
    context,
  );
  const workspace = context.WorkTimeApp.ui.createWorkspace({
    document: {
      querySelector: (selector) =>
        selector === ".calendar-footer" ? footer : tabs,
    },
    window: {
      ResizeObserver: class {
        constructor(fn) {
          callback = fn;
        }
        observe() {}
        disconnect() {
          disconnected = true;
        }
      },
    },
    notifications: {
      renderOAStaleNotice() {},
      updateNotificationEmptyState() {},
    },
    renderStats() {},
    renderCalendar() {},
    renderEditor() {},
  });
  workspace.mount();
  callback([{ target: footer, borderBoxSize: [{ blockSize: 42 }] }]);
  assert.equal(tabs.style.height, "42px");
  workspace.dispose();
  callback([{ target: footer, borderBoxSize: [{ blockSize: 60 }] }]);
  assert.equal(tabs.style.height, "42px");
  assert.equal(disconnected, true);
  console.log(
    "Workspace: observer measurements avoid forced mount layout and stop after disposal.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) || ".",
);
const source = path.resolve(__dirname, "..");
const output = path.join(source, "test-results/music");
const fixtures = path.join(output, "library");
fs.mkdirSync(path.join(fixtures, "nested"), { recursive: true });

function wav(seconds = 30) {
  const samples = 8000 * seconds,
    buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buffer.writeInt16LE(
      Math.round(Math.sin((i / 8000) * Math.PI * 440) * 150),
      44 + i * 2,
    );
  return buffer;
}
const fixtureFiles = {
  "Alpha.wav": wav(),
  "nested/Alpha.wav": wav(31),
  "Beta.wav": wav(32),
  "Broken.mp3": Buffer.from("not audio"),
  "Alpha.lrc": Buffer.from(
    "[offset:0]\n[00:00.00]First line\n[00:05.00][00:10.00]Second line\n[00:20.00]Last line",
  ),
  "nested/Alpha.txt": Buffer.from("Plain local lyrics"),
  "cover.png": Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
    "base64",
  ),
};
for (const [name, bytes] of Object.entries(fixtureFiles)) {
  const target = path.join(fixtures, name);
  // Stable fingerprints make reload/reselection checks repeatable.
  fs.writeFileSync(target, bytes);
  fs.utimesSync(target, new Date("2026-01-01"), new Date("2026-01-01"));
}
const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await wait();
  }
  assert.fail(message);
}
async function metadataChecks() {
  const app = { services: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(source, "assets/js/services/music-library.js"),
      "utf8",
    ),
    {
      WorkTimeApp: app,
      TextDecoder,
      Uint8Array,
      DataView,
      Blob,
      DOMException,
      setTimeout,
      atob,
    },
  );
  const lib = app.services.musicLibrary;
  const size32 = (size) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(size);
    return bytes;
  };
  const little32 = (size) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(size);
    return bytes;
  };
  const frame = (key, value) =>
    Buffer.concat([
      Buffer.from(key),
      size32(value.length),
      Buffer.alloc(2),
      value,
    ]);
  const tag = Buffer.concat([
    frame("TIT2", Buffer.concat([Buffer.from([3]), Buffer.from("Title 中文")])),
    frame("TPE1", Buffer.concat([Buffer.from([3]), Buffer.from("Artist")])),
    frame("TALB", Buffer.concat([Buffer.from([3]), Buffer.from("Album")])),
    frame(
      "USLT",
      Buffer.concat([
        Buffer.from([3]),
        Buffer.from("eng"),
        Buffer.from([0]),
        Buffer.from("Embedded lyrics"),
      ]),
    ),
    frame(
      "APIC",
      Buffer.concat([
        Buffer.from([3]),
        Buffer.from("image/png\0"),
        Buffer.from([3, 0]),
        fixtureFiles["cover.png"],
      ]),
    ),
  ]);
  const syncSize = Buffer.from([
    (tag.length >>> 21) & 127,
    (tag.length >>> 14) & 127,
    (tag.length >>> 7) & 127,
    tag.length & 127,
  ]);
  const mp3 = new File(
    [Buffer.concat([Buffer.from([73, 68, 51, 3, 0, 0]), syncSize, tag])],
    "test.mp3",
  );
  const tags = await lib.metadata(mp3);
  assert.equal(tags.title, "Title 中文");
  assert.equal(tags.artist, "Artist");
  assert.equal(tags.album, "Album");
  assert.equal(tags.lyrics, "Embedded lyrics");
  assert.equal(tags.cover.size, fixtureFiles["cover.png"].length);
  const atom = (kind, body) =>
    Buffer.concat([size32(body.length + 8), Buffer.from(kind, "latin1"), body]);
  const mp4Title = atom(
    "©nam",
    atom(
      "data",
      Buffer.concat([size32(1), size32(0), Buffer.from("M4A title")]),
    ),
  );
  const mp4Cover = atom(
    "covr",
    atom(
      "data",
      Buffer.concat([size32(14), size32(0), fixtureFiles["cover.png"]]),
    ),
  );
  const moov = atom(
    "moov",
    atom(
      "udta",
      atom(
        "meta",
        Buffer.concat([
          Buffer.alloc(4),
          atom("ilst", Buffer.concat([mp4Title, mp4Cover])),
        ]),
      ),
    ),
  );
  const m4a = await lib.metadata(
    new File(
      [
        atom("ftyp", Buffer.from("M4A ")),
        atom("mdat", Buffer.alloc(90000)),
        moov,
      ],
      "test.m4a",
    ),
  );
  assert.equal(m4a.title, "M4A title");
  assert.equal(m4a.cover.type, "image/png");
  const comments = [
    "TITLE=FLAC title",
    "ARTIST=FLAC artist",
    "LYRICS=FLAC lyrics",
  ].map((value) =>
    Buffer.concat([little32(Buffer.byteLength(value)), Buffer.from(value)]),
  );
  const commentBlock = Buffer.concat([
    little32(4),
    Buffer.from("test"),
    little32(comments.length),
    ...comments,
  ]);
  const block = (kind, body) =>
    Buffer.concat([
      Buffer.from([
        kind,
        (body.length >>> 16) & 255,
        (body.length >>> 8) & 255,
        body.length & 255,
      ]),
      body,
    ]);
  const flac = await lib.metadata(
    new File([Buffer.from("fLaC"), block(132, commentBlock)], "test.flac"),
  );
  assert.equal(flac.title, "FLAC title");
  assert.equal(flac.artist, "FLAC artist");
  assert.equal(flac.lyrics, "FLAC lyrics");
  const infoField = (kind, value) =>
    Buffer.concat([
      Buffer.from(kind),
      little32(Buffer.byteLength(value)),
      Buffer.from(value),
      Buffer.alloc(Buffer.byteLength(value) % 2),
    ]);
  const info = Buffer.concat([
    Buffer.from("INFO"),
    infoField("INAM", "WAV title\0"),
  ]);
  const wave = Buffer.concat([
    Buffer.from("RIFF"),
    little32(info.length + 12),
    Buffer.from("WAVELIST"),
    little32(info.length),
    info,
  ]);
  assert.equal(
    (await lib.metadata(new File([wave], "tags.wav"))).title,
    "WAV title",
  );
  assert.deepEqual(
    Object.keys(
      await lib.metadata(new File([Buffer.from("ID3")], "broken.mp3")),
    ),
    [],
  );
  const index = new Map([
    [
      "test.lrc",
      {
        getFile: async () => new File(["[00:01.00]External wins"], "test.lrc"),
      },
    ],
    [
      "test.txt",
      { getFile: async () => new File(["Text fallback"], "test.txt") },
    ],
  ]);
  const details = await lib.details(
    { path: "test.mp3", title: "fallback", getFile: async () => mp3 },
    index,
  );
  assert.equal(details.lyrics.lines[0].text, "External wins");
  assert.equal(details.title, "Title 中文");
  index.delete("test.lrc");
  assert.equal(
    (await lib.details({ path: "test.mp3", getFile: async () => mp3 }, index))
      .lyrics.text,
    "Embedded lyrics",
  );
  await assert.rejects(
    () =>
      lib.scan(
        {
          async *values() {
            yield {
              kind: "file",
              name: "blocked.wav",
              async getFile() {
                throw new DOMException("denied", "NotAllowedError");
              },
            };
          },
        },
        [],
      ),
    { name: "NotAllowedError" },
  );
  console.log(
    "Music metadata: ID3 text/artwork/lyrics, trailing M4A atoms, FLAC comments, WAV INFO, malformed tags, local lyric precedence and revoked access passed.",
  );
}
async function modelChecks() {
  const instances = [],
    urls = new Set(),
    mediaActions = new Map();
  class FakeAudio extends EventTarget {
    constructor() {
      super();
      instances.push(this);
      this.paused = true;
      this.currentTime = 0;
      this.duration = NaN;
      this.volume = 1;
      this.muted = false;
      this.playbackRate = 1;
      this.src = "";
    }
    removeAttribute() {
      this.src = "";
    }
    getAttribute() {
      return this.src;
    }
    load() {
      this.currentTime = 0;
      this.duration = this.src ? 30 : NaN;
      if (this.src)
        queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
    }
    async play() {
      this.paused = false;
      this.dispatchEvent(new Event("play"));
    }
    pause() {
      if (!this.paused) {
        this.paused = true;
        this.dispatchEvent(new Event("pause"));
      }
    }
  }
  const window = new EventTarget();
  window.MediaMetadata = class {};
  let saved = {},
    denyStorage = false,
    delayScan = false;
  const library = {
    async scan(handle, files, { cancelled }) {
      if (delayScan) await wait(60);
      if (cancelled()) throw new DOMException("cancel", "AbortError");
      return {
        tracks: (handle?.files || files).map((file) => ({
          path: file.name,
          fingerprint: "100:1",
          title: file.name,
          artist: "",
          album: "",
          getFile: async () => new Blob(["audio"]),
        })),
        index: new Map(),
      };
    },
    async details(track) {
      return {
        title: track.title,
        artist: "Artist",
        album: "Album",
        lyrics: { lines: [], text: "" },
      };
    },
    async metadata() {
      return {};
    },
    lyrics() {
      return { lines: [], text: "" };
    },
  };
  const app = {
    services: {
      musicLibrary: library,
      musicStorage: {
        async read() {
          return saved;
        },
        async write(value) {
          if (denyStorage) throw Error("quota");
          saved = value;
        },
      },
    },
    ui: {},
  };
  const context = vm.createContext({
    WorkTimeApp: app,
    Audio: FakeAudio,
    window,
    navigator: {
      mediaSession: {
        setActionHandler: (key, value) => mediaActions.set(key, value),
        setPositionState() {},
      },
    },
    MediaMetadata: window.MediaMetadata,
    URL: {
      createObjectURL() {
        const value = "blob:" + Math.random();
        urls.add(value);
        return value;
      },
      revokeObjectURL(value) {
        urls.delete(value);
      },
    },
    setTimeout,
    clearTimeout,
    queueMicrotask,
    DOMException,
    Blob,
    Date,
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(source, "assets/js/controllers/music.js"),
      "utf8",
    ),
    context,
  );
  const player = app.ui.createMusicController();
  await player.ready;
  const files = ["A.wav", "B.wav", "C.wav", "D.wav"].map((name) => ({ name }));
  player.importFiles(files);
  await until(
    () =>
      player.snapshot().tracks.length === 4 &&
      !player.snapshot().busy &&
      player.snapshot().details,
    "Initial scan",
  );
  assert.equal(instances.length, 1);
  assert.equal(player.snapshot().paused, true);
  player.toggle();
  await wait();
  assert.equal(player.snapshot().paused, false);
  player.seek(12);
  assert.equal(player.snapshot().position, 12);
  player.volume(0.2);
  player.mute();
  player.rate(1.5);
  player.mode("order");
  assert.equal(player.snapshot().volume, 0.2);
  assert.equal(player.snapshot().muted, true);
  assert.equal(player.snapshot().rate, 1.5);
  const track = player.snapshot().current;
  player.favorite(track);
  assert.equal(player.isFavorite(track), true);
  player.mode("shuffle");
  const order = [player.snapshot().current.path];
  for (let i = 0; i < 3; i++) {
    player.next();
    await wait();
    order.push(player.snapshot().current.path);
  }
  assert.equal(new Set(order).size, 4, "One shuffle cycle has no repeats");
  player.previous();
  await wait();
  assert.equal(player.snapshot().current.path, order[2]);
  player.next();
  await wait();
  assert.equal(player.snapshot().current.path, order[3]);
  player.mode("one");
  const one = player.snapshot().current.path;
  instances[0].dispatchEvent(new Event("ended"));
  await wait();
  assert.equal(player.snapshot().current.path, one);
  assert.equal(player.snapshot().paused, false);
  player.setSleep("track");
  instances[0].dispatchEvent(new Event("ended"));
  assert.equal(player.snapshot().paused, true);
  assert.equal(player.snapshot().sleep, "off");
  player.setSleep("15");
  context.Date = class extends Date {
    static now() {
      return Date.now() + 16 * 60000;
    }
  };
  player.toggle();
  await wait();
  instances[0].dispatchEvent(new Event("timeupdate"));
  assert.equal(player.snapshot().paused, true);
  assert.equal(player.snapshot().sleep, "off");
  context.Date = Date;
  player.mode("list");
  player.select(player.snapshot().tracks.at(-1));
  await wait();
  instances[0].dispatchEvent(new Event("ended"));
  await wait();
  assert.equal(player.snapshot().current.path, "A.wav");
  player.mode("order");
  player.select(player.snapshot().tracks.at(-1));
  await wait();
  instances[0].dispatchEvent(new Event("ended"));
  await wait();
  assert.equal(player.snapshot().paused, true);
  assert.equal(player.snapshot().current.path, "D.wav");
  player.mode("list");
  player.select(player.snapshot().tracks[0]);
  await wait();
  for (let i = 0; i < 4; i++) {
    instances[0].dispatchEvent(new Event("error"));
    await wait();
  }
  assert.equal(player.snapshot().status, "allFailed");
  assert.equal(player.snapshot().paused, true);
  player.select(player.snapshot().tracks[0]);
  await wait();
  player.seek(11);
  player.setSleep("60");
  window.dispatchEvent(new Event("pagehide"));
  await wait();
  assert.equal(saved.position, 11);
  assert.equal(saved.tracks.length, 4);
  assert.equal(saved.sleep, undefined);
  assert.equal(saved.tracks[0].file, undefined);
  player.dispose();
  await wait();
  assert.equal(urls.size, 0);
  const restored = app.ui.createMusicController();
  await restored.ready;
  assert.equal(restored.snapshot().position, 11);
  assert.equal(restored.snapshot().sleep, "off");
  assert.equal(restored.snapshot().paused, true);
  assert.equal(restored.snapshot().needsAccess, true);
  restored.importFiles(files);
  await until(
    () =>
      !restored.snapshot().busy &&
      !restored.snapshot().needsAccess &&
      restored.snapshot().details,
    "Reselection",
  );
  assert.equal(restored.snapshot().position, 11);
  assert.equal(restored.isFavorite(restored.snapshot().tracks[0]), true);
  delayScan = true;
  restored.importFiles([{ name: "stale.wav" }]);
  restored.cancelScan();
  await wait(100);
  assert.equal(restored.snapshot().tracks.length, 4);
  restored.importFiles([{ name: "old.wav" }]);
  restored.importFiles([{ name: "new.wav" }]);
  await until(
    () => restored.snapshot().tracks[0]?.path === "new.wav",
    "Latest scan wins",
  );
  delayScan = false;
  denyStorage = true;
  restored.volume(0.5);
  await wait(450);
  assert.equal(restored.snapshot().storageIssue, true);
  denyStorage = false;
  restored.forget();
  await wait();
  assert.equal(saved.tracks.length, 0);
  assert.equal(saved.handle, null);
  let permission = "prompt",
    prompts = 0;
  const directoryHandle = {
    name: "Native",
    files,
    async queryPermission() {
      return permission;
    },
    async requestPermission() {
      prompts++;
      permission = "granted";
      return permission;
    },
  };
  window.showDirectoryPicker = async (options) => {
    assert.equal(options.mode, "read");
    return directoryHandle;
  };
  assert.equal(await restored.choose(), true);
  await until(
    () =>
      restored.snapshot().tracks.length === 4 && restored.snapshot().details,
    "Native directory scan",
  );
  assert.equal(await restored.rescan(), true);
  assert.equal(prompts, 1);
  await until(
    () => !restored.snapshot().busy && !restored.snapshot().readingTags,
    "Native rescan",
  );
  restored.seek(9);
  window.dispatchEvent(new Event("pagehide"));
  await wait();
  restored.dispose();
  await wait();
  const nativeRestore = app.ui.createMusicController();
  await nativeRestore.ready;
  await until(
    () => !nativeRestore.snapshot().busy && nativeRestore.snapshot().details,
    "Authorized native restore",
  );
  assert.equal(nativeRestore.snapshot().position, 9);
  assert.equal(nativeRestore.snapshot().paused, true);
  assert.equal(prompts, 1, "Restore never asks permission automatically");
  window.showDirectoryPicker = async () => {
    throw new DOMException("cancel", "AbortError");
  };
  assert.equal(await nativeRestore.choose(), true);
  assert.equal(nativeRestore.snapshot().tracks.length, 4);
  window.showDirectoryPicker = async () => {
    throw new DOMException("unavailable", "SecurityError");
  };
  assert.equal(await nativeRestore.choose(), false);
  nativeRestore.forget();
  nativeRestore.dispose();
  console.log(
    "Music state: playback, shuffle history, repeat, failures, timers, persistence, cancellation and URL cleanup passed.",
  );
}

async function miniChecks(browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    locale: "zh-CN",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await page.addInitScript(() => {
    window.showDirectoryPicker = undefined;
    const NativeAudio = window.Audio;
    window.musicTestAudio = [];
    window.Audio = function (...args) {
      const audio = new NativeAudio(...args);
      window.musicTestAudio.push(audio);
      return audio;
    };
    window.Audio.prototype = NativeAudio.prototype;
  });
  try {
    await page.addInitScript(() =>
      localStorage.setItem("worktime.onboarding.v1", "done"),
    );
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#musicOpen").click();
    await page.locator("#musicMinimize").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#musicDialog").hidden &&
        !document.querySelector("#musicPanel").hidden,
    );
    assert.equal(await page.locator("#musicMiniPlay").isDisabled(), true);
    assert.equal(
      await page.locator("#musicPanel input, #musicPanel select").count(),
      0,
    );
    await page.locator("#musicMiniExpand").click();
    await page
      .locator('#musicDialog input[type="file"]')
      .setInputFiles(fixtures);
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".music-track").length === 4 &&
        document.querySelector(".music-progress").max === "30",
    );
    await page.evaluate(() => {
      window.musicTestAudio[0].currentTime = 9;
      window.musicTestSource = window.musicTestAudio[0].src;
    });
    await page.locator("#musicMinimize").click();
    await page.waitForFunction(
      () => document.querySelector("#musicMiniPlay")?.disabled === false,
    );
    const height = () =>
      page
        .locator(".date-info-area")
        .evaluate((element) => element.getBoundingClientRect().height);
    const musicHeight = await height();
    await page.locator("#date-tab-weather").click();
    assert.ok(Math.abs((await height()) - musicHeight) <= 1);
    await page.locator("#date-tab-games").click();
    assert.ok(Math.abs((await height()) - musicHeight) <= 1);
    await page.locator("#musicOpen").click();
    await page.waitForFunction(
      () => !document.querySelector("#musicPanel").hidden,
    );
    assert.equal(
      await page.locator("#musicOpen").getAttribute("aria-selected"),
      "true",
    );
    for (let i = 0; i < 3; i++) {
      await page.locator("#musicMiniExpand").click();
      await page.locator("#musicMinimize").click();
      await page.waitForFunction(
        () => document.querySelector("#musicDialog").hidden,
      );
      const audio = await page.evaluate(() => ({
        count: window.musicTestAudio.length,
        position: window.musicTestAudio[0].currentTime,
        paused: window.musicTestAudio[0].paused,
        same: window.musicTestAudio[0].src === window.musicTestSource,
      }));
      assert.deepEqual(audio, {
        count: 1,
        position: 9,
        paused: true,
        same: true,
      });
    }
    await page.locator("#musicMiniPlay").click();
    await page.waitForFunction(() => !window.musicTestAudio[0].paused);
    await page.locator("#musicMiniExpand").click();
    await page.locator("#musicMinimize").click();
    await page.waitForFunction(
      () => document.querySelector("#musicDialog").hidden,
    );
    assert.equal(
      await page.evaluate(() => window.musicTestAudio[0].paused),
      false,
    );
    assert.equal(
      await page.evaluate(
        () => window.musicTestAudio[0].src === window.musicTestSource,
      ),
      true,
    );
    await page.locator("#musicMiniNext").click();
    await page.waitForFunction(
      () => document.querySelector(".music-mini-song").textContent === "Beta",
    );
    await page.locator("#musicMiniPrevious").click();
    await page.waitForFunction(
      () => document.querySelector(".music-mini-song").textContent === "Alpha",
    );
    await page.locator("#musicMiniPlay").click();
    await page.waitForFunction(() => window.musicTestAudio[0].paused);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.locator("#musicOpen").click();
      for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
        await page.evaluate(
          (language) => WorkTimeApp.i18n.setLanguage(language),
          language,
        );
        assert.equal(await page.locator("#musicPanel").isVisible(), true);
        assert.equal(
          await page.locator("#musicOpen").getAttribute("aria-selected"),
          "true",
        );
        const fit = await page.locator("#musicPanel").evaluate((panel) => {
          const controls = panel
              .querySelector(".music-mini-transport")
              .getBoundingClientRect(),
            bounds = panel.getBoundingClientRect();
          return (
            panel.scrollWidth <= panel.clientWidth &&
            panel.scrollHeight <= panel.clientHeight &&
            controls.top >= bounds.top &&
            controls.bottom <= bounds.bottom
          );
        });
        assert.equal(fit, true, JSON.stringify({ viewport, language }));
      }
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await page.screenshot({
        path: path.join(output, `mini-${viewport.width}.png`),
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("#pageSettingsOpen").click();
    await page.locator("#musicOpen").click();
    assert.equal(await page.locator("#musicPanel").isVisible(), true);
    const settingsHeight = await height();
    await page.locator("#date-tab-weather").click();
    assert.ok(Math.abs((await height()) - settingsHeight) <= 1);
    await page.locator("#personalSettingsCancel").click();
    await page.locator("#agendaMode").click();
    await page.locator("#musicOpen").click();
    assert.equal(await page.locator("#musicPanel").isVisible(), true);
    assert.equal(
      await page
        .locator(".editor")
        .evaluate((editor) =>
          editor.classList.contains("agenda-auxiliary-open"),
        ),
      true,
    );
    const agendaHeight = await height();
    await page.locator("#date-tab-weather").click();
    assert.ok(Math.abs((await height()) - agendaHeight) <= 1);
    await page.locator("#musicOpen").click();
    await page.locator("#musicMiniExpand").click();
    await page.locator("#musicMinimize").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#musicDialog").hidden &&
        document.querySelector("#musicPanel").getBoundingClientRect().height >
          0,
    );
    await page.locator("#nextMonth").click();
    await page.locator("#musicOpen").click();
    assert.equal(await page.locator("#musicPanel").isVisible(), true);
    const longFolder = path.join(output, "long-library");
    const longTitle =
      "A long song title with enough words to test safe ellipsis and a complete hover label "
        .repeat(2)
        .trim();
    fs.mkdirSync(longFolder, { recursive: true });
    fs.writeFileSync(path.join(longFolder, longTitle + ".wav"), wav());
    await page
      .locator('#musicDialog input[type="file"]')
      .setInputFiles(longFolder);
    await page.waitForFunction(
      (title) =>
        document.querySelector(".music-mini-song").textContent === title,
      longTitle,
    );
    const longLabel = await page
      .locator(".music-mini-song")
      .evaluate((element) => ({
        title: element.title,
        ellipsis: getComputedStyle(element).textOverflow,
        fits: element.clientWidth < element.scrollWidth,
      }));
    assert.equal(longLabel.title, longTitle);
    assert.equal(longLabel.ellipsis, "ellipsis");
    assert.equal(longLabel.fits, true);
    await page.waitForFunction(
      async () =>
        (await WorkTimeApp.services.musicStorage.readPresentation()) === "mini",
    );
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#musicOpen").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#musicPanel")?.getBoundingClientRect().height >
        0,
    );
    assert.equal(
      await page.locator("#musicDialog").evaluate((element) => element.hidden),
      true,
    );
    assert.equal(
      await page.locator("#musicOpen").getAttribute("aria-selected"),
      "true",
    );
    assert.equal(
      await page
        .locator(".music-mini-player")
        .evaluate((element) => getComputedStyle(element).display),
      "flex",
      "Restoring mini mode must also load its styles",
    );
    assert.equal(
      await page.evaluate(() => window.musicTestAudio[0].paused),
      true,
    );
    await page.locator("#musicMiniExpand").click();
    await page.waitForFunction(
      () => document.querySelector("#musicDialog")?.dataset.state === "open",
    );
    assert.equal(
      await page.locator("#musicOpen").getAttribute("aria-selected"),
      null,
    );
    await page.locator("#musicExitButton").click();
    await page.locator("#musicOpen").click();
    await page.waitForFunction(
      () => document.querySelector("#musicDialog").dataset.state === "open",
    );
    await page.waitForFunction(
      async () =>
        (await WorkTimeApp.services.musicStorage.readPresentation()) === "full",
    );
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#musicOpen").click();
    await page.waitForFunction(
      () => document.querySelector("#musicDialog")?.dataset.state === "open",
    );
    assert.equal(
      await page.evaluate(() => window.musicTestAudio[0].paused),
      true,
    );
    await page.locator("#musicMinimize").click();
    await page.waitForFunction(
      () => document.querySelector("#musicDialog").hidden,
    );
    await page.locator("#date-tab-weather").click();
    await page.locator("#musicOpen").click();
    assert.equal(await page.locator("#musicPanel").isVisible(), true);
    assert.equal(await page.evaluate(() => window.musicTestAudio.length), 1);
    assert.deepEqual(errors, []);
    console.log(
      "Music mini: empty state, controls, continuous audio, single audio instance, six languages, matching panel heights, agenda drawer, settings and persistent full/mini presentation passed.",
    );
  } finally {
    await page.close();
  }
}
async function animationChecks(browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "no-preference",
    locale: "zh-CN",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  const capture = async (kind, exit) =>
    page.evaluate(
      ({ kind, exit }) => {
        const shell = document.getElementById(
          kind === "game"
            ? "gameShell"
            : kind === "reader"
              ? "readerDialog"
              : "musicDialog",
        );
        document.querySelector(exit).click();
        const parts = {
          shell,
          surface: shell.querySelector(".game-surface"),
          toolbar: shell.querySelector(
            kind === "game"
              ? ".game-toolbar"
              : kind === "reader"
                ? ".reader-header"
                : ".music-header",
          ),
          content: shell.querySelector(
            kind === "game"
              ? ".game-content"
              : kind === "reader"
                ? ".reader-main"
                : ".music-main",
          ),
          summary: document.querySelector(".workspace > .summary-sidebar"),
          origin: document.querySelector(".workspace > section.panel"),
          editor: document.querySelector(".workspace > .editor"),
        };
        return {
          background: getComputedStyle(shell).backgroundColor,
          state: shell.dataset.state,
          tracks: Object.fromEntries(
            Object.entries(parts).map(([name, element]) => [
              name,
              element
                .getAnimations()
                .map((animation) => {
                  const frames = animation.effect.getKeyframes();
                  const keys = Object.keys(frames[0]).filter((key) =>
                    ["opacity", "transform", "clipPath"].includes(key),
                  );
                  const timing = animation.effect.getTiming();
                  return {
                    duration: timing.duration,
                    delay: timing.delay,
                    easing: timing.easing,
                    keys,
                  };
                })
                .filter((track) => track.keys.length),
            ]),
          ),
        };
      },
      { kind, exit },
    );
  try {
    await page.addInitScript(() =>
      localStorage.setItem("worktime.onboarding.v1", "done"),
    );
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#date-tab-games").click();
    await page.locator("#gamesPanel .game-menu-play").click();
    await page.waitForFunction(
      () => document.querySelector("#gameShell").dataset.state === "open",
    );
    const game = await capture("game", "#gameExitButton");
    await page.waitForFunction(
      () => document.querySelector("#gameShell").hidden,
    );
    await page.locator("#musicOpen").click();
    await page.waitForFunction(
      () => document.querySelector("#musicDialog")?.dataset.state === "open",
    );
    const music = await capture("music", "#musicExitButton");
    assert.equal(game.background, "rgba(0, 0, 0, 0)");
    assert.equal(
      music.background,
      game.background,
      "The shell must not mask the independently fading surface",
    );
    assert.equal(music.state, "closing");
    assert.deepEqual(
      music.tracks,
      game.tracks,
      "Music and games must share every close track's timing and easing",
    );
    await page.waitForFunction(
      () => document.querySelector("#musicDialog").hidden,
    );
    await page.locator("#musicOpen").click();
    await page.waitForFunction(
      () => document.querySelector("#musicDialog").dataset.state === "open",
    );
    const minimize = await capture("music", "#musicMinimize");
    assert.deepEqual(minimize.tracks, game.tracks);
    await page.waitForFunction(
      () =>
        document.querySelector("#musicDialog").hidden &&
        !document.querySelector("#musicPanel").hidden,
    );
    await page.evaluate(() => {
      WorkTimeApp.ui.music.expand();
    });
    await page.waitForFunction(
      () => document.querySelector("#musicDialog").dataset.state === "opening",
    );
    await page.evaluate(() => {
      WorkTimeApp.ui.music.minimize();
      WorkTimeApp.ui.music.expand();
    });
    await page.waitForFunction(
      () => document.querySelector("#musicDialog").dataset.state === "open",
    );
    await page.locator("#musicExitButton").click();
    await page.waitForFunction(
      () => document.querySelector("#musicDialog").hidden,
    );
    assert.equal(
      await page
        .locator(".workspace")
        .evaluate((workspace) =>
          workspace.classList.contains("is-game-transitioning"),
        ),
      false,
    );
    await page.locator("#readerOpen").click();
    await page.waitForFunction(
      () => document.querySelector("#readerDialog")?.dataset.state === "open",
    );
    await page
      .locator('#readerDialog > input[type="file"]')
      .first()
      .setInputFiles(fixtures);
    await page.waitForSelector(".reader-book-open");
    await page.locator(".reader-book-open").first().click();
    await page.waitForFunction(
      () => !!document.querySelector(".reader-book-title").textContent,
    );
    const reader = await capture("reader", "#readerExit");
    assert.equal(
      reader.background,
      game.background,
      "Reader shell must be transparent",
    );
    assert.equal(
      reader.state,
      "closing",
      "Reader return starts in the click handler",
    );
    assert.deepEqual(
      reader.tracks,
      game.tracks,
      "Reader/music/games share all close animation tracks",
    );
    await page.waitForFunction(
      () => document.querySelector("#readerDialog").hidden,
    );
    // Storage latency and failure must not delay or cancel the transition.
    await page.evaluate(() => {
      WorkTimeApp.services.readerStorage.write = () =>
        new Promise((resolve) => {
          window.finishReaderWrite = resolve;
        });
    });
    await page.locator("#readerOpen").click();
    await page.waitForFunction(
      () => document.querySelector("#readerDialog").dataset.state === "open",
    );
    const slow = await capture("reader", "#readerMinimize");
    assert.equal(slow.state, "closing");
    assert.deepEqual(slow.tracks, game.tracks);
    await page.waitForFunction(
      () => document.querySelector("#readerDialog").hidden,
    );
    await page.evaluate(() => {
      WorkTimeApp.services.readerStorage.write = async () => {
        throw Error("Quota");
      };
      window.finishReaderWrite?.();
    });
    await page.evaluate(() => WorkTimeApp.ui.reader.expand());
    await page.waitForFunction(
      () => document.querySelector("#readerDialog").dataset.state === "open",
    );
    await page.evaluate(() => WorkTimeApp.ui.reader.close());
    await page.waitForFunction(
      () => document.querySelector("#readerDialog").dataset.state === "closing",
    );
    await page.evaluate(() => WorkTimeApp.ui.reader.open());
    await page.waitForFunction(
      () => document.querySelector("#readerDialog").dataset.state === "open",
    );
    await page.waitForSelector(".reader-warning", { state: "visible" });
    await page.locator("#readerFullscreen").click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.locator("#readerExit").click();
    await page.waitForFunction(
      () =>
        !document.fullscreenElement &&
        document.querySelector("#readerDialog").dataset.state === "closing",
    );
    assert.ok(
      await page
        .locator("#readerDialog")
        .evaluate((e) =>
          e
            .getAnimations()
            .some((a) =>
              a.effect.getKeyframes().some((frame) => "clipPath" in frame),
            ),
        ),
      "Fullscreen return runs the collapse animation",
    );
    await page.waitForFunction(
      () => document.querySelector("#readerDialog").hidden,
    );
    assert.equal(
      await page
        .locator("#readerOpen")
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.evaluate(() => WorkTimeApp.ui.reader.expand());
    await page.waitForFunction(
      () => document.querySelector("#readerDialog").dataset.state === "open",
    );
    await page.locator("#readerFullscreen").click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.locator("#readerMinimize").click();
    await page.waitForFunction(
      () =>
        !document.fullscreenElement &&
        document.querySelector("#readerDialog").hidden &&
        !document.querySelector("#readerPanel").hidden &&
        document
          .querySelector("#readerMiniViewport")
          .getAttribute("aria-busy") === "false",
    );
    await page.evaluate(async () => {
      const reader = WorkTimeApp.ui.reader;
      await reader.expand();
      await Promise.all([reader.minimize(), reader.expand()]);
    });
    await page.waitForFunction(
      () => document.querySelector("#readerDialog").dataset.state === "open",
    );
    assert.equal(
      await page.locator("#readerMiniViewport .reader-stage").count(),
      0,
    );
    assert.equal(
      await page.locator("#readerViewport .reader-stage").count(),
      1,
      "Latest presentation request wins without duplicate renderers",
    );
    await page.evaluate(() => WorkTimeApp.ui.reader.close());
    await page.waitForFunction(
      () => document.querySelector("#readerDialog").hidden,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Workspace motion: reader/music/games share transparent shells, timing, easing and reversal behavior; slow/failed reader storage and fullscreen return passed.",
    );
  } finally {
    await page.close();
  }
}
async function browserChecks() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
      locale: "zh-CN",
    });
    const errors = [],
      remote = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) remote.push(request.url());
    });
    await page.route(/^https?:/, (route) => route.abort());
    await page.addInitScript(() => {
      window.showDirectoryPicker = undefined;
    });
    await page.addInitScript(() =>
      localStorage.setItem("worktime.onboarding.v1", "done"),
    );
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    assert.equal(
      await page.evaluate(() => typeof WorkTimeApp.ui.createMusicController),
      "undefined",
      "Music modules load only on first use",
    );
    const active = await page
      .locator('.notification-tabs [aria-selected="true"]')
      .getAttribute("id");
    async function checkEntryHover() {
      const entry = page.locator("#musicOpen");
      await entry.evaluate((element) => element.blur());
      await page.mouse.move(0, 0);
      assert.equal(
        await entry.evaluate(
          (element) => getComputedStyle(element, "::before").opacity,
        ),
        "0",
      );
      assert.equal(await entry.locator("svg.headphones-icon").count(), 1);
      await entry.hover();
      assert.equal(
        await entry.evaluate(
          (element) => getComputedStyle(element, "::before").opacity,
        ),
        "0.45",
      );
      await page.mouse.move(0, 0);
      assert.equal(
        await entry.evaluate(
          (element) => getComputedStyle(element, "::before").opacity,
        ),
        "0",
      );
      assert.equal(
        await entry.getAttribute("aria-selected"),
        null,
        "The player remains a dialog action rather than a selected tab",
      );
    }
    await checkEntryHover();
    await page.locator("#musicOpen").click();
    await page.waitForFunction(
      () => document.querySelector("#musicDialog")?.dataset.state === "open",
    );
    assert.equal(
      await page
        .locator(".workspace")
        .evaluate((element) => element.classList.contains("is-game-expanded")),
      true,
    );
    assert.equal(
      await page
        .locator("#musicDialog")
        .evaluate(
          (element) =>
            element.parentElement.classList.contains("workspace") &&
            element.tagName !== "DIALOG",
        ),
      true,
    );
    assert.equal(
      await page
        .locator(".workspace > .editor")
        .evaluate((element) => element.inert),
      true,
    );
    await page.locator("#musicExitButton").focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await page
        .locator(".music-settings > summary")
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .locator("#musicExitButton")
        .evaluate((element) => element === document.activeElement),
      true,
    );
    assert.equal(await page.locator(".music-onboarding").isVisible(), true);
    assert.equal(await page.locator(".music-inspector").isVisible(), false);
    await page.locator("#musicDialog").focus();
    await page.mouse.move(1400, 880);
    await page.screenshot({ path: path.join(output, "player-empty-1440.png") });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 740 });
      await page.waitForFunction(() => {
        const button = document
          .querySelector("#musicChoose")
          .getBoundingClientRect();
        return (
          button.width > 0 &&
          button.left >= 0 &&
          button.right <= innerWidth &&
          button.bottom <
            document.querySelector(".music-controls").getBoundingClientRect()
              .top
        );
      });
      await page.screenshot({
        path: path.join(output, `player-empty-${width}.png`),
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .locator('#musicDialog input[type="file"]')
      .setInputFiles(fixtures);
    await page.waitForFunction(
      () => document.querySelectorAll(".music-track").length === 4,
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".music-lyric-line").length === 4,
    );
    await page.locator("#musicLyricsToggle").click();
    await page.locator(".music-settings > summary").focus();
    await page.keyboard.press("Space");
    assert.equal(
      await page.locator(".music-settings").evaluate((element) => element.open),
      true,
    );
    await page.locator(".music-settings select").nth(1).selectOption("1.25");
    await page.locator(".music-settings select").nth(2).selectOption("30");
    await page.waitForFunction(() =>
      document
        .querySelector(".music-settings > summary")
        .classList.contains("has-timer"),
    );
    assert.equal(
      await page
        .locator(".music-settings > summary")
        .evaluate((element) => element.classList.contains("has-timer")),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator(".music-settings").evaluate((element) => element.open),
      false,
    );
    assert.equal(
      await page.locator("#musicDialog").evaluate((element) => element.hidden),
      false,
    );
    await page.locator("#musicShuffle").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#musicShuffle").getAttribute("aria-pressed") ===
        "true",
    );
    await page.locator("#musicRepeat").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#musicRepeat").getAttribute("aria-pressed") ===
        "true",
    );
    await page.locator("#musicPlay").click();
    await page.waitForFunction(() =>
      document.querySelector("#musicOpen").classList.contains("is-playing"),
    );
    assert.equal(
      await page
        .locator('.notification-tabs [aria-selected="true"]')
        .getAttribute("id"),
      active,
    );
    await page.locator(".music-lyric-line").nth(2).click();
    await page.waitForFunction(
      () => Number(document.querySelector(".music-progress").value) >= 10,
    );
    await page.locator("#musicCurrentFavorite").click();
    await page.locator("#musicFavorites").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".music-track").length === 1,
    );
    await page.locator("#musicFavorites").click();
    await page.locator(".music-search").fill("nested");
    await page.waitForFunction(
      () => document.querySelectorAll(".music-track").length === 1,
    );
    await page.locator(".music-track-select").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".music-plain-lyrics")?.textContent ===
        "Plain local lyrics",
    );
    await page.locator(".music-search").fill("");
    await page
      .locator('.music-track-select[data-music-path="Broken.mp3"]')
      .click();
    await page.waitForFunction(() =>
      document.querySelector(".music-track-error"),
    );
    await page
      .locator('.music-track-select[data-music-path="Alpha.wav"]')
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".music-lyric-line").length === 4,
    );
    await page.locator(".music-lyric-line").nth(2).click();
    await page.locator("#musicDialog").focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(
      () => Number(document.querySelector(".music-progress").value) >= 15,
    );
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () =>
        !document.querySelector("#musicOpen").classList.contains("is-playing"),
    );
    await page.keyboard.press("Space");
    await page.waitForFunction(() =>
      document.querySelector("#musicOpen").classList.contains("is-playing"),
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#musicDialog").evaluate((element) => element.hidden),
      true,
    );
    assert.equal(
      await page
        .locator(".workspace")
        .evaluate((element) => element.classList.contains("is-game-expanded")),
      false,
    );
    assert.equal(
      await page
        .locator(".workspace > .editor")
        .evaluate((element) => element.inert),
      false,
    );
    assert.equal(
      await page
        .locator("#musicOpen")
        .evaluate((element) => element === document.activeElement),
      true,
    );
    assert.equal(
      await page
        .locator("#musicOpen")
        .evaluate((element) => element.classList.contains("is-playing")),
      true,
    );
    await wait(600);
    await checkEntryHover();
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#musicOpen").click();
    await page.waitForFunction(
      () => document.querySelector("#musicReconnect")?.hidden === false,
    );
    assert.equal(
      await page
        .locator("#musicOpen")
        .evaluate((element) => element.classList.contains("is-playing")),
      false,
    );
    await page
      .locator('#musicDialog input[type="file"]')
      .setInputFiles(fixtures);
    await page.waitForFunction(
      () => Number(document.querySelector(".music-progress").value) >= 15,
    );
    assert.equal(
      await page
        .locator("#musicOpen")
        .evaluate((element) => element.classList.contains("is-playing")),
      false,
    );
    const libraryResult = await page.evaluate(async () => {
      const lib = WorkTimeApp.services.musicLibrary;
      const enc = new TextEncoder();
      const title = enc.encode("Tagged title"),
        frame = new Uint8Array(11 + title.length);
      frame.set(enc.encode("TIT2"));
      new DataView(frame.buffer).setUint32(4, title.length + 1);
      frame[10] = 3;
      frame.set(title, 11);
      const bytes = new Uint8Array(10 + frame.length);
      bytes.set([73, 68, 51, 3, 0, 0, 0, 0, 0, frame.length]);
      bytes.set(frame, 10);
      const tags = await lib.metadata(new File([bytes], "tag.mp3"));
      const empty = await lib.scan(null, [new File(["text"], "readme.txt")]);
      let cancelled = false;
      try {
        await lib.scan(null, [new File(["a"], "a.wav")], {
          cancelled: () => true,
        });
      } catch (error) {
        cancelled = error.name === "AbortError";
      }
      let reads = 0;
      const nestedFile = new File(["x"], "same.wav");
      const child = {
        name: "same.wav",
        kind: "file",
        async getFile() {
          reads++;
          return nestedFile;
        },
      };
      const nested = {
        name: "sub",
        kind: "directory",
        async *values() {
          yield child;
        },
      };
      const handle = {
        async *values() {
          yield child;
          yield nested;
        },
      };
      const scan = await lib.scan(handle, []);
      const lrc = lib.lyrics(
        "[offset:-1000]\n[00:03.50][00:05.00]Hello\n[00:01.00]First",
      );
      return {
        title: tags.title,
        empty: empty.tracks.length,
        cancelled,
        paths: scan.tracks.map((track) => track.path),
        reads,
        times: lrc.lines.map((line) => line.time),
      };
    });
    assert.equal(libraryResult.title, "Tagged title");
    assert.equal(libraryResult.empty, 0);
    assert.equal(libraryResult.cancelled, true);
    assert.deepEqual(libraryResult.paths, ["same.wav", "sub/same.wav"]);
    assert.deepEqual(libraryResult.times, [0, 2.5, 4]);
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1440, height: 900 },
      { width: 820, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 740 },
    ]) {
      await page.setViewportSize(viewport);
      for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"]) {
        await page.evaluate(
          (language) => WorkTimeApp.i18n.setLanguage(language),
          language,
        );
        const layout = await page
          .locator("#musicDialog")
          .evaluate((element) => {
            const rect = element.getBoundingClientRect(),
              body = element
                .querySelector(".music-body")
                .getBoundingClientRect();
            return {
              fits:
                rect.left >= 0 &&
                rect.right <= innerWidth + 1 &&
                rect.bottom <= innerHeight + 1,
              noOverflow: element.scrollWidth <= element.clientWidth + 1,
              bodyHeight: body.height,
              title: element.querySelector("h2").textContent,
              contrast:
                getComputedStyle(element.querySelector("#musicPlay"))
                  .backgroundColor !==
                getComputedStyle(element.querySelector("#musicPlay")).color,
              progressWidth:
                element
                  .querySelector(".music-progress-row")
                  .getBoundingClientRect().width /
                element
                  .querySelector(".music-player-center")
                  .getBoundingClientRect().width,
            };
          });
        assert.equal(
          layout.fits,
          true,
          JSON.stringify({ viewport, language, layout }),
        );
        assert.equal(
          layout.noOverflow,
          true,
          JSON.stringify({ viewport, language, layout }),
        );
        assert.ok(
          layout.bodyHeight > 50,
          JSON.stringify({ viewport, language, layout }),
        );
        assert.ok(layout.title);
        assert.equal(layout.contrast, true);
        assert.ok(layout.progressWidth > 0.8);
      }
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await page.screenshot({
        path: path.join(output, `player-${viewport.width}.png`),
      });
      if (viewport.width < 700) {
        await page.locator(".music-mobile-tabs button").last().click();
        assert.equal(
          await page.locator(".music-lyrics-pane").isVisible(),
          true,
        );
        assert.equal(await page.locator(".music-library").isVisible(), false);
        await page.screenshot({
          path: path.join(output, `lyrics-${viewport.width}.png`),
        });
        await page.locator(".music-mobile-tabs button").first().click();
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(remote, []);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("#musicExitButton").click();
    await page.waitForFunction(
      () => document.querySelector("#musicDialog").hidden,
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator("#musicOpen").click();
    const motion = await page
      .locator("#musicDialog")
      .evaluate(async (element) => {
        await new Promise(requestAnimationFrame);
        const animation = element
          .getAnimations()
          .find((entry) =>
            entry.effect.getKeyframes().some((frame) => frame.clipPath),
          );
        return {
          state: element.dataset.state,
          frames: animation?.effect
            .getKeyframes()
            .map((frame) => frame.clipPath),
          duration: animation?.effect.getTiming().duration,
        };
      });
    assert.equal(motion.state, "opening");
    assert.equal(motion.duration, 380);
    assert.notEqual(motion.frames[0], motion.frames[1]);
    await page.locator("#musicExitButton").click();
    await page.waitForFunction(
      () => document.querySelector("#musicDialog").hidden,
    );
    assert.equal(
      await page
        .locator(".workspace")
        .evaluate((element) =>
          element.classList.contains("is-game-transitioning"),
        ),
      false,
    );
    await page.locator("#musicOpen").click();
    await page.waitForFunction(
      () => document.querySelector("#musicDialog").dataset.state === "open",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() =>
      document
        .querySelector("#musicDialog")
        .classList.contains("game-shell-compact"),
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.querySelector("#musicDialog").hidden,
    );
    assert.deepEqual(errors, []);
    await page.close();
    await miniChecks(browser);
    await animationChecks(browser);
    console.log(
      "Music browser: real WAV playback, local lyrics, search, favorite, failures, minimize, keyboard, reload, recursive directory fallback, six languages and responsive layout passed.",
    );
  } finally {
    await browser.close();
  }
}
(async () => {
  await metadataChecks();
  await modelChecks();
  if (!process.argv.includes("--model-only")) await browserChecks();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const { enableReaderRuntime } = require("./runtime-test-helpers.cjs");
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
async function main() {
  const server = http.createServer((req, res) => {
    const file = path.resolve(
      root,
      "." + new URL(req.url, "http://local").pathname,
    );
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return res.writeHead(404).end();
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "application/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({
      serviceWorkers: "block",
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 900 },
    });
    await context.addInitScript(() => {
      localStorage.setItem("worktime.installReminder.dismissed.v1", "true");
      window.runtimeTest = {
        folder: "test-workspace",
        cancel: false,
        failSave: false,
        denyPermission: false,
      };
      window.showDirectoryPicker = async () => {
        if (window.runtimeTest.cancel)
          throw new DOMException("Cancelled", "AbortError");
        return (await navigator.storage.getDirectory()).getDirectoryHandle(
          window.runtimeTest.folder,
          { create: true },
        );
      };
      FileSystemDirectoryHandle.prototype.queryPermission = async () =>
        window.runtimeTest.denyPermission ? "denied" : "granted";
      FileSystemDirectoryHandle.prototype.requestPermission = async () =>
        window.runtimeTest.denyPermission ? "denied" : "granted";
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (
          this.transaction.db.name === "worktime-backup-folder" &&
          window.runtimeTest.failSave
        )
          throw new DOMException("Full", "QuotaExceededError");
        return put.apply(this, args);
      };
    });
    const page = await context.newPage();
    if (process.env.WORKTIME_REVIEW_SKIP_READER !== "1")
      await enableReaderRuntime(page);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.locator("#onboardingDialog[open]").waitFor();
    assert.equal(
      await page
        .locator('[data-stage="folder"] [data-stage-title]')
        .textContent(),
      "选择运行文件夹",
    );
    await page.evaluate(async () => {
      const directory = await window.showDirectoryPicker();
      await directory.getFileHandle("music", { create: true });
    });
    await page.locator(".onboarding-folder-button").click();
    await page.waitForFunction(
      () => WorkTimeApp.services.runtimeFolder.state.status === "conflict",
    );
    assert.ok(
      (await page.locator("[data-onboarding-error]").textContent()).includes(
        "music",
      ),
    );
    assert.equal(
      await page.locator('[data-onboarding-step="folder"]').isVisible(),
      true,
    );
    await page.evaluate(async () => {
      const directory = await window.showDirectoryPicker();
      await directory.removeEntry("music");
      window.runtimeTest.failSave = true;
    });
    await page.locator(".onboarding-folder-button").click();
    await page.waitForFunction(
      () => WorkTimeApp.services.runtimeFolder.state.status === "storageFailed",
    );
    await page.evaluate(() => {
      window.runtimeTest.failSave = false;
      window.runtimeTest.denyPermission = true;
    });
    await page.locator(".onboarding-folder-button").click();
    await page.waitForFunction(
      () => WorkTimeApp.services.runtimeFolder.state.status === "permission",
    );
    assert.equal(
      await page.locator('[data-onboarding-step="folder"]').isVisible(),
      true,
    );
    await page.evaluate(() => {
      window.runtimeTest.denyPermission = false;
    });
    await page.locator(".onboarding-folder-button").click();
    await page.waitForFunction(
      () => WorkTimeApp.services.runtimeFolder.state.status === "available",
    );
    const directories = await page.evaluate(async () => {
      const directory = await window.showDirectoryPicker(),
        names = [];
      for await (const child of directory.values()) names.push(child.name);
      return names.sort();
    });
    assert.deepEqual(directories, ["backups", "ebooks", "music"]);
    await page.locator("[data-onboarding-next]").click();
    await page.locator("#onboardingDialog").waitFor({ state: "detached" });
    await page.evaluate(async () => {
      await WorkTimeApp.services.runtimeFolder.write(
        "record.json",
        "original backup",
        { kind: "automatic" },
      );
      const directory = await (
        await WorkTimeApp.services.runtimeFolder.getDirectory("backups")
      ).getDirectoryHandle("automatic");
      const names = [];
      for await (const child of directory.values()) names.push(child.name);
      if (!names.some((name) => name.startsWith("record-")))
        throw Error("Backup did not use backups/");
    });
    const results = await page.evaluate(async () => {
      const runtime = WorkTimeApp.services.runtimeFolder;
      const make = (body, name, relative) => {
        const file = new File([body], name, { lastModified: 1 });
        if (relative)
          Object.defineProperty(file, "webkitRelativePath", {
            value: relative,
          });
        return file;
      };
      const original = make("original", "Book.txt");
      const first = await runtime.importFiles("ebooks", [original]);
      const duplicate = await runtime.importFiles("ebooks", [original]);
      const different = await runtime.importFiles("ebooks", [
        make("different", "Book.txt"),
      ]);
      const nested = await runtime.importFiles("ebooks", [
        make("nested", "Story.txt", "Collection/nested/Story.txt"),
        make("ignore", "image.exe"),
        make("unsafe", "Bad.txt", "../Bad.txt"),
      ]);
      const bookDir = await runtime.getDirectory("ebooks");
      const content = async (name) =>
        (await (await bookDir.getFileHandle(name)).getFile()).text();
      const rootText = await content("Book.txt"),
        newText = await content("Book (2).txt");
      const music1 = await runtime.importFiles("music", [
        make("audio", "Song.mp3"),
        make("old lyrics", "Song.lrc"),
      ]);
      const music2 = await runtime.importFiles("music", [
        make("audio", "Song.mp3"),
        make("new lyrics", "Song.lrc"),
      ]);
      const musicDir = await runtime.getDirectory("music");
      const lyric = await (
        await (await musicDir.getFileHandle("Song (2).lrc")).getFile()
      ).text();
      const abort = new AbortController();
      const cancelled = await runtime.importFiles(
        "ebooks",
        [make(new Uint8Array(4 * 1024 * 1024), "Large.txt")],
        {
          signal: abort.signal,
          progress(value) {
            if (value.bytes) abort.abort();
          },
        },
      );
      let incomplete = false;
      try {
        await bookDir.getFileHandle("Large.txt");
        incomplete = true;
      } catch {
        /* Expected cleanup. */
      }
      const queued = await Promise.all([
        runtime.importFiles("ebooks", [make("A", "Queue.txt")]),
        runtime.importFiles("ebooks", [make("B", "Queue.txt")]),
      ]);
      const createWritable = FileSystemFileHandle.prototype.createWritable;
      let partial;
      try {
        FileSystemFileHandle.prototype.createWritable = function (...args) {
          if (this.name === "Failure.txt")
            throw new DOMException("Simulated disk full", "QuotaExceededError");
          return createWritable.apply(this, args);
        };
        partial = await runtime.importFiles("ebooks", [
          make("completed", "Completed.txt"),
          make("retry", "Failure.txt"),
        ]);
      } finally {
        FileSystemFileHandle.prototype.createWritable = createWritable;
      }
      let cleanedFailure = false;
      try {
        await bookDir.getFileHandle("Failure.txt");
      } catch (error) {
        cleanedFailure = error.name === "NotFoundError";
      }
      const recovered = await runtime.importFiles("ebooks", [
        make("retry", "Failure.txt"),
      ]);
      if ((await content("Completed.txt")) !== "completed")
        throw Error("Failure removed an already completed file");
      const sameSource = await original.text();
      return {
        first,
        duplicate,
        different,
        nested,
        music1,
        music2,
        rootText,
        newText,
        lyric,
        cancelled,
        incomplete,
        queued,
        sameSource,
        partial,
        cleanedFailure,
        recovered,
      };
    });
    assert.equal(results.first.completed, 1);
    assert.equal(results.duplicate.skipped, 1);
    assert.equal(results.different.completed, 1);
    assert.equal(results.nested.completed, 1);
    assert.equal(results.nested.unsupported, 1);
    assert.equal(results.nested.failed, 1);
    assert.equal(results.rootText, "original");
    assert.equal(results.newText, "different");
    assert.equal(results.sameSource, "original");
    assert.equal(results.music1.completed, 2);
    assert.equal(results.music2.completed, 2);
    assert.equal(results.lyric, "new lyrics");
    assert.equal(results.cancelled.cancelled, true);
    assert.equal(results.incomplete, false);
    assert.ok(results.queued.every((result) => result.completed === 1));
    assert.equal(results.partial.completed, 1);
    assert.equal(results.partial.failed, 1);
    assert.equal(results.cleanedFailure, true);
    assert.equal(results.recovered.completed, 1);
    if (process.env.WORKTIME_REVIEW_SKIP_READER !== "1") {
      await page.locator("#readerOpen").click();
      await page.waitForSelector(".reader-book-open");
      await page
        .locator('#readerDialog [data-runtime-import="files"]')
        .setInputFiles({
          name: "UI Import.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("A persistent reading import."),
        });
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".reader-book-open")].some((button) =>
          button.textContent.includes("UI Import"),
        ),
      );
      const uiBook = page
        .locator(".reader-book-open")
        .filter({ hasText: "UI Import" });
      await uiBook.click();
      await page.waitForFunction(() =>
        document
          .querySelector(".reader-book-title")
          .textContent.includes("UI Import"),
      );
      await page.reload();
      await page.waitForFunction(
        () => WorkTimeApp.services.runtimeFolder?.state.status === "available",
      );
      await page.locator("#readerOpen").click();
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".reader-book-open")].some((button) =>
          button.textContent.includes("UI Import"),
        ),
      );
      await page.evaluate(() => WorkTimeApp.ui.reader.expand());
      await page.locator("#readerExit").click();
      await page.waitForFunction(
        () => document.getElementById("readerDialog").hidden,
      );
    }
    await page.evaluate(async () => {
      await WorkTimeApp.ui.music.open();
      WorkTimeApp.ui.music.dispose();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const samples = 8000 * 60,
        bytes = new Uint8Array(44 + samples * 2),
        view = new DataView(bytes.buffer);
      const word = (at, value) =>
        [...value].forEach((c, i) => {
          bytes[at + i] = c.charCodeAt(0);
        });
      word(0, "RIFF");
      view.setUint32(4, bytes.length - 8, true);
      word(8, "WAVEfmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 8000, true);
      view.setUint32(28, 16000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      word(36, "data");
      view.setUint32(40, samples * 2, true);
      window.runtimeLegacyFile = new File([bytes], "Legacy.wav", {
        lastModified: 1,
      });
      const fingerprint = `${bytes.length}:1`,
        id = `Legacy.wav|${fingerprint}`;
      await WorkTimeApp.services.musicStorage.write({
        tracks: [
          {
            path: "Legacy.wav",
            fingerprint,
            title: "Legacy",
            name: "Legacy.wav",
            size: bytes.length,
            modified: 1,
          },
        ],
        favorites: [id],
        current: id,
        position: 7,
      });
      const player = WorkTimeApp.ui.createMusicController();
      window.runtimeTestPlayer = player;
      await player.ready;
      await player.importFiles([window.runtimeLegacyFile]);
      const current = player.snapshot().current;
      if (
        !current ||
        current.name !== "Legacy.wav" ||
        !player.isFavorite(current) ||
        player.snapshot().position < 7 ||
        !player.snapshot().paused
      )
        throw Error("Legacy favorite/position migration failed");
      const play = document.createElement("button");
      play.id = "runtimeTestPlay";
      play.textContent = "Test playback";
      play.onclick = () => player.toggle();
      document.body.append(play);
    });
    await page.locator("#runtimeTestPlay").click();
    await page.waitForFunction(
      () => !window.runtimeTestPlayer.snapshot().paused,
    );
    await page.evaluate(async () => {
      const player = window.runtimeTestPlayer;
      await player.importFiles([new File(["extra lyrics"], "Extra.lrc")]);
      if (
        player.snapshot().paused ||
        player.snapshot().current.name !== "Legacy.wav"
      )
        throw Error("Import interrupted playback");
      const runtime = WorkTimeApp.services.runtimeFolder;
      const root = await navigator.storage.getDirectory();
      const source = await root.getDirectoryHandle(runtime.state.name);
      const selected = await root.getDirectoryHandle("migrated-media", {
        create: true,
      });
      const book = await (
        await source.getDirectoryHandle("ebooks")
      ).getFileHandle("Book.txt");
      window.beforeBook = await (await book.getFile()).text();
      await runtime.changeFolder({ source, selected }, { migrate: true });
    });
    await page.waitForFunction(() => {
      const player = window.runtimeTestPlayer;
      return (
        !player.snapshot().readingTags &&
        !player.snapshot().busy &&
        player.snapshot().current?.name === "Legacy.wav" &&
        player.isFavorite(player.snapshot().current) &&
        player.snapshot().position >= 7 &&
        player.snapshot().paused
      );
    });
    await page.evaluate(async () => {
      const book = await (
        await WorkTimeApp.services.runtimeFolder.getDirectory("ebooks")
      ).getFileHandle("Book.txt");
      if ((await (await book.getFile()).text()) !== window.beforeBook)
        throw Error("Reading content identity changed during migration");
      const player = window.runtimeTestPlayer;
      player.dispose();
      document.getElementById("runtimeTestPlay").remove();
    });
    await page.evaluate(async () => {
      const legacy = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("legacy-runtime", { create: true });
      const file = await legacy.getFileHandle("existing.txt", { create: true });
      const writer = await file.createWritable();
      await writer.write("keep original");
      await writer.close();
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("worktime-backup-folder", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("settings", "readwrite");
        tx.objectStore("settings").delete("runtime");
        tx.objectStore("settings").put(legacy, "directory");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.runtimeFolder?.state.status ===
        "needsInitialization",
    );
    const legacyBefore = await page.evaluate(async () => {
      const dir = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("legacy-runtime");
      const names = [];
      for await (const entry of dir.values()) names.push(entry.name);
      return names;
    });
    assert.deepEqual(
      legacyBefore,
      ["existing.txt"],
      "Legacy folders are not changed automatically",
    );
    await page.evaluate(() => WorkTimeApp.services.runtimeFolder.authorize());
    const legacyText = await page.evaluate(async () => {
      const dir = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("legacy-runtime");
      return (await (await dir.getFileHandle("existing.txt")).getFile()).text();
    });
    assert.equal(legacyText, "keep original");
    await page.evaluate(async () => {
      const runtime = WorkTimeApp.services.runtimeFolder;
      const backups = await runtime.getDirectory("backups");
      const old = await backups.getFileHandle("old-backup.txt", {
        create: true,
      });
      const writer = await old.createWritable();
      await writer.write("legacy backup");
      await writer.close();
      await backups.removeEntry("automatic", { recursive: true });
      await backups.removeEntry("manual", { recursive: true });
      await runtime.write("lazy.txt", "manual", { kind: "manual" });
      await backups.removeEntry("automatic");
      await backups.getFileHandle("automatic", { create: true });
      try {
        await runtime.write("blocked.txt", "blocked", { kind: "automatic" });
        throw Error("File collision should block backup");
      } catch (error) {
        if (error.folderCode !== "conflict") throw error;
      }
      await backups.removeEntry("automatic");
      await runtime.write("retry.txt", "retry", { kind: "automatic" });
      if (
        (await (await backups.getFileHandle("old-backup.txt")).getFile())
          .size !== 13
      )
        throw Error("Existing root backup was modified");
      for (const options of [{}, { kind: "../manual" }]) {
        let rejected = false;
        try {
          await runtime.write("invalid.txt", "bad", options);
        } catch {
          rejected = true;
        }
        if (!rejected) throw Error("Invalid backup kind accepted");
      }
    });
    const other = await context.newPage();
    await other.goto(page.url());
    await other.waitForFunction(
      () => WorkTimeApp.services.runtimeFolder?.state.name === "legacy-runtime",
    );
    await page.evaluate(() => {
      const close = FileSystemWritableFileStream.prototype.close;
      FileSystemWritableFileStream.prototype.close = async function () {
        window.backupClosing = true;
        await new Promise((resolve) => {
          window.releaseBackup = resolve;
        });
        FileSystemWritableFileStream.prototype.close = close;
        return close.call(this);
      };
      window.pendingBackup = WorkTimeApp.services.runtimeFolder.write(
        "locked.txt",
        "locked",
        { kind: "manual" },
      );
    });
    await page.waitForFunction(() => window.backupClosing);
    await other.evaluate(() => {
      window.runtimeTest.folder = "second-runtime";
      window.pendingSwitch = WorkTimeApp.services.runtimeFolder.choose();
    });
    await other.waitForFunction(
      () => WorkTimeApp.services.runtimeFolder.state.busy,
    );
    assert.equal(
      await other.evaluate(() => WorkTimeApp.services.runtimeFolder.state.name),
      "legacy-runtime",
    );
    await page.evaluate(async () => {
      window.releaseBackup();
      await window.pendingBackup;
    });
    await other.evaluate(() => window.pendingSwitch);
    await other.waitForFunction(
      () => WorkTimeApp.services.runtimeFolder.state.name === "second-runtime",
    );
    await other.close();
    assert.deepEqual(errors, []);
    console.log(
      "Runtime folders: initialization/retry, backup destination, streamed copying, duplicate/rename, paired lyrics, cancellation cleanup, serialized imports and reload verified." +
        (process.env.WORKTIME_REVIEW_SKIP_READER === "1"
          ? " Reader internals explicitly excluded."
          : " Reader UI import verified."),
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

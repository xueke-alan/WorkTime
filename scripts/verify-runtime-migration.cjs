"use strict";
/** Real filesystem handles/IndexedDB; injected picker and failure conditions. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
async function main() {
  const sprite = fs
    .readFileSync(path.join(root, "index.html"), "utf8")
    .match(/<svg class="icon-sprite"[\s\S]*?<\/svg>/)[0];
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://local").pathname;
    if (pathname === "/fixture") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/assets/css/site-runtime.css"><body>${sprite}
        <script>window.WorkTimeApp={services:{assets:{script:src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.append(s)})}},ui:{},i18n:{language:'zh-CN'}};</script>
        <script src="/assets/js/services/runtime-folder-text.js"></script><script src="/assets/js/services/runtime-folder.js"></script>
        <script src="/assets/js/ui/runtime-folder-change.js"></script><button onclick="WorkTimeApp.ui.showRuntimeFolderChange()">Change</button>`);
    }
    const file = path.resolve(root, "." + pathname);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return res.writeHead(404).end();
      res.setHeader(
        "Content-Type",
        file.endsWith(".js") ? "text/javascript" : "text/css",
      );
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block",
    });
    await context.addInitScript(() => {
      window.fixture = {
        folder: "source",
        failSave: false,
        failWrite: false,
        deny: "",
      };
      window.showDirectoryPicker = async () => {
        if (window.fixture.cancel)
          throw new DOMException("Cancelled", "AbortError");
        return (await navigator.storage.getDirectory()).getDirectoryHandle(
          window.fixture.folder,
          { create: true },
        );
      };
      FileSystemDirectoryHandle.prototype.queryPermission = async function () {
        return this.name === window.fixture.deny ? "denied" : "granted";
      };
      FileSystemDirectoryHandle.prototype.requestPermission =
        async function () {
          window.fixture.deny = "";
          return "granted";
        };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (
          this.transaction.db.name === "worktime-backup-folder" &&
          window.fixture.failSave
        )
          throw new DOMException("Full", "QuotaExceededError");
        return put.apply(this, args);
      };
      const create = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = function (...args) {
        if (window.fixture.failWrite)
          throw new DOMException("Full", "QuotaExceededError");
        return create.apply(this, args);
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}/fixture`;
    await page.goto(url);
    await page.evaluate(async () => {
      await WorkTimeApp.services.runtimeFolder.choose();
      window.putFile = async (directory, path, data) => {
        const parts = path.split("/");
        const name = parts.pop();
        for (const part of parts)
          directory = await directory.getDirectoryHandle(part, {
            create: true,
          });
        const writer = await (
          await directory.getFileHandle(name, { create: true })
        ).createWritable();
        await writer.write(data);
        await writer.close();
      };
      window.original = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("source");
      await window.putFile(window.original, "backups/manual/old.bin", "backup");
      await window.putFile(window.original, "ebooks/nested/story.txt", "story");
      await window.putFile(window.original, "music/album/song.mp3", "music");
      await window.putFile(window.original, "music/album/song.lrc", "lyrics");
      await window.putFile(window.original, "unrelated.txt", "leave alone");
      await (
        await window.original.getDirectoryHandle("ebooks")
      ).getDirectoryHandle("empty", { create: true });
    });
    fs.mkdirSync(path.join(__dirname, "..", "test-results"), {
      recursive: true,
    });
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await page.locator("dialog").screenshot({
      path: path.join(
        __dirname,
        "..",
        "test-results/runtime-folder-change-empty.png",
      ),
    });
    assert.equal(await page.locator("[data-migrate]").isChecked(), false);
    assert.equal(await page.locator("[data-submit]").isDisabled(), true);
    assert.equal(await page.locator("[data-abort]").isVisible(), false);
    assert.equal(await page.locator("[data-authorize]").isVisible(), false);
    await page.locator("[data-select]").click();
    assert.equal(
      await page.locator("[data-submit]").isDisabled(),
      true,
      "same folder cannot submit",
    );
    await page.evaluate(() => {
      window.fixture.folder = "destination";
    });
    await page.locator("[data-select]").click();
    assert.equal(
      await page.evaluate(() => WorkTimeApp.services.runtimeFolder.state.name),
      "source",
      "selection must not commit",
    );
    await page.evaluate(() => {
      window.fixture.cancel = true;
    });
    await page.locator("[data-select]").click();
    assert.ok(
      (await page.locator("[data-target]").innerText()).includes("destination"),
    );
    await page.evaluate(() => {
      window.fixture.cancel = false;
    });
    fs.mkdirSync(path.join(__dirname, "..", "test-results"), {
      recursive: true,
    });
    await page.locator("dialog").screenshot({
      path: path.join(
        __dirname,
        "..",
        "test-results/runtime-folder-change-desktop.png",
      ),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelector("dialog").getBoundingClientRect().right <=
          innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: path.join(
        __dirname,
        "..",
        "test-results/runtime-folder-change-mobile.png",
      ),
    });
    for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"]) {
      await page.evaluate((language) => {
        WorkTimeApp.i18n.language = language;
        document.dispatchEvent(new Event("worktime:languagechange"));
      }, language);
      assert.notEqual(await page.locator("h2").innerText(), "changeFolder");
    }
    await page.evaluate(() => {
      WorkTimeApp.i18n.language = "zh-CN";
    });
    await page.locator("[data-migrate]").check();
    await page.evaluate(() => {
      const write = FileSystemWritableFileStream.prototype.write;
      let count = 0;
      FileSystemWritableFileStream.prototype.write = async function (...args) {
        if (++count === 2) {
          window.copyPaused = true;
          await new Promise((resolve) => {
            window.resumeCopy = resolve;
          });
          FileSystemWritableFileStream.prototype.write = write;
        }
        return write.apply(this, args);
      };
    });
    await page.locator("[data-submit]").click();
    await page.waitForFunction(() => window.copyPaused);
    assert.equal(await page.locator("[data-abort]").isVisible(), true);
    assert.equal(await page.locator("[data-close]").isDisabled(), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog").isVisible(), true);
    await page.locator("dialog").screenshot({
      path: path.join(
        __dirname,
        "..",
        "test-results/runtime-folder-change-progress.png",
      ),
    });
    await page.evaluate(() => window.resumeCopy());
    await page.waitForFunction(
      () => WorkTimeApp.services.runtimeFolder.state.name === "destination",
    );
    assert.ok(
      (await page.locator("[data-status]").innerText()).includes("已复制 4"),
    );
    await page.locator("dialog").screenshot({
      path: path.join(
        __dirname,
        "..",
        "test-results/runtime-folder-change-done.png",
      ),
    });
    await page.locator("[data-close]").click();
    const basic = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const destination = await root.getDirectoryHandle("destination");
      const names = [];
      for await (const entry of destination.values()) names.push(entry.name);
      const book = await (
        await (
          await destination.getDirectoryHandle("ebooks")
        ).getDirectoryHandle("nested")
      ).getFileHandle("story.txt");
      await (
        await destination.getDirectoryHandle("ebooks")
      ).getDirectoryHandle("empty");
      await window.original.getFileHandle("unrelated.txt");
      return {
        names: names.sort(),
        book: await (await book.getFile()).text(),
        aliases: WorkTimeApp.services.runtimeFolder.state.migration.length,
      };
    });
    assert.deepEqual(basic, {
      names: ["backups", "ebooks", "music"],
      book: "story",
      aliases: 2,
    });
    const observer = await context.newPage();
    await observer.goto(url);
    await observer.evaluate(() =>
      WorkTimeApp.services.runtimeFolder.initialize(),
    );
    const results = await page.evaluate(async () => {
      const runtime = WorkTimeApp.services.runtimeFolder;
      const root = await navigator.storage.getDirectory();
      const target = await root.getDirectoryHandle("destination");
      const selection = { source: target, selected: window.original };
      const expectFailure = async (proposal, options = {}) => {
        try {
          await runtime.changeFolder(proposal, options);
          return "unexpected success";
        } catch (error) {
          return error.folderCode || error.name;
        }
      };
      const repeat = await runtime.changeFolder(selection, { migrate: true });
      const repeatResult = {
        completed: repeat.completed,
        skipped: repeat.skipped,
      };
      // Restore destination as source for the remaining cases.
      await runtime.changeFolder({ source: window.original, selected: target });
      const nested = await target.getDirectoryHandle("child", { create: true });
      const nestedResult = await expectFailure({
        source: target,
        selected: nested,
      });
      const parentResult = await expectFailure({
        source: target,
        selected: root,
      });
      const same = await expectFailure({ source: target, selected: target });
      const stale = await expectFailure({
        source: window.original,
        selected: root,
      });
      const conflict = await root.getDirectoryHandle("conflict", {
        create: true,
      });
      await window.putFile(conflict, "ebooks/nested/story.txt", "different");
      const conflictResult = await expectFailure(
        { source: target, selected: conflict },
        { migrate: true },
      );
      let untouched = false;
      try {
        await conflict.getDirectoryHandle("backups");
      } catch {
        untouched = true;
      }
      const typeConflict = await root.getDirectoryHandle("type-conflict", {
        create: true,
      });
      await window.putFile(typeConflict, "music", "file");
      const typeResult = await expectFailure(
        { source: target, selected: typeConflict },
        { migrate: true },
      );
      const fresh = await root.getDirectoryHandle("fresh", { create: true });
      window.fixture.deny = "destination";
      const permission = await expectFailure(
        { source: target, selected: fresh },
        { migrate: true },
      );
      window.fixture.deny = "";
      window.fixture.failSave = true;
      const failedSave = await expectFailure({
        source: target,
        selected: fresh,
      });
      window.fixture.failSave = false;
      const beforeSave = new AbortController();
      const cancelBeforeSave = await expectFailure(
        { source: target, selected: fresh },
        {
          signal: beforeSave.signal,
          progress(value) {
            if (value.phase === "saving") beforeSave.abort();
          },
        },
      );
      const assertSourceUnchanged = runtime.state.name === "destination";
      window.fixture.failWrite = true;
      const failedWrite = await expectFailure(
        { source: target, selected: fresh },
        { migrate: true },
      );
      window.fixture.failWrite = false;
      await window.putFile(
        target,
        "ebooks/large.bin",
        new Uint8Array(5 * 1024 * 1024),
      );
      const abort = new AbortController();
      let gotProgress = false,
        importBlocked = false,
        writeBlocked = false;
      const cancel = await expectFailure(
        { source: target, selected: fresh },
        {
          migrate: true,
          signal: abort.signal,
          progress(value) {
            if (
              value.phase === "copying" &&
              value.current === "ebooks/large.bin" &&
              value.processedBytes > 0
            ) {
              gotProgress = true;
              abort.abort();
            }
          },
        },
      );
      let cleaned = false;
      try {
        await (
          await fresh.getDirectoryHandle("ebooks")
        ).getFileHandle("large.bin");
      } catch {
        cleaned = true;
      }
      const beforeRetry = runtime.state.name;
      let paused, resume;
      const gate = new Promise((resolve) => {
        resume = resolve;
      });
      const entered = new Promise((resolve) => {
        paused = resolve;
      });
      const realScript = WorkTimeApp.services.assets.script;
      WorkTimeApp.services.assets.script = async (src) => {
        await realScript(src);
        paused();
        await gate;
      };
      const operation = runtime.changeFolder(
        { source: target, selected: fresh },
        { migrate: true },
      );
      await entered;
      try {
        await runtime.importFiles("music", []);
      } catch (error) {
        importBlocked = error.folderCode === "busy";
      }
      try {
        await runtime.write("blocked.json", "{}", { kind: "manual" });
      } catch (error) {
        writeBlocked = error.folderCode === "busy";
      }
      resume();
      const retry = await operation;
      WorkTimeApp.services.assets.script = realScript;
      return {
        repeatResult,
        nestedResult,
        parentResult,
        same,
        stale,
        conflictResult,
        untouched,
        typeResult,
        permission,
        failedSave,
        failedWrite,
        cancel,
        cancelBeforeSave,
        assertSourceUnchanged,
        cleaned,
        gotProgress,
        beforeRetry,
        importBlocked,
        writeBlocked,
        retry: retry.completed,
        final: runtime.state.name,
      };
    });
    assert.deepEqual(results.repeatResult, { completed: 0, skipped: 4 });
    for (const name of ["nestedResult", "parentResult"])
      assert.equal(results[name], "nestedFolder");
    assert.equal(results.same, "sameFolder");
    assert.equal(results.stale, "sourceChanged");
    assert.equal(results.conflictResult, "migrationConflict");
    assert.equal(results.typeResult, "migrationConflict");
    assert.equal(results.untouched, true);
    assert.equal(results.permission, "sourcePermission");
    assert.equal(results.failedSave, "storageFailed");
    assert.equal(results.failedWrite, "QuotaExceededError");
    assert.equal(results.cancel, "AbortError");
    assert.equal(results.cancelBeforeSave, "AbortError");
    assert.equal(results.assertSourceUnchanged, true);
    for (const name of [
      "cleaned",
      "gotProgress",
      "importBlocked",
      "writeBlocked",
    ])
      assert.equal(results[name], true, name);
    assert.equal(results.beforeRetry, "destination");
    assert.equal(results.final, "fresh");
    await observer.waitForFunction(
      () => WorkTimeApp.services.runtimeFolder.state.name === "fresh",
    );
    await page.reload();
    await page.evaluate(() => WorkTimeApp.services.runtimeFolder.initialize());
    assert.equal(
      await page.evaluate(() => WorkTimeApp.services.runtimeFolder.state.name),
      "fresh",
    );
    const empty = await page.evaluate(async () => {
      const runtime = WorkTimeApp.services.runtimeFolder;
      const root = await navigator.storage.getDirectory();
      const source = await root.getDirectoryHandle("fresh");
      const selected = await root.getDirectoryHandle("empty-switch", {
        create: true,
      });
      window.fixture.deny = "fresh";
      const switched = await runtime.changeFolder({ source, selected });
      window.fixture.deny = "";
      const files = [];
      for await (const entry of (
        await selected.getDirectoryHandle("ebooks")
      ).values())
        files.push(entry.name);
      const next = await root.getDirectoryHandle("empty-migrated", {
        create: true,
      });
      const migrated = await runtime.changeFolder(
        { source: selected, selected: next },
        { migrate: true },
      );
      return {
        switched: switched.completed,
        files,
        migrated: migrated.completed,
        total: migrated.total,
        aliases: runtime.state.migration.length,
      };
    });
    assert.deepEqual(empty, {
      switched: 0,
      files: [],
      migrated: 0,
      total: 0,
      aliases: 0,
    });
    assert.deepEqual(errors, []);
    console.log(
      "Runtime folder confirmation, migration, conflicts, progress, cancellation, failure recovery, permissions, concurrency and cross-page persistence verified.",
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

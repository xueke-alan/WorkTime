"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(process.argv[2] || ".");
async function download(page, id) {
  const pending = page.waitForEvent("download");
  await page.locator("#" + id).click();
  return fs.readFile(await (await pending).path(), "utf8");
}
async function done(page) {
  await page.waitForFunction(() => !document.querySelector("#retry").disabled);
}
(async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const file = path.resolve(
        root,
        "." + new URL(req.url, "http://local").pathname,
      );
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      res.setHeader(
        "Content-Type",
        file.endsWith(".html")
          ? "text/html; charset=utf-8"
          : file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : "application/octet-stream",
      );
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const context = await browser.newContext({ locale: "zh-CN" });
    const main = await context.newPage();
    await main.goto(base + "/index.html");
    await main.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const original = await main.evaluate(async () => {
      const state = WorkTimeApp.domain.state.defaultState();
      state.memo = "应急备份验证";
      state.agenda = [
        {
          id: "rescue-test",
          date: "2026-10-27",
          endDate: "2026-10-28",
          title: "测试日程",
          allDay: true,
          start: "",
          end: "",
          note: "",
          createdAt: "2026-10-27T00:00:00Z",
          updatedAt: "2026-10-27T00:00:00Z",
          status: "pending",
        },
      ];
      state.imports = [
        {
          id: "rescue-import",
          at: "2026-10-27T00:00:00Z",
          year: 2026,
          count: 0,
          sources: [{ name: "test", raw: "原始导入文本" }],
          records: [],
        },
      ];
      const doc = WorkTimeApp.services.archive.encode(state);
      // Validate the fixture before storing it, using the real import path.
      WorkTimeApp.services.archive.migrate(doc);
      doc.extraEnvelope = { preserved: true };
      doc.modules.push({
        id: "extension.rescue",
        version: 7,
        extra: "header",
        records: [
          { id: "extra", data: { future: true }, order: 0, extra: "record" },
        ],
      });
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("worktime-archive");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(
          [
            "archives",
            "modules",
            "records",
            "snapshots",
            "migrations",
            "cache",
          ],
          "readwrite",
        );
        for (const name of ["archives", "modules", "records"])
          tx.objectStore(name).clear();
        tx.objectStore("archives").put({
          key: "active",
          archive: doc.archive,
          formatVersion: doc.formatVersion,
          envelope: { extraEnvelope: doc.extraEnvelope },
          revision: 123,
          updatedAt: "2026-10-27T01:00:00Z",
        });
        for (const { records, ...header } of doc.modules) {
          tx.objectStore("modules").put({
            ...header,
            archiveId: doc.archive.id,
          });
          for (const row of records)
            tx.objectStore("records").put({
              ...row,
              archiveId: doc.archive.id,
              moduleId: header.id,
              owner: row.id,
            });
        }
        for (const name of ["snapshots", "migrations", "cache"])
          tx.objectStore(name).put({ id: "rescue-fixture", data: name });
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
      db.close();
      localStorage.setItem("worktime.games.jump.best.v1", "42");
      localStorage.setItem("unrelated-key", "excluded");
      return doc;
    });
    const rescue = await context.newPage();
    const errors = [];
    rescue.on("pageerror", (error) => errors.push(error.message));
    await rescue.goto(base + "/rescue.html");
    await done(rescue);
    const text = await download(rescue, "work");
    const archive = JSON.parse(text);
    assert.deepEqual(archive.extraEnvelope, original.extraEnvelope);
    assert.deepEqual(
      archive.modules.sort((a, b) => a.id.localeCompare(b.id)),
      original.modules.sort((a, b) => a.id.localeCompare(b.id)),
    );
    const restored = await main.evaluate((text) => {
      const value = WorkTimeApp.services.archive.migrate(JSON.parse(text));
      return { memo: value.memo, agenda: value.agenda, imports: value.imports };
    }, text);
    assert.equal(restored.memo, "应急备份验证");
    assert.equal(restored.agenda[0].endDate, "2026-10-28");
    assert.equal(restored.imports[0].sources[0].raw, "原始导入文本");
    const first = JSON.parse(await download(rescue, "raw"));
    assert.equal(first.localStorage["worktime.games.jump.best.v1"], "42");
    assert.equal(first.localStorage["unrelated-key"], undefined);
    assert.equal(first.database.stores.snapshots.length > 0, true);
    assert.equal(first.database.stores.archives[0].revision, 123);
    await rescue.locator("#retry").click();
    await done(rescue);
    const second = JSON.parse(await download(rescue, "raw"));
    assert.deepEqual(second.database, first.database);
    assert.deepEqual(second.localStorage, first.localStorage);
    assert.deepEqual(errors, []);
    // Corrupt metadata must retain raw records without presenting an empty archive.
    await main.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open("worktime-archive");
        r.onsuccess = () => resolve(r.result);
      });
      await new Promise((resolve) => {
        const tx = db.transaction("archives", "readwrite");
        tx.objectStore("archives").clear();
        tx.oncomplete = resolve;
      });
      db.close();
    });
    await rescue.locator("#retry").click();
    await done(rescue);
    assert.equal(await rescue.locator("#work").isDisabled(), true);
    assert.match(await rescue.locator("#status").textContent(), /元信息缺失/);
    assert.ok(
      JSON.parse(await download(rescue, "raw")).database.stores.records.length,
    );
    await context.close();
    // New profile: no accidental DB creation; legacy text is preserved byte for byte.
    const fresh = await browser.newContext();
    const empty = await fresh.newPage();
    await empty.goto(base + "/rescue.html");
    await done(empty);
    assert.equal(await empty.locator("#work").isDisabled(), true);
    assert.equal(
      await empty.evaluate(async () => (await indexedDB.databases()).length),
      0,
    );
    const legacy = ' {"legacy":"preserve whitespace"} ';
    await empty.evaluate(
      (text) => localStorage.setItem("worktime-local-v1", text),
      legacy,
    );
    await empty.reload();
    await done(empty);
    assert.equal(await download(empty, "work"), legacy);
    await fresh.close();
    // A missing app, a rejected initialization and a pending initialization all expose a real link.
    for (const mode of ["missing", "failed", "pending"]) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.route(/\/(?:app|site)\.js(?:\?|$)/, (route) => {
        if (mode === "missing") return route.abort();
        const fail =
          mode === "failed"
            ? "throw Error('startup fixture');"
            : "await new Promise(()=>{});";
        return route.fulfill({
          contentType: "text/javascript",
          body:
            "WorkTimeApp.services.bootstrap.run(async()=>{" +
            fail +
            "},{document});",
        });
      });
      // Published site.js includes bootstrap; use an independent failed/pending state there.
      if (root.endsWith("_site") && mode !== "missing") await page.unrouteAll();
      if (root.endsWith("_site") && mode !== "missing")
        await page.route(/\/site\.js(?:\?|$)/, (route) =>
          route.fulfill({
            contentType: "text/javascript",
            body:
              "document.documentElement.dataset.appState='" +
              (mode === "failed" ? "failed" : "initializing") +
              "';",
          }),
        );
      await page.goto(base + "/index.html");
      await page
        .locator("#emergencyBackupNotice a")
        .waitFor({ state: "visible", timeout: 8000 });
      assert.equal(
        await page.locator("#emergencyBackupNotice a").getAttribute("href"),
        "rescue.html",
      );
      await ctx.close();
    }
    // Browser API failures must be explicit and still allow a diagnostic download.
    for (const mode of [
      "denied",
      "timeout",
      "blocked",
      "transaction-timeout",
      "partial",
    ]) {
      const ctx = await browser.newContext();
      await ctx.addInitScript((mode) => {
        if (mode !== "denied")
          localStorage.setItem("worktime.games.jump.best.v1", "52");
        if (mode === "denied")
          Object.defineProperty(window, "localStorage", {
            get() {
              throw Error("local denied");
            },
          });
        Object.defineProperty(window, "indexedDB", {
          value: {
            open() {
              if (mode === "denied") throw Error("database denied");
              const request = {};
              if (mode === "transaction-timeout" || mode === "partial") {
                request.result = {
                  objectStoreNames: ["archives", "modules", "records"],
                  close() {},
                  transaction(names, access) {
                    if (access !== "readonly") throw Error("unexpected write");
                    const tx = {
                      abort() {
                        tx.onabort();
                      },
                      objectStore(name) {
                        return {
                          getAll() {
                            const r = {};
                            if (mode === "partial")
                              setTimeout(() => {
                                if (name === "records") {
                                  r.error = Error("records unavailable");
                                  r.onerror({ preventDefault() {} });
                                } else {
                                  r.result = [
                                    { id: "retained", key: "sample" },
                                  ];
                                  r.onsuccess();
                                }
                              }, 0);
                            return r;
                          },
                        };
                      },
                    };
                    if (mode === "partial")
                      setTimeout(() => tx.oncomplete(), 10);
                    return tx;
                  },
                };
                setTimeout(() => request.onsuccess(), 0);
              }
              if (mode === "blocked") setTimeout(() => request.onblocked(), 0);
              return request;
            },
          },
        });
      }, mode);
      const page = await ctx.newPage();
      await page.goto(base + "/rescue.html");
      await done(page);
      assert.equal(await page.locator("#work").isDisabled(), true);
      const report = JSON.parse(await download(page, "raw"));
      assert.ok(report.errors.length > 0);
      if (mode === "partial") {
        assert.equal(report.database.state, "partial");
        assert.equal(report.database.stores.archives[0].id, "retained");
        assert.match(report.database.errors[0], /records unavailable/);
      } else assert.equal(report.database, null);
      if (mode !== "denied")
        assert.equal(report.localStorage["worktime.games.jump.best.v1"], "52");
      await ctx.close();
    }
    // The actual file:// entry has no dependency on HTTP resources.
    const ctx = await browser.newContext();
    const offline = await ctx.newPage();
    await offline.route(/^https?:/, (route) => route.abort());
    await offline.goto(pathToFileURL(path.join(root, "index.html")).href);
    await offline.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await offline.evaluate(() =>
      localStorage.setItem("worktime.rescue.fileProbe", "same-directory"),
    );
    await offline.goto(pathToFileURL(path.join(root, "rescue.html")).href);
    await done(offline);
    assert.equal(await offline.locator("#raw").isEnabled(), true);
    const fileReport = JSON.parse(await download(offline, "raw"));
    assert.equal(
      fileReport.localStorage["worktime.rescue.fileProbe"],
      "same-directory",
      "Edge file entries should share same-directory storage",
    );
    await offline.setViewportSize({ width: 375, height: 812 });
    assert.equal(
      await offline.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    if (process.env.WORKTIME_RESCUE_SCREENSHOT)
      await offline.screenshot({
        path: process.env.WORKTIME_RESCUE_SCREENSHOT,
        fullPage: true,
      });
    await ctx.close();
    console.log(
      "Rescue exports, round-trip import, read-only snapshots, failures, startup links and offline entry verified.",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";
const { clickSettingsControl } = require("./settings-test-helpers.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const { observeBackupWrites } = require("./lib/backup-test-file.cjs");
const { chromium } = require("playwright");
const sourceRoot = path.resolve(__dirname, "..");
const results = path.join(sourceRoot, "test-results");
fs.mkdirSync(results, { recursive: true });
const coreSource = [
  ...fs
    .readFileSync(path.join(sourceRoot, "index.html"), "utf8")
    .matchAll(/<script[^>]+src="([^"]+)"/g),
]
  .map((match) => match[1])
  .filter(
    (file) =>
      file === "assets/js/namespace.js" ||
      /assets\/data\/(calendars|major-festivals|struggle-days)\.js/.test(file),
  )
  .map((file) => fs.readFileSync(path.join(sourceRoot, file), "utf8"))
  .concat(
    [
      "preferences",
      "time",
      "state",
      "calendar",
      "records",
      "schedule",
      "batch",
      "statistics",
      "observations",
      "agenda",
      "validation",
    ].map((name) =>
      fs.readFileSync(
        path.join(sourceRoot, "assets/js/domain", name + ".js"),
        "utf8",
      ),
    ),
  )
  .join("\n");
const realm = vm.createContext({});
vm.runInContext(
  coreSource +
    ";globalThis.C = Object.assign({}, ...Object.values(WorkTimeApp.domain)); globalThis.P = WorkTimeApp.domain.preferences;",
  realm,
);
const ready = (page) =>
  page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
const settled = (page) =>
  page.waitForFunction(() => !WorkTimeApp.services.preferences.page.dirty);
const root = path.resolve(process.argv[2] || sourceRoot);

(async () => {
  // Calendar days, including month/year boundaries and clock rollback.
  for (const days of [1, 3, 7]) {
    const last = "2026-12-30";
    const at = (offset) =>
      new Date(Date.parse(last) + offset * 86400000).toISOString().slice(0, 10);
    assert.equal(
      realm.P.autoBackupDue(
        { autoBackupDays: days, lastAutoBackupDate: last },
        at(days - 1),
      ),
      false,
    );
    assert.equal(
      realm.P.autoBackupDue(
        { autoBackupDays: days, lastAutoBackupDate: last },
        at(days),
      ),
      true,
    );
    assert.equal(
      realm.P.autoBackupDue(
        { autoBackupDays: days, lastAutoBackupDate: last },
        "2026-12-29",
      ),
      false,
    );
  }
  const legacy = realm.C.defaultState();
  delete legacy.preferences.autoBackupDays;
  delete legacy.preferences.lastAutoBackupDate;
  const validated = realm.C.validateBackup(legacy);
  assert.equal(validated.preferences.autoBackupDays, 1);
  assert.equal(
    realm.C.validateBackup({
      ...legacy,
      preferences: { ...legacy.preferences, autoBackupDays: 0 },
    }).preferences.autoBackupDays,
    1,
    "Migrate disabled automatic backup to the daily interval",
  );
  assert.equal(validated.preferences.lastAutoBackupDate, null);
  assert.equal(validated.preferences.lastBackupAt, null);
  for (const patch of [
    { autoBackupDays: 2 },
    { lastAutoBackupDate: "2026-02-30" },
    { lastBackupAt: "invalid" },
  ])
    assert.throws(() =>
      realm.C.validateBackup({
        ...legacy,
        preferences: { ...legacy.preferences, ...patch },
      }),
    );

  const server = http.createServer((req, res) => {
    const file = path.resolve(
      root,
      "." + new URL(req.url, "http://localhost").pathname,
    );
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404).end();
        return;
      }
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
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
    for (const url of [
      `http://127.0.0.1:${server.address().port}/index.html`,
    ]) {
      const context = await browser.newContext({
        acceptDownloads: true,
        timezoneId: "Asia/Shanghai",
      });
      await context.addInitScript(() =>
        localStorage.setItem("worktime.onboarding.v1", "dismissed"),
      );
      const page = await context.newPage();
      const errors = [];
      const capture = await observeBackupWrites(page);
      const downloads = capture.writes;
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("download", () =>
        assert.fail("Backup must not trigger a browser download"),
      );
      await page.route(/https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-28T12:00:37+08:00"));
      const defaultDownload = capture.next();
      await page.goto(url);
      await ready(page);
      assert.match((await defaultDownload).name, /20261028-120037\.txt$/);
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.preferences.page.state.lastAutoBackupDate ===
          "2026-10-28",
      );
      await settled(page);
      assert.equal(
        await page.evaluate(
          () => WorkTimeApp.services.preferences.page.state.autoBackupDays,
        ),
        1,
        "Automatic backup defaults to every day",
      );
      await page.evaluate(() =>
        WorkTimeApp.services.preferences.page.saveAutoBackupDate(null),
      );
      await settled(page);
      downloads.length = 0;
      await clickSettingsControl(page, "#pageSettingsOpen");
      assert.equal(
        await page.locator("#autoBackupValue").textContent(),
        await page.evaluate(() => WorkTimeApp.i18n.t("autoBackup.option1")),
      );
      await page.locator("#autoBackupTrigger").click();
      assert.deepEqual(
        await page
          .locator("#autoBackupOptions [data-value]")
          .evaluateAll((options) =>
            options.map((option) => option.dataset.value),
          ),
        ["1", "3", "7"],
      );
      assert.equal(
        await page
          .locator("#autoBackupOptions :focus")
          .getAttribute("data-value"),
        "1",
      );
      await page.locator('#autoBackupOptions [data-value="3"]').click();
      await settled(page);
      assert.equal(downloads.length, 0, "enabling only saves preference");
      await page.evaluate(async () => {
        // Even when a backup is due, damaged/unavailable/read-only stores must
        // never export temporary defaults as an automatic backup.
        for (const flags of [
          { loadIssue: "corrupt" },
          { storageFailed: true },
          { canWrite: false },
          { readSucceeded: false },
        ]) {
          const controller = WorkTimeApp.ui.createBackupController({
            model: { loadIssue: null, storageFailed: false, ...flags },
            persistence: { canWrite: true, readSucceeded: true, ...flags },
            actions: {
              prepareAgendaArchive: () => {
                throw Error("Unsafe automatic export");
              },
            },
            downloads: {
              download: () => {
                throw Error("Unsafe automatic download");
              },
            },
          });
          await controller.checkAutoBackup();
        }
      });
      assert.equal(await page.locator("#autoBackupHelp").isVisible(), true);
      await page.locator("#autoBackupTrigger").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(
          results,
          url.startsWith("file:")
            ? "auto-backup-settings.png"
            : "auto-backup-web.png",
        ),
      });

      const first = capture.next();
      await page.reload();
      await ready(page);
      const download = await first;
      assert.match(download.name, /20261028-120037\.txt$/);
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.preferences.page.state.lastAutoBackupDate ===
          "2026-10-28",
      );
      await settled(page);
      assert.equal(
        await page.evaluate(
          () => WorkTimeApp.services.preferences.page.state.lastBackupAt,
        ),
        "2026-10-28T04:00:37.000Z",
      );
      if (!(await page.locator("#autoBackupTrigger").isVisible()))
        await clickSettingsControl(page, "#pageSettingsOpen");
      assert.equal(
        await page.locator("#autoBackupHelp").textContent(),
        "10月28日12h00m已备份",
      );
      assert.equal(await page.locator("#autoBackupHelp").isVisible(), true);
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator("#autoBackupTrigger").scrollIntoViewIfNeeded();
        assert.equal(
          await page
            .locator("#recoveryOpen,#recoveryDialog,#clearSnapshotsDialog")
            .count(),
          0,
        );
        assert.ok(await page.locator("#autoBackupTrigger").isVisible());
        await page.screenshot({
          path: path.join(results, `auto-backup-status-${width}.png`),
        });
      }
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveBackupAt(
          "2026-10-27T03:05:00.000Z",
        );
      });
      assert.equal(
        await page.locator("#autoBackupHelp").textContent(),
        "10月27日11h05m已备份",
      );
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveBackupAt(
          "2026-10-28T04:00:00.000Z",
        );
      });
      const text = download.text;
      const exported = await page.evaluate(async (text) => {
        const full = await WorkTimeApp.services.backup.decode(
          text,
          (value) => value,
        );
        const state = WorkTimeApp.services.archive.migrate(full.work);
        return {
          format: full.format,
          games: !!full.games,
          days: state.preferences.autoBackupDays,
          agenda: Array.isArray(state.agenda),
          memo: typeof state.memo,
        };
      }, text);
      assert.deepEqual(exported, {
        format: "worktime-full-backup",
        games: true,
        days: 3,
        agenda: true,
        memo: "string",
      });
      await page.reload();
      await ready(page);
      await page.waitForTimeout(200);
      assert.equal(downloads.length, 1, "same-day reload does not download");

      // Another tab cannot download while the first owns the writer lock.
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveAutoBackupDate(
          "2026-09-01",
        );
      });
      const other = await context.newPage();
      await observeBackupWrites(other);
      other.on("download", () => assert.fail("read-only tab downloaded"));
      await other.goto(url);
      await ready(other);
      await other.waitForTimeout(200);
      await other.close();
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveAutoBackupDate(
          "2026-10-28",
        );
      });
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveAutoBackupDays(7);
      });
      assert.equal(
        await page.evaluate(
          () => WorkTimeApp.services.preferences.page.state.lastAutoBackupDate,
        ),
        "2026-10-28",
      );
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveAutoBackupDays(0);
        await WorkTimeApp.services.preferences.page.saveAutoBackupDays(1);
      });
      assert.equal(
        await page.evaluate(
          () => WorkTimeApp.services.preferences.page.state.lastAutoBackupDate,
        ),
        null,
      );
      const next = capture.next();
      await page.reload();
      await next;
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.preferences.page.state.lastAutoBackupDate ===
          "2026-10-28",
      );
      await settled(page);

      // Due after an extended absence: download once, then stamp the current day.
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveAutoBackupDays(7);
        await WorkTimeApp.services.preferences.page.saveAutoBackupDate(
          "2026-09-01",
        );
      });
      const manual = capture.next();
      await page.evaluate(() =>
        document.querySelector("#backupBeforeRestore").click(),
      );
      await manual;
      assert.equal(
        await page.evaluate(
          () => WorkTimeApp.services.preferences.page.state.lastAutoBackupDate,
        ),
        "2026-09-01",
        "manual backup does not move automatic schedule",
      );
      const overdue = capture.next();
      await page.reload();
      await overdue;
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.preferences.page.state.lastAutoBackupDate ===
          "2026-10-28",
      );
      await settled(page);

      // Throw before download: keep the old date and retry on the next opening.
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveAutoBackupDate(
          "2026-09-01",
        );
      });
      await page.addInitScript(() => {
        if (sessionStorage.getItem("backup-test-failure")) return;
        sessionStorage.setItem("backup-test-failure", "true");
        const create = FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable = function (...args) {
          if (this.name.endsWith(".txt"))
            throw Error("Test backup write failure");
          return create.apply(this, args);
        };
      });
      const beforeFailure = downloads.length;
      await page.reload();
      await ready(page);
      await page.waitForFunction(() =>
        document.body.textContent.includes("backups/automatic"),
      );
      assert.equal(downloads.length, beforeFailure);
      assert.equal(
        await page.evaluate(
          () => WorkTimeApp.services.preferences.page.state.lastAutoBackupDate,
        ),
        "2026-09-01",
      );
      const retry = capture.next();
      await page.reload();
      await retry;
      await page.waitForFunction(
        () =>
          WorkTimeApp.services.preferences.page.state.lastAutoBackupDate ===
          "2026-10-28",
      );
      await settled(page);

      // The download succeeds but recording its date fails: explain the retry risk.
      await page.evaluate(async () => {
        await WorkTimeApp.services.preferences.page.saveAutoBackupDate(
          "2026-09-01",
        );
      });
      await page.addInitScript(() =>
        document.addEventListener(
          "worktime:ready",
          () => {
            if (sessionStorage.getItem("backup-test-date-failure")) return;
            sessionStorage.setItem("backup-test-date-failure", "true");
            WorkTimeApp.services.preferences.page.saveAutoBackupDate =
              async () => ({ persisted: false });
          },
          { once: true },
        ),
      );
      const dateFailure = capture.next();
      await page.reload();
      await dateFailure;
      await page.waitForFunction(() =>
        document.body.textContent.includes(
          WorkTimeApp.i18n.t("autoBackup.dateFailed"),
        ),
      );
      assert.equal(
        await page.evaluate(
          () => WorkTimeApp.services.preferences.page.state.lastAutoBackupDate,
        ),
        "2026-09-01",
      );
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(
      "Automatic backup: calendar intervals, legacy validation, settings, full archive, reload deduplication, writer lock, failure/retry; real HTTP directory writes passed.",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

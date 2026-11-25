"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { clickSettingsControl } = require("./settings-test-helpers.cjs");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
const { observeBackupWrites } = require("./lib/backup-test-file.cjs");

async function main() {
  const server = await runtimeServer(path.resolve(process.argv[2] || "."));
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      serviceWorkers: "block",
    });
    await context.addInitScript(() => {
      navigator.permissions.query = async () => ({ state: "granted" });
    });
    const page = await context.newPage();
    const capture = await observeBackupWrites(page);
    function expectWrite(kind) {
      let timer;
      return Promise.race([
        capture.next(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error(`Missing ${kind} backup`)),
            15000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
    }
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("download", () => assert.fail("Backup triggered a download"));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, (route) => route.abort());
    await page.clock.install({ time: new Date("2026-10-28T12:59:00+08:00") });

    const ready = () =>
      page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
    const saved = (key, value) =>
      page.waitForFunction(
        ({ key, value }) => {
          const preferences = WorkTimeApp.services.preferences.page;
          return !preferences.dirty && preferences.state[key] === value;
        },
        { key, value },
      );
    const advance = async (at) => {
      const target = Date.parse(at);
      const current = await page.evaluate(() => Date.now());
      await page.clock.fastForward(target - current);
    };
    function verifyFile(output, kind, timestamp) {
      assert.equal(output.kind, kind);
      assert.match(output.name, timestamp);
      const backup = JSON.parse(output.text);
      assert.equal(backup.format, "worktime-full-backup");
      assert.ok(Array.isArray(backup.work.modules));
      assert.ok(backup.games.games);
    }

    const first = expectWrite("first daily");
    await page.goto(server.url);
    await ready();
    verifyFile(await first, "day", /20261028-1259\d{2}\.json$/);
    await saved("lastAutoBackupDate", "2026-10-28");

    await clickSettingsControl(page, "#pageSettingsOpen");
    assert.equal(
      await page.locator("#autoBackupTrigger,#autoBackupDays").count(),
      0,
    );
    assert.ok(await page.locator("#autoBackupFolderChoose").isVisible());
    await page.waitForTimeout(150);
    assert.equal(
      capture.writes.length,
      1,
      "no hourly backup before the boundary",
    );

    const hourly = expectWrite("13:00 hourly");
    await advance("2026-10-28T13:00:00.200+08:00");
    verifyFile(await hourly, "hour", /20261028-130000\.json$/);
    await saved("lastAutoBackupHour", "2026-10-28T05:00:00.000Z");

    await page.reload();
    await ready();
    await page.waitForTimeout(400);
    assert.equal(
      capture.writes.length,
      2,
      "reload cannot duplicate a day or hour",
    );
    const other = await context.newPage();
    const otherWrites = await observeBackupWrites(other);
    await other.goto(server.url);
    await other.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    assert.equal(otherWrites.writes.length, 0, "second tab cannot write");
    await other.close();

    await page.waitForFunction(
      () => !document.getElementById("backupBeforeRestore").disabled,
    );
    const manual = expectWrite("manual");
    await page.evaluate(() =>
      document.getElementById("backupBeforeRestore").click(),
    );
    verifyFile(await manual, "manual", /20261028-1300\d{2}\.json$/);
    await page.waitForFunction(
      () => !document.getElementById("backupBeforeRestore").disabled,
    );
    await saved("lastAutoBackupHour", "2026-10-28T05:00:00.000Z");

    const nextHour = expectWrite("14:00 hourly");
    await advance("2026-10-28T14:00:00.200+08:00");
    verifyFile(await nextHour, "hour", /20261028-140000\.json$/);
    await saved("lastAutoBackupHour", "2026-10-28T06:00:00.000Z");

    // Simulate a closed browser jumping to the next day before the new page starts.
    await page.clock.setSystemTime(new Date("2026-10-29T09:37:00+08:00"));
    const nextDay = expectWrite("next daily");
    await page.reload();
    await ready();
    verifyFile(await nextDay, "day", /20261029-0937\d{2}\.json$/);
    await saved("lastAutoBackupDate", "2026-10-29");
    assert.deepEqual(
      capture.writes.map(({ kind }) => kind),
      ["day", "hour", "manual", "hour", "day"],
    );
    assert.deepEqual(errors, []);
    console.log(
      "Daily startup, hourly boundaries, reload deduplication, plain JSON and manual backups verified.",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

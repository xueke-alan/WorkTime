"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const fixture = fs.readFileSync(
  path.join(__dirname, "fixtures/legacy-schema1.json"),
  "utf8",
);
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const ctx = await browser.newContext({
      timezoneId: "Asia/Shanghai",
      reducedMotion: "reduce",
    }),
    page = await ctx.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
  await page.addInitScript((text) => {
    window.clipboardText = text;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        readText: async () => window.clipboardText,
        writeText: async (value) => {
          window.clipboardText = value;
        },
      },
      configurable: true,
    });
  }, fixture);
  await page.goto(
    require("node:url").pathToFileURL(
      path.resolve(__dirname, "../tools/convert-backup.html"),
    ).href,
  );
  await page.evaluate(
    (text) => localStorage.setItem("worktime-local-v1", text),
    fixture,
  );
  await page.locator("#backupInput").fill(fixture);
  await page.locator("#convert").click();
  await page.waitForFunction(
    () => !document.getElementById("download").disabled,
  );
  const converted = await page.locator("#backupOutput").inputValue();
  const downloading = page.waitForEvent("download");
  await page.locator("#download").click();
  const downloaded = await downloading;
  assert.equal(fs.readFileSync(await downloaded.path(), "utf8"), converted);
  assert.equal(JSON.parse(converted).schemaVersion, 3);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("worktime-local-v1")),
    fixture,
  );
  await page
    .locator("#backupInput")
    .fill('{"schemaVersion":1,"settings":null}');
  await page.locator("#convert").click();
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.includes("转换失败"),
  );
  assert.equal(await page.locator("#backupOutput").inputValue(), "");
  assert.equal(await page.locator("#download").isDisabled(), true);
  const compressed = await page.evaluate(
    async (text) => WorkTimeApp.services.backup.encode(text),
    fixture,
  );
  await page.locator("#backupInputFile").setInputFiles({
    name: "old-backup.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(compressed),
  });
  await page.waitForFunction(
    (text) => document.getElementById("backupInput").value === text,
    compressed,
  );
  await page.locator("#convert").click();
  await page.waitForFunction(
    () => !document.getElementById("download").disabled,
  );
  assert.equal(await page.locator("#backupOutput").inputValue(), converted);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("worktime-local-v1")),
    fixture,
  );
  await page.goto(
    require("node:url").pathToFileURL(path.resolve(__dirname, "../index.html"))
      .href,
  );
  assert.match(
    await page.locator("#storageNoticeText").textContent(),
    /convert-backup.html/,
  );
  await page.evaluate((text) => {
    window.clipboardText = text;
  }, converted);
  await page.locator("#restore").click();
  await page.locator("#confirmRestore").click();
  await page.locator("#prevMonth").click();
  await page.locator('[data-date="2026-09-28"]').click();
  assert.equal(await page.locator("#dayEnd").inputValue(), "18:00");
  assert.match(await page.locator("#cards").innerText(), /17.50/);
  const before = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("worktime-local-v1"));
    return {
      state: s,
      summary: WorkTimeApp.domain.statistics.summary(
        s,
        "2026-09-01",
        "2026-09-30",
      ),
      records: WorkTimeApp.domain.observations.importRecords(s.imports[0]),
    };
  });
  assert.deepEqual(before.state.settings.breaks, [{ start: 720, end: 780 }]);
  assert.equal(before.state.settings.workEnd, "17:00");
  assert(Object.hasOwn(before.state.imports[0], "records"));
  assert.equal(before.records.length, 2);
  await page.locator("#backup").click();
  await page.waitForFunction(() =>
    window.clipboardText.startsWith(WorkTimeApp.services.backup.PREFIX),
  );
  const exported = await page.evaluate(async () =>
    WorkTimeApp.services.backup.decode(
      window.clipboardText,
      WorkTimeApp.domain.validation.validateBackup,
    ),
  );
  assert.deepEqual(exported, before.state);
  await page.locator("#restore").click();
  await page.locator("#confirmRestore").click();
  const after = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("worktime-local-v1"));
    return {
      state: s,
      summary: WorkTimeApp.domain.statistics.summary(
        s,
        "2026-09-01",
        "2026-09-30",
      ),
      records: WorkTimeApp.domain.observations.importRecords(s.imports[0]),
    };
  });
  assert.deepEqual(after, before);
  await page.locator("#sourceOpen").click();
  assert.equal(
    await page.locator("#sourceBody textarea").inputValue(),
    after.state.imports[0].sources.map((source) => source.raw).join("\n\n"),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Legacy browser round trip passed: absent settings metadata, raw-only imports, estimates/drafts, custom breaks, statistics and source retained after restore/export/restore.",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});

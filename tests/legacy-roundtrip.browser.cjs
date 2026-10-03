"use strict";
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const fixture = fs.readFileSync(
  path.join(__dirname, "fixtures/legacy-schema1.json"),
  "utf8",
);
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
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
    require("node:url").pathToFileURL(path.resolve(__dirname, "../index.html"))
      .href,
  );
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
      summary: WorkTime.summary(s, "2026-09-01", "2026-09-30"),
      records: WorkTime.importRecords(s.imports[0]),
    };
  });
  assert.deepEqual(before.state.settings.breaks, [{ start: 720, end: 780 }]);
  assert.equal(before.state.settings.workEnd, "17:00");
  assert(!Object.hasOwn(before.state.imports[0], "records"));
  assert.equal(before.records.length, 2);
  await page.locator("#backup").click();
  await page.waitForFunction(() =>
    window.clipboardText.startsWith(WorkBackup.PREFIX),
  );
  const exported = await page.evaluate(async () =>
    WorkBackup.decode(window.clipboardText, WorkTime.validateBackup),
  );
  assert.deepEqual(exported, before.state);
  await page.locator("#restore").click();
  await page.locator("#confirmRestore").click();
  const after = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("worktime-local-v1"));
    return {
      state: s,
      summary: WorkTime.summary(s, "2026-09-01", "2026-09-30"),
      records: WorkTime.importRecords(s.imports[0]),
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

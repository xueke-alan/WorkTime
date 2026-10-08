"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const width of [1600, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      timezoneId: "Asia/Shanghai",
      reducedMotion: "reduce",
    });
    const p = await context.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.clock.install({ time: new Date("2026-09-08T12:00:00+08:00") });
    await p.addInitScript(() => {
      window.failScheduleSave = false;
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (...args) {
        if (window.failScheduleSave) throw Error("test quota");
        return set.apply(this, args);
      };
    });
    await p.goto(pathToFileURL(path.resolve("index.html")).href);
    await p.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await p.locator('[data-date="2026-09-08"]').click();
    await p.locator("#settingsOpen").click();
    assert.match(
      await p.locator("#scheduleEditingDate").innerText(),
      /2026-09-08/,
    );
    await p.locator("#standardStart").fill("09:00");
    assert.equal(
      await p.evaluate(() =>
        localStorage.getItem(WorkTimeApp.domain.state.KEY),
      ),
      null,
      "draft does not save",
    );
    await p.locator("#overtimeRequirement0").fill("1.1");
    assert.equal(
      await p.evaluate(
        () =>
          JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY))
            .settings.workStart,
      ),
      "08:00",
      "global save excludes draft",
    );
    await p.locator("#scheduleApplyOpen").click();
    assert.equal(
      await p.locator("#scheduleRangeChoice").inputValue(),
      "future",
    );
    await p.locator("#scheduleRangeChoice").selectOption("week");
    assert.match(
      await p.locator("#scheduleRangeDescription").innerText(),
      /2026-09-08 至 2026-09-14/,
    );
    await p.locator("#scheduleRangeDialog [data-close]").last().click();
    assert.equal(await p.locator("#standardStart").inputValue(), "09:00");
    await p.locator("#settingsOpen").click();
    await p.locator("#scheduleDraftContinue").click();
    assert(await p.locator("#settingsDialog").isVisible());
    await p.locator('[data-date="2026-09-09"]').click();
    await p.locator("#scheduleDraftApply").click();
    await p.locator("#scheduleRangeChoice").selectOption("custom");
    await p.locator("#scheduleRangeStart").fill("2026-09-08");
    await p.locator("#scheduleRangeEnd").fill("2026-09-09");
    await p.evaluate(() => (window.failScheduleSave = true));
    await p.locator("#scheduleRangeForm button[type=submit]").click();
    assert.match(await p.locator("#scheduleRangeError").innerText(), /未应用/);
    assert.equal(
      await p.evaluate(
        () =>
          JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY))
            .scheduleRanges.length,
      ),
      0,
    );
    assert.equal(
      await p.locator("#dayStart").getAttribute("placeholder"),
      "08:00",
      "failed candidate not applied in memory",
    );
    await p.evaluate(() => (window.failScheduleSave = false));
    await p.locator("#scheduleRangeForm button[type=submit]").click();
    await p.locator("#settingsDialog").waitFor({ state: "visible" });
    assert.match(await p.locator("#editorDate").innerText(), /2026-09-09/);
    assert.equal(
      await p.locator("#dayStart").getAttribute("placeholder"),
      "09:00",
    );
    assert.equal(await p.locator("#settingsDialog").isVisible(), true);
    assert.match(
      await p.locator("#scheduleEditingDate").innerText(),
      /2026-09-09/,
    );
    await p.locator("#settingsOpen").click();
    await p.locator("#dayLeaveToggle").click();
    await p.locator("#dayLeaveFull").click();
    assert.equal(
      await p.evaluate(
        () =>
          JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY)).days[
            "2026-09-09"
          ].leaveMinutes,
      ),
      420,
    );
    await p.locator("#settingsOpen").click();
    await p.locator("#standardStart").fill("10:00");
    await p.locator("#scheduleApplyOpen").click();
    await p.locator("#scheduleRangeForm button[type=submit]").click();
    assert.match(
      await p.locator("#scheduleRangeError").innerText(),
      /2026-09-09/,
    );
    assert.equal(
      await p.locator("#scheduleRangeDialog #scheduleList").isVisible(),
      true,
    );
    await p.locator('[data-schedule-index="0"]').click();
    await p.locator("#scheduleDraftDiscard").click();
    assert.equal(await p.locator("#standardStart").inputValue(), "08:00");
    assert.equal(await p.locator("#scheduleRangeChoice").inputValue(), "all");
    await p.locator('[data-schedule-index="1"]').click();
    assert.equal(
      await p.locator("#scheduleRangeChoice").inputValue(),
      "custom",
    );
    assert.equal(
      await p.locator("#scheduleRangeStart").inputValue(),
      "2026-09-08",
    );
    await p.keyboard.press("Escape");
    await p.locator("#standardStart").fill("08:30");
    await p.keyboard.press("Escape");
    await p.locator("#scheduleDraftDiscard").click();
    await p.locator("#settingsDialog").waitFor({ state: "hidden" });
    await p.locator("#batchToggle").click();
    await p.locator("#batchCalculateEnd").click();
    assert.match(await p.locator("#batchCalcResult").innerText(), /请先选择/);
    await p.locator('[data-date="2026-09-08"]').click();
    await p.locator('[data-date="2026-09-10"]').click();
    await p.locator("#batchCalcOvertime").fill("1");
    await p.locator("#batchCalculateEnd").click();
    assert.match(await p.locator("#batchCalcResult").innerText(), /不同作息/);
    await p.locator("#batchCancel").click();
    await p.locator("#settingsOpen").click();
    await p.locator("#scheduleApplyOpen").click();
    assert.equal(
      await p.evaluate(() =>
        document.querySelector("#scheduleRangeDialog").matches(":modal"),
      ),
      true,
    );
    const overflow = await p.evaluate(() => ({
      page: document.documentElement.scrollWidth > innerWidth,
      dialog:
        document.querySelector("#scheduleRangeDialog").scrollWidth >
        document.querySelector("#scheduleRangeDialog").clientWidth,
    }));
    assert.deepEqual(overflow, { page: false, dialog: false });
    await p.screenshot({
      path: "test-results/schedule-range-" + width + ".png",
    });
    await p.keyboard.press("Escape");
    const data = await p.evaluate(() =>
      JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY)),
    );
    assert.equal(data.schemaVersion, 3);
    assert.equal(data.scheduleRanges.length, 1);
    await p.reload();
    await p.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await p.locator("#settingsOpen").click();
    assert.equal(await p.locator("#standardStart").inputValue(), "09:00");
    await p.screenshot({
      path: "test-results/schedule-settings-" + width + ".png",
    });
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Keep "today" fixed while a range dialog spans China midnight, then reject unsupported backups.
  const midnightContext = await browser.newContext({
    reducedMotion: "reduce",
    timezoneId: "Asia/Shanghai",
  });
  const midnight = await midnightContext.newPage();
  await midnight.clock.install({ time: new Date("2026-12-31T23:59:00+08:00") });
  await midnight.goto(pathToFileURL(path.resolve("index.html")).href);
  await midnight.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  await midnight.locator("#settingsOpen").click();
  await midnight.locator("#standardStart").fill("09:00");
  await midnight.locator("#scheduleApplyOpen").click();
  await midnight.locator("#scheduleRangeChoice").selectOption("week");
  await midnight.clock.fastForward(120000);
  assert.match(
    await midnight.locator("#scheduleRangeDescription").innerText(),
    /2026-12-31 至 2027-01-06/,
  );
  await midnight.locator("#scheduleRangeForm button[type=submit]").click();
  assert.equal(
    await midnight.evaluate(
      () =>
        JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY))
          .scheduleRanges[0].start,
    ),
    "2026-12-31",
  );
  await midnightContext.close();
  const legacyContext = await browser.newContext({ reducedMotion: "reduce" });
  await legacyContext.setOffline(true);
  const legacyPage = await legacyContext.newPage();
  await legacyPage.addInitScript(
    (text) => localStorage.setItem("worktime-local-v1", text),
    fs.readFileSync("tests/fixtures/legacy-schema1.json", "utf8"),
  );
  await legacyPage.goto(pathToFileURL(path.resolve("index.html")).href);
  await legacyPage.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  assert.equal(
    await legacyPage.evaluate(
      () =>
        JSON.parse(localStorage.getItem(WorkTimeApp.domain.state.KEY))
          .schemaVersion,
    ),
    1,
  );
  assert.match(
    await legacyPage.locator("#storageNoticeText").textContent(),
    /convert-backup.html/,
  );
  await legacyPage.locator("#settingsOpen").click();
  await legacyPage.locator("#standardStart").fill("09:00");
  await legacyPage.locator("#scheduleApplyOpen").click();
  for (let i = 0; i < 8; i++) {
    await legacyPage.keyboard.press("Tab");
    assert(
      await legacyPage
        .locator("#scheduleRangeDialog")
        .evaluate((e) => e.contains(document.activeElement)),
    );
  }
  await legacyPage.keyboard.press("Escape");
  await legacyContext.close();
  // A second page with no write lock must retain a rejected draft.
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const owner = await context.newPage(),
    reader = await context.newPage();
  for (const p of [owner, reader]) {
    await p.goto(pathToFileURL(path.resolve("index.html")).href);
    await p.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
  }
  await reader.locator("#settingsOpen").click();
  await reader.locator("#standardStart").fill("09:00");
  await reader.locator("#scheduleApplyOpen").click();
  await reader.locator("#scheduleRangeForm button[type=submit]").click();
  assert.match(
    await reader.locator("#scheduleRangeError").innerText(),
    /未应用/,
  );
  await context.close();
  fs.writeFileSync(
    "test-results/SCHEDULE_VALIDATION.json",
    JSON.stringify(
      {
        widths: [1600, 390],
        draft: true,
        interval: true,
        atomicSave: true,
        readonly: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "Schedule browser passed: draft isolation, ranges, navigation guard, retry, leave conflicts, list loading, batch limits and responsive modals.",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});

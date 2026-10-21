"use strict";
// Browser regression audit: node scripts/verify-desktop-i18n.cjs
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const output = path.resolve("test-results/desktop-i18n");
  fs.mkdirSync(output, { recursive: true });
  const reports = [];
  const errors = [];
  for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ko", "ja"]) {
    const context = await browser.newContext({
      locale: language,
      reducedMotion: "reduce",
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      errors.push(language + ": " + error.message),
    );
    await page.route(/^https?:/, (r) => r.abort());
    await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
    await page.goto(pathToFileURL(path.resolve("index.html")).href);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    const backup = await page.evaluate((locale) => {
      const s = WorkTimeApp.domain.state.defaultState();
      s.preferences.language = locale;
      s.settings.configured = true;
      s.personal.employmentDate = "2024-11-13";
      for (const d of ["08", "09", "12", "13", "21"])
        s.days["2026-10-" + d] = {
          actual: {
            start: "08:00",
            end: d === "21" ? "16:42" : "19:30",
            nextDay: false,
            effectiveMinutes: null,
          },
        };
      return JSON.stringify(WorkTimeApp.domain.validation.validateBackup(s));
    }, language);
    await page.locator("#backupFile").setInputFiles({
      name: "fixture.json",
      mimeType: "application/json",
      buffer: Buffer.from(backup),
    });
    await page.locator("#confirmRestore").click();
    for (const width of [1920, 2560]) {
      await page.setViewportSize({
        width,
        height: width === 1920 ? 1080 : 1440,
      });
      async function inspect(scene) {
        await page.evaluate(() => WorkTimeApp.ui.alignment.refresh());
        const issues = await page.evaluate(() => {
          const issues = [];
          const visible = (e) =>
            e.checkVisibility({ checkVisibilityCSS: true }) &&
            e.getBoundingClientRect().width > 0;
          for (const e of document.querySelectorAll(
            "button,label,h2,h3,.card-label,.card-foot,.daykind,.preview-period,.target-result,dt,dd",
          )) {
            if (!visible(e) || e.closest("svg")) continue;
            const b = e.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(e);
            const rects = [];
            const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
            let t;
            while ((t = walker.nextNode())) {
              if (
                !t.textContent.trim() ||
                t.parentElement.closest("svg,.theme-name") ||
                !visible(t.parentElement)
              )
                continue;
              range.selectNodeContents(t);
              rects.push(
                ...[...range.getClientRects()].filter((r) => r.width > 0),
              );
            }
            if (
              rects.some(
                (r) =>
                  r.left < b.left - 2 ||
                  r.right > b.right + 2 ||
                  r.bottom > b.bottom + 3 ||
                  r.top < b.top - 3,
              )
            )
              issues.push({
                kind: "text-bounds",
                id: e.id,
                cls: e.className,
                text: e.textContent.trim(),
                width: b.width,
                height: b.height,
              });
            const lines = new Set(rects.map((r) => Math.round(r.top / 5) * 5));
            if (
              lines.size > 1 &&
              ["BUTTON", "LABEL"].includes(e.tagName) &&
              !e.matches(".schedule-list-item")
            )
              issues.push({
                kind: "wrap",
                id: e.id,
                cls: e.className,
                text: e.textContent.trim(),
                width: b.width,
                height: b.height,
              });
          }
          if (document.documentElement.scrollWidth > innerWidth + 1)
            issues.push({ kind: "page-overflow" });
          return issues;
        });
        reports.push({ language, width, scene, issues });
        await page.screenshot({
          path: path.join(output, `${language}-${width}-${scene}.png`),
        });
      }
      await page
        .locator('.day[data-date="2026-10-23"] .day-select')
        .click({ force: true });
      await inspect("future-day");
      await page
        .locator('.day[data-date="2026-10-21"] .day-select')
        .click({ force: true });
      await inspect("day");
      for (const [button, scene] of [
        ["#dayLeaveToggle", "leave"],
        ["#personalSettingsOpen", "personal"],
        ["#pageSettingsOpen", "page-settings"],
        ["#settingsOpen", "work-settings"],
        ["#importOpen", "import"],
        ["#batchToggle", "batch"],
      ]) {
        await page.locator(button).click();
        await inspect(scene);
      }
      await page
        .locator('.day[data-date="2026-10-19"] .day-select')
        .click({ force: true });
      await page.locator("#batchStart").fill("08:00");
      await page.locator("#batchEnd").fill("19:30");
      await inspect("batch-populated");
      await page.locator("#batchCancel").click();
      await page.locator("#importOpen").click();
      for (const button of ["#addTimeTemplate", "#dayImportTemplates"]) {
        await page.locator(button).click();
        await inspect(button.slice(1));
        await page.locator("dialog:modal [data-close]").first().click();
      }
      await page.locator("#pageSettingsOpen").click();
      await page.locator("#recoveryOpen").click();
      await inspect("recovery");
      await page.locator("dialog:modal [data-close]").first().click();
      await page.locator("#personalSettingsCancel").click();
      await page.locator("#settingsOpen").click();
      await page.locator("#scheduleApplyOpen").click();
      await inspect("schedule-range");
      await page.locator("dialog:modal [data-close]").first().click();
      await page.locator("#workSettingsCancel").click();
      await page.locator("#monthTitle").click();
      await inspect("year");
      await page.locator("#monthTitle").click();
      for (const id of [
        "#date-tab-history",
        "#date-tab-weather",
        "#date-tab-festivals",
      ])
        if (await page.locator(id).isVisible()) {
          await page.locator(id).click();
          await inspect(id.slice(1));
        }
      await page.locator("#pageSettingsOpen").click();
      for (const id of ["#weatherTrigger", "#languageTrigger"]) {
        await page.locator(id).click();
        await inspect(id.slice(1));
        await page.locator(id).click();
      }
      await page.locator("#personalSettingsCancel").click();
      await page.locator("#prevMonth").click();
      await inspect("september");
      for (let i = 0; i < 6; i++) await page.locator("#prevMonth").click();
      await inspect("six-week-march");
      for (let i = 0; i < 7; i++) await page.locator("#nextMonth").click();
    }
    await context.close();
    console.log(language + " done");
  }
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify({ reports, errors }, null, 2),
  );
  await browser.close();
  const failures = reports.filter((report) => report.issues.length);
  if (failures.length || errors.length)
    throw Error(JSON.stringify({ failures, errors }, null, 2));
  console.log(
    `Verified ${reports.length} desktop scenes across six languages at 1080p and 1440p.`,
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

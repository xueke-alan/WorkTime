"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
async function verify() {
  const output = path.resolve("test-results/compact-layout");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const language of [
      "zh-CN",
      "zh-TW",
      "zh-HK",
      "en",
      "ko",
      "ja",
      "es",
      "de",
      "fr",
    ]) {
      const context = await browser.newContext({
        locale: language,
        reducedMotion: "reduce",
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      const backup = await page.evaluate((locale) => {
        const state = WorkTimeApp.domain.state.defaultState();
        state.preferences.language = locale;
        state.settings.configured = true;
        state.personal.employmentDate = "2024-11-13";
        for (const day of ["08", "09", "12", "13", "21"])
          state.days["2026-10-" + day] = {
            actual: {
              start: "08:00",
              end: day === "21" ? "16:42" : "19:30",
              nextDay: false,
              effectiveMinutes: null,
            },
          };
        return JSON.stringify(
          WorkTimeApp.domain.validation.validateBackup(state),
        );
      }, language);
      await page.locator("#backupFile").setInputFiles({
        name: "compact-fixture.json",
        mimeType: "application/json",
        buffer: Buffer.from(backup),
      });
      await page.locator("#confirmRestore").click();
      await page.waitForSelector("#dayPreview .has-daily-metrics");
      assert.equal(await page.locator(".preview-day > span").count(), 1);
      assert.equal(
        await page.locator(".preview-day strong").textContent(),
        "1 d",
      );
      for (const width of [390, 850, 1150, 1280, 1440, 1920, 2560]) {
        await page.setViewportSize({
          width,
          height: width === 2560 ? 1440 : width === 1920 ? 1080 : 1000,
        });
        await page.evaluate(() => WorkTimeApp.ui.alignment.refresh());
        await page.screenshot({
          path: path.join(output, language + "-" + width + ".png"),
          fullPage: true,
        });
        const issues = await page.evaluate(() => {
          const issues = [];
          // A language switch must not top-align the short day-type label
          // against the taller date circle. Narrow calendars stack both fields.
          const top = document.querySelector(
            '.calendar [data-date="2026-10-09"] .daytop',
          );
          const date = top.querySelector(".day-date"),
            kind = top.querySelector(".daykind");
          if (getComputedStyle(top).flexDirection === "row") {
            const a = date.getBoundingClientRect(),
              b = kind.getBoundingClientRect();
            const offset =
              parseFloat(
                getComputedStyle(kind).getPropertyValue("--ui-ink-offset"),
              ) || 0;
            if (
              Math.abs(a.top + a.height / 2 - (b.top + b.height / 2 - offset)) >
              1
            )
              issues.push("day-type label lost vertical centering");
          }
          const rect = (node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return range.getBoundingClientRect();
          };
          for (const node of document.querySelectorAll(
            ".sidebar-brand-subtitle,.target-copy h3,.card-foot",
          )) {
            const range = document.createRange();
            range.selectNodeContents(node);
            if (range.getClientRects().length > 1)
              issues.push("wrap: " + node.textContent);
            const text = rect(node),
              host = node
                .closest(".card,.target-panel,.sidebar-brand")
                .getBoundingClientRect();
            if (text.left < host.left - 1 || text.right > host.right + 1)
              issues.push("outside: " + node.textContent);
          }
          const figures = [
            ...document.querySelectorAll(
              ".preview-day.has-daily-metrics > span",
            ),
          ];
          const dailyBox = document
            .querySelector(".preview-day.has-daily-metrics")
            .getBoundingClientRect();
          for (const [index, node] of figures.entries()) {
            const text = rect(node),
              box = node.getBoundingClientRect();
            if (text.left < box.left - 1 || text.right > box.right + 1)
              issues.push("daily outside: " + node.textContent);
            if (rect(node.querySelector("strong")).bottom > dailyBox.bottom + 1)
              issues.push("daily value clipped: " + node.textContent);
            if (index && rect(figures[index - 1]).right > text.left + 1)
              issues.push("daily overlap: " + node.textContent);
          }
          for (const card of document.querySelectorAll(".card")) {
            const label = card.querySelector(".card-label"),
              metric = card.querySelector(".metric");
            if (
              label &&
              metric &&
              rect(label).right > metric.getBoundingClientRect().left + 1
            )
              issues.push("card overlap: " + label.textContent);
          }
          const period = document.querySelector(".preview-period"),
            text = rect(period),
            host = period.getBoundingClientRect();
          if (text.right > host.right + 1)
            issues.push("period outside: " + period.textContent);
          if (document.documentElement.scrollWidth > innerWidth + 1)
            issues.push("page overflow");
          return issues;
        });
        assert.deepEqual(issues, [], language + " at " + width);
      }
      assert.deepEqual(errors, [], language);
      await context.close();
      console.log(
        language +
          ": populated summary, negative overtime and employment preview fit seven viewport widths, including 1080p and 1440p.",
      );
    }
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

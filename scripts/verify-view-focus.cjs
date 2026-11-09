"use strict";
/** Returning from analysis or agenda focuses the work-time editor for the shown month. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(process.argv[2] || ".");
const url = pathToFileURL(path.join(root, "index.html")).href;

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const errors = [];
  try {
    async function scenario(name, steps, expected) {
      const context = await browser.newContext({
        locale: "zh-CN",
        reducedMotion: "reduce",
        viewport: { width: 1440, height: 1000 },
      });
      await context.route(/^https?:/, (route) => route.abort());
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date("2026-11-09T04:00:00Z"));
      await page.goto(url);
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      await steps(page);
      const focus = await page.evaluate(() => ({
        month: document.querySelector("#monthTitle")?.textContent?.trim(),
        date:
          document.querySelector("#calendar .day.selected")?.dataset.date ||
          null,
        editor: document
          .querySelector("#editorDate")
          ?.textContent?.replace(/\s+/g, "")
          .trim(),
      }));
      assert.equal(focus.date, expected, name + " focuses " + expected);
      const [year, month, day] = expected.split("-");
      assert.ok(
        focus.editor.startsWith(year + Number(month) + Number(day)),
        name + " right column shows " + expected,
      );
      console.log(name + ": " + focus.month + " -> " + focus.date);
      await context.close();
    }
    await scenario("Attendance stays on today", async () => {}, "2026-11-09");
    await scenario(
      "Analysis returns to today",
      async (page) => {
        await page.locator("#analysisToggle").click();
        await page.locator("#analysisToggle").click();
      },
      "2026-11-09",
    );
    await scenario(
      "Analysis past month returns to its last working day",
      async (page) => {
        await page.locator("#analysisToggle").click();
        await page.locator("#prevMonth").click();
        await page.locator("#analysisToggle").click();
      },
      "2026-10-30",
    );
    await scenario(
      "Analysis future month returns to its first working day",
      async (page) => {
        await page.locator("#analysisToggle").click();
        await page.locator("#nextMonth").click();
        await page.locator("#nextMonth").click();
        await page.locator("#analysisToggle").click();
      },
      "2027-01-04",
    );
    await scenario(
      "Agenda returns to today",
      async (page) => {
        await page.locator("#agendaMode").click();
        await page.locator("#agendaMode").click();
      },
      "2026-11-09",
    );
    await scenario(
      "Agenda past month returns to its last working day",
      async (page) => {
        await page.locator("#agendaMode").click();
        await page.locator("#prevMonth").click();
        await page
          .locator('#calendar .day[data-date="2026-10-15"] .day-select')
          .click();
        await page.locator("#agendaMode").click();
      },
      "2026-10-30",
    );
    await scenario(
      "Agenda future month returns to its first working day",
      async (page) => {
        await page.locator("#agendaMode").click();
        await page.locator("#nextMonth").click();
        await page.locator("#nextMonth").click();
        await page.locator("#agendaMode").click();
      },
      "2027-01-04",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Work-time editor focus after analysis/agenda returns verified for current, past and future months.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

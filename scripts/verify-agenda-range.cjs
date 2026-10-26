"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const setScheduleRange = require("./lib/agenda-test-range.cjs");

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1480, height: 1000 },
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.locator("#agendaMode").click();
    await page.locator("#agendaNew").click();
    await page.locator("#agendaTitle").fill("日期范围回归");
    const popup = page.locator("#agendaSchedulePopup");
    const done = popup.locator("[data-schedule-close]");
    const day = (date) =>
      popup.locator(`[data-picker-date="${date}"]:not(.is-adjacent)`);
    const dates = async () => [
      await page.locator("#agendaDateInput").inputValue(),
      await page.locator("#agendaEndDateInput").inputValue(),
    ];
    const open = async () => {
      if (!(await popup.evaluate((node) => node.matches(":popover-open"))))
        await page.locator("#agendaScheduleOpen").click();
    };
    const setup = async (start, end = start) => {
      await open();
      await setScheduleRange(page, start, end);
      await done.click();
      await open();
    };
    assert.equal(await page.locator("#agendaMultiDay").count(), 0);
    await setup("2028-02-28");
    const calendars = popup.locator(".agenda-inline-calendar");
    assert.equal(await calendars.count(), 2);
    assert.equal(
      (await calendars.nth(0).boundingBox()).y,
      (await calendars.nth(1).boundingBox()).y,
    );

    // Leap day, hover preview and an incomplete range never become a saved draft.
    await day("2028-02-28").click();
    assert.equal(await done.isDisabled(), true);
    assert.deepEqual(await dates(), ["2028-02-28", ""]);
    await day("2028-03-02").hover();
    assert.equal(
      await popup.locator(".is-range-preview:not(.is-adjacent)").count(),
      4,
    );
    await day("2028-03-02").click();
    assert.equal(await done.isEnabled(), true);
    assert.deepEqual(await dates(), ["2028-02-28", "2028-03-02"]);
    assert.equal(
      await popup.locator(".is-in-range:not(.is-adjacent)").count(),
      2,
    );

    // Reverse selection sorts dates. Escape and light-dismiss discard a pending start.
    await day("2028-03-04").click();
    await day("2028-02-27").click();
    assert.deepEqual(await dates(), ["2028-02-27", "2028-03-04"]);
    await day("2028-02-29").click();
    await page.keyboard.press("Escape");
    await open();
    assert.deepEqual(await dates(), ["2028-02-27", "2028-03-04"]);
    await day("2028-02-29").click();
    await page.locator("#agendaTitle").click();
    await open();
    assert.deepEqual(await dates(), ["2028-02-27", "2028-03-04"]);

    await day("2028-02-29").click();
    await page.locator("#agendaEndDateInput").focus();
    assert.deepEqual(await dates(), ["2028-02-29", ""]);
    await day("2028-03-04").click();
    assert.deepEqual(await dates(), ["2028-02-29", "2028-03-04"]);
    await setup("2028-02-27", "2028-03-04");

    // Editing one endpoint keeps the other, including when the dates cross.
    await page.locator("#agendaEndDateInput").focus();
    await day("2028-02-26").click();
    assert.deepEqual(await dates(), ["2028-02-26", "2028-02-27"]);
    await page.locator("#agendaDateInput").focus();
    await day("2028-03-03").click();
    assert.deepEqual(await dates(), ["2028-02-27", "2028-03-03"]);
    await page.locator("#agendaEndDateInput").fill("2028-02-25");
    assert.deepEqual(await dates(), ["2028-02-25", "2028-02-27"]);

    // Same-day range and keyboard preview work without pointer interaction.
    await setup("2028-02-28");
    await day("2028-02-28").click();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator(":focus").getAttribute("data-picker-date"),
      "2028-02-29",
    );
    assert.equal(
      await popup.locator(".is-range-preview:not(.is-adjacent)").count(),
      2,
    );
    await page.keyboard.press("Enter");
    assert.deepEqual(await dates(), ["2028-02-28", "2028-02-29"]);
    await day("2028-02-29").click();
    await page.keyboard.press("Enter");
    assert.deepEqual(await dates(), ["2028-02-29", "2028-02-29"]);

    await setup("2028-12-31");
    await day("2028-12-31").click();
    await day("2029-01-02").click();
    assert.deepEqual(await dates(), ["2028-12-31", "2029-01-02"]);
    await page.locator("#agendaAllDay").uncheck();
    assert.equal(await page.locator("#agendaEnd").getAttribute("required"), "");
    await page.locator("#agendaStart").fill("09:00");
    await page.locator("#agendaEnd").fill("18:00");
    await done.click();
    assert.match(
      await page.locator("#agendaScheduleSummary").textContent(),
      /2028-12-31 09:00.*2029-01-02 18:00/,
    );
    await open();
    await popup.locator("[data-schedule-today]").click();
    const today = await page.evaluate(() =>
      WorkTimeApp.domain.time.businessDate(new Date()),
    );
    assert.deepEqual(await dates(), [today, today]);
    assert.equal(
      await page.locator("#agendaEnd").getAttribute("required"),
      null,
    );
    await page.locator("#agendaEnd").fill("");
    await done.click();
    await page.locator("#agendaSave").click();
    await page.locator("#agendaForm").waitFor({ state: "hidden" });
    await page
      .locator("#agendaList [data-agenda-edit]")
      .filter({ hasText: "日期范围回归" })
      .click();
    await open();
    assert.deepEqual(await dates(), [today, today]);
    assert.equal(await page.locator("#agendaEnd").inputValue(), "");

    // Both date limits, month clamping, translated instructions and compact screens.
    for (const [date, step] of [
      ["1900-01-01", "-1"],
      ["9999-12-31", "1"],
    ]) {
      await setup(date);
      assert.equal(
        await popup
          .locator(`[data-picker-step="${step}"]:visible`)
          .isDisabled(),
        true,
      );
    }
    await setup("2028-02-28");
    for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
      await page.evaluate((id) => WorkTimeApp.i18n.setLanguage(id), language);
      assert.equal(
        await popup.locator(".agenda-schedule-status").textContent(),
        await page.evaluate(() =>
          WorkTimeApp.i18n.t("agenda.selectRangeStart"),
        ),
      );
    }
    for (const width of [320, 375, 540, 850, 1480]) {
      await page.setViewportSize({ width, height: 740 });
      await page.waitForTimeout(50);
      const box = await popup.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      assert.ok(box.y >= 0 && box.y + box.height <= 741);
      const left = await calendars.nth(0).boundingBox();
      const right = await calendars.nth(1).boundingBox();
      assert.equal(right.y > left.y, width <= 540);
    }
    await page.screenshot({
      path: path.resolve(process.env.TEMP, "worktime-agenda-range.png"),
    });
    assert.deepEqual(errors, []);
    console.log(
      "Agenda range selection, preview, cancellation, endpoints, keyboard, locales and responsive layout verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

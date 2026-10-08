const { chromium } = require("playwright");
const assert = require("node:assert/strict");
let runningBrowser;
(async () => {
  const browser = (runningBrowser = await chromium.launch({
    channel: "msedge",
    headless: true,
  }));
  const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const testTime = new Date("2026-10-02T12:00:00+08:00");
  await page.clock.install({ time: testTime });
  await page.clock.pauseAt(testTime);
  await page.goto(
    require("node:url").pathToFileURL(
      require("node:path").resolve(__dirname, "../index.html"),
    ).href,
  );
  await page.clock.runFor(1000);
  await page.locator("#monthTitle").click();
  assert.equal(await page.locator(".year-month").count(), 12);
  assert.equal(
    await page
      .locator("#calendar")
      .evaluate((el) => getComputedStyle(el).animationName),
    "motion-calendar-view",
  );
  assert.equal(await page.locator("[data-year-date]").count(), 365);
  const selectedDay = page.locator('.year-day[aria-pressed="true"]');
  assert.equal(await selectedDay.count(), 1);
  assert.equal(await selectedDay.getAttribute("data-year-date"), "2026-10-02");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "rose";
  });
  await page.clock.runFor(1000);
  const { themeColor, textColor } = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const themeColor = getComputedStyle(probe).color;
    probe.style.color = "var(--theme-text-strong)";
    const textColor = getComputedStyle(probe).color;
    probe.remove();
    return { themeColor, textColor };
  });
  assert.deepEqual(
    await selectedDay.evaluate((el) => ({
      shadow: getComputedStyle(el).boxShadow,
      color: getComputedStyle(el.querySelector("span")).color,
      opacity: getComputedStyle(el.querySelector("span")).opacity,
    })),
    {
      shadow: themeColor + " 0px 0px 0px 3px inset",
      color: textColor,
      opacity: "1",
    },
  );
  assert.equal(
    await page
      .locator("#calendar")
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
    4,
  );
  const sizes = await page.locator(".year-day").evaluateAll((days) =>
    days.map((day) => ({
      width: day.getBoundingClientRect().width,
      height: day.getBoundingClientRect().height,
    })),
  );
  assert(
    sizes.every(
      (size) =>
        Math.abs(size.width - sizes[0].width) < 0.1 &&
        Math.abs(size.height - 30) < 0.1,
    ),
  );
  assert.equal(
    await page.locator(".year-month-number").first().innerText(),
    "1",
  );
  assert.equal(await page.locator(".year-month-stats").count(), 12);
  assert.equal(
    await page.locator(".year-month-stats").first().innerText(),
    "0h\n—h/d",
  );
  const monthStats = await page.evaluate(() => {
    const state = WorkTimeApp.domain.state.defaultState();
    state.days["2026-01-12"] = {
      actual: { start: "08:00", end: "19:30", nextDay: false },
    };
    state.days["2026-01-11"] = {
      actual: { start: "08:00", end: "10:00", nextDay: false },
    };
    const stats = WorkTimeApp.ui.year.months(state, 2026, "2026-10-02")[0]
      .summary;
    return {
      total: stats.workOvertime + stats.restOvertime,
      average: stats.average,
    };
  });
  assert.deepEqual(monthStats, { total: 210, average: 90 });
  const firstRow = await page.locator(".year-month").nth(0).boundingBox(),
    secondRow = await page.locator(".year-month").nth(4).boundingBox();
  assert(secondRow.y > firstRow.y + firstRow.height);
  assert.equal(await page.locator(".year-month-watermark").count(), 0);
  assert.equal(
    await page
      .locator(".year-month h3")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
    "18px",
  );
  await page.locator(".month-title-month").waitFor({ state: "hidden" });
  const entered = await page
    .locator("#monthTitleYear .summary-number-accessible")
    .innerText();
  await page.locator("#prevMonth").click();
  await page.locator(".month-title-month").waitFor({ state: "hidden" });
  assert.equal(
    await page
      .locator("#monthTitleYear .summary-number-accessible")
      .innerText(),
    "2025",
  );
  assert.equal(
    await page
      .locator("#calendar")
      .evaluate((el) => getComputedStyle(el).animationName),
    "motion-calendar-year",
  );
  assert.equal(
    await page
      .locator("#calendar")
      .evaluate((el) => el.style.getPropertyValue("--motion-direction")),
    "-12px",
  );
  await page.locator("#prevMonth").click();
  assert.equal(await page.locator("[data-year-date]").count(), 366);
  await page.locator('[data-year-date="2024-02-29"]').click();
  assert.equal(
    await page.locator("#calendar .selected").getAttribute("data-date"),
    "2024-02-29",
  );
  assert.equal(
    await page.locator("#monthTitle").getAttribute("aria-pressed"),
    "false",
  );
  await page.locator("#monthTitle").click();
  await page.locator("#nextMonth").click();
  await page.locator("#monthTitle").click();
  assert.equal(
    await page.locator("#calendar .selected").getAttribute("data-date"),
    "2024-02-29",
  );
  await page.locator("#todayButton").click();
  await page.locator("#monthTitle").click();
  await page.locator(".month-title-month").waitFor({ state: "hidden" });
  assert.equal(
    await page
      .locator("#monthTitleYear .summary-number-accessible")
      .innerText(),
    entered,
  );
  await page.keyboard.press("Tab");
  await page.locator('[data-year-date="2026-01-01"]').focus();
  assert.equal(await page.locator(".year-tooltip").count(), 0);
  await page.keyboard.press("Enter");
  assert.equal(
    await page.locator("#calendar .selected").getAttribute("data-date"),
    "2026-01-01",
  );
  await page.locator("#monthTitle").click();
  await page.evaluate(() => {
    const saved = WorkTimeApp.domain.state.defaultState();
    saved.days["2026-09-28"] = {
      actual: { start: "08:00", end: "20:30", nextDay: false },
      leaveMinutes: 60,
    };
    localStorage.setItem(WorkTimeApp.domain.state.KEY, JSON.stringify(saved));
  });
  await page.reload();
  await page.clock.runFor(1000);
  await page.locator("#monthTitle").click();
  assert.equal(
    await page
      .locator('[data-year-date="2026-09-28"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(94, 157, 122, 0.98)",
  );
  assert.equal(
    await page.locator(".year-markers,.year-leave,.year-rest").count(),
    0,
  );
  assert.equal(
    await page
      .locator('[data-year-date="2026-09-28"]')
      .evaluate((el) => getComputedStyle(el).color),
    "rgb(255, 255, 255)",
  );
  assert.equal(
    await page
      .locator('[data-year-date="2026-09-29"]')
      .evaluate((el) => getComputedStyle(el).color),
    "rgb(60, 74, 69)",
  );
  assert.equal(
    await page.locator("#yearLegend .year-scale>span").last().innerText(),
    "4 h",
  );
  await page.screenshot({
    path: require("node:path").join(
      require("./helpers/browser.cjs").results,
      "worktime-year-desktop.png",
    ),
  });
  await page.setViewportSize({ width: 1200, height: 800 });
  assert.equal(
    await page
      .locator("#calendar")
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
    2,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page
      .locator("#calendar")
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
    1,
  );
  assert.equal(await page.locator(".year-month").count(), 12);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.equal(
    await page.locator("#yearLegend .year-scale>span").last().innerText(),
    "4 h",
  );
  await page.screenshot({
    path: require("node:path").join(
      require("./helpers/browser.cjs").results,
      "worktime-year-mobile.png",
    ),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: navigation, leap date selection, return month, keyboard activation, 4/2/1 columns, mobile overflow, no page errors.",
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await runningBrowser?.close();
  process.exitCode = 1;
});

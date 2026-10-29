"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function verify() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const url = pathToFileURL(
    path.resolve(process.argv[2] || ".", "index.html"),
  ).href;
  const errors = [];
  const ready = (page) =>
    page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
  try {
    const initial = await browser.newPage();
    await initial.goto(url);
    await ready(initial);
    const state = await initial.evaluate(() => {
      const state = WorkTimeApp.domain.state.defaultState();
      for (const [date, start, end, kind] of [
        ["2026-10-01", "08:45", "19:00", "work"],
        ["2026-10-02", "08:50", "21:30", "work"],
        ["2026-10-03", "08:47", "18:15", "rest"],
        ["2026-09-16", "08:00", "18:00", "work"],
      ])
        state.days[date] = {
          kind,
          oa: {
            date,
            start,
            end,
            nextDay: false,
            status: "complete",
            source: "test",
            raw: "",
          },
        };
      for (const date of ["2026-10-04", "2026-10-29"])
        state.days[date] = {
          kind: "work",
          actual: {
            start: "08:00",
            end: "20:00",
            nextDay: false,
            effectiveMinutes: null,
          },
        };
      return state;
    });
    await initial.close();
    async function seeded(seed, touch = false) {
      const context = await browser.newContext({
        locale: "zh-CN",
        reducedMotion: "reduce",
        hasTouch: touch,
        viewport: { width: 1920, height: 1080 },
      });
      await context.route(/^https?:/, (route) => route.abort());
      await context.addInitScript((state) => {
        if (!sessionStorage.getItem("seeded")) {
          localStorage.setItem("worktime-local-v1", JSON.stringify(state));
          sessionStorage.setItem("seeded", "1");
        }
      }, seed);
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date("2026-10-28T04:00:00Z"));
      await page.goto(url);
      await ready(page);
      await page.locator("#analysisToggle").click();
      await page.locator("#analysisSidebar").waitFor({ state: "visible" });
      return { context, page };
    }
    const { page, context } = await seeded(state);
    const detail = page.locator("#analysisFocusDetail");
    assert.equal(await page.locator("#dayEditor").isVisible(), false);
    assert.match(await detail.textContent(), /10\/2.*21:30/s);
    assert.match(
      await page.locator("#analysisObservation").textContent(),
      /5 分钟\n下班时间相差 2.50 h/,
    );
    const record1 = page.locator('.analysis-range[data-date="2026-10-01"]');
    await record1.hover();
    assert.match(await detail.textContent(), /10\/1.*19:00/s);
    await page.locator("#analysisHeading").hover();
    assert.match(await detail.textContent(), /10\/2.*21:30/s);
    await record1.click();
    await page.locator("#analysisHeading").hover();
    assert.match(await detail.textContent(), /10\/1.*19:00/s);
    await page.locator('[data-analysis-focus="2026-10-02"]').click();
    assert.match(await detail.textContent(), /10\/2.*21:30/s);
    assert.equal(await page.locator("#analysisHover").isVisible(), true);
    assert.match(
      await page.locator("#analysisHover").textContent(),
      /10\/2.*21:30/s,
    );
    assert.equal(
      await page
        .locator('.analysis-range[data-date="2026-10-02"]')
        .evaluate((el) => el.classList.contains("is-selected")),
      true,
    );
    assert.equal(
      await page
        .locator(".analysis-day.is-selected, .analysis-day.is-sidebar-selected")
        .count(),
      0,
    );
    await page.locator("#analysisHeading").hover();
    assert.equal(
      await page.locator("#analysisHover").isVisible(),
      true,
      "Sidebar choice keeps its hover popup visible",
    );
    await page.locator('[data-analysis-focus="2026-10-02"]').focus();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#analysisHover").isVisible(), false);
    await page.locator('.analysis-range[data-date="2026-10-03"]').focus();
    await page.keyboard.press("Enter");
    await page.locator("#analysisHeading").click();
    assert.match(await detail.textContent(), /10\/3.*休息日加班/s);
    await page.locator("#analysisManual").check();
    await page.locator('.analysis-range[data-date="2026-10-29"]').click();
    await page.locator("#analysisHeading").hover();
    assert.match(await detail.textContent(), /未来手录计划.*不纳入已发生统计/s);
    assert.match(
      await page.locator("#analysisSidebarScope").textContent(),
      /有效记录4 天/,
    );
    await page.locator("#analysisManual").uncheck();
    assert.doesNotMatch(await detail.textContent(), /未来手录计划/);
    await page.locator("#settingsOpen").click();
    assert.equal(await page.locator("#analysisSidebar").isVisible(), false);
    await page.locator("#workSettingsCancel").click();
    assert.equal(await page.locator("#analysisSidebar").isVisible(), true);
    await page.locator("#prevMonth").click();
    assert.match(await detail.textContent(), /9\/16/);
    assert.match(
      await page.locator("#analysisObservation").textContent(),
      /仅有一天/,
    );
    await page.locator("#nextMonth").click();
    fs.mkdirSync("test-results/analysis-sidebar", { recursive: true });
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1440],
      [1000, 900],
      [390, 900],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(200);
      await page.locator("#analysisToggle").click();
      const footerHeight = await page
        .locator(".editor > .date-info-area")
        .evaluate((el) => el.getBoundingClientRect().height);
      await page.locator("#analysisToggle").click();
      for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
        await page.evaluate(
          (language) => WorkTimeApp.i18n.setLanguage(language),
          language,
        );
        await page.waitForFunction(
          (language) => WorkTimeApp.i18n.language === language,
          language,
        );
        assert.doesNotMatch(
          await page.locator("#analysisSidebar").textContent(),
          /analysis\.sidebar|undefined|NaN/,
        );
        assert.ok(
          Math.abs(
            (await page
              .locator(".editor > .date-info-area")
              .evaluate((el) => el.getBoundingClientRect().height)) -
              footerHeight,
          ) < 1,
          "Analysis keeps the bottom function area at its original height",
        );
        if (width >= 1920) {
          const headers = await page.evaluate(() =>
            [
              document.querySelector(".panel-head"),
              document.querySelector(".analysis-sidebar-header"),
            ].map((el) => el.getBoundingClientRect().height),
          );
          assert.ok(
            Math.abs(headers[0] - headers[1]) < 1,
            "Sidebar header matches the shared column header height",
          );
          assert.equal(
            await page
              .locator(".analysis-sidebar-header")
              .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
            true,
          );
        }
        assert.equal(
          await page
            .locator("#analysisSidebar")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          true,
          `${language}: ${width}px sidebar fits`,
        );
        if (width >= 1920)
          assert.equal(
            await page
              .locator(".editor-content")
              .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
            true,
            `${language}: ${width}px sidebar needs no scrolling: ` +
              JSON.stringify(
                await page.locator(".editor-content").evaluate((el) => ({
                  client: el.clientHeight,
                  scroll: el.scrollHeight,
                  sidebar: document
                    .getElementById("analysisSidebar")
                    .getBoundingClientRect().height,
                  font: getComputedStyle(el).fontSize,
                })),
              ),
          );
      }
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      if (width >= 1920) {
        assert.equal(
          await page
            .locator("#analysisPage")
            .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
          true,
        );
        await page
          .locator(".workspace")
          .screenshot({ path: `test-results/analysis-sidebar/${width}.png` });
      }
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.reload();
    await ready(page);
    await page.locator("#analysisSidebar").waitFor({ state: "visible" });
    await page.locator("#analysisToggle").click();
    assert.equal(await page.locator("#analysisSidebar").isVisible(), false);
    assert.equal(await page.locator("#dayEditor").isVisible(), true);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(600);
    await page.evaluate(() =>
      document.getElementById("analysisToggle").click(),
    );
    assert.ok(
      (await page
        .locator("#dayForm")
        .evaluate((el) => el.getAnimations().length)) > 0,
      "Outgoing editor fades and moves",
    );
    await page.locator("#analysisSidebar").waitFor({ state: "visible" });
    assert.ok(
      (await page
        .locator("#analysisSidebar > .analysis-sidebar-section")
        .first()
        .evaluate((el) => el.getAnimations().length)) > 0,
      "Incoming analysis content fades and moves",
    );
    assert.equal(
      await page
        .locator(".analysis-sidebar-header")
        .evaluate((el) => el.getAnimations().length),
      0,
      "Header stays stationary",
    );
    await page.waitForTimeout(600);
    await page.evaluate(() =>
      document.getElementById("analysisToggle").click(),
    );
    assert.ok(
      (await page
        .locator("#analysisSidebar > .analysis-sidebar-section")
        .first()
        .evaluate((el) => el.getAnimations().length)) > 0,
    );
    await page.locator("#analysisSidebar").waitFor({ state: "hidden" });
    assert.ok(
      (await page
        .locator("#dayForm")
        .evaluate((el) => el.getAnimations().length)) > 0,
      "Editor animates back in",
    );
    await page.waitForTimeout(600);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#analysisToggle").click();
    assert.equal(
      await page
        .locator("#analysisSidebar > .analysis-sidebar-section")
        .first()
        .evaluate((el) => el.getAnimations().length),
      0,
    );
    await context.close();
    const touched = await seeded(state, true);
    await touched.page.locator('.analysis-range[data-date="2026-10-01"]').tap();
    assert.match(
      await touched.page.locator("#analysisFocusDetail").textContent(),
      /10\/1.*19:00/s,
    );
    await touched.context.close();
    const empty = await seeded({ ...state, days: {} });
    assert.match(
      await empty.page.locator("#analysisObservation").textContent(),
      /暂无完整工作日/,
    );
    assert.equal(await empty.page.locator("[data-analysis-focus]").count(), 0);
    await empty.context.close();
    const overnight = structuredClone(state);
    overnight.days = {
      "2026-10-02": {
        ...state.days["2026-10-02"],
        oa: { ...state.days["2026-10-02"].oa, end: "00:30", nextDay: true },
      },
    };
    const night = await seeded(overnight);
    assert.match(
      await night.page.locator("#analysisFocusDetail").textContent(),
      /次日00:30/,
    );
    assert.equal(
      await night.page
        .locator("#analysisFocusDetail")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      true,
    );
    await night.context.close();
    const restOnly = await seeded({
      ...state,
      days: { "2026-10-03": state.days["2026-10-03"] },
    });
    assert.match(
      await restOnly.page.locator("#analysisObservation").textContent(),
      /暂无完整工作日/,
    );
    assert.match(
      await restOnly.page.locator("#analysisFocusDetail").textContent(),
      /休息日加班/,
    );
    assert.match(
      await restOnly.page.locator("#analysisSidebarScope").textContent(),
      /有效记录1 天/,
    );
    await restOnly.context.close();
    assert.deepEqual(errors, []);
    console.log(
      "Linked routine sidebar: real summaries, hover/pin/keyboard/touch, filters, navigation, settings, refresh and six-language responsive layout verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

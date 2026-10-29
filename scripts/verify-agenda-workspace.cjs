"use strict";
const setScheduleRange = require("./lib/agenda-test-range.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1480, height: 1000 },
    locale: "zh-CN",
    reducedMotion: "reduce",
  });
  const errors = [];
  let accept = true;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => (accept ? dialog.accept() : dialog.dismiss()));
  await page.route(/^https?:/, (route) => route.abort());
  try {
    // The cross-day fixture includes Oct 27 and the following click selects Oct 28.
    // Keep "today" stable rather than changing the expected list at midnight.
    await page.clock.setFixedTime(new Date("2026-10-27T04:00:00Z"));
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    for (const motion of ["reduce", "no-preference"]) {
      await page.emulateMedia({ reducedMotion: motion });
      for (const target of [
        "agendaMode",
        "analysisToggle",
        "monthTitle",
        "nextMonth",
        "prevMonth",
        "todayButton",
      ]) {
        await page.locator("#importOpen").click();
        await page.locator("#pasteText").fill("OA draft");
        await page.locator("#" + target).click();
        assert.equal(
          await page.locator("#importDialog").isVisible(),
          false,
          `${target} closes OA (${motion})`,
        );
        assert.equal(
          await page
            .locator(".summary-sidebar")
            .evaluate((sidebar) => sidebar.classList.contains("is-oa-open")),
          false,
          `${target} exits OA before rendering the destination (${motion})`,
        );
        if (["agendaMode", "analysisToggle", "monthTitle"].includes(target)) {
          if (motion === "no-preference") await page.waitForTimeout(700);
          await page.locator("#" + target).click();
          if (motion === "no-preference") await page.waitForTimeout(700);
        }
        await page.locator("#importOpen").click();
        assert.equal(await page.locator("#pasteText").inputValue(), "");
        await page.locator("#importOpen").click();
      }
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [1000, 1280, 1480, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      const before = await page.locator(".summary-sidebar").boundingBox();
      const rightBefore = await page
        .locator(".workspace > .editor")
        .boundingBox();
      await page.locator("#agendaMode").click();
      const after = await page.locator(".summary-sidebar").boundingBox();
      if (width > 1150)
        assert.ok(
          Math.abs(after.width - before.width) < 1,
          `Left sidebar keeps its width when switching modes at ${width}`,
        );
      assert.ok(
        Math.abs(
          (await page.locator(".workspace > .editor").boundingBox()).width -
            rightBefore.width,
        ) < 1,
        `Right sidebar keeps its width when switching modes at ${width}`,
      );
      await page.locator("#agendaViewToggle").click();
      if (width > 1150)
        assert.ok(
          Math.abs(
            (await page.locator(".summary-sidebar").boundingBox()).width -
              before.width,
          ) < 1,
          "Changing calendar view cannot resize the left sidebar",
        );
      assert.ok(
        Math.abs(
          (await page.locator(".workspace > .editor").boundingBox()).width -
            rightBefore.width,
        ) < 1,
        "Changing calendar view cannot resize the right sidebar",
      );
      while (
        (await page.locator("#agendaViewToggle").getAttribute("data-view")) !==
        "month"
      )
        await page.locator("#agendaViewToggle").click();
      await page.locator("#agendaMode").click();
    }
    await page.setViewportSize({ width: 1480, height: 1000 });
    await page.locator("#agendaMode").click();
    assert.equal(await page.locator("#agendaForm").isVisible(), false);
    assert.equal(
      await page.locator("#agendaEditor #agendaList").isVisible(),
      true,
    );
    assert.equal(await page.locator("#agendaSummary #agendaList").count(), 0);
    assert.equal(await page.locator("#agendaMemo").isVisible(), true);
    assert.equal(await page.locator("#batchToggle").isVisible(), false);
    assert.equal(await page.locator(".date-info-area").isVisible(), false);
    const today = await page.evaluate(() =>
      WorkTimeApp.domain.time.businessDate(new Date()),
    );
    const todayCard = page.locator(
      `#calendar .day[data-date="${today}"] .day-select`,
    );
    await page.locator("#agendaNew").click();
    await todayCard.click();
    assert.equal(await page.locator("#agendaForm").isVisible(), false);
    assert.equal(await page.locator("#agendaList").isVisible(), true);
    await page.locator("#agendaNew").click();
    await page.locator("#agendaTitle").fill("未保存的新安排");
    accept = false;
    await todayCard.click();
    assert.equal(await page.locator("#agendaForm").isVisible(), true);
    assert.equal(
      await page.locator("#agendaTitle").inputValue(),
      "未保存的新安排",
    );
    accept = true;
    await todayCard.click();
    assert.equal(await page.locator("#agendaForm").isVisible(), false);
    assert.equal(await page.locator("#agendaList").isVisible(), true);
    const create = async (title, date = today, endDate = "") => {
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill(title);
      await page.locator("#agendaScheduleOpen").click();
      await setScheduleRange(page, date);
      if (endDate) {
        await page.locator("#agendaEndDateInput").fill(endDate);
      }
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.waitForFunction(
        () => !document.querySelector("#agendaList").closest("[hidden]"),
      );
      assert.equal(await page.locator("#agendaForm").isVisible(), false);
    };
    for (let i = 0; i < 5; i++) await create("当天安排 " + i);
    await create("跨天安排", "2026-10-23", "2026-10-27");
    await page.locator("#todayButton").click();
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 6);
    assert.equal(
      await page.locator(".agenda-overview-today .agenda-summary-link").count(),
      3,
    );
    await page.locator('[data-agenda-expand="today"]').click();
    assert.equal(
      await page.locator(".agenda-overview-today .agenda-summary-link").count(),
      6,
    );
    const overview = await page.locator("#agendaOverview").textContent();
    await page
      .locator('#calendar .day[data-date="2026-10-28"] .day-select')
      .click();
    assert.equal(await page.locator("#agendaOverview").textContent(), overview);
    await page
      .locator(".agenda-summary-link")
      .filter({ hasText: "当天安排 0" })
      .click();
    assert.equal(await page.locator("#agendaTitle").inputValue(), "当天安排 0");
    await page.locator("#agendaTitle").fill("未保存修改");
    accept = false;
    await page.locator("#nextMonth").click();
    assert.equal(await page.locator("#agendaTitle").inputValue(), "未保存修改");
    await page.locator("#agendaMode").click();
    assert.equal(await page.locator("#agendaForm").isVisible(), true);
    await page.locator("#agendaBack").click();
    assert.equal(await page.locator("#agendaForm").isVisible(), true);
    accept = true;
    await page.locator("#agendaBack").click();
    await page.locator("#agendaList .agenda-complete").first().click();
    await page.locator('[data-agenda-status-choice="completed"]').click();
    await page.waitForFunction(() =>
      document.querySelector("#agendaList .is-complete"),
    );
    assert.equal(await page.locator(".agenda-footer-progress").count(), 0);
    await page.locator("#agendaList").evaluate((node) => {
      node.style.maxHeight = "180px";
      node.scrollTop = 100;
    });
    const scrollBefore = await page
      .locator("#agendaList")
      .evaluate((node) => node.scrollTop);
    // Preserve the fixture's scroll position; Playwright's click may first scroll
    // this item into view, changing the baseline before the application runs.
    await page
      .locator("#agendaList .agenda-item-copy")
      .filter({ hasText: "跨天安排" })
      .evaluate((node) => node.click());
    assert.equal(
      await page.locator("#calendar > .day.selected").getAttribute("data-date"),
      "2026-10-27",
      "Editing a spanning item preserves the date whose list was opened",
    );
    await page.locator("#agendaCancel").click();
    assert.equal(
      await page.locator("#agendaList").evaluate((node) => node.scrollTop),
      scrollBefore,
    );
    await page
      .locator("#agendaList")
      .evaluate((node) => node.style.removeProperty("max-height"));
    await page.locator("#agendaNew").click();
    await page.locator("#agendaTitle").fill("辅助面板保留草稿");
    await page.locator("#date-tab-notifications").click();
    assert.equal(await page.locator(".date-info-area").isVisible(), true);
    assert.equal(await page.locator("#agendaEditor").isVisible(), true);
    assert.equal(await page.locator("#agendaTitle").isVisible(), true);
    const grip = page.locator("#agendaDrawerGrip");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await grip.hover();
    await page.waitForFunction(() => {
      const grip = document.querySelector("#agendaDrawerGrip");
      const left = getComputedStyle(grip, "::before"),
        right = getComputedStyle(grip, "::after");
      return (
        left.transitionDuration === "0.22s" &&
        new DOMMatrix(left.transform).b > 0.3 &&
        new DOMMatrix(right.transform).b < -0.3
      );
    });
    await grip.click();
    await page.locator(".date-info-area").waitFor({ state: "hidden" });
    assert.equal(
      await page
        .locator("#date-tab-notifications")
        .getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      await page
        .locator("#date-tab-notifications")
        .evaluate((node) => node === document.activeElement),
      true,
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#date-tab-notifications").click();
    await grip.focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".date-info-area").isVisible(), false);
    await page.locator("#date-tab-notifications").click();
    await page.locator("#date-tab-notifications").click();
    assert.equal(await page.locator(".date-info-area").isVisible(), false);
    await page.locator("#date-tab-notifications").click();
    await page.locator("#date-tab-history").click();
    assert.equal(await page.locator(".date-info-area").isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator(".date-info-area").isVisible(),
      true,
      "Escape outside the drawer must not dismiss it",
    );
    assert.equal(
      await page.locator("#agendaDrawerTitle, #agendaAuxiliaryBack").count(),
      0,
    );
    await page.locator("#agendaDate").click();
    assert.equal(await page.locator(".date-info-area").isVisible(), false);
    assert.equal(
      await page.locator("#agendaTitle").inputValue(),
      "辅助面板保留草稿",
    );
    await page.locator("#agendaCancel").click();
    await page.locator("#pageSettingsOpen").click();
    assert.equal(await page.locator("#pageSettingsPane").isVisible(), true);
    await page.locator("#personalSettingsCancel").click();
    assert.equal(await page.locator("#agendaList").isVisible(), true);
    await page.locator("#agendaMemo").fill("全局备忘始终展开");
    await page.waitForFunction(() =>
      document
        .querySelector("#agendaMemoStatus")
        .textContent.includes("已保存"),
    );
    for (const view of ["week", "fortnight", "threeweek", "month"]) {
      await page.locator("#agendaViewToggle").click();
      assert.equal(
        await page.locator("#agendaViewToggle").getAttribute("data-view"),
        view,
      );
    }
    fs.mkdirSync(path.resolve("artifacts"), { recursive: true });
    for (const width of [1480, 1000, 850, 540, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({
        path: path.resolve(`artifacts/agenda-workspace-${width}.png`),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
        `No horizontal overflow at ${width}`,
      );
      assert.equal(await page.locator("#agendaList").isVisible(), true);
      await page.locator("#date-tab-notifications").click();
      const geometry = await page.evaluate(() => {
        const box = (selector) =>
          document.querySelector(selector).getBoundingClientRect();
        const drawer = box(".date-info-area"),
          tabs = box(".notification-tabs"),
          heading = box(".agenda-heading");
        return (
          drawer.top > heading.bottom &&
          Math.abs(drawer.bottom - tabs.top) <= 2 &&
          !!document
            .elementFromPoint(
              drawer.left + drawer.width / 2,
              drawer.top + drawer.height / 2,
            )
            ?.closest(".date-info-area")
        );
      });
      assert.equal(
        geometry,
        true,
        `Drawer leaves heading visible, opens above the tabs at ${width}`,
      );
      const drawerSize = await page.evaluate(() => {
        const area = document.querySelector(".date-info-area"),
          editor = document.querySelector(".workspace > .editor");
        const grip = getComputedStyle(
          document.querySelector("#agendaDrawerGrip"),
        );
        const rem = parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        );
        const originalHeight =
          innerWidth > 1150
            ? Math.max((editor.clientHeight * 7) / 24, 18.514286 * rem + 1)
            : 260;
        return {
          height: area.getBoundingClientRect().height,
          expected: originalHeight + 20,
          gripWidth: grip.width,
          gripHeight: grip.height,
          marginTop: grip.marginTop,
          marginBottom: grip.marginBottom,
        };
      });
      assert.ok(
        Math.abs(drawerSize.height - drawerSize.expected) < 2,
        `Original information height plus 20px grip strip at ${width}`,
      );
      assert.equal(drawerSize.gripWidth, "64px");
      assert.equal(drawerSize.gripHeight, "20px");
      assert.equal(drawerSize.marginTop, "0px");
      assert.equal(drawerSize.marginBottom, "0px");
      await page.screenshot({
        path: path.resolve(`artifacts/agenda-drawer-${width}.png`),
        fullPage: true,
      });
      await page
        .locator(".date-info-area")
        .click({ position: { x: 10, y: 10 } });
      assert.equal(await page.locator(".date-info-area").isVisible(), true);
      await page.locator("#agendaDate").click();
      assert.equal(await page.locator(".date-info-area").isVisible(), false);
      await page.locator("#date-tab-notifications").click();
      await page.locator(".date-info-area").focus();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".date-info-area").isVisible(), false);
      if (width <= 1150) {
        await page.locator("#agendaOverviewOpen").click();
        assert.equal(await page.locator("#agendaMemo").isVisible(), true);
        assert.equal(
          await page.locator("#agendaMemo").inputValue(),
          "全局备忘始终展开",
        );
        await page.keyboard.press("Escape");
        assert.equal(
          await page
            .locator("#agendaOverviewOpen")
            .evaluate((node) => node === document.activeElement),
          true,
        );
      }
    }
    await page.setViewportSize({ width: 1480, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const opening = await page.evaluate(async () => {
      const area = document.querySelector(".date-info-area");
      document.querySelector("#date-tab-notifications").click();
      const samples = [],
        start = performance.now();
      while (performance.now() - start < 460) {
        samples.push(area.getBoundingClientRect().top);
        await new Promise(requestAnimationFrame);
      }
      const style = getComputedStyle(area),
        tabs = getComputedStyle(document.querySelector(".notification-tabs"));
      return {
        samples,
        borderLeft: style.borderLeftWidth,
        borderRight: style.borderRightWidth,
        surface: style.backgroundColor,
        tabSurface: tabs.backgroundColor,
      };
    });
    assert.equal(opening.borderLeft, "0px");
    assert.equal(opening.borderRight, "0px");
    assert.equal(opening.surface, opening.tabSurface);
    assert.ok(
      opening.samples[0] - opening.samples.at(-1) > 150,
      "Drawer slides up from below instead of fading in at full size",
    );
    assert.ok(
      opening.samples.every(
        (top, i) => !i || top <= opening.samples[i - 1] + 1,
      ),
      "Opening eases upward without jumping backward",
    );
    const interrupted = await page.evaluate(async () => {
      const area = document.querySelector(".date-info-area"),
        tab = document.querySelector("#date-tab-notifications");
      tab.click();
      const closingVisible = getComputedStyle(area).display !== "none";
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const before = area.getBoundingClientRect().top;
      tab.click();
      const after = area.getBoundingClientRect().top;
      return { closingVisible, delta: Math.abs(before - after) };
    });
    assert.equal(
      interrupted.closingVisible,
      true,
      "Closing also animates before hiding the drawer",
    );
    assert.ok(
      interrupted.delta < 2,
      "Reopening during close continues from the current position",
    );
    await page.waitForFunction(
      () => !document.querySelector(".date-info-area").getAnimations().length,
    );
    await page.locator("#date-tab-notifications").click();
    await page.locator(".date-info-area").waitFor({ state: "hidden" });
    assert.equal(await page.locator(".agenda-footer-progress").count(), 0);
    for (let mode = 0; mode < 2; mode++) {
      const monthModeStable = await page.evaluate(async () => {
        const title = document.querySelector("#monthTitle");
        const nodes = [
          title,
          ...title.querySelectorAll(
            ":scope > .month-title-year, :scope > .month-title-month",
          ),
        ];
        const read = () =>
          nodes.flatMap((node) => {
            const r = node.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height];
          });
        const context = () => ({
          pageX: scrollX,
          groupX: document.querySelector(".month-controls").scrollLeft,
          groupWidth: document.querySelector(".month-controls").clientWidth,
          groupScrollWidth:
            document.querySelector(".month-controls").scrollWidth,
          wrapX: document.querySelector(".wrap").getBoundingClientRect().x,
        });
        const before = context();
        const baseline = read();
        document.querySelector("#agendaMode").click();
        const start = performance.now();
        while (performance.now() - start < 450) {
          const current = read();
          if (
            current.some(
              (value, index) => Math.abs(value - baseline[index]) > 0.6,
            )
          )
            return {
              stable: false,
              baseline,
              current,
              before,
              after: context(),
            };
          await new Promise(requestAnimationFrame);
        }
        return { stable: true };
      });
      assert.equal(
        monthModeStable.stable,
        true,
        "Month mode header: " + JSON.stringify(monthModeStable),
      );
    }
    // A single-digit month used to shrink its slot when the week suffix appeared.
    await page.locator("#prevMonth").click();
    assert.ok(
      (await page.locator("#monthTitleMonth .number-roll-down").count()) > 0,
      "Agenda month navigation preserves the shared rolling digits",
    );
    await page.waitForFunction(
      () =>
        !document.querySelector(
          "#monthTitleMonth .number-roll-up, #monthTitleMonth .number-roll-down",
        ),
    );
    for (const view of ["week", "fortnight", "threeweek", "month"]) {
      const titleMotion = await page.evaluate(async () => {
        const title = document.querySelector("#monthTitle");
        const slots = [
          ...title.querySelectorAll(
            ":scope > .month-title-year, :scope > .month-title-month",
          ),
        ];
        const baseline = slots.map((node) => {
          const r = node.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        });
        const widths = [title.getBoundingClientRect().width];
        const weekTops = [];
        document.querySelector("#agendaViewToggle").click();
        const start = performance.now();
        let stable = true,
          rolling = false;
        while (performance.now() - start < 480) {
          slots.forEach((node, index) => {
            const r = node.getBoundingClientRect();
            if (
              [r.x, r.y, r.width, r.height].some(
                (value, i) => Math.abs(value - baseline[index][i]) > 0.6,
              )
            )
              stable = false;
            if (node.querySelector(".number-roll-up, .number-roll-down"))
              rolling = true;
          });
          widths.push(title.getBoundingClientRect().width);
          const week = title.querySelector(
            ".month-title-week:not([hidden]) .summary-number",
          );
          if (week) weekTops.push(week.getBoundingClientRect().top);
          await new Promise(requestAnimationFrame);
        }
        return {
          stable,
          rolling,
          widths,
          weekTops,
          view: document.querySelector("#agendaViewToggle").dataset.view,
        };
      });
      assert.equal(titleMotion.view, view);
      assert.equal(
        titleMotion.stable,
        true,
        `Year and month stay stationary while switching to ${view}`,
      );
      assert.equal(titleMotion.rolling, false, "Only the week suffix animates");
      if (titleMotion.weekTops.length)
        assert.ok(
          Math.max(...titleMotion.weekTops) -
            Math.min(...titleMotion.weekTops) <
            0.6,
          "Week text stays on its baseline from the first frame to the last",
        );
      const start = titleMotion.widths[0],
        end = titleMotion.widths.at(-1);
      // Fortnight and three-week suffixes can have the same measured width.
      if (Math.abs(start - end) > 2)
        assert.ok(
          titleMotion.widths.some(
            (width) =>
              width > Math.min(start, end) + 1 &&
              width < Math.max(start, end) - 1,
          ),
          "Title width changes gradually",
        );
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#agendaMode").click();
    assert.equal(await page.locator("#dayForm").isVisible(), true);
    assert.equal(await page.locator(".date-info-area").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(
      "Agenda workspace: day list/editor, global overview, drafts, memo, auxiliary navigation and responsive layouts verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

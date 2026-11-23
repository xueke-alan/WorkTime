"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext({ locale: "zh-CN" });
    await context.addInitScript(() =>
      localStorage.setItem("worktime.onboarding.v1", "dismissed"),
    );
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
    const url = pathToFileURL(
      path.resolve(process.argv[2] || ".", "index.html"),
    ).href;
    const ready = () =>
      page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
    await page.goto(url);
    await ready();
    const fixture = await page.evaluate(() => {
      const state = WorkTimeApp.domain.state.defaultState();
      const oa = (date, start = "08:00", end = "17:30") => ({
        date,
        start,
        end,
        nextDay: false,
        status: end ? "complete" : "pending",
        source: "test",
        raw: "",
      });
      state.days = {
        "2026-10-11": { oa: oa("2026-10-11"), plannedOvertime: true },
        "2026-10-17": { oa: oa("2026-10-17", "08:00", "") },
        "2026-10-18": { oa: oa("2026-10-18", "08:00", "08:00") },
        "2026-10-24": { plannedOvertime: true },
        "2026-10-25": {
          actual: { start: "08:00", end: "17:30", nextDay: false },
        },
        "2026-10-10": { oa: oa("2026-10-10") },
        "2026-10-01": { oa: oa("2026-10-01") },
      };
      return state;
    });
    await context.close();
    const seeded = await browser.newContext({ locale: "zh-CN" });
    await seeded.route(/^https?:/, (route) => route.abort());
    await seeded.addInitScript((state) => {
      localStorage.setItem("worktime.onboarding.v1", "dismissed");
      localStorage.setItem("worktime-local-v1", JSON.stringify(state));
    }, fixture);
    const view = await seeded.newPage();
    view.on("pageerror", (error) => errors.push(error.message));
    await view.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
    await view.goto(url);
    await view.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const counts = await view.evaluate((state) => {
      return WorkTimeApp.domain.statistics.selectOvertimeRequirement(
        state,
        "2026-10-01",
        "2026-10-31",
      );
    }, fixture);
    assert.deepEqual(counts, {
      actualDays: 3,
      plannedDays: 1,
      totalDays: 4,
      tier: 4,
      targetMinutes: fixture.overtimeRequirements[4],
    });
    assert.equal(
      await view.locator("#targetCounts").textContent(),
      "休息日加班：4 d",
    );
    const card = (date) => view.locator(`.day[data-date="${date}"]`);
    for (const date of ["2026-10-11", "2026-10-25", "2026-10-01"]) {
      assert.equal(
        await card(date).locator(".pill.overtime").textContent(),
        "加班",
      );
      assert.equal(await card(date).locator(".overtime-plan").count(), 0);
    }
    for (const date of ["2026-10-17", "2026-10-18", "2026-10-10"])
      assert.equal(await card(date).locator(".pill.overtime").count(), 0);
    assert.equal(await card("2026-10-24").locator(".overtime-plan").count(), 1);
    assert.equal(
      await card("2026-10-24").locator(".day-planned-label").textContent(),
      "申报加班时长",
    );
    assert.equal(
      await card("2026-10-24").locator(".day-planned-hours").textContent(),
      "—",
      "A missing reference average is not guessed",
    );
    assert.equal(
      await card("2026-10-24").locator(".worktime-corner").count(),
      0,
    );
    assert.equal(
      await card("2026-10-25").locator(".day-planned-hours").count(),
      0,
    );
    assert.equal(
      await card("2026-10-11").locator(".record-source-dot.oa").count(),
      1,
    );
    const plannedHeight = await card("2026-10-24").evaluate((node) => {
      const summary = node.querySelector(".day-planned-summary");
      const label = node.querySelector(".day-planned-label"),
        value = summary.querySelector(".day-planned-hours");
      return {
        position: getComputedStyle(summary).position,
        labelSize: parseFloat(getComputedStyle(label).fontSize),
        labelHeight: label.getBoundingClientRect().height,
        labelLineHeight: parseFloat(getComputedStyle(label).lineHeight),
        labelShrink: getComputedStyle(label).flexShrink,
        numberSize: parseFloat(getComputedStyle(value).fontSize),
        labelDisplay: getComputedStyle(label).display,
        labelInTimeRow: label.closest(".daytime") !== null,
        leftAligned: getComputedStyle(summary).alignItems === "flex-start",
        valueBelowLabel:
          value.getBoundingClientRect().top >=
          label.getBoundingClientRect().bottom,
        hasTooltip: label.hasAttribute("title") || value.hasAttribute("title"),
        valueInsideCard:
          value.getBoundingClientRect().bottom <=
          node.getBoundingClientRect().bottom,
      };
    });
    assert.equal(plannedHeight.position, "static");
    assert.ok(plannedHeight.labelInTimeRow);
    assert.ok(plannedHeight.leftAligned);
    assert.ok(plannedHeight.valueBelowLabel);
    assert.equal(plannedHeight.hasTooltip, false);
    assert.ok(plannedHeight.labelSize >= 12);
    assert.equal(plannedHeight.labelShrink, "0");
    assert.ok(
      plannedHeight.labelHeight >= plannedHeight.labelLineHeight - 1,
      "The declaration title must retain its complete line box",
    );
    assert.ok(plannedHeight.numberSize >= 12);
    assert.notEqual(plannedHeight.labelDisplay, "none");
    assert.ok(
      plannedHeight.valueInsideCard,
      "The declaration value fits inside its card",
    );
    const button = view.locator("#plannedOvertimeToggle");
    const preview = view.locator("#dayPreview .preview-day");
    for (const date of [
      "2026-10-11",
      "2026-10-01",
      "2026-10-25",
      "2026-10-24",
    ]) {
      await card(date).click();
      assert.equal(
        await preview.textContent(),
        "加班",
        date + " overtime preview",
      );
    }
    await card("2026-10-24").click();
    await button.click();
    await view.waitForFunction(
      () =>
        document.querySelector("#dayPreview .preview-day").textContent ===
        "休息日",
    );
    assert.equal(await preview.textContent(), "休息日");
    await button.click();
    await view.waitForFunction(
      () =>
        document.querySelector("#dayPreview .preview-day").textContent ===
        "加班",
    );
    assert.equal(await preview.textContent(), "加班");
    for (const date of ["2026-10-11", "2026-10-01"]) {
      await card(date).click();
      assert.equal(await button.isDisabled(), true);
      assert.equal(await button.textContent(), "加班");
      assert.equal(await button.getAttribute("aria-label"), "加班");
      assert.equal(await button.getAttribute("aria-pressed"), "false");
    }
    for (const date of ["2026-10-17", "2026-10-18"]) {
      await card(date).click();
      assert.equal(await button.isDisabled(), true);
      assert.equal(
        await view
          .locator("#plannedOvertimeArea")
          .evaluate((node) => node.inert),
        true,
      );
      assert.equal(await button.textContent(), "计划加班");
    }
    await card("2026-10-25").click();
    assert.equal(await button.isEnabled(), true);
    await card("2026-10-24").click();
    assert.equal(await button.isEnabled(), true);
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    await view.emulateMedia({ reducedMotion: "no-preference" });
    await view.waitForFunction(
      () => document.documentElement.dataset.reducedMotion === "false",
    );
    // Both workdays and past rest days must retain the outgoing action until
    // its fade completes, without moving the reset/source buttons.
    for (const date of ["2026-10-26", "2026-10-18"]) {
      await card("2026-10-24").click();
      await view.waitForFunction(
        () =>
          getComputedStyle(document.getElementById("plannedOvertimeArea"))
            .opacity === "1",
      );
      const fade = await view.evaluate(async (date) => {
        const area = document.getElementById("plannedOvertimeArea"),
          reset = document.getElementById("clearManual"),
          before = reset.getBoundingClientRect();
        document.querySelector(`.day[data-date="${date}"]`).click();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        const animation = area
          .getAnimations()
          .find((animation) => animation.transitionProperty === "opacity");
        if (!animation) return null;
        animation.pause();
        animation.currentTime = 90;
        const middle = getComputedStyle(area),
          opacity = Number(middle.opacity),
          visibility = middle.visibility;
        for (const transition of area.getAnimations()) transition.finish();
        const after = reset.getBoundingClientRect();
        return {
          opacity,
          visibility,
          hidden: getComputedStyle(area).visibility,
          inert: area.inert,
          stationary: before.x === after.x && before.y === after.y,
        };
      }, date);
      assert.ok(fade, date + " starts an exit fade");
      assert.ok(fade.opacity > 0 && fade.opacity < 1);
      assert.equal(fade.visibility, "visible");
      assert.equal(fade.hidden, "hidden");
      assert.equal(fade.inert, true);
      assert.equal(fade.stationary, true);
    }
    await card("2026-10-31").click();
    await view.emulateMedia({ reducedMotion: "no-preference" });
    await view.waitForFunction(
      () => document.documentElement.dataset.reducedMotion === "false",
    );
    await button.click();
    await view.waitForFunction(() =>
      document
        .querySelector('.day[data-date="2026-10-31"]')
        .classList.contains("planned-overtime-day"),
    );
    await view.waitForFunction(
      () => !document.querySelector(".calendar-artwork-outgoing"),
    );
    assert.equal(
      await card("2026-10-31").evaluate(
        (node) => getComputedStyle(node, "::before").opacity,
      ),
      "0.24",
      "Release the reveal at the illustration's resting opacity",
    );
    // A selected date becomes unavailable when the business day advances.
    await view.clock.setFixedTime(new Date("2026-10-24T04:00:00Z"));
    await view.evaluate(() => window.dispatchEvent(new Event("focus")));
    await card("2026-10-24").click();
    assert.equal(await button.isEnabled(), true, "Today supports planning");
    assert.match(await view.locator("#targetCounts").textContent(), /5 d/);
    assert.equal(await card("2026-10-24").locator(".overtime-plan").count(), 1);
    await button.focus();
    await view.clock.setFixedTime(new Date("2026-10-25T04:00:00Z"));
    await view.evaluate(() => window.dispatchEvent(new Event("focus")));
    assert.equal(await button.isDisabled(), true);
    assert.equal(
      await card("2026-10-24").locator(".overtime-plan").count(),
      0,
      "The planned tag expires after its date",
    );
    assert.equal(
      await card("2026-10-24").evaluate((node) =>
        node.classList.contains("planned-overtime-day"),
      ),
      false,
    );
    assert.equal(
      await card("2026-10-25").locator(".pill.overtime").count(),
      1,
      "Actual overtime remains visible",
    );
    await view.waitForFunction(() => {
      const style = getComputedStyle(
        document.getElementById("plannedOvertimeArea"),
      );
      return style.visibility === "hidden" && style.opacity === "0";
    });
    assert.deepEqual(
      await view.locator("#plannedOvertimeArea").evaluate((node) => ({
        inert: node.inert,
        hidden: node.getAttribute("aria-hidden"),
        opacity: getComputedStyle(node).opacity,
        focused: node.contains(document.activeElement),
      })),
      { inert: true, hidden: "true", opacity: "0", focused: false },
    );
    await view.evaluate(() =>
      document.getElementById("plannedOvertimeToggle").onclick(),
    );
    assert.equal(
      await button.getAttribute("aria-pressed"),
      "false",
      "The expired plan is deleted and cannot be reactivated",
    );
    assert.match(await view.locator("#targetCounts").textContent(), /4 d/);
    await card("2026-10-25").click();
    assert.equal(
      await button.isEnabled(),
      true,
      "Today is restored immediately",
    );
    assert.deepEqual(errors, []);
    await seeded.close();
    console.log(
      "Rest-day OA/manual overtime tags, planned tags, incomplete records and makeup workdays verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

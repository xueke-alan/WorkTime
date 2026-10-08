"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, results } = require("./helpers/browser.cjs");
let browser;
(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage({
    reducedMotion: "reduce",
    timezoneId: "Asia/Shanghai",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await page.clock.install({ time: new Date("2026-10-08T16:30:00+08:00") });
  await page.goto(pathToFileURL(path.resolve(__dirname, "../index.html")).href);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading"),
  );
  await page.locator("#date-tab-countdown").click();
  const toggle = page.locator("#countdownFocusToggle");
  for (const state of ["default", "hover", "focus"]) {
    if (state === "hover") await toggle.hover();
    if (state === "focus") await toggle.focus();
    assert.deepEqual(
      await toggle.evaluate((button) => {
        const style = getComputedStyle(button);
        return [
          style.borderTopWidth,
          style.backgroundColor,
          style.boxShadow,
          style.outlineWidth,
        ];
      }),
      ["0px", "rgba(0, 0, 0, 0)", "none", "0px"],
      `unframed button in ${state} state before entering focus mode`,
    );
  }
  assert.equal(
    await toggle.locator("use").getAttribute("href"),
    "#ms-expand-content",
  );
  for (const [width, height] of [
    [1600, 1000],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await toggle.scrollIntoViewIfNeeded();
    const original = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    assert.equal(await toggle.locator("use").getAttribute("href"), "#ms-hide");
    await page.mouse.move(0, height - 1);
    await toggle.evaluate((button) => button.blur());
    const buttonStyle = await toggle.evaluate((button) => {
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return {
        right: innerWidth - rect.right,
        border: style.borderTopWidth,
        background: style.backgroundColor,
        opacity: style.opacity,
      };
    });
    assert.ok(buttonStyle.right > 0 && buttonStyle.right < 20);
    assert.equal(buttonStyle.border, "0px");
    assert.equal(buttonStyle.background, "rgba(0, 0, 0, 0)");
    assert.equal(buttonStyle.opacity, "0.35");
    await toggle.hover();
    assert.equal(
      await toggle.evaluate((button) => getComputedStyle(button).opacity),
      "1",
    );
    await page.mouse.move(0, height - 1);
    const layout = await page.locator("#dateInfoPanel").evaluate((panel) => {
      const rect = panel.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        overflow: panel.scrollWidth > panel.clientWidth,
      };
    });
    assert.deepEqual(layout, { x: 0, y: 0, width, height, overflow: false });
    assert.equal(await page.locator("footer").isVisible(), false);
    assert.equal(await page.locator("#date-tab-countdown").isVisible(), false);
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "countdownFocusToggle",
    );
    const time = await page.locator(".countdown-time").textContent();
    await page.clock.runFor(1000);
    assert.notEqual(await page.locator(".countdown-time").textContent(), time);
    await page.screenshot({
      path: path.join(results, `countdown-focus-${width}.png`),
    });
    await page.keyboard.press("Escape");
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "countdownFocusToggle",
    );
    assert.deepEqual(
      await page.evaluate(() => ({ x: scrollX, y: scrollY })),
      original,
    );
    assert.equal(await page.locator("footer").isVisible(), true);
    await toggle.click();
    await toggle.click();
  }
  for (const [kind, message] of [
    ["rest", "今日不上班"],
    ["leave", "今天全天请假，无需倒计时"],
    ["done", "已到下班时间"],
    ["unavailable", "请先完成工作时间设置"],
  ]) {
    await page.evaluate((kind) => {
      const state = WorkTimeApp.domain.state.defaultState();
      if (kind === "rest") state.days["2026-10-08"] = { kind: "rest" };
      if (kind === "leave") state.days["2026-10-08"] = { leaveMinutes: 480 };
      if (kind === "done") state.settings.workEnd = "15:00";
      WorkTimeApp.services.countdown.setState(
        kind === "unavailable" ? null : state,
      );
    }, kind);
    await toggle.click();
    await page.clock.runFor(1000);
    assert.equal(
      await page.locator(".countdown-message").textContent(),
      message,
    );
    await toggle.click();
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() =>
    document.getElementById("countdownFocusToggle").click(),
  );
  assert.equal(
    await page
      .locator(".work-countdown")
      .evaluate((box) => box.getAnimations().length),
    1,
  );
  await page.clock.runFor(500);
  await page.evaluate(() =>
    document.getElementById("countdownFocusToggle").click(),
  );
  assert.equal(
    await page.locator(".wrap").evaluate((wrap) => wrap.getAnimations().length),
    1,
  );
  // Rapid toggles cancel the previous transition rather than stacking effects.
  await page.evaluate(() => {
    const button = document.getElementById("countdownFocusToggle");
    button.click();
    button.click();
    button.click();
  });
  assert.equal(
    await page.locator(".wrap").evaluate((wrap) => wrap.getAnimations().length),
    0,
  );
  await page.evaluate(() => WorkTimeApp.ui.dateInfo.dispose());
  assert.equal(
    await page
      .locator(".work-countdown")
      .evaluate((box) => box.getAnimations().length),
    0,
  );
  assert.equal(
    await page
      .locator("body")
      .evaluate((body) => body.classList.contains("is-countdown-focused")),
    false,
  );
  assert.equal(
    await page
      .locator(".countdown-focus-ancestor, .countdown-focus-hidden")
      .count(),
    0,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => WorkTimeApp.ui.dateInfo.mount());
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  assert.equal(
    await page
      .locator("body")
      .evaluate((body) => body.classList.contains("is-countdown-focused")),
    false,
  );
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "Countdown focus passed: desktop/mobile layout, ticking, keyboard, scroll restoration, states and lifecycle.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});

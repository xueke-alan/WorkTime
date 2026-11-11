"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const entry = pathToFileURL(
    path.resolve(process.argv[2] || "index.html"),
  ).href;
  try {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
        reducedMotion,
        locale: "zh-CN",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      console.log("Checking idle cover:", reducedMotion);
      await page.goto(entry);
      console.log("Opened offline entry");
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      console.log("App ready");
      await page.evaluate(() =>
        WorkTimeApp.services.preferences.page.saveMotionMode("system"),
      );
      await page.clock.setFixedTime(new Date("2026-11-11T15:59:58Z"));
      await page.locator("#date-tab-games").click();
      const panel = page.locator("#gamesPanel");
      const cover = panel.locator(".game-idle-cover");
      const shown = () =>
        cover.evaluate((el) => el.classList.contains("is-visible"));
      assert.equal(await shown(), true, "First visit is covered immediately");
      assert.equal(await cover.getAttribute("aria-hidden"), "true");
      const motto = cover.locator(".game-idle-motto");
      assert.equal(await motto.textContent(), "我爱上班，从不摸鱼");
      assert.ok(
        await motto.evaluate((el) => {
          const style = getComputedStyle(el);
          const date = getComputedStyle(el.previousElementSibling);
          return (
            Number(style.fontWeight) >= 700 &&
            parseFloat(style.fontSize) > parseFloat(date.fontSize)
          );
        }),
      );
      await panel.locator(".game-menu-play").hover();
      assert.equal(
        await shown(),
        false,
        "Entering immediately dismisses cover",
      );
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200);
      assert.equal(await shown(), false, "Departure delay is respected");
      await panel.locator(".game-menu-play").hover();
      await page.waitForTimeout(600);
      assert.equal(await shown(), false, "Re-entry cancels pending display");
      await panel.locator("h2").hover();
      await page.waitForTimeout(600);
      assert.equal(
        await shown(),
        false,
        "Moving inside the card stays uncovered",
      );
      await page.mouse.move(0, 0);
      await page.waitForTimeout(350);
      assert.equal(await shown(), true, "Cover appears after the 300ms delay");
      console.log("Pointer transitions verified");
      await page.clock.setFixedTime(new Date("2026-11-11T16:00:01Z"));
      await page.waitForFunction(
        () =>
          document.querySelector(".game-idle-time .summary-number-accessible")
            ?.textContent === "00:00:01",
      );
      const rolling = cover.locator(".number-roll-up, .number-roll-down");
      if (reducedMotion === "reduce") assert.equal(await rolling.count(), 0);
      else assert.ok((await rolling.count()) > 0, "Changed clock digits roll");
      await page.waitForFunction(
        () =>
          !document.querySelector(".game-idle-time .summary-number-outgoing"),
      );
      assert.equal(
        await cover.locator(".summary-number-visual").textContent(),
        "00:00:01",
      );
      assert.match(await cover.locator(".game-idle-date").textContent(), /12/);
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("en"));
      console.log("Clock and language verified");
      assert.equal(
        await cover.count(),
        1,
        "Language rebuild preserves one cover",
      );
      assert.match(
        await cover.locator(".game-idle-date").textContent(),
        /Thursday/,
      );
      const bounds = await cover.boundingBox();
      assert.ok(bounds.width > 0 && bounds.height > 0);
      const paint = await cover.evaluate((el) => {
        const css = getComputedStyle(el);
        return { opacity: css.opacity, transition: css.transitionDuration };
      });
      assert.equal(paint.opacity, "1");
      if (reducedMotion === "reduce") assert.equal(paint.transition, "0s");
      else assert.match(paint.transition, /0.24s/);
      fs.mkdirSync("test-results/game-idle-cover", { recursive: true });
      await panel.screenshot({
        path: `test-results/game-idle-cover/${reducedMotion}.png`,
      });
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal(await shown(), true, "Backgrounding preserves the cover");
      await page.clock.setFixedTime(new Date("2026-11-11T16:05:00Z"));
      await page.waitForTimeout(1100);
      const clock = cover.locator(".summary-number-visual");
      assert.equal(await clock.textContent(), "00:00:01", "Clock pauses");
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      assert.equal(await shown(), true, "Resuming keeps the cover visible");
      assert.equal(
        await cover.evaluate((el) => getComputedStyle(el).opacity),
        "1",
        "Resuming does not fade the cover back in",
      );
      assert.equal(await clock.textContent(), "00:05:00", "Clock catches up");
      await page.clock.setFixedTime(new Date("2026-11-11T16:05:01Z"));
      await page.waitForFunction(
        () =>
          document.querySelector(".game-idle-time .summary-number-accessible")
            ?.textContent === "00:05:01",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "blue";
      });
      await page.mouse.move(0, 0);
      await page.waitForTimeout(800);
      assert.ok(
        await cover.evaluate((el) =>
          [...el.children].every(
            (child) => child.scrollWidth <= el.clientWidth,
          ),
        ),
      );
      await page.setViewportSize({ width: 1280, height: 800 });
      await panel.locator(".game-menu-play").focus();
      assert.equal(await shown(), false, "Keyboard focus dismisses cover");
      await page.waitForTimeout(650);
      assert.equal(await shown(), false);
      await page.locator("#date-tab-games").focus();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(800);
      assert.equal(await shown(), true);
      await page.locator("#date-tab-notifications").click();
      assert.equal(await shown(), false, "Switching tabs clears cover");
      await page.locator("#date-tab-games").click();
      assert.equal(
        await shown(),
        true,
        "Returning from notifications covers immediately",
      );
      assert.equal(
        await cover.evaluate((el) => getComputedStyle(el).opacity),
        "1",
        "Tab entry paints the cover without fading through the menu",
      );
      await panel.locator('[data-game="game-2048"]').click();
      await panel.locator(".game-menu-play").click();
      await page.waitForFunction(
        () => document.querySelector("#gameShell").dataset.state === "open",
      );
      assert.equal(await shown(), false, "Expanded games never use idle cover");
      await page.locator("#gameExitButton").click();
      assert.equal(
        await shown(),
        true,
        "Game return prepares cover immediately",
      );
      assert.equal(
        await cover.evaluate((el) => getComputedStyle(el).opacity),
        "1",
      );
      await page.waitForFunction(
        () => document.querySelector("#gameShell").hidden,
      );
      await page.mouse.move(0, 0);
      assert.equal(await shown(), true, "Returning to menu rearms cover");
      await page.locator("#musicOpen").click();
      await page.waitForFunction(
        () => document.querySelector("#musicDialog")?.dataset.state === "open",
      );
      assert.equal(
        await shown(),
        false,
        "Fullscreen music suspends menu cover",
      );
      await page.locator("#musicExitButton").click();
      assert.equal(
        await shown(),
        true,
        "Music return prepares cover immediately",
      );
      assert.equal(
        await cover.evaluate((el) => getComputedStyle(el).opacity),
        "1",
      );
      await page.waitForFunction(
        () => document.querySelector("#musicDialog").hidden,
      );
      assert.equal(
        await shown(),
        true,
        "Cover remains visible after music closes",
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    const touch = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await touch.route(/^https?:/, (route) => route.abort());
    await touch.goto(entry);
    await touch.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await touch.locator("#date-tab-games").tap();
    await touch.waitForTimeout(900);
    assert.equal(
      await touch
        .locator(".game-idle-cover")
        .evaluate((el) => el.classList.contains("is-visible")),
      false,
      "Touch-only devices keep the menu available",
    );
    console.log(
      "Game idle cover timing, clock, animation, language, keyboard, touch and lifecycle verified.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

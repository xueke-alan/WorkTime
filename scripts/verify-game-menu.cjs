"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const output = path.resolve("test-results/game-menu");
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
      { width: 320, height: 740 },
    ]) {
      const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#date-tab-games").click();
      for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
        await page.evaluate((id) => WorkTimeApp.i18n.setLanguage(id), language);
        const cards = page.locator("#gamesPanel .game-menu-entry");
        assert.equal(await cards.count(), 9);
        await cards.first().focus();
        await cards.first().press("ArrowRight");
        assert.equal(
          await cards.nth(1).evaluate((el) => el === document.activeElement),
          true,
        );
        await cards.nth(1).press("ArrowDown");
        assert.equal(
          await cards.nth(3).evaluate((el) => el === document.activeElement),
          true,
        );
        await cards.nth(3).press("Home");
        await cards.first().press("End");
        assert.equal(
          await cards.last().evaluate((el) => el === document.activeElement),
          true,
        );
        assert.equal(
          await page.locator("#gameShell").getAttribute("data-state"),
          "closed",
        );
        const result = await page.evaluate(async () => {
          const panel = document.getElementById("gamesPanel");
          const list = panel.querySelector(".game-menu-list");
          const title = panel.querySelector("h2");
          const top = title.getBoundingClientRect().top;
          const fits = [...list.children].every((card) => {
            const bounds = card.getBoundingClientRect();
            return [
              ...card.querySelectorAll(
                ".game-menu-name, .game-menu-description",
              ),
            ].every((label) => {
              const range = document.createRange();
              range.selectNodeContents(label);
              return [...range.getClientRects()].every(
                (rect) =>
                  rect.left >= bounds.left &&
                  rect.right <= bounds.right &&
                  rect.top >= bounds.top &&
                  rect.bottom <= bounds.bottom,
              );
            });
          });
          list.scrollTop = list.scrollHeight;
          await new Promise(requestAnimationFrame);
          return {
            fits,
            columns:
              getComputedStyle(list).gridTemplateColumns.split(" ").length,
            fixedHeader: top === title.getBoundingClientRect().top,
            noOverflow:
              list.scrollWidth <= list.clientWidth &&
              panel.scrollWidth <= panel.clientWidth,
            captions: [
              ...list.querySelectorAll(".game-menu-description"),
            ].every(
              (label) =>
                label.textContent && !label.textContent.startsWith("games."),
            ),
            scrollable:
              list.scrollHeight <= list.clientHeight || list.scrollTop > 0,
          };
        });
        assert.deepEqual(
          result,
          {
            fits: true,
            columns: 2,
            fixedHeader: true,
            noOverflow: true,
            captions: true,
            scrollable: true,
          },
          JSON.stringify({ viewport, language, result }),
        );
      }
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await page.locator("#gamesPanel .game-menu-entry").first().focus();
      await page
        .locator("#gamesPanel")
        .screenshot({ path: path.join(output, `${viewport.width}.png`) });
      // Enter activates a card once; Escape returns to the expanded card menu.
      await page.locator('#gamesPanel [data-game="game-2048"]').press("Enter");
      await page.waitForFunction(
        () => document.getElementById("gameShell").dataset.state === "open",
      );
      assert.equal(await page.locator(".game-2048").count(), 1);
      await page.keyboard.press("Escape");
      await page.locator("#gameShell .game-menu-entry").first().waitFor();
      await page.locator('#gameShell [data-game="game-snake"]').click();
      await page.waitForFunction(() => document.querySelector(".game-snake"));
      await page.keyboard.press("Escape");
      await page.locator("#gameShell .game-menu-entry").first().waitFor();
      await page.locator("#gameShell").screenshot({
        path: path.join(output, `${viewport.width}-expanded.png`),
      });
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => document.getElementById("gameShell").dataset.state === "closed",
      );
      assert.deepEqual(errors, []);
      console.log(
        `${viewport.width}px: six languages, card layout, scrolling, keyboard and both launch surfaces passed.`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

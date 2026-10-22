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
  try {
    const motionPage = await browser.newPage({
      reducedMotion: "no-preference",
    });
    await motionPage.route(/^https?:/, (route) => route.abort());
    await motionPage.goto(pathToFileURL(path.resolve("index.html")).href);
    await motionPage.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const checkMotion = () => {
      const ui = WorkTimeApp.ui;
      const panel = document.getElementById("gamesPanel");
      const detail = panel.querySelector(".game-menu-detail");
      ui.dateInfo.selectTab("notifications");
      ui.dateInfo.selectTab("games");
      const entering = panel.getAnimations().length;
      ui.dateInfo.selectTab("countdown");
      const stopped = panel.getAnimations().length;
      ui.dateInfo.selectTab("games");
      ui.motion.stop(panel);
      const buttons = panel.querySelectorAll(".game-menu-entry");
      buttons[1].click();
      buttons[2].click();
      const switching = detail.getAnimations().length;
      buttons[2].click();
      return {
        entering,
        stopped,
        switching,
        repeated: detail.getAnimations().length,
      };
    };
    assert.deepEqual(await motionPage.evaluate(checkMotion), {
      entering: 1,
      stopped: 0,
      switching: 1,
      repeated: 1,
    });
    await motionPage.waitForFunction(
      () =>
        !document.querySelector("#gamesPanel .game-menu-detail").getAnimations()
          .length,
    );
    await motionPage.emulateMedia({ reducedMotion: "reduce" });
    assert.deepEqual(await motionPage.evaluate(checkMotion), {
      entering: 0,
      stopped: 0,
      switching: 0,
      repeated: 0,
    });
    await motionPage.close();
    console.log(
      "Game menu page/detail motion, rapid switching and reduced motion passed.",
    );
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
      { width: 2048, height: 1152 },
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
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      await page.locator("#date-tab-games").click();
      for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
        await page.evaluate(
          (language) => WorkTimeApp.i18n.setLanguage(language),
          language,
        );
        const first = page.locator("#gamesPanel .game-menu-entry").first();
        await first.click();
        await first.press("End");
        assert.equal(
          await page
            .locator("#gamesPanel .game-menu-entry")
            .last()
            .getAttribute("aria-pressed"),
          "true",
        );
        assert.equal(
          await page.locator("#gameShell").getAttribute("data-state"),
          "closed",
        );
        const result = await page.evaluate(async () => {
          const panel = document.getElementById("gamesPanel");
          const list = panel.querySelector(".game-menu-list");
          const detail = panel.querySelector(".game-menu-detail");
          const title = panel.querySelector("h2");
          const titleTop = title.getBoundingClientRect().top;
          const detailTop = detail.getBoundingClientRect().top;
          const entry = WorkTimeApp.games.get(panel.dataset.selectedGame);
          const matches =
            detail.querySelector("h3").textContent ===
              WorkTimeApp.i18n.t(entry.nameKey) &&
            detail.querySelector("p") === null;
          const namesFit = [...list.querySelectorAll(".game-menu-entry")].every(
            (button) => {
              const label = button.querySelector("span");
              const bounds = button.getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(label);
              return [...range.getClientRects()].every(
                (rect) =>
                  rect.left >= bounds.left &&
                  rect.right <= bounds.right &&
                  rect.top >= bounds.top &&
                  rect.bottom <= bounds.bottom,
              );
            },
          );
          const chineseNamesOnOneLine =
            innerWidth < 1920 ||
            !WorkTimeApp.i18n.language.startsWith("zh") ||
            [...list.querySelectorAll(".game-menu-entry > span")].every(
              (label) =>
                label.clientHeight <=
                parseFloat(getComputedStyle(label).lineHeight) + 1,
            );
          list.scrollTop = list.scrollHeight;
          await new Promise(requestAnimationFrame);
          return {
            matches,
            namesFit,
            chineseNamesOnOneLine,
            fixedTitle: titleTop === title.getBoundingClientRect().top,
            fixedDetail: detailTop === detail.getBoundingClientRect().top,
            scrolled: list.scrollTop > 0,
            panelScroll: panel.scrollTop,
            noOverflow:
              list.scrollWidth <= list.clientWidth &&
              detail.scrollWidth <= detail.clientWidth &&
              panel.scrollWidth <= panel.clientWidth,
            columns:
              list.getBoundingClientRect().right <=
              detail.getBoundingClientRect().left + 1,
          };
        });
        assert.ok(
          result.matches &&
            result.namesFit &&
            result.chineseNamesOnOneLine &&
            result.fixedTitle &&
            result.fixedDetail &&
            result.scrolled &&
            result.noOverflow &&
            result.columns,
          JSON.stringify({ viewport, language, result }),
        );
        assert.equal(result.panelScroll, 0);
        const selected = await page
          .locator("#gamesPanel")
          .getAttribute("data-selected-game");
        await page.evaluate(() =>
          WorkTimeApp.i18n.setLanguage(
            WorkTimeApp.i18n.language === "en" ? "zh-CN" : "en",
          ),
        );
        assert.equal(
          await page.locator("#gamesPanel").getAttribute("data-selected-game"),
          selected,
        );
      }
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await page.locator('#gamesPanel [data-game="game-2048"]').click();
      fs.mkdirSync(path.resolve("test-results/game-menu"), { recursive: true });
      await page.locator("#gamesPanel").screenshot({
        path: path.resolve(`test-results/game-menu/${viewport.width}.png`),
      });
      await page.locator("#gamesPanel .game-menu-play").click();
      await page.waitForFunction(
        () => document.getElementById("gameShell").dataset.state === "open",
      );
      assert.equal(await page.locator(".game-2048").count(), 1);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() =>
        document.querySelector("#gameShell .game-menu-play"),
      );
      await page.locator('#gameShell [data-game="game-snake"]').click();
      await page.locator("#gameShell .game-menu-play").click();
      await page.waitForFunction(() => document.querySelector(".game-snake"));
      assert.deepEqual(errors, []);
      console.log(
        `${viewport.width}px: selection, keyboard, six languages, fixed header, independent scrolling and both launch surfaces passed.`,
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

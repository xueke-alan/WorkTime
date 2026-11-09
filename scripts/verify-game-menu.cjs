"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const languages = ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"];

async function checkLayout(menu, context) {
  const result = await menu.evaluate((panel) => {
    const list = panel.querySelector(".game-menu-list");
    const detail = panel.querySelector(".game-menu-detail");
    const header = panel.querySelector(".game-menu-header");
    const actions = header.querySelector(".game-menu-archive-actions");
    const title = header.querySelector("h2");
    const panelBounds = panel.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    const detailBounds = detail.getBoundingClientRect();
    const headerTop = header.getBoundingClientRect().top;
    const detailTop = detail.scrollTop;
    const actionsBounds = actions.getBoundingClientRect();
    const titleBounds = title.getBoundingClientRect();
    const description = detail.querySelector(".game-menu-description");
    const play = detail.querySelector(".game-menu-play");
    const progress = detail.querySelector(".game-menu-progress");
    const text = description.textContent;
    description.textContent = "Short.";
    const shortHeight = description.getBoundingClientRect().height;
    const playOffset = play.offsetTop;
    const progressOffset = progress.offsetTop;
    description.textContent = "A longer game description. ".repeat(30);
    const stableDescription =
      description.getBoundingClientRect().height === shortHeight &&
      description.scrollHeight > description.clientHeight &&
      play.offsetTop === playOffset &&
      progress.offsetTop === progressOffset;
    description.textContent = text;
    list.scrollTop = list.scrollHeight;
    const listScrolled = list.scrollTop;
    detail.scrollTop = detail.scrollHeight;
    const result = {
      stableDescription,
      split:
        listBounds.right <= detailBounds.left + 1 &&
        Math.abs(listBounds.top - detailBounds.top) < 1 &&
        listBounds.width > 0 &&
        detailBounds.width > 0,
      archiveVisible:
        actions.querySelectorAll("button").length === 2 &&
        titleBounds.right <= actionsBounds.left &&
        actionsBounds.right <= panelBounds.right,
      scrollable:
        (list.scrollHeight <= list.clientHeight || listScrolled > 0) &&
        (detail.scrollHeight <= detail.clientHeight ||
          detail.scrollTop > detailTop) &&
        list.scrollTop === listScrolled &&
        header.getBoundingClientRect().top === headerTop,
      noHorizontalOverflow: [panel, list, detail, ...list.children].every(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    };
    list.scrollTop = 0;
    detail.scrollTop = 0;
    return result;
  });
  assert.ok(
    Object.values(result).every(Boolean),
    JSON.stringify({ ...context, result }),
  );
  const selected = menu.locator('.game-menu-entry[aria-pressed="true"]');
  assert.equal(await selected.count(), 1);
  assert.equal(
    await menu.locator(".game-menu-detail h3").textContent(),
    await selected.textContent(),
  );
  const description = await menu
    .locator(".game-menu-description")
    .textContent();
  assert.ok(description && !description.startsWith("games."));
  assert.ok(await menu.locator(".game-menu-play").isVisible());
}

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
      const gameRequests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (
          /\/(?:games\/(?:2048|jump|snake|tank)(?:-rules)?\.js|css\/(?:2048|jump|snake|tank)\.css)(?:\?|$)/.test(
            request.url(),
          )
        )
          gameRequests.push(request.url());
      });
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#date-tab-games").click();
      const sidebar = page.locator("#gamesPanel");
      const shell = page.locator("#gameShell");
      const entries = sidebar.locator(".game-menu-entry");
      const play = sidebar.locator(".game-menu-play");
      assert.equal(await entries.count(), 10);
      assert.equal(await entries.first().getAttribute("aria-pressed"), "true");
      const progress = sidebar.locator(".game-menu-progress p");
      assert.equal(
        await progress.textContent(),
        await page.evaluate(() => WorkTimeApp.i18n.t("games.progress.empty")),
      );
      if (viewport.width === 320) {
        const jump = sidebar.locator('[data-game="game-jump"]');
        await page.evaluate(() => {
          const key = WorkTimeApp.services.gameArchive.keys["game-jump"];
          localStorage.setItem(key, "1234");
        });
        await jump.click();
        assert.match(await progress.textContent(), /1,234/);
        await page.evaluate(() => {
          const archive = WorkTimeApp.services.gameArchive;
          localStorage.setItem(archive.keys["game-jump"], "5678");
          window.dispatchEvent(
            new StorageEvent("storage", { key: archive.REVISION }),
          );
        });
        assert.match(await progress.textContent(), /5,678/);
        await entries.first().click();
      }

      await page.locator("#date-tab-games").click();
      await entries.first().focus();
      await page.keyboard.press("ArrowDown");
      assert.equal(
        await entries.nth(1).evaluate((el) => el === document.activeElement),
        true,
      );
      await page.keyboard.press("ArrowUp");
      assert.equal(
        await entries.first().evaluate((el) => el === document.activeElement),
        true,
      );
      await page.keyboard.press("End");
      assert.equal(
        await entries.last().evaluate((el) => el === document.activeElement),
        true,
      );
      assert.equal(await entries.first().getAttribute("aria-pressed"), "true");
      await page.keyboard.press("Enter");
      assert.equal(await entries.last().getAttribute("aria-pressed"), "true");
      await page.keyboard.press("Tab");
      assert.equal(
        await play.evaluate((el) => el === document.activeElement),
        true,
      );

      for (const language of languages) {
        await page.evaluate((id) => WorkTimeApp.i18n.setLanguage(id), language);
        await checkLayout(sidebar, { viewport, language, menu: "sidebar" });
        assert.equal(await entries.last().getAttribute("aria-pressed"), "true");
        assert.equal(
          await play.evaluate((el) => el === document.activeElement),
          true,
        );
      }
      // Daily automatic backups may load rules for archive validation, while
      // browsing the menu must still avoid loading game implementations.
      assert.deepEqual(
        gameRequests.filter((url) => !url.includes("-rules.js")),
        [],
      );
      assert.equal(await shell.getAttribute("data-state"), "closed");

      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await entries.last().focus();
      await page.keyboard.press("Home");
      await page.keyboard.press("Space");
      assert.equal(await entries.first().getAttribute("aria-pressed"), "true");
      await sidebar.screenshot({
        path: path.join(output, `${viewport.width}.png`),
      });
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await page.locator(".game-2048").waitFor();
      await page.keyboard.press("Escape");
      const shellEntries = shell.locator(".game-menu-entry");
      const snake = shell.locator('[data-game="game-snake"]');
      await shellEntries.first().waitFor();
      assert.equal(
        await shellEntries
          .first()
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await snake.click();
      assert.equal(await snake.getAttribute("aria-pressed"), "true");
      for (const language of languages) {
        await page.evaluate((id) => WorkTimeApp.i18n.setLanguage(id), language);
        await checkLayout(shell, { viewport, language, menu: "expanded" });
        assert.equal(await snake.getAttribute("aria-pressed"), "true");
      }
      assert.ok(gameRequests.every((url) => !url.endsWith("/snake.js")));
      await shell.locator(".game-menu-play").click();
      await page.locator(".game-snake").waitFor();
      await page.keyboard.press("Escape");
      await snake.waitFor();
      assert.equal(
        await shellEntries.first().getAttribute("data-game"),
        "game-snake",
        "Equally played games put the most recent first",
      );
      assert.equal(
        await entries.first().getAttribute("data-game"),
        "game-snake",
        "The sidebar follows the expanded menu's play order",
      );
      assert.equal(await snake.getAttribute("aria-pressed"), "true");
      assert.equal(
        await snake.evaluate((el) => el === document.activeElement),
        true,
      );
      await shell.screenshot({
        path: path.join(output, `${viewport.width}-expanded.png`),
      });
      await page.keyboard.press("Escape");
      await shell.waitFor({ state: "hidden" });
      assert.equal(
        await sidebar
          .locator('[data-game="game-snake"]')
          .getAttribute("aria-pressed"),
        "true",
      );
      const frequent = await page.evaluate(() => {
        WorkTimeApp.games.recordPlay("game-2048");
        WorkTimeApp.games.recordPlay("game-jump");
        return WorkTimeApp.games.list()[0].id;
      });
      assert.equal(
        frequent,
        "game-2048",
        "Frequency takes priority over recency",
      );
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      assert.equal(
        await sidebar
          .locator(".game-menu-entry")
          .first()
          .getAttribute("data-game"),
        "game-2048",
        "Play order persists across reloads",
      );
      assert.deepEqual(errors, []);
      console.log(
        `${viewport.width}px: six languages, split layout, scrolling, keyboard, and both launch surfaces passed.`,
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

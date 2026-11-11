"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const output = path.resolve("test-results/game-pause");
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const game of [
      "sudoku",
      "minesweeper",
      "snake",
      "tank",
      "jump",
      "link",
    ]) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.addInitScript(() => {
        const show = HTMLDialogElement.prototype.showModal;
        HTMLDialogElement.prototype.showModal = function () {
          if (this.id !== "onboardingDialog") show.call(this);
        };
      });
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await page.evaluate(() =>
        WorkTimeApp.services.preferences.page.saveMotionMode("system"),
      );
      await launchGame(page, "game-" + game);
      const prefix = game === "minesweeper" ? "mine" : game;
      const action = (name) =>
        page.locator(`[data-${prefix}-action="${name}"]`);
      const cover = page.locator(`.${prefix}-cover:not(.game-pause-outgoing)`);
      if (game === "sudoku") await action("level-1").click();
      if (game === "minesweeper")
        await page.locator(".mine-cell").first().click();
      if (game === "snake") {
        await action("start").click();
        await page.waitForFunction(
          () => document.querySelector(".snake-cover").hidden,
        );
      }
      if (game === "tank") await action("start").click();
      if (game === "jump") await action("start").click();
      if (game === "link") await action("quest").click();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await action("pause").click();
        await page.waitForFunction(
          (sel) =>
            document.querySelector(sel).classList.contains("game-pause-cover"),
          `.${prefix}-cover`,
        );
        assert.equal(await cover.innerText(), "暂停", game + " pause caption");
        assert.equal(
          await cover.locator("button:visible").count(),
          0,
          game + " no overlay resume button",
        );
        assert.equal(
          await cover.evaluate((el) => getComputedStyle(el).backdropFilter),
          "none",
        );
        assert.ok((await cover.getAttribute("aria-label")).length > 0);
        assert.equal(
          await cover.evaluate((el) => getComputedStyle(el).borderRadius),
          "0px",
        );
        assert.equal(
          await cover.locator(".game-pause-icon use").getAttribute("href"),
          "#ms-hourglass-pause",
        );
        const icon = await cover.locator(".game-pause-content").boundingBox(),
          rect = await cover.boundingBox();
        assert.ok(
          icon.width >= 60,
          `${game} ${width}: ${JSON.stringify(icon)}`,
        );
        assert.ok(
          Math.abs(icon.x + icon.width / 2 - rect.x - rect.width / 2) < 2,
          game + " centered pause icon",
        );
        await page.screenshot({
          path: path.join(output, `${game}-${width}.png`),
        });
        assert.equal(await action("pause").isEnabled(), true);
        await action("pause").click();
        if (game === "snake")
          await page.waitForFunction(
            () => document.querySelector(".snake-cover").hidden,
          );
        assert.equal(
          await cover.isVisible(),
          false,
          game + " resumes from existing control",
        );
      }
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await action("pause").evaluate((button) => button.click());
      assert.ok(
        await cover.evaluate((el) => el.getAnimations().length > 0),
        game + " fade in",
      );
      await page.waitForTimeout(250);
      await action("pause").evaluate((button) => button.click());
      const outgoing = page.locator(".game-pause-outgoing");
      assert.equal(await outgoing.count(), 1, game + " fade out snapshot");
      assert.equal(
        await outgoing.evaluate((el) => getComputedStyle(el).pointerEvents),
        "none",
      );
      assert.equal(await outgoing.getAttribute("aria-hidden"), "true");
      assert.ok(
        await outgoing.evaluate((el) => el.getAnimations().length > 0),
        game + " fade out",
      );
      await outgoing.waitFor({ state: "detached" });
      if (game === "snake")
        await page.waitForFunction(
          () => document.querySelector(".snake-cover").hidden,
        );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await action("pause").evaluate((button) => button.click());
      assert.equal(
        await cover.evaluate((el) => el.getAnimations().length),
        0,
        "respect reduced motion",
      );
      await action("pause").evaluate((button) => button.click());
      if (game === "snake")
        await page.waitForFunction(
          () => document.querySelector(".snake-cover").hidden,
        );
      if (["sudoku", "minesweeper", "snake", "link"].includes(game)) {
        await action("restart").click();
        assert.equal(
          await cover.locator(".game-pause-icon").isVisible(),
          false,
        );
        assert.ok(
          (await cover.locator("button:visible").count()) > 0,
          "confirmation retains actions",
        );
      }
      if (["sudoku", "minesweeper", "snake", "link"].includes(game))
        await action("cancel").click();
      if (
        await cover.evaluate(
          (el) => el.classList.contains("game-pause-cover") && !el.hidden,
        )
      ) {
        await action("pause").click();
        if (game === "snake")
          await page.waitForFunction(
            () => document.querySelector(".snake-cover").hidden,
          );
      }
      await page.locator(".game-pause-outgoing").waitFor({ state: "detached" });
      if (game === "sudoku") {
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await action("pause").click();
        await action("choose").click();
        assert.equal(
          await page.locator(".game-pause-outgoing").count(),
          0,
          "catalog clears old pause transition",
        );
        await action("level-2").click();
        assert.equal(
          await cover.isVisible(),
          false,
          "new puzzle has no pause cover",
        );
        assert.equal(
          await page.locator(".game-pause-outgoing").count(),
          0,
          "no old pause snapshot on new puzzle",
        );
      }
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(() => {
        window.pauseFlashes = [];
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            if (
              record.type === "attributes" &&
              (record.target.classList.contains("game-pause-cover") ||
                record.oldValue?.includes("game-pause-cover"))
            )
              window.pauseFlashes.push("pause class changed");
            for (const node of record.addedNodes)
              if (node.nodeType === 1 && node.matches(".game-pause-outgoing"))
                window.pauseFlashes.push("pause snapshot created");
          }
        });
        observer.observe(document.querySelector("#gameShell"), {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["class"],
          attributeOldValue: true,
        });
      });
      await page.locator("#gameExitButton").click();
      await page.waitForFunction(
        () => document.querySelector("#gameShell").hidden,
      );
      assert.deepEqual(
        await page.evaluate(() => window.pauseFlashes),
        [],
        game + " exits without painting pause cover",
      );
      assert.equal(
        await page.locator(".game-pause-outgoing").count(),
        0,
        "exit removes pending pause snapshots",
      );
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        game +
          ": Hourglass Pause with caption and translucent background, accessible label, desktop/mobile, HUD resume and confirmation verified",
      );
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

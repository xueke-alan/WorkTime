"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { launchGame } = require("./game-test-helpers.cjs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      localStorage.setItem("worktime.games.uno.preferredMode", "ranked");
      localStorage.setItem(
        "worktime.games.uno.v1",
        JSON.stringify({
          version: 1,
          state: null,
          profile: {
            rating: 100,
            history: [
              {
                id: "previous",
                mode: "ranked",
                endedAt: 1,
                result: "abandoned",
                place: null,
                tied: null,
                points: 0,
                rounds: 0,
                players: 4,
                before: 115,
                after: 100,
                delta: -15,
                detail: null,
              },
            ],
          },
        }),
      );
    });
    await launchGame(page, "game-uno");
    await page.waitForFunction(
      () => !document.querySelector(".workspace.is-game-transitioning"),
    );
    const action = (key) => page.locator(`[data-uno-action="${key}"]`);
    const read = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("worktime.games.uno.v1")),
      );
    const layout = async () => {
      for (const width of [1280, 360]) {
        await page.setViewportSize({ width, height: 900 });
        const geometry = await page
          .locator(".uno-ranked-exit")
          .evaluate((dialog) => {
            const box = dialog.getBoundingClientRect();
            const buttons = [...dialog.querySelectorAll("button")].map(
              (button) => {
                const rect = button.getBoundingClientRect();
                return {
                  top: rect.top,
                  left: rect.left,
                  right: rect.right,
                  bottom: rect.bottom,
                };
              },
            );
            return { width: box.width, height: box.height, buttons };
          });
        assert.equal(geometry.buttons.length, 3);
        assert.ok(
          geometry.buttons.every(
            (b) => Math.abs(b.top - geometry.buttons[0].top) < 1,
          ),
        );
        assert.ok(geometry.buttons[0].right < geometry.buttons[1].left);
        assert.ok(geometry.buttons[1].right < geometry.buttons[2].left);
        assert.ok(geometry.buttons[2].right <= width);
        if (width === 360) return geometry;
      }
    };
    await action("start").click();
    await page.locator(".uno-countdown").waitFor();
    const archivedCountdown = await page.evaluate(async () => {
      const service = WorkTimeApp.services.gameArchive;
      const decoded = await service.decode(
        await service.encode(service.exportArchive()),
      );
      const save = decoded.games["game-uno"];
      let rejected = false;
      try {
        service.normalize("game-uno", { ...save, countdownPending: "yes" });
      } catch {
        rejected = true;
      }
      return { pending: save.countdownPending, rejected };
    });
    assert.deepEqual(archivedCountdown, { pending: true, rejected: true });
    await action("exit").click();
    assert.match(
      await page.locator('.uno-confirm [data-uno-action="exit"]').innerText(),
      /不扣分/,
    );
    const countdownLayout = await layout();
    const countdownBody = await page.locator(".uno-exit-emblem").innerHTML();
    await page.locator('.uno-confirm [data-uno-action="exit"]').click();
    assert.equal((await read()).profile.rating, 100);
    assert.equal((await read()).profile.history.length, 1);
    assert.equal((await read()).state, null);

    await action("start").click();
    await page.locator(".uno-countdown").waitFor();
    await action("exit").click();
    await action("leaveTemporarily").click();
    assert.equal(await action("continue").isEnabled(), true);
    assert.equal(await action("start").isDisabled(), true);
    assert.equal(await action("mode").isDisabled(), true);
    assert.equal(await action("viewRules").isDisabled(), true);
    assert.equal(await page.locator("#uno-players").isDisabled(), true);
    const frozen = await read();
    await page.waitForTimeout(3200);
    assert.deepEqual(await read(), frozen);
    await action("continue").click();
    await page.waitForFunction(() => {
      const save = JSON.parse(localStorage.getItem("worktime.games.uno.v1"));
      return save.countdownPending === false;
    });
    await action("exit").click();
    assert.match(
      await page.locator('.uno-confirm [data-uno-action="exit"]').innerText(),
      /15/,
    );
    assert.equal(
      await page.locator(".uno-exit-emblem").innerHTML(),
      countdownBody,
    );
    const playingLayout = await layout();
    assert.equal(playingLayout.width, countdownLayout.width);
    assert.equal(playingLayout.height, countdownLayout.height);
    await page.screenshot({
      path: path.resolve(__dirname, "../_uno-exit-layout.png"),
    });
    await action("leaveTemporarily").click();
    assert.equal((await read()).profile.rating, 100);
    await action("continue").click();
    await action("exit").click();
    await page.locator('.uno-confirm [data-uno-action="exit"]').click();
    assert.equal((await read()).profile.rating, 85);
    assert.equal((await read()).profile.history[0].result, "abandoned");
    console.log(
      "UNO countdown exit, temporary leave, settings lock and ranked penalty verified.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

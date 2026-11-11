"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchGame } = require("./game-test-helpers.cjs");

module.exports = async function verifyResults(browser, site) {
  const directory = path.resolve(__dirname, "../test-results/gomoku/results");
  fs.mkdirSync(directory, { recursive: true });
  for (const outcome of ["win", "loss", "draw", "solve"]) {
    const bytes = fs.readFileSync(
      path.join(site, "assets/images/gomoku/" + outcome + "-brush.png"),
    );
    assert.equal(bytes.readUInt32BE(0), 0x89504e47);
    assert.equal(bytes[25], 6, "RGBA transparent artwork: " + outcome);
  }
  async function scenario(
    outcome,
    { reduce = false, width = 1280, dark = false, ended = false } = {},
  ) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: reduce ? "reduce" : "no-preference",
      colorScheme: dark ? "dark" : "light",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.addInitScript(() => {
      const show = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function (...args) {
        const value = show.apply(this, args);
        if (this.id === "onboardingDialog") this.close();
        return value;
      };
    });
    await page.goto(pathToFileURL(path.join(site, "index.html")).href);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.waitForTimeout(700);
    // Exercise system reduced motion explicitly, independent of the app default.
    await page.evaluate(() =>
      WorkTimeApp.services.preferences.page.saveMotionMode("system"),
    );
    await page.evaluate(() => WorkTimeApp.games.load("game-gomoku"));
    const fixture = await page.evaluate(
      ({ outcome, ended }) => {
        const rules = WorkTimeApp.games.gomokuRules;
        let history = [105, 0, 106, 1, 107, 2, 108, 15],
          final = 109;
        const save = { version: 1, current: null, drafts: {}, completed: {} };
        if (outcome === "loss") {
          history = [0, 105, 1, 106, 2, 107, 15, 108];
          final = 30;
        }
        if (outcome === "draw") {
          const black = [],
            white = [];
          for (let p = 0; p < 225; p++)
            (((p % 15) + 2 * Math.floor(p / 15)) % 4 < 2 ? black : white).push(
              p,
            );
          const full = black.flatMap((p, i) =>
            i < white.length ? [p, white[i]] : [p],
          );
          final = full.at(-1);
          history = full.slice(0, -1);
        }
        if (outcome === "solve") {
          const level = WorkTimeApp.data.gomoku[0];
          const solution = level.solution;
          final = solution.at(-1);
          // Add a harmless round so this win exceeds the stated optimum.
          const available = level.board.flatMap((s, p) =>
            !s && !solution.includes(p) ? [p] : [],
          );
          let extra;
          for (const a of available) {
            for (const b of available) {
              if (a === b) continue;
              const test = rules.restore(level, [
                a,
                b,
                ...solution.slice(0, -1),
              ]);
              if (test?.status === "playing") {
                extra = [a, b];
                break;
              }
            }
            if (extra) break;
          }
          if (!extra) throw Error("No late-win fixture");
          history = [...extra, ...solution.slice(0, -1)];
          save.current = level.id;
          save.drafts[level.id] = { path: history };
        } else
          save.match = {
            difficulty: "normal",
            human: 1,
            path: ended ? [...history, final] : history,
          };
        localStorage.setItem("worktime.games.gomoku.v1", JSON.stringify(save));
        return { final, history };
      },
      { outcome, ended },
    );
    // Opening loads the seeded snapshot through the ordinary archive owner.
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    await page.waitForFunction(
      () =>
        typeof document.getElementById("date-tab-games")?.onclick ===
        "function",
    );
    await page.evaluate(() => WorkTimeApp.ui.dateInfo.selectTab("games"));
    await launchGame(page, "game-gomoku");
    await page.waitForFunction(
      () => document.getElementById("gameShell").dataset.state === "open",
    );
    if (outcome !== "solve") await page.locator(".game-level-return").click();
    const effect = page.locator(".gomoku-result");
    const action = (name) => page.locator(`[data-gomoku-action="${name}"]`);
    async function trigger() {
      await page
        .locator(`.gomoku-cell[data-square="${fixture.final}"]`)
        .click();
      await effect.waitFor({ state: "visible" });
    }
    async function clean() {
      assert.deepEqual(errors, []);
      await page.close();
    }
    return { page, effect, action, fixture, trigger, clean };
  }

  for (const outcome of ["win", "loss", "draw", "solve"]) {
    const s = await scenario(outcome);
    const { page, effect, action } = s;
    await s.trigger();
    assert.equal(await effect.getAttribute("data-result"), outcome);
    assert.equal(await effect.getAttribute("aria-hidden"), "true");
    const art = effect.locator("img");
    assert(await art.evaluate((img) => img.complete && img.naturalWidth > 0));
    assert((await art.getAttribute("src")).endsWith(outcome + "-brush.png"));
    assert.equal(
      await effect.evaluate((el) => getComputedStyle(el).pointerEvents),
      "none",
    );
    const tracks = await effect.evaluate((el) =>
      el.getAnimations({ subtree: true }).map((a) => ({
        frames: a.effect.getKeyframes().map((f) => ({
          opacity: Number(f.opacity),
          transform: f.transform,
        })),
        duration: a.effect.getTiming().duration,
      })),
    );
    assert.equal(tracks.length, 3);
    assert.equal(tracks[0].duration, 2200);
    assert.equal(tracks[0].frames[0].transform, "scale(1.06)");
    assert(
      tracks.every((t) =>
        t.frames.every(
          (f) =>
            !f.transform.includes("rotate") &&
            !f.transform.includes("translate"),
        ),
      ),
    );
    assert(Math.max(...tracks[1].frames.map((f) => f.opacity)) <= 0.35);
    assert(Math.max(...tracks[2].frames.map((f) => f.opacity)) <= 0.15);
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(directory, outcome + ".png") });
    if (outcome === "win") {
      const before = await effect
        .locator("img")
        .evaluate((el) => el.getAnimations()[0].currentTime);
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("en"));
      const after = await effect
        .locator("img")
        .evaluate((el) => el.getAnimations()[0].currentTime);
      assert(after >= before, "translation does not restart the result");
    }
    await effect.waitFor({ state: "hidden" });
    assert.equal(
      await effect.evaluate((el) => el.getAnimations({ subtree: true }).length),
      0,
    );
    await page.evaluate(() =>
      document.dispatchEvent(new Event("worktime:languagechange")),
    );
    assert(await effect.isHidden(), "ordinary redraw does not replay");
    if (outcome === "win" || outcome === "solve") {
      await action("undo").click();
      await s.trigger();
      await action("restart").click();
      if (outcome === "win")
        await page.locator('[data-game-restart="new"]').click();
      assert(await effect.isHidden());
      assert.equal(
        await effect.evaluate(
          (el) => el.getAnimations({ subtree: true }).length,
        ),
        0,
      );
    }
    await s.clean();
  }

  for (const width of [320, 390, 1280]) {
    const s = await scenario("win", {
      reduce: true,
      width,
      dark: width !== 1280,
    });
    await s.trigger();
    assert.equal(
      await s.effect.evaluate(
        (el) => el.getAnimations({ subtree: true }).length,
      ),
      0,
    );
    assert(await s.effect.locator(".gomoku-result-wash").isHidden());
    assert(await s.effect.locator(".gomoku-result-splash").isHidden());
    const board = await s.page.locator(".gomoku-board").boundingBox();
    const frame = await s.effect.locator(".gomoku-result-frame").boundingBox();
    assert(Math.abs(frame.width / board.width - 0.5) < 0.02);
    assert(Math.abs(frame.x + frame.width / 2 - board.x - board.width / 2) < 2);
    await s.page.screenshot({
      path: path.join(directory, "static-" + width + ".png"),
    });
    if (width === 320) {
      await s.action("choose").click();
      await s.page.waitForTimeout(1900);
      assert(await s.effect.isHidden());
    } else await s.effect.waitFor({ state: "hidden" });
    await s.clean();
  }
  const restored = await scenario("win", { ended: true });
  await restored.page.waitForTimeout(300);
  assert(
    await restored.effect.isHidden(),
    "restoring a terminal match does not replay",
  );
  await restored.clean();

  const paused = await scenario("win");
  await paused.trigger();
  await paused.page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert(await paused.effect.isHidden());
  await paused.page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await paused.page.waitForTimeout(300);
  assert(await paused.effect.isHidden(), "resume does not replay");
  await paused.action("undo").click();
  await paused.trigger();
  await paused.page.emulateMedia({ reducedMotion: "reduce" });
  await paused.effect.waitFor({ state: "hidden" });
  await paused.action("undo").click();
  await paused.trigger();
  await paused.page.locator("#gameExitButton").click();
  assert.equal(
    await paused.page.locator(".gomoku-result:not([hidden])").count(),
    0,
  );
  await paused.clean();
  console.log(
    "Gomoku result art: four outcomes, late win, gentle tracks, reduced motion, responsive layout, cleanup and terminal restore passed offline.",
  );
};

"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { pathToFileURL } = require("node:url");
const { chromium } = require("playwright"),
  { launchGame } = require("./game-test-helpers.cjs");
const data = { WorkTimeApp: { data: {} } };
vm.runInNewContext(fs.readFileSync("assets/data/sudoku.js", "utf8"), data);
(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const scenario of [
      { entry: "index.html", group: "easy", width: 1440 },
      { entry: "_site/index.html", group: "tenBox", width: 390 },
    ]) {
      const p = data.WorkTimeApp.data.sudoku.groups.find(
          (g) => g.id === scenario.group,
        ).puzzles[0],
        index = p.givens.lastIndexOf("0");
      const values = Array.from(p.solution, Number);
      values[index] = 0;
      const page = await browser.newPage({
          viewport: { width: scenario.width, height: 1000 },
          reducedMotion: "no-preference",
        }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.addInitScript(
        (save) => {
          localStorage.setItem("worktime.onboarding.v1", "dismissed");
          localStorage.setItem(
            "worktime.games.sudoku.v1",
            JSON.stringify(save),
          );
        },
        {
          version: 1,
          group: scenario.group,
          current: p.id,
          drafts: {
            [p.id]: {
              values,
              notes: Array(values.length).fill(0),
              elapsed: 10,
              hints: 0,
            },
          },
          completed: {},
        },
      );
      await page.goto(pathToFileURL(path.resolve(scenario.entry)).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await launchGame(page, "game-sudoku");
      await page.waitForFunction(
        () => document.getElementById("gameShell").dataset.state === "open",
      );
      const action = (id) => page.locator(`[data-sudoku-action="${id}"]`);
      assert.equal(await page.locator(".game-celebration").count(), 0);
      await action("pause").click();
      await page.locator(".game-pause-outgoing").waitFor({ state: "detached" });
      await action("cell-" + index).press(p.solution[index]);
      const layer = page.locator(".game-celebration-ribbons");
      await layer.waitFor();
      assert.equal(await layer.locator(".game-confetti").count(), 120);
      assert.equal(
        await layer.evaluate((el) => getComputedStyle(el).pointerEvents),
        "none",
      );
      const effect = await layer.boundingBox(),
        shell = await page.locator("#gameShell").boundingBox();
      for (const key of ["x", "y", "width", "height"])
        assert.ok(
          Math.abs(effect[key] - shell[key]) < 1,
          "layer fits game window",
        );
      const trajectories = await layer
        .locator(".game-confetti")
        .evaluateAll((pieces) =>
          pieces.map((piece) => {
            const animation = piece.getAnimations()[0];
            animation.pause();
            animation.currentTime = 1000;
            const frames = animation.effect.getKeyframes(),
              read = (frame) => new DOMMatrix(frame.transform).m41;
            return {
              start: read(frames[0]),
              end: read(frames.at(-1)),
              width: parseFloat(piece.style.width),
              height: parseFloat(piece.style.height),
              delay: animation.effect.getTiming().delay,
            };
          }),
        );
      for (let i = 0; i < trajectories.length; i++) {
        const t = trajectories[i];
        assert.ok(
          i % 2 ? t.start >= effect.width : t.start < 0,
          "fires from opposite edges",
        );
        assert.ok(
          t.end >= effect.width * 0.35 - 1 && t.end <= effect.width * 0.65 + 1,
          "travels toward center",
        );
        assert.ok(t.height > t.width, "ribbon shape");
      }
      assert.equal(
        new Set(trajectories.map((t) => t.delay)).size,
        3,
        "three waves",
      );
      fs.mkdirSync("test-results/sudoku-celebration", { recursive: true });
      await page.screenshot({
        path: `test-results/sudoku-celebration/${scenario.group}-${scenario.width}.png`,
      });
      const save = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("worktime.games.sudoku.v1")),
      );
      assert.ok(save.completed[p.id]);
      await layer
        .locator(".game-confetti")
        .evaluateAll((pieces) =>
          pieces.forEach((piece) =>
            piece.getAnimations().forEach((animation) => animation.finish()),
          ),
        );
      await layer.waitFor({ state: "detached" });
      await action("restart").click();
      await action("accept").click();
      assert.equal(
        await page.locator(".game-celebration").count(),
        0,
        "no celebration on restart",
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(
        ({ p, index }) => {
          for (let i = 0; i < p.givens.length; i++) {
            if (p.givens[i] !== "0") continue;
            const cell = document.querySelector(`[data-cell="${i}"]`);
            cell.click();
            cell.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: p.solution[i],
                bubbles: true,
                cancelable: true,
              }),
            );
          }
        },
        { p, index },
      );
      assert.equal(
        await page.locator(".game-celebration").count(),
        0,
        "respect reduced motion",
      );
      assert.equal(
        await page.locator(".sudoku-cover h3").textContent(),
        "本关完成！",
      );
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        scenario.entry +
          ": actual Sudoku win, 120 ribbons, both game-window edges to center, three waves, auto cleanup, restart and reduced motion passed",
      );
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

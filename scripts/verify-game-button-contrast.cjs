"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const site = path.resolve(process.argv[2] || path.join(__dirname, ".."));
(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    await page.route(/^https?:/, (route) => route.abort());
    await page.addInitScript(() => {
      const show = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function (...args) {
        const r = show.apply(this, args);
        if (this.id === "onboardingDialog") this.close();
        return r;
      };
    });
    await page.goto(pathToFileURL(path.join(site, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(async () => {
      for (const name of [
        "games",
        "gomoku",
        "xiangqi",
        "jump",
        "sokoban",
        "2048",
        "minesweeper",
        "sudoku",
      ])
        await WorkTimeApp.services.assets.style("assets/css/" + name + ".css");
      const host = document.createElement("div");
      host.id = "contrast-lab";
      host.className = "game-shell";
      host.style.cssText =
        "position:fixed;inset:0;z-index:99999;display:block;padding:24px;overflow:auto;background:var(--paper)";
      const entries = [
        [
          "gomoku-red",
          "game-gomoku",
          "",
          'data-gomoku-action="start-red"',
          false,
        ],
        [
          "gomoku-black",
          "game-gomoku",
          "",
          'data-gomoku-action="start-black"',
          false,
        ],
        [
          "xiangqi-red",
          "game-xiangqi",
          "",
          'data-xiangqi-action="start-red"',
          false,
        ],
        [
          "xiangqi-black",
          "game-xiangqi",
          "",
          'data-xiangqi-action="start-black"',
          false,
        ],
        ["jump", "game-jump", "jump-cover", "", false],
        [
          "sokoban",
          "game-sokoban",
          "sokoban-feedback",
          'data-sokoban-action="next"',
          false,
        ],
        [
          "2048",
          "game-puzzle",
          "puzzle-confirm",
          'data-puzzle-action="confirm"',
          false,
        ],
        ["mine", "game-minesweeper", "mine-result", "", false],
        ["selected", "game-sudoku", "", 'aria-pressed="true"', false],
        [
          "sudoku-toggle",
          "game-sudoku",
          "sudoku-actions",
          'aria-pressed="true"',
          false,
        ],
        ["ordinary", "game-sudoku", "", "", false],
        ["disabled", "game-gomoku", "", 'data-gomoku-action="start-red"', true],
      ];
      for (const [id, game, wrapper, attrs, disabled] of entries) {
        const section = document.createElement("section");
        section.className = "game-session " + game;
        // Keep component positioning out of this style-cascade fixture.
        section.style.cssText =
          "position:relative;display:inline-block;width:180px;height:100px;margin:8px;vertical-align:top";
        section.innerHTML = `<div class="${wrapper}" style="position:static;display:block;inset:auto;width:auto;height:auto;padding:0;background:none"><button id="contrast-${id}" class="game-button" ${attrs} ${disabled ? "disabled" : ""} style="width:170px;height:64px;position:static"><span>开始 · ${id}</span></button></div>`;
        host.append(section);
      }
      document.body.append(host);
    });
    async function colors(control) {
      return control.evaluate((el) => {
        const s = getComputedStyle(el),
          canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d");
        function rgb(color) {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        }
        function light(c) {
          const v = c.map((n) => {
            n /= 255;
            return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          });
          return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
        }
        const bg = rgb(s.backgroundColor),
          fg = rgb(s.color),
          a = light(bg),
          b = light(fg);
        return {
          bg,
          fg,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
    }
    const themes = await page.evaluate(() =>
      WorkTimeApp.domain.preferences.themes.map((t) => t.id),
    );
    for (const theme of themes) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      for (const name of [
        "gomoku-red",
        "gomoku-black",
        "xiangqi-red",
        "xiangqi-black",
        "jump",
        "sokoban",
        "2048",
        "mine",
        "selected",
        "sudoku-toggle",
        "ordinary",
      ]) {
        const button = page.locator("#contrast-" + name);
        await button.hover();
        await page.waitForTimeout(160);
        const hover = await colors(button);
        assert(
          hover.ratio >= 4.5,
          JSON.stringify({ theme, name, state: "hover", ...hover }),
        );
        if (name.endsWith("-red") || name.endsWith("-black")) {
          assert.deepEqual(hover.fg, [255, 255, 255]);
          assert(
            Math.max(...hover.bg) < 190,
            JSON.stringify({ theme, name, ...hover }),
          );
        }
        await page.mouse.down();
        const active = await colors(button);
        await page.mouse.up();
        assert(
          active.ratio >= 4.5,
          JSON.stringify({ theme, name, state: "active", ...active }),
        );
      }
      const disabled = page.locator("#contrast-disabled");
      await page.mouse.move(0, 0);
      const before = await colors(disabled);
      await disabled.hover();
      const after = await colors(disabled);
      assert.deepEqual(after, before, "disabled buttons retain appearance");
    }
    const output = path.resolve(
      __dirname,
      "../test-results/game-button-contrast.png",
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output });
    console.log(
      "12 themes: hover and pressed contrast >= 4.5:1 for game buttons; dark red/black starts and disabled states passed offline.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

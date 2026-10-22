"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL, fileURLToPath } = require("node:url");
const budgets = require("./performance-budgets.json");
const { chromium } = require("playwright");
const root = path.resolve(process.argv[2] || ".");
const entry = pathToFileURL(path.join(root, "index.html")).href;
async function ready(page) {
  await page.goto(entry);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading"),
  );
}
async function verify() {
  const initialSizes = [];
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ko", "ja"]) {
      const context = await browser.newContext({
        locale: language,
        reducedMotion: "reduce",
      });
      try {
        await context.route(/^https?:/, (route) => route.abort());
        const page = await context.newPage(),
          requests = [],
          errors = [];
        page.on("request", (request) => requests.push(request.url()));
        page.on("pageerror", (error) => errors.push(error.message));
        await ready(page);
        const initialScripts = [
          ...new Set(
            requests
              .filter((url) => /\.js(?:\?|$)/.test(url))
              .map((url) => fileURLToPath(url)),
          ),
        ];
        const bytes = initialScripts.reduce(
          (sum, file) => sum + fs.statSync(file).size,
          0,
        );
        initialSizes.push({ language, bytes });
        assert.ok(
          bytes <= budgets.sourceJavaScriptBytes,
          "actual initial language resources exceed the JavaScript budget: " +
            language,
        );
        assert.equal(
          await page.evaluate(() => WorkTimeApp.i18n.language),
          language,
        );
        assert.deepEqual(
          await page.evaluate(() =>
            Object.keys(WorkTimeApp.data.locales).sort(),
          ),
          [...new Set(["zh-CN", language])].sort(),
        );
        assert.equal(
          requests.filter((url) =>
            /\/games\/(?!catalog|registry|menu|ui)[^/]+\.js|\/data\/(?:sudoku|sokoban)\.js|\/css\/(?:2048|minesweeper|snake|sudoku|jump|sokoban|link|garden|tank)\.css/.test(
              url,
            ),
          ).length,
          0,
          "initial work view must not load game implementations, rules, data or styles",
        );
        assert.equal(
          await page.evaluate(() => WorkTimeApp.games.list().length),
          9,
        );
        await page.evaluate(async () => {
          await WorkTimeApp.i18n.setLanguage("ja");
          await WorkTimeApp.i18n.setLanguage("en");
          await WorkTimeApp.i18n.setLanguage("ja");
        });
        for (const id of ["en", "ja"])
          assert.equal(
            requests.filter((url) =>
              new RegExp("/locales/runtime/" + id + "\\.js(?:\\?|$)").test(url),
            ).length,
            1,
            "language resources are deduplicated",
          );
        if (language === "zh-CN") {
          let failStyle = true;
          await page.route(/\/css\/garden\.css(?:\?|$)/, async (route) => {
            if (failStyle) {
              failStyle = false;
              await route.abort();
            } else await route.continue();
          });
          assert.equal(
            await page.evaluate(async () => {
              try {
                await WorkTimeApp.games.load("game-garden");
                return false;
              } catch {
                return true;
              }
            }),
            true,
            "a failed style rejects game loading",
          );
          await page.evaluate(() => WorkTimeApp.games.load("game-garden"));
          assert.equal(
            requests.filter((url) => /\/css\/garden\.css/.test(url)).length,
            2,
            "failed resources are retried even when the game script registered",
          );
          assert.equal(
            requests.filter((url) => /\/games\/garden\.js/.test(url)).length,
            1,
            "successful scripts are not re-executed on retry",
          );
          let requested;
          const started = new Promise((resolve) => {
            requested = resolve;
          });
          await page.route(/\/games\/snake\.js(?:\?|$)/, async (route) => {
            requested();
            await new Promise((resolve) => setTimeout(resolve, 200));
            await route.continue();
          });
          await page.locator("#date-tab-games").click();
          await page.locator('#gamesPanel [data-game="game-snake"]').click();
          await started;
          await page.locator("#gameExitButton").click();
          await page.waitForTimeout(300);
          assert.equal(
            await page.locator("#gameShell").getAttribute("data-state"),
            "closed",
          );
          assert.equal(
            await page.locator(".game-snake").count(),
            0,
            "a cancelled load must not mount a game after exit",
          );
          await page.locator('#gamesPanel [data-game="game-snake"]').click();
          await page.locator(".game-snake").waitFor();
          await page.evaluate(() => WorkTimeApp.games.prepareArchive());
          assert.equal(
            requests.some((url) => /\/data\/sudoku\.js/.test(url)),
            true,
          );
          if (root.endsWith("_site")) {
            const dynamic = requests.filter((url) =>
              /\/locales\/runtime\/(?!zh-CN)|\/games\/(?:snake|garden|.*-rules)\.js|\/data\/(?:sudoku|sokoban)\.js|\/css\/(?:snake|garden)\.css/.test(
                url,
              ),
            );
            assert.ok(
              dynamic.every((url) => /[?&]v=[a-f0-9]{16}/.test(url)),
              "published dynamic assets must carry content hashes",
            );
          }
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
    const context = await browser.newContext({
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await context.route(/^https?:/, (route) => route.abort());
      await ready(page);
      await page.route(/\/runtime\/en\.js(?:\?|$)/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        await route.continue();
      });
      assert.equal(
        await page.evaluate(async () => {
          await Promise.all([
            WorkTimeApp.i18n.setLanguage("en"),
            WorkTimeApp.i18n.setLanguage("ja"),
          ]);
          return WorkTimeApp.i18n.language;
        }),
        "ja",
        "slow earlier language requests must not override the latest choice",
      );
      await page.route(/\/runtime\/zh-TW\.js(?:\?|$)/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        await route.continue();
      });
      assert.equal(
        await page.evaluate(async () => {
          const preferences = WorkTimeApp.services.preferences.page;
          await Promise.all([
            preferences.saveLanguage("zh-TW"),
            preferences.saveLanguage("zh-HK"),
          ]);
          return preferences.state.language;
        }),
        "zh-HK",
        "slow preference saves must not replace the latest language choice",
      );
      let failLanguage = true;
      await page.route(/\/runtime\/ko\.js(?:\?|$)/, async (route) => {
        if (failLanguage) {
          failLanguage = false;
          await route.abort();
        } else await route.continue();
      });
      assert.equal(
        await page.evaluate(
          async () =>
            (await WorkTimeApp.services.preferences.page.saveLanguage("ko"))
              .persisted,
        ),
        false,
      );
      assert.equal(
        await page.evaluate(() => WorkTimeApp.i18n.language),
        "zh-HK",
        "failed loads preserve the displayed language",
      );
      assert.equal(
        await page.evaluate(
          async () =>
            (await WorkTimeApp.services.preferences.page.saveLanguage("ko"))
              .persisted,
        ),
        true,
      );
      assert.equal(await page.evaluate(() => WorkTimeApp.i18n.language), "ko");
    } finally {
      await context.close();
    }
    const failedContext = await browser.newContext({
      locale: "en",
      reducedMotion: "no-preference",
    });
    try {
      await failedContext.route(/^https?:/, (route) => route.abort());
      await failedContext.route(/\/runtime\/en\.js(?:\?|$)/, (route) =>
        route.abort(),
      );
      const page = await failedContext.newPage();
      await page.addInitScript(() => {
        window.failureBackgroundDraws = 0;
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (...args) {
          if (this.canvas.id === "particleBg") window.failureBackgroundDraws++;
          return clear.apply(this, args);
        };
      });
      await page.goto(entry);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "failed",
      );
      assert.equal(
        await page.locator("#startupFailure").isVisible(),
        true,
        "a missing initial catalog must reveal a startup error",
      );
      assert.equal(
        await page
          .locator(
            "button:enabled,input:enabled,select:enabled,textarea:enabled",
          )
          .count(),
        0,
        "failed startup must not accept edits",
      );
      const draws = await page.evaluate(() => window.failureBackgroundDraws);
      await page.waitForTimeout(120);
      assert.equal(
        await page.evaluate(() => window.failureBackgroundDraws),
        draws,
        "failed startup must not leave decorative animation running",
      );
    } finally {
      await failedContext.close();
    }
    const converterContext = await browser.newContext({ locale: "en" });
    try {
      await converterContext.route(/^https?:/, (route) => route.abort());
      const page = await converterContext.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        pathToFileURL(path.join(root, "tools/convert-backup.html")).href,
      );
      await page.evaluate(() => WorkTimeApp.i18n.ready);
      const input = await page.evaluate(() =>
        JSON.stringify(WorkTimeApp.domain.state.defaultState()),
      );
      await page.locator("#backupInput").fill(input);
      await page.locator("#convert").click();
      await page.waitForFunction(
        () => !document.querySelector("#download").disabled,
      );
      assert.equal(
        JSON.parse(await page.locator("#backupOutput").inputValue()).format,
        "worktime-archive",
        "standalone offline conversion must retain the shared domain API",
      );
      assert.deepEqual(errors, []);
    } finally {
      await converterContext.close();
    }
    console.log(
      "Six offline initial languages, lazy game resources, hash versions, retries, cancellation and language races verified.",
    );
    console.log({ initialSizes });
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

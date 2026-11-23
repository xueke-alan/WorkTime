"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
const { launchGame } = require("./game-test-helpers.cjs");
const root = path.resolve(__dirname, "..");
const site = path.resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) || root,
);

(async () => {
  const server = process.argv.includes("--http")
    ? await runtimeServer(site)
    : null;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      (server?.url || pathToFileURL(path.join(site, "index.html")).href) +
        "#dev",
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    assert.equal(
      await page.evaluate(() => !!WorkTimeApp.services.vocabularySpeech),
      false,
      "Footer must not load speech or its model",
    );
    assert.equal(
      await page.locator(".calendar-footer .site-audio-activity").isVisible(),
      false,
    );
    // Exercise the complete speech -> idle -> footer -> open tooltip path.
    // Only inference is replaced; do not override status/currentWord/state.
    await page.evaluate(async () => {
      const services = WorkTimeApp.services;
      services.vocabularyIdle.configure({ paused: true, poolSize: 4 });
      await services.vocabularyIdle.load();
      window.footerObservedPhases = [];
      services.vocabularySpeech.subscribe(() => {
        window.footerObservedPhases.push(services.vocabularySpeech.phase);
      });
      const assets = services.assets,
        NativeWorker = window.Worker;
      services.assets = {
        ...assets,
        scripts: async (paths) => {
          if (paths.includes("assets/vendor/vocabulary/manifest.js")) {
            const empty = {
              bytes: 0,
              sha256: await services.vocabularyAudioCache.hash(
                new Uint8Array(),
              ),
              parts: [],
            };
            WorkTimeApp.data.vocabularySpeech = {
              groups: { supertonic: [] },
              files: { mjs: empty, wasm: empty },
            };
            WorkTimeApp.data.vocabularyWorkers = {
              supertonic: "// footer test worker",
            };
          } else await assets.scripts(paths);
        },
      };
      window.Worker = class {
        terminate() {}
        postMessage(data) {
          if (data.type === "init")
            window.finishFooterInitialization = () =>
              this.onmessage({ data: { id: data.id, type: "ready" } });
          else
            window.finishFooterInference = () =>
              this.onmessage({
                data: {
                  id: data.id,
                  type: "error",
                  message: "fixture failure",
                },
              });
        }
      };
      window.footerInference = services.vocabularySpeech
        .synthesize({ word: "footer-inference-fixture" }, "us")
        .catch((error) => error.message);
      window.restoreFooterInference = () => {
        services.vocabularySpeech.release();
        services.assets = assets;
        window.Worker = NativeWorker;
      };
    });
    const realActivity = page.locator(".calendar-footer .site-audio-activity");
    await page.waitForFunction(() => !!window.finishFooterInitialization);
    await page.waitForFunction(() =>
      document
        .querySelector(".calendar-footer .site-audio-activity")
        .dataset.dateMarkerHint.includes("正在初始化语音模型"),
    );
    await realActivity.hover();
    await page.locator("#siteHint").waitFor({ state: "visible" });
    assert.match(
      await page.locator("#siteHint").innerText(),
      /^正在初始化语音模型\nWorker: 4\n\? \/ \d+$/,
    );
    const loadingBounds = await page.locator("#siteHint").boundingBox();
    assert(Math.abs(loadingBounds.width - 144) < 0.5);
    assert(Math.abs(loadingBounds.height - 68) < 0.5);
    await page.evaluate(() => window.finishFooterInitialization());
    await page.waitForFunction(() =>
      document
        .querySelector(".calendar-footer .site-audio-activity")
        .dataset.dateMarkerHint.startsWith("footer-inference-fixture\n"),
    );
    await page.locator("#siteHint").waitFor({ state: "visible" });
    assert.match(
      await page.locator("#siteHint").innerText(),
      /^footer-inference-fixture\nWorker: 4\n\? \/ \d+$/,
    );
    const generatingBounds = await page.locator("#siteHint").boundingBox();
    assert(Math.abs(generatingBounds.width - loadingBounds.width) < 0.5);
    assert(Math.abs(generatingBounds.height - loadingBounds.height) < 0.5);
    const observed = await page.evaluate(() => window.footerObservedPhases);
    for (const phase of [
      "checkingFiles",
      "checkingBrowser",
      "loadingResources",
      "initializingModel",
      "generating",
    ])
      assert(observed.includes(phase), "Speech lifecycle reports " + phase);
    await page.evaluate(async () => {
      window.finishFooterInference();
      await window.footerInference;
      window.restoreFooterInference();
    });
    await page.keyboard.press("Escape");
    await page.locator("#siteHint").waitFor({ state: "hidden" });
    await page.mouse.move(0, 0);
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.vocabularySpeech.currentWord,
      ),
      "",
    );
    // Drive real service notifications without loading a speech model.
    await page.evaluate(async () => {
      const idle = WorkTimeApp.services.vocabularyIdle;
      idle.configure({ paused: true });
      await idle.load();
      window.footerPhase = "generating";
      Object.defineProperty(WorkTimeApp.services.vocabularySpeech, "status", {
        configurable: true,
        get: () => window.footerPhase,
      });
      Object.defineProperty(WorkTimeApp.services.vocabularySpeech, "phase", {
        configurable: true,
        get: () => window.footerPhase,
      });
      WorkTimeApp.services.vocabularySpeech.release();
    });
    const center = page.locator(".calendar-footer .site-audio-activity");
    assert(await center.isVisible());
    assert.match(
      await center.getAttribute("data-date-marker-hint"),
      /^[^\n]+\nWorker: 4\n\? \/ \d+$/,
    );
    await page.evaluate(() => {
      const idle = WorkTimeApp.services.vocabularyIdle;
      window.footerStateDescriptor = Object.getOwnPropertyDescriptor(
        idle,
        "state",
      );
      window.footerCompleted = 12;
      window.footerWord = "apple";
      Object.defineProperty(idle, "state", {
        configurable: true,
        get: () => ({
          ...window.footerStateDescriptor.get(),
          available: true,
          audioGenerating: window.footerBusy !== false,
          indexStatus: window.footerIndexStatus || "ready",
          generatedTotal: window.footerCompleted,
          audioTotal: 100,
          currentWord: window.footerWord,
          audioPhase:
            window.footerPhaseOverride ||
            (window.footerWord ? "generating" : "checkingFiles"),
        }),
      });
      idle.configure({ paused: true });
    });
    assert.equal(
      await center.getAttribute("title"),
      null,
      "No native browser tooltip",
    );
    await center.hover();
    await page.locator("#siteHint").waitFor({ state: "visible" });
    assert.equal(
      await page.locator("#siteHint").innerText(),
      "apple\nWorker: 4\n12 / 100",
    );
    await page.evaluate(() => {
      window.footerCompleted = 13;
      window.footerWord = "banana";
      WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
    });
    await page.waitForFunction(
      () =>
        document.getElementById("siteHint").innerText ===
        "banana\nWorker: 4\n13 / 100",
    );
    assert.equal(
      await center.getAttribute("aria-label"),
      "banana\nWorker: 4\n13 / 100",
    );
    await page.evaluate(async () => {
      window.footerDetailChanges = [];
      window.footerProgressChanges = [];
      window.footerLastDetail = window.footerWord;
      const activity = document.querySelector(
        ".calendar-footer .site-audio-activity",
      );
      window.footerDetailObserver = new MutationObserver(() => {
        const detail = activity.dataset.dateMarkerHint.split("\n")[0];
        if (detail !== window.footerLastDetail)
          window.footerDetailChanges.push(detail);
        const progress = activity.dataset.dateMarkerHint.split("\n")[2];
        if (progress !== "13 / 100")
          window.footerProgressChanges.push(progress);
        window.footerLastDetail = detail;
      });
      window.footerDetailObserver.observe(activity, {
        attributes: true,
        attributeFilter: ["data-date-marker-hint"],
      });
      for (const phase of [
        "checkingFolder",
        "loadingAssets",
        "checkingFiles",
        "checkingBrowser",
        "ready",
        "betweenWords",
      ]) {
        window.footerPhaseOverride = phase;
        WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      window.footerPhaseOverride = "generating";
      window.footerWord = "orange";
      WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
      window.footerDetailObserver.disconnect();
      window.footerPhaseOverride = "";
    });
    assert.deepEqual(
      await page.evaluate(() => window.footerDetailChanges),
      ["orange"],
      "Brief intermediate phases never replace the word",
    );
    assert.deepEqual(
      await page.evaluate(() => window.footerProgressChanges),
      [],
      "Known progress stays numeric across batch preparation and ready phases",
    );
    await page.evaluate(() => {
      window.footerWord = "";
      WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
    });
    await page.waitForFunction(
      () =>
        document.getElementById("siteHint").innerText ===
        "正在检查文件缓存\nWorker: 4\n13 / 100",
    );
    await page.evaluate(() => {
      window.footerPhaseOverride = "ready";
      WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
    });
    await page.waitForFunction(
      () =>
        document.getElementById("siteHint").innerText ===
        "语音模型已就绪\nWorker: 4\n13 / 100",
    );
    await page.evaluate(() => {
      window.footerIndexStatus = "rebuilding";
      window.footerPhaseOverride = "indexingCache";
      window.footerCompleted = 0;
      WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
    });
    await page.waitForFunction(() =>
      document
        .getElementById("siteHint")
        .innerText.endsWith("\nWorker: 4\n? / 100"),
    );
    await page.evaluate(() => {
      window.footerIndexStatus = "ready";
      window.footerPhaseOverride = "generating";
      WorkTimeApp.services.vocabularyIdle.configure({
        paused: true,
        poolSize: 2,
      });
    });
    await page.waitForFunction(() =>
      document
        .getElementById("siteHint")
        .innerText.endsWith("\nWorker: 2\n0 / 100"),
    );
    await page.evaluate(() => {
      window.footerPhaseOverride = "";
      window.footerCompleted = 13;
      WorkTimeApp.services.vocabularyIdle.configure({
        paused: true,
        poolSize: 4,
      });
    });
    const preparingBounds = await page.locator("#siteHint").boundingBox();
    assert(Math.abs(preparingBounds.width - loadingBounds.width) < 0.5);
    assert(Math.abs(preparingBounds.height - loadingBounds.height) < 0.5);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert(
      await page.evaluate(async () => {
        const activity = document.querySelector(
          ".calendar-footer .site-audio-activity",
        );
        const spinner = activity.querySelector(".site-audio-spinner");
        const frame = () => new Promise(requestAnimationFrame);
        await frame();
        const animation = spinner.getAnimations()[0];
        if (!animation) return false;
        const started = animation.currentTime;
        for (const phase of [
          "indexingCache",
          "checkingFiles",
          "savingFiles",
          "generating",
          "betweenWords",
        ]) {
          window.footerBusy = false;
          window.footerPhaseOverride = phase;
          WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
          await frame();
          if (
            spinner.getAnimations()[0] !== animation ||
            getComputedStyle(spinner).animationPlayState !== "running" ||
            getComputedStyle(spinner).opacity !== "1"
          )
            return false;
        }
        window.footerBusy = true;
        window.footerPhaseOverride = "";
        WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
        await frame();
        return animation.currentTime > started;
      }),
      "Spinner runs continuously across indexing and worker idle gaps",
    );
    await page.evaluate(() => {
      window.footerWord =
        "a very long vocabulary phrase that exceeds the tooltip width";
      WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
    });
    await page.waitForFunction(() =>
      document
        .getElementById("siteHint")
        .children[0].textContent.includes("a very long"),
    );
    assert.equal(
      await page
        .locator("#siteHint > span")
        .nth(0)
        .evaluate((node) => node.getAnimations().length > 0),
      true,
      "Word changes animate without resizing the tooltip",
    );
    const longBounds = await page.locator("#siteHint").boundingBox();
    assert(Math.abs(longBounds.width - loadingBounds.width) < 0.5);
    assert(Math.abs(longBounds.height - loadingBounds.height) < 0.5);
    assert.equal(
      await page
        .locator("#siteHint > span:first-child > span")
        .evaluate((node) => {
          const animation = node.getAnimations()[0];
          return (
            node.scrollWidth > node.parentElement.clientWidth &&
            animation?.effect.getTiming().iterations === Infinity
          );
        }),
      true,
      "Overflowing phrases scroll repeatedly within the fixed word row",
    );
    await page.evaluate(() => {
      window.footerWord = "short";
      WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#siteHint > span:first-child > span")
          .textContent === "short",
    );
    assert.equal(
      await page
        .locator("#siteHint > span:first-child > span")
        .evaluate((node) => node.getAnimations().length),
      0,
      "Short words reset scrolling",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator("#siteHint")
        .evaluate((el) => getComputedStyle(el).whiteSpace),
      "pre-line",
    );
    const beforeTransition = await center.getAttribute("data-date-marker-hint");
    await page.evaluate(() => {
      const activity = document.querySelector(
        ".calendar-footer .site-audio-activity",
      );
      window.footerVisibilityChanges = [];
      window.footerVisibilityObserver = new MutationObserver((records) => {
        window.footerVisibilityChanges.push(...records);
      });
      window.footerVisibilityObserver.observe(activity, {
        attributes: true,
        attributeFilter: ["hidden"],
      });
      window.footerPhaseOverride = "betweenWords";
      for (let i = 0; i < 20; i++)
        WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
    });
    assert(
      await center.isVisible(),
      "Inter-word transitions keep the indicator visible",
    );
    assert.equal(
      await center.getAttribute("data-date-marker-hint"),
      beforeTransition,
    );
    assert(
      await page.locator("#siteHint").isVisible(),
      "Inter-word transitions keep the tooltip open",
    );
    assert.equal(
      await page.evaluate(() => {
        window.footerVisibilityObserver.disconnect();
        return window.footerVisibilityChanges.length;
      }),
      0,
      "Inter-word notifications never toggle visibility",
    );
    for (const phase of [
      "waitingIdle",
      "waitingInput",
      "waitingDrag",
      "waitingGame",
      "waitingPlayback",
      "otherTab",
    ]) {
      await page.evaluate((value) => {
        window.footerPhaseOverride = value;
        WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
      }, phase);
      assert.equal(await center.isVisible(), false, phase + " stays hidden");
    }
    await page.locator("#siteHint").waitFor({ state: "hidden" });
    for (const phase of ["savingFiles", "savingBrowser"]) {
      await page.evaluate((value) => {
        window.footerPhaseOverride = value;
        window.footerWord = "apple";
        WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
      }, phase);
      assert.equal(
        await center.getAttribute("aria-label"),
        "apple\nWorker: 4\n13 / 100",
        "Saving keeps the word without a status prefix",
      );
    }
    await page.evaluate(() => {
      window.footerPhaseOverride = "checkingFiles";
      WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
    });
    assert(
      await center.isVisible(),
      "Active cache checks restore the indicator",
    );
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      Object.defineProperty(
        WorkTimeApp.services.vocabularyIdle,
        "state",
        window.footerStateDescriptor,
      );
      WorkTimeApp.services.vocabularyIdle.configure({ paused: true });
    });
    await page.evaluate(() => WorkTimeApp.ui.vocabulary.open());
    assert.equal(await page.locator(".vocabulary-speech-activity").count(), 0);
    assert(await center.isVisible());
    await launchGame(page, "game-2048");

    async function verifyShell(id, contentSelector) {
      await page.locator(`${id}[data-state="open"]`).waitFor();
      const footer = page.locator(`${id} > .workspace-footer`);
      assert.equal(await footer.count(), 1);
      assert(await footer.isVisible());
      assert(await footer.locator(".site-audio-activity").isVisible());
      assert.equal(await footer.locator("[id]").count(), 0);
      await page.mouse.move(0, 0);
      assert.equal(
        await footer
          .locator(".site-meta")
          .evaluate((el) => getComputedStyle(el).opacity),
        "0.6",
      );
      await footer.hover();
      await page.waitForTimeout(200);
      assert.equal(
        await footer
          .locator(".site-meta")
          .evaluate((el) => getComputedStyle(el).opacity),
        "1",
      );
      await page.mouse.move(0, 0);
      await footer.locator("a").focus();
      await page.waitForTimeout(200);
      assert.equal(
        await footer
          .locator(".site-meta")
          .evaluate((el) => getComputedStyle(el).opacity),
        "1",
      );
      const bounds = await footer.boundingBox();
      const content = await page
        .locator(`${id} ${contentSelector}`)
        .boundingBox();
      assert(
        content.y + content.height <= bounds.y + 1,
        "Footer must not cover content",
      );
      const shell = await page.locator(id).boundingBox();
      assert(bounds.y + bounds.height <= shell.y + shell.height + 1);
    }

    await verifyShell("#gameShell", ".game-content");
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    await page.evaluate(() => WorkTimeApp.ui.typing.open());
    await verifyShell("#typingDialog", ".typing-main");
    await page.locator("#typingExitButton").click();
    await page.locator("#typingDialog").waitFor({ state: "hidden" });
    await page.evaluate(() => WorkTimeApp.ui.music.open());
    await verifyShell("#musicDialog", ".music-main");
    fs.mkdirSync(path.join(root, ".cache/footer"), { recursive: true });
    await page.screenshot({ path: path.join(root, ".cache/footer/music.png") });
    await page.evaluate(() => WorkTimeApp.ui.music.close());
    await page.locator("#musicDialog").waitFor({ state: "hidden" });
    const hasReader = fs.existsSync(
      path.join(site, "assets/js/ui/reader-runtime.min.js"),
    );
    // Published builds intentionally omit the dormant reading workspace.
    if (hasReader) {
      await page.evaluate(async () => {
        await WorkTimeApp.services.assets.style("assets/css/reader.css");
        await WorkTimeApp.services.assets.script(
          "assets/js/ui/reader-runtime.min.js",
        );
        await WorkTimeApp.ui.reader.open();
      });
      await verifyShell("#readerDialog", ".reader-main");
      await page.locator("#readerFullscreen").click();
      await page.waitForFunction(() => !!document.fullscreenElement);
      assert(await page.locator("#readerDialog .workspace-footer").isVisible());
      await page.evaluate(() => document.exitFullscreen());
    } else {
      await page.evaluate(() => WorkTimeApp.ui.typing.open());
      await verifyShell("#typingDialog", ".typing-main");
    }
    const activeShell = hasReader ? "#readerDialog" : "#typingDialog";
    for (const phase of ["loading", "generating", "ready", "idle", "error"]) {
      await page.evaluate((value) => {
        window.footerPhase = value;
        WorkTimeApp.services.vocabularySpeech.release();
      }, phase);
      assert.equal(
        await page.locator(`${activeShell} .site-audio-activity`).isVisible(),
        ["loading", "generating"].includes(phase),
        "Paused caching only shows active foreground loading or synthesis",
      );
      if (phase === "loading") {
        await page.waitForFunction(() =>
          document
            .querySelector(".calendar-footer .site-audio-activity")
            .getAttribute("aria-label")
            .includes("正在加载语音模型"),
        );
        assert.match(
          await page
            .locator(`${activeShell} .site-audio-activity`)
            .getAttribute("aria-label"),
          /^正在加载语音模型\n/,
        );
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const footer = await page
      .locator(`${activeShell} .workspace-footer`)
      .boundingBox();
    assert(footer.x >= 0 && footer.x + footer.width <= 391);
    assert(footer.y + footer.height <= 845);
    assert.deepEqual(errors, []);
    console.log(
      "Shared footer, lazy audio state, all expanded modes, hover/focus and narrow layout verified.",
    );
    await context.close();
  } finally {
    await browser.close();
    await server?.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

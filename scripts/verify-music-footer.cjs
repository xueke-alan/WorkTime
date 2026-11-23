"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const {
  installRuntimeFixture,
  runtimeServer,
} = require("./runtime-test-helpers.cjs");
const { launchGame } = require("./game-test-helpers.cjs");
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
function wav() {
  const buffer = Buffer.alloc(44 + 8000 * 120 * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
}
(async () => {
  const server = await runtimeServer(root);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await context.addInitScript(installRuntimeFixture);
    await context.addInitScript(() => {
      const NativeAudio = window.Audio;
      window.footerTestAudio = [];
      window.Audio = function (...args) {
        const audio = new NativeAudio(...args);
        window.footerTestAudio.push(audio);
        return audio;
      };
      window.Audio.prototype = NativeAudio.prototype;
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.url);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const calendar = page.locator(".calendar-footer .site-music-controls");
    assert.equal(await calendar.isVisible(), false);
    assert.equal(await page.evaluate(() => window.footerTestAudio.length), 0);
    await page.waitForFunction(
      () => WorkTimeApp.services.runtimeFolder.state.status === "available",
    );
    await page.locator("#musicOpen").click();
    await page.locator('#musicDialog[data-state="open"]').waitFor();
    await page
      .locator('#musicDialog [data-runtime-import="files"]')
      .setInputFiles([
        { name: "A.wav", mimeType: "audio/wav", buffer: wav() },
        {
          name: "B-这是一首很长的歌曲名称-Long-track-title-for-seamless-scrolling.wav",
          mimeType: "audio/wav",
          buffer: wav(),
        },
      ]);
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".music-track").length === 2 &&
        !document.querySelector("#musicPlay").disabled,
    );
    assert.equal(
      await calendar.isVisible(),
      false,
      "Import alone does not show playback controls",
    );
    await page.locator("#musicPlay").click();
    await page.waitForFunction(() => !window.footerTestAudio[0].paused);
    await page.locator("#musicMinimize").click();
    await page.locator("#musicDialog").waitFor({ state: "hidden" });
    await calendar.waitFor();
    const nameLayout = await calendar
      .locator(".site-music-name")
      .evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        align: getComputedStyle(el).textAlign,
      }));
    assert.equal(nameLayout.align, "right");
    assert(nameLayout.width < 30, "Short names use their content width");
    assert.deepEqual(
      await calendar
        .locator("button use")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))),
      ["#ms-skip-previous-light", "#ms-pause-light", "#ms-skip-next-light"],
    );
    assert.equal(
      await page
        .locator("#ms-skip-previous-light, #ms-skip-next-light")
        .count(),
      2,
    );
    assert.equal(
      await calendar.locator(".site-music-name").getAttribute("title"),
      "A",
    );
    assert.equal(
      await calendar.locator(".site-music-name.is-scrolling").count(),
      0,
    );
    await calendar.locator('[data-music-action="toggle"]').click();
    await page.waitForFunction(() => window.footerTestAudio[0].paused);
    await calendar
      .locator('[data-music-action="toggle"][data-glyph="play"]')
      .waitFor();
    assert(await calendar.isVisible(), "Paused controls remain visible");
    assert.equal(
      await calendar
        .locator('[data-music-action="toggle"]')
        .getAttribute("data-glyph"),
      "play",
    );
    await calendar.locator('[data-music-action="toggle"]').focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !window.footerTestAudio[0].paused);
    await calendar.locator('[data-music-action="next"]').click();
    await calendar.locator(".site-music-name.is-scrolling").waitFor();
    const animation = await calendar
      .locator(".site-music-name-track")
      .evaluate((el) => {
        const value = el.getAnimations()[0];
        window.footerTestAnimation = value;
        return value.effect.getTiming().iterations;
      });
    assert.equal(animation, Infinity);
    await page.evaluate(() =>
      window.footerTestAudio[0].dispatchEvent(new Event("timeupdate")),
    );
    assert(
      await calendar
        .locator(".site-music-name-track")
        .evaluate((el) => el.getAnimations()[0] === window.footerTestAnimation),
      "Time updates preserve marquee animation",
    );
    await page.evaluate(() =>
      WorkTimeApp.services.preferences.page.saveMotionMode("reduce"),
    );
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".calendar-footer .site-music-name")
          .classList.contains("is-scrolling"),
    );
    assert.equal(
      await calendar
        .locator(".site-music-name-track")
        .evaluate((el) => el.getAnimations().length),
      0,
    );
    await page.evaluate(() =>
      WorkTimeApp.services.preferences.page.saveMotionMode("full"),
    );
    await calendar.locator(".site-music-name.is-scrolling").waitFor();
    const output = path.join(root, "test-results/music-footer");
    fs.mkdirSync(output, { recursive: true });
    await page
      .locator(".calendar-footer")
      .screenshot({ path: path.join(output, "calendar.png") });
    await launchGame(page, "game-2048");
    const game = page.locator(
      "#gameShell .workspace-footer .site-music-controls",
    );
    await game.waitFor();
    const gameHeight = await game.evaluate((el) => {
      const footer = el.closest("footer");
      const visible = footer.getBoundingClientRect().height;
      el.hidden = true;
      const hidden = footer.getBoundingClientRect().height;
      el.hidden = false;
      return { visible, hidden };
    });
    assert.equal(
      gameHeight.visible,
      gameHeight.hidden,
      "Music must not change expanded footer height",
    );
    assert.equal(
      await game.locator(".site-music-name").getAttribute("title"),
      await calendar.locator(".site-music-name").getAttribute("title"),
    );
    await game.locator('[data-music-action="toggle"]').click();
    await page.waitForFunction(() => window.footerTestAudio[0].paused);
    await game
      .locator('[data-music-action="toggle"][data-glyph="play"]')
      .waitFor();
    assert.equal(
      await calendar
        .locator('[data-music-action="toggle"]')
        .getAttribute("data-glyph"),
      "play",
    );
    await game.locator('[data-music-action="previous"]').click();
    await page.waitForFunction(
      () =>
        document.querySelector(".calendar-footer .site-music-name").title ===
        "A",
    );
    assert.equal(
      await game.locator(".site-music-name").getAttribute("title"),
      "A",
    );
    await page.locator("#gameExitButton").click();
    await page.locator("#gameShell").waitFor({ state: "hidden" });
    for (const width of [1440, 1024, 700, 699, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const heights = await calendar.evaluate((el) => {
        const footer = el.closest(".calendar-footer");
        const visible = footer.getBoundingClientRect().height;
        el.hidden = true;
        const hidden = footer.getBoundingClientRect().height;
        el.hidden = false;
        return { visible, hidden };
      });
      assert.equal(
        heights.visible,
        heights.hidden,
        "Music must not change calendar footer height",
      );
      assert(
        await page
          .locator(".calendar-footer")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      assert(
        await calendar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await page
        .locator(".calendar-footer")
        .screenshot({ path: path.join(output, `footer-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator("#monthTitle").click();
    await page.locator("#yearLegend:not(.hidden)").waitFor();
    const yearHeights = await calendar.evaluate((el) => {
      const footer = el.closest(".calendar-footer");
      const visible = footer.getBoundingClientRect().height;
      el.hidden = true;
      const hidden = footer.getBoundingClientRect().height;
      el.hidden = false;
      return { visible, hidden };
    });
    assert.equal(
      yearHeights.visible,
      yearHeights.hidden,
      "Music must not change year footer height",
    );
    await page
      .locator(".calendar-footer")
      .screenshot({ path: path.join(output, "year.png") });
    assert.equal(await page.evaluate(() => window.footerTestAudio.length), 1);
    for (const language of ["en", "zh-TW", "ja", "ko", "zh-CN"]) {
      await page.evaluate(
        (value) => WorkTimeApp.i18n.setLanguage(value),
        language,
      );
      assert.equal(
        await calendar
          .locator('[data-music-action="next"]')
          .getAttribute("aria-label"),
        await page.evaluate(() => WorkTimeApp.ui.musicText("next")),
      );
    }
    // Exercise bridge teardown, clearing, and remounting without another audio instance.
    const lifecycle = await page.evaluate(() => {
      const listeners = new Set();
      const state = { tracks: [{}], current: { title: "Test" }, paused: false };
      const disconnect = WorkTimeApp.ui.footerPlayback.connect({
        snapshot: () => state,
        subscribe: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      });
      const host = document.createElement("section");
      document.body.append(host);
      const dispose = WorkTimeApp.ui.createSiteFooter(host, true);
      const appeared = !host.querySelector(".site-music-controls").hidden;
      state.tracks = [];
      state.current = null;
      for (const fn of listeners) fn();
      const cleared = host.querySelector(".site-music-controls").hidden;
      dispose();
      disconnect();
      host.remove();
      return { appeared, cleared, unsubscribed: listeners.size === 0 };
    });
    assert.deepEqual(lifecycle, {
      appeared: true,
      cleared: true,
      unsubscribed: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "Music footer: real audio, transport, synchronized workspaces, pause, overflow scrolling, reduced motion, languages, responsive layout and cleanup verified.",
    );
  } finally {
    await browser.close();
    await server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

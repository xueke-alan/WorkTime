"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const {
  runtimeServer,
  installRuntimeFixture,
} = require("./runtime-test-helpers.cjs");

async function main() {
  const server = await runtimeServer(path.resolve(__dirname, ".."));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
    });
    await page.addInitScript(installRuntimeFixture);
    await page.goto(server.url);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    async function minimize(feature, nativeFullscreen = false) {
      const shell = feature === "reader" ? "readerDialog" : "musicDialog";
      await page.waitForFunction(
        (id) => document.getElementById(id).dataset.state === "open",
        shell,
      );
      if (nativeFullscreen) {
        await page.locator("#readerFullscreen").click();
        await page.waitForFunction(() => !!document.fullscreenElement);
      }
      await page.evaluate(
        ({ shell, feature }) => {
          window.minimizeFrames = [];
          window.minimizeFinished = false;
          let frames = 0;
          function sample() {
            const state = document.getElementById(shell).dataset.state;
            if (state === "closing")
              window.minimizeFrames.push({
                notificationHidden:
                  document.getElementById("editorInfo").hidden,
                targetHidden: document.getElementById(feature + "Panel").hidden,
              });
            if (state === "closed" || ++frames > 300)
              window.minimizeFinished = true;
            else requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        },
        { shell, feature },
      );
      await page
        .locator(feature === "reader" ? "#readerMinimize" : "#musicMinimize")
        .click();
      await page.waitForFunction(() => window.minimizeFinished);
      const frames = await page.evaluate(() => window.minimizeFrames);
      assert.ok(frames.length > 0, "Observed the animated handoff");
      assert.ok(
        frames.every(
          (frame) => frame.notificationHidden && !frame.targetHidden,
        ),
        feature +
          " must show its mini panel throughout closing, without a notification frame: " +
          JSON.stringify(frames),
      );
      await page.locator("#" + feature + "Panel").waitFor({ state: "visible" });
      if (feature === "reader")
        await page.waitForFunction(
          () =>
            document
              .querySelector("#readerMiniViewport")
              .getAttribute("aria-busy") === "false",
        );
    }
    await page.locator("#musicOpen").click();
    await minimize("music");
    await page.locator("#musicMiniExpand").click();
    await page.locator("#musicExitButton").click();
    await page.locator("#readerOpen").click();
    await minimize("reader");
    await page.locator("#readerMiniExpand").click();
    await page
      .locator('#readerDialog [data-runtime-import="files"]')
      .setInputFiles({
        name: "Transition.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Reader transition preview.\n\n".repeat(400)),
      });
    await page.locator(".reader-book-open").first().click();
    await page.locator("#readerViewport iframe").waitFor();
    await minimize("reader");
    await page.locator("#readerMiniExpand").click();
    await minimize("reader", true);
    assert.equal(await page.locator("#readerMiniViewport iframe").count(), 1);
    console.log(
      "Music/reader minimize: every animation frame keeps the target mini panel, including empty reader, open book and native fullscreen.",
    );
  } finally {
    await browser.close();
    await server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

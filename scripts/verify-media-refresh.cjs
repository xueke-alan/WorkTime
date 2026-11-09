"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
const results = path.resolve(__dirname, "../test-results");
fs.mkdirSync(results, { recursive: true });
const launchBrowser = () =>
  chromium.launch({ channel: "msedge", headless: true });
const {
  runtimeServer,
  installRuntimeFixture,
} = require("./runtime-test-helpers.cjs");

function audioFixture() {
  const bytes = Buffer.alloc(44 + 8000 * 30 * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
async function main() {
  const server = await runtimeServer(path.resolve(__dirname, ".."));
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
    });
    await page.addInitScript(installRuntimeFixture);
    const ready = () =>
      page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
    await page.goto(server.url);
    await ready();
    assert.equal(
      await page.locator("#musicDialog,#readerDialog").count(),
      0,
      "Fresh startup stays lazy",
    );
    await page.locator("#musicOpen").click();
    await page
      .locator('#musicDialog [data-runtime-import="files"]')
      .setInputFiles({
        name: "Refresh.wav",
        mimeType: "audio/wav",
        buffer: audioFixture(),
      });
    await page.locator(".music-track-select").first().click();
    await page.waitForFunction(
      () => !document.querySelector(".music-progress").disabled,
    );
    await page.locator(".music-progress").evaluate((e) => {
      e.value = "9";
      e.dispatchEvent(new Event("change"));
    });
    await page.waitForTimeout(500);
    await page.reload();
    await ready();
    await page
      .locator("#musicPanel .music-mini-song")
      .filter({ hasText: "Refresh" })
      .waitFor();
    assert.equal(
      await page.locator("#musicDialog").isVisible(),
      false,
      "Full music restores as a mini panel",
    );
    assert.equal(
      await page.locator("#musicMiniPlay").getAttribute("aria-label"),
      await page.evaluate(() => WorkTimeApp.ui.musicText("play")),
      "Reload does not autoplay",
    );
    await page.locator("#musicMiniExpand").click();
    assert.ok(
      Number(await page.locator(".music-progress").inputValue()) >= 9,
      "Music position survives refresh",
    );
    await page.locator("#musicExitButton").click();
    await page.locator("#readerOpen").click();
    await page
      .locator('#readerDialog [data-runtime-import="files"]')
      .setInputFiles({
        name: "Refresh book.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "Refresh reading position. 刷新恢复阅读位置。\n\n".repeat(1000),
        ),
      });
    await page.locator(".reader-book-open").first().click();
    await page.waitForFunction(
      () =>
        !document.querySelector(".reader-navigation input[type=range]")
          .disabled,
    );
    await page.locator(".reader-navigation input[type=range]").evaluate((e) => {
      e.value = "400";
      e.dispatchEvent(new Event("change"));
    });
    await page.waitForTimeout(600);
    await page.reload();
    await ready();
    await page.waitForFunction(
      () =>
        document.querySelector("#readerMiniViewport iframe") &&
        !document.querySelector("#readerMiniProgress").disabled,
    );
    assert.equal(
      await page.locator("#readerDialog").isVisible(),
      false,
      "Full reader restores as a mini panel",
    );
    assert.ok(
      (await page.locator(".reader-mini-title").textContent()).includes(
        "Refresh book",
      ),
    );
    assert.ok(
      Number(await page.locator("#readerMiniProgress").inputValue()) > 300,
      "Reading position survives refresh",
    );
    await page.screenshot({
      path: path.join(results, "media-refresh-reader.png"),
    });
    await page.locator("#musicOpen").click();
    await page.locator("#musicPanel").waitFor({ state: "visible" });
    assert.equal(
      await page.locator("#musicPanel").isVisible(),
      true,
      "Previously expanded music also returns as mini",
    );
    await page.reload();
    await ready();
    await page
      .locator("#musicPanel .music-mini-song")
      .filter({ hasText: "Refresh" })
      .waitFor();
    await page.locator("#readerOpen").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#readerMiniViewport iframe") &&
        !document.querySelector("#readerMiniProgress").disabled,
    );
    assert.ok(
      Number(await page.locator("#readerMiniProgress").inputValue()) > 300,
      "Inactive reader resumes when selected after refreshing music",
    );
    await page.locator("#readerMiniExpand").click();
    await page.locator("#readerShelf").click();
    await page.waitForFunction(
      () => !document.querySelector(".reader-library").hidden,
    );
    await page.reload();
    await ready();
    await page.locator("#readerPanel .reader-mini-empty").waitFor();
    assert.equal(
      await page.locator("#readerMiniViewport iframe").count(),
      0,
      "Returning to the shelf clears the book to resume",
    );
    await page.locator("#date-tab-games").click();
    await page.reload();
    await ready();
    assert.equal(
      await page.locator("#gamesPanel").isVisible(),
      true,
      "An explicitly selected ordinary tab stays selected",
    );
    assert.equal(
      await page.locator("#musicDialog,#readerDialog").count(),
      0,
      "Inactive media stays lazy",
    );
    console.log(
      "Media refresh: full-to-mini restore, selected tab, music track/position without autoplay, reading book/position and lazy startup passed.",
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

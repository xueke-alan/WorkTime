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

async function main() {
  const server = await runtimeServer(path.resolve(__dirname, ".."));
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
    });
    await page.addInitScript(installRuntimeFixture);
    await page.goto(server.url);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        WorkTimeApp.services.runtimeFolder.state.status === "available",
    );
    await page.locator("#readerOpen").click();
    await page
      .locator('#readerDialog [data-runtime-import="files"]')
      .setInputFiles({
        name: "Mini settings.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "小窗阅读设置测试。 Reading settings preview.\n\n".repeat(300),
        ),
      });
    await page.locator(".reader-book-open").first().click();
    await page.locator("#readerMinimize").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#readerMiniViewport iframe") &&
        document
          .querySelector("#readerMiniViewport")
          .getAttribute("aria-busy") === "false",
    );
    const toggle = page.locator("#readerMiniSettingsToggle");
    const menu = page.locator("#readerMiniSettings");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.equal(
      await page
        .locator("#readerMiniFontSize")
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.locator("#readerMiniFontSize").fill("30");
    await page.locator("#readerMiniFontSize").press("Tab");
    await page.waitForFunction(() => {
      const frame = document.querySelector("#readerMiniViewport iframe");
      return (
        frame.contentWindow.getComputedStyle(frame.contentDocument.body)
          .fontSize === "30px"
      );
    });
    await page.locator("#readerMiniFont").selectOption("mono");
    await page.locator("#readerMiniFlow").selectOption("scroll");
    await page.locator("#readerMiniTheme").selectOption("sepia");
    await page.waitForFunction(() => {
      const frame = document.querySelector("#readerMiniViewport iframe");
      const style = frame.contentWindow.getComputedStyle(
        frame.contentDocument.body,
      );
      return (
        style.fontFamily.includes("mono") &&
        frame.contentDocument.documentElement.style.overflow !== "hidden" &&
        frame.contentWindow.getComputedStyle(
          frame.contentDocument.documentElement,
        ).overflowY === "auto"
      );
    });
    await page.locator("#readerMiniFontSize").fill("99");
    await page.locator("#readerMiniFontSize").press("Tab");
    assert.equal(
      await page
        .locator("#readerMiniFontSize")
        .evaluate((e) => e.validity.rangeOverflow),
      true,
    );
    await menu.press("Escape");
    assert.equal(await menu.isVisible(), false);
    assert.equal(
      await toggle.evaluate((e) => e === document.activeElement),
      true,
    );
    await toggle.click();
    assert.equal(await page.locator("#readerMiniFontSize").inputValue(), "30");
    await page.locator("#readerMiniTheme").focus();
    await page.locator("#readerMiniTheme").press("Home");
    await page.locator("#readerMiniTheme").selectOption("sepia");
    assert.equal(await page.locator("#readerDialog").isVisible(), false);
    await menu.press("Escape");
    await toggle.click();
    assert.equal(await menu.isVisible(), true);
    await page.locator(".reader-mini-title").click();
    assert.equal(
      await menu.isVisible(),
      true,
      "Inline settings stay open when clicking elsewhere in the reader",
    );
    assert.equal(await menu.getAttribute("role"), "region");
    assert.equal(await toggle.getAttribute("aria-haspopup"), null);
    assert.equal(
      await menu.evaluate((e) => getComputedStyle(e).position),
      "static",
    );
    assert.equal(await page.locator("#readerMiniViewport").isVisible(), false);
    assert.equal(
      await page.locator("#readerMiniViewport").evaluate((e) => e.inert),
      true,
    );
    await toggle.click();
    assert.equal(await page.locator("#readerMiniViewport").isVisible(), true);
    await toggle.click();
    await page
      .locator("#readerPanel")
      .screenshot({ path: path.join(results, "reader-mini-settings.png") });
    await page.locator("#readerMiniExpand").click();
    await page.waitForFunction(() => {
      const frame = document.querySelector("#readerViewport iframe");
      return (
        frame &&
        frame.contentWindow.getComputedStyle(frame.contentDocument.body)
          .fontSize === "30px"
      );
    });
    await page.locator("#readerMinimize").click();
    await toggle.click();
    assert.equal(await page.locator("#readerMiniFont").inputValue(), "mono");
    assert.equal(await page.locator("#readerMiniFlow").inputValue(), "scroll");
    assert.equal(await page.locator("#readerMiniTheme").inputValue(), "sepia");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#readerPanel").scrollIntoViewIfNeeded();
    assert.equal(
      await menu.evaluate((e) => e.scrollWidth <= e.clientWidth),
      true,
    );
    await page.locator("#readerPanel").screenshot({
      path: path.join(results, "reader-mini-settings-mobile.png"),
    });
    await page.locator("#readerMiniExpand").click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    console.log(
      "Mini reading settings: live typography/flow, shared full settings, validation, Escape/focus, round trip and mobile layout passed.",
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

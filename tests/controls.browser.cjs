"use strict";

const assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs");
const url = require("node:url").pathToFileURL(
  path.resolve(__dirname, "../index.html"),
).href;
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const dpr of [1, 1.25, 1.5, 2]) {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: dpr,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(url);
    await page.locator("#batchToggle").waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
    for (const width of [
      390, 540, 699, 850, 1150, 1151, 1300, 1301, 1600, 1800, 1920,
    ]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => WorkTimeApp.ui.alignment.refresh());
      const measurements = await page.evaluate(() =>
        ["batchToggle", "settingsOpen"].map((id) => {
          const button = document.getElementById(id),
            label = button.querySelector(".ui-icon"),
            rect = label.getBoundingClientRect(),
            b = button.getBoundingClientRect(),
            s = getComputedStyle(label);
          return {
            y: rect.y,
            height: b.height,
            transform: s.transform,
            font: s.font,
            fontSize: s.fontSize,
            centered:
              Math.abs(rect.y + rect.height / 2 - b.y - b.height / 2) <= 0.5,
            inside: rect.height <= b.height && rect.width <= b.width,
          };
        }),
      );
      assert(
        Math.abs(measurements[0].y - measurements[1].y) <= 0.25,
        `baseline mismatch ${width}, DPR ${dpr}`,
      );
      assert.equal(measurements[0].transform, "none");
      assert.equal(measurements[1].transform, "none");
      assert.equal(measurements[0].font, measurements[1].font);
      assert(
        measurements.every(
          (item) => item.height >= 24 && item.centered && item.inside,
        ),
        "Each toolbar icon is centered inside its existing hit area",
      );
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.locator("#batchToggle").click();
    await page.evaluate(() => WorkTimeApp.ui.alignment.refresh());
    assert.equal(
      await page
        .locator("#batchToggle>.ui-icon")
        .evaluate((e) => getComputedStyle(e).transform),
      "none",
    );
    await page.locator("#batchCancel").click();
    await page.locator("#settingsOpen").focus();
    assert.equal(
      await page
        .locator("#settingsOpen")
        .evaluate((e) => getComputedStyle(e).outlineWidth),
      "0px",
    );
    await page.locator("#settingsOpen").press("Enter");
    const closeButton = page.locator("#settingsOpen");
    await closeButton.focus();
    assert.equal(
      await closeButton.evaluate((e) => getComputedStyle(e).outlineWidth),
      "0px",
    );
    assert.equal(
      await closeButton.evaluate((e) => e === document.activeElement),
      true,
    );
    if (dpr === 1) {
      await closeButton.screenshot({
        path: path.resolve(
          __dirname,
          "../test-results/focus-outline-close-removed.png",
        ),
      });
    }
    await page.keyboard.press("Escape");
    await page.locator("#settingsDialog").waitFor({ state: "hidden" });
    await page.locator("#settingsOpen").focus();
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "settingsOpen",
    );
    if (dpr === 1) {
      fs.mkdirSync(path.resolve(__dirname, "../test-results"), {
        recursive: true,
      });
      await page.screenshot({
        path: path.resolve(__dirname, "../test-results/refactor-toolbar.png"),
        clip: await page.locator(".calendar-toolbar-actions").boundingBox(),
      });
    }
    await context.close();
  }
  console.log(
    "Controls passed: same baseline/font/height at 11 widths × 4 DPR, no content-dependent transform, pressed state and keyboard focus.",
  );
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});

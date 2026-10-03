"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [2250, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1244 } });
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(
        pathToFileURL(path.resolve(__dirname, "../index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#settingsOpen").click();
      const input = page.locator("#workCity");
      await input.scrollIntoViewIfNeeded();
      const layout = () =>
        page
          .locator("#settingsDialog .dialog-body")
          .evaluate((e) => ({ height: e.scrollHeight, top: e.scrollTop }));
      const before = await layout();
      await input.focus();
      const list = page.locator("#workCityOptions");
      assert.deepEqual(await list.locator("[data-city]").allTextContents(), [
        "上海",
        "北京",
        "深圳",
        "东莞",
        "成都",
        "西安",
      ]);
      assert.deepEqual(await layout(), before);
      assert.equal(await input.getAttribute("list"), null);
      assert.equal(
        await list.evaluate((e) => getComputedStyle(e).position),
        "fixed",
      );
      const box = await list.boundingBox();
      assert(box.y >= 0 && box.y + box.height <= 1244);
      await input.fill("深");
      assert.deepEqual(await list.locator("[data-city]").allTextContents(), [
        "深圳",
      ]);
      await list.locator("[data-city]").click();
      assert.equal(await input.inputValue(), "深圳");
      assert(await list.isHidden());
      await input.blur();
      await input.focus();
      await input.press("ArrowUp");
      assert.deepEqual(await layout(), before);
      await input.press("Enter");
      assert.equal(await input.inputValue(), "西安");
      await input.fill("无此城市");
      assert.equal(await list.textContent(), "无匹配城市");
      await input.press("Escape");
      assert(await list.isHidden());
      assert(await page.locator("#settingsDialog").evaluate((e) => e.open));
      await page.close();
    }
    console.log(
      "City floating picker: desktop/mobile, filtering, selection and stable sidebar passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

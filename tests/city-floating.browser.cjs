"use strict";
const assert = require("node:assert/strict");

const { pathToFileURL } = require("node:url");
const path = require("node:path");
const cities = require("../assets/data/weather-locations.json");

(async () => {
  const browser = await require("./helpers/browser.cjs").launchBrowser();
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
      await page.locator("#pageSettingsOpen").click();
      const input = page.locator("#workCity");
      await input.scrollIntoViewIfNeeded();
      const layout = () =>
        page
          .locator("#pageSettingsPane .page-settings-body")
          .evaluate((e) => ({ height: e.scrollHeight, top: e.scrollTop }));
      const before = await layout();
      await input.focus();
      const list = page.locator("#workCityOptions");
      assert.deepEqual(
        await list.locator(".work-city-name").allTextContents(),
        cities.map((city) => city.name + "市"),
      );
      assert.deepEqual(
        await list.locator(".work-city-office").allTextContents(),
        cities.map((city) => city.office),
      );
      assert.ok(
        await list.locator("[data-city]").evaluateAll((options) =>
          options.every((option, index) => {
            const style = getComputedStyle(option),
              title = getComputedStyle(option.querySelector("strong")),
              subtitle = getComputedStyle(option.querySelector("small"));
            return (
              parseFloat(style.borderTopWidth) === (index >= 2 ? 1 : 0) &&
              parseFloat(style.borderRightWidth) ===
                (index % 2 === 0 ? 1 : 0) &&
              parseFloat(style.borderBottomWidth) === 0 &&
              parseFloat(style.borderLeftWidth) === 0 &&
              Number(title.fontWeight) >= 600 &&
              parseFloat(subtitle.fontSize) < parseFloat(title.fontSize)
            );
          }),
        ),
        "Options use internal dividers, bold city names and smaller office labels",
      );
      assert.ok(
        Number(await input.evaluate((el) => getComputedStyle(el).fontWeight)) >=
          600,
      );
      assert.deepEqual(await layout(), before);
      assert.equal(await input.getAttribute("list"), null);
      assert.equal(
        await list.evaluate((e) => getComputedStyle(e).position),
        "fixed",
      );
      const box = await list.boundingBox();
      assert(box.y >= 0 && box.y + box.height <= 1244);
      await page.screenshot({
        path: path.resolve(`test-results/city-options-${width}.png`),
      });
      const readonly = (await input.getAttribute("readonly")) !== null;
      if (!readonly) {
        await input.fill("深");
        assert.deepEqual(
          await list.locator(".work-city-name").allTextContents(),
          ["深圳市"],
        );
      }
      await list.locator('[data-city="深圳"]').click();
      assert.equal(await input.inputValue(), "深圳市");
      assert(await list.isHidden());
      await input.blur();
      await input.focus();
      await input.press("ArrowUp");
      assert.deepEqual(await layout(), before);
      await input.press("Enter");
      assert.equal(await input.inputValue(), "苏州市");
      if (!readonly) {
        await input.fill("无此城市");
        assert.equal(await list.textContent(), "无匹配城市");
      } else {
        await input.blur();
        await input.focus();
      }
      await input.press("Escape");
      assert(await list.isHidden());
      assert(await page.locator("#pageSettingsPane").isVisible());
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

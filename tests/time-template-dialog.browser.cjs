"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let browser;
async function stableOpening(page, selector) {
  const frames = await page.evaluate(async (selector) => {
    document.querySelector(selector).click();
    const dialog = document.getElementById("timeTemplateDialog");
    const samples = [];
    for (let i = 0; i < 40; i++) {
      await new Promise(requestAnimationFrame);
      const box = dialog.getBoundingClientRect(),
        input = document
          .getElementById("timeTemplateName")
          .getBoundingClientRect();
      samples.push([box.x, box.y, box.width, box.height, input.x, input.y]);
    }
    return samples;
  }, selector);
  assert.ok(
    frames.every((frame) =>
      frame.every((value, i) => Math.abs(value - frames[0][i]) < 0.1),
    ),
    "Dialog and input must remain stationary during and after opening",
  );
  assert.equal(
    await page
      .locator("#timeTemplateName")
      .evaluate((el) => document.activeElement === el),
    true,
  );
}
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const width of [2250, 390]) {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const page = await browser.newPage({
        viewport: { width, height: 1244 },
        reducedMotion,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(/^https?:/, (r) => r.abort());
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await stableOpening(page, "#addTimeTemplate");
      await page.locator("#timeTemplateName").fill("常规下班");
      await page.locator("#timeTemplateStart").fill("08:55");
      await page.locator("#timeTemplateEnd").fill("17:30");
      await page.locator("#timeTemplateForm button[type=submit]").click();
      await stableOpening(page, "#timeTemplateList .template-edit");
      assert.equal(
        await page.locator("#timeTemplateName").inputValue(),
        "常规下班",
      );
      await page
        .locator("#timeTemplateDialog .dialog-head [data-close]")
        .click();
      assert.equal(
        await page.locator("#timeTemplateDialog").isVisible(),
        false,
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  await browser.close();
  console.log(
    "Time template dialog: new/edit opening geometry stable on desktop/mobile with and without motion; save and close passed.",
  );
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});

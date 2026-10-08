"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const validation of [false, true]) {
    const page = await browser.newPage({
      reducedMotion: "reduce",
      timezoneId: "Asia/Shanghai",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.addInitScript(() => {
      const write = Storage.prototype.setItem;
      window.rejectBusinessWrite = true;
      Storage.prototype.setItem = function (key, value) {
        if (key === "worktime-local-v1" && window.rejectBusinessWrite)
          throw new DOMException("test quota", "QuotaExceededError");
        return write.call(this, key, value);
      };
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#pageSettingsOpen").click();
    await page.locator("#workCity").focus();
    await page.locator('#workCityOptions [data-city="上海"]').click();
    assert.match(
      await page.locator("#personalSettingsError").textContent(),
      /尚未保存/,
    );
    if (validation) {
      await page.locator("#employmentDate").fill("2024-02-31");
      await page
        .locator("#personalSettingsForm")
        .evaluate((form) =>
          form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
        );
      assert.match(
        await page.locator("#personalSettingsError").textContent(),
        /有效/,
      );
    } else {
      await page.locator("#personalSettingsError").evaluate((element) => {
        element.textContent = "A translated unsaved warning";
      });
    }
    const before = await page.locator("#personalSettingsError").textContent();
    await page.evaluate(() => {
      window.rejectBusinessWrite = false;
      document.getElementById("retryStorage").click();
    });
    await page.waitForFunction(
      () => !document.getElementById("retryStorage").disabled,
    );
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime-local-v1"))?.personal
          .workCity === "上海市",
    );
    assert.equal(
      await page.locator("#personalSettingsError").textContent(),
      validation ? before : "",
    );
    if (validation)
      assert.equal(
        await page.locator("#employmentDate").inputValue(),
        "2024-02-31",
        "Recovery must retain invalid draft",
      );
    assert.deepEqual(errors, []);
    await page.close();
  }
  await browser.close();
  console.log(
    "Field recovery passed: personal unsaved warning cleared independently of translation, invalid input/error retained while valid session data persisted.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});

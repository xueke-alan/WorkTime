"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const width of [1600, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
      timezoneId: "Asia/Shanghai",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(path.resolve("index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#pageSettingsOpen").click();
    const input = page.locator("#employmentDate"),
      warning = page.locator("#personalSettingsError");
    const saved = () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime-local-v1"))?.personal
            .employmentDate || "",
      );
    const selection = () =>
      input.evaluate((e) => [e.selectionStart, e.selectionEnd]);
    async function type(text) {
      await input.fill("");
      await input.pressSequentially(text);
    }
    async function paste(text) {
      await input.focus();
      await input.evaluate((e, value) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", value);
        e.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, text);
    }
    await input.focus();
    assert.equal(await input.inputValue(), "YYYY-MM-DD");
    await input.pressSequentially("2000");
    assert.equal(await input.inputValue(), "2000-MM-DD");
    assert.deepEqual(await selection(), [5, 7]);
    assert.equal(await warning.textContent(), "");
    await input.pressSequentially("9");
    assert.equal(await input.inputValue(), "2000-09-DD");
    assert.deepEqual(await selection(), [8, 10]);
    await input.pressSequentially("9");
    assert.equal(await saved(), "2000-09-09");
    for (const month of ["01", "10", "11", "12"]) {
      await type("2000" + month + "28");
      assert.equal(await saved(), `2000-${month}-28`);
    }
    for (const day of ["10", "20", "29", "30", "31"]) {
      await type("200012" + day);
      assert.equal(await saved(), `2000-12-${day}`);
    }
    await type("2000121");
    assert.equal(await warning.textContent(), "");
    await input.press("Tab");
    assert.equal(await saved(), "2000-12-01");
    assert.equal(
      await input.evaluate((e) => e === document.activeElement),
      false,
    );
    await input.focus();
    await input.press("Tab");
    assert.deepEqual(await selection(), [5, 7]);
    await input.pressSequentially("9");
    await input.press("Shift+Tab");
    assert.deepEqual(await selection(), [5, 7]);
    await input.press("ArrowLeft");
    assert.deepEqual(await selection(), [0, 4]);
    await input.press("ArrowRight");
    await input.pressSequentially("1");
    await input.press("/");
    assert.equal(await input.inputValue(), "2000-01-01");
    assert.deepEqual(await selection(), [8, 10]);
    await input.pressSequentially("2");
    await input.press("Enter");
    assert.equal(await saved(), "2000-01-02");
    for (const text of ["20000909", "2000-9-9", "2000/9/9", "2000.9.9"]) {
      await paste(text);
      assert.equal(await input.inputValue(), "2000-09-09");
      assert.equal(await saved(), "2000-09-09");
    }
    // Click directly into the month segment, then overwrite it.
    await input.evaluate((e) => e.setSelectionRange(5, 5));
    await input.dispatchEvent("click");
    assert.deepEqual(await selection(), [5, 7]);
    await input.pressSequentially("11");
    assert.equal(await saved(), "2000-11-09");
    await input.press("Backspace");
    assert.equal(await input.inputValue(), "2000-11-DD");
    assert.equal(await saved(), "2000-11-09");
    await input.pressSequentially("3");
    await input.press("Backspace");
    assert.equal(await input.inputValue(), "2000-11-DD");
    await input.pressSequentially("4");
    assert.equal(await saved(), "2000-11-04");
    await paste("2000-02-29");
    assert.equal(await saved(), "2000-02-29");
    await paste("2001-02-29");
    assert.equal(await saved(), "2000-02-29");
    assert.equal(await warning.textContent(), "");
    await input.press("Enter");
    assert.match(await warning.textContent(), /有效/);
    assert.equal(await input.inputValue(), "2001-02-29");
    await input.focus();
    await input.pressSequentially("2");
    assert.equal(await warning.textContent(), "");
    assert.equal(await saved(), "2000-02-29");
    await input.press("Enter");
    assert.match(await warning.textContent(), /完整/);
    await page.locator("#workCity").focus();
    await page.locator('#workCityOptions [data-city="上海"]').click();
    assert.equal(await saved(), "2000-02-29");
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime-local-v1")).personal
            .workCity,
      ),
      "上海市",
    );
    assert.equal(await input.inputValue(), "2-02-29");
    await input.fill("2024-02-31");
    await input.press("Enter");
    assert.equal(await input.inputValue(), "2024-02-31");
    assert.equal(await saved(), "2000-02-29");
    await paste("bad");
    await input.press("Enter");
    assert.equal(await input.inputValue(), "bad");
    assert.equal(await saved(), "2000-02-29");
    await paste("2024-10-09");
    assert.equal(await saved(), "2024-10-09");
    await input.press("Control+a");
    assert.deepEqual(await selection(), [0, 10]);
    await input.press("Delete");
    assert.equal(await input.inputValue(), "");
    assert.equal(await saved(), "");
    await input.press("Tab");
    await input.press("Tab");
    await input.press("Tab");
    assert.equal(await warning.textContent(), "");
    // Simulate a numeric soft keyboard through beforeinput, without keydown.
    await input.focus();
    for (const data of "2000/9/9")
      await input.evaluate((e, digit) => {
        e.dispatchEvent(
          new InputEvent("beforeinput", {
            inputType: "insertText",
            data: digit,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, data);
    // 9 already advanced the month, so an explicit separator at the next empty segment must not lose data.
    await input.press("Enter");
    assert.equal(await saved(), "2000-09-09");
    const geometry = await input.boundingBox();
    assert.ok(geometry.x >= 0 && geometry.x + geometry.width <= width);
    await page.screenshot({
      path: `test-results/employment-date-input-${width}.png`,
    });
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#pageSettingsOpen").click();
    assert.equal(await input.inputValue(), "2000-09-09");
    await page.evaluate(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "worktime-local-v1")
          throw new DOMException("test quota", "QuotaExceededError");
        return write.call(this, key, value);
      };
    });
    await input.fill("20241009");
    assert.match(await warning.textContent(), /尚未保存/);
    assert.equal(await saved(), "2000-09-09");
    await input.press("Control+a");
    await input.pressSequentially("2");
    assert.match(await warning.textContent(), /尚未保存/);
    await input.press("Enter");
    assert.match(await warning.textContent(), /有效/);
    await page.locator("#workCity").focus();
    await page.locator('#workCityOptions [data-city="北京"]').click();
    assert.match(await warning.textContent(), /尚未保存/);
    await input.focus();
    await input.pressSequentially("2");
    assert.match(await warning.textContent(), /尚未保存/);
    assert.deepEqual(errors, []);
    await page.close();
  }
  await browser.close();
  console.log(
    "Employment date input: segmented typing, padding, navigation, paste, deletion, leap validation, draft/city isolation, mobile and reload passed.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});

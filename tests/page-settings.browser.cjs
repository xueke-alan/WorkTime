"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");

let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  for (const width of [2250, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 2250 ? 1244 : 884 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const button = page.locator("#pageSettingsOpen"),
      pane = page.locator("#pageSettingsPane");
    assert.equal(await pane.isVisible(), false);
    assert.equal(
      await button.evaluate((e) => e === e.parentElement.lastElementChild),
      true,
    );
    await button.click();
    assert.equal(await pane.isVisible(), true);
    assert.equal(await pane.locator("#employmentDate").count(), 1);
    assert.equal(await pane.locator("#workCity").count(), 1);
    assert.equal(
      await page.locator("#settingsForm .settings-employment").count(),
      0,
    );
    await pane.locator("#employmentDate").fill("20241014");
    await pane.locator("#workCity").focus();
    await page.locator('#workCityOptions [data-city="上海"]').click();
    const personal = await page.evaluate(
      () => JSON.parse(localStorage.getItem("worktime-local-v1")).personal,
    );
    assert.equal(personal.employmentDate, "2024-10-14");
    assert.equal(personal.workCity, "上海市");
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("worktime-local-v1")).settings
            .workStart,
      ),
      "08:00",
      "Personal edits preserve calculation settings",
    );
    assert.equal(await page.locator(".notification-tabs").isVisible(), true);
    assert.equal(await page.locator(".date-info-area").isVisible(), true);
    assert.ok(
      await pane.evaluate((el) => {
        const lower = document.querySelector(".date-info-area");
        return (
          el.getBoundingClientRect().bottom <=
          lower.getBoundingClientRect().top + 1
        );
      }),
      "Page settings must end above the bottom content module",
    );
    for (const tab of await page
      .locator(".notification-tabs button[data-tab]")
      .all()) {
      await tab.click();
      assert.equal(await tab.getAttribute("aria-selected"), "true");
      assert.equal(await pane.isVisible(), true);
    }
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#dayForm").isVisible(), false);
    assert.equal(await pane.locator('input[type="radio"]').count(), 12);
    const green = pane.locator('input[value="green"]');
    await button.press("Tab");
    await green.focus();
    assert.ok(
      await green.evaluate(
        (e) =>
          parseFloat(getComputedStyle(e.closest("label")).outlineWidth) >= 2,
      ),
    );
    await green.press("ArrowRight");
    assert.equal(await pane.locator('input[value="blue"]').isChecked(), true);
    assert.equal(await page.locator("html").getAttribute("data-theme"), "blue");
    await pane.locator('label:has(input[value="green"])').click();
    const geometry = await pane.evaluate((e) => {
      const rect = e.getBoundingClientRect(),
        parent = e.parentElement.getBoundingClientRect();
      return {
        inside: rect.left >= parent.left - 1 && rect.right <= parent.right + 1,
        overflow: e.scrollWidth - e.clientWidth,
        iconWidth: document
          .querySelector("#pageSettingsOpen .ui-icon")
          .getBoundingClientRect().width,
        referenceWidth: document
          .querySelector("#settingsOpen .ui-icon")
          .getBoundingClientRect().width,
      };
    });
    assert.ok(
      geometry.inside && geometry.overflow <= 1,
      JSON.stringify({ width, geometry }),
    );
    assert.equal(geometry.iconWidth, geometry.referenceWidth);
    await button.click();
    assert.equal(await pane.isVisible(), false);
    assert.equal(await page.locator("#dayForm").isVisible(), true);
    await button.click();
    await button.press("Escape");
    assert.equal(await pane.isVisible(), false);
    assert.equal(await button.getAttribute("aria-pressed"), "false");
    await button.click();
    await page.locator("#settingsOpen").click();
    assert.equal(await pane.isVisible(), false);
    assert.equal(await page.locator("#settingsDialog").isVisible(), true);
    await page.locator("#standardStart").fill("09:00");
    await button.click();
    assert.equal(await page.locator("#scheduleDraftDialog").isVisible(), true);
    assert.equal(await pane.isVisible(), false);
    await page.locator("#scheduleDraftContinue").click();
    assert.equal(await page.locator("#standardStart").inputValue(), "09:00");
    await button.click();
    await page.locator("#scheduleDraftDiscard").click();
    assert.equal(await pane.isVisible(), true);
    assert.equal(await page.locator("#settingsDialog").isVisible(), false);
    await page.locator("#calendar .day[data-date]").first().click();
    assert.equal(await pane.isVisible(), true);
    assert.equal(await page.locator("#dayForm").isVisible(), false);
    await page.locator("#batchToggle").click();
    assert.equal(await pane.isVisible(), false);
    assert.equal(await page.locator("#batchForm").isVisible(), true);
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await button.click();
    assert.equal(
      await pane.locator("#employmentDate").inputValue(),
      "2024-10-14",
    );
    assert.equal(await pane.locator("#workCity").inputValue(), "上海市");
    await page
      .locator("#calendar .day[data-date]:not(:disabled)")
      .first()
      .click();
    assert.equal(await pane.isVisible(), true);
    assert.equal(
      await page.locator("#batchToggle").getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(await page.locator("#batchForm").isVisible(), false);
    await page.locator("#settingsOpen").click();
    assert.equal(await pane.isVisible(), false);
    assert.equal(await button.getAttribute("aria-pressed"), "false");
    assert.equal(
      await page.locator("#settingsOpen").getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("#batchToggle").click();
    assert.equal(await page.locator("#settingsDialog").isVisible(), false);
    assert.equal(
      await page.locator("#settingsOpen").getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(await page.locator("#batchSave").isDisabled(), true);
    assert.equal(await page.locator("#batchForm").isVisible(), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Page settings: sidebar navigation, responsive layout, Escape and draft protection passed.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => browser?.close());

"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs"),
  { pathToFileURL } = require("node:url"),
  { buildPerformanceFixture } = require("../scripts/performance-fixtures.cjs");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const results = [];
  for (const width of [390, 1600])
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        timezoneId: "Asia/Shanghai",
        reducedMotion,
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.clock.install({ time: new Date("2026-09-30T12:00:00+08:00") });
      const fixture = buildPerformanceFixture(1).state;
      fixture.personal.employmentDate = "2024-10-14";
      await page.addInitScript(
        (state) =>
          localStorage.setItem("worktime-local-v1", JSON.stringify(state)),
        fixture,
      );
      await page.goto(
        pathToFileURL(path.resolve(__dirname, "../index.html")).href,
      );
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      await page.waitForTimeout(1000);
      const initial = await page.evaluate(() =>
        [...document.querySelectorAll("#dayPreview [data-number-motion]")].map(
          (e) => ({
            id: e.id,
            raw:
              e.querySelector(".summary-number-accessible")?.textContent ||
              e.textContent,
            font: getComputedStyle(e).fontSize,
            digitFont: e.querySelector(".summary-number-digit")
              ? getComputedStyle(e.querySelector(".summary-number-digit"))
                  .fontSize
              : null,
            paused: [...e.getAnimations({ subtree: true })].some(
              (a) => a.playState === "paused",
            ),
          }),
        ),
      );
      assert.equal(initial.length, 4);
      assert(
        initial.every((x) => !x.paused),
        "Initial preview animations revealed",
      );
      assert(
        initial.every((x) => !x.digitFont || x.font === x.digitFont),
        "Digits inherit original field font size",
      );
      assert.match(initial.find((x) => x.id === "workedHours").raw, / h$/);
      assert.equal(await page.locator("#workedDays").count(), 0);
      assert.equal(await page.locator("#expectedDays").count(), 0);
      const changed = await page.evaluate(() => {
        document.getElementById("dayStart").value = "08:00";
        document.getElementById("dayEnd").value = "20:00";
        document
          .getElementById("dayStart")
          .dispatchEvent(new Event("input", { bubbles: true }));
        const node = document
          .getElementById("workedHours")
          .querySelector(".summary-number");
        document
          .getElementById("dayEnd")
          .dispatchEvent(new Event("input", { bubbles: true }));
        return {
          retained:
            node ===
            document
              .getElementById("workedHours")
              .querySelector(".summary-number"),
          up: document.querySelectorAll("#dayPreview .number-roll-up").length,
          running: document
            .getElementById("dayPreview")
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === "running").length,
        };
      });
      assert(
        changed.retained,
        "Paired same-value input preserves active digit nodes",
      );
      if (reducedMotion === "reduce") assert.equal(changed.running, 0);
      else
        assert(
          changed.up > 0 && changed.running > 0,
          "Changed preview digits roll up",
        );
      const decreasing = await page.evaluate(() => {
        document.getElementById("dayEnd").value = "16:00";
        document
          .getElementById("dayEnd")
          .dispatchEvent(new Event("input", { bubbles: true }));
        return document.querySelectorAll("#dayPreview .number-roll-down")
          .length;
      });
      if (reducedMotion === "no-preference")
        assert(decreasing > 0, "Decreasing preview digits roll down");
      await page.locator('[data-date="2026-09-29"]').evaluate((e) => e.click());
      const employment = await page.evaluate(() => ({
        down: document.querySelectorAll("#employmentDays .number-roll-down")
          .length,
        value: document.querySelector(
          "#employmentDays .summary-number-accessible",
        ).textContent,
      }));
      assert.equal(employment.value, "716");
      if (reducedMotion === "no-preference")
        assert(
          employment.down > 0,
          "Employment day count rolls on date change",
        );
      const placeholder = await page.evaluate(() => {
        const root = document.createElement("div");
        root.innerHTML =
          '<strong id="test-preview-null" data-number-motion>- h</strong>';
        document.body.append(root);
        WorkTimeApp.ui.numbers.set(root.firstElementChild, null, {
          placeholder: "-",
          unit: " h",
        });
        const text = root.textContent,
          unchanged = !root.querySelector(".summary-number");
        root.remove();
        return { text, unchanged };
      });
      assert.deepEqual(placeholder, { text: "- h", unchanged: true });
      await page.waitForTimeout(650);
      await page.locator("#dayPreview").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.resolve(
          __dirname,
          `../test-results/preview-number-motion-${width}-${reducedMotion}.png`,
        ),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      results.push({
        width,
        reducedMotion,
        initial,
        changed,
        decreasing,
        employment,
        placeholder,
        pageErrors: errors,
      });
      await context.close();
    }
  fs.writeFileSync(
    path.resolve(
      __dirname,
      "../test-results/preview-number-motion-results.json",
    ),
    JSON.stringify(
      {
        complete: true,
        scope:
          "Actual app; 390/1600 CSS widths; Windows100%-scope; normal/reduced motion; initial reveal, increase/decrease, unchanged nodes, units/fonts/employment/null",
        results,
      },
      null,
      2,
    ),
  );
  console.log("Preview number motion passed: 4 actual-app cases.");
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await browser?.close();
  process.exitCode = 1;
});

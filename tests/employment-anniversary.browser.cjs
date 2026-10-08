"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  buildPerformanceFixture,
} = require("../scripts/performance-fixtures.cjs");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const cases = [
    ["2024-10-15", "2026-10-09", "2026-10-15", "入职 2 周年纪念日", 2],
    ["2026-10-15", "2026-10-09", "2026-10-15", "入职日", 2],
    ["2027-10-15", "2026-10-09", "2026-10-15", "发薪日", 1],
    ["", "2026-10-09", "2026-10-15", "发薪日", 1],
    ["2024-02-29", "2027-03-01", "2027-03-01", "入职 3 周年纪念日", 1],
    ["2024-02-29", "2028-02-01", "2028-02-29", "入职 4 周年纪念日", 1],
    ["2024-02-29", "2027-02-01", "2027-02-28", "", 0],
  ];
  for (const reducedMotion of ["no-preference", "reduce"]) {
    for (const [start, today, date, label, count] of cases) {
      const page = await browser.newPage({
        viewport: {
          width: reducedMotion === "reduce" ? 390 : 1600,
          height: 1000,
        },
        timezoneId: "Asia/Shanghai",
        reducedMotion,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.install({ time: new Date(today + "T12:00:00+08:00") });
      const fixture = buildPerformanceFixture(1).state;
      fixture.personal.employmentDate = start;
      await page.addInitScript(
        (state) =>
          localStorage.setItem("worktime-local-v1", JSON.stringify(state)),
        fixture,
      );
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.clock.runFor(900);
      const card = page.locator(`[data-date="${date}"]`);
      assert.equal(await card.locator(".payday-icon").count(), count);
      assert.ok((await card.getAttribute("aria-label")).includes(label));
      if (count)
        assert.ok(
          (
            await card.locator(".date-markers").getAttribute("aria-label")
          ).includes(label),
        );
      if (count === 2) {
        assert.match(await card.getAttribute("aria-label"), /发薪日/);
        const phases = await card.evaluate((element) => {
          const icons = [...element.querySelectorAll(".payday-icon")];
          const animations = icons.map((icon) => icon.getAnimations()[0]);
          animations.forEach((animation) => animation.pause());
          return [1000, 2820, 4000, 5820, 7000].map((time) => {
            animations.forEach((animation) => {
              animation.currentTime = time;
            });
            return icons.map((icon) => ({
              opacity: Number(getComputedStyle(icon).opacity),
              transform: getComputedStyle(icon).transform,
            }));
          });
        });
        assert.equal(phases[0][0].opacity, 1);
        assert.equal(phases[0][1].opacity, 0);
        assert.equal(phases[2][0].opacity, 0);
        assert.equal(phases[2][1].opacity, 1);
        assert.equal(phases[4][0].opacity, 1);
        if (reducedMotion === "no-preference") {
          assert.ok(
            phases[1].every((icon) => icon.opacity > 0 && icon.opacity < 1),
          );
          assert.ok(
            phases[1].every(
              (icon) => icon.transform !== "matrix(1, 0, 0, 1, 0, 0)",
            ),
          );
        } else
          assert.ok(
            phases[1].every((icon) => icon.opacity === 0 || icon.opacity === 1),
          );
        await card.evaluate((element) => {
          window.markerBefore = element.querySelector(".date-markers");
        });
        await card.click();
        assert.equal(
          await card.evaluate(
            (element) =>
              window.markerBefore === element.querySelector(".date-markers"),
          ),
          true,
        );
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(
          await card
            .locator(".payday-icon")
            .first()
            .evaluate((icon) => {
              const style = getComputedStyle(icon);
              return style.animationTimingFunction;
            }),
          "steps(1)",
          "An open calendar follows a changed reduced-motion preference",
        );
        await page.emulateMedia({ reducedMotion });
        const slot = await card.locator(".date-markers").boundingBox();
        assert.ok(slot.width > 0 && Math.abs(slot.width - slot.height) < 1);
        if (start === "2024-10-15" && reducedMotion === "no-preference") {
          await page.screenshot({
            path: "test-results/employment-anniversary.png",
          });
        }
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  for (const scenario of ["no-animate", "throw-animate"]) {
    const page = await browser.newPage({ reducedMotion: "no-preference" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.install({ time: new Date("2026-10-09T12:00:00+08:00") });
    const fixture = buildPerformanceFixture(1).state;
    fixture.personal.employmentDate = "2024-10-15";
    await page.addInitScript(
      ({ state, scenario }) => {
        localStorage.setItem("worktime-local-v1", JSON.stringify(state));
        Element.prototype.animate =
          scenario === "no-animate"
            ? undefined
            : () => {
                throw Error("Unavailable compositor");
              };
      },
      { state: fixture, scenario },
    );
    await page.goto(pathToFileURL(path.resolve("index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const card = page.locator('[data-date="2026-10-15"]');
    assert.equal(await card.locator(".payday-icon").count(), 2);
    assert.match(await card.getAttribute("aria-label"), /入职 2 周年.*发薪日/);
    await card.click();
    assert.equal(await card.getAttribute("aria-pressed"), "true");
    assert.deepEqual(errors, [], scenario);
    await page.close();
  }
  await browser.close();
  console.log(
    "Employment anniversary: yearly recurrence, leap-day rollover, payroll overlap, animation phases, reduced motion and mobile passed.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});

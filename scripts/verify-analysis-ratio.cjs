"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const initial = await browser.newPage();
    const url = pathToFileURL(path.resolve("index.html")).href;
    await initial.goto(url);
    await initial.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    const state = await initial.evaluate(() =>
      WorkTimeApp.domain.state.defaultState(),
    );
    await initial.close();
    const page = await browser.newPage({
      locale: "zh-CN",
      viewport: { width: 1920, height: 1080 },
    });
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.install({ time: new Date("2026-10-21T04:00:00Z") });
    await page.addInitScript((state) => {
      state.days["2026-10-20"] = {
        kind: "work",
        sourcePriority: "manual",
        actual: {
          start: "08:00",
          end: "17:30",
          nextDay: false,
          effectiveMinutes: null,
        },
      };
      localStorage.setItem("worktime-local-v1", JSON.stringify(state));
    }, state);
    await page.goto(url);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#analysisToggle").click();
    await page.clock.runFor(800);
    const ratio = page.locator(".analysis-metric-ratio");
    // Sample the numerator width and divider/denominator positions from the
    // same event turn through cleanup, including rapid interrupted toggles.
    for (const rapid of [false, true]) {
      const samples = [];
      await page.evaluate((rapid) => {
        const toggle = document.getElementById("analysisManual");
        if (rapid) {
          toggle.click();
          toggle.click();
        }
        toggle.click();
      }, rapid);
      for (const duration of [0, 16, 160, 280, 300]) {
        if (duration) await page.clock.runFor(duration);
        if (duration === 160)
          assert.equal(
            await ratio.evaluate((element) => {
              const incoming = element.querySelector(
                  ":scope > .analysis-ratio-row:not(.analysis-ratio-outgoing)",
                ),
                outgoing = element.querySelector(".analysis-ratio-outgoing"),
                offset = (row) =>
                  new DOMMatrixReadOnly(getComputedStyle(row).transform).m42;
              return (
                incoming?.children.length === 3 &&
                Boolean(incoming.querySelector("svg")) &&
                outgoing?.textContent.includes("—") &&
                offset(incoming) < -1 &&
                offset(outgoing) > 1 &&
                getComputedStyle(outgoing).display !== "none" &&
                [...incoming.querySelectorAll(".summary-number-track")].every(
                  (track) => track.getAnimations().length === 0,
                )
              );
            }),
            true,
            "The entire 0 / 1 row rolls in while the old dash rolls out",
          );
        samples.push(
          await ratio.evaluate((element) => ({
            label: element.getAttribute("aria-label"),
            geometry: [
              ...(
                element.querySelector(
                  ":scope > .analysis-ratio-row:not(.analysis-ratio-outgoing)",
                ) || element
              ).children,
            ].map((child) => {
              const box = child.getBoundingClientRect();
              return [box.x, box.width];
            }),
          })),
        );
      }
      assert.equal(samples[0].label, "0 / 1");
      for (const sample of samples)
        assert.deepEqual(
          sample.geometry,
          samples.at(-1).geometry,
          "Ratio spacing stays at its final geometry throughout manual-data inclusion: " +
            JSON.stringify(samples),
        );
      await page.locator("#analysisManual").uncheck();
      await page.clock.runFor(160);
      assert.equal(
        await ratio.evaluate((element) => {
          const incoming = element.querySelector(
              ":scope > .analysis-ratio-row:not(.analysis-ratio-outgoing)",
            ),
            outgoing = element.querySelector(".analysis-ratio-outgoing");
          return (
            incoming?.textContent.includes("—") &&
            Boolean(outgoing?.querySelector("svg")) &&
            outgoing.querySelectorAll(".analysis-metric-value").length === 2 &&
            new DOMMatrixReadOnly(getComputedStyle(incoming).transform).m42 >
              1 &&
            new DOMMatrixReadOnly(getComputedStyle(outgoing).transform).m42 < -1
          );
        }),
        true,
        "The ratio also rolls out as a whole when returning to the dash",
      );
      await page.clock.runFor(800);
      assert.equal(await ratio.getAttribute("aria-label"), "—");
      assert.equal(await ratio.locator("svg").isVisible(), false);
      assert.equal(
        await ratio.locator('[data-key="denominator"]').isVisible(),
        false,
      );
    }
    console.log("Manual-data ratio spacing and rapid toggles verified.");
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

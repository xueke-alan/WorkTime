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
    for (const width of [1480, 1000, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1400 },
        locale: "zh-CN",
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#agendaMode").click();
      for (let i = 0; i < 8; i++) {
        await page.locator("#agendaNew").click();
        await page.locator("#agendaTitle").fill("稳定位置 " + i);
        await page.locator("#agendaSave").click();
        await page.locator("#agendaForm").waitFor({ state: "hidden" });
      }
      for (const reducedMotion of ["reduce", "no-preference"]) {
        await page.emulateMedia({ reducedMotion });
        await page.waitForTimeout(700);
        const samples = await page.evaluate(async () => {
          const calendar = document.querySelector("#calendar");
          const card = calendar.querySelector(".day.selected");
          const read = () =>
            [...card.querySelectorAll(".daytop,.agenda-chip,.agenda-more")]
              .filter((node) => node.getBoundingClientRect().height)
              .map((node) => {
                const rect = node.getBoundingClientRect();
                return [
                  node.className,
                  rect.y - card.getBoundingClientRect().y,
                  rect.height,
                ];
              });
          const before = read();
          calendar
            .querySelector(".day:not(.selected)[data-date] .day-select")
            .click();
          const result = [before, read()];
          for (let i = 0; i < 8; i++) {
            await new Promise(requestAnimationFrame);
            result.push(read());
          }
          card.querySelector(".day-select").click();
          return result;
        });
        assert.ok(samples[0].some(([name]) => name === "agenda-more"));
        if (width === 1480)
          assert.ok(samples[0].some(([name]) => name === "agenda-chip"));
        for (const sample of samples)
          assert.deepEqual(
            sample,
            samples[0],
            `${width}px ${reducedMotion}: selection must not move chips or overflow text`,
          );
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      const modeSamples = await page.evaluate(async () => {
        document.querySelector("#agendaMode").click();
        document.querySelector("#agendaMode").click();
        const read = () =>
          [...document.querySelectorAll("#calendar .daytop")].map(
            (node) => node.getBoundingClientRect().height,
          );
        const samples = [read()];
        for (let i = 0; i < 8; i++) {
          await new Promise(requestAnimationFrame);
          samples.push(read());
        }
        return samples;
      });
      for (const sample of modeSamples)
        assert.deepEqual(sample, modeSamples[0]);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Agenda chips, overflow labels and date headers retain geometry across selection and mode redraws at desktop, compact and mobile widths.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

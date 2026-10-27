"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const setRange = require("./lib/agenda-test-range.cjs");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const page = await browser.newPage({
        viewport: { width: 1480, height: 1100 },
        reducedMotion,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-19T04:00:00Z"));
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#agendaMode").click();
      for (const [title, start, end] of [
        ["Top", "2026-10-19", "2026-10-25"],
        ["Middle", "2026-10-19", "2026-10-24"],
        ["Lower", "2026-10-19", "2026-10-23"],
        ["Resize", "2026-10-19", "2026-10-21"],
        ["Next week", "2026-10-26", "2026-10-29"],
      ]) {
        await page.locator("#agendaNew").click();
        await page.locator("#agendaTitle").fill(title);
        await page.locator("#agendaScheduleOpen").click();
        await setRange(page, start, end);
        await page.locator("[data-schedule-close]").click();
        await page.locator("#agendaSave").click();
        await page.locator("#agendaForm").waitFor({ state: "hidden" });
      }
      await page
        .locator('#calendar > .day[data-date="2026-10-19"] .day-select')
        .click({ position: { x: 8, y: 8 } });
      for (let index = 0; index < 3; index++) {
        await page.locator("#agendaViewToggle").click();
        await page.waitForTimeout(400);
      }
      const chips = () =>
        page.locator(".agenda-week-lane .agenda-chip").filter({
          has: page.locator(".agenda-chip-title-text", {
            hasText: /^Resize$/,
          }),
        });
      await page.waitForTimeout(600);
      const original = await chips().first().boundingBox();
      const weekOne = '.agenda-week-lane[data-dates^="2026-10-19"]';
      const weekTwo = '.agenda-week-lane[data-dates^="2026-10-26"]';
      const peers = await page
        .locator(".agenda-week-lane .agenda-chip")
        .evaluateAll((nodes) =>
          Object.fromEntries(
            nodes
              .filter(
                (node) =>
                  node.querySelector(".agenda-chip-title-text").textContent !==
                  "Resize",
              )
              .map((node) => [
                node.dataset.agendaEdit,
                node.getBoundingClientRect().top,
              ]),
          ),
        );
      const handle = await chips()
        .first()
        .locator(".agenda-resize-handle")
        .boundingBox();
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
      );
      await page.mouse.down();
      for (const date of [
        "2026-10-28",
        "2026-10-30",
        "2026-10-21",
        "2026-10-28",
      ]) {
        const cell = await page
          .locator(`#calendar > .day[data-date="${date}"]`)
          .boundingBox();
        await page.mouse.move(cell.x + cell.width / 2, cell.y + 20, {
          steps: 8,
        });
        await page.waitForTimeout(260);
        const preview = await page
          .locator('.agenda-resize-segment[data-preview-week="2026-10-19"]')
          .boundingBox();
        assert.ok(
          Math.abs(preview.y - original.y) < 0.2,
          "The source row stays fixed throughout cross-week extension and reversal",
        );
        const positions = await page
          .locator(".agenda-week-lane .agenda-chip:not(.agenda-drag-source)")
          .evaluateAll((nodes) =>
            nodes.map((node) => [
              node.dataset.agendaEdit,
              node.getBoundingClientRect().top,
            ]),
          );
        for (const [id, top] of positions)
          assert.ok(
            Math.abs(top - peers[id]) < 0.2,
            "Peers retain their order until pointer release",
          );
      }
      const beforeRelease = await page
        .locator('.agenda-resize-segment[data-preview-week="2026-10-26"]')
        .boundingBox();
      const nextPeer = await page
        .locator(weekTwo + " .agenda-chip:not(.agenda-drag-source)")
        .boundingBox();
      assert.ok(
        Math.abs(beforeRelease.y - nextPeer.y - nextPeer.height - 3) < 0.2,
        "New-week preview appends without blank rows or overtaking peers",
      );
      await page.mouse.up();
      await page.waitForFunction(
        () => !document.querySelector(".agenda-drag-preview"),
      );
      await page.waitForTimeout(320);
      const final = await chips().first().boundingBox();
      const lane = await page.locator(weekOne).boundingBox();
      assert.ok(
        Math.abs(final.y - lane.y) < 0.2,
        "Date sorting happens only after release",
      );
      assert.ok(final.y < original.y - 30);
      assert.equal(
        await chips().last().getAttribute("data-agenda-segment-end"),
        "2026-10-28",
      );
      const lastHandle = await chips()
        .last()
        .locator(".agenda-resize-handle")
        .boundingBox();
      await page.mouse.move(
        lastHandle.x + lastHandle.width / 2,
        lastHandle.y + lastHandle.height / 2,
      );
      await page.mouse.down();
      const earlier = await page
        .locator('#calendar > .day[data-date="2026-10-21"]')
        .boundingBox();
      await page.mouse.move(earlier.x + earlier.width / 2, earlier.y + 20, {
        steps: 8,
      });
      await page.waitForTimeout(260);
      const shrinking = await page
        .locator('.agenda-resize-segment[data-preview-week="2026-10-19"]')
        .boundingBox();
      assert.ok(
        Math.abs(shrinking.y - final.y) < 0.2,
        "Resizing from a continuation keeps the first week's row fixed",
      );
      await page.keyboard.press("Escape");
      await page.mouse.up();
      assert.equal(
        await chips().last().getAttribute("data-agenda-segment-end"),
        "2026-10-28",
      );
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        "Stable cross-week source/peer order, reversal, release-only sorting and continuation cancellation verified: " +
          reducedMotion,
      );
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

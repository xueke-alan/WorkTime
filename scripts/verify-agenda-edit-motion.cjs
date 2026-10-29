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
    for (const mode of ["compact", "lanes", "three-week"]) {
      const page = await browser.newPage({
        viewport: { width: 1480, height: 1100 },
        reducedMotion: "no-preference",
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(/^https?:/, (r) => r.abort());
      await page.clock.setFixedTime(new Date("2026-10-19T04:00:00Z"));
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#agendaMode").click();
      async function create(
        title,
        start = "2026-10-19",
        end = mode === "compact" ? start : "2026-10-20",
      ) {
        await page.locator("#agendaNew").click();
        await page.locator("#agendaTitle").fill(title);
        await page.locator("#agendaScheduleOpen").click();
        await setRange(page, start, end);
        await page.locator("[data-schedule-close]").click();
        await page.locator("#agendaSave").click();
        await page.locator("#agendaForm").waitFor({ state: "hidden" });
      }
      for (const title of ["Edit me", "Keep B", "Keep C"]) await create(title);
      if (mode === "three-week")
        for (let i = 0; i < 3; i++) {
          await page.locator("#agendaViewToggle").click();
          await page.waitForTimeout(400);
        }
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        window.motionRecords = [];
        const record = (node) => {
          if (
            node instanceof Element &&
            node.matches(".agenda-chip,.agenda-lane-content,.agenda-card-items")
          )
            window.motionRecords.push({
              className: node.className,
              id: node.dataset.agendaEdit || null,
            });
        };
        const play = WorkTimeApp.ui.motion.play;
        WorkTimeApp.ui.motion.play = function (node, ...args) {
          record(node);
          return play.call(this, node, ...args);
        };
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          record(this);
          return animate.apply(this, args);
        };
      });
      for (const field of ["title", "note", "status"]) {
        await page
          .locator("#agendaList .agenda-item-copy")
          .filter({
            has: page.locator("strong", {
              hasText: field === "title" ? /^Edit me$/ : /^Edited title$/,
            }),
          })
          .click();
        if (field === "title")
          await page.locator("#agendaTitle").fill("Edited title");
        if (field === "note")
          await page.locator("#agendaNote").fill("Updated note\nSecond line");
        if (field === "status")
          await page.locator("#agendaItemStatus").selectOption("completed");
        await page.evaluate(() => {
          window.motionRecords = [];
          window.keptChips = [
            ...document.querySelectorAll("#calendar .agenda-chip"),
          ].filter((node) =>
            node
              .querySelector(".agenda-chip-title-text")
              .textContent.startsWith("Keep"),
          );
        });
        await page.locator("#agendaSave").click();
        await page.locator("#agendaForm").waitFor({ state: "hidden" });
        await page.waitForTimeout(350);
        const result = await page.evaluate(() => ({
          records: window.motionRecords,
          retained: window.keptChips.every((node) => node.isConnected),
          outgoing: document.querySelectorAll(".agenda-content-outgoing")
            .length,
        }));
        assert.deepEqual(
          result,
          { records: [], retained: true, outgoing: 0 },
          `${mode}: editing ${field} must not replay calendar entrances or replace unrelated cards`,
        );
      }
      await page.evaluate(() => {
        window.motionRecords = [];
      });
      if (mode === "compact") await create("New only");
      else await create("New only", "2026-10-21", "2026-10-22");
      await page.waitForTimeout(350);
      const added = await page.evaluate(() => {
        const chip = [
          ...document.querySelectorAll("#calendar .agenda-chip"),
        ].find(
          (node) =>
            node.querySelector(".agenda-chip-title-text").textContent ===
            "New only",
        );
        return { id: chip.dataset.agendaEdit, records: window.motionRecords };
      });
      assert.ok(
        added.records.length > 0,
        "Adding a new card retains entrance feedback: " +
          JSON.stringify({ mode, added }),
      );
      assert.ok(
        added.records.every((record) => record.id === added.id),
        "Only the new card animates; shared containers and existing cards remain still",
      );
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        mode +
          ": title/note/status edits remain local; only newly added cards animate; unrelated DOM retained.",
      );
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

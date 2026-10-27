"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const [width, height] of [
      [1480, 1000],
      [1480, 600],
      [900, 900],
      [390, 844],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let discard = false,
        confirmations = 0;
      page.on("dialog", (dialog) => {
        confirmations++;
        return discard ? dialog.accept() : dialog.dismiss();
      });
      await page.route(/^https?:/, (r) => r.abort());
      await page.clock.setFixedTime(new Date("2026-10-19T04:00:00Z"));
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#agendaMode").click();
      await page.locator("#agendaNew").click();
      assert.equal(
        await page.locator("#agendaSave").isDisabled(),
        true,
        "Empty titles cannot be saved",
      );
      await page.locator("#agendaTitle").fill("New editor test");
      await page.locator("#agendaItemStatus").selectOption("in-progress");
      await page.locator("#agendaNote").fill("A note\n".repeat(35));
      assert.equal(await page.locator("#agendaDraft").isVisible(), true);
      assert.equal(
        await page.locator(".agenda-status-input").getAttribute("data-status"),
        "in-progress",
      );
      const layout = await page.evaluate(() => {
        const pane = document.querySelector(".agenda-editor"),
          footer = document.querySelector(".agenda-editor-footer"),
          body = document.querySelector(".agenda-editor-body"),
          note = document.querySelector("#agendaNote");
        const bounds = pane.getBoundingClientRect(),
          actions = footer.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          inside:
            actions.right <= bounds.right + 1 &&
            actions.left >= bounds.left - 1,
          overlap: body.getBoundingClientRect().bottom > actions.top + 1,
          noteHeight: note.getBoundingClientRect().height,
          visibleDesktop: innerWidth <= 1150 || actions.bottom <= innerHeight,
        };
      });
      assert.equal(layout.overflow, false);
      assert.equal(layout.inside, true);
      assert.equal(layout.overlap, false);
      assert.ok(layout.noteHeight <= 241);
      assert.equal(layout.visibleDesktop, true);
      await page.locator("#agendaScheduleOpen").click();
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator("#agendaForm").isVisible(),
        true,
        "Esc closes the date picker before leaving the editor",
      );
      assert.equal(confirmations, 0);
      await page.locator("#agendaNote").focus();
      await page.keyboard.press("Control+Enter");
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
      await page
        .locator("#agendaList .agenda-item-copy")
        .filter({ hasText: "New editor test" })
        .click();
      assert.equal(
        await page.locator("#agendaNote").inputValue(),
        "A note\n".repeat(35),
      );
      await page.locator("#agendaNote").fill("Unsaved edit");
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator("#agendaForm").isVisible(),
        true,
        "Declining discard preserves the editor and draft",
      );
      assert.equal(
        await page.locator("#agendaNote").inputValue(),
        "Unsaved edit",
      );
      discard = true;
      await page.keyboard.press("Escape");
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
      assert.equal(
        await page.locator(".agenda-editor-footer").isVisible(),
        false,
        "Action footer is exclusive to editing",
      );
      await page
        .locator("#agendaList .agenda-item-copy")
        .filter({ hasText: "New editor test" })
        .click();
      assert.notEqual(
        await page.locator("#agendaNote").inputValue(),
        "Unsaved edit",
      );
      await page.locator("#agendaNote").fill("Final note");
      await page.locator("#agendaSave").click();
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
      console.log(
        `${width}x${height}: editor/footer geometry, title validation, status cue, growing notes, keyboard save, picker Esc and protected draft discard verified.`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

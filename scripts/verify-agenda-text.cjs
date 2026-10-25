"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
async function verify() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const [scale, zoom] of [
      [1, 1],
      [1.25, 1],
      [1.5, 1],
      [2, 1],
      [1, 1.25],
    ]) {
      const page = await browser.newPage({
        viewport: { width: 1920, height: 1200 },
        deviceScaleFactor: scale,
        reducedMotion: "reduce",
        locale: "zh-CN",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-20T04:00:00Z"));
      await page.goto(pathToFileURL(path.resolve("index.html")).href);
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      await page.locator("#agendaMode").click();
      for (const title of [
        "痛五痛五痛五".repeat(24),
        "Continuous English title across calendar dates ".repeat(8),
        "中文 English 123 连续文本 ".repeat(12),
      ]) {
        await page.locator("#agendaNew").click();
        await page.locator("#agendaTitle").fill(title);
        await page.locator("#agendaScheduleOpen").click();
        await page.locator("#agendaDateInput").fill("2026-10-14");
        await page.locator("#agendaMultiDay").check();
        await page.locator("#agendaEndDateInput").fill("2026-10-22");
        await page.locator("#agendaAllDay").uncheck();
        await page.locator("#agendaStart").fill("09:00");
        await page.locator("#agendaEnd").fill("18:00");
        await page.locator("[data-schedule-close]").click();
        await page
          .locator("#agendaNote")
          .fill(
            "多行备注 English 文字跨日期 ".repeat(20) +
              "\n第二行备注 ".repeat(12),
          );
        await page.locator("#agendaSave").click();
        await page.locator("#agendaForm").waitFor({ state: "hidden" });
      }
      await page.evaluate((zoom) => {
        document.body.style.zoom = String(zoom);
      }, zoom);
      for (const view of ["month", "week", "fortnight"]) {
        if (view !== "month") await page.locator("#agendaViewToggle").click();
        await page.mouse.move(0, 0);
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const state = await page
          .locator(".agenda-week-lane .agenda-chip:visible")
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              titleCount: node.querySelectorAll(".agenda-chip-title-text")
                .length,
              copies: node.querySelectorAll(".agenda-chip-face > *").length,
              mask: getComputedStyle(node).maskImage,
              texts: [
                ...node.querySelectorAll(
                  ".agenda-chip-title-text, :scope > .agenda-chip-time, :scope > .agenda-chip-note",
                ),
              ].map((text) => ({
                visibility: getComputedStyle(text).visibility,
                mask: getComputedStyle(text).maskImage,
              })),
            })),
          );
        assert.ok(state.length > 0);
        for (const chip of state) {
          assert.equal(chip.titleCount, 1);
          assert.equal(chip.copies, 0);
          assert.equal(chip.mask, "none");
          for (const text of chip.texts) {
            assert.equal(text.visibility, "visible");
            assert.equal(text.mask, "none");
          }
        }
        const strip = page
          .locator(".agenda-week-lane .agenda-chip:visible")
          .first();
        const geometry = await strip.evaluate((node) => {
          const title = node.querySelector(".agenda-chip-title-text");
          const row = node.closest(".agenda-week-lane");
          const first = [...document.querySelectorAll("#calendar > .day")].find(
            (card) =>
              (card.dataset.date || card.dataset.previewDate) ===
              node.dataset.agendaSegmentStart,
          );
          const box = first.getBoundingClientRect();
          return {
            right: title.getBoundingClientRect().right,
            limit: box.right,
            ellipsis: getComputedStyle(title).textOverflow,
            truncated: title.scrollWidth > title.clientWidth,
            date: row.dataset.dates,
          };
        });
        assert.ok(
          geometry.right < geometry.limit,
          `Heading stays inside its first date: ${scale} ${zoom} ${view}`,
        );
        assert.equal(geometry.ellipsis, "ellipsis");
        assert.ok(geometry.truncated);
        if (scale === 1 && zoom === 1)
          await page.screenshot({ path: `artifacts/agenda-text-${view}.png` });
        // Selection changes CSS only: one intact label, no residual text fade.
        await strip.click({ position: { x: 12, y: 8 } });
        assert.equal(
          await strip
            .locator(".agenda-chip-title-text")
            .evaluate((node) => getComputedStyle(node).maskImage),
          "none",
        );
        if (scale === 1 && zoom === 1)
          await page.screenshot({
            path: `artifacts/agenda-text-selected-${view}.png`,
          });
        await page.locator("#agendaCancel").click();
        assert.equal(
          await strip
            .locator(".agenda-chip-title-text")
            .evaluate((node) => getComputedStyle(node).maskImage),
          "none",
        );
        assert.ok(
          await strip
            .locator(".agenda-chip-title-text")
            .evaluate((node) => node.scrollWidth > node.clientWidth),
        );
        // Continuation endpoints are dashed only, without an inset left stroke.
        const continuations = await page
          .locator(".agenda-chip.continues-before:visible")
          .evaluateAll((nodes) =>
            nodes.map((node) => ({
              left: getComputedStyle(node, "::before").width,
              shadow: getComputedStyle(node).getPropertyValue(
                "--agenda-chip-outline",
              ),
              faces: [...node.querySelectorAll(".agenda-chip-face")].map(
                (face) => getComputedStyle(face).boxShadow,
              ),
            })),
          );
        for (const continuation of continuations) {
          assert.equal(continuation.left, "1px");
          for (const shadow of continuation.faces)
            assert.ok(
              !shadow.includes("0px 0px 0px 1px"),
              "No solid outline stacked beside the continuation dash",
            );
        }
      }
      if (scale === 1 && zoom === 1) {
        const strip = page
          .locator(".agenda-week-lane .agenda-chip:visible")
          .first();
        await strip.focus();
        await strip.press("Enter");
        await page.locator("#agendaForm").waitFor({ state: "visible" });
        assert.equal(
          await strip
            .locator(".agenda-chip-title-text")
            .evaluate((node) => getComputedStyle(node).maskImage),
          "none",
        );
        await page.locator("#agendaCancel").click();
        const id = await strip.getAttribute("data-agenda-edit");
        const complete = page.locator(`[data-agenda-complete="${id}"]`);
        await complete.click();
        await page.waitForFunction(
          (id) =>
            [...document.querySelectorAll(".agenda-chip")]
              .filter((node) => node.dataset.agendaEdit === id)
              .every((node) => node.classList.contains("is-complete")),
          id,
        );
        const segments = page.locator(
          `.agenda-week-lane .agenda-chip[data-agenda-edit="${id}"]`,
        );
        for (const segment of await segments.all()) {
          assert.equal(await segment.locator(".agenda-chip-status").count(), 1);
          assert.equal(
            await segment.locator(".agenda-chip-status svg").count(),
            1,
          );
        }
        await complete.click();
        await page.waitForFunction(
          (id) =>
            [...document.querySelectorAll(".agenda-chip")]
              .filter((node) => node.dataset.agendaEdit === id)
              .every((node) => !node.classList.contains("is-complete")),
          id,
        );
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Single-date heading truncation without text masks, keyboard/completion, continuation outlines, month/week/fortnight and DPI/zoom verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

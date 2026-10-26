"use strict";
const setScheduleRange = require("./lib/agenda-test-range.cjs");
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
    const page = await browser.newPage({
      viewport: { width: 1480, height: 1000 },
      locale: "zh-CN",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.locator("#agendaMode").click();
    const settle = () =>
      page.waitForFunction(
        () =>
          !document.querySelector("#calendar").getAnimations({ subtree: true })
            .length,
      );
    async function create(title, date, endDate) {
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill(title);
      await page.locator("#agendaScheduleOpen").click();
      await setScheduleRange(page, date);
      if (endDate) {
        await page.locator("#agendaEndDateInput").fill(endDate);
      }
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
    }
    await create("Target", "2026-10-20");
    await create("Same day", "2026-10-20");
    await create("Same week", "2026-10-21");
    await create("Other week", "2026-10-27");
    await page
      .locator('#calendar [data-date="2026-10-20"] .day-select')
      .click({ position: { x: 2, y: 2 } });
    async function toggle(label, requestedStatus = null, throughForm = false) {
      await settle();
      const complete = page
        .locator("#agendaList .agenda-item")
        .filter({
          hasText: label.startsWith("spanning") ? "Multi-day" : "Target",
        })
        .locator("[data-agenda-status]");
      const id = await complete.getAttribute("data-agenda-status");
      const before = await complete.getAttribute("data-status");
      const nextStatus =
        requestedStatus || (before === "completed" ? "pending" : "completed");
      if (throughForm) {
        await page.locator(`#agendaList [data-agenda-edit="${id}"]`).click();
        await page.locator("#agendaItemStatus").selectOption(nextStatus);
        await settle();
      }
      const probe = await page.evaluateHandle((id) => {
        const calendar = document.querySelector("#calendar");
        const chips = [
          ...calendar.querySelectorAll(".agenda-chip"),
          ...document.querySelectorAll("#agendaList .agenda-item"),
        ];
        const scrolls = [...calendar.querySelectorAll(".agenda-week-lane")].map(
          (node) => [node, node.scrollTop],
        );
        const descendants = [...calendar.querySelectorAll(".agenda-chip *")];
        const result = {
          chips,
          descendants,
          scrolls,
          removed: [],
          animations: [],
        };
        result.observer = new MutationObserver((records) => {
          for (const record of records)
            for (const node of record.removedNodes)
              for (const chip of chips)
                if (node === chip || node.contains(chip))
                  result.removed.push(chip.dataset.agendaEdit);
        });
        result.observer.observe(calendar, { childList: true, subtree: true });
        result.observer.observe(document.querySelector("#agendaList"), {
          childList: true,
          subtree: true,
        });
        result.timer = setInterval(() => {
          for (const animation of calendar.getAnimations({ subtree: true })) {
            const target = animation.effect?.target;
            if (
              target?.matches(
                ".agenda-lane-content, .agenda-card-items, .agenda-chip, .agenda-content-outgoing",
              )
            )
              result.animations.push(
                target.className +
                  ":" +
                  (animation.transitionProperty ||
                    animation.animationName ||
                    "WAAPI"),
              );
          }
        }, 10);
        return result;
      }, id);
      if (throughForm) await page.locator("#agendaSave").click();
      else {
        await complete.click();
        await page
          .locator(`[data-agenda-status-choice="${nextStatus}"]`)
          .click();
      }
      await page.waitForFunction(
        ({ id, before }) =>
          document
            .querySelector('#agendaList [data-agenda-status="' + id + '"]')
            ?.getAttribute("data-status") !== before,
        { id, before },
      );
      await page.waitForTimeout(350);
      const result = await probe.evaluate((probe) => {
        clearInterval(probe.timer);
        probe.observer.disconnect();
        return {
          removed: probe.removed,
          animations: probe.animations,
          connected: [...probe.chips, ...probe.descendants].every(
            (chip) => chip.isConnected,
          ),
          scrollsPreserved: probe.scrolls.every(
            ([node, top]) => node.isConnected && node.scrollTop === top,
          ),
        };
      });
      await probe.dispose();
      assert.deepEqual(result.removed, [], label + ": replaced existing cards");
      assert.deepEqual(
        result.animations,
        [],
        label + ": replayed calendar content animation",
      );
      assert.ok(result.connected, label + ": lost existing cards");
      assert.ok(result.scrollsPreserved, label + ": changed lane scroll");
      const completed = nextStatus === "completed";
      assert.ok(
        await page
          .locator('#calendar .agenda-chip[data-agenda-edit="' + id + '"]')
          .evaluateAll(
            (nodes, { completed, nextStatus }) =>
              nodes.length > 0 &&
              nodes.every(
                (node) =>
                  node.classList.contains("is-complete") === completed &&
                  !node.querySelector(".agenda-chip-status svg") &&
                  node.dataset.status === nextStatus,
              ),
            { completed, nextStatus },
          ),
      );
      console.log(
        label +
          ": completion updated in place; other cards, animations and scroll preserved.",
      );
    }
    for (const label of ["compact month", "week", "fortnight", "three-week"]) {
      if (label !== "compact month")
        await page.locator("#agendaViewToggle").click();
      await toggle(label);
      await toggle(label + " undo");
      await toggle(label + " progress", "in-progress");
      await toggle(label + " cancel", "cancelled");
      await toggle(label + " reopen", "pending");
      await toggle(label + " form", "completed", true);
      await toggle(label + " form undo", "pending", true);
    }
    await page.locator("#agendaViewToggle").click();
    await create("Multi-day", "2026-10-20", "2026-10-29");
    for (const label of [
      "spanning month",
      "spanning week",
      "spanning fortnight",
      "spanning three-week",
    ]) {
      if (label !== "spanning month")
        await page.locator("#agendaViewToggle").click();
      await toggle(label);
      await toggle(label + " undo");
      await toggle(label + " progress", "in-progress");
      await toggle(label + " cancel", "cancelled");
      await toggle(label + " reopen", "pending");
      await toggle(label + " form", "completed", true);
      await toggle(label + " form undo", "pending", true);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

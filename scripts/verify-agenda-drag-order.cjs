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
    const page = await browser.newPage({
      viewport: { width: 1480, height: 1000 },
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.setFixedTime(new Date("2026-10-29T04:00:00Z"));
    await page.goto(
      pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
    );
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.locator("#agendaMode").click();
    let created = 0;
    for (const [title, start, end, note] of [
      ["创建较早的短跨度", "2026-10-20", "2026-10-31", ""],
      ["中间日程", "2026-10-20", "2026-11-01", "两行备注\n保持位置"],
      ["创建较晚的长跨度", "2026-10-20", "2026-11-02", ""],
      ["周二高卡片", "2026-10-27", "2026-10-27", "多一行备注"],
      ["周三短卡片", "2026-10-28", "2026-10-28", ""],
      ["周三下方卡片", "2026-10-28", "2026-10-28", "备注"],
      ["定时单日任务", "2026-10-29", "2026-10-29", ""],
      ["拖动目标", "2026-10-31", "2026-11-07", ""],
    ]) {
      await page.clock.setFixedTime(
        new Date(Date.UTC(2026, 9, 29, 4, created++)),
      );
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill(title);
      await page.locator("#agendaNote").fill(note);
      await page.locator("#agendaScheduleOpen").click();
      await setRange(page, start, end);
      if (title === "定时单日任务") {
        await page.locator("#agendaAllDay").uncheck();
        await page.locator("#agendaStart").fill("08:30");
        await page.locator("#agendaEnd").fill("09:30");
      }
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      if (
        (await page
          .locator("#agendaViewToggle")
          .getAttribute("data-agenda-view")) === "2"
      )
        break;
      await page.locator("#agendaViewToggle").click();
    }
    await page.waitForFunction(
      () =>
        !!document.querySelector(
          '.agenda-packed-row[data-dates^="2026-10-26"]',
        ),
    );
    await page.waitForFunction(
      () =>
        !document.querySelector(
          ".agenda-week-leaving, .calendar-navigation-viewport",
        ) &&
        !document
          .querySelector("#calendar")
          .getAnimations({ subtree: true })
          .some((a) => a.pending || a.playState === "running"),
    );
    const row = page.locator('.agenda-packed-row[data-dates^="2026-10-26"]');
    assert.equal(
      await row
        .locator(".agenda-chip")
        .filter({ hasText: "定时单日任务" })
        .locator("[data-agenda-resize]")
        .count(),
      0,
      "Timed single-day tasks do not expose a cross-day resize handle",
    );
    const positions = () =>
      row
        .locator(".agenda-chip:visible")
        .evaluateAll((nodes) =>
          Object.fromEntries(
            nodes.map((node) => [
              node.querySelector(".agenda-chip-title-text").textContent,
              node.getBoundingClientRect().top,
            ]),
          ),
        );
    const auditRelease = () =>
      page.evaluate(() => {
        window.releaseDisabledChanges = [];
        window.releaseObserver = new MutationObserver((records) => {
          for (const record of records)
            if (
              record.target.matches(
                "#agendaViewToggle,#analysisToggle,#agendaBack,#agendaFields,#agendaSave,#agendaCancel",
              )
            )
              window.releaseDisabledChanges.push(record.target.id);
        });
        window.releaseObserver.observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ["disabled"],
        });
      });
    const verifyRelease = async () => {
      const changes = await page.evaluate(() => {
        window.releaseObserver.disconnect();
        return window.releaseDisabledChanges;
      });
      assert.deepEqual(
        changes,
        [],
        "Drop must not briefly dim toolbar or editor controls",
      );
    };
    const stableTitles = [
      "创建较早的短跨度",
      "中间日程",
      "创建较晚的长跨度",
      "周二高卡片",
      "周三短卡片",
      "周三下方卡片",
    ];
    const before = await positions();
    assert.ok(
      before["创建较早的短跨度"] < before["创建较晚的长跨度"],
      JSON.stringify(before),
    );
    const source = row.locator(".agenda-chip").filter({ hasText: "拖动目标" });
    await source.click();
    await page.locator("#agendaForm").waitFor({ state: "visible" });
    const box = await source.boundingBox();
    const target = await page
      .locator(
        '#calendar > .day[data-date="2026-11-01"], #calendar > .day[data-preview-date="2026-11-01"]',
      )
      .boundingBox();
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + 35, box.y + box.height / 2, { steps: 10 });
    await page.locator(".agenda-drag-preview").first().waitFor();
    const during = await positions();
    for (const title of stableTitles)
      assert.ok(
        Math.abs(during[title] - before[title]) < 1,
        `${title} stays in its painted row during another item's drag`,
      );
    await auditRelease();
    await page.mouse.up();
    await page.waitForFunction(
      () => !document.querySelector(".agenda-drag-preview"),
    );
    const after = await positions();
    await verifyRelease();
    for (const title of stableTitles)
      assert.ok(
        Math.abs(after[title] - before[title]) < 1,
        `${title} stays in its painted row after drop`,
      );
    const endHandle = page
      .locator('.agenda-packed-row[data-dates^="2026-11-02"] .agenda-chip')
      .filter({ hasText: "拖动目标" })
      .locator("[data-agenda-resize]")
      .last();
    const edge = await endHandle.boundingBox();
    const previousDay = await page
      .locator(
        '#calendar > .day[data-date="2026-11-07"], #calendar > .day[data-preview-date="2026-11-07"]',
      )
      .boundingBox();
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      previousDay.x + previousDay.width / 2,
      edge.y + edge.height / 2,
      { steps: 10 },
    );
    await page.locator(".agenda-drag-preview").first().waitFor();
    const resizing = await positions();
    for (const title of stableTitles)
      assert.ok(
        Math.abs(resizing[title] - before[title]) < 1,
        `${title} stays in its painted row during resize`,
      );
    await auditRelease();
    await page.mouse.up();
    await page.waitForFunction(
      () => !document.querySelector(".agenda-drag-preview"),
    );
    const resized = await positions();
    await verifyRelease();
    for (const title of stableTitles)
      assert.ok(
        Math.abs(resized[title] - before[title]) < 1,
        `${title} stays in its painted row after resize`,
      );
    console.log(
      "Packed ribbon positions stay stable during move/resize and after drop.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

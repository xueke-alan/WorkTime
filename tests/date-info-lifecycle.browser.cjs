"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const page = await browser.newPage();
  await page.setContent(
    '<div class="editor"><div class="notification-tabs"></div><div class="date-info-area"><div id="editorInfo"></div><div id="dateInfoPanel"></div></div></div>',
  );
  await page.clock.install();
  for (const file of ["namespace.js", "ui/elements.js"])
    await page.addScriptTag({
      path: path.resolve(__dirname, "../assets/js", file),
    });
  await page.evaluate(() => {
    const subscribers = new Set();
    window.lifecycleStats = { countdown: 0, demand: false };
    WorkTimeApp.services.dateInfo = {
      register() {},
      list: () =>
        [
          "notifications",
          "countdown",
          "weather",
          "history",
          "festivals",
          "almanac",
        ].map((id) => ({ id, label: id, icon: "clock" })),
      getContent(id) {
        if (id !== "countdown") return { ok: true, rows: [["content", id]] };
        window.lifecycleStats.countdown++;
        return {
          ok: true,
          countdown: {
            status: "working",
            message: "countdown",
            time: String(window.lifecycleStats.countdown),
            end: "18:00",
          },
        };
      },
    };
    WorkTimeApp.services.weather = {
      subscribe(callback) {
        subscribers.add(callback);
        return () => subscribers.delete(callback);
      },
      setDemand(key, value) {
        window.lifecycleStats.demand = value;
      },
      snapshot: () => ({ record: null }),
    };
    window.subscriberCount = () => subscribers.size;
    window.publishWeather = () => subscribers.forEach((callback) => callback());
  });
  await page.addScriptTag({
    path: path.resolve(__dirname, "../assets/js/date-info-ui.js"),
  });
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.evaluate(() => {
      const ui = WorkTimeApp.ui.dateInfo;
      ui.mount();
      ui.mount();
      ui.setDate("2026-10-04");
      document.getElementById("date-tab-countdown").click();
    });
    assert.equal(await page.evaluate(() => window.subscriberCount()), 1);
    assert.equal(await page.locator(".notification-tabs button").count(), 4);
    assert.equal(await page.locator(".date-context-header").count(), 1);
    const before = await page.evaluate(() => window.lifecycleStats.countdown);
    await page.clock.runFor(1000);
    assert.equal(
      await page.evaluate(() => window.lifecycleStats.countdown),
      before + 1,
      "one countdown update per tick",
    );
    await page.locator("#date-tab-history").click();
    await page.locator("#date-context-history").press("ArrowRight");
    assert.equal(
      await page
        .locator("#date-context-festivals")
        .getAttribute("aria-selected"),
      "true",
    );
    await page.locator("#date-tab-countdown").click();
    await page.evaluate(() => {
      const ui = WorkTimeApp.ui.dateInfo;
      ui.dispose();
      ui.dispose();
      ui.refreshTabs();
      document.getElementById("date-context-history").click();
      window.publishWeather();
    });
    assert.equal(await page.evaluate(() => window.subscriberCount()), 0);
    assert.equal(
      await page.evaluate(() => window.lifecycleStats.demand),
      false,
    );
    const disposed = await page.evaluate(() => window.lifecycleStats.countdown);
    await page.clock.runFor(3000);
    assert.equal(
      await page.evaluate(() => window.lifecycleStats.countdown),
      disposed,
      "disposed countdown does not tick",
    );
    assert.equal(
      await page.locator("#date-tab-countdown").getAttribute("aria-selected"),
      "true",
      "disposed handlers do not change tabs",
    );
  }
  await browser.close();
  console.log(
    "Date-info lifetime passed: repeated mounting, one subscription/timer, keyboard recovery and disposal.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});

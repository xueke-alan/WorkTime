"use strict";
const assert = require("node:assert/strict"),
  path = require("node:path");
let browser;
(async () => {
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
  await page.goto(
    require("node:url").pathToFileURL(path.resolve(__dirname, "../index.html"))
      .href,
  );
  await page.locator("#date-tab-history").click();
  const events = await page.locator(".history-event-content").allTextContents();
  assert(events.length >= 10);
  assert(events.every((text) => text.length > 5));
  const scrolling = await page.locator("#dateInfoPanel").evaluate((panel) => {
    panel.scrollTop = panel.scrollHeight;
    const last = panel.querySelector(".history-event:last-of-type");
    return {
      scrollable:
        panel.scrollHeight > panel.clientHeight && panel.scrollTop > 0,
      lastVisible:
        last.getBoundingClientRect().bottom <=
        panel.getBoundingClientRect().bottom + 1,
    };
  });
  assert(
    scrolling.scrollable && scrolling.lastVisible,
    "expanded history scrolls to the final event",
  );
  assert.equal(await page.locator(".history-event a").count(), 0);
  assert.equal(await page.locator(".history-event [tabindex]").count(), 0);
  await page.reload();
  assert.equal(
    await page.locator("#date-tab-history").getAttribute("aria-selected"),
    "true",
    "last selected tab restored",
  );
  await page.evaluate(() => {
    WorkTimeApp.services.dateInfo.register({
      id: "link-test",
      label: "测试资料",
      getContent: () => ({
        title: "测试资料",
        events: [
          { year: 2000, text: "不合法来源", sourceUrl: "javascript:alert(1)" },
        ],
        sections: [
          {
            label: "来源",
            links: [
              { text: "有效来源", url: "https://example.com/source" },
              { text: "不合法来源", url: "file:///data" },
            ],
          },
        ],
      }),
    });
    WorkTimeApp.ui.dateInfo.refreshTabs();
  });
  await page.locator("#date-tab-link-test").click();
  assert.equal(
    await page.locator("#dateInfoPanel a").count(),
    2,
    "only valid HTTPS section source and more-history source are links",
  );
  assert.equal(
    await page.locator(".history-event-content").evaluate((e) => e.tagName),
    "DIV",
  );
  assert.equal(
    await page.locator(".festival-links a").getAttribute("href"),
    "https://example.com/source",
  );
  assert.equal(
    await page.locator(".festival-links span").textContent(),
    "不合法来源",
  );
  await browser.close();
  console.log(
    "Date info passed: plain event cards, remembered tab and valid HTTPS-only section links.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});

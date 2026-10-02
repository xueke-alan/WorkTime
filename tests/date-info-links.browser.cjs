"use strict";
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  path = require("node:path");
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
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
  const links = await page.locator(".history-event-link").evaluateAll((items) =>
    items.map((item) => ({
      tag: item.tagName,
      href: item.href,
      target: item.target,
      rel: item.rel,
      text: item.textContent,
    })),
  );
  assert(links.length > 0);
  for (const item of links) {
    assert.equal(item.tag, "A");
    assert.equal(new URL(item.href).protocol, "https:");
    assert(
      new URL(item.href).searchParams.get("oldid"),
      "retain specific revision",
    );
    assert.equal(new URL(item.href).searchParams.get("variant"), "zh-cn");
    assert.equal(item.target, "_blank");
    assert(item.rel.includes("noreferrer"));
    assert(item.text.length > 5);
  }
  await page.locator(".history-event-link").first().focus();
  await page.locator("#dateInfoPanel").screenshot({
    path: path.resolve(__dirname, "../docs/refactor-history-links.png"),
  });
  assert.equal(
    await page
      .locator(".history-event-link")
      .first()
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.reload();
  assert.equal(
    await page.locator("#date-tab-history").getAttribute("aria-selected"),
    "true",
    "last selected tab restored",
  );
  await page.evaluate(() => {
    window.DateInfo.register({
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
    window.DateInfoUI.refreshTabs();
  });
  await page.locator("#date-tab-link-test").click();
  assert.equal(
    await page.locator("#dateInfoPanel a").count(),
    2,
    "only valid HTTPS section source and more-history source are links",
  );
  assert.equal(
    await page.locator(".history-event-link").evaluate((e) => e.tagName),
    "SPAN",
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
    "Date info links passed: event revision/variant, keyboard focus, remembered tab and valid HTTPS-only section links.",
  );
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});

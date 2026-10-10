"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
async function verifyTemplates(page) {
  const templates = Array.from({ length: 6 }, (_, index) => ({
    name: "跨午夜工作模板名称用于验证长文本可以完整换行显示" + index,
    start: "08:00",
    end: "01:30",
    nextDay: true,
  }));
  const text = await page.evaluate(
    (items) => WorkTimeApp.services.templateShare.encode(items),
    templates,
  );
  await page.locator("#dayImportTemplates").click();
  await page.locator("#templateImportText").fill(text);
  await page.waitForSelector("#templateImportPreview article");
  assert.equal(await page.locator("#templateImportPreview article").count(), 6);
  assert.equal(await page.locator(".template-preview-nextday").count(), 6);
  assert.match(
    await page.locator("#templateImportWarning").textContent(),
    /替换/,
  );
  for (const width of [1440, 768, 540, 375, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const geometry = await page.evaluate(() => {
      const pane = document.querySelector(".template-import-preview-scroll");
      return {
        overflow: pane.scrollWidth - pane.clientWidth,
        names: [
          ...document.querySelectorAll("#templateImportPreview strong"),
        ].map((element) => element.getBoundingClientRect().width),
        inputHeight: document.querySelector("#templateImportText").clientHeight,
        rowsFit: [
          ...document.querySelectorAll("#templateImportPreview article"),
        ].every((row) => row.scrollHeight <= row.clientHeight),
      };
    });
    assert.ok(geometry.overflow <= 1, "Template preview must fit at " + width);
    assert.ok(geometry.names.every((size) => size >= 50));
    assert.ok(geometry.inputHeight >= 40);
    assert.ok(geometry.rowsFit, "Long names must fit their preview rows");
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#templateImportText").fill("invalid");
  assert.equal(await page.locator("#confirmTemplateImport").isDisabled(), true);
  await page.waitForFunction(
    () => document.querySelector("#templateImportError").textContent,
  );
  await page.locator("#templateImportText").fill(text);
  await page.locator("#templateImportDialog [data-close]").first().click();
  await page.waitForTimeout(350);
  assert.equal(await page.locator("#templateImportPreview article").count(), 0);
  await page.locator("#dayImportTemplates").click();
  assert.equal(await page.locator("#templateImportText").inputValue(), "");
  // A decode already in flight must not restore a preview after closing.
  await page.evaluate(() => {
    const transport = WorkTimeApp.services.templateShare;
    const decode = transport.decode;
    transport.decode = async (value) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return decode(value);
    };
    window.reviewRestoreDecode = () => {
      transport.decode = decode;
    };
  });
  await page.locator("#templateImportText").fill(text);
  await page.locator("#parseTemplateImport").click();
  await page.locator("#templateImportDialog [data-close]").first().click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#templateImportPreview article").count(), 0);
  assert.equal(await page.locator("#confirmTemplateImport").isDisabled(), true);
  await page.evaluate(() => {
    window.reviewRestoreDecode();
    delete window.reviewRestoreDecode;
  });
  await page.locator("#dayImportTemplates").click();
  await page.locator("#templateImportText").fill(text);
  await page.waitForSelector("#templateImportPreview article");
  await page.locator("#confirmTemplateImport").click();
  await page.waitForFunction(
    () => !document.querySelector("#templateImportDialog").open,
  );
  assert.equal(
    await page.locator("#timeTemplateList [data-template-fill]").count(),
    6,
  );
  assert.equal(await page.locator("#addTimeTemplate").isDisabled(), true);
  // Exercise successful sharing without writing to the system clipboard.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.reviewSharedText = value;
        },
      },
    });
  });
  await page.locator("#dayShareTemplates").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#dayShareTemplates")
      .classList.contains("is-copying"),
  );
  assert.deepEqual(
    await page.evaluate(() =>
      WorkTimeApp.services.templateShare.decode(window.reviewSharedText),
    ),
    templates,
  );
  await page.waitForFunction(
    () =>
      !document
        .querySelector("#dayShareTemplates")
        .classList.contains("is-copying"),
  );
  await page.locator("#timeTemplateList [data-template-fill]").first().click();
  assert.equal(await page.locator("#dayStart").inputValue(), "08:00");
  assert.equal(await page.locator("#dayEnd").inputValue(), "01:30");
  assert.equal(
    await page.locator("#dayNextToggle").getAttribute("aria-pressed"),
    "true",
  );
  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.appState === "ready",
  );
  assert.equal(
    await page.locator("#timeTemplateList [data-template-fill]").count(),
    6,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#monthTitle").click();
  assert.equal(await page.locator("[data-year-date]").count(), 365);
  assert.equal(
    await page.evaluate(
      () => document.querySelector(".year-day").getAnimations().length,
    ),
    0,
  );
  await page.locator("#monthTitle").click();
}
async function verify() {
  const root = path.resolve(process.argv[2] || "_site");
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
  };
  const server = http.createServer((request, response) => {
    const file = path.resolve(
      root,
      "." + new URL(request.url, "http://localhost").pathname,
    );
    if (
      !file.startsWith(root + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      "Content-Type",
      types[path.extname(file)] || "application/octet-stream",
    );
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({
      channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
      headless: true,
    });
    for (const url of [
      "http://127.0.0.1:" + server.address().port + "/index.html",
      pathToFileURL(path.join(root, "index.html")).href,
    ]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date("2026-10-10T04:00:00Z"));
      const errors = [],
        historyRequests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (/\/history\/\d{2}\.js/.test(request.url()))
          historyRequests.push(request.url());
      });
      await page.route(/^https?:/, (route) =>
        route.request().url().startsWith("http://127.0.0.1:")
          ? route.continue()
          : route.abort(),
      );
      await page.goto(url);
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      assert.ok((await page.locator("button.day[data-date]").count()) >= 28);
      assert.equal(
        historyRequests.length,
        0,
        "History must not block the default first screen",
      );
      await page.locator("#date-tab-history").click();
      await page.waitForSelector(".history-event");
      assert.equal(historyRequests.length, 1);
      await page.evaluate(() => WorkTimeApp.ui.dateInfo.setDate("2026-01-01"));
      await page.waitForFunction(
        () =>
          document.querySelector(".date-context-date").textContent ===
            "2026-01-01" && document.querySelector(".history-event"),
      );
      // A failed month request must be retryable without reloading the app.
      await page.route(/\/history\/02\.js/, (route) => route.abort(), {
        times: 1,
      });
      await page.evaluate(() => WorkTimeApp.ui.dateInfo.setDate("2026-02-01"));
      await page.getByRole("button", { name: "重试", exact: true }).click();
      await page.waitForSelector(".history-event");
      assert.equal(
        historyRequests.filter((url) => /\/02\.js/.test(url)).length,
        2,
      );
      // A slow previous selection cannot replace the current date's panel.
      await page.route(/\/history\/05\.js/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        await route.continue();
      });
      await page.evaluate(() => {
        WorkTimeApp.ui.dateInfo.setDate("2026-05-01");
        WorkTimeApp.ui.dateInfo.setDate("2026-06-01");
      });
      await page.waitForSelector(".history-event");
      await page.evaluate(() =>
        WorkTimeApp.services.dateInfo.loadHistory("2026-05-01"),
      );
      assert.equal(
        await page.locator(".date-context-date").textContent(),
        "2026-06-01",
      );
      assert.equal(
        await page.locator(".history-event-content p").first().textContent(),
        await page.evaluate(
          () =>
            WorkTimeApp.services.dateInfo.getContent("history", "2026-06-01")
              .events[0].text,
        ),
      );
      await page.evaluate(async () => {
        const service = WorkTimeApp.services.dateInfo;
        await Promise.all([
          service.loadHistory("2026-04-01"),
          service.loadHistory("2026-04-02"),
        ]);
        for (let month = 1; month <= 12; month++)
          await service.loadHistory(
            "2026-" + String(month).padStart(2, "0") + "-01",
          );
      });
      assert.equal(
        historyRequests.filter((url) => /\/04\.js/.test(url)).length,
        1,
        "Concurrent requests share a month load",
      );
      assert.equal(
        await page.evaluate(
          () => Object.keys(WorkTimeApp.data.dateInfo.history).length,
        ),
        366,
      );
      assert.deepEqual(errors, []);
      await verifyTemplates(page);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(
      "Published HTTP/offline startup, lazy history, template import/persistence, responsive layout and reduced motion verified.",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

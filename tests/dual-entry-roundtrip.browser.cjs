"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, ".."),
  fixture = fs.readFileSync(
    path.join(__dirname, "fixtures/legacy-schema1.json"),
    "utf8",
  );
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    ),
    file = path.resolve(root, "." + pathname);
  if (
    !file.startsWith(root + path.sep) ||
    !/^\/(?:index\.html$|assets\/|tools\/)/.test(pathname)
  ) {
    response.writeHead(404).end();
    return;
  }
  try {
    response.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(fs.readFileSync(file));
  } catch {
    response.writeHead(404).end();
  }
});
let browser;
async function snapshot(page) {
  return page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("worktime-local-v1"));
    return {
      state,
      september: WorkTimeApp.domain.statistics.summary(
        state,
        "2026-09-01",
        "2026-09-30",
      ),
      october: WorkTimeApp.domain.statistics.summary(
        state,
        "2026-10-01",
        "2026-10-31",
      ),
    };
  });
}
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const outputs = [];
  const requestAudit = [];
  for (const entry of ["file", "http"]) {
    const context = await browser.newContext({
        timezoneId: "Asia/Shanghai",
        reducedMotion: "reduce",
        acceptDownloads: true,
      }),
      page = await context.newPage(),
      errors = [],
      unexpected = [],
      failed = [],
      requests = [];
    let phase = "converter";
    page.on("request", (request) =>
      requests.push({
        phase,
        type: request.resourceType(),
        url: request.url(),
      }),
    );
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => failed.push(request.url()));
    await page.route(/^https?:/, (route) => {
      if (
        route
          .request()
          .url()
          .startsWith(origin + "/")
      )
        return route.continue();
      unexpected.push(route.request().url());
      return route.abort();
    });
    await require("../scripts/lib/fixed-business-date.cjs").fixBusinessDate(
      page,
    );
    await page.addInitScript(() => {
      Math.random = () => 0.314159;
      window.clipboardValue = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          readText: async () => window.clipboardValue,
          writeText: async (text) => {
            window.clipboardValue = text;
          },
        },
      });
    });
    const url = (relative) =>
      entry === "file"
        ? pathToFileURL(path.join(root, relative)).href
        : origin + "/" + relative;
    await page.goto(url("tools/convert-backup.html"));
    await page.evaluate(
      (text) => localStorage.setItem("worktime-local-v1", text),
      fixture,
    );
    await page.locator("#backupInput").fill(fixture);
    await page.locator("#convert").click();
    await page.waitForFunction(
      () => !document.getElementById("download").disabled,
    );
    const converted = await page.locator("#backupOutput").inputValue(),
      pendingConversion = page.waitForEvent("download");
    await page.locator("#download").click();
    assert.equal(
      fs.readFileSync(await (await pendingConversion).path(), "utf8"),
      converted,
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("worktime-local-v1")),
      fixture,
      "Converter preserves old storage bytes",
    );
    phase = "application";
    await page.goto(url("index.html"));
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    assert.match(
      await page.locator("#storageNoticeText").textContent(),
      /convert-backup.html/,
    );
    await page.evaluate((text) => {
      window.clipboardValue = text;
    }, converted);
    await page.locator("#restore").click();
    await page.locator("#confirmRestore").click();
    assert.deepEqual((await snapshot(page)).state, JSON.parse(converted));
    await page.locator("#importOpen").click();
    await page.locator("#pasteText").fill("09/27\n08:00\n19:00");
    await page.waitForFunction(
      () => !document.getElementById("commitImport").disabled,
    );
    await page.locator("#commitImport").click();
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime-local-v1")).days["2026-09-27"]
          ?.oa?.end === "19:00",
    );
    // Import focuses its first accepted date, so select explicitly through year view.
    await page.locator("#monthTitle").click();
    await page.locator('[data-year-date="2026-09-29"]').click();
    await page.locator("#dayEnd").fill("20:30");
    await page.locator("#dayForm").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime-local-v1")).days["2026-09-29"]
          ?.estimate?.end === "20:30",
    );
    const before = await snapshot(page);
    assert.equal(before.state.imports.length, 2);
    assert.equal(before.state.imports[0].records.length, 2);
    assert.equal(before.state.imports[1].records.length, 1);
    await page.locator("#backup").click();
    await page.waitForFunction(() =>
      window.clipboardValue.startsWith(WorkTimeApp.services.backup.PREFIX),
    );
    const compressed = await page.evaluate(() => window.clipboardValue);
    const exported = await page.evaluate(async () =>
      WorkTimeApp.services.backup.decode(
        window.clipboardValue,
        WorkTimeApp.domain.validation.validateBackup,
      ),
    );
    assert.deepEqual(exported, before.state);
    const pendingExport = page.waitForEvent("download");
    await page.locator("#backup").focus();
    await page.keyboard.down("Space");
    const download = await pendingExport;
    await page.keyboard.up("Space");
    const raw = fs.readFileSync(await download.path(), "utf8");
    assert.deepEqual(
      await page.evaluate(
        async (text) =>
          WorkTimeApp.services.backup.decode(
            text,
            WorkTimeApp.domain.validation.validateBackup,
          ),
        raw,
      ),
      before.state,
    );
    await page.locator("#dayEnd").fill("21:00");
    await page.locator("#dayForm").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("worktime-local-v1")).days["2026-09-29"]
          ?.estimate?.end === "21:00",
    );
    await page.evaluate((text) => {
      window.clipboardValue = text;
    }, compressed);
    await page.locator("#restore").click();
    await page.locator("#confirmRestore").click();
    assert.deepEqual(
      await snapshot(page),
      before,
      "Compressed restore reverses intervening edit and retains summaries",
    );
    phase = "reload";
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    assert.deepEqual(
      await snapshot(page),
      before,
      "Reload preserves restored state",
    );
    await page.evaluate(() => {
      window.clipboardValue = "";
    });
    const choosing = page.waitForEvent("filechooser");
    await page.locator("#restore").click();
    await (
      await choosing
    ).setFiles({
      name: "export.json",
      mimeType: "application/json",
      buffer: Buffer.from(raw),
    });
    await page.locator("#confirmRestore").click();
    assert.deepEqual(
      await snapshot(page),
      before,
      "Downloaded JSON restore retains every accepted record and statistic",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    assert.deepEqual(failed, []);
    for (const stage of ["converter", "application", "reload"]) {
      const scripts = requests.filter(
        (request) => request.phase === stage && request.type === "script",
      );
      assert(scripts.length > 0, entry + " " + stage + " scripts observed");
      assert.equal(
        new Set(scripts.map((request) => request.url)).size,
        scripts.length,
        entry + " " + stage + " loads each script once",
      );
      if (stage !== "converter")
        assert.equal(
          scripts.some((request) =>
            /legacy-v2|convert-backup\.js/.test(request.url),
          ),
          false,
          "Application never loads conversion runtime",
        );
    }
    requestAudit.push({ entry, requests, errors, unexpected, failed });
    outputs.push(before);
    await context.close();
    console.log(
      entry +
        ": convert/download, old storage rejection, restore/import/edit, compressed and downloaded export, restore/reload passed without failed/remote requests.",
    );
  }
  assert.deepEqual(
    outputs[0],
    outputs[1],
    "Identical file and HTTP samples and business results",
  );
  fs.writeFileSync(
    path.join(root, "test-results/dual-entry-roundtrip-results.json"),
    JSON.stringify(
      {
        complete: true,
        sameStateAndStatistics: true,
        results: outputs,
        requestAudit,
      },
      null,
      2,
    ) + "\n",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  });

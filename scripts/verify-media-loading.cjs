"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { enableReaderRuntime } = require("./runtime-test-helpers.cjs");
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const delay = 300;
async function main() {
  const server = http.createServer((req, res) => {
    const file = path.resolve(
      root,
      "." + new URL(req.url, "http://local").pathname,
    );
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "application/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({
      channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
      headless: true,
    });
    for (const protocol of ["file", "http"]) {
      for (const feature of process.env.WORKTIME_REVIEW_SKIP_READER === "1"
        ? ["music"]
        : ["music", "reader"]) {
        const context = await browser.newContext({
          reducedMotion: "reduce",
          serviceWorkers: "block",
        });
        const page = await context.newPage();
        if (feature === "reader") await enableReaderRuntime(page);
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(() =>
          localStorage.setItem("worktime.onboarding.v1", "dismissed"),
        );
        const requests = [];
        let fail = protocol === "http";
        await page.route(/\/assets\/(?:js|css)\//, async (route) => {
          const url = route.request().url();
          if (
            new RegExp(feature + "(?:-runtime\\.min)?\\.(?:js|css)").test(url)
          ) {
            requests.push(url);
            if (protocol === "http") {
              await new Promise((resolve) => setTimeout(resolve, delay));
              if (fail && url.includes("-runtime.min.js")) {
                fail = false;
                await route.abort();
                return;
              }
            }
          }
          await route.continue();
        });
        const url =
          protocol === "file"
            ? pathToFileURL(path.join(root, "index.html")).href
            : `http://127.0.0.1:${server.address().port}/index.html`;
        await page.goto(url);
        await page.waitForFunction(
          () => document.documentElement.dataset.appState === "ready",
        );
        assert.equal(
          await page.evaluate(
            (feature) =>
              typeof WorkTimeApp.ui[
                `create${feature === "music" ? "Music" : "Reader"}Controller`
              ],
            feature,
          ),
          "undefined",
          "Calendar startup keeps media controllers and storage lazy",
        );
        const runtimeRequests = () =>
          requests.filter((url) => url.includes("-runtime.min.js"));
        assert.equal(runtimeRequests().length, 0);
        if (protocol === "http") {
          await page.evaluate(
            (feature) => WorkTimeApp.ui[feature].open(),
            feature,
          );
          assert.equal(
            runtimeRequests().length,
            1,
            "Failed downloads are attempted once",
          );
        }
        const result = await page.evaluate(async (feature) => {
          const start = performance.now();
          const loader = WorkTimeApp.ui[feature];
          await Promise.all([loader.open(), loader.open()]);
          return Math.round(performance.now() - start);
        }, feature);
        await page.waitForFunction(
          (id) => document.getElementById(id)?.dataset.state === "open",
          feature === "music" ? "musicDialog" : "readerDialog",
        );
        assert.equal(runtimeRequests().length, protocol === "http" ? 2 : 1);
        if (protocol === "http") {
          const resources = await page.evaluate(() =>
            performance.getEntriesByType("resource").map((r) => ({
              name: r.name,
              start: r.startTime,
              end: r.responseEnd,
            })),
          );
          const runtime = resources.find((r) =>
            r.name.includes(feature + "-runtime.min.js"),
          );
          const style = resources.find((r) =>
            r.name.includes(`/css/${feature}.css`),
          );
          assert.ok(
            style.start < runtime.end && runtime.start < style.end,
            "Script and style downloads overlap on the initial attempt",
          );
          assert.ok(
            result < delay * 3,
            "Opening must avoid the old multi-round resource waterfall",
          );
        }
        assert.deepEqual(errors, []);
        console.log(
          `${protocol} ${feature}: ${result}ms; lazy startup, concurrent opens and download retry verified`,
        );
        // Leave contexts alive until browser.close(): Edge can exit when the last page closes.
      }
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

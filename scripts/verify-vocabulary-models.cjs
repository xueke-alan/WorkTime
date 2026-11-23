"use strict";
require("./lib/browser-test-setup.cjs");
const assert = require("node:assert/strict"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { chromium } = require("playwright");
const { runtimeServer } = require("./runtime-test-helpers.cjs");
const { pathToFileURL } = require("node:url");
async function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const server = await runtimeServer(root),
    browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/model-test.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Models</title>",
      }),
    );
    await page.goto(new URL("model-test.html", server.url).href);
    const payloads = {
      "us.onnx": "US pinned model bytes",
      "uk.onnx": "UK pinned model bytes",
    };
    const files = {};
    let requests = 0;
    for (const [name, value] of Object.entries(payloads)) {
      files[name] = {
        bytes: Buffer.byteLength(value),
        sha256: crypto.createHash("sha256").update(value).digest("hex"),
        url: new URL("models/" + name, server.url).href,
      };
      await page.route("**/models/" + name, async (route) => {
        requests++;
        await route.fulfill({ body: value });
      });
    }
    await page.evaluate(async (files) => {
      const dir = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("speech-model-test", { create: true });
      window.modelDirectory = dir;
      window.WorkTimeApp = {
        data: {
          vocabularySpeech: {
            groups: { supertonic: ["us.onnx"], piper: ["uk.onnx"] },
            files,
          },
        },
        services: {
          assets: { script: async () => {} },
          runtimeFolder: {
            state: { revision: 1 },
            withEnglish: (action) => action(dir),
          },
        },
      };
    }, files);
    for (const name of ["vocabulary-audio-cache", "vocabulary-models"])
      await page.addScriptTag({
        url: new URL("assets/js/services/" + name + ".js", server.url).href,
      });
    const progress = await page.evaluate(async () => {
      const models = WorkTimeApp.services.vocabularyModels;
      const states = [];
      const unsubscribe = models.subscribe(() => {
        if (models.state.phase === "downloading") states.push(models.state);
      });
      await models.prepare();
      unsubscribe();
      return states;
    });
    for (const [accent, name] of [
      ["us", "us.onnx"],
      ["uk", "uk.onnx"],
    ]) {
      const states = progress.filter((state) => state.accent === accent);
      assert(states.length > 0);
      assert(states.every((state) => state.modelTotal === files[name].bytes));
      assert.equal(states.at(-1).modelLoaded, files[name].bytes);
    }
    assert.equal(requests, 2);
    assert(
      await page.evaluate(async (spec) => {
        const model = WorkTimeApp.services.vocabularyModels;
        const [a, b] = await Promise.all([
          model.download(spec),
          model.download(spec),
        ]);
        const separate = a.buffer !== b.buffer;
        a[0] ^= 1;
        return separate && a[0] !== b[0];
      }, files["us.onnx"]),
      "Concurrent clients receive independent model buffers",
    );
    assert.equal(requests, 3, "Concurrent requests share one download");
    await page.route("**/bad-model", (route) =>
      route.fulfill({ body: "x".repeat(files["us.onnx"].bytes) }),
    );
    assert(
      await page.evaluate(
        async (spec) => {
          try {
            await WorkTimeApp.services.vocabularyModels.download(spec);
            return false;
          } catch {
            return true;
          }
        },
        { ...files["us.onnx"], url: new URL("bad-model", server.url).href },
      ),
      "Untrusted download bytes must match the pinned checksum",
    );
    assert(
      await page.evaluate(
        async (spec) => {
          const model = WorkTimeApp.services.vocabularyModels;
          const operation = model.download(spec);
          model.cancel();
          try {
            await operation;
            return false;
          } catch {
            return model.state.phase === "cancelled";
          }
        },
        {
          ...files["us.onnx"],
          url: new URL("cancelled-model", server.url).href,
        },
      ),
      "Cancellation rejects an active transfer and reports its state",
    );
    await page.route("**/models/**", (route) => route.abort());
    await page.evaluate(() => WorkTimeApp.services.vocabularyModels.prepare());
    assert.equal(
      requests,
      3,
      "Installed resources work offline without another request",
    );
    const packed = () => {
      const resources = Object.entries(files).map(([name, spec]) => ({
        engine: name === "us.onnx" ? "supertonic" : "piper",
        name,
        bytes: spec.bytes,
        sha256: spec.sha256,
      }));
      const header = Buffer.from(
          JSON.stringify({
            format: "worktime-speech-models",
            version: 1,
            resources,
          }),
        ),
        prefix = Buffer.alloc(14);
      prefix.write("WTMODELS1\n");
      prefix.writeUInt32LE(header.length, 10);
      return Buffer.concat([
        prefix,
        header,
        ...Object.values(payloads).map((value) => Buffer.from(value)),
      ]);
    };
    const packageBytes = packed();
    await page.evaluate(async () => {
      for (const name of ["resources-piper", "resources-supertonic-3"])
        await window.modelDirectory.removeEntry(name, { recursive: true });
    });
    const corrupt = Buffer.from(packageBytes);
    corrupt[corrupt.length - 1] ^= 1;
    const rejected = await page.evaluate(
      async (bytes) => {
        try {
          await WorkTimeApp.services.vocabularyModels.install(
            new File([new Uint8Array(bytes)], "models.wtmodels"),
          );
          return false;
        } catch {
          return true;
        }
      },
      [...corrupt],
    );
    assert(rejected);
    assert.equal(
      await page.evaluate(async () => {
        let count = 0;
        for await (const unused of window.modelDirectory.keys()) {
          void unused;
          count++;
        }
        return count;
      }),
      0,
      "Corrupt package writes no resources",
    );
    await page.evaluate(
      (bytes) =>
        WorkTimeApp.services.vocabularyModels.install(
          new File([new Uint8Array(bytes)], "models.wtmodels"),
        ),
      [...packageBytes],
    );
    await page.evaluate(() => WorkTimeApp.services.vocabularyModels.prepare());
    assert.equal(requests, 3);
    assert.equal(
      await page.evaluate(
        () => WorkTimeApp.services.vocabularyModels.state.phase,
      ),
      "installed",
    );
    assert(
      await page.evaluate(
        async (bytes) => {
          try {
            await WorkTimeApp.services.vocabularyModels.install(
              new File([new Uint8Array(bytes.slice(0, -1))], "short.wtmodels"),
            );
            return false;
          } catch {
            return true;
          }
        },
        [...packageBytes],
      ),
    );
    const noFolder = await page.evaluate(async () => {
      WorkTimeApp.services.runtimeFolder.withEnglish = async () => null;
      try {
        await WorkTimeApp.services.vocabularyModels.prepare();
        return false;
      } catch {
        return true;
      }
    });
    assert(noFolder);
    const ui = await browser.newPage({
      viewport: { width: 390, height: 1000 },
    });
    const unexpected = [];
    await ui.route(/^https?:/, (route) => {
      unexpected.push(route.request().url());
      return route.abort();
    });
    await ui.goto(pathToFileURL(path.join(root, "index.html")).href);
    await ui.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await ui.locator("#date-tab-tools").click();
    await ui.locator("#vocabularyOpen").click();
    await ui.locator('[data-page="preferences"]').click();
    assert.deepEqual(
      await ui.locator(".vocabulary-management-groups h4").allTextContents(),
      ["发音模型"],
    );
    assert.equal(
      await ui.locator(".vocabulary-model-settings .vocabulary-muted").count(),
      0,
    );
    assert.match(
      await ui.locator(".vocabulary-accent-caution").innerText(),
      /英音发音准确度不高/,
    );
    await ui.evaluate(() => {
      window.modelDownloadLinks = [];
      window.open = (...args) => window.modelDownloadLinks.push(args);
    });
    await ui.getByRole("button", { name: "下载", exact: true }).click();
    assert.deepEqual(await ui.evaluate(() => window.modelDownloadLinks), [
      [
        "https://github.com/xueke-alan/WorkTime/releases",
        "_blank",
        "noopener,noreferrer",
      ],
    ]);
    assert.equal(
      await ui.locator(".vocabulary-model-cancel").isVisible(),
      false,
    );
    assert.equal(
      await ui.getByRole("button", { name: "导入", exact: true }).count(),
      1,
    );
    assert(
      await ui
        .locator(".vocabulary-page")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await ui.locator(".vocabulary-model-settings").scrollIntoViewIfNeeded();
    await ui.screenshot({
      path: path.resolve(
        __dirname,
        "../test-results/model-settings-mobile.png",
      ),
    });
    assert.deepEqual(
      unexpected,
      [],
      "Opening settings never downloads model binaries",
    );
    await ui.setViewportSize({ width: 1440, height: 1000 });
    await ui.evaluate(async () => {
      await WorkTimeApp.services.preferences.page.saveMotionMode("full");
      WorkTimeApp.ui.vocabulary.open();
    });
    await ui.locator("#pageSettingsOpen").click();
    await ui.waitForFunction(() => WorkTimeApp.ui.vocabulary.isMini);
    await ui
      .locator(".vocabulary-mini-expand")
      .click({ position: { x: 10, y: 100 } });
    await ui.waitForFunction(
      () =>
        !WorkTimeApp.ui.vocabulary.isMini &&
        document.getElementById("settingsPane").hidden,
    );
    await ui.close();
    console.log(
      "Pinned model downloads, verified persistence, offline reuse, package import, whole-package validation, truncation and missing-folder guards passed.",
    );
  } finally {
    await browser.close();
    await server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

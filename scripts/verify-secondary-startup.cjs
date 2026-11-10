"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const { startupServer } = require("./lib/startup-test-server.cjs");
const root = path.resolve(__dirname, ".."),
  site = path.resolve(process.argv[2] || path.join(root, "_site"));
const secondary = /\/secondary-runtime\.min\.js/;
async function audit(context, fallback = false) {
  await context.addInitScript(
    ({ fallback }) => {
      const show = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function (...args) {
        const result = show.apply(this, args);
        if (this.id === "onboardingDialog") this.close();
        return result;
      };
      window.secondaryAudit = { creates: {}, binds: {}, motionAtWarm: null };
      if (fallback) window.requestIdleCallback = undefined;
      document.addEventListener("worktime:prewarm-start", () => {
        const state = window.secondaryAudit;
        state.coverAtWarm =
          document.documentElement.classList.contains("app-loading");
        state.motionAtWarm = [
          ...document.querySelectorAll(".workspace>.panel,main.wrap>footer"),
        ]
          .flatMap((element) => element.getAnimations?.() || [])
          .filter(
            (animation) =>
              animation.animationName === "motion-startup" &&
              animation.playState !== "finished",
          ).length;
      });
      document.addEventListener(
        "load",
        (event) => {
          if (event.target.tagName !== "SCRIPT") return;
          if (fallback && event.target.src.includes("/startup-runtime.min.js"))
            for (const panel of document.querySelectorAll(
              ".workspace>.panel,main.wrap>footer",
            ))
              panel.getAnimations = undefined;
          if (!event.target.src.includes("/secondary-runtime.min.js")) return;
          for (const name of ["settings", "personal", "imports"]) {
            const create = WorkTimeApp.ui.secondary[name];
            WorkTimeApp.ui.secondary[name] = (...args) => {
              const state = window.secondaryAudit;
              state.creates[name] = (state.creates[name] || 0) + 1;
              const controller = create(...args),
                bind = controller.bind;
              controller.bind = () => {
                state.binds[name] = (state.binds[name] || 0) + 1;
                return bind();
              };
              return controller;
            };
          }
        },
        true,
      );
    },
    { fallback },
  );
}
async function ready(page) {
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading") &&
      !document.body.inert,
  );
}
async function warmed(page) {
  await page.waitForFunction(
    () => WorkTimeApp.ui.secondaryControllers.state === "ready",
  );
}
async function race(browser, server, kind) {
  const context = await browser.newContext({
    locale: "zh-CN",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let fail = kind === "retry",
    requests = 0;
  try {
    await audit(context);
    await context.route(secondary, async (route) => {
      requests++;
      if (fail) return route.abort();
      await gate;
      await route.continue().catch(() => {});
    });
    const page = await context.newPage();
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await ready(page);
    await page.locator("#pageSettingsOpen").dispatchEvent("click");
    if (kind === "retry") {
      await page.locator('[data-secondary-status="failed"]').waitFor();
      assert.equal(requests, 1, "a background failure must not loop");
      fail = false;
      release();
      await page.locator("[data-secondary-status] button").click();
      await page.waitForFunction(
        () => !document.getElementById("settingsPane").hidden,
      );
      assert.equal(requests, 2);
    } else if (kind === "close") {
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent("pagehide")),
      );
      release();
      await page.waitForTimeout(800);
      assert.equal(
        await page.evaluate(() => WorkTimeApp.ui.secondaryControllers.state),
        "closed",
      );
      assert.deepEqual(
        await page.evaluate(() => window.secondaryAudit.binds),
        {},
      );
      assert.equal(await page.locator("#settingsPane").isVisible(), false);
      return;
    } else if (kind === "escape") {
      await page.keyboard.press("Escape");
      release();
      await warmed(page);
      assert.equal(await page.locator("#settingsPane").isVisible(), false);
      assert.equal(await page.locator("[data-secondary-status]").count(), 0);
    } else {
      await page.locator("#importOpen").dispatchEvent("click");
      await page.locator("#importOpen").dispatchEvent("click");
      await page.waitForFunction(
        () =>
          document.querySelector('script[src*="secondary-runtime.min.js"]')
            ?.fetchPriority === "high",
      );
      assert.equal(
        await page.locator("#pageSettingsOpen").getAttribute("aria-busy"),
        null,
      );
      release();
      await page.waitForFunction(
        () => document.getElementById("importDialog").open,
      );
      assert.equal(
        await page.locator("#settingsPane").isVisible(),
        false,
        "only the last requested target opens",
      );
    }
    await warmed(page);
    assert.equal(requests, kind === "retry" ? 2 : 1);
    assert.deepEqual(await page.evaluate(() => window.secondaryAudit.binds), {
      settings: 1,
      personal: 1,
      imports: 1,
    });
  } finally {
    release();
    await context.close();
  }
}
async function hiddenAndFallback(browser, url, fallback) {
  const context = await browser.newContext({
    locale: "zh-CN",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
  });
  try {
    await audit(context, fallback);
    await context.addInitScript(() => {
      window.testHidden = false;
      Object.defineProperty(document, "hidden", {
        get: () => window.testHidden,
      });
    });
    const page = await context.newPage(),
      requests = [];
    page.on("request", (request) => {
      if (secondary.test(request.url())) requests.push(request.url());
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await ready(page);
    await page.evaluate(() => {
      window.testHidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(850);
    assert.equal(requests.length, 0, "hidden pages do not start prewarming");
    await page.evaluate(() => {
      window.testHidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await warmed(page);
    assert.equal(requests.length, 1);
  } finally {
    await context.close();
  }
}
async function nativePermissions(browser, url) {
  const context = await browser.newContext({
    locale: "zh-CN",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  try {
    await audit(context);
    await context.addInitScript(() => {
      let inClick = false;
      document.addEventListener(
        "load",
        (event) => {
          if (
            event.target.tagName !== "SCRIPT" ||
            !event.target.src.includes("/core-runtime.min.js")
          )
            return;
          const create = WorkTimeApp.ui.createEventScope;
          WorkTimeApp.ui.createEventScope = (...args) => {
            const scope = create(...args),
              handler = scope.handler;
            scope.handler = (element, name, callback) =>
              handler(element, name, (...args) => {
                inClick = true;
                try {
                  return callback(...args);
                } finally {
                  inClick = false;
                }
              });
            return scope;
          };
        },
        true,
      );
      window.nativeCalls = [];
      window.open = (url) => {
        window.nativeCalls.push({
          url,
          inClick,
          active: navigator.userActivation.isActive,
        });
        return null;
      };
      Object.defineProperty(navigator.clipboard, "readText", {
        value: () => {
          window.clipboardInClick = inClick;
          return Promise.resolve("");
        },
      });
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await ready(page);
    await page.locator("#importOASite").click();
    assert.equal(
      (await page.evaluate(() => window.nativeCalls))[0].inClick,
      true,
    );
    await page.waitForFunction(
      () => document.getElementById("importDialog").open,
    );
    // The existing long-press edits the address; it never replays a native gesture.
    await page.locator("#oaShortcut").focus();
    await page.keyboard.down("Space");
    await page.waitForTimeout(2500);
    await page.keyboard.up("Space");
    await page.locator("#oaLinkDialog[open]").waitFor();
    await page.locator("#oaLinkInput").fill("https://example.com/attendance");
    await page.locator('#oaLinkForm button[type="submit"]').click();
    await page.waitForFunction(
      () => !document.getElementById("oaLinkDialog").open,
    );
    await page.locator("#oaShortcut").click();
    assert.deepEqual((await page.evaluate(() => window.nativeCalls)).slice(1), [
      { url: "https://example.com/attendance", inClick: true, active: true },
    ]);
    await page.locator("#pasteOAClipboard").click();
    assert.equal(await page.evaluate(() => window.clipboardInClick), true);
  } finally {
    await context.close();
  }
}
async function main() {
  const server = await startupServer(site),
    browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const kind of ["last", "retry", "escape", "close"])
      await race(browser, server, kind);
    for (const fallback of [false, true])
      await hiddenAndFallback(browser, server.url, fallback);
    for (const url of [
      server.url,
      pathToFileURL(path.join(root, "index.html")).href,
    ])
      await nativePermissions(browser, url);
    for (const locale of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"])
      for (const width of [1440, 390])
        for (const url of [
          server.url,
          pathToFileURL(path.join(root, "index.html")).href,
          pathToFileURL(path.join(site, "index.html")).href,
        ]) {
          const context = await browser.newContext({
            locale,
            viewport: { width, height: 1000 },
            reducedMotion: width === 390 ? "reduce" : "no-preference",
            serviceWorkers: "block",
          });
          try {
            await audit(context);
            const page = await context.newPage(),
              errors = [],
              requests = [];
            page.on("pageerror", (error) => errors.push(error.message));
            page.on("request", (request) => {
              if (secondary.test(request.url())) requests.push(request.url());
            });
            await page.goto(url, { waitUntil: "domcontentloaded" });
            await ready(page);
            assert.equal(
              await page
                .locator('link[rel="preload"][href*="secondary-runtime"]')
                .count(),
              0,
            );
            await warmed(page);
            const state = await page.evaluate(() => window.secondaryAudit);
            assert.equal(state.coverAtWarm, false);
            assert.equal(state.motionAtWarm, 0);
            assert.deepEqual(state.binds, {
              settings: 1,
              personal: 1,
              imports: 1,
            });
            assert.equal(requests.length, 1);
            await page.locator("#pageSettingsOpen").click();
            await page.locator("#settingsPane").waitFor({ state: "visible" });
            await page.locator("#personalSettingsCancel").click();
            await page.locator("#importOpen").click();
            await page.waitForFunction(
              () => document.getElementById("importDialog").open,
            );
            assert.equal(requests.length, 1);
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        }
    console.log(
      "Secondary startup: post-intro prewarm, one download/bind, last target, retry/cancel/close, visibility and fallbacks, native permissions, six languages and desktop/mobile HTTP/file entries verified.",
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

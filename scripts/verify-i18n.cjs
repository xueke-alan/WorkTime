"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const widths = [390, 850, 1150, 1440, 1920];
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
async function ready(page) {
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading"),
  );
}
async function englishText(page, label) {
  const text = await page.locator("body").innerText();
  assert.ok(
    !/[\u3400-\u9fff]/.test(
      text.replace(/简体中文|繁體中文-台|繁體中文-港|日本語/g, ""),
    ),
    label + ": English UI contains Chinese text",
  );
  const untranslated = await page.evaluate(() =>
    [...document.querySelectorAll("[aria-label],[title],[placeholder]")]
      .filter(
        (element) =>
          element.getClientRects().length &&
          getComputedStyle(element).visibility !== "hidden",
      )
      .flatMap((element) =>
        ["aria-label", "title", "placeholder"].map(
          (name) => element.getAttribute(name) || "",
        ),
      )
      .filter((text) => /[\u3400-\u9fff]/.test(text)),
  );
  assert.deepEqual(
    untranslated,
    [],
    label + ": untranslated accessible labels",
  );
  assert.ok(
    !/\d\s*month\b|Week[一二三四五六日]|\d{4}年/.test(text),
    label + ": untranslated date units",
  );
}
async function verifyFixedLanguage(browser) {
  for (const locale of ["zh-CN", "en-GB"]) {
    const context = await browser.newContext({ locale });
    try {
      const page = await context.newPage();
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(pathToFileURL(path.join(root, "index.html")).href);
      await ready(page);
      const expected = locale === "zh-CN" ? "zh-CN" : "en";
      await page.waitForFunction(
        () => !WorkTimeApp.services.preferences.page.dirty,
      );
      assert.equal(
        await page.evaluate(
          () => WorkTimeApp.services.preferences.page.state.language,
        ),
        expected,
      );
      assert.deepEqual(
        await page
          .locator("#languageOptions [data-value]")
          .evaluateAll((items) => items.map((item) => item.dataset.value)),
        ["zh-CN", "zh-TW", "zh-HK", "en", "ko", "ja"],
      );
      // System changes must neither switch the current page nor change a saved language on reload.
      await page.addInitScript(
        (language) => {
          Object.defineProperty(navigator, "languages", {
            get: () => [language],
          });
          Object.defineProperty(navigator, "language", { get: () => language });
        },
        expected === "en" ? "zh-CN" : "en-GB",
      );
      await page.evaluate(
        (language) => {
          Object.defineProperty(navigator, "languages", {
            get: () => [language],
          });
          Object.defineProperty(navigator, "language", { get: () => language });
          window.dispatchEvent(new Event("languagechange"));
          // Prove the archive, rather than only the paint cache, keeps the choice.
          localStorage.removeItem("worktime.languagePaintCache");
        },
        expected === "en" ? "zh-CN" : "en-GB",
      );
      assert.equal(await page.locator("html").getAttribute("lang"), expected);
      await page.reload();
      await ready(page);
      assert.equal(await page.locator("html").getAttribute("lang"), expected);
      const migrated = await page.evaluate(async () => {
        const results = [];
        for (const legacy of ["auto", undefined, "es", "de", "fr"]) {
          const owner = WorkTimeApp.services.preferences.create({
            getStorage: () => localStorage,
          });
          let saved;
          const state = { pageTheme: "green", language: legacy };
          owner.attach({
            state,
            getState: () => state,
            save: async (patch) => {
              saved = patch.language;
              Object.assign(state, patch);
              return { persisted: true };
            },
          });
          await Promise.resolve();
          results.push({
            saved,
            language: owner.state.language,
            dirty: owner.dirty,
          });
          // Restoring a legacy backup uses synchronize rather than attach.
          state.language = "auto";
          saved = null;
          owner.synchronize();
          await Promise.resolve();
          if (saved !== owner.state.language || owner.dirty)
            throw Error("Legacy restore did not persist an explicit language");
          owner.dispose();
        }
        return results;
      });
      assert.deepEqual(
        migrated,
        Array.from({ length: 5 }, () => ({
          saved: expected,
          language: expected,
          dirty: false,
        })),
      );
      const failure = await page.evaluate(async () => {
        const owner = WorkTimeApp.services.preferences.create({
          getStorage: () => localStorage,
        });
        let last;
        owner.subscribe((state, result) => {
          last = result;
        });
        owner.attach({
          state: { pageTheme: "green", language: "auto" },
          save: async () => ({
            persisted: false,
            error: Error("Injected language migration failure"),
          }),
        });
        await Promise.resolve();
        const result = {
          dirty: owner.dirty,
          code: last.code,
          names: last.preferenceNames,
        };
        owner.dispose();
        return result;
      });
      assert.deepEqual(failure, {
        dirty: true,
        code: "PREFERENCE_WRITE_FAILED",
        names: ["language"],
      });
      const retry = await page.evaluate(async () => {
        const owner = WorkTimeApp.services.preferences.create({
          getStorage: () => localStorage,
        });
        const saved = { pageTheme: "green", language: "zh-CN", weatherDays: 5 };
        let fail = true;
        owner.attach({
          state: saved,
          save: async (patch) => {
            if (fail) return { persisted: false, error: Error("Busy archive") };
            Object.assign(saved, patch);
            return { persisted: true };
          },
        });
        await owner.saveLanguage("en");
        fail = false;
        const result = await owner.saveWeatherDays(7);
        const recovered = {
          saved,
          visible: owner.state,
          dirty: owner.dirty,
          names: result.preferenceNames,
        };
        // A later completion must include the patch from an older in-flight save.
        const writes = [];
        owner.attach({
          state: saved,
          save: (patch) =>
            new Promise((resolve) => writes.push({ patch, resolve })),
        });
        const first = owner.saveTheme("blue");
        const second = owner.saveWeatherDays(3);
        writes[0].resolve({
          persisted: false,
          error: Error("Earlier failure"),
        });
        await first;
        Object.assign(saved, writes[1].patch);
        writes[1].resolve({ persisted: true });
        await second;
        const concurrent = { patch: writes[1].patch, dirty: owner.dirty };
        owner.dispose();
        return { recovered, concurrent };
      });
      assert.equal(retry.recovered.saved.language, "en");
      assert.deepEqual(retry.recovered.visible, {
        pageTheme: "green",
        language: "en",
        weatherDays: 7,
      });
      assert.equal(retry.recovered.dirty, false);
      assert.deepEqual(retry.recovered.names, ["language", "weatherDays"]);
      assert.deepEqual(retry.concurrent, {
        patch: { pageTheme: "blue", weatherDays: 3 },
        dirty: false,
      });
    } finally {
      await context.close();
    }
  }
}
async function verifyLanguageMotion(browser) {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: 1000 },
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await ready(page);
    await page.locator("#date-tab-history").click();
    await page.locator("#date-context-almanac").click();
    await page.locator("#pageSettingsOpen").click();
    await page.waitForTimeout(750);
    await page.evaluate(() => {
      const preferences = WorkTimeApp.services.preferences.page;
      // Hold persistence open so even a short-lived save notice is observable.
      preferences.attach({
        state: preferences.state,
        save: () =>
          new Promise((resolve) => {
            window.finishPreferenceSave = () => resolve({ persisted: true });
          }),
      });
      window.languageAnimations = [];
      window.monthWidthTransitions = [];
      document.addEventListener("transitionrun", (event) => {
        if (event.target.id === "monthTitle" && event.propertyName === "width")
          window.monthWidthTransitions.push(event.propertyName);
      });
      document.addEventListener("animationstart", (event) => {
        window.languageAnimations.push(event.animationName);
      });
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        window.languageAnimations.push("web-animation");
        return animate.apply(this, args);
      };
    });
    const titleLayout = () =>
      page.evaluate(() =>
        ["#monthTitle", ".month-title-month", "#nextMonth"].map((selector) => {
          const box = document.querySelector(selector).getBoundingClientRect();
          return { x: box.x, width: box.width };
        }),
      );
    const originalTitleLayout = await titleLayout();
    for (const language of ["en", "zh-CN", "en"]) {
      await page.locator("#languageTrigger").click();
      await page
        .locator('#languageOptions [data-value="' + language + '"]')
        .click();
      await page.waitForFunction(() => !!window.finishPreferenceSave);
      assert.equal(await page.locator("html").getAttribute("lang"), language);
      assert.deepEqual(
        await page.locator(".theme-save-notice").allTextContents(),
        ["", "", ""],
        "Language persistence must not display a theme save notice",
      );
      const before = await page.locator("#languageTrigger").boundingBox();
      await page.evaluate(() => {
        window.finishPreferenceSave();
        window.finishPreferenceSave = null;
      });
      await page.waitForFunction(
        () => !WorkTimeApp.services.preferences.page.dirty,
      );
      await page.waitForTimeout(500);
      if (language === "en") {
        const layout = await titleLayout();
        assert.ok(layout[0].width > originalTitleLayout[0].width);
        assert.ok(
          (await page.evaluate(() => window.monthWidthTransitions.length)) > 0,
          "Month title width changes must animate",
        );
        assert.ok(
          await page.evaluate(() => {
            const year = document
                .querySelector(".month-title-year")
                .getBoundingClientRect(),
              divider = document
                .querySelector(".month-title-divider")
                .getBoundingClientRect(),
              word = document
                .querySelector(".month-title-month .summary-number-word")
                .getBoundingClientRect();
            return (
              Math.abs(
                divider.left - year.right - (word.left - divider.right),
              ) < 1
            );
          }),
          "The slash must have the same gap to the year and natural-width month word",
        );
      } else assert.deepEqual(await titleLayout(), originalTitleLayout);
      assert.deepEqual(
        await page.locator("#languageTrigger").boundingBox(),
        before,
        "Save completion must not move the language field",
      );
      assert.deepEqual(
        await page.evaluate(() => window.languageAnimations),
        [],
        "Language refresh must not replay surface or number animations",
      );
    }
    // The suppression must end with the language refresh, preserving normal UI.
    await page.locator('.theme-card input[value="blue"]').check();
    assert.equal(
      await page.locator(".theme-settings .theme-save-notice").textContent(),
      "",
    );
    await page.evaluate(() => window.finishPreferenceSave());
    await page.waitForFunction(
      () => !WorkTimeApp.services.preferences.page.dirty,
    );
    await page.locator("#personalSettingsCancel").click();
    assert.ok(
      await page
        .locator(".editor-content")
        .evaluate((element) =>
          element
            .getAnimations()
            .some((animation) => animation.playState === "running"),
        ),
      "Normal navigation must animate after language refresh",
    );
    await context.close();
  }
}
async function verifyMonthWidths(browser) {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(pathToFileURL(path.join(root, "index.html")).href);
      await ready(page);
      const layouts = new Map();
      for (const language of ["en", "zh-CN", "en"]) {
        await page.evaluate(
          (value) => WorkTimeApp.i18n.setLanguage(value),
          language,
        );
        for (let month = 0; month < 12; month++) {
          const layout = await page.evaluate(() => {
            const title = document
              .querySelector("#monthTitle")
              .getBoundingClientRect();
            const slot = document
              .querySelector(".month-title-month")
              .getBoundingClientRect();
            const next = document
              .querySelector("#nextMonth")
              .getBoundingClientRect();
            const word = document.querySelector(
              ".month-title-month .summary-number-word",
            );
            if (word && word.getBoundingClientRect().right > slot.right + 1)
              throw Error("Month abbreviation exceeds its fixed slot");
            return [title.width, slot.width, next.x];
          });
          if (!layouts.has(language)) layouts.set(language, layout);
          assert.deepEqual(
            layout,
            layouts.get(language),
            language + ": month navigation must keep its width and position",
          );
          if (language === "en")
            assert.match(
              await page
                .locator("#monthTitleMonth .summary-number-accessible")
                .textContent(),
              /^[A-Z][a-z]{2}$/,
            );
          await page.locator("#nextMonth").click();
        }
      }
    } finally {
      await context.close();
    }
  }
}
async function verifyNotificationLanguage(browser) {
  const context = await browser.newContext({
    locale: "en-GB",
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await ready(page);
    const backup = await page.evaluate(() => {
      const state = WorkTimeApp.domain.state.defaultState();
      state.preferences.language = "en";
      state.days["2026-10-11"] = {
        oa: {
          date: "2026-10-11",
          start: "08:00",
          end: "19:30",
          nextDay: false,
          status: "complete",
          source: "test",
          raw: "",
          importId: "",
        },
      };
      return JSON.stringify(
        WorkTimeApp.domain.validation.validateBackup(state),
      );
    });
    await page.locator("#backupFile").setInputFiles({
      name: "notification-language.json",
      mimeType: "application/json",
      buffer: Buffer.from(backup),
    });
    await page.locator("#confirmRestore").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("#oaStaleNotice").classList.contains("hidden"),
    );
    await page.waitForFunction(
      () => !document.querySelector("#feedbackList").childElementCount,
    );
    for (const language of ["zh-CN", "en"]) {
      await page.locator("#date-tab-countdown").click();
      await page.evaluate(
        (language) => WorkTimeApp.i18n.setLanguage(language),
        language,
      );
      assert.equal(
        await page.locator("#date-tab-countdown").getAttribute("aria-selected"),
        "true",
        "Translating an existing warning must preserve the active tab",
      );
    }
    await page.evaluate(() => {
      const alert = document.createElement("div");
      alert.id = "newWarningRegression";
      alert.className = "info-notification tone-warning";
      alert.innerHTML = '<div class="notification-body">New warning</div>';
      document.getElementById("feedbackList").append(alert);
    });
    await page.waitForFunction(
      () =>
        document
          .getElementById("date-tab-notifications")
          .getAttribute("aria-selected") === "true",
    );
    await page.evaluate(() =>
      document.getElementById("newWarningRegression").remove(),
    );
    await page.evaluate(() =>
      document.querySelector("#backupBeforeRestore").click(),
    );
    await page.waitForFunction(
      () => document.querySelector("#feedbackList").childElementCount === 1,
    );
    const result = await page.evaluate(() => {
      const notice = document.querySelector("#oaStaleNotice");
      const feedback = document.querySelector("#feedbackList .feedback-notice");
      return ["zh-CN", "en", "zh-CN"].map((language) => {
        WorkTimeApp.i18n.setLanguage(language);
        return {
          language,
          text: notice.querySelector(".notification-body").textContent,
          title: notice.title,
          feedback: feedback.querySelector(".notification-body").textContent,
          expectedFeedback: WorkTimeApp.i18n.t("copy.5091362c8b"),
          sameFeedback:
            document.querySelector("#feedbackList .feedback-notice") ===
            feedback,
          count: feedback.querySelector(".ring-count").textContent,
        };
      });
    });
    for (const item of result) {
      assert.equal(
        item.text,
        item.language === "en"
          ? "OA records are 10 days old. Import an update."
          : "OA 工时已 10 天未更新，请导入",
      );
      assert.equal(
        item.title,
        (item.language === "en" ? "Latest OA entry: " : "最新 OA 工时：") +
          "2026-10-11",
      );
      assert.equal(item.feedback, item.expectedFeedback);
      assert.equal(item.sameFeedback, true);
      assert.equal(item.count, "3");
    }
    await page.waitForFunction(
      () => !document.querySelector("#feedbackList").childElementCount,
    );
  } finally {
    await context.close();
  }
  console.log(
    "Notification text, titles and active feedback follow language changes without restarting timers.",
  );
}
async function verify() {
  fs.mkdirSync(path.resolve("test-results/i18n"), { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const language of ["es", "de", "fr"]) {
      const context = await browser.newContext({
        locale: "en-GB",
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        await page.route(/^https?:/, (route) => route.abort());
        await page.goto(pathToFileURL(path.join(root, "index.html")).href);
        await ready(page);
        await page.waitForFunction(
          () => !WorkTimeApp.services.preferences.page.dirty,
        );
        const result = await page.evaluate(async (language) => {
          const D = WorkTimeApp.domain,
            A = WorkTimeApp.services.archive;
          const state = D.state.defaultState();
          state.preferences.language = language;
          state.days["2026-10-08"] = {
            note: "Keep my work",
            actual: {
              start: "08:00",
              end: "19:00",
              nextDay: false,
              effectiveMinutes: null,
            },
          };
          const migrated = A.migrate(state);
          const portable = A.decode(A.encode(state));
          assertInvalidLanguage();
          function assertInvalidLanguage() {
            try {
              A.migrate({
                ...state,
                preferences: { ...state.preferences, language: "invalid" },
              });
            } catch {
              return;
            }
            throw Error("Unknown language must still fail validation");
          }
          // Inject a real v1.3.16 preference into the stored record before reload.
          const request = indexedDB.open("worktime-archive");
          const db = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            await new Promise((resolve, reject) => {
              const tx = db.transaction("records", "readwrite");
              tx.oncomplete = resolve;
              tx.onabort = () => reject(tx.error);
              const store = tx.objectStore("records");
              const rows = store.getAll();
              rows.onsuccess = () => {
                const preference = rows.result.find(
                  (row) => row.moduleId === A.ids.preferences,
                );
                preference.data.language = language;
                store.put(preference);
              };
            });
          } finally {
            db.close();
          }
          return {
            legacy: migrated.preferences.language,
            portable: portable.preferences.language,
            day: portable.days["2026-10-08"],
          };
        }, language);
        assert.equal(result.legacy, "auto");
        assert.equal(result.portable, "auto");
        assert.equal(result.day.note, "Keep my work");
        assert.equal(result.day.actual.end, "19:00");
        await page.reload();
        await ready(page);
        await page.waitForFunction(
          () => !WorkTimeApp.services.preferences.page.dirty,
        );
        assert.equal(await page.locator("html").getAttribute("lang"), "en");
        assert.equal(
          await page.locator("#initializeStorage").isVisible(),
          false,
        );
        const loaded = await page.evaluate(async () => {
          const D = WorkTimeApp.domain;
          const storage = WorkTimeApp.services.indexedStorage.create({
            key: D.state.KEY,
            defaultState: D.state.defaultState,
            getStorage: () => localStorage,
          });
          const result = await storage.load();
          return {
            issue: result.loadIssue,
            language: result.state.preferences.language,
          };
        });
        assert.deepEqual(loaded, { issue: null, language: "en" });
      } finally {
        await context.close();
      }
    }
    const yearContext = await browser.newContext({
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    try {
      const page = await yearContext.newPage();
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(pathToFileURL(path.join(root, "index.html")).href);
      await ready(page);
      await page.locator("#monthTitle").click();
      const result = await page.evaluate(() => {
        const button = document.querySelector("[data-year-date]");
        const month = document.querySelector(".year-month");
        const label = month.getAttribute("aria-label");
        const expected = WorkTimeApp.i18n.month(month.dataset.yearMonth);
        WorkTimeApp.i18n.setLanguage("en");
        return {
          label,
          expected,
          preserved: button === document.querySelector("[data-year-date]"),
          heading: month.querySelector(".year-month-number").textContent,
        };
      });
      assert.equal(
        result.label,
        result.expected,
        "Year month label must not duplicate the month suffix",
      );
      assert.equal(
        result.preserved,
        true,
        "Language changes must reuse year day buttons",
      );
      assert.equal(result.heading, "Jan");
    } finally {
      await yearContext.close();
    }
    await verifyNotificationLanguage(browser);
    await verifyFixedLanguage(browser);
    await verifyLanguageMotion(browser);
    await verifyMonthWidths(browser);
    for (const locale of ["en-GB", "zh-CN"]) {
      const context = await browser.newContext({
        locale,
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage(),
        errors = [];
      const startupErrors = [];
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          message.text().startsWith("WorkTime startup failed")
        )
          startupErrors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
      await page.goto(pathToFileURL(path.join(root, "index.html")).href);
      await ready(page);
      const english = locale === "en-GB";
      assert.equal(
        await page.locator("html").getAttribute("lang"),
        english ? "en" : "zh-CN",
      );
      if (english) {
        assert.deepEqual(
          await page.locator(".panel>.weekdays span").allTextContents(),
          ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        );
        assert.equal(
          await page
            .locator('[data-preview-date="2026-09-28"] .daynum small')
            .textContent(),
          "Sep",
        );
        assert.deepEqual(
          await page
            .locator("#monthTitle .summary-number-accessible")
            .allTextContents(),
          ["2026", "Oct"],
        );
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.locator("#nextMonth").click();
        await page.waitForFunction(() =>
          document.querySelector(
            ".month-title-month .summary-number-word .summary-number-outgoing",
          ),
        );
        assert.deepEqual(
          await page
            .locator(".month-title-month .summary-number-digit")
            .allTextContents(),
          ["Nov", "Oct"],
          "Month abbreviations must roll as complete words",
        );
        assert.equal(
          await page
            .locator(".month-title-month .summary-number-track")
            .count(),
          1,
        );
        await page.waitForFunction(
          () => !document.querySelector("#monthTitle .summary-number-outgoing"),
        );
        await page.evaluate(() => {
          document.querySelector("#prevMonth").click();
          const track = document.querySelector(
            ".month-title-month .summary-number-track",
          );
          track.style.animationPlayState = "paused";
        });
        const outgoingFits = await page.evaluate(() => {
          const column = document.querySelector(
            ".month-title-month .summary-number-word",
          );
          const outgoing = column.querySelector(".summary-number-outgoing");
          const range = document.createRange();
          range.selectNodeContents(outgoing);
          const text = range.getBoundingClientRect();
          const clip = column.getBoundingClientRect();
          return (
            outgoing.textContent === "Nov" &&
            text.left >= clip.left - 1 &&
            text.right <= clip.right + 1
          );
        });
        assert.ok(
          outgoingFits,
          "Nov must remain fully visible when rolling to the narrower Oct",
        );
        await page.evaluate(() => {
          document
            .querySelector(".month-title-month .summary-number-track")
            .style.removeProperty("animation-play-state");
        });
        await page.waitForFunction(
          () => !document.querySelector("#monthTitle .summary-number-outgoing"),
        );
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.match(
          await page.locator("#editorDate").evaluate((element) => {
            const copy = element.cloneNode(true);
            for (const visual of copy.querySelectorAll('[aria-hidden="true"]'))
              visual.remove();
            return copy.textContent.replace(/\s+/g, " ").trim();
          }),
          /21 Oct 2026/,
        );
        const positions = [];
        for (const date of ["2026-10-01", "2026-10-25", "2026-10-31"]) {
          await page.locator('.calendar [data-date="' + date + '"]').click();
          positions.push(
            await page.locator("#editorDate > span").evaluateAll((parts) =>
              parts.map((part) => {
                const { x, width } = part.getBoundingClientRect();
                return { x, width };
              }),
            ),
          );
        }
        assert.deepEqual(positions[1], positions[0]);
        assert.deepEqual(positions[2], positions[0]);
        await page.locator('.calendar [data-date="2026-10-21"]').click();
        await englishText(page, "month view");
        const dates = await page.evaluate(() => ({
          months: Array.from({ length: 12 }, (_, index) =>
            WorkTimeApp.i18n.monthName(
              "2026-" + String(index + 1).padStart(2, "0") + "-01",
            ),
          ),
          weekdays: Array.from({ length: 7 }, (_, index) =>
            WorkTimeApp.i18n.weekday("2026-10-" + String(19 + index)),
          ),
          singular: WorkTimeApp.i18n.plural(
            1,
            "unit.day.one",
            "unit.day.other",
          ),
          plural: WorkTimeApp.i18n.plural(2, "unit.day.one", "unit.day.other"),
        }));
        assert.deepEqual(dates, {
          months: [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
          ],
          weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
          singular: "1 day",
          plural: "2 days",
        });
      }
      const baseline = await page.evaluate(() => {
        const D = WorkTimeApp.domain,
          state = D.state.defaultState();
        return JSON.stringify(
          D.records.calculate(
            "2026-10-21",
            {
              actual: {
                start: "08:00",
                end: "19:30",
                nextDay: false,
                effectiveMinutes: null,
              },
            },
            state.settings,
            true,
          ),
        );
      });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => WorkTimeApp.ui.alignment?.refresh());
        await page.screenshot({
          path: path.resolve(
            "test-results/i18n/" + locale + "-" + width + ".png",
          ),
          fullPage: true,
        });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          locale + " overflows at " + width,
        );
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      if (english) {
        await page.locator("#settingsOpen").click();
        await englishText(page, "work schedule");
        await page.locator("#workSettingsCancel").click();
        await page.locator("#batchToggle").click();
        await englishText(page, "bulk edit");
        await page.locator("#batchToggle").click();
        await page.locator("#addTimeTemplate").click();
        await englishText(page, "template editor");
        await page.locator('[data-close="timeTemplateDialog"]').first().click();
        await page.locator("#importOpen").click();
        await page
          .locator("#pasteText")
          .fill("10/19\n周一\n08:00\n12:00\n19:30");
        await page.waitForTimeout(350);
        await englishText(page, "OA validation");
        await page.locator("#importOpen").click();
      }
      await page.locator("#monthTitle").click();
      await page.waitForFunction(() => {
        const title = document.getElementById("monthTitle"),
          year = title
            .querySelector(".month-title-year")
            .getBoundingClientRect(),
          box = title.getBoundingClientRect();
        return Math.abs(year.x + year.width / 2 - box.x - box.width / 2) < 1;
      });
      if (english) {
        assert.equal(
          await page.locator(".year-month-number").first().textContent(),
          "Jan",
        );
        assert.equal(
          await page.locator(".year-month").nth(8).getAttribute("aria-label"),
          "Sep 2026",
        );
        await englishText(page, "year view");
      }
      await page.locator("#monthTitle").click();
      await page.locator("#date-tab-history").click();
      await page.waitForSelector(".history-event");
      assert.equal(
        await page.locator("#date-context-almanac").isVisible(),
        !english,
      );
      if (english) {
        await englishText(page, "history");
        assert.match(
          await page.locator(".date-info-source a").getAttribute("href"),
          /^https:\/\/en.wikipedia.org/,
        );
      } else {
        await page.locator("#date-context-almanac").click();
        await page.waitForSelector(".almanac-sheet");
      }
      await page.locator("#dayStart").fill("09:15");
      // Direct form assignment avoids autosaving; switching must preserve this draft.
      await page.evaluate(() => {
        document.querySelector("#dayStart").value = "09:17";
      });
      await page.locator("#pageSettingsOpen").click();
      if (english) {
        await page.locator("#personalSettingsOpen").click();
        await page.locator("#workCity").click();
        await englishText(page, "city directory");
        await page.locator("#workCityOption0").click();
        await englishText(page, "city selected");
        await page.locator("#pageSettingsOpen").click();
      }
      await page
        .locator("#languageSelect")
        .selectOption(english ? "zh-CN" : "en");
      assert.equal(await page.locator("#dayStart").inputValue(), "09:17");
      if (!english) {
        assert.equal(
          await page.locator("#date-context-almanac").isVisible(),
          false,
        );
        assert.equal(await page.locator(".almanac-sheet").count(), 0);
        await englishText(page, "preferences");
      }
      await page.waitForFunction(
        () => !WorkTimeApp.services.preferences.page.dirty,
      );
      assert.equal(
        await page.evaluate(
          () => WorkTimeApp.services.preferences.page.state.language,
        ),
        english ? "zh-CN" : "en",
      );
      assert.equal(
        await page.evaluate(() => {
          const D = WorkTimeApp.domain,
            state = D.state.defaultState();
          return JSON.stringify(
            D.records.calculate(
              "2026-10-21",
              {
                actual: {
                  start: "08:00",
                  end: "19:30",
                  nextDay: false,
                  effectiveMinutes: null,
                },
              },
              state.settings,
              true,
            ),
          );
        }),
        baseline,
      );
      await page.reload();
      await ready(page);
      assert.equal(
        await page.locator("html").getAttribute("lang"),
        english ? "zh-CN" : "en",
      );
      const compatibility = await page.evaluate(() => {
        const A = WorkTimeApp.services.archive,
          D = WorkTimeApp.domain,
          state = D.state.defaultState();
        delete state.preferences.language;
        const legacy = D.validation.validateBackup(state).preferences.language;
        state.preferences.language = "en";
        const roundTrip = A.decode(A.encode(state)).preferences.language;
        return { legacy, roundTrip };
      });
      assert.deepEqual(compatibility, { legacy: "auto", roundTrip: "en" });
      await page.locator("#pageSettingsOpen").click();
      await page
        .locator("#languageSelect")
        .selectOption(english ? "en" : "zh-CN");
      await page.locator("#personalSettingsOpen").click();
      await page.locator("#workCity").click();
      await page.locator("#workCityOption0").click();
      await page.waitForFunction(
        () => !!WorkTimeApp.services.weather.snapshot().city,
      );
      await page.locator("#profileSettingsCancel").click();
      await page.locator("#date-tab-weather").click();
      await page.reload();
      await page.waitForFunction(() =>
        ["ready", "failed"].includes(document.documentElement.dataset.appState),
      );
      assert.equal(
        await page.locator("html").getAttribute("data-app-state"),
        "ready",
        "Saved weather tab and work city must restore without an empty-date failure: " +
          startupErrors.join("\n"),
      );
      await ready(page);
      await page.waitForSelector(".weather-heading");
      await page.locator("#personalSettingsOpen").click();
      assert.equal(
        await page.locator("#workCity").inputValue(),
        english ? "Dongguan" : "东莞市",
        "Saved city must be localized when Preferences is reopened after reload",
      );
      const cities = await page.evaluate(() =>
        WorkTimeApp.data.weatherCities.cities.map((city) => ({
          id: city.id,
          name: city.name,
          english: WorkTimeApp.data.contentEnglish[city.name],
        })),
      );
      for (const [index, city] of cities.entries()) {
        await page.locator("#workCity").click();
        await page.locator("#workCityOption" + index).click();
        await page.waitForFunction(
          (id) => WorkTimeApp.services.weather.snapshot().city?.id === id,
          city.id,
        );
        await page.locator("#profileSettingsCancel").click();
        await page.locator("#personalSettingsOpen").click();
        assert.equal(
          await page.locator("#workCity").inputValue(),
          english ? city.english : city.name + "市",
          "Reopened city: " + city.name,
        );
      }
      await page.locator("#pageSettingsOpen").click();
      await page
        .locator("#languageSelect")
        .selectOption(english ? "zh-CN" : "en");
      assert.equal(
        await page.locator("#workCity").inputValue(),
        english ? "苏州市" : "Suzhou",
      );
      await page
        .locator("#languageSelect")
        .selectOption(english ? "en" : "zh-CN");
      assert.equal(
        await page.locator("#workCity").inputValue(),
        english ? "Suzhou" : "苏州市",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(startupErrors, []);
      await page.locator("#personalSettingsCancel").click();
      await page.evaluate(() => {
        WorkTimeApp.services.weather.dispose();
        WorkTimeApp.ui.weather.render(
          document.querySelector("#dateInfoPanel"),
          {
            city: WorkTimeApp.data.weatherCities.cities[0],
            record: {
              validAt: "2026-10-21T12:00:00+08:00",
              fetchedAt: "2026-10-21T12:01:00+08:00",
              current: {
                temperature: 27,
                apparentTemperature: 29,
                humidity: 86,
                windClass: "1级",
                windDirectionText: "西南风",
                weatherCode: 0,
              },
              hourly: [],
              daily: [
                {
                  date: "2026-10-21",
                  high: 30,
                  low: 21,
                  uvIndex: 3,
                  weatherCode: 0,
                },
              ],
            },
          },
        );
      });
      assert.deepEqual(
        await page.locator(".weather-detail dt").allTextContents(),
        english
          ? ["Feels like", "Humidity", "Wind", "Direction"]
          : ["体感", "湿度", "风力", "风向"],
      );
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 });
        const issues = await page.evaluate(() =>
          [...document.querySelectorAll(".weather-detail")].flatMap((item) => {
            const box = item.getBoundingClientRect(),
              term = item.querySelector("dt"),
              value = item.querySelector("dd"),
              a = term.getBoundingClientRect(),
              b = value.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(term);
            const errors = [];
            if (range.getClientRects().length !== 1)
              errors.push(term.textContent + " wraps");
            for (const element of [term, value])
              if (element.scrollWidth > element.clientWidth + 1)
                errors.push(element.textContent + " overflows");
            if (
              b.left < a.right - 1 ||
              Math.min(a.bottom, b.bottom) <= Math.max(a.top, b.top)
            )
              errors.push(term.textContent + " misaligned");
            if (a.left < box.left - 1 || b.right > box.right + 1)
              errors.push(term.textContent + " escapes its column");
            return errors;
          }),
        );
        assert.deepEqual(
          issues,
          [],
          "Weather metric layout at " + width + " / " + locale,
        );
        await page.locator(".weather-details").screenshot({
          path: path.resolve(
            "test-results/i18n/weather-metrics-" +
              locale +
              "-" +
              width +
              ".png",
          ),
        });
      }
      const injected = await page.evaluate(async () => {
        const result = await WorkTimeApp.services.bootstrap.run(
          async () => {
            throw Error("Injected startup diagnostic");
          },
          { document },
        );
        return result.ok;
      });
      assert.equal(injected, false);
      assert.equal(startupErrors.length, 1);
      assert.match(
        startupErrors[0],
        /Error: Injected startup diagnostic[\s\S]*at /,
      );
      assert.match(
        await page.locator("#startupFailure").textContent(),
        /Injected startup diagnostic/,
      );
      await context.close();
    }
    console.log(
      "Both languages, weekday/month names, five responsive widths, hidden almanac, drafts, persistence, backup compatibility, restored weather startup and diagnostic stacks verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

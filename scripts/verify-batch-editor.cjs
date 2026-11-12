"use strict";
const fs = require("node:fs");
const path = require("node:path");
require("./lib/browser-test-setup.cjs");
const root = path.resolve(__dirname, "..");
function readCoreSource() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const files = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((match) => match[1])
    .filter(
      (file) =>
        file === "assets/js/namespace.js" ||
        /assets\/data\/(calendars|major-festivals|struggle-days)\.js/.test(
          file,
        ),
    );
  files.push(
    ...[
      "preferences",
      "time",
      "state",
      "calendar",
      "records",
      "schedule",
      "batch",
      "statistics",
      "observations",
      "agenda",
      "validation",
    ].map((name) => "assets/js/domain/" + name + ".js"),
  );
  return (
    files
      .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
      .join("\n") +
    "\nconst DomainTest = Object.assign({}, ...Object.values(WorkTimeApp.domain));"
  );
}
const launchBrowser = () =>
  require("playwright").chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
const entry = path.resolve(
  process.argv[2]
    ? path.extname(process.argv[2]) === ".html"
      ? process.argv[2]
      : path.join(process.argv[2], "index.html")
    : path.join(root, "index.html"),
);

async function verifyFill() {
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const vm = require("node:vm");
  const { pathToFileURL } = require("node:url");
  const realm = vm.createContext({});
  vm.runInContext(
    readCoreSource() +
      fs.readFileSync("assets/js/services/application.js", "utf8") +
      ";globalThis.C=DomainTest;globalThis.W=WorkTimeApp",
    realm,
  );
  const { C, W } = realm;
  W.services.archive = {
    error: (message, code) => Object.assign(Error(message), { code }),
  };
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const first = "2026-10-19",
    second = "2026-10-20",
    excluded = "2026-10-21";
  const initial = C.defaultState();
  initial.settings.configured = true;
  initial.personal.employmentDate = "2024-01-01";
  const old = {
    start: "08:00",
    end: "17:30",
    nextDay: false,
    effectiveMinutes: null,
  };
  initial.days[first] = {
    estimate: { ...old, extension: "keep" },
    note: "keep note",
    extension: { value: 1 },
  };
  initial.days[second] = {
    oa: {
      date: second,
      start: "08:00",
      end: "",
      nextDay: false,
      status: "pending",
      source: "OA",
      raw: "10/20 08:00",
    },
    actual: old,
    sourcePriority: "manual",
    leaveMinutes: 60,
  };
  initial.days[excluded] = {
    leaveMinutes: initial.settings.standardMinutes,
    note: "excluded",
  };
  initial.days["2025-01-01"] = { note: "other month", plannedOvertime: true };
  initial.days["2026-10-23"] = {
    draft: { start: "08:00", end: "", nextDay: false },
  };
  initial.scheduleRanges = [
    {
      start: "2026-10-22",
      end: "2026-10-22",
      schedule: {
        workStart: "09:00",
        workEnd: "18:30",
        standardMinutes: 480,
        breaks: [{ start: 720, end: 810 }],
      },
    },
  ];
  initial.timeTemplates = [
    { id: "late", name: "Late", start: "09:00", end: "21:00", nextDay: false },
  ];

  async function verifyAtomic() {
    const outside = "2025-01-01";
    for (const reset of ["none", "selected", "all"]) {
      const result = C.applyBatchChanges(initial, {
        month: "2026-10",
        reset,
        dates: [first, outside],
        record: old,
      });
      assert.equal(
        result.days[outside],
        initial.days[outside],
        "Every batch operation retains other months",
      );
    }
    assert.throws(
      () => C.applyBatchChanges(initial, { reset: "all" }),
      /Invalid batch month/,
    );
    assert.throws(
      () => C.applyBatchChanges(initial, { reset: "all", month: "2026-13" }),
      /Invalid batch month/,
    );
    const oaOnly = { oa: initial.days[second].oa, extension: { keep: true } };
    const same = { ...initial, days: { [second]: oaOnly } };
    assert.equal(
      C.resetBatchDay(oaOnly),
      oaOnly,
      "Reset retains unchanged OA-only records",
    );
    assert.equal(
      C.applyBatchChanges(same, { reset: "all", month: "2026-10" }),
      same,
      "No-op reset retains state and derived caches",
    );
    let writes = 0,
      finish;
    const owner = W.services.application.createState({
      state: plain(initial),
      core: C,
      persistence: {
        commit: () => {
          writes++;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      },
    });
    const before = plain(owner.state);
    const draft = {
      month: "2026-10",
      reset: "all",
      dates: [first, second, excluded],
      record: { ...old, end: "19:30" },
    };
    const preview = C.applyBatchChanges(owner.state, draft);
    assert.deepEqual(plain(owner.state), before);
    assert.equal(preview.days[first].estimate.end, "19:30");
    assert.equal(preview.days[first].note, undefined);
    assert.deepEqual(plain(preview.days[first].extension), { value: 1 });
    assert.deepEqual(
      plain(preview.days[excluded]),
      { leaveMinutes: 480 },
      "All-reset preserves leave and does not fill excluded dates",
    );
    assert.deepEqual(plain(preview.days[second].oa), before.days[second].oa);
    assert.equal(preview.days[second].sourcePriority, undefined);
    assert.deepEqual(
      plain(preview.days["2025-01-01"]),
      before.days["2025-01-01"],
    );
    assert.deepEqual(plain(preview.timeTemplates), before.timeTemplates);
    let pending = owner.confirmBatch(draft);
    assert.deepEqual(
      plain(owner.state),
      before,
      "Pending save must not publish its candidate",
    );
    const duplicate = await owner.confirmBatch(draft);
    assert.equal(duplicate.persisted, false);
    assert.equal(writes, 1);
    finish({ persisted: false, error: Error("disk full") });
    assert.equal((await pending).persisted, false);
    assert.deepEqual(plain(owner.state), before);
    pending = owner.confirmBatch(draft);
    finish({ persisted: true });
    assert.equal((await pending).persisted, true);
    assert.deepEqual(plain(owner.state), plain(preview));
    assert.equal(writes, 2);
    for (const failure of ["throw", "reject"]) {
      let fail = true;
      const testOwner = W.services.application.createState({
        state: plain(initial),
        core: C,
        persistence: {
          commit: () => {
            if (!fail) return Promise.resolve({ persisted: true });
            if (failure === "throw") throw Error("storage failure");
            return Promise.reject(Error("storage failure"));
          },
        },
      });
      assert.equal((await testOwner.confirmBatch(draft)).persisted, false);
      assert.equal(testOwner.pending, false);
      assert.equal(testOwner.failed, true);
      assert.deepEqual(plain(testOwner.state), before);
      fail = false;
      assert.equal((await testOwner.confirmBatch(draft)).persisted, true);
    }
  }
  async function stored(page) {
    return page.evaluate(async () => {
      const db = WorkTimeApp.services.indexedStorage.create({
        key: WorkTimeApp.domain.state.KEY,
        defaultState: WorkTimeApp.domain.state.defaultState,
        getStorage: () => localStorage,
      });
      try {
        return (await db.load()).state;
      } finally {
        db.releaseWriteAccess();
      }
    });
  }
  let browser;
  return (async () => {
    await verifyAtomic();
    browser = await launchBrowser();
    for (const width of [1440, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
      await page.addInitScript((state) => {
        if (!localStorage.getItem("batch-preview-seed")) {
          localStorage.setItem("worktime-local-v1", JSON.stringify(state));
          localStorage.setItem("batch-preview-seed", "yes");
        }
      }, plain(initial));
      const ready = () =>
        page.waitForFunction(
          () =>
            document.documentElement.dataset.appState === "ready" &&
            !document.documentElement.classList.contains("app-loading"),
        );
      await page.goto(pathToFileURL(entry).href);
      await ready();
      const baseline = await stored(page);
      const card = (date) => page.locator('.day[data-date="' + date + '"]');
      const cardText = (date) =>
        card(date).evaluate((element) => {
          const clone = element.cloneNode(true);
          clone
            .querySelectorAll(".summary-number-outgoing")
            .forEach((node) => node.remove());
          return clone.textContent;
        });
      const select = (date, options = {}) =>
        card(date)
          .locator(".day-select")
          .click({ force: true, position: { x: 10, y: 10 }, ...options });
      const statsText = () =>
        page.locator("#cards").evaluate((element) => {
          const clone = element.cloneNode(true);
          clone
            .querySelectorAll(".summary-number-visual")
            .forEach((node) => node.remove());
          return clone.textContent;
        });
      const stats = await statsText();
      await page.locator("#batchToggle").click();
      assert.equal(await page.locator("#batchStart").inputValue(), "");
      assert.equal(await page.locator("#batchEnd").inputValue(), "");
      for (const id of ["prevMonth", "nextMonth", "todayButton"])
        assert.equal(await page.locator("#" + id).isDisabled(), true);
      assert.equal(
        await page.locator("#monthTitle").getAttribute("aria-disabled"),
        "true",
      );
      const monthText = () =>
        page.locator("#monthTitle").evaluate((element) => {
          const clone = element.cloneNode(true);
          clone
            .querySelectorAll(".summary-number-visual")
            .forEach((node) => node.remove());
          return clone.textContent;
        });
      const month = await monthText();
      await page.evaluate(() => {
        document.getElementById("nextMonth").onclick();
        document.getElementById("monthTitle").onclick();
        document.getElementById("todayButton").onclick();
      });
      assert.equal(await monthText(), month);
      await select(first);
      assert.equal(await page.locator("#batchSave").isDisabled(), true);
      assert.equal(await statsText(), stats);
      assert.deepEqual(await stored(page), baseline);
      await page.locator("#batchStart").fill("08:00");
      await page.locator("#batchEnd").fill("19:30");
      assert.match(await cardText(first), /19:30/);
      assert.notEqual(await statsText(), stats);
      assert.deepEqual(await stored(page), baseline);
      await select(first);
      assert.doesNotMatch(await cardText(first), /19:30/);
      assert.equal(await statsText(), stats);
      await select(first);
      await select(second, { modifiers: ["Shift"] });
      assert.equal(await page.locator(".batchselected").count(), 2);
      assert.match(await cardText(second), /19:30/);
      assert.equal(
        await card(second).locator("[data-source-date]").isDisabled(),
        true,
      );
      await page.locator("#batchNextToggle").click();
      await page.locator("#batchEnd").fill("01:00");
      assert.equal(await page.locator("#batchSave").isEnabled(), true);
      assert.match(await cardText(first), /01:00/);
      await page.locator('[data-batch-template="late"]').click();
      assert.match(await cardText(first), /21:00/);
      await page.locator("#batchModeToggle").click();
      assert.equal(await page.locator("#batchStart").inputValue(), "09:00");
      await page.locator("#batchCalcOvertime").fill("0");
      assert.equal(await page.locator("#batchSave").isEnabled(), true);
      assert.match(
        await page.locator("#batchCalcResult").innerText(),
        /下班时间/,
      );
      await page.locator("#batchCalcOvertime").fill("2");
      assert.equal(await page.locator("#batchSave").isEnabled(), true);
      await page.locator("#batchStart").fill("23:00");
      assert.match(await page.locator("#batchCalcResult").innerText(), /次日/);
      await page.locator("#batchCalcOvertime").fill("24");
      assert.equal(await page.locator("#batchSave").isDisabled(), true);
      assert.doesNotMatch(await cardText(first), /21:00/);
      await page.locator("#batchModeToggle").click();
      assert.equal(await page.locator("#batchStart").inputValue(), "09:00");
      assert.equal(await page.locator("#batchEnd").inputValue(), "21:00");
      await page.locator("#batchModeToggle").click();
      assert.equal(await page.locator("#batchStart").inputValue(), "23:00");
      assert.equal(await page.locator("#batchCalcOvertime").inputValue(), "24");
      await page.locator("#batchClearSelection").click();
      assert.equal(await page.locator(".batchselected").count(), 0);
      assert.match(
        await page.locator("#batchPreviewStatus").innerText(),
        /请在日历/,
      );
      await page.locator("#batchCancel").click();
      assert.equal(await statsText(), stats);
      assert.deepEqual(await stored(page), baseline);
      assert.equal(await page.locator("#nextMonth").isEnabled(), true);

      await page.locator("#batchToggle").click();
      await select(first);
      await select("2026-10-22");
      await select("2026-10-23");
      await page.locator("#batchStart").fill("08:00");
      await page.locator("#batchEnd").fill("19:30");
      assert.match(
        await page.locator("#batchPreviewStatus").innerText(),
        /新增\s*1[\s\S]*补全\s*1[\s\S]*替换\s*1/,
      );
      await page.locator("#batchModeToggle").click();
      await page.locator("#batchCalcOvertime").fill("0");
      assert.match(
        await page.locator("#batchPreviewStatus").innerText(),
        /作息不同/,
      );
      assert.equal(await page.locator("#batchSave").isDisabled(), true);
      await select("2026-10-22");
      assert.equal(await page.locator("#batchSave").isEnabled(), true);
      await page.locator("#batchCalcOvertime").fill("-1");
      assert.equal(await page.locator("#batchSave").isDisabled(), true);
      await page.locator("#batchCalcOvertime").fill("0.001");
      assert.equal(await page.locator("#batchSave").isDisabled(), true);
      await page.locator("#batchModeToggle").click();
      await select("2026-10-23");
      assert.match(
        await page.locator("#batchPreviewStatus").innerText(),
        /替换\s*1/,
      );
      assert.equal(await page.locator("#batchStart").inputValue(), "08:00");
      assert.match(await cardText(first), /19:30/);
      assert.deepEqual(await stored(page), baseline);
      await page.evaluate(() => {
        const original = IDBDatabase.prototype.transaction;
        window.batchFailWrites = true;
        IDBDatabase.prototype.transaction = function (...args) {
          if (window.batchFailWrites && args[1] === "readwrite")
            throw new DOMException("test disk full", "QuotaExceededError");
          return original.apply(this, args);
        };
      });
      await page.locator("#batchSave").click();
      await page.waitForFunction(() =>
        document.getElementById("batchError").textContent.includes("保存失败"),
      );
      assert.match(await cardText(first), /19:30/);
      assert.equal(await page.locator("#batchSave").isEnabled(), true);
      assert.deepEqual(await stored(page), baseline);
      await page.evaluate(() => {
        window.batchFailWrites = false;
      });
      await page
        .locator("#batchForm")
        .screenshot({ path: "artifacts/batch-preview-" + width + ".png" });
      await page.locator("#batchSave").focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(() =>
        document.getElementById("batchBar").classList.contains("hidden"),
      );
      const saved = await stored(page);
      assert.equal(saved.days[first].estimate.end, "19:30");
      assert.equal(saved.days[first].note, "keep note");
      assert.deepEqual(saved.days["2025-01-01"], baseline.days["2025-01-01"]);
      assert.deepEqual(saved.days[second].oa, baseline.days[second].oa);
      assert.deepEqual(saved.timeTemplates, baseline.timeTemplates);
      await page.reload();
      await ready();
      assert.match(await cardText(first), /19:30/);
      await page.locator("#batchToggle").click();
      await select(first);
      assert.equal(await page.locator("#batchStart").inputValue(), "");
      assert.equal(await page.locator("#batchEnd").inputValue(), "");
      await page.locator("#batchStart").fill("08:00");
      await page.locator("#batchEnd").fill("20:30");
      await page.reload();
      await ready();
      assert.doesNotMatch(await cardText(first), /20:30/);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Batch preview passed: pure/atomic candidates, live cards/statistics, templates, midnight, calculator, reset scopes, cancel/reload, navigation lock, save failure/retry and persisted confirmation on desktop/mobile.",
    );
  })().finally(async () => browser?.close());
}

async function verifyClear() {
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const vm = require("node:vm");
  const { pathToFileURL } = require("node:url");
  const realm = vm.createContext({ document: {} });
  vm.runInContext(
    readCoreSource() +
      fs.readFileSync("assets/js/services/application.js", "utf8") +
      fs.readFileSync("assets/js/controllers/navigation.js", "utf8") +
      ";globalThis.C=DomainTest;globalThis.W=WorkTimeApp",
    realm,
  );
  const { C } = realm;
  vm.runInContext(fs.readFileSync("assets/js/locales/zh-CN.js", "utf8"), realm);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const first = "2026-09-01",
    second = "2026-09-02",
    untouched = "2026-09-03";
  const record = {
    start: "08:00",
    end: "18:30",
    nextDay: false,
    effectiveMinutes: null,
  };
  const initial = C.defaultState();
  initial.days[first] = {
    oa: {
      ...record,
      date: first,
      source: "OA",
      status: "complete",
      raw: "OA original",
      importId: "",
    },
    actual: { ...record, end: "20:00" },
    draft: { start: "09:00", end: "", nextDay: false },
    leaveMinutes: 60,
    note: "remove",
    kind: "work",
    extension: { keep: true },
  };
  initial.days[second] = { estimate: record, note: "remove" };
  initial.days[untouched] = { estimate: record, note: "keep" };
  initial.days["2025-08-01"] = { estimate: record, note: "past month" };
  initial.days["2027-01-01"] = {
    leaveMinutes: 480,
    kind: "rest",
    note: "future month",
  };
  initial.days["2026-09-05"] = { plannedOvertime: true, estimate: record };

  async function stored(page) {
    return page.evaluate(async () => {
      const db = WorkTimeApp.services.indexedStorage.create({
        key: WorkTimeApp.domain.state.KEY,
        defaultState: WorkTimeApp.domain.state.defaultState,
        getStorage: () => localStorage,
      });
      try {
        return (await db.load()).state;
      } finally {
        db.releaseWriteAccess();
      }
    });
  }
  let browser;
  return (async () => {
    browser = await launchBrowser();
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({
        locale: "zh-CN",
        viewport: { width, height: 1000 },
        timezoneId: "Asia/Shanghai",
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-09-15T04:00:00Z"));
      await page.addInitScript((state) => {
        if (!localStorage.getItem("batch-reset-seed")) {
          localStorage.setItem("worktime-local-v1", JSON.stringify(state));
          localStorage.setItem("batch-reset-seed", "yes");
        }
      }, plain(initial));
      await page.goto(pathToFileURL(entry).href);
      const ready = () =>
        page.waitForFunction(
          () =>
            document.documentElement.dataset.appState === "ready" &&
            !document.documentElement.classList.contains("app-loading"),
        );
      await ready();
      const baseline = await stored(page);
      const select = (date) =>
        page
          .locator('.day[data-date="' + date + '"] > .day-select')
          .click({ force: true, position: { x: 10, y: 10 } });
      await page.locator("#batchToggle").click();
      assert.equal(await page.locator("#batchReset").isDisabled(), true);
      assert.equal(await page.locator("#batchResetAll").count(), 0);
      await select(first);
      await page.locator("#batchStart").fill("08:00");
      await page.locator("#batchEnd").fill("22:00");
      await page.evaluate(() => {
        const original = IDBDatabase.prototype.transaction;
        window.batchFailWrites = true;
        IDBDatabase.prototype.transaction = function (...args) {
          if (window.batchFailWrites && args[1] === "readwrite")
            throw new DOMException("test disk full", "QuotaExceededError");
          return original.apply(this, args);
        };
      });
      await page.locator("#batchReset").click();
      await page.waitForFunction(() =>
        document.getElementById("batchError").textContent.includes("保存失败"),
      );
      assert.deepEqual(await stored(page), baseline);
      assert.equal(await page.locator("#batchReset").isEnabled(), true);
      await page.evaluate(async () => {
        window.batchFailWrites = false;
        const pending = document.getElementById("batchReset").onclick();
        document.getElementById("batchReset").onclick();
        document.getElementById("batchCancel").onclick();
        if (document.getElementById("batchBar").classList.contains("hidden"))
          throw Error("Pending clear must not exit");
        await pending;
      });
      await page.waitForFunction(() =>
        document.getElementById("batchBar").classList.contains("hidden"),
      );
      const selectedResult = await stored(page);
      assert.deepEqual(selectedResult.days[first], {
        oa: baseline.days[first].oa,
        leaveMinutes: 60,
        extension: { keep: true },
      });
      assert.deepEqual(selectedResult.days[second], baseline.days[second]);
      assert.deepEqual(
        selectedResult.days["2027-01-01"],
        baseline.days["2027-01-01"],
      );
      assert.deepEqual(
        selectedResult.days[untouched],
        baseline.days[untouched],
      );
      assert.deepEqual(
        selectedResult.days["2026-09-05"],
        baseline.days["2026-09-05"],
      );
      assert.deepEqual(
        selectedResult.days["2025-08-01"],
        baseline.days["2025-08-01"],
      );
      assert.deepEqual(selectedResult.timeTemplates, baseline.timeTemplates);
      await page.reload();
      await ready();
      assert.deepEqual(await stored(page), selectedResult);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      "Selected-only deletion passed: one click, failure/retry, duplicate guards, preserved fields and months, reload, desktop and mobile.",
    );
  })().finally(async () => browser?.close());
}

async function verifyLayout() {
  const assert = require("node:assert/strict");
  const { pathToFileURL } = require("node:url");
  let browser;
  return (async () => {
    browser = await launchBrowser();
    const page = await browser.newPage({
      reducedMotion: "reduce",
      locale: "zh-CN",
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
    await page.goto(pathToFileURL(entry).href);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.evaluate(() =>
      WorkTimeApp.services.preferences.page.saveMotionMode("reduce"),
    );
    await page.locator("#batchToggle").click();
    await page
      .locator('.day[data-date="2026-10-19"] .day-select')
      .click({ force: true, position: { x: 10, y: 10 } });
    await page.locator("#batchStart").fill("08:00");
    await page.locator("#batchEnd").fill("19:30");
    const cardHeight = () =>
      page
        .locator(".batch-preview-card")
        .evaluate((card) => card.getBoundingClientRect().height);
    const directCardHeight = await cardHeight();
    assert.equal(
      await page.locator("#batchSave .button-label").innerText(),
      "确认",
    );
    await page.locator("#batchModeToggle").click();
    const hoursInput = page.locator("#batchCalcOvertime");
    await hoursInput.fill("1");
    await hoursInput.press("ArrowUp");
    assert.equal(await hoursInput.inputValue(), "1.5");
    await hoursInput.press("ArrowDown");
    assert.equal(await hoursInput.inputValue(), "1");
    await hoursInput.hover();
    await page.mouse.wheel(0, -120);
    await page.waitForFunction(
      () => document.getElementById("batchCalcOvertime").value === "1.5",
    );
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(
      () => document.getElementById("batchCalcOvertime").value === "1",
    );
    assert.equal(await cardHeight(), directCardHeight);
    await page.locator("#batchClearSelection").click();
    assert.equal(await cardHeight(), directCardHeight);
    await page
      .locator('.day[data-date="2026-10-19"] .day-select')
      .click({ force: true, position: { x: 10, y: 10 } });
    await page.locator("#batchModeToggle").click();
    let layouts = 0;
    for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ko", "ja"]) {
      await page.evaluate(
        (value) => WorkTimeApp.i18n.setLanguage(value),
        language,
      );
      for (const width of [320, 390, 850, 1150, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.locator("#batchSave").scrollIntoViewIfNeeded();
        await page.locator("#batchInputSection").evaluate(async (section) => {
          await Promise.allSettled(
            section
              .getAnimations({ subtree: true })
              .map((animation) => animation.finished),
          );
        });
        const issues = await page.locator("#batchForm").evaluate((form) => {
          const problems = [],
            bounds = form.getBoundingClientRect();
          for (const node of form.querySelectorAll(
            ".batch-editor-actions button,#batchPreviewStatus,#batchModeToggle,#batchAutoSelect,#batchClearSelection,#batchNextToggle",
          )) {
            const box = node.getBoundingClientRect();
            if (box.left < bounds.left - 1 || box.right > bounds.right + 1)
              problems.push(node.id + " outside form");
            if (node.scrollWidth > node.clientWidth + 1)
              problems.push(node.id + " clipped");
          }
          const rect = (id) =>
            form.querySelector("#" + id).getBoundingClientRect();
          for (const group of form.querySelectorAll(".batch-button-group")) {
            const children = [...group.children];
            if (getComputedStyle(group).borderTopWidth !== "1px")
              problems.push("group outer border");
            for (const [index, child] of children.entries()) {
              const style = getComputedStyle(child);
              if (
                style.borderTopWidth !== "0px" ||
                style.borderRightWidth !== "0px" ||
                style.borderBottomWidth !== "0px" ||
                style.borderLeftWidth !== (index ? "1px" : "0px")
              )
                problems.push(child.id + " double border");
              if (
                style.borderTopLeftRadius !== "0px" ||
                style.borderTopRightRadius !== "0px"
              )
                problems.push(child.id + " rounded inner edge");
            }
          }
          const toolbar = rect("batchModeToggle");
          const selection = rect("batchAutoSelect");
          const selectionGroup = form
            .querySelector(".batch-selection-group")
            .getBoundingClientRect();
          if (
            Math.abs(selectionGroup.width - toolbar.width) > 1 ||
            Math.abs(selectionGroup.height - toolbar.height) > 1 ||
            Math.abs(selectionGroup.top - toolbar.top) > 1
          )
            problems.push("toolbar height mismatch");
          const footer = form.querySelector(".batch-editor-actions");
          const clear = rect("batchReset");
          const gap = parseFloat(getComputedStyle(footer).columnGap);
          if (
            Math.abs(
              clear.width / (footer.getBoundingClientRect().width - 2 * gap) -
                0.4,
            ) > 0.01
          )
            problems.push("delete must occupy two fifths");
          if (Math.abs(rect("batchSave").width - rect("batchCancel").width) > 1)
            problems.push("cancel/save widths differ");
          if (Math.abs(toolbar.top - selection.top) > 2)
            problems.push("toolbar controls wrap");
          const start = rect("batchStart"),
            end = rect("batchEnd"),
            next = rect("batchNextToggle");
          if (
            Math.abs(start.top - end.top) > 2 ||
            Math.abs(start.top - next.top) > 2
          )
            problems.push("time controls wrap");
          const status = form
            .querySelector(".batch-preview-card")
            .getBoundingClientRect();
          if (!form.querySelector(".batch-preview-card #batchSelectionCount"))
            problems.push("selection count outside card");
          const actions = form
            .querySelector(".batch-editor-actions")
            .getBoundingClientRect();
          const toolbarBottom = form
            .querySelector(".batch-toolbar")
            .getBoundingClientRect().bottom;
          if (rect("batchReset").top - toolbarBottom < 12)
            problems.push("batch tools too close to action buttons");
          if (
            status.top < actions.bottom - 1 ||
            status.top - actions.bottom > 20
          )
            problems.push("summary detached from footer");
          const buttons = [
            ...form.querySelectorAll(".batch-editor-actions button"),
          ];
          if (
            buttons.some(
              (button) =>
                Math.abs(
                  button.getBoundingClientRect().top -
                    buttons[0].getBoundingClientRect().top,
                ) > 2,
            )
          )
            problems.push("desktop action wrap");
          return problems;
        });
        assert.deepEqual(issues, [], `${language} ${width}`);
        assert.equal(await page.locator("#nextMonth").isDisabled(), true);
        assert.equal(await page.locator("#batchSave").isEnabled(), true);
        await page.locator("#batchModeToggle").focus();
        if (language === "zh-CN" && [390, 1440].includes(width))
          await page.screenshot({
            path: `artifacts/batch-preview-page-${width}.png`,
            fullPage: true,
          });
        if (language === "zh-CN" && [390, 1440].includes(width))
          await page.locator("#batchBar").screenshot({
            path: `artifacts/batch-compact-direct-${width}.png`,
          });
        await page.locator("#batchModeToggle").click();
        await page.locator("#batchCalcOvertime").fill("2");
        await page.locator("#batchInputSection").evaluate(async (section) => {
          await Promise.allSettled(
            section.getAnimations().map((animation) => animation.finished),
          );
        });
        const overtimeIssues = await page
          .locator("#batchForm")
          .evaluate((form) => {
            const start = form
              .querySelector("#batchStart")
              .getBoundingClientRect();
            const hours = form
              .querySelector("#batchCalcOvertime")
              .getBoundingClientRect();
            const bounds = form.getBoundingClientRect();
            return (
              Math.abs(start.width - hours.width) > 1 ||
              Math.abs(start.top - hours.top) > 2 ||
              start.right > hours.left ||
              hours.right > bounds.right + 1 ||
              hours.right < bounds.right - 2
            );
          });
        assert.equal(
          overtimeIssues,
          false,
          `${language} ${width}: overtime inputs must share a row`,
        );
        if (language === "zh-CN" && [390, 1440].includes(width))
          await page.locator("#batchBar").screenshot({
            path: `artifacts/batch-compact-overtime-${width}.png`,
          });
        await page.locator("#batchModeToggle").click();
        layouts++;
      }
    }
    await page.evaluate(() =>
      WorkTimeApp.services.preferences.page.saveMotionMode("full"),
    );
    const editorMotion = await page.evaluate(() => {
      const dayForm = document.getElementById("dayForm");
      const batchForm = document.getElementById("batchForm");
      const hasPageMotion = (form) =>
        form.classList.contains("motion-sidebar-forward") ||
        form.classList.contains("motion-sidebar-back");

      document.getElementById("batchCancel").click();
      const exit = {
        page: hasPageMotion(dayForm),
        toolbar: !!document.querySelector(".batch-toolbar-outgoing"),
      };
      document.getElementById("batchToggle").click();
      return {
        exit,
        enter: {
          page: hasPageMotion(batchForm),
          toolbar: batchForm
            .querySelector(".batch-toolbar")
            .getAnimations()
            .some(
              (animation) => animation.animationName === "batch-toolbar-enter",
            ),
        },
      };
    });
    assert.deepEqual(editorMotion, {
      exit: { page: false, toolbar: true },
      enter: { page: false, toolbar: true },
    });
    const motion = await page.locator("#batchModeToggle").evaluate((button) => {
      const row = document.querySelector(".batch-time-fields");
      const next = document.getElementById("batchNextField");
      const templates = document.querySelector(".batch-template-area");
      for (const node of [row, next, templates]) getComputedStyle(node).opacity;
      button.click();
      return [row, next, templates].map((node) =>
        node.getAnimations().map((animation) => animation.transitionProperty),
      );
    });
    assert.ok(
      motion[0].includes("padding-inline-end") ||
        motion[0].includes("padding-right"),
    );
    assert.ok(motion[1].includes("opacity"));
    assert.ok(motion[2].includes("opacity"));
    await page.evaluate(() =>
      WorkTimeApp.services.preferences.page.saveMotionMode("reduce"),
    );
    await page.locator("#batchModeToggle").click();
    assert.equal(
      await page
        .locator("#batchInputSection")
        .evaluate(
          (section) =>
            section
              .getAnimations({ subtree: true })
              .filter((item) => "transitionProperty" in item).length,
        ),
      0,
    );
    await page.locator("#batchCancel").click();
    assert.equal(await page.locator("#nextMonth").isEnabled(), true);
    assert.equal(
      await page.locator("#monthTitle").getAttribute("aria-disabled"),
      "false",
    );
    assert.deepEqual(errors, []);
    for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ko", "ja"]) {
      await page.evaluate(
        (value) => WorkTimeApp.i18n.setLanguage(value),
        language,
      );
      for (const width of [320, 390, 850, 1150, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const date of ["2026-10-19", "2026-10-24"]) {
          await page
            .locator('.day[data-date="' + date + '"] .day-select')
            .click({ force: true, position: { x: 10, y: 10 } });
          const geometry = (batch) =>
            page.evaluate((batch) => {
              const host = document
                .querySelector(".workspace > .editor")
                .getBoundingClientRect();
              const ids = batch
                ? ["batchReset", "batchCancel", "batchSave"]
                : [
                    document.getElementById("dayLeaveToggle").disabled
                      ? "plannedOvertimeToggle"
                      : "dayLeaveToggle",
                    "clearManual",
                    "sourceOpen",
                  ];
              return ids.map((id) => {
                const box = document.getElementById(id).getBoundingClientRect();
                return {
                  x: box.left - host.left,
                  y: box.top - host.top,
                  width: box.width,
                  height: box.height,
                };
              });
            }, batch);
          const normal = await geometry(false);
          await page.locator("#batchToggle").click();
          const direct = await geometry(true);
          await page.locator("#batchModeToggle").click();
          const overtime = await geometry(true);
          await page.locator("#batchCancel").click();
          const returned = await geometry(false);
          for (const [mode, actual] of Object.entries({
            direct,
            overtime,
            returned,
          })) {
            for (let index = 0; index < normal.length; index++)
              for (const key of ["x", "y", "width", "height"])
                assert.ok(
                  Math.abs(actual[index][key] - normal[index][key]) < 1,
                  JSON.stringify({
                    language,
                    width,
                    date,
                    mode,
                    index,
                    key,
                    normal,
                    actual,
                  }),
                );
          }
        }
      }
    }
    console.log(
      `Verified ${layouts} batch preview layouts and stable action geometry across six languages and seven widths.`,
    );
  })().finally(async () => browser?.close());
}

(async () => {
  await verifyFill();
  await verifyClear();
  await verifyLayout();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

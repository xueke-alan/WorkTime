"use strict";
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const url = pathToFileURL(path.resolve(__dirname, "../index.html")).href;
const results = { checks: [], findings: [], measurements: {} };
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  async function scenario(name, run, options = {}) {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      timezoneId: "Asia/Shanghai",
      ...options,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      if (!["midnight rollover", "layout and performance"].includes(name))
        await page.clock.install({
          time: new Date("2026-10-02T12:00:00+08:00"),
        });
      await run(page, context);
      assert.deepEqual(errors, [], name + " page errors");
    } finally {
      await context.close();
    }
  }
  await scenario("save failure", async (page) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException("audit quota", "QuotaExceededError");
      };
    });
    await page.goto(url);
    await page.locator("#settingsOpen").click();
    await page.locator("#standardEnd").fill("18:30");
    const notice = await page.locator("#storageNoticeText").innerText();
    const feedback = await page.locator("#feedbackList").innerText();
    const open = await page.locator("#settingsDialog").evaluate((e) => e.open);
    results.findings.push({
      id: "R01",
      name: "settings reports success after persistence failure",
      notice,
      feedback,
      dialogOpen: open,
      reproduced:
        feedback.includes("计算设置已更新") &&
        notice.includes("更改未保存") &&
        !open,
    });
  });
  await scenario("two tabs", async (page, context) => {
    await page.goto(url);
    const other = await context.newPage();
    await other.goto(url);
    await page.locator('[data-date="2026-10-08"]').click();
    await page.locator("#dayStart").fill("08:00");
    await page.locator("#dayEnd").fill("18:00");
    await other.locator('[data-date="2026-10-09"]').click();
    await other.locator("#dayStart").fill("08:00");
    await other.locator("#dayEnd").fill("19:00");
    const dates = await other.evaluate(() =>
      Object.keys(JSON.parse(localStorage.getItem(WorkTime.KEY)).days),
    );
    results.findings.push({
      id: "R02",
      name: "second tab overwrites first tab edits",
      persistedDates: dates,
      reproduced: !dates.includes("2026-10-08") && dates.includes("2026-10-09"),
    });
  });
  await scenario("clipboard conflicts", async (page) => {
    await page.addInitScript(() => {
      const key = "worktime-local-v1";
      const s = {
        schemaVersion: 1,
        scheduleDefaultsVersion: 1,
        targetAverageMinutes: 120,
        overtimeRequirements: [120, null, null, null, null],
        settings: {
          employmentDate: "",
          configured: true,
          workStart: "08:00",
          workEnd: "17:30",
          standardMinutes: 480,
          breaks: [
            { start: 720, end: 810 },
            { start: 1050, end: 1080 },
          ],
        },
        timeTemplates: [],
        imports: [],
        days: {
          "2026-09-28": {
            oa: {
              date: "2026-09-28",
              start: "08:00",
              end: "17:30",
              nextDay: false,
              status: "complete",
              source: "old",
              raw: "",
              importId: "",
            },
          },
        },
      };
      localStorage.setItem(key, JSON.stringify(s));
      Object.defineProperty(navigator, "clipboard", {
        value: { readText: async () => "09/28\n08:00\n20:00" },
        configurable: true,
      });
    });
    await page.goto(url);
    await page.locator("[data-import-clipboard]").click();
    await page.waitForFunction(
      () =>
        document.getElementById("importDialog").open ||
        JSON.parse(localStorage.getItem(WorkTime.KEY)).imports.length === 1,
    );
    const end = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem(WorkTime.KEY)).days["2026-09-28"].oa
          .end,
    );
    const previewOpen = await page
      .locator("#importDialog")
      .evaluate((e) => e.open);
    results.findings.push({
      id: "R05",
      name: "clipboard shortcut overwrites complete OA conflict without preview",
      end,
      previewOpen,
      reproduced: end === "20:00" && !previewOpen,
    });
  });
  await scenario(
    "midnight rollover",
    async (page) => {
      await page.clock.install({ time: new Date("2026-10-02T23:59:59+08:00") });
      await page.goto(url);
      const before = await page
        .locator("#calendar .today")
        .getAttribute("data-date");
      await page.clock.fastForward(5000);
      await page.locator("#todayButton").click();
      const after = await page
        .locator("#calendar .today")
        .getAttribute("data-date");
      const now = await page.evaluate(() => WorkTime.dateKey(new Date()));
      results.findings.push({
        id: "R06",
        name: "today stays at startup date after midnight",
        before,
        after,
        now,
        reproduced: after !== now,
      });
    },
    { timezoneId: "Asia/Shanghai" },
  );
  await scenario("past target", async (page) => {
    await page.goto(url);
    await page.locator("#monthTitle").click();
    await page.locator('[data-year-date="2026-01-01"]').click();
    const actual = await page.evaluate(() => {
      const s = WorkTime.defaultState();
      return WorkTime.targetPace(
        s,
        "2026-01-01",
        "2026-01-31",
        WorkTime.dateKey(new Date()),
        120,
      );
    });
    const shown = await page.locator("#targetMetric").evaluate((e) =>
      (
        e.querySelector(".summary-number-accessible")?.textContent ||
        [...e.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent)
          .join("")
      ).trim(),
    );
    results.findings.push({
      id: "R07",
      name: "past month unmet target shown as zero remaining",
      difference: actual.difference,
      remainingDays: actual.remainingDays,
      shown,
      reproduced: actual.difference > 0 && shown === "0",
    });
  });
  await scenario("calendar coverage warning", async (page) => {
    await page.goto(url);
    await page.locator("#monthTitle").click();
    await page.locator("#prevMonth").click();
    const known = await page.evaluate(() =>
      WorkTime.calendarKnown("2025-01-01"),
    );
    const visible = await page.locator("#yearNotice").isVisible();
    const text = await page.locator("#yearNotice").innerText();
    results.findings.push({
      id: "R08",
      name: "known year incorrectly labelled missing holiday data",
      known,
      visible,
      text,
      reproduced: known && visible && text.includes("未内置"),
    });
  });
  await scenario("core browser workflows", async (page) => {
    await page.goto(url);
    await page.locator('[data-date="2026-10-08"]').click();
    await page.locator("#dayStart").fill("08:00");
    await page.locator("#dayEnd").fill("20:00");
    await page.reload();
    await page.locator('[data-date="2026-10-08"]').click();
    assert.equal(await page.locator("#dayEnd").inputValue(), "20:00");
    results.checks.push("manual edit persists across reload");
    await page.locator("#dayEnd").fill("07:00");
    assert.equal(
      await page.locator("#dayEnd").getAttribute("aria-invalid"),
      "true",
    );
    await page.locator("#dayNextToggle").click();
    assert.equal(
      await page.locator("#dayEnd").getAttribute("aria-invalid"),
      "false",
    );
    results.checks.push("overnight toggle clears time anomaly");
    await page.locator("#importOpen").click();
    await page.locator("#pasteText").fill("09/28\n08:00\n17:30");
    await page.locator("#commitImport").waitFor({ state: "visible" });
    await page.waitForFunction(
      () => !document.getElementById("commitImport").disabled,
    );
    await page.locator("#commitImport").click();
    await page.reload();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem(WorkTime.KEY)).days["2026-09-28"].oa
            .end,
      ),
      "17:30",
    );
    results.checks.push("OA preview import persists across reload");
    for (const id of [
      "history",
      "festivals",
      "almanac",
      "countdown",
      "notifications",
    ]) {
      await page.locator("#date-tab-" + id).click();
      assert.equal(
        await page.locator("#date-tab-" + id).getAttribute("aria-selected"),
        "true",
      );
    }
    results.checks.push("all five date info tabs switch without page errors");
    await page.locator("#date-tab-history").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator("#date-tab-festivals").getAttribute("aria-selected"),
      "true",
    );
    results.checks.push("date tabs support arrow keyboard navigation");
    await page.locator("#addTimeTemplate").click();
    await page.locator("#timeTemplateName").fill("审查模板");
    await page.locator("#timeTemplateStart").fill("08:00");
    await page.locator("#timeTemplateEnd").fill("18:30");
    await page.locator("#timeTemplateForm button[type=submit]").click();
    await page.reload();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem(WorkTime.KEY)).timeTemplates[0].name,
      ),
      "审查模板",
    );
    results.checks.push("time template persists across reload");
    const backup = await page.evaluate(() => {
      const s = WorkTime.defaultState();
      s.days["2026-10-08"] = {
        actual: {
          start: "09:00",
          end: "18:00",
          nextDay: false,
          effectiveMinutes: null,
        },
      };
      return JSON.stringify(s);
    });
    await page.locator("#backupFile").setInputFiles({
      name: "audit-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(backup),
    });
    await page.locator("#confirmRestore").click();
    await page.reload();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem(WorkTime.KEY)).days["2026-10-08"]
            .actual.start,
      ),
      "09:00",
    );
    results.checks.push("JSON file restore persists across reload");
    const compressed = await page.evaluate(async (raw) => {
      const bytes = new Uint8Array(
        await new Response(
          new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")),
        ).arrayBuffer(),
      );
      return "WORKTIME:GZIP:1:" + btoa(String.fromCharCode(...bytes));
    }, backup);
    await page.locator("#backupFile").setInputFiles({
      name: "audit-gzip.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(compressed),
    });
    await page.locator("#confirmRestore").click();
    await page.reload();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem(WorkTime.KEY)).days["2026-10-08"]
            .actual.start,
      ),
      "09:00",
    );
    results.checks.push("gzip text backup restore persists across reload");
    await page.locator("#batchToggle").click();
    await page.locator('[data-date="2026-10-08"]').click();
    await page.locator('[data-date="2026-10-09"]').click();
    await page.locator("#batchStart").fill("08:00");
    await page.locator("#batchEnd").fill("19:30");
    await page.locator("#batchSave").click();
    await page.reload();
    const ends = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem(WorkTime.KEY));
      return ["2026-10-08", "2026-10-09"].map(
        (k) => WorkTime.effectiveRecord(s.days[k], true).end,
      );
    });
    assert.deepEqual(ends, ["19:30", "19:30"]);
    results.checks.push("two-day batch edit persists across reload");
  });
  await scenario("corrupt storage", async (page) => {
    await page.addInitScript(() =>
      localStorage.setItem("worktime-local-v1", "{broken"),
    );
    await page.goto(url);
    await page.locator("#storageNotice").waitFor({ state: "visible" });
    await page.locator("#dayStart").fill("08:00");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("worktime-local-v1")),
      "{broken",
    );
    results.checks.push("corrupt persisted data is not silently overwritten");
  });
  await scenario(
    "layout and performance",
    async (page) => {
      await page.goto(url);
      const samples = [];
      for (let i = 0; i < 10; i++)
        samples.push(
          await page.evaluate(() => {
            const start = performance.now();
            document.getElementById("monthTitle").click();
            return performance.now() - start;
          }),
        );
      results.measurements.calendarToggleSynchronousMs = samples;
      results.measurements.initialNavigation = await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0];
        return n
          ? {
              domContentLoadedMs: n.domContentLoadedEventEnd,
              loadMs: n.loadEventEnd,
            }
          : { unavailable: true };
      });
      for (const width of [390, 768, 1200, 1600, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "overflow at " + width,
        );
      }
      results.checks.push(
        "document width fits 390/768/1200/1600/1920 px viewports",
      );
    },
    { reducedMotion: "reduce" },
  );
  console.log(JSON.stringify(results, null, 2));
  if (process.env.REVIEW_OUTPUT)
    fs.writeFileSync(
      process.env.REVIEW_OUTPUT,
      JSON.stringify(results, null, 2) + "\n",
    );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});

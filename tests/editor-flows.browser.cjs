"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    ";globalThis.C=WorkTime",
  context,
);
const C = context.C,
  initial = C.defaultState();
delete initial.scheduleDefaultsVersion;
initial.settings.workStart = "09:00";
initial.settings.workEnd = "18:00";
initial.settings.breaks = [{ start: 720, end: 780 }];
const oa = {
  date: "2026-09-28",
  start: "09:00",
  end: "18:00",
  nextDay: false,
  status: "complete",
  source: "original",
  raw: "09/28\n09:00\n18:00",
  importId: "original",
};
initial.days[oa.date] = { oa, note: "keep until reset", leaveMinutes: 60 };
initial.imports = [
  {
    id: "original",
    at: "2026-09-28T10:00:00Z",
    year: 2026,
    sources: [{ name: "original", raw: oa.raw }],
    count: 1,
    records: [oa],
  },
];
let browser;
(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const browserContext = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    timezoneId: "Asia/Shanghai",
    reducedMotion: "reduce",
  });
  const page = await browserContext.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-10-02T12:00:00+08:00") });
  await page.addInitScript(
    (state) => {
      localStorage.setItem("worktime-local-v1", JSON.stringify(state));
      window.clipboardValue = "";
      Object.defineProperty(navigator, "clipboard", {
        value: {
          readText: async () => window.clipboardValue,
          writeText: async (value) => {
            window.clipboardValue = value;
          },
        },
        configurable: true,
      });
    },
    JSON.parse(JSON.stringify(initial)),
  );
  await page.goto(
    require("node:url").pathToFileURL(path.resolve(__dirname, "../index.html"))
      .href,
  );
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("worktime-local-v1")));
  assert.deepEqual(
    (await saved()).settings.breaks,
    [{ start: 720, end: 780 }],
    "startup preserves old custom breaks",
  );
  await page.locator("#prevMonth").click();
  await page.locator('[data-date="2026-09-28"]').click();
  assert.equal(await page.locator("#dayStart").inputValue(), "09:00");
  await page.locator("#dayStart").fill("0930");
  assert.equal((await saved()).days["2026-09-28"].actual.start, "09:30");

  await page.locator("#addTimeTemplate").click();
  await page.locator("#timeTemplateName").fill("早班");
  await page.locator("#timeTemplateStart").fill("0800");
  await page.locator("#timeTemplateEnd").fill("1600");
  await page.locator("#timeTemplateForm button[type=submit]").click();
  assert.equal((await saved()).timeTemplates.length, 1);
  await page.locator("#timeTemplateList [data-template-edit]").click();
  await page.locator("#timeTemplateName").fill("修改后的早班");
  await page.locator("#timeTemplateForm button[type=submit]").click();
  assert.equal((await saved()).timeTemplates[0].name, "修改后的早班");
  await page.locator("#timeTemplateList [data-template-fill]").click();
  assert.equal((await saved()).days["2026-09-28"].actual.start, "08:00");
  await page.locator("#sourceOpen").click();
  assert.match(await page.locator("#sourceBody").innerText(), /original/);
  await page.locator("#sourceDialog [data-close]").first().click();
  await page.locator("#clearManual").click();
  const reset = (await saved()).days["2026-09-28"];
  assert.deepEqual(reset, { oa });
  assert.equal((await saved()).timeTemplates.length, 1);
  assert.equal(await page.locator("#dayStart").inputValue(), "09:00");
  await page.locator("#timeTemplateList [data-template-edit]").click();
  await page.locator("#deleteTimeTemplate").click();
  assert.equal((await saved()).timeTemplates.length, 0);

  const restored = C.defaultState();
  restored.settings.workStart = "07:00";
  restored.settings.workEnd = "16:00";
  restored.settings.breaks = [{ start: 720, end: 780 }];
  restored.days["2026-09-28"] = {
    actual: {
      start: "07:00",
      end: "20:00",
      nextDay: false,
      effectiveMinutes: null,
    },
  };
  restored.timeTemplates = [
    {
      id: "restored-template",
      name: "新状态模板",
      start: "07:00",
      end: "17:00",
      nextDay: false,
    },
  ];
  await page.evaluate((text) => {
    window.clipboardValue = text;
  }, JSON.stringify(restored));
  await page.locator("#restore").click();
  await page.locator("#confirmRestore").click();
  assert.equal(
    await page.locator("#dayStart").inputValue(),
    "07:00",
    "editor reads replacement state",
  );
  assert.equal(await page.locator("#dayEnd").inputValue(), "20:00");
  assert.match(
    await page.locator("#timeTemplateList").innerText(),
    /新状态模板/,
  );
  assert.match(
    await page.locator('[data-date="2026-09-28"] .dayhours').innerText(),
    /12.00/,
    "calendar reads replacement state",
  );
  assert.match(
    await page.locator("#cards").innerText(),
    /12.00/,
    "summary reads replacement state",
  );

  await page.locator("#batchToggle").click();
  await page.locator('[data-date="2026-09-28"]').click();
  await page
    .locator('[data-date="2026-09-30"]')
    .click({ modifiers: ["Shift"] });
  assert.equal(await page.locator(".batchselected").count(), 3);
  await page.locator("#batchStart").fill("0800");
  await page.locator("#batchEnd").fill("1900");
  await page.locator("#batchSave").click();
  const batch = await saved();
  assert.equal(batch.days["2026-09-28"].actual.end, "19:00");
  assert.equal(batch.days["2026-09-29"].estimate.end, "19:00");
  assert.equal(batch.days["2026-09-30"].estimate.end, "19:00");
  assert.deepEqual(errors, []);
  console.log(
    "Editor flows passed: legacy startup, normalized autosave, template CRUD/fill, sources/reset, replacement-state views and shift batch range.",
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});

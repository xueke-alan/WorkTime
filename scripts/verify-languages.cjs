"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const output = path.resolve(
  process.env.WORKTIME_LAYOUT_OUTPUT || "test-results/languages",
);
const widths = process.env.WORKTIME_LAYOUT_WIDTHS?.split(",").map(Number) || [
  320, 390, 540, 850, 1150, 1151, 1280, 1440, 1920, 2560,
];
const selectedViews = process.env.WORKTIME_LAYOUT_VIEWS?.split(",");
const languages = process.env.WORKTIME_LAYOUT_LANGUAGES?.split(",") || [
  "zh-CN",
  "en",
  "zh-TW",
  "zh-HK",
  "ko",
  "ja",
];
async function ready(page) {
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading"),
  );
}
// Run in the page: inspect rendered ink as well as scroll boxes. Intentional
// ellipses and scrollable text areas are allowed, hidden/inert surfaces are not UI.
function auditLayout() {
  const issues = [];
  if (document.documentElement.scrollWidth > innerWidth + 1)
    issues.push({ selector: "html", type: "page-overflow" });
  const selector = [
    "button",
    "label",
    "h1",
    "h2",
    "h3",
    ".button-label",
    ".daykind",
    ".pill-text",
    ".card-label",
    ".card-foot",
    ".target-copy",
    ".help",
    ".warnings",
    ".weather-detail dt",
    ".weather-detail dd",
    ".weather-heading",
    ".weather-hour",
    ".weather-day",
    ".preview-period > span",
    ".notification-body",
    "#status",
    "main > p",
  ].join(",");
  const scope = document.querySelector("dialog:modal") || document;
  for (const node of scope.querySelectorAll(selector)) {
    if (!node.getClientRects().length || node.closest("[inert]")) continue;
    const style = getComputedStyle(node),
      box = node.getBoundingClientRect();
    if (style.visibility === "hidden" || !box.width || !box.height) continue;
    if (node.matches("button") && (box.left < -2 || box.right > innerWidth + 2))
      issues.push({
        selector: "#" + node.id,
        type: "control-outside-viewport",
      });
    if (node.matches("button")) {
      for (
        let parent = node.parentElement;
        parent &&
        parent !== document.body &&
        (scope === document || scope.contains(parent));
        parent = parent.parentElement
      ) {
        if (!["hidden", "clip"].includes(getComputedStyle(parent).overflowX))
          continue;
        const bounds = parent.getBoundingClientRect();
        if (box.left < bounds.left - 2 || box.right > bounds.right + 2) {
          issues.push({
            selector: node.id ? "#" + node.id : node.className,
            type: "control-clipped-by-parent",
          });
          break;
        }
      }
    }
    const text = node.textContent.trim();
    if (!text) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const lines = [...range.getClientRects()].filter(
      (r) => r.width && r.height,
    );
    if (!lines.length) continue;
    const report = (type) =>
      issues.push({
        selector: node.id ? "#" + node.id : node.className || node.tagName,
        type,
        text,
        width: Math.round(box.width),
      });
    const ellipsis =
      style.textOverflow === "ellipsis" ||
      [...node.querySelectorAll("*")].some(
        (child) => getComputedStyle(child).textOverflow === "ellipsis",
      );
    if (!ellipsis && node.scrollWidth > node.clientWidth + 2)
      report("horizontal-overflow");
    if (
      node.matches("button") &&
      !ellipsis &&
      node.scrollHeight > node.clientHeight + 2
    )
      report("vertical-clipping");
    if (node.matches(".button-label") && !ellipsis) {
      const button = node.closest("button");
      if (button) {
        const host = button.getBoundingClientRect();
        if (
          lines.some(
            (r) =>
              r.left < host.left - 2 ||
              r.right > host.right + 2 ||
              r.top < host.top - 2 ||
              r.bottom > host.bottom + 2,
          )
        )
          report("button-text-outside");
      }
      if (
        innerWidth >= 1920 &&
        !node.closest("[role='listbox']") &&
        lines.some((r) => lines.some((other) => other.top >= r.bottom - 1))
      )
        report("desktop-button-wrap");
    }
    if (
      node.matches("label,h1,h2,h3,.card-label,.card-foot") &&
      !node.children.length &&
      !ellipsis &&
      lines.some((r) => r.left < box.left - 2 || r.right > box.right + 2)
    )
      report("text-outside");
    if (node.matches("button")) {
      for (const icon of node.querySelectorAll(":scope > .ui-icon")) {
        if (!icon.getClientRects().length) continue;
        // UI icons use square slots; computed width already includes flex
        // shrink, so compare the rendered width with its unshrunk height.
        const iconBox = icon.getBoundingClientRect();
        if (iconBox.width && iconBox.width < iconBox.height - 1)
          report("icon-squeezed");
      }
    }
  }
  for (const card of scope.querySelectorAll(".card")) {
    const label = card.querySelector(".card-label"),
      metric = card.querySelector(".metric");
    if (!label || !metric || !label.getClientRects().length) continue;
    const range = document.createRange();
    range.selectNodeContents(label);
    const text = range.getBoundingClientRect(),
      value = metric.getBoundingClientRect();
    const right =
      getComputedStyle(label).textOverflow === "ellipsis"
        ? Math.min(text.right, label.getBoundingClientRect().right)
        : text.right;
    if (
      right > value.left + 2 &&
      text.bottom > value.top &&
      text.top < value.bottom
    )
      issues.push({
        selector: ".card-label",
        type: "metric-overlap",
        text: label.textContent,
      });
  }
  if (innerWidth >= 1920) {
    const buttons = [
      ...scope.querySelectorAll(".batch-editor-actions button"),
    ].filter((button) => button.getClientRects().length);
    if (
      buttons.length &&
      buttons.some(
        (button) =>
          Math.abs(
            button.getBoundingClientRect().top -
              buttons[0].getBoundingClientRect().top,
          ) > 2,
      )
    )
      issues.push({
        selector: ".batch-editor-actions",
        type: "desktop-action-wrap",
      });
  }
  return issues;
}
async function verify() {
  fs.mkdirSync(output, { recursive: true });
  const layoutIssues = [];
  const checkedViews = [];
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    for (const language of languages) {
      const context = await browser.newContext({
        locale: language === "en" ? "en-GB" : language,
        reducedMotion: "reduce",
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
      await page.goto(pathToFileURL(path.join(root, "index.html")).href);
      await ready(page);
      assert.equal(await page.locator("html").getAttribute("lang"), language);
      assert.equal(await page.locator("#languageOptions button").count(), 6);
      assert.deepEqual(
        await page.locator("#languageOptions button").allTextContents(),
        [
          "简体中文",
          "繁體中文-台",
          "繁體中文-港",
          "English",
          "한국어",
          "日本語",
        ],
      );
      const baseline = await page.evaluate(() =>
        JSON.stringify(
          WorkTimeApp.domain.records.calculate(
            "2026-10-21",
            {
              actual: {
                start: "08:00",
                end: "19:30",
                nextDay: false,
                effectiveMinutes: null,
              },
            },
            WorkTimeApp.domain.state.defaultState().settings,
            true,
          ),
        ),
      );
      const formatting = await page.evaluate(() => ({
        number: WorkTimeApp.i18n.number(1.5),
        duration: WorkTimeApp.i18n.duration(90),
        day: WorkTimeApp.i18n.plural(2, "unit.day.one", "unit.day.other"),
        months: Array.from({ length: 12 }, (_, m) =>
          WorkTimeApp.i18n.monthName(
            "2026-" + String(m + 1).padStart(2, "0") + "-01",
          ),
        ),
      }));
      assert.equal(formatting.months.length, 12);
      assert.ok(!formatting.day.includes("{"));
      assert.equal(formatting.number, "1.5");
      assert.equal(formatting.duration, "1.50 h");
      async function capture(view) {
        if (selectedViews && !selectedViews.includes(view)) return;
        for (const width of widths) {
          await page.setViewportSize({
            width,
            height: width === 2560 ? 1440 : width === 1920 ? 1080 : 1000,
          });
          await page.evaluate(() => WorkTimeApp.ui.alignment?.refresh());
          const issues = await page.evaluate(auditLayout);
          checkedViews.push({
            language,
            view,
            ...page.viewportSize(),
            issues: issues.length,
          });
          layoutIssues.push(
            ...issues.map((issue) => ({
              language,
              view,
              viewport: width,
              ...issue,
            })),
          );
          if (
            ["en", "ko"].includes(language) &&
            !["import", "converter"].includes(view)
          ) {
            const leaks = await page.evaluate(() => {
              const copy = document.body.cloneNode(true);
              copy
                .querySelectorAll(
                  "#languageOptions,select,textarea,.history-event,.history-language-note,script",
                )
                .forEach((node) => node.remove());
              return [...copy.querySelectorAll("*")]
                .filter(
                  (node) =>
                    node.children.length === 0 &&
                    /[\u3400-\u9fff]/.test(node.textContent) &&
                    document
                      .querySelector(node.id ? "#" + node.id : ":not(*)")
                      ?.getClientRects().length,
                )
                .map((node) => node.textContent);
            });
            assert.deepEqual(
              leaks,
              [],
              language + " untranslated text in " + view,
            );
          }
          if (issues.length || [320, 1920, 2560].includes(width))
            await page.screenshot({
              path: path.join(
                output,
                language + "-" + view + "-" + width + ".png",
              ),
              fullPage: true,
            });
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      await capture("month");
      await page.evaluate(() => {
        const dialog = document.createElement("dialog"),
          heading = document.createElement("h2"),
          header = document.createElement("div");
        heading.textContent = "Clock-in time / Clock-out time";
        heading.style.overflowWrap = "anywhere";
        header.className = "dialog-head";
        header.append(heading);
        dialog.append(header);
        document.body.append(dialog);
        dialog.showModal();
        WorkTimeApp.ui.alignment.refresh();
        heading.style.width = "60px";
        WorkTimeApp.ui.alignment.refresh();
        const range = document.createRange();
        range.selectNodeContents(heading);
        const wrapped = range.getClientRects().length > 1;
        const offset = heading.style.getPropertyValue("--ui-ink-offset");
        dialog.close();
        dialog.remove();
        if (!wrapped || parseFloat(offset) !== 0)
          throw Error("Wrapped heading must clear its single-line ink offset");
      });
      await page.locator("#batchToggle").click();
      await capture("batch");
      const eligible = page
        .locator('.calendar .day[data-date]:not([aria-disabled="true"])')
        .first();
      await eligible.click();
      await capture("batch-selected");
      await eligible.click();
      await page.locator("#batchCancel").click();
      // A half-size CSS viewport at DPR 2 exercises the reflow and pixel size
      // of 200% browser zoom on the two target displays (no pinch/CSS zoom).
      if (!selectedViews && ["zh-CN", "en", "ko"].includes(language)) {
        for (const [width, height] of [
          [960, 540],
          [1280, 720],
        ]) {
          const zoomContext = await browser.newContext({
            locale: language,
            reducedMotion: "reduce",
            deviceScaleFactor: 2,
            viewport: { width, height },
          });
          try {
            const zoomPage = await zoomContext.newPage();
            zoomPage.on("pageerror", (error) => errors.push(error.message));
            await zoomPage.route(/^https?:/, (route) => route.abort());
            await zoomPage.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
            await zoomPage.goto(
              pathToFileURL(path.join(root, "index.html")).href,
            );
            await ready(zoomPage);
            for (const view of ["month", "year", "batch", "preferences"]) {
              if (view === "year")
                await zoomPage.locator("#monthTitle").click();
              if (view === "batch") {
                await zoomPage.locator("#monthTitle").click();
                await zoomPage.locator("#batchToggle").click();
              }
              if (view === "preferences") {
                await zoomPage.locator("#batchCancel").click();
                await zoomPage.locator("#pageSettingsOpen").click();
              }
              await zoomPage.evaluate(() => WorkTimeApp.ui.alignment.refresh());
              const issues = await zoomPage.evaluate(auditLayout);
              checkedViews.push({
                language,
                view: "zoom200-" + view,
                width,
                height,
                deviceScaleFactor: 2,
                issues: issues.length,
              });
              layoutIssues.push(
                ...issues.map((issue) => ({
                  language,
                  view: "zoom200-" + view,
                  viewport: width,
                  ...issue,
                })),
              );
              await zoomPage.screenshot({
                path: path.join(
                  output,
                  language + "-zoom200-" + view + "-" + width * 2 + ".png",
                ),
                fullPage: true,
              });
            }
          } finally {
            await zoomContext.close();
          }
        }
      }
      await page.locator("#monthTitle").click();
      await capture("year");
      await page.locator("#monthTitle").click();
      await page.locator("#date-tab-history").click();
      await page.waitForSelector(".history-event");
      await capture("history");
      const chinese = language.startsWith("zh-");
      assert.equal(
        await page.locator("#date-context-almanac").isVisible(),
        chinese,
      );
      assert.equal(
        await page.locator(".history-language-note").count(),
        !chinese && language !== "en" ? 1 : 0,
      );
      if (chinese) {
        await page.locator("#date-context-almanac").click();
        await page.waitForSelector(".almanac-sheet");
        await capture("almanac");
        if (language !== "zh-CN")
          assert.ok(
            !/[开纳财扫闰]/.test(
              await page.locator(".almanac-sheet").innerText(),
            ),
            language + " simplified almanac text",
          );
      }
      await page.locator("#date-context-festivals").click();
      await page.waitForSelector(".festival-section");
      await capture("festivals");
      await page.locator("#settingsOpen").click();
      await capture("schedule");
      await page.locator("#workSettingsCancel").click();
      await page.locator("#addTimeTemplate").click();
      await capture("template");
      await page.locator('[data-close="timeTemplateDialog"]').first().click();
      await page.locator("#importOpen").click();
      await page.locator("#pasteText").fill("10/19\n周一\n08:00\n12:00\n19:30");
      await page.waitForTimeout(350);
      await capture("import");
      await page.locator("#pasteText").fill("10/19\n周一\n08:00\n19:30");
      await page.waitForFunction(
        () => !document.querySelector("#commitImport").disabled,
      );
      await capture("import-valid");
      await page.locator("#commitImport").click();
      await page.waitForSelector("#importDialog:not([open])", {
        state: "attached",
      });
      await page.locator("#sourceOpen").click();
      await page.waitForSelector("#sourceDialog[open]");
      await capture("source");
      await page.locator("#personalSettingsOpen").click();
      await capture("profile");
      const cityName = await page.evaluate(() =>
        WorkTimeApp.i18n.city(WorkTimeApp.data.weatherCities.cities[0].name),
      );
      await page.locator("#workCity").click();
      await page.waitForSelector("#workCityOption0");
      await capture("city-menu");
      assert.equal(
        await page.locator("#workCityOption0 .work-city-name").textContent(),
        cityName,
      );
      await page.locator("#workCityOption0").click();
      await page.locator("#profileSettingsCancel").click();
      await page.evaluate(() => {
        document.querySelector("#dayStart").value = "09:17";
      });
      await page.locator("#pageSettingsOpen").click();
      await capture("preferences");
      await page.locator("#languageTrigger").click();
      await capture("language-menu");
      await page.screenshot({
        path: path.join(output, language + "-language-menu.png"),
        fullPage: true,
      });
      await page.locator("#languageTrigger").press("Escape");
      for (const next of ["zh-TW", "ja", "en", language])
        await page.locator("#languageSelect").selectOption(next);
      assert.equal(await page.locator("#dayStart").inputValue(), "09:17");
      await page.waitForFunction(
        () => !WorkTimeApp.services.preferences.page.dirty,
      );
      const roundtrip = await page.evaluate(() => {
        const state = WorkTimeApp.domain.state.defaultState();
        state.preferences.language = WorkTimeApp.i18n.language;
        return WorkTimeApp.services.archive.decode(
          WorkTimeApp.services.archive.encode(state),
        ).preferences.language;
      });
      assert.equal(roundtrip, language);
      await page.reload();
      await ready(page);
      assert.equal(await page.locator("html").getAttribute("lang"), language);
      assert.equal(
        await page.evaluate(() =>
          JSON.stringify(
            WorkTimeApp.domain.records.calculate(
              "2026-10-21",
              {
                actual: {
                  start: "08:00",
                  end: "19:30",
                  nextDay: false,
                  effectiveMinutes: null,
                },
              },
              WorkTimeApp.domain.state.defaultState().settings,
              true,
            ),
          ),
        ),
        baseline,
      );
      await page.locator("#date-tab-weather").click();
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
        document.querySelector("#dateInfoPanel").hidden = false;
        document.querySelector("#editorInfo").hidden = true;
      });
      await capture("weather");
      assert.ok(
        await page
          .locator(".weather-hour strong")
          .evaluateAll((nodes) =>
            nodes.every(
              (node) =>
                node.textContent === "—" &&
                node.title &&
                node.getAttribute("aria-label") === node.title,
            ),
          ),
        language +
          " missing hourly values keep localized accessible descriptions",
      );
      await page.evaluate(() => {
        const city = WorkTimeApp.data.weatherCities.cities.reduce(
          (longest, candidate) =>
            WorkTimeApp.i18n.city(candidate.name).length >
            WorkTimeApp.i18n.city(longest.name).length
              ? candidate
              : longest,
        );
        const firstHour = Math.floor(Date.now() / 3600000) * 3600000;
        WorkTimeApp.ui.weather.render(
          document.querySelector("#dateInfoPanel"),
          {
            city,
            record: {
              validAt: "2026-10-21T12:00:00+08:00",
              fetchedAt: "2026-10-21T12:01:00+08:00",
              current: {
                temperature: -18.5,
                apparentTemperature: null,
                humidity: null,
                windClass: "",
                windDirectionText: "",
                weatherCode: 0,
              },
              hourly: Array.from({ length: 12 }, (_, index) => ({
                time: new Date(firstHour + index * 3600000).toISOString(),
                temperature: index % 2 ? null : -18.5,
                precipitationProbability: index % 2 ? null : 100,
              })),
              daily: Array.from({ length: 5 }, (_, index) => ({
                date: "2026-10-" + (21 + index),
                high: index % 2 ? null : 28.5,
                low: index % 2 ? null : -18.5,
                uvIndex: index % 2 ? null : 12,
                weatherCode: 0,
              })),
            },
          },
        );
      });
      await capture("weather-populated");
      await page.locator("#weather-forecast-tab-daily").click();
      await capture("weather-daily");
      await page.locator("#date-tab-notifications").click();
      await page.evaluate(() => {
        const notice = document.createElement("div");
        notice.className = "info-notification tone-error";
        notice.id = "layoutFixtureNotice";
        const body = document.createElement("div");
        body.className = "notification-body";
        body.textContent =
          WorkTimeApp.i18n.t("copy.77b0044d4f") +
          " " +
          "worktime-backup-2026-10-21-".repeat(6) +
          ".json";
        notice.append(body);
        document.querySelector("#feedbackList").append(notice);
      });
      await capture("long-notification");
      await page
        .locator("#layoutFixtureNotice")
        .evaluate((node) => node.remove());
      // Exercise every modal's localized geometry, including recovery/error
      // states that normally require a destructive action or corrupt storage.
      // Opening them directly is deliberately presentation-only; no action runs.
      const dialogs = await page
        .locator("dialog:not(.sidebar-oa-pane)")
        .evaluateAll((nodes) => nodes.map((node) => node.id));
      for (const id of dialogs) {
        await page.evaluate(
          (id) => document.getElementById(id).showModal(),
          id,
        );
        await capture("dialog-" + id);
        await page.evaluate((id) => document.getElementById(id).close(), id);
      }
      const populated = await page.evaluate((language) => {
        const state = WorkTimeApp.domain.state.defaultState();
        state.preferences.language = language;
        state.personal.employmentDate = "2000-01-01";
        state.timeTemplates = [
          {
            id: "layout-long",
            name: "W".repeat(30),
            start: "22:00",
            end: "06:00",
            nextDay: true,
          },
        ];
        for (let day = 1; day <= 21; day++)
          state.days["2026-10-" + String(day).padStart(2, "0")] = {
            actual: {
              start: "08:00",
              end: day === 21 ? "16:42" : "23:59",
              nextDay: false,
              effectiveMinutes: null,
            },
          };
        state.days["2026-10-20"].actual = {
          start: "22:00",
          end: "06:00",
          nextDay: true,
          effectiveMinutes: null,
        };
        return JSON.stringify(
          WorkTimeApp.domain.validation.validateBackup(state),
        );
      }, language);
      await page.locator("#backupFile").setInputFiles({
        name: "layout-populated.json",
        mimeType: "application/json",
        buffer: Buffer.from(populated),
      });
      await capture("restore-populated");
      await page.locator("#confirmRestore").click();
      await page.waitForSelector("#dayPreview .has-daily-metrics");
      await capture("populated-negative");
      await page.locator('.calendar [data-date="2026-10-20"]').click();
      await capture("populated-overnight");
      await page.locator("#batchToggle").click();
      await capture("populated-batch");
      await page.locator("#batchCancel").click();
      const units = await page
        .locator(".summary-number-value > small")
        .allTextContents();
      assert.ok(
        units.every((unit) => ["h", " h", "d", "m", "h/d"].includes(unit)),
        language + " must keep universal metric units: " + units,
      );
      await page.goto(
        pathToFileURL(path.join(root, "tools/convert-backup.html")).href,
      );
      assert.equal(await page.locator("html").getAttribute("lang"), language);
      await capture("converter");
      assert.deepEqual(errors, [], language + " runtime errors");
      await context.close();
      console.log(
        language +
          ": responsive views, menu order, universal units, switching, persistence, backups and offline assets verified.",
      );
    }
  } finally {
    fs.writeFileSync(
      path.join(output, "checked-views.json"),
      JSON.stringify(checkedViews, null, 2),
    );
    fs.writeFileSync(
      path.join(output, "layout-issues.json"),
      JSON.stringify(layoutIssues, null, 2),
    );
    await browser.close();
  }
  assert.equal(
    layoutIssues.length,
    0,
    "Localized controls must fit their boxes; see layout-issues.json: " +
      JSON.stringify(layoutIssues.slice(0, 5)),
  );
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

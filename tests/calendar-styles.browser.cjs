"use strict";
const { chromium } = require("playwright"),
  fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  baseline = path.join(
    root,
    process.argv.includes("--original")
      ? "tests/fixtures/styles-calendar-contract.json.gz"
      : "tests/fixtures/styles-calendar-responsive-contract.json.gz",
  ),
  record = process.argv.includes("--record");
const reviewedButtonChange = require("./helpers/button-style-change.cjs");
const realm = vm.createContext({});
vm.runInContext(
  require("./helpers/core-source.cjs").readCoreSource() +
    ";globalThis.C=WorkTime",
  realm,
);
const state = realm.C.defaultState();
state.days["2026-09-14"] = {
  actual: {
    start: "08:00",
    end: "20:00",
    nextDay: false,
    effectiveMinutes: null,
  },
  leaveMinutes: 120,
};
state.days["2026-09-15"] = { leaveMinutes: 480 };
state.days["2026-09-16"] = {
  oa: {
    date: "2026-09-16",
    start: "08:00",
    end: "",
    nextDay: false,
    status: "pending",
    source: "fixture",
    raw: "09/16\n08:00",
  },
};
state.days["2026-10-01"] = {
  plannedOvertime: true,
  estimate: {
    start: "08:00",
    end: "20:00",
    nextDay: false,
    effectiveMinutes: null,
  },
};
const properties = [
  "display",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "color",
  "backgroundColor",
  "backgroundImage",
  "borderTopWidth",
  "borderTopColor",
  "borderRadius",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "height",
  "minHeight",
  "maxHeight",
  "width",
  "gap",
  "alignItems",
  "justifyContent",
  "transform",
  "textAlign",
  "letterSpacing",
  "overflowX",
  "overflowY",
  "gridTemplateColumns",
];
let browser;
(async () => {
  if (record && fs.existsSync(baseline))
    throw Error("Refusing to replace existing calendar baseline");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const samples = [];
  for (const width of [
    390, 540, 699, 850, 1150, 1151, 1300, 1301, 1600, 1800, 1920,
  ]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        timezoneId: "Asia/Shanghai",
        reducedMotion: "reduce",
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-09-15T12:00:00+08:00") });
    await page.addInitScript(
      (state) => {
        localStorage.setItem("worktime-local-v1", JSON.stringify(state));
        let seed = 123;
        Math.random = () =>
          ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      },
      JSON.parse(JSON.stringify(state)),
    );
    await page.goto(
      require("node:url").pathToFileURL(path.join(root, "index.html")).href,
    );
    await page.locator("#monthTitle").waitFor({ state: "visible" });
    async function navigate(date) {
      if (
        (await page.locator("#batchToggle").getAttribute("aria-pressed")) ===
        "true"
      )
        await page.locator("#batchToggle").click();
      if (
        (await page.locator("#monthTitle").getAttribute("aria-pressed")) !==
        "true"
      )
        await page.locator("#monthTitle").click();
      const year = Number(date.slice(0, 4));
      for (
        let current = Number(
          await page.locator(".month-title-year").textContent(),
        );
        current !== year;
        current += current < year ? 1 : -1
      )
        await page
          .locator(current < year ? "#nextMonth" : "#prevMonth")
          .click();
      await page.locator(`[data-year-date="${date}"]`).click();
    }
    for (const [mode, date] of [
      ["four-week", "2021-02-01"],
      ["five-week", "2026-09-15"],
      ["six-week", "2026-03-01"],
      ["decorated", "2026-10-01"],
      ["batch", "2026-09-01"],
      ["year", "2026-09-15"],
      ["leap-year", "2024-02-29"],
    ]) {
      await navigate(date);
      if (mode === "five-week") {
        assert.match(
          await page
            .locator('[data-date="2026-09-14"]')
            .getAttribute("aria-label"),
          /请假 2h/,
        );
        assert.match(
          await page
            .locator('[data-date="2026-09-15"]')
            .getAttribute("aria-label"),
          /全天请假/,
        );
      }
      if (mode === "batch") {
        await page.locator("#batchToggle").click();
        await page.locator('[data-date="2026-09-01"]').click();
      }
      if (mode === "year" || mode === "leap-year")
        await page.locator("#monthTitle").click();
      for (const height of [700, 1000]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => window.UIAlignment.refresh());
        await page.clock.fastForward(2000);
        await page.mouse.move(0, 0);
        const values = await page.evaluate((properties) => {
          document
            .querySelectorAll(".calendar .daystatus .pill")
            .forEach((e) => {
              if (!e.getClientRects().length) return;
              const cell = e.closest(".day").getBoundingClientRect(),
                box = e.getBoundingClientRect(),
                text = e.querySelector(".pill-text"),
                range = document.createRange();
              range.selectNodeContents(text);
              for (const r of [box, ...range.getClientRects()])
                if (
                  r.left < cell.left - 1 ||
                  r.right > cell.right + 1 ||
                  r.top < cell.top - 1 ||
                  r.bottom > cell.bottom + 1
                )
                  throw Error("Calendar status clipped: " + e.textContent);
              if (text.scrollWidth > text.clientWidth + 1)
                throw Error("Status text overflows pill: " + text.textContent);
            });
          if (
            document.querySelector(
              "#calendar .day.blank,.calendar-footer .dot.pending,.calendar-footer .dot.rest",
            )
          )
            throw Error("Obsolete month/legend structure reintroduced");
          const container = document
              .getElementById("calendar")
              .closest(".panel"),
            origin = container.getBoundingClientRect();
          return [...container.querySelectorAll("*"), container]
            .filter(
              (e) =>
                e.getClientRects().length &&
                getComputedStyle(e).visibility !== "hidden",
            )
            .map((e, i) => {
              const s = getComputedStyle(e),
                r = e.getBoundingClientRect(),
                classes =
                  typeof e.className === "string"
                    ? e.className
                    : e.className.baseVal;
              const pseudo = {};
              if (e.matches(".day,.daynum,.payday-icon,.year-day"))
                for (const type of ["::before", "::after"]) {
                  const p = getComputedStyle(e, type);
                  pseudo[type] = Object.fromEntries(
                    [
                      "content",
                      "display",
                      "backgroundImage",
                      "backgroundColor",
                      "borderRadius",
                      "transform",
                      "opacity",
                    ].map((k) => [k, p[k]]),
                  );
                }
              return {
                key: e.id || `${e.tagName}:${classes}:${i}`,
                styles: Object.fromEntries(properties.map((p) => [p, s[p]])),
                pseudo,
                rect: [r.width, r.height, r.x - origin.x, r.y - origin.y].map(
                  (n) => Math.round(n * 1000) / 1000,
                ),
              };
            });
        }, properties);
        samples.push({ width, height, mode, values });
      }
    }
    assert.equal(await page.locator("[data-year-date]").count(), 366);
    await page.locator('[data-year-date="2024-02-29"]').press("Enter");
    assert.equal(
      await page.locator('[data-date="2024-02-29"].selected').count(),
      1,
    );
    await page.locator('[data-date="2024-02-29"]').press("Space");
    assert.equal(
      await page.locator('[data-date="2024-02-29"].selected').count(),
      1,
    );
    assert.equal(
      await page
        .locator("#yearLegend")
        .evaluate((e) => e.classList.contains("hidden")),
      true,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log("Calendar style captured width " + width);
  }
  if (record)
    fs.writeFileSync(baseline, zlib.gzipSync(JSON.stringify(samples)));
  else {
    const old = JSON.parse(zlib.gunzipSync(fs.readFileSync(baseline))),
      differences = [];
    assert.equal(samples.length, old.length);
    samples.forEach((current, i) => {
      assert.equal(current.width, old[i].width);
      assert.equal(current.height, old[i].height);
      assert.equal(current.mode, old[i].mode);
      if (
        current.values.length !== old[i].values.length ||
        !current.values.every(
          (v, j) =>
            JSON.stringify(v) === JSON.stringify(old[i].values[j]) ||
            reviewedButtonChange(v, old[i].values[j], current, "calendar"),
        )
      )
        differences.push({
          width: current.width,
          height: current.height,
          mode: current.mode,
          before: old[i].values,
          after: current.values,
        });
    });
    fs.writeFileSync(
      path.join(root, "docs/calendar-style-differences.json"),
      JSON.stringify(differences, null, 2) + "\n",
    );
    assert.equal(
      differences.length,
      0,
      "Calendar styles changed; inspect differences",
    );
  }
  console.log(
    `${samples.length} calendar states ${record ? "recorded" : "unchanged"}.`,
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});

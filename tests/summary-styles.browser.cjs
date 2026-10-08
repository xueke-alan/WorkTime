"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  reference = require("./helpers/style-reference.cjs").create(
    "summary",
    "tests/fixtures/styles-summary-2026-10-08.json.gz",
  ),
  baseline = reference.baseline,
  record = process.argv.includes("--record") || reference.capture;
const realm = vm.createContext({});
vm.runInContext(reference.domainSource() + ";globalThis.C=DomainTest", realm);
const C = realm.C;
const properties = [
  "display",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "color",
  "backgroundColor",
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
    throw Error("Refusing to replace existing summary baseline");
  browser = await require("./helpers/browser.cjs").launchBrowser();
  const samples = [];
  for (const width of [
    390, 540, 699, 850, 1150, 1151, 1300, 1301, 1600, 1800, 1920,
  ]) {
    for (const mode of ["empty", "populated", "unconfigured", "historical"]) {
      const state = C.defaultState();
      if (mode === "unconfigured") state.settings.configured = false;
      if (["populated", "historical"].includes(mode)) {
        state.overtimeRequirements = [120, 150, 180, 210, 240];
        for (let day = 1; day <= 30; day++)
          state.days["2026-09-" + C.pad(day)] = {
            actual: {
              start: "08:00",
              end: "20:00",
              nextDay: false,
              effectiveMinutes: day % 3 ? 600 : 420,
            },
            leaveMinutes: day === 15 ? 240 : 0,
          };
      }
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        timezoneId: "Asia/Shanghai",
        reducedMotion: "reduce",
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.clock.install({
        time: new Date(
          mode === "historical"
            ? "2026-10-02T12:00:00+08:00"
            : "2026-09-15T12:00:00+08:00",
        ),
      });
      await page.addInitScript(
        (state) =>
          localStorage.setItem("worktime-local-v1", JSON.stringify(state)),
        JSON.parse(JSON.stringify(state)),
      );
      await reference.visit(page);
      await page.locator("#settingsOpen").waitFor({ state: "visible" });
      if (mode === "historical") await page.locator("#prevMonth").click();
      for (const height of [700, 1000]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => WorkTimeApp.ui.alignment.refresh());
        await page.clock.fastForward(3000);
        await page.mouse.move(0, 0);
        if (!reference.frozen) {
          const average = state.settings.configured
            ? (C.summary(state, "2026-09-01", "2026-09-30").average ?? 0) / 60
            : 0;
          assert.equal(
            await page
              .locator(".average-card .summary-number-accessible")
              .textContent(),
            average.toFixed(3),
            "Average uses three decimal places in every state and viewport",
          );
          assert.equal(
            await page.locator(".average-card small").textContent(),
            "h",
          );
        }
        const values = await page.evaluate((properties) => {
          if (
            document.querySelector(
              ".summary-sidebar .rangebar,.summary-sidebar .forecast,.summary-sidebar .target-metric-row",
            )
          )
            throw Error("Obsolete summary structure reintroduced");
          const container = document.querySelector(".summary-sidebar"),
            origin = container.getBoundingClientRect();
          return [...container.querySelectorAll("*"), container]
            .filter(
              (e) =>
                e.getClientRects().length &&
                getComputedStyle(e).visibility !== "hidden",
            )
            .map((e, i) => {
              const s = getComputedStyle(e),
                r = e.getBoundingClientRect();
              return {
                key: e.id || `${e.tagName}:${e.className}:${i}`,
                styles: Object.fromEntries(properties.map((p) => [p, s[p]])),
                rect: [r.width, r.height, r.x - origin.x, r.y - origin.y].map(
                  (n) => Math.round(n * 1000) / 1000,
                ),
              };
            });
        }, properties);
        samples.push({ width, height, mode, values });
      }
      if (mode === "populated") {
        await page.evaluate(() => {
          const state = WorkTimeApp.domain.state.defaultState();
          state.overtimeRequirements = [120, 150, 180, 210, 240];
          for (let day = 1; day <= 30; day++)
            state.days["2026-09-" + WorkTimeApp.domain.time.pad(day)] = {
              actual: {
                start: "08:00",
                end: "20:00",
                nextDay: false,
                effectiveMinutes: 2880,
              },
              leaveMinutes: day === 15 ? 1 : 0,
            };
          localStorage.setItem("worktime-local-v1", JSON.stringify(state));
        });
        // Avoid the ordinary page's seed script replacing the stress fixture on reload.
        await page.evaluate(() => {
          const state = JSON.parse(localStorage.getItem("worktime-local-v1"));
          const view = WorkTimeApp.ui.createSummary({
            core: {
              validDate: WorkTimeApp.domain.time.validDate,
              summary: WorkTimeApp.domain.statistics.summary,
              pendingWorkdays: (input, start, end, asOf) =>
                WorkTimeApp.domain.statistics.pendingWorkdays(
                  input,
                  start,
                  end,
                  asOf,
                  new Date(),
                ),
              selectOvertimeRequirement:
                WorkTimeApp.domain.statistics.selectOvertimeRequirement,
              targetPace: WorkTimeApp.domain.statistics.targetPace,
            },
            element: (id) => document.getElementById(id),
            escape: String,
            getState: () => state,
            getView: () => ({ today: "2026-09-15" }),
            getRange: () => ["2026-09-01", "2026-09-30"],
            isStorageFailed: () => false,
            document,
            window,
            numbers: WorkTimeApp.ui.numbers,
          });
          view.renderStats();
          WorkTimeApp.ui.alignment.refresh();
        });
        await page.clock.fastForward(2000);
        const collisions = await page.evaluate(() =>
          [...document.querySelectorAll(".summary-sidebar .card")].flatMap(
            (card) => {
              const label = card
                  .querySelector(".card-label")
                  .getBoundingClientRect(),
                metric = card.querySelector(".metric").getBoundingClientRect(),
                visual = card
                  .querySelector(".summary-number-visual")
                  ?.getBoundingClientRect();
              return visual &&
                visual.left < label.right - 1 &&
                visual.bottom > label.top &&
                visual.top < label.bottom
                ? [card.querySelector(".card-label").textContent]
                : metric.width <= 0
                  ? ["zero metric width"]
                  : [];
            },
          ),
        );
        assert.deepEqual(
          collisions,
          [],
          `Large valid numbers collide with labels at width ${width}`,
        );
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log("Summary style captured width " + width);
  }
  if (record)
    fs.writeFileSync(baseline, zlib.gzipSync(JSON.stringify(samples)));
  else {
    const previous = JSON.parse(zlib.gunzipSync(fs.readFileSync(baseline))),
      differences = [];
    assert.equal(samples.length, previous.length);
    samples.forEach((current, i) => {
      assert.equal(current.width, previous[i].width);
      assert.equal(current.height, previous[i].height);
      assert.equal(current.mode, previous[i].mode);
      if (
        current.values.length !== previous[i].values.length ||
        !current.values.every(
          (v, j) => JSON.stringify(v) === JSON.stringify(previous[i].values[j]),
        )
      )
        differences.push({
          width: current.width,
          height: current.height,
          mode: current.mode,
          before: previous[i].values,
          after: current.values,
        });
    });
    fs.writeFileSync(
      path.join(root, "test-results/summary-style-differences.json"),
      JSON.stringify(differences, null, 2) + "\n",
    );
    assert.equal(
      differences.length,
      0,
      "Summary style changed; inspect differences",
    );
  }
  console.log(
    `${samples.length} summary states ${record ? "recorded" : "unchanged"}.`,
  );
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await browser?.close();
  process.exitCode = 1;
});

"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

async function ready(page) {
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.appState === "ready" &&
      !document.documentElement.classList.contains("app-loading"),
  );
}
async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const output = path.resolve("test-results/source-priority");
  fs.mkdirSync(output, { recursive: true });
  try {
    const context = await browser.newContext({
      locale: "zh-CN",
      reducedMotion: "reduce",
      hasTouch: true,
    });
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
    await page.goto(pathToFileURL(path.resolve("index.html")).href);
    await ready(page);
    const seed = await page.evaluate(async () => {
      const {
          records: R,
          state: S,
          observations: O,
          validation: V,
        } = WorkTimeApp.domain,
        A = WorkTimeApp.services.archive,
        check = (value, message) => {
          if (!value) throw Error(message);
        },
        manual = {
          start: "09:00",
          end: "19:00",
          nextDay: false,
          effectiveMinutes: null,
        },
        oa = {
          date: "2026-10-08",
          start: "08:00",
          end: "17:30",
          nextDay: false,
          status: "complete",
          source: "test",
          raw: "",
        },
        both = { oa, actual: manual },
        resolve = (day) => R.effectiveRecord(day, true),
        minutes = (day) =>
          R.calculate(oa.date, day, S.defaultState().settings, true).minutes;
      check(
        resolve(both).start === "08:00" && minutes(both) === 480,
        "OA must be the default",
      );
      check(
        resolve({ ...both, sourcePriority: "manual" }).start === "09:00",
        "Manual priority",
      );
      const pending = {
        oa: { ...oa, end: "", status: "pending" },
        estimate: manual,
      };
      check(
        resolve(pending).start === "08:00" &&
          resolve(pending).end === "19:00" &&
          resolve(pending).filledEnd,
        "Fill missing end",
      );
      check(minutes(pending) === 540, "Merged duration");
      check(
        resolve({ oa: { ...oa, start: "" }, actual: manual }).filledStart,
        "Fill missing start",
      );
      const overnight = {
        oa: { ...oa, start: "20:00", end: "", status: "pending" },
        actual: { ...manual, end: "01:00", nextDay: true },
      };
      check(
        resolve(overnight).nextDay && minutes(overnight) === 300,
        "Next-day flag follows manual end",
      );
      check(
        !resolve({ ...overnight, oa }).nextDay,
        "OA end owns its next-day flag",
      );
      const draft = {
        ...both,
        draft: { start: "", end: "18:30", nextDay: false },
        sourcePriority: "manual",
      };
      check(
        resolve(draft).start === "" && minutes(draft) === null,
        "Draft must not revive old manual or OA clocks",
      );
      check(
        minutes({ ...draft, sourcePriority: "oa" }) === 480,
        "Draft must not suppress complete OA",
      );
      check(
        minutes({ ...pending, actual: { ...manual, effectiveMinutes: 0 } }) ===
          540,
        "Mixed clocks ignore manual correction",
      );
      check(
        minutes({ actual: { ...manual, effectiveMinutes: 0 } }) === 0,
        "Pure manual zero correction",
      );
      check(
        minutes({
          ...both,
          actual: { ...manual, effectiveMinutes: 0 },
          sourcePriority: "manual",
        }) === 0,
        "Manual priority zero correction",
      );
      check(
        minutes({
          oa: { ...oa, start: "20:00", end: "", status: "pending" },
          actual: manual,
        }) === null,
        "Invalid combined clocks cannot produce hours",
      );
      const untouched = R.editedDay(both, {
        start: oa.start,
        end: oa.end,
        nextDay: false,
        leaveMinutes: 60,
      });
      check(
        untouched.actual === manual,
        "Unchanged effective clocks must retain hidden manual data",
      );
      const initial = S.defaultState();
      initial.days[oa.date] = { ...pending, sourcePriority: "manual" };
      O.applyObservation(initial, oa, "test-import");
      check(
        !!initial.days[oa.date].estimate &&
          initial.days[oa.date].sourcePriority === "manual",
        "OA import must retain manual data and preference",
      );
      // No import link is needed for the standalone archive fixtures.
      delete initial.days[oa.date].oa.importId;
      const recovered = A.decode(A.encode(initial));
      check(
        recovered.days[oa.date].sourcePriority === "manual",
        "Archive round trip",
      );
      let rejected = false;
      try {
        V.validateBackup({
          ...initial,
          days: { [oa.date]: { ...both, sourcePriority: "invalid" } },
        });
      } catch (error) {
        rejected = error.path.endsWith(".sourcePriority");
      }
      check(rejected, "Reject invalid priority");
      const fields = {
        dayStart: { value: manual.start },
        dayEnd: { value: manual.end },
        dayNext: { checked: false },
        dayLeave: { value: "0", validity: { badInput: false } },
      };
      const editor = WorkTimeApp.ui.createDayController({
        core: { effectiveRecord: R.effectiveRecord, hours: () => "0" },
        element: (id) => fields[id],
        model: { selected: oa.date, state: { days: { [oa.date]: both } } },
        actions: {},
        application: {},
      });
      check(
        !editor.hasDraft(),
        "Saved hidden manual values are not unsaved edits",
      );
      fields.dayEnd.value = "20:00";
      check(editor.hasDraft(), "New manual clock must remain an unsaved edit");
      editor.dispose();
      const originalScope = WorkTimeApp.ui.createEventScope;
      WorkTimeApp.ui.createEventScope = () => ({
        handler: (element, name, handler) => {
          element[name] = handler;
        },
        listen() {},
        dispose() {},
      });
      try {
        for (const selected of [oa.date, "2026-10-09"]) {
          const elements = new Map();
          const element = (id) => {
            if (!elements.has(id)) elements.set(id, { value: "" });
            return elements.get(id);
          };
          let finish,
            editorRenders = 0;
          const resetEditor = () => {
            editorRenders++;
            element("dayStart").value = "08:00";
          };
          const controller = WorkTimeApp.ui.createNavigationController({
            core: {},
            model: { selected, batchMode: false },
            element,
            actions: {
              renderStats() {},
              renderCalendar() {},
              renderEditor: resetEditor,
              render: resetEditor,
            },
            application: {
              toggleSourcePriority: () =>
                new Promise((resolve) => {
                  finish = resolve;
                }),
            },
          });
          controller.bind();
          const source = { dataset: { sourceDate: oa.date } };
          element("dayStart").value = "09:";
          const pending = element("calendar").onclick({
            target: { closest: () => source },
          });
          check(
            editorRenders === (selected === oa.date ? 1 : 0),
            "Only the toggled date refreshes its editor",
          );
          element("dayStart").value = "10:";
          finish({ persisted: true });
          await pending;
          check(
            element("dayStart").value === "10:",
            "Source save completion preserves later typing",
          );
          controller.dispose();
        }
      } finally {
        WorkTimeApp.ui.createEventScope = originalScope;
      }
      const fixture = S.defaultState();
      fixture.days[oa.date] = { ...both, actual: { ...manual, end: "20:00" } };
      fixture.days["2026-10-09"] = {
        oa: { ...oa, date: "2026-10-09", end: "", status: "pending" },
        actual: manual,
      };
      fixture.days["2026-10-12"] = {
        ...draft,
        oa: { ...oa, date: "2026-10-12" },
      };
      let fail = false;
      const owner = WorkTimeApp.services.application.createState({
        state: fixture,
        persistence: { commit: async () => ({ persisted: !fail }) },
        core: {},
      });
      await owner.toggleSourcePriority(oa.date);
      check(
        owner.state.days[oa.date].sourcePriority === "manual" &&
          owner.state.days["2026-10-09"].sourcePriority === undefined,
        "Card isolation",
      );
      fail = true;
      check(
        !(await owner.toggleSourcePriority(oa.date)).persisted && owner.dirty,
        "Failed save remains retryable",
      );
      fail = false;
      await owner.retry();
      await owner.resetDay(oa.date);
      check(
        owner.state.days[oa.date].sourcePriority === undefined &&
          !!owner.state.days[oa.date].oa,
        "Reset restores OA default",
      );
      return fixture;
    });
    await context.close();

    const ui = await browser.newContext({
      locale: "zh-CN",
      reducedMotion: "reduce",
      hasTouch: true,
    });
    await ui.route(/^https?:/, (route) => route.abort());
    await ui.addInitScript((state) => {
      if (!sessionStorage.getItem("source-fixture")) {
        localStorage.setItem("worktime-local-v1", JSON.stringify(state));
        sessionStorage.setItem("source-fixture", "1");
      }
    }, seed);
    const view = await ui.newPage();
    view.on("pageerror", (error) => errors.push(error.message));
    await view.clock.setFixedTime(new Date("2026-10-21T04:00:00Z"));
    await view.goto(pathToFileURL(path.resolve("index.html")).href);
    await ready(view);
    const card = (date) => view.locator('.day[data-date="' + date + '"]'),
      first = card("2026-10-08"),
      second = card("2026-10-09"),
      toggle = first.locator(".source-toggle");
    assert.match(await first.locator(".daytime").textContent(), /08:00.*17:30/);
    assert.equal(await first.locator(".manual-time").count(), 0);
    assert.equal(await second.locator(".manual-time").textContent(), "19:00");
    assert.equal(
      await second.locator(".manual-time").evaluate((element) => {
        const reference = document.createElement("span");
        reference.style.color = "var(--amber)";
        element.append(reference);
        const expected = getComputedStyle(reference).color;
        reference.remove();
        return getComputedStyle(element).color === expected;
      }),
      true,
    );
    assert.match(
      await second.locator(".source-toggle").getAttribute("title"),
      /下班时间由手录补齐/,
    );
    assert.equal(await view.locator("button button").count(), 0);
    const selected = await view
      .locator(".day.selected")
      .getAttribute("data-date");
    await view.emulateMedia({ reducedMotion: "no-preference" });
    const dots = toggle.locator(".record-source-dot");
    assert.equal(await dots.count(), 2);
    for (const dot of await dots.all())
      assert.equal(await dot.isVisible(), true);
    const oaBefore = await toggle.locator(".oa").boundingBox();
    const manualBefore = await toggle.locator(".manual").boundingBox();
    assert.ok(oaBefore.x < manualBefore.x);
    await toggle.click();
    await view.waitForFunction(
      () =>
        document
          .querySelector('[data-source-date="2026-10-08"]')
          .getAttribute("aria-pressed") === "true",
    );
    assert.equal(
      await toggle.evaluate((node) =>
        [...node.querySelectorAll(".record-source-dot")].every(
          (dot) => dot.getAnimations().length > 0,
        ),
      ),
      true,
      "Both dots animate when the source priority changes",
    );
    await toggle.evaluate((node) =>
      Promise.all(node.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
    assert.equal(await dots.count(), 2);
    const oaAfter = await toggle.locator(".oa").boundingBox();
    const manualAfter = await toggle.locator(".manual").boundingBox();
    assert.ok(manualAfter.x < oaAfter.x);
    const rapidSwitch = await toggle.evaluate(async (node) => {
      node.click();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const dots = [...node.children],
        positions = dots.map((dot) => getComputedStyle(dot).transform);
      node.click();
      const continuous = dots.every(
        (dot, index) =>
          dot.getAnimations()[0]?.effect.getKeyframes()[0].transform ===
          positions[index],
      );
      await Promise.all(
        node
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      );
      return { continuous, priority: node.getAttribute("aria-pressed") };
    });
    assert.deepEqual(rapidSwitch, { continuous: true, priority: "true" });
    await view.emulateMedia({ reducedMotion: "reduce" });
    assert.match(await first.locator(".daytime").textContent(), /09:00.*20:00/);
    assert.equal(
      await view.locator(".day.selected").getAttribute("data-date"),
      selected,
    );
    assert.equal(
      await second.locator(".source-toggle").getAttribute("aria-pressed"),
      "false",
    );
    await toggle.focus();
    await view.keyboard.press("Enter");
    await view.waitForFunction(
      () =>
        document
          .querySelector('[data-source-date="2026-10-08"]')
          .getAttribute("aria-pressed") === "false",
    );
    assert.equal(
      await toggle.evaluate((node) => node === document.activeElement),
      true,
    );
    assert.equal(
      await toggle.evaluate(
        (node) => node.getAnimations({ subtree: true }).length,
      ),
      0,
      "Reduced motion switches order without animation",
    );
    await view.keyboard.press("Space");
    await view.waitForFunction(
      () =>
        document
          .querySelector('[data-source-date="2026-10-08"]')
          .getAttribute("aria-pressed") === "true",
    );
    // Source order updates optimistically. Reload only after the queued archive
    // transaction has completed, including on slower CI storage backends.
    await view.waitForFunction(
      () =>
        document.querySelector("#storageUsage").textContent !==
        WorkTimeApp.i18n.t("copy.9ca32f988d"),
    );
    await view.reload();
    await ready(view);
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    assert.match(await first.locator(".daytime").textContent(), /09:00.*20:00/);
    assert.equal(
      await card("2026-10-12").locator(".day-total-hours").count(),
      0,
    );
    assert.match(await first.locator(".day-total-hours").textContent(), /9.00/);
    const totals = await view
      .locator("#cards .card")
      .filter({ has: view.locator('.card-label[title="总工时"]') })
      .locator(".metric")
      .textContent();
    assert.match(totals.replace(/\s/g, ""), /18.00/);
    // Touch changes the source without changing the selected card.
    await toggle.tap();
    await view.waitForFunction(
      () =>
        document
          .querySelector('[data-source-date="2026-10-08"]')
          .getAttribute("aria-pressed") === "false",
    );
    assert.match(await first.locator(".day-total-hours").textContent(), /8.00/);
    await view.locator("#batchToggle").click();
    const batchBefore = await view.locator(".day.batchselected").count();
    assert.equal(await toggle.isDisabled(), true);
    assert.equal(await view.locator(".day.batchselected").count(), batchBefore);
    for (const width of [1440, 390, 320]) {
      await view.setViewportSize({ width, height: 1000 });
      const fits = await toggle.evaluate((node) => {
        const dot = node.getBoundingClientRect(),
          box = node.closest(".day").getBoundingClientRect();
        return (
          dot.left >= box.left &&
          dot.right <= box.right &&
          dot.top >= box.top &&
          dot.bottom <= box.bottom
        );
      });
      assert.equal(fits, true, "Source control fits at " + width);
      await view.screenshot({
        path: path.join(output, "calendar-" + width + ".png"),
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    await ui.close();
    console.log(
      "Source resolution, archive persistence, independent mouse/touch/keyboard controls, refresh and compact layouts verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";
const setScheduleRange = require("./lib/agenda-test-range.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(process.argv[2] || ".");
async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      locale: "zh-CN",
      viewport: { width: 1480, height: 1000 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.appState === "ready" &&
        !document.documentElement.classList.contains("app-loading"),
    );
    await page.locator("#agendaMode").click();
    const create = async (title, date, note = "") => {
      if (
        await page
          .locator("#agendaSchedulePopup")
          .evaluate((node) => node.matches(":popover-open"))
      )
        await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill(title);
      await page.locator("#agendaScheduleOpen").click();
      await setScheduleRange(page, date);
      await page.locator("#agendaNote").fill(note);
      if (
        await page
          .locator("#agendaSchedulePopup")
          .evaluate((node) => node.matches(":popover-open"))
      )
        await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.waitForFunction(
        (value) =>
          document.querySelector("#agendaTitle").value === "" &&
          (document.querySelector("#calendar .day.selected").dataset.date ||
            document.querySelector("#calendar .day.selected").dataset
              .previewDate) === value,
        date,
      );
    };
    const visibleDates = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("#calendar > .day")]
          .filter((card) => getComputedStyle(card).display !== "none")
          .map((card) => card.dataset.date || card.dataset.previewDate),
      );
    const setView = async (view) => {
      for (let index = 0; index < 4; index++) {
        if (
          (await page
            .locator("#agendaViewToggle")
            .evaluate(
              (node) =>
                ["month", "week", "fortnight", "threeweek"][
                  Number(node.dataset.agendaView)
                ],
            )) === view
        )
          return;
        await page.evaluate(() => {
          document.querySelector("#agendaViewToggle").click();
        });
      }
      assert.equal(
        await page
          .locator("#agendaViewToggle")
          .evaluate(
            (node) =>
              ["month", "week", "fortnight", "threeweek"][
                Number(node.dataset.agendaView)
              ],
          ),
        view,
      );
    };
    const settled = () =>
      page.waitForFunction(
        () =>
          !document.querySelector(".agenda-week-leaving") &&
          !document.querySelector(".agenda-week-snapshot") &&
          !document
            .querySelector("#calendar")
            .getAnimations({ subtree: true })
            .some((animation) =>
              animation.effect?.target?.matches(
                "#calendar, .day, .agenda-chip, .agenda-chip-note",
              ),
            ),
      );
    while (!(await page.locator('[data-date="2026-11-01"]').count())) {
      const month = await page
        .locator("#calendar [data-date]")
        .first()
        .getAttribute("data-date");
      await page
        .locator(month < "2026-11" ? "#nextMonth" : "#prevMonth")
        .click();
    }
    await create("跨月安排", "2026-11-01");
    const monthLabel = await page.locator("#monthTitle").textContent();
    await page
      .locator('[data-preview-date="2026-10-31"] .day-select')
      .click({ position: { x: 8, y: 8 } });
    assert.equal(
      await page
        .locator('#calendar [data-date="2026-11-01"] .agenda-chip')
        .count(),
      1,
      "Month selection keeps the current month and its events",
    );
    assert.equal(await page.locator("#monthTitle").textContent(), monthLabel);
    assert.equal(
      await page
        .locator('#calendar [data-preview-date="2026-10-31"].selected')
        .count(),
      1,
      "Selecting a previous-month card does not switch month views",
    );
    await page
      .locator('[data-date="2026-11-01"] .day-select')
      .click({ position: { x: 8, y: 8 } });
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 1);
    await page.evaluate(() => {
      window.monthCards = new Map(
        [...document.querySelectorAll("#calendar > .day")].map((card) => [
          card.dataset.date || card.dataset.previewDate,
          card,
        ]),
      );
      window.sharedWeekdays = document.querySelector(
        "#panelContent > .weekdays",
      );
      window.monthCardHeight = document
        .querySelector("#calendar .day.selected")
        .getBoundingClientRect().height;
    });
    await setView("week");
    assert.equal(
      await page
        .locator(".month-title-week-label .summary-number-accessible")
        .textContent(),
      "w1",
    );
    assert.equal(
      await page
        .locator("#monthTitleWeek .month-title-divider path")
        .getAttribute("d"),
      await page
        .locator("#monthTitle > .month-title-divider path")
        .getAttribute("d"),
    );
    assert.deepEqual(await visibleDates(), [
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    const weekLabel = await page.locator("#monthTitle").textContent();
    await page.evaluate(() => {
      window.crossMonthMotions = [];
      window.crossMonthPlay = WorkTimeApp.ui.motion.play;
      WorkTimeApp.ui.motion.play = function (element, name, ...args) {
        if (element?.id === "calendar") window.crossMonthMotions.push(name);
        return window.crossMonthPlay.call(this, element, name, ...args);
      };
    });
    await page
      .locator('[data-preview-date="2026-10-30"] .day-select')
      .click({ position: { x: 8, y: 8 } });
    assert.deepEqual(
      await page.evaluate(() => window.crossMonthMotions),
      [],
      "Selecting a previous-month date within the week does not animate navigation",
    );
    assert.equal(await page.locator("#monthTitle").textContent(), weekLabel);
    assert.equal(
      await page
        .locator('#calendar [data-preview-date="2026-10-30"].selected')
        .count(),
      1,
      "Selection keeps the displayed month and adjacent card",
    );
    await page
      .locator('[data-date="2026-11-01"] .day-select')
      .click({ position: { x: 8, y: 8 } });
    assert.deepEqual(await page.evaluate(() => window.crossMonthMotions), []);
    await page.evaluate(() => {
      WorkTimeApp.ui.motion.play = window.crossMonthPlay;
    });
    assert.equal(
      await page.evaluate(
        () =>
          [
            ...document.querySelectorAll("#calendar > [data-agenda-week]"),
          ].every(
            (card) =>
              window.monthCards.get(
                card.dataset.date || card.dataset.previewDate,
              ) === card,
          ) &&
          window.sharedWeekdays ===
            document.querySelector("#panelContent > .weekdays"),
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        () =>
          document
            .querySelector("#calendar .day.selected")
            .getBoundingClientRect().height >
          window.monthCardHeight * 3,
      ),
      true,
      "Selected week fills the calendar height",
    );
    assert.equal(
      await page
        .locator("#agendaViewToggle")
        .evaluate(
          (node) =>
            ["month", "week", "fortnight", "threeweek"][
              Number(node.dataset.agendaView)
            ],
        ),
      "week",
    );
    assert.equal(
      await page.locator("#prevMonth").getAttribute("aria-label"),
      "上一周",
    );
    for (let index = 0; index < 3; index++)
      await create("本周事项 " + index, "2026-11-01");
    assert.equal(
      await page.locator("#calendar .agenda-week-layers .agenda-chip").count(),
      4,
      "Week cards show every event",
    );
    assert.equal(
      await page.locator("#calendar .day.selected .agenda-more").count(),
      0,
    );
    // Navigate through a selectable adjacent-month day and back.
    await page.locator("#prevMonth").click();
    await create("十月安排", "2026-10-31");
    const adjacent = page.locator('[data-preview-date="2026-11-01"]');
    for (const selected of [false, true]) {
      await adjacent.evaluate((card, selected) => {
        card.classList.toggle("selected", selected);
      }, selected);
      await adjacent.hover({ position: { x: 8, y: 8 } });
      const { actual, expected } = await adjacent.evaluate((card) => {
        const properties = [
          "borderTopWidth",
          "borderTopStyle",
          "borderTopColor",
          "boxShadow",
          "opacity",
          "pointerEvents",
        ];
        const read = () =>
          properties.map((property) => getComputedStyle(card)[property]);
        const actual = read();
        card.classList.remove("adjacent");
        const expected = read();
        card.classList.add("adjacent");
        return { actual, expected };
      });
      assert.deepEqual(
        actual,
        expected,
        "Adjacent week cards share normal hover and selection borders",
      );
    }
    await adjacent.evaluate((card) => card.classList.remove("selected"));
    await page
      .locator('[data-preview-date="2026-11-01"] .day-select')
      .click({ position: { x: 8, y: 8 } });
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 4);
    await page.locator("#nextMonth").click();
    assert.equal((await visibleDates())[0], "2026-11-02");
    assert.equal(
      await page
        .locator(".month-title-week-label .summary-number-accessible")
        .textContent(),
      "w2",
    );
    await page.locator("#prevMonth").click();
    assert.equal((await visibleDates())[0], "2026-10-26");
    await page.locator("#agendaNew").click();
    await page.locator("#agendaTitle").fill("保留草稿");
    await setView("month");
    await setView("week");
    assert.equal(await page.locator("#agendaTitle").inputValue(), "保留草稿");
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaCancel").click();
    await create("跨年安排", "2026-01-01");
    assert.deepEqual(await visibleDates(), [
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
    const noteText = "准备会议资料\n确认参与人 <script>plain text</script>";
    await create("居中展开", "2026-11-15", noteText);
    await setView("month");
    assert.equal(await page.locator("#calendar .agenda-chip-note").count(), 0);
    assert.equal(
      await page.locator("#calendar .day.selected .agenda-chip").textContent(),
      "居中展开",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      window.weekAnimations = [];
      window.weekLabelAnimations = [];
      window.weekNavigationAnimations = [];
      window.noteAnimations = [];
      window.weekNativeAnimate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (
          this.id === "calendar" ||
          this.classList.contains("agenda-week-snapshot")
        )
          window.weekNavigationAnimations.push({
            snapshot: this.classList.contains("agenda-week-snapshot"),
            frames,
            options,
          });
        if (this.matches(".agenda-chip, .agenda-chip-note"))
          window.noteAnimations.push({
            note: this.matches(".agenda-chip-note"),
            frames,
            options,
          });
        if (this.matches(".day"))
          window.weekAnimations.push({
            date: this.dataset.date || this.dataset.previewDate,
            frames,
            duration: options.duration,
          });
        if (this.matches(".month-title-week-label"))
          window.weekLabelAnimations.push({
            frames,
            duration: options.duration,
          });
        return window.weekNativeAnimate.call(this, frames, options);
      };
    });
    await setView("week");
    assert.equal(
      await page
        .locator("#calendar .agenda-week-layers .agenda-chip-note")
        .textContent(),
      noteText,
    );
    assert.equal(
      await page.locator("#calendar .agenda-chip script").count(),
      0,
    );
    const noteMotion = await page.evaluate(() => window.noteAnimations);
    const grow = noteMotion.find((item) => !item.note);
    const fade = noteMotion.find((item) => item.note);
    assert.ok(
      parseFloat(grow.frames[0].height) < parseFloat(grow.frames[1].height),
    );
    assert.equal(fade.options.delay || 0, grow.options.delay || 0);
    assert.equal(fade.options.duration, grow.options.duration);
    assert.equal(fade.frames[0].opacity, 0);
    assert.equal(fade.frames[1].opacity, 1);
    const opening = await page.evaluate(() => window.weekAnimations);
    assert.equal(
      await page
        .locator(".month-title-week-label .summary-number-accessible")
        .textContent(),
      "w3",
    );
    assert.ok(
      await page.evaluate(() =>
        window.weekLabelAnimations.some(
          (animation) =>
            animation.duration === 220 && animation.frames[0].opacity < 1,
        ),
      ),
      "Week suffix animates on appearance",
    );
    const expanding = opening.filter((item) => item.frames[0].height);
    assert.equal(expanding.length, 7);
    assert.ok(
      expanding.every(
        (item) =>
          parseFloat(item.frames[0].height) < parseFloat(item.frames[1].height),
      ),
    );
    const leaving = opening.filter((item) =>
      opening.some(
        (fade) => fade.date === item.date && fade.frames[1].opacity === 0,
      ),
    );
    assert.ok(
      leaving.some((item) => /translateY\(-/.test(item.frames[1].transform)),
      "Rows above the week move upward",
    );
    assert.ok(
      leaving.some((item) =>
        /translateY\([\d.]/.test(item.frames[1].transform),
      ),
      "Rows below the week move downward",
    );
    await settled();
    const titleGeometry = await page.evaluate(() => {
      WorkTimeApp.ui.alignment.refresh();
      const title = document.querySelector("#monthTitle");
      const year = title
        .querySelector(".month-title-year")
        .getBoundingClientRect();
      const month = title
        .querySelector(".month-title-month")
        .getBoundingClientRect();
      const label = title
        .querySelector(".month-title-week-label")
        .getBoundingClientRect();
      const dividers = [...title.querySelectorAll(".month-title-divider")];
      const [first, second] = dividers.map((node) =>
        node.getBoundingClientRect(),
      );
      window.agendaWeekSlash = dividers[1];
      window.agendaWeekSlashRect = {
        x: second.x,
        y: second.y,
        width: second.width,
        height: second.height,
      };
      return {
        gaps: [
          first.left - year.right,
          month.left - first.right,
          second.left - month.right,
          label.left - second.right,
        ],
        tops: [year.top, month.top, label.top],
      };
    });
    assert.ok(
      Math.max(...titleGeometry.gaps) - Math.min(...titleGeometry.gaps) < 0.6,
      "Year, month, slash and week use equal spacing",
    );
    assert.ok(
      Math.max(...titleGeometry.tops) - Math.min(...titleGeometry.tops) < 0.6,
      "Week text aligns vertically with year and month",
    );
    await page.locator("#nextMonth").click();
    const navigation = await page.evaluate(
      () => window.weekNavigationAnimations,
    );
    assert.ok(
      navigation.some(
        (item) =>
          !item.snapshot &&
          item.options.duration === 320 &&
          /^translateY\([\d.]+px\)$/.test(item.frames[0].transform) &&
          item.frames[1].transform === "translateY(0px)" &&
          item.frames.every((frame) => frame.opacity === undefined),
      ),
      "Week navigation uses the shared opaque vertical slide",
    );
    assert.equal(await page.locator(".agenda-week-snapshot").count(), 0);
    assert.ok(
      (await page.locator(".month-title-week-label .number-roll-up").count()) >
        0,
      "Week number uses shared rolling digits",
    );
    assert.equal(
      await page
        .locator(".month-title-week-label .summary-number-accessible")
        .textContent(),
      "w4",
    );
    assert.equal(
      await page.evaluate(() => {
        const slash = document.querySelector(
          "#monthTitleWeek .month-title-divider",
        );
        const rect = slash.getBoundingClientRect(),
          before = window.agendaWeekSlashRect;
        return (
          slash === window.agendaWeekSlash &&
          !slash.getAnimations().length &&
          !slash.parentElement.getAnimations().length &&
          ["x", "y", "width", "height"].every(
            (key) => Math.abs(rect[key] - before[key]) < 0.6,
          )
        );
      }),
      true,
      "The week slash stays stationary during number changes",
    );
    await page.locator("#prevMonth").click();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          ".month-title-week-label .number-roll-up, .month-title-week-label .number-roll-down",
        ),
    );
    await page
      .locator("#calendar .agenda-week-layers .agenda-chip-note")
      .click();
    assert.equal(await page.locator("#agendaTitle").inputValue(), "居中展开");
    assert.equal(await page.locator("#agendaNote").inputValue(), noteText);
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaCancel").click();
    fs.mkdirSync(path.resolve("artifacts"), { recursive: true });
    await page.screenshot({
      path: path.resolve("artifacts/agenda-week-desktop.png"),
    });
    await setView("fortnight");
    await settled();
    assert.equal((await visibleDates()).length, 14);
    const beforePaging = await visibleDates();
    await page.locator("#nextMonth").click();
    assert.equal(
      await page.locator("#calendar > .day[data-agenda-week]").count(),
      14,
    );
    await page.locator("#prevMonth").click();
    await settled();
    assert.deepEqual(await visibleDates(), beforePaging);
    await page.evaluate(() => {
      document.querySelector("#nextMonth").click();
      document.querySelector("#nextMonth").click();
      document.querySelector("#prevMonth").click();
    });
    assert.equal(await page.locator(".agenda-week-snapshot").count(), 0);
    assert.equal((await visibleDates())[0], beforePaging[7]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => !document.querySelector(".agenda-week-snapshot"),
    );
    assert.equal((await visibleDates())[0], beforePaging[7]);
    await page.setViewportSize({ width: 1480, height: 1000 });
    await page.locator("#prevMonth").click();
    await settled();
    assert.deepEqual(await visibleDates(), beforePaging);
    await page
      .locator("#calendar .agenda-week-layers .agenda-chip-title")
      .click();
    assert.equal(await page.locator("#agendaTitle").inputValue(), "居中展开");
    if (
      await page
        .locator("#agendaSchedulePopup")
        .evaluate((node) => node.matches(":popover-open"))
    )
      await page.locator("[data-schedule-close]").click();
    await page.locator("#agendaCancel").click();
    await setView("threeweek");
    await settled();
    await page.evaluate(() => {
      window.weekAnimations = [];
      window.agendaHeaderSamples = [];
      const start = performance.now();
      const sample = () => {
        window.agendaHeaderSamples.push(
          [
            "#monthTitleYear",
            "#monthTitle > .month-title-divider",
            "#monthTitleMonth",
          ].map((selector) => {
            const rect = document
              .querySelector(selector)
              .getBoundingClientRect();
            return { x: rect.x + scrollX, y: rect.y + scrollY };
          }),
        );
        if (performance.now() - start < 500) requestAnimationFrame(sample);
      };
      sample();
    });
    await setView("month");
    assert.equal(
      await page.locator("#monthTitleWeek").isVisible(),
      true,
      "Week suffix remains mounted during its own exit animation",
    );
    const closing = await page.evaluate(() =>
      window.weekAnimations.filter((item) => item.frames[0].height),
    );
    assert.equal(closing.length, 21);
    assert.ok(
      closing.every(
        (item) =>
          parseFloat(item.frames[0].height) > parseFloat(item.frames[1].height),
      ),
    );
    await settled();
    const headerSamples = await page.evaluate(() => window.agendaHeaderSamples);
    for (const sample of headerSamples)
      sample.forEach((rect, index) => {
        assert.ok(Math.abs(rect.x - headerSamples[0][index].x) < 0.7);
        assert.ok(Math.abs(rect.y - headerSamples[0][index].y) < 0.7);
      });
    assert.equal(await page.locator("#monthTitleWeek").isHidden(), true);
    await page.evaluate(() => {
      for (let index = 0; index < 3; index++) {
        for (
          let step = 0;
          step < 4 &&
          ["month", "week", "fortnight", "threeweek"][
            Number(
              document.querySelector("#agendaViewToggle").dataset.agendaView,
            )
          ] !== "week";
          step++
        )
          document.querySelector("#agendaViewToggle").click();
        for (
          let step = 0;
          step < 4 &&
          ["month", "week", "fortnight", "threeweek"][
            Number(
              document.querySelector("#agendaViewToggle").dataset.agendaView,
            )
          ] !== "month";
          step++
        )
          document.querySelector("#agendaViewToggle").click();
      }
    });
    await settled();
    assert.ok((await visibleDates()).length >= 28);
    await setView("week");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await settled();
    assert.equal((await visibleDates()).length, 7);
    for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
      await page.evaluate((id) => WorkTimeApp.i18n.setLanguage(id), language);
      assert.equal(
        await page.locator("#agendaViewToggle").getAttribute("aria-label"),
        await page.evaluate(
          () =>
            WorkTimeApp.i18n.t("agenda.weekView") +
            " · " +
            WorkTimeApp.i18n.t("agenda.switchView", {
              view: WorkTimeApp.i18n.t("agenda.fortnightView"),
            }),
        ),
      );
      assert.equal((await visibleDates()).length, 7);
    }
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
        await page.evaluate((id) => WorkTimeApp.i18n.setLanguage(id), language);
        assert.equal(
          await page.locator("#monthTitle").evaluate((title) => {
            const month = title.querySelector(".month-title-month");
            const columns = [
              ...month.querySelectorAll(".summary-number-column"),
            ];
            const tops = columns.map(
              (column) => column.getBoundingClientRect().top,
            );
            const label = title.querySelector(".month-title-week-label");
            return (
              Math.max(...tops) - Math.min(...tops) < 1 &&
              label.getBoundingClientRect().right <=
                title.getBoundingClientRect().right + 1
            );
          }),
          true,
          `Month and week suffix fit without wrapping at ${width}px in ${language}`,
        );
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      const bounds = await page.locator("#agendaViewToggle").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.equal((await visibleDates()).length, 7);
    }
    await page.screenshot({
      path: path.resolve("artifacts/agenda-week-mobile.png"),
      fullPage: true,
    });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      Element.prototype.animate = undefined;
      for (
        let step = 0;
        step < 4 &&
        ["month", "week", "fortnight", "threeweek"][
          Number(document.querySelector("#agendaViewToggle").dataset.agendaView)
        ] !== "month";
        step++
      )
        document.querySelector("#agendaViewToggle").click();
    });
    await settled();
    assert.ok((await visibleDates()).length >= 28);
    await page.evaluate(() => {
      for (
        let step = 0;
        step < 4 &&
        ["month", "week", "fortnight", "threeweek"][
          Number(document.querySelector("#agendaViewToggle").dataset.agendaView)
        ] !== "week";
        step++
      )
        document.querySelector("#agendaViewToggle").click();
    });
    await settled();
    assert.equal((await visibleDates()).length, 7);
    await page.evaluate(() => {
      Element.prototype.animate = window.weekNativeAnimate;
    });
    // The month ends in the anchor week: the following full week must be
    // generated by the shared adjacent-day component and slide up into row two.
    await page.setViewportSize({ width: 1480, height: 1000 });
    await create("月底双周", "2026-11-30");
    await settled();
    await page.evaluate(() => {
      window.weekAnimations = [];
      Element.prototype.animate = function (frames, options) {
        if (this.matches(".day"))
          window.weekAnimations.push({
            date: this.dataset.date || this.dataset.previewDate,
            frames,
            duration: options.duration,
          });
        return window.weekNativeAnimate.call(this, frames, options);
      };
      window.anchorCards = new Map(
        [...document.querySelectorAll("#calendar > [data-agenda-week]")].map(
          (card) => [card.dataset.date || card.dataset.previewDate, card],
        ),
      );
    });
    await page.evaluate(() => {
      document.querySelector("#agendaViewToggle").click();
    });
    assert.equal(
      await page
        .locator("#agendaViewToggle")
        .evaluate(
          (node) =>
            ["month", "week", "fortnight", "threeweek"][
              Number(node.dataset.agendaView)
            ],
        ),
      "fortnight",
    );
    const fortnightDates = await visibleDates();
    assert.equal(fortnightDates.length, 14);
    assert.equal(fortnightDates[0], "2026-11-30");
    assert.equal(fortnightDates[13], "2026-12-13");
    assert.equal(
      await page
        .locator(".month-title-week-label .summary-number-accessible")
        .textContent(),
      "w6-7",
    );
    assert.equal(
      await page.evaluate(() =>
        [...window.anchorCards].every(
          ([date, card]) =>
            [...document.querySelectorAll("#calendar > .day")].find(
              (day) => (day.dataset.date || day.dataset.previewDate) === date,
            ) === card,
        ),
      ),
      true,
    );
    const incoming = await page.evaluate(() =>
      window.weekAnimations.filter(
        (item) =>
          item.date >= "2026-12-07" &&
          item.date <= "2026-12-13" &&
          item.frames[0].transform,
      ),
    );
    assert.equal(incoming.length, 7);
    assert.ok(
      incoming.every((item) =>
        /translateY\([\d.]/.test(item.frames[0].transform),
      ),
      "The next month's week enters upward from below",
    );
    await settled();
    assert.equal(await page.locator("#agendaViewToggle").count(), 1);
    assert.equal(
      await page
        .locator("#agendaWeek, #agendaMonth, .agenda-view-buttons")
        .count(),
      0,
    );
    await page.screenshot({
      path: path.resolve("artifacts/agenda-fortnight-desktop.png"),
    });
    for (const language of ["en", "zh-TW", "zh-HK", "ja", "ko", "zh-CN"]) {
      await page.evaluate((id) => WorkTimeApp.i18n.setLanguage(id), language);
      assert.equal(
        await page.locator("#agendaViewToggle").getAttribute("aria-label"),
        await page.evaluate(
          () =>
            WorkTimeApp.i18n.t("agenda.fortnightView") +
            " · " +
            WorkTimeApp.i18n.t("agenda.switchView", {
              view: WorkTimeApp.i18n.t("agenda.threeWeekView"),
            }),
        ),
      );
      assert.equal((await visibleDates()).length, 14);
    }
    await page
      .locator('[data-preview-date="2026-12-07"] .day-select')
      .click({ position: { x: 8, y: 8 } });
    assert.deepEqual(await visibleDates(), fortnightDates);
    assert.equal(
      await page
        .locator("#calendar .day.selected")
        .getAttribute("data-preview-date"),
      "2026-12-07",
    );
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2026-12-07",
    );
    assert.equal(
      await page
        .locator(".month-title-week-label .summary-number-accessible")
        .textContent(),
      "w6-7",
    );
    await create("次月安排", "2026-12-08");
    assert.equal(await page.locator("#agendaList .agenda-item").count(), 1);
    assert.deepEqual(await visibleDates(), fortnightDates);
    await page.locator("#nextMonth").click();
    const nextFortnight = await visibleDates();
    assert.equal(nextFortnight[0], "2026-12-07");
    assert.equal(nextFortnight[13], "2026-12-20");
    await page
      .locator('[data-date="2026-12-14"] .day-select')
      .click({ position: { x: 8, y: 8 } });
    assert.deepEqual(await visibleDates(), nextFortnight);
    assert.equal(
      await page.locator("#agendaDateInput").inputValue(),
      "2026-12-14",
    );
    assert.equal(
      await page
        .locator(".month-title-week-label .summary-number-accessible")
        .textContent(),
      "w2-3",
    );
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      assert.equal((await visibleDates()).length, 14);
      const rows = await page
        .locator("#calendar > [data-agenda-week]")
        .evaluateAll((cards) => [
          ...new Set(
            cards.map((card) => Math.round(card.getBoundingClientRect().top)),
          ),
        ]);
      assert.equal(rows.length, 2);
    }
    await page.screenshot({
      path: path.resolve("artifacts/agenda-fortnight-mobile.png"),
      fullPage: true,
    });
    await page.locator("#agendaMode").click();
    assert.equal(
      await page
        .locator("#calendar")
        .evaluate((node) => node.classList.contains("agenda-week-view")),
      false,
    );
    assert.equal(await page.locator("#dayForm").isVisible(), true);
    assert.equal(await page.locator("#monthTitleWeek").isVisible(), false);
    const reopen = async () => {
      await page.reload();
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
    };
    // Remember the attendance/agenda mode as well as the last agenda range.
    await reopen();
    assert.equal(await page.locator("#dayForm").isVisible(), true);
    await page.locator("#agendaMode").click();
    await settled();
    assert.equal((await visibleDates()).length, 14);
    for (const [view, count] of [
      ["month", 0],
      ["week", 7],
      ["fortnight", 14],
      ["threeweek", 21],
    ]) {
      await setView(view);
      await reopen();
      assert.equal(
        await page.locator("#agendaMode").getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(
        await page
          .locator("#agendaViewToggle")
          .evaluate(
            (node) =>
              ["month", "week", "fortnight", "threeweek"][
                Number(node.dataset.agendaView)
              ],
          ),
        view,
      );
      if (count) assert.equal((await visibleDates()).length, count);
      else assert.ok((await visibleDates()).length >= 28);
    }
    await page.evaluate(() =>
      localStorage.setItem(
        "worktime.calendarView",
        '{"mode":"agenda","weeks":99}',
      ),
    );
    await reopen();
    assert.equal(await page.locator("#dayForm").isVisible(), true);
    await page.evaluate(() =>
      localStorage.setItem("worktime.calendarView", "{broken"),
    );
    await reopen();
    assert.equal(await page.locator("#dayForm").isVisible(), true);
    await page.setViewportSize({ width: 1480, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#agendaMode").click();
    await setView("month");
    const capacities = [];
    for (const [date, rows] of [
      ["2027-02-08", "4"],
      ["2026-08-03", "6"],
    ]) {
      for (let index = 0; index < 8; index++)
        await create("容量测试 " + index, date);
      assert.equal(
        await page.locator("#calendar").getAttribute("data-weeks"),
        rows,
      );
      const visible = page.locator(
        "#calendar .day.selected .agenda-chip:not([hidden])",
      );
      const count = await visible.count();
      capacities.push(count);
      assert.ok(count > 0 && count < 8);
      assert.equal(
        await page
          .locator("#calendar .day.selected .agenda-more")
          .textContent(),
        await page.evaluate(
          (count) => WorkTimeApp.i18n.number(count) + "+",
          8 - count,
        ),
      );
      assert.equal(
        await page
          .locator("#calendar .day.selected .agenda-card-items")
          .evaluate((host) =>
            [...host.children]
              .filter((child) => !child.hidden)
              .every(
                (child) =>
                  child.getBoundingClientRect().bottom <=
                  host.getBoundingClientRect().bottom + 1,
              ),
          ),
        true,
      );
    }
    assert.ok(
      capacities[0] > capacities[1],
      "Four-row months fit more events than six-row months",
    );
    assert.deepEqual(errors, []);
    console.log(
      "Agenda month/week/fortnight cycling, card reuse, cross-month/year dates, all events, weekly navigation, expanding/fading animation, interruption, six languages and mobile layout verified.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

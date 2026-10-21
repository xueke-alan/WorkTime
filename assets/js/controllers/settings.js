"use strict";
/** settings controller. Instantiate once, then bind after all actions are connected. */
WorkTimeApp.ui.createSettingsController = function (options) {
  const events = WorkTimeApp.ui.createEventScope();
  const breakEvents = WorkTimeApp.ui.createEventScope();
  const {
    core: C,
    element: $,
    model,
    actions,
    escape: esc,
    application,
  } = options;
  const rangeController = WorkTimeApp.ui.createScheduleRangeController({
    element: $,
    rangeForChoice: C.scheduleRangeForChoice,
    today: options.clock.today,
  });
  let editingDate = model.selected,
    originalDraft = "",
    preferredRange = null,
    pendingLeave = null;
  function showSettings() {
    if ($("settingsDialog").open) {
      requestSettingsLeave(() => actions.closeSettings());
      return;
    }
    if (model.batchMode) {
      if (model.batchSaving) return;
      actions.leaveBatch();
    }
    refreshSettings();
    actions.open("settingsDialog");
  }

  function refreshSettings() {
    editingDate = model.selected;
    preferredRange = null;
    loadSchedule(C.scheduleForDate(model.state, editingDate));
    const requirements = model.state.overtimeRequirements;
    for (let i = 0; i < 5; i++)
      $("overtimeRequirement" + i).value =
        requirements[i] === null ? "" : (requirements[i] / 60).toFixed(1);
    WorkTimeApp.ui.fieldErrors.clear($("settingsError"));
  }
  function readSettingsBreaks() {
    const breaks = [];
    for (const row of $("breaksList").children) {
      const start = row.querySelector(".breakstart").value.trim(),
        end = row.querySelector(".breakend").value.trim();
      if (!start && !end) continue;
      const a = C.breakMin(start),
        b = C.breakMin(end);
      if (a === null || b === null || a >= b || a === 1440)
        throw Error(WorkTimeApp.i18n.t("copy.4e08bf2cca"));
      breaks.push({ start: a, end: b });
    }
    return breaks;
  }
  function addBreak(b) {
    const row = document.createElement("div");
    row.className = "breakrow";
    const fmt = (m) => C.pad(Math.floor(m / 60)) + ":" + C.pad(m % 60);
    row.innerHTML =
      WorkTimeApp.i18n.t("copy.4beeb6588b") +
      (b ? fmt(b.start) : "") +
      WorkTimeApp.i18n.t("copy.b32b652361") +
      (b ? fmt(b.end) : "") +
      WorkTimeApp.i18n.t("copy.ab28b7393b") +
      actions.controlIcon("trash") +
      "</button>";

    breakEvents.handler(row.querySelector("button"), "onclick", () => {
      row.querySelectorAll("input").forEach((input) => (input.value = ""));
      row
        .querySelector("input")
        .dispatchEvent(new Event("input", { bubbles: true }));
    });
    $("breaksList").append(row);
  }

  function rawDraft() {
    return JSON.stringify([
      $("standardStart").value,
      $("standardEnd").value,
      [...$("breaksList").children].map((row) =>
        [...row.querySelectorAll("input")].map((input) => input.value),
      ),
    ]);
  }
  function hasScheduleDraft() {
    return rawDraft() !== originalDraft;
  }
  function readSchedule() {
    return C.validateSchedule({
      workStart: $("standardStart").value,
      workEnd: $("standardEnd").value,
      breaks: readSettingsBreaks(),
    });
  }
  function loadSchedule(schedule) {
    $("standardStart").value = schedule.workStart;
    $("standardEnd").value = schedule.workEnd;
    breakEvents.dispose();
    $("breaksList").innerHTML = "";
    for (let i = 0; i < Math.max(2, schedule.breaks.length); i++)
      addBreak(schedule.breaks[i]);
    originalDraft = rawDraft();
    updateSchedulePreview();
  }
  function updateSchedulePreview() {
    $("scheduleEditingDate").textContent =
      WorkTimeApp.i18n.t("copy.b5b41e6754") +
      editingDate +
      WorkTimeApp.i18n.t("copy.47cbad548a") +
      (hasScheduleDraft() ? WorkTimeApp.i18n.t("copy.5db8ce7daa") : "");
    try {
      readSchedule();
      WorkTimeApp.ui.fieldErrors.clear($("settingsError"));
    } catch (error) {
      WorkTimeApp.ui.fieldErrors.show($("settingsError"), {
        code: "VALIDATION",
        message: error.message,
      });
    }
  }
  function describeSchedule(schedule) {
    const fmt = (m) => C.pad(Math.floor(m / 60)) + ":" + C.pad(m % 60);
    return (
      schedule.workStart +
      "–" +
      schedule.workEnd +
      WorkTimeApp.i18n.t("copy.33bc47eea7") +
      C.hours(schedule.standardMinutes) +
      WorkTimeApp.i18n.t("copy.7f5ae7de18") +
      (schedule.breaks.map((r) => fmt(r.start) + "–" + fmt(r.end)).join("、") ||
        WorkTimeApp.i18n.t("copy.1a8b4ad549"))
    );
  }
  function requestSettingsLeave(continuation) {
    if (!hasScheduleDraft()) {
      continuation();
      return;
    }
    pendingLeave = continuation;
    actions.open("scheduleDraftDialog");
  }
  function openScheduleRange() {
    try {
      const schedule = readSchedule();
      const fmt = (m) => C.pad(Math.floor(m / 60)) + ":" + C.pad(m % 60);
      $("scheduleDraftSummary").innerHTML =
        WorkTimeApp.i18n.t("copy.2d6cb608fd") +
        esc(schedule.workStart + "–" + schedule.workEnd) +
        WorkTimeApp.i18n.t("copy.6582dde62a") +
        esc(C.hours(schedule.standardMinutes)) +
        WorkTimeApp.i18n.t("copy.67bce3b1e9") +
        (schedule.breaks.length
          ? schedule.breaks
              .map(
                (r) =>
                  '<span class="schedule-break-chip">' +
                  fmt(r.start) +
                  "–" +
                  fmt(r.end) +
                  "</span>",
              )
              .join("")
          : WorkTimeApp.i18n.t("copy.7e233e4c7e")) +
        "</div></div>";
    } catch (error) {
      WorkTimeApp.ui.fieldErrors.show($("settingsError"), {
        code: "VALIDATION",
        message: error.message,
      });
      pendingLeave = null;
      return;
    }
    rangeController.open({ preferred: preferredRange, editingDate });
    renderScheduleList();
    actions.open("scheduleRangeDialog");
  }
  function renderScheduleList() {
    const items = [
      { start: null, end: null, schedule: model.state.settings },
      ...model.state.scheduleRanges,
    ];
    const fmt = (m) => C.pad(Math.floor(m / 60)) + ":" + C.pad(m % 60);
    $("scheduleList").innerHTML = items
      .map((r, i) => {
        const title = r.start
          ? r.start +
            WorkTimeApp.i18n.t("copy.9f96f7e891") +
            (r.end || WorkTimeApp.i18n.t("copy.5971bd41a3"))
          : WorkTimeApp.i18n.t("copy.32fdb2d9ea");
        const selected =
          !!preferredRange &&
          preferredRange.start === r.start &&
          preferredRange.end === r.end;
        return (
          '<button type="button" class="ui-button schedule-list-item" data-schedule-index="' +
          i +
          '" aria-pressed="' +
          selected +
          '" aria-label="' +
          esc(title + "，" + describeSchedule(r.schedule)) +
          '"><span class="schedule-card-heading"><strong>' +
          esc(title) +
          '</strong><span class="schedule-card-hours">' +
          esc(C.hours(r.schedule.standardMinutes)) +
          ' h</span></span><small class="schedule-card-details"><span>' +
          esc(r.schedule.workStart + "–" + r.schedule.workEnd) +
          WorkTimeApp.i18n.t("copy.846ab5a883") +
          esc(
            r.schedule.breaks
              .map((b) => fmt(b.start) + "–" + fmt(b.end))
              .join("、") || WorkTimeApp.i18n.t("copy.1a8b4ad549"),
          ) +
          "</span></small></button>"
        );
      })
      .join("");
  }
  function guardSettingsClose(event) {
    if (!hasScheduleDraft()) return;
    event.preventDefault();
    requestSettingsLeave(() => actions.closeSettings());
  }
  function guardNavigation(event) {
    if (!$("settingsDialog").open) return;
    const target = event.target.closest(
      "#calendar .day[data-date], #calendar [data-year-date], #prevMonth, #nextMonth, #todayButton, #monthTitle, #batchToggle, #restore, #pageSettingsOpen",
    );
    if (!target) return;
    const keepSettings = target.matches(
      "#calendar .day[data-date], #calendar [data-year-date], #prevMonth, #nextMonth, #todayButton, #monthTitle",
    );
    if (keepSettings && !hasScheduleDraft()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const shiftKey = event.shiftKey;
    requestSettingsLeave(() => {
      if (!keepSettings) actions.closeSettings();
      target.dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey }),
      );
    });
  }
  function trapScheduleFocus(event) {
    if (event.key !== "Tab") return;
    const modal = document.querySelector(
      "#scheduleRangeDialog:modal, #scheduleDraftDialog:modal",
    );
    if (!modal) return;
    const controls = [
      ...modal.querySelectorAll("button, input, select, [tabindex]"),
    ].filter(
      (e) => !e.disabled && e.tabIndex >= 0 && e.getClientRects().length,
    );
    const first = controls[0],
      last = controls.at(-1);
    if (!first) return;
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !modal.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last ||
        !modal.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }
  function beforeUnload(event) {
    if (!hasScheduleDraft()) return;
    event.preventDefault();
    event.returnValue = "";
  }

  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    events.listen(document, "worktime:languagechange", () => {
      updateSchedulePreview();
      renderScheduleList();
    });
    rangeController.bind();
    originalDraft = rawDraft();
    events.handler($("settingsOpen"), "onclick", showSettings);
    events.handler($("setupButton"), "onclick", showSettings);

    for (let i = 0; i < 5; i++)
      events.listen($("overtimeRequirement" + i), "blur", (event) => {
        const input = event.target,
          value = Number(input.value);
        if (
          input.value !== "" &&
          !input.validity.badInput &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= 24
        )
          input.value = value.toFixed(1);
      });
    const saveSettings = async () => {
      try {
        const requirements = C.validateOvertimeRequirements(
          Array.from({ length: 5 }, (_, i) => {
            const input = $("overtimeRequirement" + i);
            if (input.validity.badInput || !input.validity.valid)
              throw Error(WorkTimeApp.i18n.t("copy.1c37af8ae2"));
            return input.value === ""
              ? null
              : Number((Number(input.value) * 60).toFixed(2));
          }),
        );
        WorkTimeApp.ui.fieldErrors.clear($("settingsError"));
        const result = await application.saveSettings(
          model.state.settings,
          requirements,
        );
        if (!result.persisted)
          WorkTimeApp.ui.fieldErrors.show($("settingsError"), {
            code: "UNSAVED",
            message: WorkTimeApp.i18n.t("copy.3b3b385082"),
          });
        if (result.changed) actions.render();
        if (!result.persisted)
          actions.saveFeedback(false, WorkTimeApp.i18n.t("copy.594854becd"));
      } catch (error) {
        WorkTimeApp.ui.fieldErrors.show($("settingsError"), {
          code: "VALIDATION",
          message: error.userMessage || error.message,
        });
      }
    };
    const onSettingsInput = (event) => {
      if (event.target.closest(".settings-schedule")) updateSchedulePreview();
      else saveSettings();
    };
    events.handler($("settingsForm"), "oninput", onSettingsInput);
    events.handler($("settingsForm"), "onchange", onSettingsInput);
    events.handler($("settingsForm"), "onsubmit", (event) => {
      event.preventDefault();
      openScheduleRange();
    });
    events.handler($("scheduleApplyOpen"), "onclick", () => {
      pendingLeave = null;
      openScheduleRange();
    });
    events.handler($("scheduleRangeForm"), "onsubmit", async (event) => {
      event.preventDefault();
      try {
        const range = rangeController.read();
        const candidate = C.applyScheduleRange(
          model.state,
          readSchedule(),
          range.start,
          range.end,
        );
        const result = await application.applySchedule(candidate);
        if (!result.persisted)
          throw Error(
            WorkTimeApp.i18n.t("copy.53e34e04b0") +
              WorkTimeApp.i18n.message(result.error.message) +
              WorkTimeApp.i18n.t("copy.2ee102ceda"),
          );
        const continuation = pendingLeave;
        pendingLeave = null;
        originalDraft = rawDraft();
        $("scheduleRangeDialog").close();
        preferredRange = null;
        loadSchedule(C.scheduleForDate(model.state, editingDate));
        WorkTimeApp.ui.fieldErrors.clear($("settingsError"));
        actions.render();
        actions.toast(WorkTimeApp.i18n.t("copy.68847eebb3"));
        continuation?.();
      } catch (error) {
        $("scheduleRangeError").textContent = WorkTimeApp.i18n.message(
          error.message,
        );
      }
    });
    events.listen($("scheduleRangeDialog"), "close", () => {
      pendingLeave = null;
    });
    events.handler($("scheduleDraftContinue"), "onclick", () => {
      pendingLeave = null;
      $("scheduleDraftDialog").close();
    });
    events.handler($("scheduleDraftDiscard"), "onclick", () => {
      const continuation = pendingLeave;
      pendingLeave = null;
      loadSchedule(C.scheduleForDate(model.state, editingDate));
      $("scheduleDraftDialog").close();
      continuation?.();
    });
    events.handler($("scheduleDraftApply"), "onclick", () => {
      $("scheduleDraftDialog").close();
      openScheduleRange();
    });
    events.listen($("scheduleDraftDialog"), "cancel", () => {
      pendingLeave = null;
    });
    events.handler($("scheduleList"), "onclick", (event) => {
      const button = event.target.closest("[data-schedule-index]");
      if (!button) return;
      const index = Number(button.dataset.scheduleIndex);
      const r = index
        ? model.state.scheduleRanges[index - 1]
        : { start: null, end: null, schedule: model.state.settings };
      requestSettingsLeave(() => {
        if (r.start) editingDate = r.start;
        loadSchedule(r.schedule);
        preferredRange = {
          choice: r.start ? "custom" : "all",
          start: r.start,
          end: r.end,
        };
        openScheduleRange();
      });
    });
    events.listen(
      $("settingsDialog"),
      "settings-close-request",
      guardSettingsClose,
    );
    events.listen(document, "click", guardNavigation, true);
    events.listen(window, "beforeunload", beforeUnload);
    events.listen(document, "keydown", trapScheduleFocus);
  }

  function dispose() {
    rangeController.dispose();
    breakEvents.dispose();
    events.dispose();
    bound = false;
  }
  return {
    bind,
    dispose,
    refreshSettings,
    hasScheduleDraft,
    requestSettingsLeave,
    onSaveRecovered() {
      WorkTimeApp.ui.fieldErrors.saved($("settingsError"));
    },
    hasDraft() {
      if (hasScheduleDraft()) return true;
      if (!$("settingsDialog").open) return false;
      for (let i = 0; i < 5; i++) {
        const input = $("overtimeRequirement" + i);
        if (!input.validity.valid) return true;
        const minutes =
          input.value === ""
            ? null
            : Number((Number(input.value) * 60).toFixed(2));
        if (minutes !== model.state.overtimeRequirements[i]) return true;
      }
      return false;
    },
  };
};

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
      model.batchMode = false;
      model.batchDays.clear();
      model.batchAnchor = null;
      actions.renderCalendar();
      actions.renderEditor();
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
        throw Error("休息时段请使用 HH:MM，结束必须晚于开始。");
      breaks.push({ start: a, end: b });
    }
    return breaks;
  }
  function addBreak(b) {
    const row = document.createElement("div");
    row.className = "breakrow";
    const fmt = (m) => C.pad(Math.floor(m / 60)) + ":" + C.pad(m % 60);
    row.innerHTML =
      '<input class="breakstart clock-input" type="text" maxlength="5" autocomplete="off" inputmode="numeric" placeholder="12:00" aria-label="休息开始时间" value="' +
      (b ? fmt(b.start) : "") +
      '"><input class="breakend clock-input" type="text" maxlength="5" autocomplete="off" inputmode="numeric" placeholder="13:00" aria-label="休息结束时间" value="' +
      (b ? fmt(b.end) : "") +
      '"><button class="ui-button icon-only" type="button" aria-label="清空休息时段" title="清空休息时段">' +
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
      "正在编辑 " +
      editingDate +
      " 的作息" +
      (hasScheduleDraft() ? " · 未应用" : "");
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
      "，标准工时 " +
      C.hours(schedule.standardMinutes) +
      " h，休息 " +
      (schedule.breaks.map((r) => fmt(r.start) + "–" + fmt(r.end)).join("、") ||
        "无固定时段")
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
        '<div class="schedule-summary-main"><div><span>上下班时间</span><strong>' +
        esc(schedule.workStart + "–" + schedule.workEnd) +
        "</strong></div><div><span>标准工时</span><strong>" +
        esc(C.hours(schedule.standardMinutes)) +
        ' <small>h</small></strong></div></div><div class="schedule-summary-breaks"><span>休息时段</span><div>' +
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
          : '<span class="schedule-break-chip">无固定时段</span>') +
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
          ? r.start + " 至 " + (r.end || "未来全部")
          : "基础作息";
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
          '</span><span class="schedule-card-breaks">休息 ' +
          esc(
            r.schedule.breaks
              .map((b) => fmt(b.start) + "–" + fmt(b.end))
              .join("、") || "无固定时段",
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
      "#calendar button[data-date], #calendar [data-year-date], #prevMonth, #nextMonth, #todayButton, #monthTitle, #batchToggle, #restore, #pageSettingsOpen",
    );
    if (!target) return;
    const keepSettings = target.matches(
      "#calendar button[data-date], #calendar [data-year-date], #prevMonth, #nextMonth, #todayButton, #monthTitle",
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
    const saveSettings = () => {
      try {
        const requirements = C.validateOvertimeRequirements(
          Array.from({ length: 5 }, (_, i) => {
            const input = $("overtimeRequirement" + i);
            if (input.validity.badInput || !input.validity.valid)
              throw Error("加班条件须为 0–24 小时，保留一位小数。");
            return input.value === ""
              ? null
              : Number((Number(input.value) * 60).toFixed(2));
          }),
        );
        WorkTimeApp.ui.fieldErrors.clear($("settingsError"));
        const result = application.saveSettings(
          model.state.settings,
          requirements,
        );
        if (!result.persisted)
          WorkTimeApp.ui.fieldErrors.show($("settingsError"), {
            code: "UNSAVED",
            message: "设置尚未保存，请再次编辑重试或关闭后备份。",
          });
        if (result.changed) actions.render();
        if (!result.persisted)
          actions.saveFeedback(false, "工作时间设置已更新");
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
    events.handler($("scheduleRangeForm"), "onsubmit", (event) => {
      event.preventDefault();
      try {
        const range = rangeController.read();
        const candidate = C.applyScheduleRange(
          model.state,
          readSchedule(),
          range.start,
          range.end,
        );
        const result = application.applySchedule(candidate);
        if (!result.persisted)
          throw Error(
            "作息未应用：" + result.error.message + "。请保留草稿并重试。",
          );
        const continuation = pendingLeave;
        pendingLeave = null;
        originalDraft = rawDraft();
        $("scheduleRangeDialog").close();
        preferredRange = null;
        loadSchedule(C.scheduleForDate(model.state, editingDate));
        WorkTimeApp.ui.fieldErrors.clear($("settingsError"));
        actions.render();
        actions.toast("作息已应用");
        continuation?.();
      } catch (error) {
        $("scheduleRangeError").textContent = error.message;
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

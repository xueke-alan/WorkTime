"use strict";
/** day-editor controller. Instantiate once, then bind after all actions are connected. */
WorkTimeApp.ui.createDayController = function (options) {
  const events = WorkTimeApp.ui.createEventScope();
  const { core: C, element: $, model, actions, application } = options;

  function saveDayEdit() {
    actions.previewDay();
    try {
      const day = actions.formDay();
      const changed =
        JSON.stringify(day) !==
        JSON.stringify(model.state.days[model.selected] || {});
      let saved = true;
      // A failed write must remain retryable even when the fields are unchanged.
      if (changed || model.storageFailed) {
        saved = application.saveDay(model.selected, day).persisted;
        actions.renderStats();
        actions.renderCalendar(true);
      }
      actions.updateResetDayButton(day);
      const error = saved
        ? null
        : { code: "UNSAVED", message: "当前修改未保存，请查看提醒并备份。" };
      WorkTimeApp.ui.fieldErrors.show($("dayError"), error);
      WorkTimeApp.ui.fieldErrors.show($("dayLeaveError"), error);
      return saved;
    } catch (err) {
      const error = { code: "VALIDATION", message: err.message };
      WorkTimeApp.ui.fieldErrors.show($("dayError"), error);
      WorkTimeApp.ui.fieldErrors.show($("dayLeaveError"), error);
      return false;
    }
  }
  function normalizeClock(value) {
    const text = value.trim(),
      match =
        /^(\d{1,2}):([0-5]\d)$/.exec(text) || /^(\d{2})([0-5]\d)$/.exec(text);
    return match && Number(match[1]) < 24
      ? C.pad(Number(match[1])) + ":" + match[2]
      : null;
  }
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    events.handler($("plannedOvertimeToggle"), "onclick", () => {
      const day = model.state.days[model.selected] || {};
      if (C.calendarInfo(model.selected, day).work) return;
      const saved = application.togglePlanned(model.selected).persisted;
      actions.render();
      if (!saved) actions.toast("计划标记未能保存，请查看提醒", "error");
    });
    events.handler($("dayForm"), "onsubmit", (e) => {
      e.preventDefault();
      saveDayEdit();
    });
    events.handler($("dayLeaveToggle"), "onclick", () => {
      if ($("dayLeaveToggle").getAttribute("aria-expanded") === "true") {
        actions.closeLeavePanel();
        return;
      }
      WorkTimeApp.ui.fieldErrors.clear($("dayLeaveError"));
      actions.openLeavePanel();
      $("dayLeave").focus({ preventScroll: true });
      $("dayLeave").select();
    });
    for (const id of ["dayLeaveFull", "dayLeaveDone"]) {
      // Mouse/touch actions keep the input focused until the click submits.
      events.listen($(id), "pointerdown", (event) => event.preventDefault());
    }
    events.listen($("dayLeave"), "blur", (event) => {
      if (!$("dayLeavePanel").contains(event.relatedTarget))
        actions.closeLeavePanel();
    });
    events.listen($("dayLeavePanel"), "focusout", (event) => {
      if (!$("dayLeavePanel").contains(event.relatedTarget))
        actions.closeLeavePanel();
    });
    events.listen($("dayLeave"), "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        $("dayLeaveDone").click();
      }
    });
    events.handler($("dayLeaveFull"), "onclick", () => {
      $("dayLeave").value = C.hours(
        C.scheduleForDate(model.state, model.selected).standardMinutes,
      );
      WorkTimeApp.ui.fieldErrors.clear($("dayLeaveError"));
      if (saveDayEdit()) {
        actions.closeLeavePanel(true);
        actions.toast(
          model.storageFailed
            ? "全天请假保存异常，请查看提醒"
            : "全天请假已保存",
        );
      }
    });
    events.handler($("dayLeaveDone"), "onclick", () => {
      if (saveDayEdit()) actions.closeLeavePanel(true);
      else $("dayLeave").focus();
    });
    events.listen(document, "click", (e) => {
      if (!e.target.closest(".leave-control")) actions.closeLeavePanel();
    });
    events.listen(document, "keydown", (e) => {
      if (
        e.key === "Escape" &&
        !$("dayLeavePanel").classList.contains("hidden")
      ) {
        e.preventDefault();
        actions.closeLeavePanel(true);
      }
    });
    events.handler($("dayNextToggle"), "onclick", () => {
      $("dayNext").checked = !$("dayNext").checked;
      $("dayNext").dispatchEvent(new Event("input", { bubbles: true }));
    });
    events.listen(
      document,
      "keydown",
      (event) => {
        const input = event.target;
        if (
          event.key !== "Enter" ||
          event.isComposing ||
          event.repeat ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          event.shiftKey ||
          !(input instanceof HTMLInputElement) ||
          !input.matches("input.clock-input:not(.date-entry)") ||
          input.disabled ||
          input.readOnly ||
          input.value.trim()
        )
          return;
        const value = normalizeClock(input.placeholder);
        if (value === null) return;
        event.preventDefault();
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
      true,
    );
    events.listen(
      document,
      "input",
      (event) => {
        const input = event.target;
        if (
          !input.matches("input.clock-input") ||
          input.id === "dayStart" ||
          input.id === "dayEnd" ||
          input.id === "employmentDate"
        )
          return;
        if (input.classList.contains("date-entry")) {
          const digits = input.value.trim().replace(/[-/.]/g, "");
          if (/^\d{8}$/.test(digits))
            input.value =
              digits.slice(0, 4) +
              "-" +
              digits.slice(4, 6) +
              "-" +
              digits.slice(6);
          return;
        }
        const time = normalizeClock(input.value);
        if (time !== null) input.value = time;
        else if (input.classList.contains("breakend") && input.value === "2400")
          input.value = "24:00";
      },
      true,
    );
    events.listen(document, "keydown", (event) => {
      const input = event.target;
      if (
        !input.matches("input.clock-input") ||
        input.id === "dayStart" ||
        input.id === "dayEnd" ||
        input.id === "employmentDate"
      )
        return;
      if (event.key === "Enter" || event.key === "Escape") {
        // Modal cancellation belongs to the native dialog. Inline clock inputs
        // still use Escape to leave editing without submitting.
        if (event.key === "Escape" && input.closest("dialog[open]")) return;
        event.preventDefault();
        input.blur();
      }
    });
    for (const id of ["dayStart", "dayEnd"]) {
      const input = $(id);
      events.listen(input, "input", () => {
        const time = normalizeClock(input.value);
        if (time !== null) input.value = time;
        if (!input.value || time !== null) saveDayEdit();
      });
      events.listen(input, "blur", () => {
        if (input.value && normalizeClock(input.value) === null) {
          const day = model.state.days[model.selected] || {},
            record = C.effectiveRecord(day, true) || day.oa || {};
          input.value = record[id === "dayStart" ? "start" : "end"] || "";
        }
        input.setSelectionRange(input.value.length, input.value.length);
        actions.previewDay();
      });
      events.listen(input, "keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          input.blur();
        }
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });
    }
    events.listen($("dayNext"), "input", saveDayEdit);
    events.listen($("dayLeave"), "input", () => {
      WorkTimeApp.ui.fieldErrors.clear($("dayLeaveError"));
    });
    events.handler($("clearManual"), "onclick", () => {
      const d = model.state.days[model.selected];
      if (!d) return;
      const saved = application.resetDay(model.selected).persisted;
      actions.render();
      actions.toast(
        saved
          ? d.oa
            ? "当天手动填写已重置，已恢复 OA 数据"
            : "当天手动填写已清空"
          : "重置未能保存，请查看提醒",
        saved ? "countdown" : "error",
      );
    });
  }
  function dispose() {
    events.dispose();
    bound = false;
  }
  function hasDraft() {
    if (model.batchMode) return false;
    const day = model.state.days[model.selected] || {};
    const record = C.effectiveRecord(day, true) || day.oa || {};
    return (
      $("dayStart").value !== (record.start || "") ||
      $("dayEnd").value !== (record.end || "") ||
      $("dayNext").checked !== !!record.nextDay ||
      $("dayLeave").validity.badInput ||
      Number($("dayLeave").value || 0) !==
        Number(C.hours(day.leaveMinutes || 0))
    );
  }
  return {
    bind,
    dispose,
    saveDayEdit,
    hasDraft,
    onSaveRecovered() {
      WorkTimeApp.ui.fieldErrors.saved($("dayError"));
      WorkTimeApp.ui.fieldErrors.saved($("dayLeaveError"));
    },
  };
};

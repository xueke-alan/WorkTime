"use strict";
/** day-editor controller. Instantiate once, then bind after all actions are connected. */
WorkUI.createDayController = function (options) {
  const { core: C, element: $, model, actions } = options;

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
        model.state.days[model.selected] = day;
        saved = actions.save();
        actions.renderStats();
        actions.renderCalendar(true);
      }
      actions.updateResetDayButton(day);
      $("dayError").textContent = saved
        ? ""
        : "当前修改未保存，请查看提醒并备份。";
      $("dayLeaveError").textContent = $("dayError").textContent;
      return saved;
    } catch (err) {
      $("dayError").textContent = err.message;
      $("dayLeaveError").textContent = err.message;
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
    $("plannedOvertimeToggle").onclick = () => {
      const day = model.state.days[model.selected] || {};
      if (C.calendarInfo(model.selected, day).work) return;
      if (day.plannedOvertime) delete day.plannedOvertime;
      else day.plannedOvertime = true;
      model.state.days[model.selected] = day;
      const saved = actions.save();
      actions.render();
      if (!saved) actions.toast("计划标记未能保存，请查看提醒", "error");
    };
    $("dayForm").onsubmit = (e) => {
      e.preventDefault();
      saveDayEdit();
    };
    $("dayLeaveToggle").onclick = () => {
      if (!$("dayLeavePanel").classList.contains("hidden")) {
        actions.closeLeavePanel();
        return;
      }
      $("dayLeaveError").textContent = "";
      $("dayLeavePanel").classList.remove("hidden");
      $("dayLeaveToggle").setAttribute("aria-expanded", "true");
      $("dayLeave").focus();
      $("dayLeave").select();
    };
    $("dayLeaveFull").onclick = () => {
      $("dayLeave").value = C.hours(model.state.settings.standardMinutes);
      $("dayLeaveError").textContent = "";
      if (saveDayEdit()) {
        actions.closeLeavePanel(true);
        actions.toast(
          model.storageFailed
            ? "全天请假保存异常，请查看提醒"
            : "全天请假已保存",
        );
      }
    };
    $("dayLeaveDone").onclick = () => {
      if (saveDayEdit()) actions.closeLeavePanel(true);
      else $("dayLeave").focus();
    };
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".leave-control")) actions.closeLeavePanel();
    });
    document.addEventListener("keydown", (e) => {
      if (
        e.key === "Escape" &&
        !$("dayLeavePanel").classList.contains("hidden")
      ) {
        e.preventDefault();
        actions.closeLeavePanel(true);
      }
    });
    $("dayNextToggle").onclick = () => {
      $("dayNext").checked = !$("dayNext").checked;
      $("dayNext").dispatchEvent(new Event("input", { bubbles: true }));
    };
    document.addEventListener(
      "input",
      (event) => {
        const input = event.target;
        if (
          !input.matches("input.clock-input") ||
          input.id === "dayStart" ||
          input.id === "dayEnd"
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
    document.addEventListener("keydown", (event) => {
      const input = event.target;
      if (
        !input.matches("input.clock-input") ||
        input.id === "dayStart" ||
        input.id === "dayEnd"
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
      input.addEventListener("input", () => {
        const time = normalizeClock(input.value);
        if (time !== null) input.value = time;
        if (!input.value || time !== null) saveDayEdit();
      });
      input.addEventListener("blur", () => {
        if (input.value && normalizeClock(input.value) === null) {
          const day = model.state.days[model.selected] || {},
            record = C.effectiveRecord(day, true) || day.oa || {};
          input.value = record[id === "dayStart" ? "start" : "end"] || "";
        }
        input.setSelectionRange(input.value.length, input.value.length);
        actions.previewDay();
      });
      input.addEventListener("keydown", (event) => {
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
    ["dayNext", "dayLeave"].forEach((id) =>
      $(id).addEventListener("input", saveDayEdit),
    );
    $("clearManual").onclick = () => {
      const d = model.state.days[model.selected];
      if (!d) return;
      delete d.actual;
      delete d.estimate;
      delete d.draft;
      delete d.note;
      delete d.leaveMinutes;
      delete d.kind;
      delete d.plannedOvertime;
      if (!d.oa) delete model.state.days[model.selected];
      const saved = actions.save();
      actions.render();
      actions.toast(
        saved
          ? d.oa
            ? "当天手动填写已重置，已恢复 OA 数据"
            : "当天手动填写已清空"
          : "重置未能保存，请查看提醒",
        saved ? "countdown" : "error",
      );
    };
  }
  function dispose() {}
  return { bind, dispose, saveDayEdit };
};

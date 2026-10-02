"use strict";
/** navigation controller. Instantiate once, then bind after all actions are connected. */
WorkUI.createNavigationController = function (options) {
  const { core: C, model, actions, element: $, clock } = options;

  function navigateMonth(v) {
    model.yearMode = false;
    if (!/^\d{4}-\d{2}$/.test(v) || !C.validDate(v + "-01")) return;
    model.month = v;
    model.selected =
      model.month === model.today.slice(0, 7)
        ? model.today
        : model.month + "-01";
    model.batchDays.clear();
    model.batchAnchor = null;
    actions.render();
  }
  function prepareBatchEditor() {
    $("batchStart").value = model.state.settings.workStart;
    $("batchEnd").value = model.state.settings.workEnd;
    $("batchNext").checked = false;
    $("batchCalcStart").value = model.state.settings.workStart;
    $("batchCalcOvertime").value = "";
    $("batchError").textContent = "";
    $("batchCalcResult").textContent = "";
    updateBatchNextToggle();
    actions.renderBatchTimeTemplates();
  }
  function updateBatchNextToggle() {
    $("batchNextToggle").setAttribute(
      "aria-pressed",
      String($("batchNext").checked),
    );
  }
  function calculateBatchEndTime() {
    const result = $("batchCalcResult");
    result.textContent = "";
    try {
      if (!model.state.settings.configured) throw Error("请先完成计算设置。");
      const start = $("batchCalcStart").value,
        startMinutes = C.timeMin(start),
        value = $("batchCalcOvertime").value,
        overtimeHours = Number(value);
      if (startMinutes === null) throw Error("请填写有效的上班时间。");
      if (value === "" || !Number.isFinite(overtimeHours) || overtimeHours < 0)
        throw Error("平均加班工时须为不小于 0 的数字。");
      const targetMinutes =
        model.state.settings.standardMinutes + Math.round(overtimeHours * 60);
      if (targetMinutes >= 1440)
        throw Error("标准工时与平均加班合计须小于 24 小时。");
      let match = null;
      for (let elapsed = 0; elapsed < 1440; elapsed++) {
        const absolute = startMinutes + elapsed,
          endMinute = absolute % 1440,
          end = C.pad(Math.floor(endMinute / 60)) + ":" + C.pad(endMinute % 60),
          nextDay = absolute >= 1440,
          effective = C.duration(
            { start, end, nextDay, effectiveMinutes: null },
            model.state.settings,
          );
        if (effective >= targetMinutes) {
          match = { end, nextDay };
          break;
        }
      }
      if (!match) throw Error("当前休息时段下无法在 24 小时内达到目标工时。");
      $("batchStart").value = start;
      $("batchEnd").value = match.end;
      $("batchNext").checked = match.nextDay;
      updateBatchNextToggle();
      actions.renderBatchTimeTemplates();
      $("batchError").textContent = "";
      result.textContent =
        "已填入 " +
        start +
        " – " +
        match.end +
        (match.nextDay ? "（次日）" : "");
    } catch (error) {
      result.textContent = error.message;
    }
  }
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    $("calendar").onclick = (e) => {
      const b = e.target.closest("button.day[data-date]");
      if (!b) return;
      const k = b.dataset.date;
      if (model.batchMode) {
        if (e.shiftKey && model.batchAnchor) {
          const [first, last] = [model.batchAnchor, k].sort();
          for (const card of $("calendar").querySelectorAll(
            "button.day[data-date]",
          )) {
            const date = card.dataset.date;
            if (
              date >= first &&
              date <= last &&
              C.calendarInfo(date, model.state.days[date] || {}).work
            )
              model.batchDays.add(date);
          }
        } else {
          model.batchDays.has(k)
            ? model.batchDays.delete(k)
            : model.batchDays.add(k);
          model.batchAnchor = k;
        }
        actions.renderCalendar();
      } else {
        model.selected = k;
        actions.renderCalendar();
        actions.renderEditor();
      }
    };
    $("monthTitle").onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        $("monthTitle").click();
      }
    };
    $("monthTitle").onclick = () => {
      if (model.yearMode) {
        model.yearMode = false;
        model.month = model.returnMonth;
      } else {
        model.yearMode = true;
        model.viewYear = Number(model.month.slice(0, 4));
        model.returnMonth = model.month;
        model.batchMode = false;
        model.batchDays.clear();
        model.batchAnchor = null;
      }
      actions.render();
    };
    $("calendar").addEventListener("click", (e) => {
      const button = e.target.closest("[data-year-date]");
      if (!button) return;
      model.yearMode = false;
      model.month = button.dataset.yearDate.slice(0, 7);
      model.selected = button.dataset.yearDate;
      actions.render();
      $("calendar")
        .querySelector("[data-date=" + JSON.stringify(model.selected) + "]")
        ?.focus();
    });
    $("prevMonth").onclick = () => {
      if (model.yearMode) {
        if (model.viewYear > 1900) model.viewYear--;
        actions.renderCalendar();
        return;
      }
      const d = C.localDate(model.month + "-01");
      d.setMonth(d.getMonth() - 1);
      navigateMonth(C.dateKey(d).slice(0, 7));
    };
    $("nextMonth").onclick = () => {
      if (model.yearMode) {
        if (model.viewYear < 9999) model.viewYear++;
        actions.renderCalendar();
        return;
      }
      const d = C.localDate(model.month + "-01");
      d.setMonth(d.getMonth() + 1);
      navigateMonth(C.dateKey(d).slice(0, 7));
    };
    $("todayButton").onclick = () => {
      model.today = clock.today();
      navigateMonth(model.today.slice(0, 7));
    };
    $("batchToggle").onclick = () => {
      model.batchMode = !model.batchMode;
      model.batchDays.clear();
      model.batchAnchor = null;
      if (model.batchMode) prepareBatchEditor();
      actions.renderCalendar();
    };
    $("batchCancel").onclick = () => {
      model.batchMode = false;
      model.batchDays.clear();
      model.batchAnchor = null;
      actions.renderCalendar();
      $("batchToggle").focus();
    };
    $("batchNextToggle").onclick = () => {
      $("batchNext").checked = !$("batchNext").checked;
      updateBatchNextToggle();
      actions.renderBatchTimeTemplates();
    };
    $("batchCalculateEnd").onclick = calculateBatchEndTime;
    $("batchCalcOvertime").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        calculateBatchEndTime();
      }
    });
    $("batchForm").onsubmit = (e) => {
      e.preventDefault();
      if (!model.batchDays.size) {
        $("batchError").textContent = "请先选择需要填写的日期。";
        return;
      }
      const record = {
        start: $("batchStart").value,
        end: $("batchEnd").value,
        nextDay: $("batchNext").checked,
        effectiveMinutes: null,
      };
      if (!C.complete(record)) {
        $("batchError").textContent =
          "请填写完整上下班时间；跨午夜请开启“次日下班”。";
        return;
      }
      for (const k of model.batchDays) {
        const day = model.state.days[k] || (model.state.days[k] = {});
        if (day.oa || day.actual) {
          day.actual = { ...record };
          delete day.estimate;
        } else day.estimate = { ...record };
        delete day.draft;
      }
      const count = model.batchDays.size;
      const saved = actions.save();
      model.batchMode = false;
      model.batchDays.clear();
      model.batchAnchor = null;
      actions.render();
      actions.saveFeedback(saved, "已更新 " + count + " 天时间");
    };
  }
  function dispose() {}
  return { bind, dispose, updateBatchNextToggle };
};

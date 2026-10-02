"use strict";
/** settings controller. Instantiate once, then bind after all actions are connected. */
WorkUI.createSettingsController = function (options) {
  const { core: C, element: $, model, actions } = options;

  function showSettings() {
    $("employmentDate").value = model.state.settings.employmentDate || "";
    $("standardStart").value =
      model.state.settings.workStart || C.DEFAULT_START;
    $("standardEnd").value = model.state.settings.workEnd || C.DEFAULT_END;
    const requirements = model.state.overtimeRequirements || [
      model.state.targetAverageMinutes,
      null,
      null,
      null,
      null,
    ];
    for (let i = 0; i < 5; i++)
      $("overtimeRequirement" + i).value =
        requirements[i] === null ? "" : (requirements[i] / 60).toFixed(1);
    $("breaksList").innerHTML = "";
    for (let i = 0; i < 2; i++) addBreak(model.state.settings.breaks[i]);
    $("settingsError").textContent = "";
    updateStandardHoursPreview();
    actions.open("settingsDialog");
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
    return breaks.concat(model.state.settings.breaks.slice(2));
  }
  function updateStandardHoursPreview() {
    const start = $("standardStart").value,
      end = $("standardEnd").value;
    try {
      const breaks = readSettingsBreaks(),
        startMinutes = C.timeMin(start),
        endMinutes = C.timeMin(end);
      if (
        startMinutes === null ||
        endMinutes === null ||
        endMinutes <= startMinutes
      )
        throw Error();
      const minutes = C.duration(
        { start, end, nextDay: false, effectiveMinutes: null },
        { breaks },
      );
      $("standardHours").textContent =
        minutes > 0 ? C.formatMinutes(minutes) : "—";
    } catch {
      $("standardHours").textContent = "—";
    }
  }
  function addBreak(b) {
    const row = document.createElement("div");
    row.className = "breakrow";
    const fmt = (m) => C.pad(Math.floor(m / 60)) + ":" + C.pad(m % 60);
    row.innerHTML =
      '<input class="breakstart clock-input" type="text" maxlength="5" autocomplete="off" inputmode="numeric" placeholder="12:00" aria-label="休息开始时间" value="' +
      (b ? fmt(b.start) : "") +
      '"><span>至</span><input class="breakend clock-input" type="text" maxlength="5" autocomplete="off" inputmode="numeric" placeholder="13:00" aria-label="休息结束时间" value="' +
      (b ? fmt(b.end) : "") +
      '"><button class="icon-only" type="button" aria-label="清空休息时段" title="清空休息时段">' +
      actions.controlIcon("trash") +
      "</button>";
    row
      .querySelectorAll("input")
      .forEach((input) =>
        input.addEventListener("input", updateStandardHoursPreview),
      );
    row.querySelector("button").onclick = () => {
      row.querySelectorAll("input").forEach((input) => (input.value = ""));
      updateStandardHoursPreview();
    };
    $("breaksList").append(row);
    updateStandardHoursPreview();
  }
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    $("settingsOpen").onclick = showSettings;
    $("setupButton").onclick = showSettings;
    for (const id of ["standardStart", "standardEnd"])
      $(id).addEventListener("input", updateStandardHoursPreview);
    for (let i = 0; i < 5; i++)
      $("overtimeRequirement" + i).addEventListener("blur", (event) => {
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
    $("settingsForm").onsubmit = (e) => {
      e.preventDefault();
      try {
        const workStart = $("standardStart").value,
          workEnd = $("standardEnd").value,
          startMinutes = C.timeMin(workStart),
          endMinutes = C.timeMin(workEnd);
        if (startMinutes === null || endMinutes === null)
          throw Error("请填写完整的标准上下班时间。");
        if (endMinutes <= startMinutes)
          throw Error("标准下班时间必须晚于标准上班时间。");
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
        const breaks = readSettingsBreaks(),
          standardMinutes = C.duration(
            {
              start: workStart,
              end: workEnd,
              nextDay: false,
              effectiveMinutes: null,
            },
            { breaks },
          );
        if (!Number.isInteger(standardMinutes) || standardMinutes < 1)
          throw Error("扣除休息时段后，每日标准工时必须大于 0。");
        const invalid = Object.entries(model.state.days).find(
          ([k, d]) => (d.leaveMinutes || 0) > standardMinutes,
        );
        if (invalid)
          throw Error(
            invalid[0] + " 的请假时长超过新标准工时，请先修正该日请假。",
          );
        const employmentDate = $("employmentDate").value;
        if (employmentDate && !C.validDate(employmentDate))
          throw Error("请填写有效的入职日期。");
        model.state.settings = {
          configured: true,
          workStart,
          workEnd,
          standardMinutes,
          breaks,
          employmentDate,
        };
        model.state.overtimeRequirements = requirements;
        model.state.targetAverageMinutes = requirements[0];
        const saved = actions.save();
        if (saved) $("settingsDialog").close();
        else
          $("settingsError").textContent =
            "设置尚未保存，可重试提交或关闭后备份。";
        actions.render();
        actions.saveFeedback(saved, "计算设置已更新");
      } catch (err) {
        $("settingsError").textContent = err.userMessage || err.message;
      }
    };
  }
  function dispose() {}
  return { bind, dispose };
};

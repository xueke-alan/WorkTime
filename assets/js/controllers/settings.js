"use strict";
/** settings controller. Instantiate once, then bind after all actions are connected. */
WorkUI.createSettingsController = function (options) {
  const { core: C, element: $, model, actions } = options;
  let savePending = false;
  const directory = window.WorkWeatherCities?.cities || [];
  const cities = directory.map((city) =>
    directory.filter((candidate) => candidate.name === city.name).length === 1
      ? city.name
      : city.label,
  );
  let cityMatches = [],
    activeCity = -1;
  function positionCities() {
    const list = $("workCityOptions");
    if (list.hidden) return;
    const rect = $("workCity").getBoundingClientRect();
    const row = $("workCity")
      .closest(".settings-employment")
      .getBoundingClientRect();
    const width = Math.min(row.width, window.innerWidth - 16);
    const gap = 6;
    const below = window.innerHeight - rect.bottom - gap - 8;
    const above = rect.top - gap - 8;
    const height = Math.min(224, Math.max(below, above));
    list.style.width = width + "px";
    list.style.maxHeight = height + "px";
    list.style.left =
      Math.max(8, Math.min(row.left, window.innerWidth - width - 8)) + "px";
    const openBelow =
      below >= Math.min(list.scrollHeight, 224) || below >= above;
    list.style.top =
      (openBelow
        ? rect.bottom + gap
        : rect.top - gap - Math.min(list.scrollHeight, height)) + "px";
  }
  function closeCities() {
    $("workCityOptions").hidden = true;
    $("workCity").setAttribute("aria-expanded", "false");
    $("workCity").removeAttribute("aria-activedescendant");
    activeCity = -1;
  }
  function highlightCity() {
    $("workCityOptions")
      .querySelectorAll("[data-city]")
      .forEach((option, index) => {
        option.setAttribute("aria-selected", String(index === activeCity));
        if (index === activeCity) {
          $("workCity").setAttribute("aria-activedescendant", option.id);
          const list = $("workCityOptions");
          if (option.offsetTop < list.scrollTop)
            list.scrollTop = option.offsetTop;
          else if (
            option.offsetTop + option.offsetHeight >
            list.scrollTop + list.clientHeight
          )
            list.scrollTop =
              option.offsetTop + option.offsetHeight - list.clientHeight;
        }
      });
  }
  function showCities(query = "") {
    cityMatches = cities.filter((city) => city.includes(query.trim()));
    activeCity = -1;
    $("workCity").removeAttribute("aria-activedescendant");
    const list = $("workCityOptions");
    list.replaceChildren();
    for (const [index, city] of cityMatches.entries()) {
      const option = document.createElement("button");
      option.type = "button";
      option.id = "workCityOption" + index;
      option.dataset.city = city;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.tabIndex = -1;
      option.textContent = city;
      list.append(option);
    }
    if (!cityMatches.length) {
      const empty = document.createElement("div");
      empty.className = "work-city-empty";
      empty.textContent = "无匹配城市";
      list.append(empty);
    }
    list.hidden = false;
    $("workCity").setAttribute("aria-expanded", "true");
    list.scrollTop = 0;
    positionCities();
  }
  function selectCity(city) {
    $("workCity").value = city;
    $("workCity").dispatchEvent(new Event("input", { bubbles: true }));
    closeCities();
  }

  function showSettings() {
    if ($("settingsDialog").open) {
      actions.closeSettings();
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
    savePending = false;
    $("employmentDate").value = model.state.settings.employmentDate || "";
    $("workCity").value = model.state.settings.workCity || "";
    closeCities();
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
  function addBreak(b) {
    const row = document.createElement("div");
    row.className = "breakrow";
    const fmt = (m) => C.pad(Math.floor(m / 60)) + ":" + C.pad(m % 60);
    row.innerHTML =
      '<input class="breakstart clock-input" type="text" maxlength="5" autocomplete="off" inputmode="numeric" placeholder="12:00" aria-label="休息开始时间" value="' +
      (b ? fmt(b.start) : "") +
      '"><input class="breakend clock-input" type="text" maxlength="5" autocomplete="off" inputmode="numeric" placeholder="13:00" aria-label="休息结束时间" value="' +
      (b ? fmt(b.end) : "") +
      '"><button class="icon-only" type="button" aria-label="清空休息时段" title="清空休息时段">' +
      actions.controlIcon("trash") +
      "</button>";

    row.querySelector("button").onclick = () => {
      row.querySelectorAll("input").forEach((input) => (input.value = ""));
      row
        .querySelector("input")
        .dispatchEvent(new Event("input", { bubbles: true }));
    };
    $("breaksList").append(row);
  }
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    // Keep the list out of the sidebar's scrolling layout and use one picker only.
    document.body.append($("workCityOptions"));
    $("workCity").removeAttribute("list");
    $("weatherCityOptions")?.remove();
    window.addEventListener("resize", positionCities);
    document.addEventListener("scroll", positionCities, true);
    $("settingsDialog").addEventListener("close", closeCities);
    $("workCity").onfocus = () => showCities();
    $("workCity").oninput = () => showCities($("workCity").value);
    $("workCity").onblur = closeCities;
    $("workCityOptions").onpointerdown = (event) => event.preventDefault();
    $("workCityOptions").onclick = (event) => {
      const option = event.target.closest("[data-city]");
      if (option) selectCity(option.dataset.city);
    };
    $("workCity").onkeydown = (event) => {
      if (event.key === "Escape" && !$("workCityOptions").hidden) {
        event.preventDefault();
        event.stopPropagation();
        closeCities();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if ($("workCityOptions").hidden) showCities($("workCity").value);
        if (cityMatches.length) {
          activeCity =
            activeCity < 0
              ? event.key === "ArrowDown"
                ? 0
                : cityMatches.length - 1
              : (activeCity +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  cityMatches.length) %
                cityMatches.length;
          highlightCity();
        }
      } else if (
        event.key === "Enter" &&
        !$("workCityOptions").hidden &&
        activeCity >= 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        selectCity(cityMatches[activeCity]);
      }
    };
    $("settingsOpen").onclick = showSettings;
    $("setupButton").onclick = showSettings;

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
    const saveSettings = () => {
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
        const settings = {
          configured: true,
          workStart,
          workEnd,
          standardMinutes,
          breaks,
          employmentDate,
          workCity: $("workCity").value.trim(),
        };
        $("settingsError").textContent = "";
        if (
          !savePending &&
          JSON.stringify(settings) === JSON.stringify(model.state.settings) &&
          JSON.stringify(requirements) ===
            JSON.stringify(model.state.overtimeRequirements)
        )
          return;
        model.state.settings = settings;
        model.state.overtimeRequirements = requirements;
        model.state.targetAverageMinutes = requirements[0];
        const saved = actions.save();
        savePending = !saved;
        if (!saved)
          $("settingsError").textContent =
            "设置尚未保存，请再次编辑重试或关闭后备份。";
        actions.render();
        if (!saved) actions.saveFeedback(saved, "计算设置已更新");
      } catch (err) {
        $("settingsError").textContent = err.userMessage || err.message;
      }
    };
    $("settingsForm").oninput = saveSettings;
    $("settingsForm").onchange = saveSettings;
    $("settingsForm").onsubmit = (event) => {
      event.preventDefault();
      saveSettings();
    };
  }
  function dispose() {
    closeCities();
    window.removeEventListener("resize", positionCities);
    document.removeEventListener("scroll", positionCities, true);
    $("settingsDialog").removeEventListener("close", closeCities);
    for (const event of ["onfocus", "oninput", "onblur", "onkeydown"])
      $("workCity")[event] = null;
    $("workCityOptions").onpointerdown = null;
    $("workCityOptions").onclick = null;
  }
  return { bind, dispose, refreshSettings };
};

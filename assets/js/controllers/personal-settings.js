"use strict";
/** Personal profile and city picker own their form, independent of schedule drafts. */
WorkTimeApp.ui.createPersonalSettingsController = function ({
  core: C,
  element: $,
  model,
  actions,
  escape: esc,
  application,
}) {
  const events = WorkTimeApp.ui.createEventScope();
  const directory = WorkTimeApp.data.weatherCities?.cities || [];
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
    const height = Math.min(360, Math.max(below, above));
    list.style.width = width + "px";
    list.style.maxHeight = height + "px";
    list.style.left =
      Math.max(8, Math.min(row.left, window.innerWidth - width - 8)) + "px";
    const openBelow =
      below >= Math.min(list.scrollHeight, 360) || below >= above;
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
      option.className = "ui-option";
      option.type = "button";
      option.id = "workCityOption" + index;
      option.dataset.city = city;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.tabIndex = -1;
      const details = directory.find(
        (item) => item.name === city || item.label === city,
      );
      const name = document.createElement("strong");
      name.className = "work-city-name";
      name.textContent = details
        ? details.name.replace(/市$/, "") + "市"
        : city;
      const office = document.createElement("small");
      office.className = "work-city-office";
      office.textContent = details?.office || "";
      option.title = name.textContent + " · " + office.textContent;
      option.append(name, office);
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
    const details = directory.find(
      (item) => item.name === city || item.label === city,
    );
    $("workCity").value = details
      ? details.name.replace(/市$/, "") + "市"
      : city;
    $("workCity").dispatchEvent(new Event("input", { bubbles: true }));
    closeCities();
  }

  const datePlaceholders = ["YYYY", "MM", "DD"];
  let dateParts = ["", "", ""],
    dateSegment = 0,
    dateTyping = false,
    dateUnparsed = false,
    dateValidationShown = false;
  function dateValue() {
    const value = $("employmentDate").value;
    return value === datePlaceholders.join("-") ? "" : value;
  }
  function readDateText() {
    const input = $("employmentDate"),
      text = input.value.trim();
    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text),
      separated = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text),
      match = compact || separated;
    dateUnparsed =
      !!text &&
      !match &&
      !/^(?:\d{1,4}|YYYY)?(?:-(?:\d{0,2}|MM))?(?:-(?:\d{0,2}|DD))?$/.test(text);
    if (match) {
      dateParts = match
        .slice(1)
        .map((part, index) => (index ? part.padStart(2, "0") : part));
      input.value = dateParts.join("-");
    } else {
      dateParts = text
        .split("-")
        .slice(0, 3)
        .map((part) => (/^\d+$/.test(part) ? part : ""));
      while (dateParts.length < 3) dateParts.push("");
    }
    dateTyping = false;
  }
  function drawDate() {
    dateUnparsed = false;
    $("employmentDate").value = dateParts
      .map((part, index) => part || datePlaceholders[index])
      .join("-");
  }
  function selectDateSegment(index, typing = false) {
    dateSegment = Math.max(0, Math.min(2, index));
    dateTyping = typing;
    const parts = $("employmentDate").value.split("-"),
      start = parts
        .slice(0, dateSegment)
        .reduce((total, part) => total + part.length + 1, 0),
      end = start + (parts[dateSegment]?.length || 0);
    $("employmentDate").setSelectionRange(typing ? end : start, end);
  }
  function confirmDateSegment() {
    if (dateUnparsed) return;
    if (dateSegment && dateParts[dateSegment])
      dateParts[dateSegment] = dateParts[dateSegment].padStart(2, "0");
    drawDate();
  }
  function finishDate() {
    confirmDateSegment();
    if (!dateUnparsed && dateParts.every((part) => !part))
      $("employmentDate").value = "";
    dateTyping = false;
    savePersonal({ validate: true });
  }
  function editDate(event) {
    if (!event.cancelable || event.isComposing) return;
    const input = $("employmentDate"),
      allSelected =
        input.selectionStart === 0 && input.selectionEnd === input.value.length;
    if (event.inputType.startsWith("delete")) {
      event.preventDefault();
      if (allSelected) {
        dateParts = ["", "", ""];
        dateUnparsed = false;
        input.value = "";
        dateSegment = 0;
      } else {
        dateParts[dateSegment] =
          dateTyping && event.inputType === "deleteContentBackward"
            ? dateParts[dateSegment].slice(0, -1)
            : "";
        drawDate();
        selectDateSegment(dateSegment, !!dateParts[dateSegment]);
      }
      savePersonal();
      return;
    }
    if (
      event.inputType !== "insertText" &&
      event.inputType !== "insertReplacementText"
    )
      return;
    const data = event.data || "";
    if (data.length > 1) {
      event.preventDefault();
      input.value = data.trim();
      readDateText();
      if (!dateUnparsed) selectDateSegment(2);
      savePersonal();
      return;
    }
    if (!data) return;
    event.preventDefault();
    if (["-", "/", "."].includes(data)) {
      if (!dateParts[dateSegment]) return;
      confirmDateSegment();
      selectDateSegment(dateSegment + 1);
      savePersonal();
      return;
    }
    if (!/^\d$/.test(data)) return;
    if (allSelected) {
      dateParts = ["", "", ""];
      dateSegment = 0;
      dateTyping = false;
    }
    const width = dateSegment === 0 ? 4 : 2;
    dateParts[dateSegment] =
      dateTyping && dateParts[dateSegment].length < width
        ? dateParts[dateSegment] + data
        : data;
    const complete =
      dateParts[dateSegment].length === width ||
      (dateSegment === 1 && Number(data) >= 2) ||
      (dateSegment === 2 && Number(data) >= 4);
    if (complete && dateSegment)
      dateParts[dateSegment] = dateParts[dateSegment].padStart(2, "0");
    drawDate();
    selectDateSegment(
      complete ? Math.min(2, dateSegment + 1) : dateSegment,
      !complete,
    );
    savePersonal();
  }
  function bindDateInput() {
    const input = $("employmentDate");
    events.listen(input, "focus", () => {
      readDateText();
      if (dateUnparsed) {
        input.select();
        return;
      }
      drawDate();
      selectDateSegment(0);
    });
    events.listen(input, "click", () => {
      if (dateUnparsed || input.selectionStart !== input.selectionEnd) return;
      const position = input.selectionStart,
        parts = input.value.split("-");
      const index = dateParts.every((part) => !part)
        ? 0
        : position <= parts[0].length
          ? 0
          : position <= parts[0].length + parts[1].length + 1
            ? 1
            : 2;
      confirmDateSegment();
      selectDateSegment(index);
      savePersonal();
    });
    events.listen(input, "beforeinput", editDate);
    events.listen(input, "paste", (event) => {
      const text = event.clipboardData?.getData("text");
      if (text === undefined) return;
      event.preventDefault();
      input.value = text.trim();
      readDateText();
      if (input.value.includes("-")) selectDateSegment(2);
      savePersonal();
    });
    events.listen(input, "blur", finishDate);
    events.listen(input, "keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing)
        return;
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (
        ["ArrowLeft", "ArrowRight", "Tab", "-", "/", "."].includes(event.key)
      ) {
        if (["-", "/", "."].includes(event.key) && !dateParts[dateSegment]) {
          event.preventDefault();
          return;
        }
        const backwards =
            event.key === "ArrowLeft" ||
            (event.key === "Tab" && event.shiftKey),
          next = dateSegment + (backwards ? -1 : 1);
        confirmDateSegment();
        savePersonal();
        if (event.key === "Tab" && (next < 0 || next > 2)) return;
        event.preventDefault();
        selectDateSegment(next);
      }
    });
  }
  function refreshPersonalSettings() {
    $("employmentDate").value = model.state.personal.employmentDate;
    readDateText();
    dateValidationShown = false;
    $("workCity").value = model.state.personal.workCity;
    const selectedCity = directory.find(
      (item) =>
        item.name === $("workCity").value || item.label === $("workCity").value,
    );
    if (selectedCity)
      $("workCity").value = selectedCity.name.replace(/市$/, "") + "市";
    closeCities();
    WorkTimeApp.ui.fieldErrors.clear($("personalSettingsError"));
  }
  async function savePersonal({ validate = false, cityOnly = false } = {}) {
    const errorElement = $("personalSettingsError");
    try {
      let employmentDate = dateValue();
      const invalidDate = employmentDate && !C.validDate(employmentDate);
      if (invalidDate) {
        if (validate) throw Error("请填写完整且有效的入职日期。");
        if (!cityOnly) {
          if (dateValidationShown)
            WorkTimeApp.ui.fieldErrors.clear(errorElement);
          dateValidationShown = false;
          return;
        }
        employmentDate = model.state.personal.employmentDate;
      }
      const result = await application.savePersonal({
        employmentDate,
        workCity: $("workCity").value.trim(),
      });
      WorkTimeApp.ui.fieldErrors.show(
        errorElement,
        result.persisted
          ? null
          : {
              code: "UNSAVED",
              message: "设置尚未保存，请再次编辑重试或关闭后备份。",
            },
      );
      if (result.persisted && invalidDate && dateValidationShown)
        WorkTimeApp.ui.fieldErrors.show(errorElement, {
          code: "VALIDATION",
          message: "请填写完整且有效的入职日期。",
        });
      if (!invalidDate || !result.persisted) dateValidationShown = false;
      if (result.changed) actions.render();
      if (!result.persisted) actions.saveFeedback(false, "我的设置已更新");
    } catch (error) {
      dateValidationShown = true;
      WorkTimeApp.ui.fieldErrors.show(errorElement, {
        code: "VALIDATION",
        message: error.userMessage || error.message,
      });
    }
  }
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    events.listen(window, "resize", positionCities);
    events.listen(document, "scroll", positionCities, true);
    events.listen($("settingsDialog"), "close", closeCities);
    events.listen(
      $("pageSettingsPane"),
      "personal-settings-close",
      closeCities,
    );
    events.listen(
      $("pageSettingsPane"),
      "personal-settings-open",
      refreshPersonalSettings,
    );
    refreshPersonalSettings();
    bindDateInput();
    events.handler($("workCity"), "onfocus", () => showCities());
    events.handler($("workCity"), "onclick", () => {
      if ($("workCityOptions").hidden) showCities();
    });
    events.handler($("workCity"), "onblur", closeCities);
    events.handler($("workCityOptions"), "onpointerdown", (event) =>
      event.preventDefault(),
    );
    events.handler($("workCityOptions"), "onclick", (event) => {
      const option = event.target.closest("[data-city]");
      if (option) selectCity(option.dataset.city);
    });
    events.handler($("workCity"), "onkeydown", (event) => {
      if (event.key === "Escape" && !$("workCityOptions").hidden) {
        event.preventDefault();
        event.stopPropagation();
        closeCities();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if ($("workCityOptions").hidden) showCities();
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
        (event.key === " " || event.key === "Enter") &&
        $("workCityOptions").hidden
      ) {
        event.preventDefault();
        showCities();
      } else if (
        event.key === "Enter" &&
        !$("workCityOptions").hidden &&
        activeCity >= 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        selectCity(cityMatches[activeCity]);
      }
    });

    const onPersonalInput = (event) => {
      if (event.target === $("employmentDate")) {
        readDateText();
        savePersonal();
      } else savePersonal({ cityOnly: true });
    };
    events.handler($("personalSettingsForm"), "oninput", onPersonalInput);
    events.handler($("personalSettingsForm"), "onchange", onPersonalInput);
    events.handler($("personalSettingsForm"), "onsubmit", (event) => {
      event.preventDefault();
      finishDate();
    });
  }
  function dispose() {
    events.dispose();
    bound = false;
    closeCities();
  }
  function hasDraft() {
    if ($("pageSettingsPane").hidden) return false;
    const personal = model.state.personal;
    const city = directory.find(
      (item) =>
        item.name === personal.workCity || item.label === personal.workCity,
    );
    const displayCity = city
      ? city.name.replace(/市$/, "") + "市"
      : personal.workCity;
    return (
      dateValue() !== personal.employmentDate ||
      $("workCity").value !== displayCity
    );
  }
  return {
    bind,
    dispose,
    hasDraft,
    onSaveRecovered() {
      WorkTimeApp.ui.fieldErrors.saved($("personalSettingsError"));
    },
  };
};

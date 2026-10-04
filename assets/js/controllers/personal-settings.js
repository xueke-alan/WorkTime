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

  function refreshPersonalSettings() {
    $("employmentDate").value = model.state.personal.employmentDate;
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
  function savePersonal() {
    const errorElement = $("personalSettingsError");
    try {
      const employmentDate = $("employmentDate").value;
      if (employmentDate && !C.validDate(employmentDate))
        throw Error("请填写有效的入职日期。");
      const result = application.savePersonal({
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
      if (result.changed) actions.render();
      if (!result.persisted) actions.saveFeedback(false, "我的设置已更新");
    } catch (error) {
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

    events.handler($("personalSettingsForm"), "oninput", savePersonal);
    events.handler($("personalSettingsForm"), "onchange", savePersonal);
    events.handler($("personalSettingsForm"), "onsubmit", (event) =>
      event.preventDefault(),
    );
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
      $("employmentDate").value !== personal.employmentDate ||
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

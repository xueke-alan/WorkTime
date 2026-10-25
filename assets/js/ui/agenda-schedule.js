"use strict";
/** One value owner for an agenda's date range, all-day mode and times. */
WorkTimeApp.ui.createAgendaSchedule = function ({ root, prefix = "agenda" }) {
  const scope = new AbortController();
  const time = WorkTimeApp.domain.time;
  const t = (key) => WorkTimeApp.i18n.t("agenda." + key);
  const field = (name) => root.querySelector("#" + prefix + name);
  const icon =
    '<svg class="ui-icon" aria-hidden="true"><use href="#ms-calendar"/></svg>';
  const dateField = (name, open) =>
    `<div class="agenda-date-input"><input id="${prefix + name}" type="date" min="1900-01-01" max="9999-12-31"><button id="${prefix + open}" type="button" class="agenda-date-open">${icon}</button></div>`;
  root.classList.add("agenda-schedule-control");
  root.setAttribute("role", "group");
  root.setAttribute("aria-labelledby", prefix + "ScheduleLabel");
  root.innerHTML = `
    <label for="${prefix}ScheduleOpen" data-schedule-label="dateTime"></label>
    <button id="${prefix}ScheduleOpen" type="button" class="agenda-schedule-input">${icon}<span id="${prefix}ScheduleSummary"></span><svg class="ui-icon" aria-hidden="true"><use href="#ms-chevron-right"/></svg></button>
    <div id="${prefix}SchedulePopup" class="agenda-date-picker agenda-schedule agenda-schedule-popup" popover="auto" role="dialog">
    <div class="agenda-schedule-heading"><strong id="${prefix}ScheduleLabel">${icon}<span data-schedule-label="dateTime"></span></strong></div>
    <div class="agenda-schedule-options">
      <label class="agenda-schedule-toggle"><input id="${prefix}AllDay" type="checkbox" role="switch" checked><span class="agenda-schedule-toggle-track" aria-hidden="true"></span><span data-schedule-label="allDay"></span></label>
      <label class="agenda-schedule-toggle"><input id="${prefix}MultiDay" type="checkbox" role="switch"><span class="agenda-schedule-toggle-track" aria-hidden="true"></span><span data-schedule-label="multiDay"></span></label>
    </div>
    <div class="agenda-schedule-calendars"><div id="${prefix}StartCalendar"></div><div id="${prefix}EndCalendar" hidden></div></div>
    <div class="agenda-schedule-row">
      <div class="agenda-field"><label for="${prefix}DateInput"></label>${dateField("DateInput", "DateOpen")}</div>
      <div class="agenda-field agenda-schedule-time" hidden><label for="${prefix}Start" data-schedule-label="start"></label><input id="${prefix}Start" type="time"></div>
    </div>
    <div class="agenda-schedule-row agenda-schedule-end" hidden>
      <div id="${prefix}EndDateField" class="agenda-field" hidden><label for="${prefix}EndDateInput" data-schedule-label="endDate"></label>${dateField("EndDateInput", "EndDateOpen")}</div>
      <div class="agenda-schedule-same-day" data-schedule-label="sameDay" hidden></div>
      <div class="agenda-field agenda-schedule-time" hidden><label for="${prefix}End"></label><input id="${prefix}End" type="time"></div>
    </div><div class="agenda-picker-footer"><button type="button" class="ui-button" data-schedule-today data-schedule-label="pickerToday"></button><button type="button" class="ui-button primary" data-schedule-close data-schedule-label="pickerDone"></button></div></div>`;
  field("DateInput").required = true;
  const popup = field("SchedulePopup"),
    trigger = field("ScheduleOpen");
  trigger.setAttribute("aria-controls", popup.id);
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  let month = "",
    choosingEnd = false;
  const offsetMonth = (value, offset) => {
    const date = time.localDate(value + "-01");
    date.setMonth(date.getMonth() + offset);
    return time.dateKey(date).slice(0, 7);
  };
  const range = () => ({
    start: field("DateInput").value,
    end: field("MultiDay").checked
      ? field("EndDateInput").value
      : field("DateInput").value,
  });
  const pickers = [0, 1].map((index) =>
    WorkTimeApp.ui.createDatePicker({
      input: field(index ? "EndDateInput" : "DateInput"),
      button: field(index ? "EndDateOpen" : "DateOpen"),
      container: field(index ? "EndCalendar" : "StartCalendar"),
      inline: true,
      range,
      onChoose: choose,
      onMonthChange(value) {
        month = index ? offsetMonth(value, -1) : value;
        if (month < "1900-01") month = "1900-01";
        render();
      },
    }),
  );
  const isOpen = () => popup.matches(":popover-open");
  function close(restoreFocus = false) {
    if (!isOpen()) return;
    popup.hidePopover();
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  function place() {
    if (!isOpen()) return;
    const rect = trigger.getBoundingClientRect();
    popup.style.width =
      Math.min(field("MultiDay").checked ? 620 : 330, innerWidth - 24) + "px";
    popup.style.left =
      Math.max(
        12,
        Math.min(
          rect.right - popup.offsetWidth,
          innerWidth - popup.offsetWidth - 12,
        ),
      ) + "px";
    const height = popup.getBoundingClientRect().height;
    popup.style.top =
      Math.max(
        12,
        Math.min(
          rect.bottom + height + 7 <= innerHeight - 12
            ? rect.bottom + 7
            : rect.top - height - 7,
          innerHeight - height - 12,
        ),
      ) + "px";
  }
  function show() {
    if (trigger.closest("fieldset")?.disabled) return;
    month = (field("DateInput").value || time.businessDate(new Date())).slice(
      0,
      7,
    );
    choosingEnd = false;
    popup.showPopover();
    render();
    popup
      .querySelector(
        '.agenda-picker-day[aria-selected="true"]:not(.is-adjacent)',
      )
      ?.focus({ preventScroll: true });
  }
  function choose(date) {
    if (!field("MultiDay").checked) field("DateInput").value = date;
    else if (!choosingEnd) {
      field("DateInput").value = date;
      field("EndDateInput").value = date;
      choosingEnd = true;
    } else {
      const start = field("DateInput").value;
      field("DateInput").value = date < start ? date : start;
      field("EndDateInput").value = date < start ? start : date;
      choosingEnd = false;
    }
    field("DateInput").dispatchEvent(new Event("input", { bubbles: true }));
    render();
    popup
      .querySelector(`[data-picker-date="${date}"]:not(.is-adjacent)`)
      ?.focus({ preventScroll: true });
  }
  trigger.addEventListener("click", () => (isOpen() ? close(true) : show()), {
    signal: scope.signal,
  });
  popup.addEventListener(
    "toggle",
    () => trigger.setAttribute("aria-expanded", String(isOpen())),
    { signal: scope.signal },
  );
  popup.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    },
    { signal: scope.signal },
  );
  popup.addEventListener(
    "focusout",
    (event) => {
      if (
        event.relatedTarget instanceof Node &&
        !popup.contains(event.relatedTarget) &&
        event.relatedTarget !== trigger
      )
        close();
    },
    { signal: scope.signal },
  );
  popup
    .querySelector("[data-schedule-close]")
    .addEventListener("click", () => close(true), { signal: scope.signal });
  popup.querySelector("[data-schedule-today]").addEventListener(
    "click",
    () => {
      const today = time.businessDate(new Date());
      month = today.slice(0, 7);
      choosingEnd = false;
      choose(today);
    },
    { signal: scope.signal },
  );
  root.addEventListener("invalid", show, {
    capture: true,
    signal: scope.signal,
  });
  window.addEventListener("resize", place, { signal: scope.signal });
  document.addEventListener(
    "scroll",
    (event) => {
      if (!isOpen() || popup.contains(event.target)) return;
      const rect = trigger.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) close();
      else place();
    },
    { capture: true, signal: scope.signal },
  );
  function values() {
    return {
      date: field("DateInput").value,
      endDate: field("MultiDay").checked
        ? field("EndDateInput").value
        : field("DateInput").value,
      allDay: field("AllDay").checked,
      start: field("Start").value,
      end: field("End").value,
    };
  }
  function render() {
    const allDay = field("AllDay").checked,
      multiDay = field("MultiDay").checked;
    popup.classList.toggle("is-timed", !allDay);
    popup.classList.toggle("is-range", multiDay);
    field("EndCalendar").hidden = !multiDay;
    for (const label of root.querySelectorAll("[data-schedule-label]"))
      label.textContent = t(label.dataset.scheduleLabel);
    root.querySelector(`label[for="${prefix}DateInput"]`).textContent = t(
      multiDay ? "startDate" : "date",
    );
    root.querySelector(`label[for="${prefix}End"]`).textContent = t(
      multiDay ? "endRequired" : "end",
    );
    root.querySelector(".agenda-schedule-end").hidden = allDay && !multiDay;
    root.querySelector(".agenda-schedule-same-day").hidden = multiDay || allDay;
    field("EndDateField").hidden = !multiDay;
    field("EndDateInput").required = multiDay;
    field("EndDateInput").disabled = !multiDay;
    field("EndDateInput").min = field("DateInput").value || "1900-01-01";
    field("EndDateOpen").disabled = !multiDay;
    for (const node of root.querySelectorAll(".agenda-schedule-time"))
      node.hidden = allDay;
    field("Start").required = !allDay;
    field("Start").disabled = allDay;
    field("End").disabled = allDay;
    field("End").required = !allDay && multiDay;
    const value = values();
    const formatted = (date, timeValue) =>
      date + (timeValue ? " " + timeValue : "");
    field("ScheduleSummary").textContent =
      formatted(value.date, allDay ? "" : value.start) +
      (multiDay
        ? " — " + formatted(value.endDate, allDay ? "" : value.end)
        : !allDay && value.end
          ? " — " + value.end
          : "") +
      (allDay ? " · " + t("allDay") : "");
    trigger.title = field("ScheduleSummary").textContent;
    popup.setAttribute("aria-label", t("dateTime"));
    if (!month)
      month = (value.date || time.businessDate(new Date())).slice(0, 7);
    if (multiDay && month >= "9999-12") month = "9999-11";
    // Date grids are needed only while the editor's popover is visible.
    // Attendance startup and ordinary saves must not build hidden calendars.
    if (isOpen()) {
      pickers[0].setMonth(month);
      pickers[1].setMonth(multiDay ? offsetMonth(month, 1) : month);
      place();
    }
  }
  root.addEventListener(
    "input",
    (event) => {
      if (
        event.isTrusted &&
        event.target === field("DateInput") &&
        time.validDate(field("DateInput").value)
      )
        month = field("DateInput").value.slice(0, 7);
      if (
        event.isTrusted &&
        event.target === field("EndDateInput") &&
        time.validDate(field("EndDateInput").value)
      )
        month = offsetMonth(field("EndDateInput").value.slice(0, 7), -1);
      if (
        event.target === field("MultiDay") &&
        field("MultiDay").checked &&
        field("EndDateInput").value <= field("DateInput").value
      ) {
        const start = field("DateInput").value;
        if (time.validDate(start)) {
          const next = time.localDate(start);
          next.setDate(next.getDate() + 1);
          const end = time.dateKey(next);
          field("EndDateInput").value = time.validDate(end) ? end : start;
        }
      }
      render();
    },
    { signal: scope.signal },
  );
  return {
    values,
    render,
    close,
    setValue(value) {
      close();
      month = (value.date || time.businessDate(new Date())).slice(0, 7);
      field("DateInput").value = value.date || "";
      field("EndDateInput").value = value.endDate || value.date || "";
      field("MultiDay").checked = (value.endDate || value.date) > value.date;
      field("AllDay").checked = value.allDay ?? true;
      field("Start").value = value.start || "";
      field("End").value = value.end || "";
      render();
    },
    dispose() {
      close();
      scope.abort();
      pickers.forEach((picker) => picker.dispose());
    },
  };
};

"use strict";
/** Theme-aware date popover; the native date field remains the form value owner. */
WorkTimeApp.ui.createDatePicker = function ({
  input,
  button,
  container,
  inline = false,
  onChoose,
  onMonthChange,
  range,
}) {
  const scope = new AbortController();
  const time = WorkTimeApp.domain.time;
  const i18n = WorkTimeApp.i18n;
  const t = (key) => i18n.t("agenda." + key);
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  let month = "",
    focused = "",
    rendered = "";
  const popup = document.createElement("div");
  popup.id = input.id + "Picker";
  popup.className = "agenda-date-picker";
  if (!inline) popup.setAttribute("popover", "auto");
  else popup.classList.add("agenda-inline-calendar");
  popup.setAttribute("role", inline ? "group" : "dialog");
  popup.innerHTML =
    '<div class="agenda-picker-heading"><button type="button" class="ui-button icon-only" data-picker-step="-1"><svg class="ui-icon" aria-hidden="true"><use href="#ms-chevron-left"/></svg></button><strong class="agenda-picker-month" aria-live="polite"></strong><button type="button" class="ui-button icon-only" data-picker-step="1"><svg class="ui-icon" aria-hidden="true"><use href="#ms-chevron-right"/></svg></button></div><div class="agenda-picker-weekdays" aria-hidden="true"></div><div class="agenda-picker-grid" role="grid"></div><div class="agenda-picker-footer"><button type="button" class="ui-button" data-picker-today></button><button type="button" class="ui-button" data-picker-close></button></div>';
  (container || input.parentElement).append(popup);
  if (inline) popup.querySelector(".agenda-picker-footer").hidden = true;
  button.setAttribute("aria-controls", popup.id);
  const listen = (node, event, callback, options = {}) =>
    node.addEventListener(event, callback, {
      ...options,
      signal: scope.signal,
    });
  const open = () => inline || popup.matches(":popover-open");
  const valid = (date) =>
    time.validDate(date) &&
    date >= (range ? "1900-01-01" : input.min) &&
    date <= input.max;
  const today = () => time.businessDate(new Date());
  function close(restoreFocus = false) {
    if (inline) return;
    if (!open()) return;
    popup.hidePopover();
    if (restoreFocus) button.focus({ preventScroll: true });
  }
  function place() {
    if (inline) return;
    const rect = input.getBoundingClientRect();
    const width = Math.min(286, innerWidth - 24);
    popup.style.width = width + "px";
    popup.style.left =
      Math.max(12, Math.min(rect.right - width, innerWidth - width - 12)) +
      "px";
    const height = popup.getBoundingClientRect().height;
    const below = rect.bottom + 7;
    popup.style.top =
      Math.max(
        12,
        Math.min(
          below + height <= innerHeight - 12 ? below : rect.top - height - 7,
          innerHeight - height - 12,
        ),
      ) + "px";
  }
  function render() {
    button.setAttribute("aria-label", t("chooseDate"));
    button.title = t("chooseDate");
    popup.setAttribute("aria-label", t("chooseDate"));
    if (!month) return;
    const signature = JSON.stringify([
      month,
      focused,
      input.value,
      input.min,
      input.max,
      i18n.locale,
      today(),
      range?.(),
    ]);
    if (signature === rendered) return;
    rendered = signature;
    const first = time.localDate(month + "-01");
    popup.querySelector(".agenda-picker-month").textContent =
      new Intl.DateTimeFormat(i18n.locale, {
        year: "numeric",
        month: "long",
      }).format(first);
    for (const step of [-1, 1]) {
      const nav = popup.querySelector(`[data-picker-step="${step}"]`);
      nav.setAttribute(
        "aria-label",
        i18n.t(step < 0 ? "copy.69bb1687b5" : "copy.8c9b38e26d"),
      );
      nav.disabled =
        step < 0
          ? month <= input.min.slice(0, 7)
          : month >= input.max.slice(0, 7);
    }
    popup.querySelector("[data-picker-today]").textContent = t("pickerToday");
    popup.querySelector("[data-picker-close]").textContent = t("pickerClose");
    const weekday = new Intl.DateTimeFormat(i18n.locale, { weekday: "narrow" });
    popup.querySelector(".agenda-picker-weekdays").innerHTML = Array.from(
      { length: 7 },
      (_, index) =>
        `<span>${escape(weekday.format(new Date(2026, 0, 5 + index)))}</span>`,
    ).join("");
    const start = new Date(first);
    const selectedRange = range?.();
    start.setDate(1 - ((first.getDay() + 6) % 7));
    const cells = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = time.dateKey(date);
      const selected = selectedRange
        ? key === selectedRange.start || key === selectedRange.end
        : key === input.value;
      const inRange =
        selectedRange && key > selectedRange.start && key < selectedRange.end;
      return `<button type="button" role="gridcell" data-picker-date="${key}" class="agenda-picker-day${key.slice(0, 7) !== month ? " is-adjacent" : ""}${inRange ? " is-in-range" : ""}" aria-label="${escape(time.validDate(key) ? i18n.date(key) : String(date.getDate()))}" aria-selected="${selected}"${key === today() ? ' aria-current="date"' : ""} tabindex="${key === focused ? 0 : -1}"${valid(key) ? "" : " disabled"}>${escape(i18n.number(date.getDate()))}</button>`;
    });
    popup.querySelector(".agenda-picker-grid").innerHTML = Array.from(
      { length: 6 },
      (_, row) =>
        `<div role="row">${cells.slice(row * 7, row * 7 + 7).join("")}</div>`,
    ).join("");
    if (open()) place();
  }
  function focusDate(date) {
    if (!valid(date)) return;
    focused = date;
    month = date.slice(0, 7);
    onMonthChange?.(month);
    render();
    popup
      .querySelector(`[data-picker-date="${date}"]`)
      ?.focus({ preventScroll: true });
  }
  function choose(date) {
    if (!valid(date)) return;
    if (onChoose) {
      onChoose(date);
      return;
    }
    input.value = date;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close(true);
  }
  function show() {
    if (input.disabled || input.closest("fieldset")?.disabled) return;
    focused = valid(input.value) ? input.value : today();
    month = focused.slice(0, 7);
    if (inline) onMonthChange?.(month);
    render();
    if (inline) {
      popup
        .querySelector(`[data-picker-date="${focused}"]`)
        ?.focus({ preventScroll: true });
      return;
    }
    popup.showPopover();
    place();
    popup
      .querySelector(`[data-picker-date="${focused}"]`)
      ?.focus({ preventScroll: true });
  }
  listen(button, "click", () =>
    inline ? show() : open() ? close(true) : show(),
  );
  listen(input, "keydown", (event) => {
    if (event.key === "ArrowDown" && event.altKey) {
      event.preventDefault();
      show();
    }
  });
  listen(popup, "toggle", () =>
    button.setAttribute("aria-expanded", String(open())),
  );
  listen(popup, "click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    event.stopPropagation();
    if (target.dataset.pickerDate) choose(target.dataset.pickerDate);
    else if (target.hasAttribute("data-picker-today")) choose(today());
    else if (target.hasAttribute("data-picker-close")) close(true);
    else if (target.dataset.pickerStep) {
      const next = time.localDate(month + "-01");
      next.setMonth(next.getMonth() + Number(target.dataset.pickerStep));
      month = time.dateKey(next).slice(0, 7);
      onMonthChange?.(month);
      focused = month + "-01";
      render();
    }
  });
  listen(popup, "keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    const date = event.target.closest("[data-picker-date]")?.dataset.pickerDate;
    if (!date) return;
    const next = time.localDate(date);
    const offsets = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -((next.getDay() + 6) % 7),
      End: 6 - ((next.getDay() + 6) % 7),
    };
    if (Object.hasOwn(offsets, event.key))
      next.setDate(next.getDate() + offsets[event.key]);
    else if (["PageUp", "PageDown"].includes(event.key)) {
      const day = next.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + (event.key === "PageUp" ? -1 : 1));
      const last = new Date(
        next.getFullYear(),
        next.getMonth() + 1,
        0,
      ).getDate();
      next.setDate(Math.min(day, last));
    } else return;
    event.preventDefault();
    focusDate(time.dateKey(next));
  });
  listen(window, "resize", () => {
    if (open()) place();
  });
  listen(
    document,
    "scroll",
    (event) => {
      if (open() && !popup.contains(event.target)) {
        const rect = input.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > innerHeight) close();
        else place();
      }
    },
    { capture: true },
  );
  if (!inline) {
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
  }
  render();
  return {
    render,
    close,
    setMonth(value, focus) {
      month = value;
      focused =
        focus ?? (focused.slice(0, 7) === value ? focused : input.value);
      render();
    },
    dispose() {
      close();
      scope.abort();
      popup.remove();
    },
  };
};

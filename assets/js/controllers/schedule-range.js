"use strict";
/** Owns the range fields and accessible range picker, independently of schedule editing. */
WorkTimeApp.ui.createScheduleRangeController = function ({
  element: $,
  rangeForChoice,
  today,
}) {
  const events = WorkTimeApp.ui.createEventScope();
  let rangeToday = "",
    bound = false;
  function readRange() {
    return rangeForChoice(
      $("scheduleRangeChoice").value,
      rangeToday,
      $("scheduleRangeStart").value,
      $("scheduleNoEnd").checked ? null : $("scheduleRangeEnd").value,
    );
  }
  function closeRangePicker(returnFocus = false) {
    $("scheduleRangeOptions").hidden = true;
    $("scheduleRangeTrigger").setAttribute("aria-expanded", "false");
    if (returnFocus) $("scheduleRangeTrigger").focus();
  }
  function positionRangePicker() {
    const list = $("scheduleRangeOptions");
    if (list.hidden) return;
    const rect = $("scheduleRangeTrigger").getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const height = Math.min(list.scrollHeight, Math.max(below, above), 280);
    list.style.width = rect.width + "px";
    list.style.maxHeight = height + "px";
    list.style.left = rect.left + "px";
    list.style.top =
      (below >= height ? rect.bottom + 6 : rect.top - height - 6) + "px";
  }
  function syncRangePicker() {
    const select = $("scheduleRangeChoice");
    $("scheduleRangeValue").textContent = select.selectedOptions[0].textContent;
    $("scheduleRangeOptions")
      .querySelectorAll("[data-range]")
      .forEach((option) =>
        option.setAttribute(
          "aria-selected",
          String(option.dataset.range === select.value),
        ),
      );
  }
  function openRangePicker() {
    syncRangePicker();
    $("scheduleRangeOptions").hidden = false;
    $("scheduleRangeTrigger").setAttribute("aria-expanded", "true");
    positionRangePicker();
    $("scheduleRangeOptions").querySelector('[aria-selected="true"]').focus();
  }
  function updateRangeDescription() {
    syncRangePicker();
    const custom = $("scheduleRangeChoice").value === "custom";
    $("scheduleCustomDates").hidden = !custom;
    $("scheduleNoEndLabel").hidden = !custom;
    $("scheduleRangeEnd").disabled = $("scheduleNoEnd").checked;
    $("scheduleRangeError").textContent = "";
    try {
      const range = readRange();
      $("scheduleRangeDescription").textContent =
        range.start === null
          ? "全部日期：将替换全部作息安排，并重新计算历史统计。"
          : range.start +
            (range.end
              ? " 至 " + range.end + "（包含首尾两天）"
              : " 起持续生效，覆盖此后全部作息。");
    } catch (error) {
      $("scheduleRangeDescription").textContent =
        "请填写完整且有效的日期范围。";
    }
  }

  function open({ preferred, editingDate }) {
    rangeToday = today();
    closeRangePicker();
    $("scheduleRangeChoice").value = preferred?.choice || "future";
    $("scheduleRangeStart").value = preferred?.start || editingDate;
    $("scheduleRangeEnd").value = preferred?.end || editingDate;
    $("scheduleNoEnd").checked =
      preferred?.choice === "custom" && preferred.end === null;
    updateRangeDescription();
  }
  function bind() {
    if (bound) return;
    bound = true;
    $("scheduleRangeOptions").replaceChildren();
    for (const item of $("scheduleRangeChoice").options) {
      const option = document.createElement("button");
      option.className = "ui-button";
      option.type = "button";
      option.tabIndex = -1;
      option.dataset.range = item.value;
      option.setAttribute("role", "option");
      const label = document.createElement("span");
      label.className = "button-label";
      label.textContent = item.textContent;
      option.append(label);
      events.handler(option, "onclick", () => {
        $("scheduleRangeChoice").value = item.value;
        updateRangeDescription();
        closeRangePicker(true);
      });
      $("scheduleRangeOptions").append(option);
    }
    events.handler($("scheduleRangeTrigger"), "onclick", () => {
      if ($("scheduleRangeOptions").hidden) openRangePicker();
      else closeRangePicker();
    });
    events.handler($("scheduleRangePicker"), "onkeydown", (event) => {
      const list = $("scheduleRangeOptions");
      if (event.key === "Escape" && !list.hidden) {
        event.preventDefault();
        event.stopPropagation();
        closeRangePicker(true);
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (list.hidden) {
          openRangePicker();
          return;
        }
        const items = [...list.children];
        const index = items.indexOf(document.activeElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length;
        items[next].focus();
      } else if (event.key === "Tab") closeRangePicker();
    });
    events.listen(document, "pointerdown", (event) => {
      if (!$("scheduleRangePicker").contains(event.target)) closeRangePicker();
    });
    events.listen($("scheduleRangePicker"), "focusout", (event) => {
      if (!$("scheduleRangePicker").contains(event.relatedTarget))
        closeRangePicker();
    });
    events.listen(window, "resize", positionRangePicker);
    events.listen(
      $("scheduleRangeDialog").querySelector(".dialog-body"),
      "scroll",
      positionRangePicker,
    );
    events.handler(
      $("scheduleRangeChoice"),
      "onchange",
      updateRangeDescription,
    );
    events.handler($("scheduleRangeStart"), "oninput", updateRangeDescription);
    events.handler($("scheduleRangeEnd"), "oninput", updateRangeDescription);
    events.handler($("scheduleNoEnd"), "onchange", updateRangeDescription);

    events.listen($("scheduleRangeDialog"), "close", () => closeRangePicker());
  }
  function dispose() {
    closeRangePicker();
    events.dispose();
    bound = false;
  }
  return { bind, dispose, open, read: readRange };
};

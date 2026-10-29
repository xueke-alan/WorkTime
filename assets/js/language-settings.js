"use strict";
/** Language changes are immediate; saving follows the existing archive owner. */
(() => {
  const i18n = WorkTimeApp.i18n;
  const preferences = WorkTimeApp.services.preferences.page;
  function icon(name, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ui-icon " + className);
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#ms-" + name);
    svg.append(use);
    return svg;
  }
  function mountPicker(host, config) {
    const field = document.createElement("div");
    field.className = "field language-settings";
    const label = document.createElement("label");
    label.id = config.id + "Label";
    label.htmlFor = config.id + "Trigger";
    const select = document.createElement("select");
    select.id = config.selectId;
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    const trigger = document.createElement("button");
    trigger.id = config.id + "Trigger";
    trigger.type = "button";
    trigger.className = "ui-button language-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", config.id + "Options");
    trigger.setAttribute(
      "aria-labelledby",
      label.id + " " + config.id + "Value",
    );
    const valueLabel = document.createElement("span");
    valueLabel.id = config.id + "Value";
    valueLabel.className = "button-label";
    const chevron = icon("chevron-right", "language-chevron");
    trigger.append(valueLabel, chevron);
    const list = document.createElement("div");
    list.id = config.id + "Options";
    list.className = "settings-select-options";
    list.hidden = true;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-labelledby", label.id);
    for (const { id: value, name } of config.options()) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = name;
      select.append(option);
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ui-button";
      item.tabIndex = -1;
      item.dataset.value = value;
      item.setAttribute("role", "option");
      const itemLabel = document.createElement("span");
      itemLabel.className = "button-label";
      item.append(itemLabel, icon("check", "language-selected-icon"));
      item.addEventListener("click", () => {
        select.value = value;
        close(true);
        select.dispatchEvent(new Event("change"));
      });
      list.append(item);
    }
    const notice = document.createElement("p");
    notice.className = "theme-save-notice";
    notice.setAttribute("role", "status");
    const help = document.createElement("p");
    help.className = "help";
    help.id = config.id + "Help";
    help.setAttribute("role", "status");
    if (config.help) trigger.setAttribute("aria-describedby", help.id);
    function synchronize() {
      label.textContent = i18n.t(config.label);
      if (config.help) {
        help.textContent = config.help();
        help.hidden = !help.textContent;
      }
      config.options().forEach((option, index) => {
        select.options[index].textContent = option.name;
      });
      select.value = config.read();
      valueLabel.textContent = select.selectedOptions[0].textContent;
      trigger.title = valueLabel.textContent;
      [...list.children].forEach((item, index) => {
        item.querySelector(".button-label").textContent =
          select.options[index].textContent;
        item.setAttribute(
          "aria-selected",
          String(item.dataset.value === select.value),
        );
      });
      position();
    }
    function close(returnFocus = false) {
      list.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (returnFocus) trigger.focus();
    }
    function position() {
      if (list.hidden) return;
      const rect = trigger.getBoundingClientRect();
      const bounds = field
        .closest(".page-settings-body")
        .getBoundingClientRect();
      if (rect.bottom > bounds.bottom || rect.top < bounds.top) {
        close();
        return;
      }
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      list.style.width = rect.width + "px";
      list.style.maxHeight = Math.max(0, Math.max(below, above)) + "px";
      list.style.left = rect.left + "px";
      const height = list.getBoundingClientRect().height;
      list.style.top =
        (below >= height ? rect.bottom + 6 : rect.top - height - 6) + "px";
    }
    function open() {
      synchronize();
      list.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      position();
      list.querySelector('[aria-selected="true"]').focus();
    }
    trigger.addEventListener("click", () => {
      if (list.hidden) open();
      else close();
    });
    field.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !list.hidden) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (list.hidden) {
          open();
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
      } else if (event.key === "Tab") close();
    });
    field.addEventListener("focusout", (event) => {
      if (!field.contains(event.relatedTarget)) close();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!field.contains(event.target)) close();
    });
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    let languageRevision = 0;
    select.addEventListener("change", async () => {
      const revision = ++languageRevision;
      field.setAttribute("aria-busy", "true");
      try {
        const result = await config.save(select.value);
        if (revision !== languageRevision) return;
        synchronize();
        notice.textContent = result.persisted ? "" : i18n.t(config.failed);
      } finally {
        if (revision === languageRevision) field.removeAttribute("aria-busy");
      }
    });
    const unsubscribe = preferences.subscribe((state, result) => {
      synchronize();
      if (result.preferenceNames?.includes(config.preference))
        notice.textContent =
          result.persisted || result.pending ? "" : i18n.t(config.failed);
    });
    document.addEventListener("worktime:languagechange", synchronize);
    const stopClock = config.help
      ? WorkTimeApp.services.clock
          .create({ dateKey: WorkTimeApp.domain.time.businessDate })
          .watch({ document, onChange: synchronize })
      : () => {};
    window.addEventListener(
      "pagehide",
      () => {
        languageRevision++;
        unsubscribe();
        stopClock();
        document.removeEventListener("worktime:languagechange", synchronize);
      },
      { once: true },
    );
    field.append(label, select, trigger, list, notice);
    if (config.help) field.append(help);
    host.append(field);
    synchronize();
  }
  function mount() {
    if (document.documentElement.dataset.appState === "failed") return;
    const host = document.querySelector(".settings-archive-actions");
    if (!host) return;
    const row = document.createElement("div");
    row.className = "settings-select-row";
    const divider = document.createElement("hr");
    divider.className = "settings-content-divider";
    host.before(row, divider);
    const backupRow = document.createElement("div");
    backupRow.className = "auto-backup-settings";
    host.before(backupRow);
    backupRow.append(host);
    function backupStatus() {
      const saved = preferences.state.lastBackupAt;
      if (!saved) return "";
      const date = new Date(saved);
      if (!Number.isFinite(date.getTime())) return "";
      const shifted = new Date(date.getTime() + 8 * 3600000);
      const day = WorkTimeApp.domain.time.businessDate(date);
      const time = {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: String(shifted.getUTCHours()).padStart(2, "0"),
        minute: String(shifted.getUTCMinutes()).padStart(2, "0"),
      };
      return i18n.t(
        day === WorkTimeApp.domain.time.businessDate(new Date())
          ? "autoBackup.savedToday"
          : "autoBackup.savedDate",
        time,
      );
    }
    mountPicker(backupRow, {
      id: "autoBackup",
      selectId: "autoBackupDays",
      label: "autoBackup.label",
      preference: "autoBackupDays",
      failed: "autoBackup.saveFailed",
      help: backupStatus,
      options: () =>
        [0, 1, 3, 7].map((days) => ({
          id: String(days),
          name: i18n.t("autoBackup.option" + days),
        })),
      read: () => String(preferences.state.autoBackupDays ?? 0),
      save: (value) => preferences.saveAutoBackupDays(Number(value)),
    });
    mountPicker(row, {
      id: "weather",
      selectId: "weatherDays",
      label: "weather.settings.label",
      preference: "weatherDays",
      failed: "copy.121c73541e",
      options: () =>
        [3, 5, 7, 0].map((days) => ({
          id: String(days),
          name: i18n.t(
            days ? "weather.settings.days" : "weather.settings.off",
            {
              days,
            },
          ),
        })),
      read: () => String(preferences.state.weatherDays ?? 5),
      save: (value) => preferences.saveWeatherDays(Number(value)),
    });
    mountPicker(row, {
      id: "language",
      selectId: "languageSelect",
      label: "language.label",
      preference: "language",
      failed: "language.failed",
      options: () => i18n.languages,
      read: () => i18n.preference,
      save: (value) => preferences.saveLanguage(value),
    });
  }
  document.addEventListener("DOMContentLoaded", mount, { once: true });
})();

"use strict";
/** Render the shared preference owner's theme and picker; no storage writes. */
(() => {
  const preferences = WorkTimeApp.services.preferences.page;
  const { themes, normalize } = WorkTimeApp.domain.preferences;
  const favicon = document.querySelector('link[rel="icon"]');
  const originalIcon = favicon?.getAttribute("href");
  let current = "green";
  let unsubscribeTheme = null;
  function connect() {
    if (!unsubscribeTheme)
      unsubscribeTheme = preferences.subscribe((state) =>
        apply(state.pageTheme),
      );
    apply(preferences.state.pageTheme);
  }
  function apply(id) {
    const theme = normalize(id);
    const root = document.documentElement;
    if (current === theme && root.dataset.theme === theme) return theme;
    current = theme;
    const color = themes.find((item) => item.id === theme).color;
    root.dataset.theme = theme;
    if (originalIcon) {
      favicon.setAttribute(
        "href",
        theme === "green"
          ? originalIcon
          : originalIcon.replace("%2324775f", "%23" + color.slice(1)),
      );
    }
    document.dispatchEvent(new Event("worktime:themechange"));
    return theme;
  }
  function mount(container) {
    connect();
    const fieldset = document.createElement("fieldset");
    fieldset.className = "theme-settings";
    const legend = document.createElement("legend");
    legend.textContent = "页面主题色";
    const grid = document.createElement("div");
    grid.className = "theme-grid";
    for (const theme of themes) {
      const label = document.createElement("label");
      label.className = "theme-card";
      label.title = theme.name;
      label.style.setProperty("--theme-option-color", theme.color);
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "pageTheme";
      input.value = theme.id;
      const swatch = document.createElement("span");
      swatch.className = "theme-swatch";
      swatch.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.className = "theme-name";
      name.textContent = theme.name;
      label.append(input, swatch, name);
      grid.append(label);
    }
    const notice = document.createElement("p");
    notice.className = "theme-save-notice";
    notice.setAttribute("role", "status");
    fieldset.append(legend, grid, notice);
    container.replaceChildren(fieldset);
    function synchronize() {
      for (const radio of grid.querySelectorAll("input"))
        if (radio.type === "radio") radio.checked = radio.value === current;
    }
    function change(event) {
      if (!event.target.matches('input[name="pageTheme"]')) return;
      preferences.saveTheme(event.target.value);
    }
    const unsubscribe = preferences.subscribe((state, result) => {
      notice.textContent = result.persisted
        ? ""
        : result.pending
          ? "正在保存主题…"
          : "主题已应用，但未能保存，刷新后可能恢复默认";
    });
    grid.addEventListener("change", change);
    document.addEventListener("worktime:themechange", synchronize);
    synchronize();
    return {
      dispose() {
        grid.removeEventListener("change", change);
        document.removeEventListener("worktime:themechange", synchronize);
        unsubscribe();
      },
    };
  }
  WorkTimeApp.ui.theme = Object.freeze({
    apply,
    mount,
    dispose() {
      unsubscribeTheme?.();
      unsubscribeTheme = null;
    },
  });
  connect();
})();

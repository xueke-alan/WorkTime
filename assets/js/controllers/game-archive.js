"use strict";
/** One modal shared by the sidebar and expanded game menus. */
WorkTimeApp.ui.createGameArchiveController = function ({ document, window }) {
  const service = WorkTimeApp.services.gameArchive;
  const clipboard = WorkTimeApp.services.clipboard.create(
    () => window.navigator.clipboard,
  );
  const downloads = WorkTimeApp.services.downloads.create({
    document,
    URL: window.URL,
    Blob: window.Blob,
  });
  const events = WorkTimeApp.ui.createEventScope();
  const controls = new Map();
  const t = (key, params) => WorkTimeApp.i18n.t("gameArchive." + key, params);
  let generation = 0;
  let disposed = false,
    busy = false,
    committing = false,
    archive = null,
    previewed = null,
    origin = null;
  function node(tag, className, parent) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    parent?.append(element);
    return element;
  }
  function button(parent, key, callback) {
    const element = node("button", "ui-button", parent);
    element.type = "button";
    element.textContent = t(key);
    element.onclick = callback;
    return element;
  }
  function message(error) {
    const code = [
      "invalid",
      "wrongType",
      "version",
      "empty",
      "tooLarge",
      "localInvalid",
      "changed",
      "recovery",
      "noBackup",
    ].includes(error?.code)
      ? error.code
      : "storageError";
    const game = WorkTimeApp.games.get(error?.game);
    return (
      t(code) +
      (error?.game
        ? " · " + (game ? WorkTimeApp.i18n.t(game.nameKey) : error.game)
        : "")
    );
  }
  function announce(text) {
    for (const status of controls.values()) status.textContent = text;
  }
  const dialog = node("dialog", "game-archive-dialog", document.body);
  const heading = node("h2", "", dialog);
  heading.id = "gameArchiveTitle";
  dialog.setAttribute("aria-labelledby", heading.id);
  const inputLabel = node("label", "game-archive-input-label", dialog);
  inputLabel.htmlFor = "gameArchiveText";
  const input = node("textarea", "", dialog);
  input.id = "gameArchiveText";
  input.spellcheck = false;
  const file = node("input", "", dialog);
  file.type = "file";
  file.accept = ".json,.txt,application/json,text/plain";
  file.hidden = true;
  const tools = node("div", "game-archive-actions", dialog);
  const chooseFile = button(tools, "file", () => file.click());
  const readText = button(tools, "preview", () => loadText(input.value));
  const backup = button(tools, "before", () => {
    try {
      download(service.previousBackup(), "before");
    } catch (error) {
      errorText.textContent = message(error);
    }
  });
  const summary = node("div", "game-archive-preview", dialog);
  const errorText = node("p", "game-archive-error", dialog);
  errorText.setAttribute("role", "alert");
  const footer = node(
    "div",
    "game-archive-actions game-archive-footer",
    dialog,
  );
  const cancel = button(footer, "cancel", () => dialog.close());
  const confirm = button(footer, "confirm", async () => {
    if (!previewed || busy) return;
    busy = true;
    committing = true;
    for (const element of [input, chooseFile, readText, backup, cancel])
      element.disabled = true;
    confirm.disabled = true;
    try {
      const rows = await service.commit(previewed);
      announce(
        t("done", {
          added: rows.filter((r) => r.status === "added").length,
          merged: rows.filter((r) => r.status === "merged").length,
          unchanged: rows.filter((r) => r.status === "unchanged").length,
        }),
      );
      dialog.close();
    } catch (error) {
      if (error.code === "changed") {
        try {
          renderPreview({});
        } catch (refreshError) {
          errorText.textContent = message(refreshError);
          return;
        }
        errorText.textContent = t("changed");
      } else errorText.textContent = message(error);
    } finally {
      busy = false;
      committing = false;
      for (const element of [input, chooseFile, readText, backup, cancel])
        element.disabled = false;
      confirm.disabled = !previewed?.rows.length;
    }
  });
  confirm.classList.add("primary");
  function download(value, suffix = "") {
    downloads.download(
      "worktime-games" +
        (suffix ? "-" + suffix : "") +
        "-" +
        new Date().toISOString().slice(0, 10) +
        ".json",
      JSON.stringify(value, null, 2),
      "application/json;charset=utf-8",
    );
  }
  function renderPreview(choices = {}) {
    previewed = null;
    confirm.disabled = true;
    summary.replaceChildren();
    previewed = service.preview(archive, choices);
    const note = node("p", "", summary);
    note.textContent = t("mergeNote");
    for (const row of previewed.rows) {
      const line = node("div", "game-archive-row", summary);
      const name = WorkTimeApp.games.get(row.id);
      const label = node("strong", "", line);
      label.textContent = name ? WorkTimeApp.i18n.t(name.nameKey) : row.id;
      const result = node("span", "", line);
      result.textContent =
        t(row.status) +
        (row.improved && row.status !== "added" ? " · " + t("improved") : "");
      if (row.draftsAdded)
        result.textContent +=
          " · " + t("draftsAdded", { count: row.draftsAdded });
      if (row.completedAdded)
        result.textContent +=
          " · " + t("completedAdded", { count: row.completedAdded });
      if (row.conflict) {
        const selectLabel = node("label", "", line);
        selectLabel.textContent = t("conflict");
        const select = node("select", "", selectLabel);
        select.setAttribute(
          "aria-label",
          label.textContent + " · " + t("conflict"),
        );
        for (const source of ["local", "incoming"]) {
          const option = node("option", "", select);
          option.value = source;
          option.textContent = t(source);
        }
        select.value = choices[row.id] || "local";
        select.onchange = () => {
          const next = { ...previewed.choices, [row.id]: select.value };
          const focusedId = row.id;
          try {
            renderPreview(next);
          } catch (error) {
            errorText.textContent = message(error);
            return;
          }
          summary
            .querySelector('[data-game-conflict="' + focusedId + '"]')
            ?.focus();
        };
        select.dataset.gameConflict = row.id;
      }
    }
    confirm.disabled = !previewed.rows.length;
    if (!previewed.rows.length) errorText.textContent = t("empty");
  }
  async function loadText(text) {
    if (busy || disposed) return;
    const token = ++generation;
    busy = true;
    confirm.disabled = true;
    previewed = null;
    archive = null;
    summary.replaceChildren();
    errorText.textContent = "";
    try {
      const decoded = await service.decode(text);
      if (disposed || !dialog.open || token !== generation) return;
      archive = decoded;
      renderPreview();
    } catch (error) {
      if (!disposed && token === generation)
        errorText.textContent = message(error);
    } finally {
      if (token === generation) busy = false;
    }
  }
  function translate() {
    heading.textContent = t("import");
    inputLabel.textContent = t("paste");
    for (const [element, key] of [
      [chooseFile, "file"],
      [readText, "preview"],
      [backup, "before"],
      [cancel, "cancel"],
      [confirm, "confirm"],
    ])
      element.textContent = t(key);
    if (dialog.open && archive) {
      try {
        renderPreview(previewed?.choices);
      } catch (error) {
        errorText.textContent = message(error);
      }
    }
  }
  function open(button) {
    const token = ++generation;
    busy = false;
    origin = button;
    input.value = "";
    file.value = "";
    archive = null;
    previewed = null;
    errorText.textContent = "";
    summary.replaceChildren();
    confirm.disabled = true;
    translate();
    dialog.showModal();
    clipboard
      .readText()
      .then((text) => {
        if (dialog.open && !disposed && token === generation && !input.value) {
          input.value = text;
          return loadText(text);
        }
      })
      .catch(() => {
        if (dialog.open && !disposed && token === generation) {
          errorText.textContent = t("clipboardFallback");
          input.focus();
        }
      });
  }
  events.listen(file, "change", async () => {
    if (committing) return;
    const selected = file.files[0];
    file.value = "";
    if (!selected) return;
    const token = ++generation;
    busy = false;
    previewed = null;
    archive = null;
    confirm.disabled = true;
    summary.replaceChildren();
    errorText.textContent = "";
    if (selected.size > service.MAX_BYTES) {
      errorText.textContent = t("tooLarge");
      return;
    }
    try {
      const text = await selected.text();
      if (disposed || !dialog.open || token !== generation) return;
      input.value = text;
      await loadText(text);
    } catch (error) {
      if (!disposed && dialog.open && token === generation)
        errorText.textContent = message(error);
    }
  });
  events.listen(input, "input", () => {
    generation++;
    busy = false;
    previewed = null;
    archive = null;
    confirm.disabled = true;
    summary.replaceChildren();
  });
  events.listen(dialog, "close", () => {
    generation++;
    busy = false;
    archive = null;
    previewed = null;
    if (origin?.isConnected) origin.focus({ preventScroll: true });
  });
  events.listen(dialog, "cancel", (event) => {
    if (committing) event.preventDefault();
  });
  events.listen(dialog, "keydown", (event) => event.stopPropagation());
  events.listen(document, "worktime:languagechange", translate);
  function detach(container) {
    const status = controls.get(container);
    status?.hold?.dispose();
    controls.delete(container);
  }
  function decorate(container, header) {
    detach(container);
    const actions = node(
      "div",
      "game-menu-archive-actions backup-button-group",
      header,
    );
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", t("save") + " / " + t("import"));
    const save = button(actions, "save", () => {});
    save.classList.add("icon-only");
    save.setAttribute("aria-label", t("saveHint"));
    save.title = t("saveHint");
    save.innerHTML =
      '<span class="backup-icon-slot" aria-hidden="true"><svg class="ui-icon backup-idle-icon"><use href="#ms-backup"/></svg><svg class="backup-hold-icon" viewBox="0 0 32 32"><circle class="hold-track" cx="16" cy="16" r="14"/><circle class="hold-progress" cx="16" cy="16" r="14" pathLength="100"/><use class="download-glyph" href="#ms-download" x="6" y="6" width="20" height="20" fill="currentColor" stroke="none"/></svg></span>';
    save.dataset.gameArchive = "save";
    const restore = button(actions, "import", () => open(restore));
    restore.classList.add("icon-only");
    restore.setAttribute("aria-label", t("import"));
    restore.title = t("import");
    restore.innerHTML =
      '<svg class="ui-icon" aria-hidden="true"><use href="#ms-restore"/></svg>';
    restore.dataset.gameArchive = "import";
    const status = node("p", "game-menu-archive-status", header);
    status.setAttribute("role", "status");
    controls.set(container, status);
    let saving = false;
    async function saveArchive(toFile) {
      if (saving || disposed) return;
      saving = true;
      try {
        const value = service.exportArchive();
        if (toFile) download(value);
        else await clipboard.writeText(await service.encode(value));
        if (!disposed) announce(t(toFile ? "downloaded" : "copied"));
      } catch (error) {
        if (!disposed) announce(message(error));
      } finally {
        saving = false;
      }
    }
    status.hold = WorkTimeApp.ui.createHoldAction({
      button: save,
      onShort: () => saveArchive(false),
      onLong: () => saveArchive(true),
      keys: ["Space", "Enter"],
    });
  }
  translate();
  return {
    decorate,
    detach,
    isOpen: () => dialog.open,
    report: (error) => announce(message(error)),
    dispose() {
      disposed = true;
      for (const container of controls.keys()) detach(container);
      events.dispose();
      downloads.dispose();
      dialog.remove();
    },
  };
};

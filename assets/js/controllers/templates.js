"use strict";
/** templates controller. Instantiate once, then bind after all actions are connected. */
WorkTimeApp.ui.createTemplateController = function (options) {
  const events = WorkTimeApp.ui.createEventScope();
  const {
    model,
    element: $,
    escape: esc,
    actions,
    core: C,
    application,
    clipboard,
  } = options;
  const transport = WorkTimeApp.services.templateShare;
  const templateLimit = transport.LIMIT;
  const shareFeedbackTimers = new Map();
  let sharing = false,
    importing = false,
    savingImport = false,
    savingTemplate = false,
    disposed = false,
    generation = 0,
    importPreview = null,
    importParseTimer = null;
  function updateTemplateLimit() {
    const full = model.state.timeTemplates.length >= templateLimit;
    for (const id of ["addTimeTemplate", "batchAddTimeTemplate"]) {
      const button = $(id);
      button.disabled = full;
      button.title = full
        ? WorkTimeApp.i18n.t("copy.b4c64a5057")
        : WorkTimeApp.i18n.t("copy.b464e3690d");
      button.setAttribute("aria-label", button.title);
      const icon = button.querySelector("use"),
        href = full ? "#ms-block" : "#ms-add";
      if (icon.getAttribute("href") !== href) icon.setAttribute("href", href);
    }
    for (const prefix of ["day", "batch"]) {
      $(prefix + "ShareTemplates").disabled =
        sharing || savingImport || !model.state.timeTemplates.length;
      $(prefix + "ImportTemplates").disabled = importing;
    }
  }

  function updateImportControls() {
    $("templateImportText").disabled = importing;
    $("parseTemplateImport").disabled =
      importing || !$("templateImportText").value.trim();
    $("confirmTemplateImport").disabled = importing || !importPreview;
    $("templateImportDialog")
      .querySelectorAll("[data-close]")
      .forEach((button) => {
        button.disabled = savingImport;
      });
    updateTemplateLimit();
  }
  function invalidateImport() {
    clearTimeout(importParseTimer);
    importParseTimer = null;
    generation++;
    importPreview = null;
    $("templateImportPreview").replaceChildren();
    $("templateImportPreview").hidden = true;
    $("templateImportError").textContent = "";
    updateImportControls();
  }
  function scheduleTemplateImport(event) {
    invalidateImport();
    if (event.isComposing || !$("templateImportText").value.trim()) return;
    importParseTimer = setTimeout(() => {
      importParseTimer = null;
      if (!disposed && $("templateImportDialog").open) parseTemplateImport();
    }, 300);
  }
  function openTemplateImport() {
    if (importing) return;
    $("templateImportText").value = "";
    invalidateImport();
    actions.open("templateImportDialog");
    $("templateImportText").focus({ preventScroll: true });
  }
  async function shareTemplates(event) {
    if (sharing || !model.state.timeTemplates.length) return;
    const button = event.currentTarget;
    sharing = true;
    updateTemplateLimit();
    let text;
    try {
      text = await transport.encode(model.state.timeTemplates);
      if (disposed) return;
      await clipboard.writeText(text);
      if (disposed) return;
      const restarting = shareFeedbackTimers.has(button);
      clearTimeout(shareFeedbackTimers.get(button));
      button.classList.remove("is-copying");
      if (restarting) void button.offsetWidth;
      button.classList.add("is-copying");
      shareFeedbackTimers.set(
        button,
        setTimeout(() => {
          button.classList.remove("is-copying");
          shareFeedbackTimers.delete(button);
        }, 450),
      );
      actions.toast(WorkTimeApp.i18n.t("copy.6b61c9cb60"));
    } catch (error) {
      if (disposed) return;
      if (text) {
        $("templateShareText").value = text;
        $("templateShareError").textContent =
          WorkTimeApp.i18n.t("copy.826156d83c");
        actions.open("templateShareDialog");
        $("templateShareText").focus({ preventScroll: true });
        $("templateShareText").select();
      } else
        actions.toast(
          WorkTimeApp.i18n.message(error.userMessage || error.message),
          "error",
        );
    } finally {
      sharing = false;
      if (!disposed) updateTemplateLimit();
    }
  }
  async function parseTemplateImport() {
    if (importing) return;
    invalidateImport();
    const lifetime = generation;
    const text = $("templateImportText").value;
    importing = true;
    updateImportControls();
    try {
      const templates = await transport.decode(text);
      if (
        disposed ||
        lifetime !== generation ||
        !$("templateImportDialog").open
      )
        return;
      importPreview = templates;
      $("templateImportPreview").innerHTML =
        WorkTimeApp.i18n.t("copy.178e345f17") +
        templates
          .map(
            (template) =>
              "<article><strong>" +
              esc(template.name) +
              '</strong><span class="template-preview-time" aria-label="' +
              esc(
                template.start
                  ? WorkTimeApp.i18n.t("copy.c4eeb2ee2f") + template.start
                  : WorkTimeApp.i18n.t("copy.855e113afa"),
              ) +
              '">' +
              esc(template.start || "—") +
              '</span><span class="template-preview-time" aria-label="' +
              esc(
                template.end
                  ? WorkTimeApp.i18n.t("copy.8c33c472a7") +
                      template.end +
                      (template.nextDay
                        ? WorkTimeApp.i18n.t("copy.c751037c58")
                        : "")
                  : WorkTimeApp.i18n.t("copy.19d79ec3cc"),
              ) +
              '">' +
              esc(template.end || "—") +
              (template.end && template.nextDay
                ? '<sup class="template-preview-nextday" aria-hidden="true">+1</sup>'
                : "") +
              "</span></article>",
          )
          .join("");
      $("templateImportPreview").hidden = false;
    } catch (error) {
      if (!disposed && lifetime === generation)
        $("templateImportError").textContent = WorkTimeApp.i18n.message(
          error.userMessage || error.message,
        );
    } finally {
      importing = false;
      if (!disposed) updateImportControls();
    }
  }
  async function confirmTemplateImport() {
    if (importing || !importPreview) return;
    importing = savingImport = true;
    $("templateImportError").textContent = "";
    updateImportControls();
    try {
      const result = await application.replaceTemplates(importPreview);
      if (disposed) return;
      if (!result.persisted) {
        $("templateImportError").textContent =
          WorkTimeApp.i18n.t("copy.345391343a") + (result.message || "");
        return;
      }
      renderTimeTemplates();
      $("templateImportDialog").close();
      actions.saveFeedback(true, WorkTimeApp.i18n.t("copy.6e4508239f"));
    } catch (error) {
      if (!disposed)
        $("templateImportError").textContent = WorkTimeApp.i18n.message(
          error.userMessage || error.message,
        );
    } finally {
      importing = savingImport = false;
      if (!disposed) updateImportControls();
    }
  }

  let templateEditingId = null,
    renderedTemplates = null,
    renderedBatchTemplates = null,
    renderedTemplateIds = null,
    renderedBatchTemplateIds = null;
  function animateNewTemplates(list, previous) {
    const current = new Set(model.state.timeTemplates.map((t) => t.id));
    if (previous)
      list.querySelectorAll(".time-template-chip").forEach((chip) => {
        const button = chip.querySelector(
            "[data-template-fill],[data-batch-template]",
          ),
          id = button?.dataset.templateFill || button?.dataset.batchTemplate;
        if (id && !previous.has(id))
          WorkTimeApp.ui.motion?.play(chip, "motion-enter");
      });
    return current;
  }
  function renderTimeTemplates() {
    const signature =
      WorkTimeApp.i18n.language + JSON.stringify(model.state.timeTemplates);
    if (signature === renderedTemplates) return;
    renderedTemplates = signature;
    $("timeTemplateList").innerHTML = model.state.timeTemplates.length
      ? model.state.timeTemplates
          .map(
            (t) =>
              '<div class="time-template-chip"><button type="button" class="ui-button template-fill" data-template-fill="' +
              esc(t.id) +
              '" title="' +
              esc(
                t.name +
                  " · " +
                  t.start +
                  "–" +
                  t.end +
                  (t.nextDay ? WorkTimeApp.i18n.t("copy.c751037c58") : ""),
              ) +
              '"><span class="button-label">' +
              esc(t.name) +
              '</span></button><button type="button" class="ui-button template-edit icon-only" data-template-edit="' +
              esc(t.id) +
              WorkTimeApp.i18n.t("copy.ac35793d79") +
              esc(t.name) +
              WorkTimeApp.i18n.t("copy.293224a98b") +
              actions.controlIcon("more") +
              "</button></div>",
          )
          .join("")
      : "";
    renderedTemplateIds = animateNewTemplates(
      $("timeTemplateList"),
      renderedTemplateIds,
    );
    renderBatchTimeTemplates();
  }
  function openTimeTemplate(template = null, defaults = null) {
    if (savingTemplate) return;
    if (!template && model.state.timeTemplates.length >= templateLimit) {
      actions.toast(WorkTimeApp.i18n.t("copy.b4c64a5057"));
      return;
    }
    templateEditingId = template ? template.id : null;
    $("timeTemplateTitle").textContent = template
      ? WorkTimeApp.i18n.t("copy.7cf04378a1")
      : WorkTimeApp.i18n.t("copy.b464e3690d");
    $("timeTemplateName").value = template ? template.name : "";
    const schedule = C.scheduleForDate(model.state, model.selected);
    $("timeTemplateStart").placeholder =
      defaults?.start || $("dayStart").value || schedule.workStart;
    $("timeTemplateEnd").placeholder =
      defaults?.end || $("dayEnd").value || schedule.workEnd;
    $("timeTemplateStart").value = template ? template.start : "";
    $("timeTemplateEnd").value = template ? template.end : "";
    $("timeTemplateNext").checked = template ? template.nextDay : false;
    updateTimeTemplateNextToggle();
    $("deleteTimeTemplate").classList.toggle("hidden", !template);
    $("timeTemplateError").textContent = "";
    actions.open("timeTemplateDialog");
    $("timeTemplateName").focus({ preventScroll: true });
  }
  function updateTimeTemplateNextToggle() {
    $("timeTemplateNextToggle").setAttribute(
      "aria-pressed",
      String($("timeTemplateNext").checked),
    );
  }
  // Empty fields leave the existing punch time (and its overnight flag) intact.
  function applyTimeTemplate(template, prefix) {
    if (template.start) $(prefix + "Start").value = template.start;
    if (template.end) {
      $(prefix + "End").value = template.end;
      $(prefix + "Next").checked = template.nextDay;
    }
  }
  function renderBatchTimeTemplates() {
    updateTemplateLimit();
    const signature = JSON.stringify(model.state.timeTemplates);
    if (signature === renderedBatchTemplates) return;
    renderedBatchTemplates = signature;
    const list = $("batchTimeTemplateList");
    if (!model.state.timeTemplates.length) {
      list.innerHTML = WorkTimeApp.i18n.t("copy.84c6ec48f3");
      renderedBatchTemplateIds = new Set();
      return;
    }
    list.innerHTML = model.state.timeTemplates
      .map((template) => {
        return (
          '<div class="time-template-chip"><button type="button" class="ui-button template-fill" data-batch-template="' +
          esc(template.id) +
          '" title="' +
          esc(
            template.name +
              " · " +
              template.start +
              "–" +
              template.end +
              (template.nextDay ? WorkTimeApp.i18n.t("copy.c751037c58") : ""),
          ) +
          '"><span class="button-label">' +
          esc(template.name) +
          '</span></button><button type="button" class="ui-button template-edit icon-only" data-batch-template-edit="' +
          esc(template.id) +
          WorkTimeApp.i18n.t("copy.ac35793d79") +
          esc(template.name) +
          WorkTimeApp.i18n.t("copy.293224a98b") +
          actions.controlIcon("more") +
          "</button></div>"
        );
      })
      .join("");
    renderedBatchTemplateIds = animateNewTemplates(
      list,
      renderedBatchTemplateIds,
    );
  }
  let bound = false;
  function setTemplateSaving(value) {
    savingTemplate = value;
    $("timeTemplateDialog")
      .querySelectorAll("button, input")
      .forEach((control) => {
        control.disabled = value;
      });
  }
  function bind() {
    if (bound) return;
    bound = true;
    disposed = false;
    for (const prefix of ["day", "batch"]) {
      events.handler($(prefix + "ShareTemplates"), "onclick", shareTemplates);
      events.handler(
        $(prefix + "ImportTemplates"),
        "onclick",
        openTemplateImport,
      );
    }
    events.listen($("templateImportText"), "input", scheduleTemplateImport);
    events.listen(
      $("templateImportText"),
      "compositionend",
      scheduleTemplateImport,
    );
    events.handler($("parseTemplateImport"), "onclick", parseTemplateImport);
    events.handler(
      $("confirmTemplateImport"),
      "onclick",
      confirmTemplateImport,
    );
    events.listen($("templateImportDialog"), "close", invalidateImport);
    events.listen($("templateImportDialog"), "cancel", (event) => {
      if (savingImport) event.preventDefault();
    });
    events.handler($("selectTemplateShare"), "onclick", () => {
      $("templateShareText").focus({ preventScroll: true });
      $("templateShareText").select();
    });
    events.handler($("copyTemplateShare"), "onclick", async () => {
      const button = $("copyTemplateShare");
      if (button.disabled) return;
      button.disabled = true;
      try {
        await clipboard.writeText($("templateShareText").value);
        if (!disposed) {
          $("templateShareDialog").close();
          actions.toast(WorkTimeApp.i18n.t("copy.6b61c9cb60"));
        }
      } catch {
        if (!disposed)
          $("templateShareError").textContent =
            WorkTimeApp.i18n.t("copy.1177ecca4d");
      } finally {
        if (!disposed) button.disabled = false;
      }
    });
    updateImportControls();
    events.listen($("timeTemplateDialog"), "cancel", (event) => {
      if (savingTemplate) event.preventDefault();
    });
    events.handler($("timeTemplateNextToggle"), "onclick", () => {
      $("timeTemplateNext").checked = !$("timeTemplateNext").checked;
      updateTimeTemplateNextToggle();
    });
    events.handler($("addTimeTemplate"), "onclick", () => openTimeTemplate());
    events.handler($("timeTemplateList"), "onclick", async (e) => {
      const fill = e.target.closest("[data-template-fill]"),
        edit = e.target.closest("[data-template-edit]"),
        id = fill
          ? fill.dataset.templateFill
          : edit
            ? edit.dataset.templateEdit
            : null;
      const template = model.state.timeTemplates.find((t) => t.id === id);
      if (!template) return;
      if (edit) {
        openTimeTemplate(template);
        return;
      }
      applyTimeTemplate(template, "day");
      WorkTimeApp.ui.fieldErrors.clear($("dayError"));
      if (await actions.saveDayEdit())
        actions.toast(
          model.storageFailed
            ? WorkTimeApp.i18n.t("copy.5897d1052d")
            : WorkTimeApp.i18n.t("nav.applied", { name: template.name }),
        );
    });
    events.handler($("timeTemplateForm"), "onsubmit", async (e) => {
      e.preventDefault();
      if (savingTemplate) return;
      setTemplateSaving(true);
      try {
        if (
          !templateEditingId &&
          model.state.timeTemplates.length >= templateLimit
        )
          throw Error(WorkTimeApp.i18n.t("copy.875c3553f3"));
        const template = C.validateTimeTemplate({
          id: templateEditingId || WorkTimeApp.services.archive.uuid(),
          name: $("timeTemplateName").value,
          start: $("timeTemplateStart").value,
          end: $("timeTemplateEnd").value,
          nextDay: $("timeTemplateNext").checked,
        });
        const saved = (
          await application.saveTemplate(template, !!templateEditingId)
        ).persisted;
        if (disposed) return;
        templateEditingId = template.id;
        renderTimeTemplates();
        if (saved) $("timeTemplateDialog").close();
        else
          $("timeTemplateError").textContent =
            WorkTimeApp.i18n.t("copy.61e356982e");
        actions.saveFeedback(saved, WorkTimeApp.i18n.t("copy.8d44bed273"));
      } catch (err) {
        if (!disposed)
          $("timeTemplateError").textContent = WorkTimeApp.i18n.message(
            err.userMessage || err.message,
          );
      } finally {
        if (!disposed) setTemplateSaving(false);
      }
    });
    events.handler($("deleteTimeTemplate"), "onclick", async () => {
      if (savingTemplate || !templateEditingId) return;
      setTemplateSaving(true);
      try {
        const saved = (await application.removeTemplate(templateEditingId))
          .persisted;
        if (disposed) return;
        renderTimeTemplates();
        $("timeTemplateDialog").close();
        actions.saveFeedback(saved, WorkTimeApp.i18n.t("copy.ea6b072dea"));
      } catch (error) {
        if (!disposed)
          $("timeTemplateError").textContent = WorkTimeApp.i18n.message(
            error.userMessage || error.message,
          );
      } finally {
        if (!disposed) setTemplateSaving(false);
      }
    });
    events.handler($("batchAddTimeTemplate"), "onclick", () =>
      openTimeTemplate(null, {
        start: $("batchStart").value,
        end: $("batchEnd").value,
        nextDay: $("batchNext").checked,
      }),
    );
    events.handler($("batchTimeTemplateList"), "onclick", (e) => {
      const fill = e.target.closest("[data-batch-template]"),
        edit = e.target.closest("[data-batch-template-edit]"),
        id = fill
          ? fill.dataset.batchTemplate
          : edit
            ? edit.dataset.batchTemplateEdit
            : null;
      if (!id) return;
      const template = model.state.timeTemplates.find((item) => item.id === id);
      if (!template) return;
      if (edit) {
        openTimeTemplate(template);
        return;
      }
      applyTimeTemplate(template, "batch");
      actions.updateBatchNextToggle();
      renderBatchTimeTemplates();
      $("batchError").textContent = "";
      actions.refreshBatchPreview();
    });
    for (const id of ["batchStart", "batchEnd"])
      events.listen($(id), "input", renderBatchTimeTemplates);
  }
  function dispose() {
    for (const [button, timer] of shareFeedbackTimers) {
      clearTimeout(timer);
      button.classList.remove("is-copying");
    }
    shareFeedbackTimers.clear();
    clearTimeout(importParseTimer);
    importParseTimer = null;
    disposed = true;
    generation++;
    events.dispose();
    bound = false;
  }
  function hasDraft() {
    if ($("templateImportDialog").open && $("templateImportText").value.trim())
      return true;
    if (!$("timeTemplateDialog").open) return false;
    const original = model.state.timeTemplates.find(
      (item) => item.id === templateEditingId,
    );
    return (
      $("timeTemplateName").value !== (original?.name || "") ||
      $("timeTemplateStart").value !== (original?.start || "") ||
      $("timeTemplateEnd").value !== (original?.end || "") ||
      $("timeTemplateNext").checked !== !!original?.nextDay
    );
  }
  return {
    bind,
    dispose,
    renderTimeTemplates,
    renderBatchTimeTemplates,
    hasDraft,
  };
};

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
  let sharing = false,
    importing = false,
    savingImport = false,
    savingTemplate = false,
    disposed = false,
    generation = 0,
    importPreview = null;
  function updateTemplateLimit() {
    const full = model.state.timeTemplates.length >= templateLimit;
    for (const id of ["addTimeTemplate", "batchAddTimeTemplate"]) {
      $(id).disabled = full;
      $(id).title = full ? "模板已满（6 个），请先删除" : "新增时间模板";
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
    generation++;
    importPreview = null;
    $("templateImportPreview").replaceChildren();
    $("templateImportPreview").hidden = true;
    $("templateImportError").textContent = "";
    updateImportControls();
  }
  function openTemplateImport() {
    if (importing) return;
    $("templateImportText").value = "";
    $("templateImportWarning").textContent =
      "将替换现有全部模板，请核对预览后确认导入。";
    invalidateImport();
    actions.open("templateImportDialog");
    $("templateImportText").focus({ preventScroll: true });
  }
  async function shareTemplates() {
    if (sharing || !model.state.timeTemplates.length) return;
    sharing = true;
    updateTemplateLimit();
    let text;
    try {
      text = await transport.encode(model.state.timeTemplates);
      if (disposed) return;
      await clipboard.writeText(text);
      if (!disposed) actions.toast("打卡模板已复制到剪贴板");
    } catch (error) {
      if (disposed) return;
      if (text) {
        $("templateShareText").value = text;
        $("templateShareError").textContent =
          "无法自动复制，请全选后手动复制。";
        actions.open("templateShareDialog");
        $("templateShareText").focus({ preventScroll: true });
        $("templateShareText").select();
      } else actions.toast(error.userMessage || error.message, "error");
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
      $("templateImportPreview").innerHTML = templates
        .map(
          (template) =>
            "<article><strong>" +
            esc(template.name) +
            "</strong><span>" +
            esc(
              (template.start ? "上班 " + template.start : "不填写上班") +
                " · " +
                (template.end
                  ? "下班 " +
                    template.end +
                    (template.nextDay ? "（次日）" : "")
                  : "不填写下班"),
            ) +
            "</span></article>",
        )
        .join("");
      $("templateImportPreview").hidden = false;
      $("templateImportWarning").textContent =
        "将用这 " +
        templates.length +
        " 个模板替换现有全部 " +
        model.state.timeTemplates.length +
        " 个模板，请核对后确认导入。";
    } catch (error) {
      if (!disposed && lifetime === generation)
        $("templateImportError").textContent =
          error.userMessage || error.message;
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
          "导入尚未保存，原模板已保留，可重试。" + (result.message || "");
        return;
      }
      renderTimeTemplates();
      $("templateImportDialog").close();
      actions.saveFeedback(true, "打卡模板已导入");
    } catch (error) {
      if (!disposed)
        $("templateImportError").textContent =
          error.userMessage || error.message;
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
    const signature = JSON.stringify(model.state.timeTemplates);
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
                  (t.nextDay ? "（次日）" : ""),
              ) +
              '"><span class="button-label">' +
              esc(t.name) +
              '</span></button><button type="button" class="ui-button template-edit icon-only" data-template-edit="' +
              esc(t.id) +
              '" aria-label="编辑模板 ' +
              esc(t.name) +
              '" title="编辑模板">' +
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
      actions.toast("模板已满（6 个），请先删除");
      return;
    }
    templateEditingId = template ? template.id : null;
    $("timeTemplateTitle").textContent = template
      ? "编辑时间模板"
      : "新增时间模板";
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
      list.innerHTML = '<span class="template-empty">暂无模板</span>';
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
              (template.nextDay ? "（次日）" : ""),
          ) +
          '"><span class="button-label">' +
          esc(template.name) +
          '</span></button><button type="button" class="ui-button template-edit icon-only" data-batch-template-edit="' +
          esc(template.id) +
          '" aria-label="编辑模板 ' +
          esc(template.name) +
          '" title="编辑模板">' +
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
    events.listen($("templateImportText"), "input", invalidateImport);
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
          actions.toast("打卡模板已复制到剪贴板");
        }
      } catch {
        if (!disposed)
          $("templateShareError").textContent = "复制失败，请全选后手动复制。";
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
            ? "已应用模板，保存异常请查看提醒"
            : "已应用并保存“" + template.name + "”",
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
          throw Error("模板已满（6 个），请先删除。");
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
            "模板尚未保存，可重试提交或关闭后备份。";
        actions.saveFeedback(saved, "时间模板已保存");
      } catch (err) {
        if (!disposed)
          $("timeTemplateError").textContent = err.userMessage || err.message;
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
        actions.saveFeedback(saved, "时间模板已删除");
      } catch (error) {
        if (!disposed)
          $("timeTemplateError").textContent =
            error.userMessage || error.message;
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
    });
    for (const id of ["batchStart", "batchEnd"])
      events.listen($(id), "input", renderBatchTimeTemplates);
  }
  function dispose() {
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

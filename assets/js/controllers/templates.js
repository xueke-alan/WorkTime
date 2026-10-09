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
  } = options;
  const templateLimit = 4;
  function updateTemplateLimit() {
    const full = model.state.timeTemplates.length >= templateLimit;
    for (const id of ["addTimeTemplate", "batchAddTimeTemplate"]) {
      $(id).disabled = full;
      $(id).title = full ? "模板已满（4 个），请先删除" : "新增时间模板";
    }
  }

  let templateEditingId = null,
    renderedTemplates = null,
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
    if (!template && model.state.timeTemplates.length >= templateLimit) {
      actions.toast("模板已满（4 个），请先删除");
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
  function bind() {
    if (bound) return;
    bound = true;
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
      try {
        if (
          !templateEditingId &&
          model.state.timeTemplates.length >= templateLimit
        )
          throw Error("模板已满（4 个），请先删除。");
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
        templateEditingId = template.id;
        renderTimeTemplates();
        if (saved) $("timeTemplateDialog").close();
        else
          $("timeTemplateError").textContent =
            "模板尚未保存，可重试提交或关闭后备份。";
        actions.saveFeedback(saved, "时间模板已保存");
      } catch (err) {
        $("timeTemplateError").textContent = err.userMessage || err.message;
      }
    });
    events.handler($("deleteTimeTemplate"), "onclick", async () => {
      if (!templateEditingId) return;
      const saved = (await application.removeTemplate(templateEditingId))
        .persisted;
      renderTimeTemplates();
      $("timeTemplateDialog").close();
      actions.saveFeedback(saved, "时间模板已删除");
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
    events.dispose();
    bound = false;
  }
  function hasDraft() {
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

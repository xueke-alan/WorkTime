"use strict";
/** templates controller. Instantiate once, then bind after all actions are connected. */
WorkUI.createTemplateController = function (options) {
  const { model, element: $, escape: esc, actions, core: C } = options;
  const templateLimit = 4;
  function updateTemplateLimit() {
    const full = model.state.timeTemplates.length >= templateLimit;
    for (const id of ["addTimeTemplate", "batchAddTimeTemplate"]) {
      $(id).disabled = full;
      $(id).title = full
        ? "最多保存 4 个模板，请先删除一个模板"
        : "新增时间模板";
    }
  }

  let templateEditingId = null,
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
          window.WorkMotion?.play(chip, "motion-enter");
      });
    return current;
  }
  function renderTimeTemplates() {
    $("timeTemplateList").innerHTML = model.state.timeTemplates.length
      ? model.state.timeTemplates
          .map(
            (t) =>
              '<div class="time-template-chip"><button type="button" class="template-fill" data-template-fill="' +
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
              '">' +
              esc(t.name) +
              '</button><button type="button" class="template-edit icon-only" data-template-edit="' +
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
      actions.toast("最多保存 4 个模板，请先删除一个模板");
      return;
    }
    templateEditingId = template ? template.id : null;
    $("timeTemplateTitle").textContent = template
      ? "编辑时间模板"
      : "新增时间模板";
    $("timeTemplateName").value = template ? template.name : "";
    $("timeTemplateStart").value = template
      ? template.start
      : (defaults?.start ??
        ($("dayStart").value || model.state.settings.workStart));
    $("timeTemplateEnd").value = template
      ? template.end
      : (defaults?.end ?? ($("dayEnd").value || model.state.settings.workEnd));
    $("timeTemplateNext").checked = template
      ? template.nextDay
      : (defaults?.nextDay ?? $("dayNext").checked);
    updateTimeTemplateNextToggle();
    $("deleteTimeTemplate").classList.toggle("hidden", !template);
    $("timeTemplateError").textContent = "";
    actions.open("timeTemplateDialog");
    $("timeTemplateName").focus();
  }
  function updateTimeTemplateNextToggle() {
    $("timeTemplateNextToggle").setAttribute(
      "aria-pressed",
      String($("timeTemplateNext").checked),
    );
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
          '<div class="time-template-chip"><button type="button" class="template-fill" data-batch-template="' +
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
          '">' +
          esc(template.name) +
          '</button><button type="button" class="template-edit icon-only" data-batch-template-edit="' +
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
    $("timeTemplateNextToggle").onclick = () => {
      $("timeTemplateNext").checked = !$("timeTemplateNext").checked;
      updateTimeTemplateNextToggle();
    };
    $("addTimeTemplate").onclick = () => openTimeTemplate();
    $("timeTemplateList").onclick = (e) => {
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
      $("dayStart").value = template.start;
      $("dayEnd").value = template.end;
      $("dayNext").checked = template.nextDay;
      $("dayError").textContent = "";
      if (actions.saveDayEdit())
        actions.toast(
          model.storageFailed
            ? "已应用模板，保存异常请查看提醒"
            : "已应用并保存“" + template.name + "”",
        );
    };
    $("timeTemplateForm").onsubmit = (e) => {
      e.preventDefault();
      try {
        if (
          !templateEditingId &&
          model.state.timeTemplates.length >= templateLimit
        )
          throw Error("最多保存 4 个模板，请先删除一个模板。");
        const template = C.validateTimeTemplate({
          id:
            templateEditingId ||
            "template-" +
              Date.now() +
              "-" +
              Math.random().toString(36).slice(2, 8),
          name: $("timeTemplateName").value,
          start: $("timeTemplateStart").value,
          end: $("timeTemplateEnd").value,
          nextDay: $("timeTemplateNext").checked,
        });
        if (templateEditingId) {
          const index = model.state.timeTemplates.findIndex(
            (t) => t.id === templateEditingId,
          );
          if (index < 0) throw Error("模板已不存在。");
          model.state.timeTemplates[index] = template;
        } else model.state.timeTemplates.push(template);
        templateEditingId = template.id;
        const saved = actions.save();
        renderTimeTemplates();
        if (saved) $("timeTemplateDialog").close();
        else
          $("timeTemplateError").textContent =
            "模板尚未保存，可重试提交或关闭后备份。";
        actions.saveFeedback(saved, "时间模板已保存");
      } catch (err) {
        $("timeTemplateError").textContent = err.userMessage || err.message;
      }
    };
    $("deleteTimeTemplate").onclick = () => {
      if (!templateEditingId) return;
      model.state.timeTemplates = model.state.timeTemplates.filter(
        (t) => t.id !== templateEditingId,
      );
      const saved = actions.save();
      renderTimeTemplates();
      $("timeTemplateDialog").close();
      actions.saveFeedback(saved, "时间模板已删除");
    };
    $("batchAddTimeTemplate").onclick = () =>
      openTimeTemplate(null, {
        start: $("batchStart").value,
        end: $("batchEnd").value,
        nextDay: $("batchNext").checked,
      });
    $("batchTimeTemplateList").onclick = (e) => {
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
      $("batchStart").value = template.start;
      $("batchEnd").value = template.end;
      $("batchNext").checked = !!template.nextDay;
      actions.updateBatchNextToggle();
      renderBatchTimeTemplates();
      $("batchError").textContent = "";
    };
    for (const id of ["batchStart", "batchEnd"])
      $(id).addEventListener("input", renderBatchTimeTemplates);
  }
  function dispose() {}
  return { bind, dispose, renderTimeTemplates, renderBatchTimeTemplates };
};

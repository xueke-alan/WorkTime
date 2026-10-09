"use strict";
/** imports controller. Instantiate once, then bind after all actions are connected. */
WorkTimeApp.ui.createImportController = function (options) {
  const events = WorkTimeApp.ui.createEventScope();
  const {
    element: $,
    core: C,
    escape: esc,
    model,
    application,
    actions,
    clipboard,
    clock,
    importIndex,
  } = options;
  let holdAction = null;
  let preview = null;
  let disposed = false;
  let generation = 0;
  let importParseTimer = null;
  let resultsMode = "history";
  function anomalyReason(record) {
    if (!record.start && !record.end) return "无记录";
    if (!record.start) return "缺上班卡";
    if (!record.end) return "缺下班卡";
    const start = C.timeMin(record.start),
      end = C.timeMin(record.end);
    if (start === null || end === null) return "时间无效";
    if (!record.nextDay && end < start) return "时间倒置";
    return "";
  }
  function recordCells(record) {
    const time =
      record.start || record.end
        ? ((record.start || "") + " - " + (record.end || "")).trim()
        : "-";
    return (
      "<strong>" +
      esc(record.date.replace(/-/g, "/")) +
      "</strong><span>" +
      esc(time) +
      (record.nextDay ? "（次日）" : "") +
      '</span><span class="import-record-anomaly">' +
      esc(anomalyReason(record)) +
      "</span>"
    );
  }
  function animateResults(mode) {
    if (mode === resultsMode) return;
    resultsMode = mode;
    if ($("importDialog").open)
      WorkTimeApp.ui.motion?.play(
        $("importResultsTitle").closest(".sidebar-import-history"),
        mode === "results" ? "motion-sidebar-forward" : "motion-sidebar-back",
      );
  }
  function resetImportInput() {
    $("pasteText").value = "";
    $("importRows").innerHTML = "";
    invalidatePreview();
  }
  function setImportParseStatus(status) {
    const summary = $("importSummary");
    summary.dataset.state = status;
    summary.setAttribute("aria-busy", String(status === "pending"));
    $("importDetails").classList.toggle(
      "hidden",
      ["idle", "pending"].includes(status),
    );
  }
  function collapseImportDetails() {
    $("importDetails").classList.add("hidden");
  }
  function scheduleImportParse() {
    invalidatePreview(!$("pasteText").value.trim());
    setImportParseStatus("pending", "正在解析…");
    importParseTimer = setTimeout(parseImport, 250);
  }
  function invalidatePreview(showHistory = true) {
    collapseImportDetails();
    clearTimeout(importParseTimer);
    importParseTimer = null;
    setImportParseStatus("idle", "");
    preview = null;
    $("commitImport").disabled = true;
    if (showHistory) $("importTable").classList.add("hidden");
    $("importSummary").textContent = "暂无解析";
    $("importWarnings").textContent = "";
    if (showHistory) {
      $("importResultsTitle").textContent = "导入历史";
      $("importHistoryList").classList.remove("hidden");
      renderImportHistory();
      animateResults("history");
    }
  }
  function parseImport(inputSources = null) {
    invalidatePreview(false);
    const year = clock.year(),
      sources = Array.isArray(inputSources) ? inputSources : [];
    if (!inputSources && $("pasteText").value.trim())
      sources.push({ name: "粘贴文本", raw: $("pasteText").value });
    if (!sources.length) {
      invalidatePreview();
      return;
    }
    try {
      const plan = WorkTimeApp.services.imports.prepare(
          C,
          model.state,
          sources,
          year,
          clock.today(),
        ),
        { records, warnings, rows } = plan;
      preview = rows.length ? plan : null;
      $("importWarnings").textContent = warnings.join("\n");
      $("importSummary").textContent =
        "已解析 " +
        records.length +
        " 条 · " +
        warnings.length +
        " 提示 · " +
        rows.filter((x) => x.result.conflict).length +
        " 冲突";
      $("importSummary").title =
        warnings.join("\n") || $("importSummary").textContent;
      $("importRows").innerHTML = rows
        .map(
          (x, i) =>
            "<article>" +
            recordCells(x.record) +
            (x.result.conflict
              ? '<div class="conflict">' +
                (x.result.repeated
                  ? "同批次重复日期；请按顺序选择，保留时沿用此前选择。"
                  : "已有 " +
                    esc(x.old.start + "–" + x.old.end) +
                    "；本次 " +
                    esc(x.record.start + "–" + x.record.end)) +
                '</div><select data-conflict="' +
                i +
                '" aria-label="' +
                x.record.date +
                ' 冲突处理"><option value="new">采用本次导入</option><option value="old">保留已有记录或此前选择</option></select>'
              : "") +
            (model.state.days[x.record.date] &&
            model.state.days[x.record.date].actual
              ? '<div class="muted">手动填写仍保留</div>'
              : "") +
            "</article>",
        )
        .join("");
      $("importTable").classList.toggle("hidden", !rows.length);
      $("importHistoryList").classList.add("hidden");
      $("importResultsTitle").textContent = "记录解析结果";
      animateResults("results");
      const abnormalDates = new Set(
        rows
          .filter((row) => row.result.conflict || anomalyReason(row.record))
          .map((row) => row.record.date),
      );
      $("importHistoryCount").textContent =
        rows.length + " 条记录 · " + abnormalDates.size + " 条异常";
      $("commitImport").disabled = !rows.length;
      setImportParseStatus(
        !rows.length
          ? "error"
          : warnings.length || rows.some((x) => x.result.conflict)
            ? "warning"
            : "success",
      );
      if (!rows.length && !warnings.length)
        $("importSummary").textContent = "未识别到可导入记录，请检查输入";
      if (!rows.length && !warnings.length)
        $("importWarnings").textContent =
          "未识别到可导入的 OA 记录，请检查文本内容。";
    } catch (error) {
      invalidatePreview();
      setImportParseStatus("error", "解析失败");
      $("importSummary").textContent = "解析失败，请检查输入";
      $("importWarnings").textContent = "解析失败：" + error.message;
    }
  }
  function commitOARecords(
    records,
    year,
    sources,
    count = records.length,
    focusDate = records[0]?.date,
  ) {
    const id =
      "import-" +
      clock.now().getTime() +
      "-" +
      Math.random().toString(36).slice(2, 8);
    const saved = application.importRecords({
      id,
      at: clock.now().toISOString(),
      year,
      sources,
      count,
      records: records.map((record) => ({ ...record })),
    }).persisted;
    if (focusDate) {
      model.month = focusDate.slice(0, 7);
      model.selected = focusDate;
    }
    actions.render();
    renderImportHistory();
    return saved;
  }
  async function importFromClipboard() {
    const lifetime = generation;
    try {
      const raw = await clipboard.readText();
      if (disposed || lifetime !== generation) return;
      if (!raw.trim()) throw Error("剪贴板中没有 OA 文本");
      if (raw.length > 5 * 1024 * 1024) throw Error("剪贴板文本超过 5MB");
      const year = clock.year(),
        sources = [{ name: "剪贴板", raw }],
        plan = WorkTimeApp.services.imports.prepare(
          C,
          model.state,
          sources,
          year,
          clock.today(),
        );
      if (!plan.records.length)
        throw Error(plan.warnings[0] || "未识别到 OA 记录");
      if (plan.needsReview) {
        $("pasteText").value = raw;
        parseImport(sources);
        actions.open("importDialog");
        $("importDetails").classList.remove("hidden");
        actions.toast("导入记录需核查，请确认后导入");
        return;
      }
      const saved = commitOARecords(
        WorkTimeApp.services.imports.acceptedRecords(plan),
        year,
        sources,
      );
      actions.saveFeedback(
        saved,
        "已从剪贴板导入 " + plan.records.length + " 条 OA 记录",
      );
    } catch (err) {
      if (disposed || lifetime !== generation) return;
      actions.toast(
        "剪贴板导入失败：" +
          (err.name === "NotAllowedError"
            ? "请允许读取剪贴板后重试"
            : err.message),
        "error",
      );
    }
  }
  let importToDelete = null;
  function renderImportHistory() {
    const logs = model.state.imports.slice().reverse();
    const dates = new Set(
      logs.flatMap((log) => importIndex.describe(log).acceptedDates),
    );
    if (!preview)
      $("importHistoryCount").textContent =
        "共 " + logs.length + " 条记录 · " + dates.size + " 天有效记录";
    $("importHistoryList").innerHTML = logs.length
      ? logs
          .map((log) => {
            const dates = importIndex.describe(log).rawDates;
            const range = dates.length
              ? dates[0].replaceAll("-", "/") +
                " - " +
                dates[dates.length - 1].replaceAll("-", "/")
              : "未识别日期";
            return (
              '<article class="import-history-item" data-history-id="' +
              esc(log.id) +
              '"><div class="row between"><h3>' +
              esc(
                new Date(log.at).toLocaleString("zh-CN", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }),
              ) +
              '</h3><div class="row"><button type="button" class="ui-button" data-view-import="' +
              esc(log.id) +
              '" aria-label="查看导入详情" title="查看详情"><svg class="ui-icon" aria-hidden="true"><use href="#ms-info"/></svg></button><button type="button" class="ui-button danger" data-delete-import="' +
              esc(log.id) +
              '" aria-label="删除导入批次" title="删除批次"><svg class="ui-icon" aria-hidden="true"><use href="#ms-delete-outline"/></svg></button></div></div><div class="import-history-meta">' +
              esc(range) +
              " · " +
              log.count +
              " 条记录</div></article>"
            );
          })
          .join("")
      : '<div class="import-history-empty">暂无导入历史</div>';
  }
  let detailId = null;
  function showImportDetail(id) {
    const logs = model.state.imports.slice().reverse(),
      index = logs.findIndex((log) => log.id === id),
      log = logs[index];
    if (!log) return;
    const changedDetail = detailId !== null && detailId !== id;
    detailId = id;
    const pane = $("sourceDialog");
    pane.classList.add("import-detail-view");
    pane.classList.remove("import-detail-raw");
    pane.querySelector("h2").innerHTML =
      "<span>" +
      esc(
        new Date(log.at).toLocaleString("zh-CN", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      ) +
      '</span><small class="import-detail-caption">导入记录</small>';
    const records = log.records;
    $("sourceBody").innerHTML =
      '<div class="import-detail-toolbar"><span class="muted">' +
      records.length +
      " 条记录 · " +
      records.filter((record) => anomalyReason(record)).length +
      " 条异常</span></div>" +
      '<div class="import-parsed-list">' +
      records
        .map((record) => "<article>" + recordCells(record) + "</article>")
        .join("") +
      (records.length
        ? ""
        : '<p class="muted">没有已接受的解析记录，可查看核心打卡文本。</p>') +
      "</div>" +
      '<label class="import-detail-raw-label" for="importDetailRawText">核心打卡文本</label>' +
      '<div class="import-detail-raw-field"><textarea id="importDetailRawText" class="import-detail-raw-text" readonly aria-label="核心打卡文本" placeholder="没有可识别的核心打卡文本" spellcheck="false">' +
      esc(log.sources.map((source) => source.raw).join("\n\n")) +
      "</textarea></div>";
    pane.querySelector(".dialog-foot").innerHTML =
      '<button type="button" class="ui-button icon-only" aria-label="上一条导入记录" title="上一条" data-detail-step="-1"' +
      (index === 0 ? " disabled" : "") +
      '><svg class="ui-icon" aria-hidden="true"><use href="#ms-chevron-left"/></svg></button><span class="muted">' +
      (index + 1) +
      " / " +
      logs.length +
      '</span><button type="button" class="ui-button icon-only" aria-label="下一条导入记录" title="下一条" data-detail-step="1"' +
      (index === logs.length - 1 ? " disabled" : "") +
      '><svg class="ui-icon" aria-hidden="true"><use href="#ms-chevron-right"/></svg></button>';
    $("sourceBody").scrollTop = 0;
    if (changedDetail && pane.open)
      WorkTimeApp.ui.motion?.play($("sourceBody"), "motion-sidebar-forward");
    WorkTimeApp.ui.alignment?.refresh([pane]);
  }
  function showSources() {
    const day = model.state.days[model.selected] || {},
      logs = importIndex.logsForDate(model.state.imports, model.selected),
      log =
        model.state.imports.find((item) => item.id === day.oa?.importId) ||
        logs
          .slice()
          .reverse()
          .find((item) =>
            importIndex.describe(item).acceptedDates.includes(model.selected),
          ) ||
        logs.at(-1);
    if (!log) {
      actions.toast("未找到对应记录，请查看导入历史");
      return;
    }
    showImportDetail(log.id);
    actions.open("sourceDialog");
  }
  const oaShortcut = $("oaShortcut");
  function editOALink() {
    $("oaLinkInput").value = model.state.oaUrl || "";
    $("oaLinkError").textContent = "";
    actions.open("oaLinkDialog");
    $("oaLinkInput").focus();
  }
  function openOAWebsite() {
    if (!model.state.oaUrl) {
      editOALink();
      return;
    }
    try {
      const url = new URL(model.state.oaUrl);
      if (!["http:", "https:"].includes(url.protocol))
        throw Error("请使用 http 或 https 链接。");
      window.open(url.href, "_blank", "noopener,noreferrer");
    } catch (error) {
      if (disposed) return;
      editOALink();
      $("oaLinkError").textContent = error.message;
    }
  }
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    disposed = false;
    generation++;
    events.listen($("importDialog"), "close", resetImportInput);
    events.listen($("importDialog"), "sidebar-open", renderImportHistory);
    events.handler($("importHistoryList"), "onclick", (e) => {
      const view = e.target.closest("[data-view-import]"),
        remove = e.target.closest("[data-delete-import]");
      if (view) {
        const log = model.state.imports.find(
          (item) => item.id === view.dataset.viewImport,
        );
        if (!log) return;
        showImportDetail(log.id);
        actions.open("sourceDialog");
        return;
      }
      if (!remove) return;
      const log = model.state.imports.find(
        (x) => x.id === remove.dataset.deleteImport,
      );
      if (!log) return;
      importToDelete = log.id;
      const previewState = actions.clone(model.state),
        impact = C.deleteImport(previewState, log.id);
      $("deleteImportSummary").textContent =
        "删除 " +
        new Date(log.at).toLocaleString("zh-CN") +
        " 导入的 " +
        log.sources.map((s) => s.name).join("、") +
        "？将更新 " +
        impact.affected +
        " 个日期，其中 " +
        impact.restored +
        " 个日期回退到其他导入数据，" +
        impact.cleared +
        " 个日期撤回该批次打卡。";
      actions.open("deleteImportDialog");
    });
    events.handler($("confirmDeleteImport"), "onclick", () => {
      if (!importToDelete) return;
      const commit = application.removeImport(importToDelete);
      const result = commit.impact;
      importToDelete = null;
      $("deleteImportDialog").close();
      if (!result.removed) {
        actions.toast("该导入记录已不存在");
        return;
      }
      const saved = commit.persisted;
      actions.render();
      renderImportHistory();
      actions.saveFeedback(saved, "导入记录已删除，工时统计已更新");
    });
    events.handler($("sourceOpen"), "onclick", showSources);
    events.handler($("importOASite"), "onclick", () => {
      parseImport();
      actions.open("importDialog");
      openOAWebsite();
    });
    events.listen($("sourceDialog"), "click", detailClick);
    events.handler($("importOpen"), "onclick", () => {
      parseImport();
      actions.open("importDialog");
    });
    events.handler(
      document.querySelector("[data-import-clipboard]"),
      "onclick",
      importFromClipboard,
    );
    events.handler($("importOpen"), "onkeydown", (e) => {
      if (
        e.key === "Enter" &&
        e.shiftKey &&
        !$("importOpen").classList.contains("is-return")
      ) {
        e.preventDefault();
        importFromClipboard();
      }
    });
    holdAction = WorkTimeApp.ui.createHoldAction({
      button: oaShortcut,
      enabled: () => !!model.state.oaUrl,
      onShort: openOAWebsite,
      onLong: editOALink,
      cancelShortAfterFeedback: true,
    });
    events.listen($("importDialog"), "close", () => holdAction.cancel());
    events.handler($("oaLinkForm"), "onsubmit", (event) => {
      event.preventDefault();
      try {
        const url = new URL($("oaLinkInput").value.trim());
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw Error("请填写有效的 http 或 https 网页地址。");
        if (application.saveOAUrl(url.href).persisted) {
          $("oaLinkDialog").close();
          actions.toast("OA系统链接已保存");
        }
      } catch (error) {
        $("oaLinkError").textContent = error.message;
      }
    });
    events.handler($("pasteText"), "oninput", scheduleImportParse);
    events.handler($("commitImport"), "onclick", () => {
      if (!preview || !preview.rows.length || $("commitImport").disabled)
        return;
      const processed = preview.rows.length,
        acceptedRecords = WorkTimeApp.services.imports.acceptedRecords(
          preview,
          (row, i) =>
            $("importRows").querySelector('[data-conflict="' + i + '"]')
              ?.value || "new",
        );
      const saved = commitOARecords(
        acceptedRecords,
        preview.year,
        preview.sources,
        processed,
        preview.rows[0]?.record.date,
      );
      $("importDialog").close();
      actions.saveFeedback(saved, "导入完成，已处理 " + processed + " 条记录");
    });
  }
  function detailClick(event) {
    if (!$("sourceDialog").classList.contains("import-detail-view")) return;
    const step = event.target.closest("[data-detail-step]");
    if (step && !step.disabled) {
      const logs = model.state.imports.slice().reverse(),
        index = logs.findIndex((log) => log.id === detailId);
      const next = logs[index + Number(step.dataset.detailStep)];
      if (next) showImportDetail(next.id);
    }
  }
  function dispose() {
    generation++;
    events.dispose();
    bound = false;
    $("sourceDialog").removeEventListener("click", detailClick);
    disposed = true;
    $("importDialog").removeEventListener("sidebar-open", renderImportHistory);
    holdAction?.dispose();
    clearTimeout(importParseTimer);
  }
  const hasDraft = () =>
    !!$("pasteText").value.trim() ||
    ($("oaLinkDialog").open &&
      $("oaLinkInput").value.trim() !== model.state.oaUrl);
  return { bind, dispose, hasDraft };
};

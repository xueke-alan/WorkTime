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
    clock,
    importIndex,
    hydrateImports,
    clipboard,
  } = options;
  let holdAction = null;
  let preview = null;
  let disposed = false;
  let importParseTimer = null;
  let oaNavigationTimer = null;
  let resultsMode = "history";
  function anomalyReason(record) {
    if (!record.start && !record.end)
      return WorkTimeApp.i18n.t("copy.afaa05cdc4");
    if (!record.start) return WorkTimeApp.i18n.t("copy.447b0f2e6f");
    if (!record.end) return WorkTimeApp.i18n.t("copy.9236f52e70");
    const start = C.timeMin(record.start),
      end = C.timeMin(record.end);
    if (start === null || end === null)
      return WorkTimeApp.i18n.t("copy.8f73c836dc");
    if (!record.nextDay && end < start)
      return WorkTimeApp.i18n.t("copy.381c22871c");
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
      (record.nextDay ? WorkTimeApp.i18n.t("copy.c751037c58") : "") +
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
    setImportParseStatus("pending", WorkTimeApp.i18n.t("copy.a0f28b2e00"));
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
    $("importSummary").textContent = WorkTimeApp.i18n.t("copy.8b76d80fc7");
    $("importWarnings").textContent = "";
    if (showHistory) {
      $("importResultsTitle").textContent =
        WorkTimeApp.i18n.t("copy.dc71cd204d");
      $("importHistoryList").classList.remove("hidden");
      renderImportHistory();
      animateResults("history");
    }
  }
  function parseImport() {
    invalidatePreview(false);
    const year = clock.year(),
      sources = [];
    if ($("pasteText").value.trim())
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
      $("importWarnings").textContent = warnings
        .map(WorkTimeApp.i18n.message)
        .join("\n");
      $("importSummary").textContent =
        WorkTimeApp.i18n.t("copy.19b361b64c") +
        records.length +
        WorkTimeApp.i18n.t("copy.c538cd1f50") +
        warnings.length +
        WorkTimeApp.i18n.t("copy.3bc4aa604d") +
        rows.filter((x) => x.result.conflict).length +
        WorkTimeApp.i18n.t("copy.2f47bca658");
      $("importSummary").title =
        warnings.map(WorkTimeApp.i18n.message).join("\n") ||
        $("importSummary").textContent;
      $("importRows").innerHTML = rows
        .map(
          (x, i) =>
            "<article>" +
            recordCells(x.record) +
            (x.result.conflict
              ? '<div class="conflict">' +
                (x.result.repeated
                  ? WorkTimeApp.i18n.t("copy.36486f62eb")
                  : WorkTimeApp.i18n.t("copy.c8e8abf448") +
                    esc(x.old.start + "–" + x.old.end) +
                    WorkTimeApp.i18n.t("copy.c6750ea6a2") +
                    esc(x.record.start + "–" + x.record.end)) +
                '</div><select data-conflict="' +
                i +
                '" aria-label="' +
                x.record.date +
                WorkTimeApp.i18n.t("copy.c2583b0c68")
              : "") +
            (model.state.days[x.record.date] &&
            model.state.days[x.record.date].actual
              ? WorkTimeApp.i18n.t("copy.3a6c29659c")
              : "") +
            "</article>",
        )
        .join("");
      $("importTable").classList.toggle("hidden", !rows.length);
      $("importHistoryList").classList.add("hidden");
      $("importResultsTitle").textContent =
        WorkTimeApp.i18n.t("copy.2dc2565cb9");
      animateResults("results");
      const abnormalDates = new Set(
        rows
          .filter((row) => row.result.conflict || anomalyReason(row.record))
          .map((row) => row.record.date),
      );
      $("importHistoryCount").textContent =
        rows.length +
        WorkTimeApp.i18n.t("copy.0d19dbc09e") +
        abnormalDates.size +
        WorkTimeApp.i18n.t("copy.8fc2846555");
      $("commitImport").disabled = !rows.length;
      setImportParseStatus(
        !rows.length
          ? "error"
          : warnings.length || rows.some((x) => x.result.conflict)
            ? "warning"
            : "success",
      );
      if (!rows.length && !warnings.length)
        $("importSummary").textContent = WorkTimeApp.i18n.t("copy.f99e8f1ad6");
      if (!rows.length && !warnings.length)
        $("importWarnings").textContent = WorkTimeApp.i18n.t("copy.7a813c10de");
    } catch (error) {
      invalidatePreview();
      setImportParseStatus("error", WorkTimeApp.i18n.t("copy.0a95106968"));
      $("importSummary").textContent = WorkTimeApp.i18n.t("copy.52574f7e25");
      $("importWarnings").textContent =
        WorkTimeApp.i18n.t("copy.0542674ee0") +
        WorkTimeApp.i18n.message(error.message);
    }
  }
  async function commitOARecords(
    records,
    year,
    sources,
    count = records.length,
    focusDate = records[0]?.date,
  ) {
    const id = WorkTimeApp.services.archive.uuid();
    const saved = (
      await application.importRecords({
        id,
        at: clock.now().toISOString(),
        year,
        sources,
        count,
        records: records.map((record) => ({ ...record })),
      })
    ).persisted;
    if (focusDate) {
      model.month = focusDate.slice(0, 7);
      model.selected = focusDate;
    }
    actions.render();
    renderImportHistory();
    return saved;
  }
  let importToDelete = null;
  function importHistoryByTime() {
    return model.state.imports
      .slice()
      .reverse()
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }
  async function renderImportHistory() {
    try {
      await hydrateImports();
    } catch (error) {
      actions.toast(WorkTimeApp.i18n.message(error.message), "error");
      return;
    }
    if (disposed) return;
    const logs = importHistoryByTime();
    const dates = new Set(
      logs.flatMap((log) => importIndex.describe(log).acceptedDates),
    );
    if (!preview)
      $("importHistoryCount").textContent = WorkTimeApp.i18n.t(
        "import.historyTotals",
        { imports: logs.length, dates: dates.size },
      );
    $("importHistoryList").innerHTML = logs.length
      ? logs
          .map((log) => {
            const dates = importIndex.describe(log).rawDates;
            const range = dates.length
              ? dates[0].replaceAll("-", "/") +
                " - " +
                dates[dates.length - 1].replaceAll("-", "/")
              : WorkTimeApp.i18n.t("copy.0cee9f5104");
            return (
              '<article class="import-history-item" data-history-id="' +
              esc(log.id) +
              '"><div class="row between"><h3>' +
              esc(
                new Date(log.at).toLocaleString(WorkTimeApp.i18n.locale, {
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
              WorkTimeApp.i18n.t("copy.fb7fd1001d") +
              esc(log.id) +
              WorkTimeApp.i18n.t("copy.74a12ef5dc") +
              esc(range) +
              " · " +
              log.count +
              WorkTimeApp.i18n.t("copy.81a9b617ab")
            );
          })
          .join("")
      : WorkTimeApp.i18n.t("copy.d6971aab23");
  }
  let detailId = null;
  async function showImportDetail(id) {
    try {
      await hydrateImports();
    } catch (error) {
      actions.toast(WorkTimeApp.i18n.message(error.message), "error");
      return;
    }
    if (disposed) return;
    const logs = importHistoryByTime(),
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
        new Date(log.at).toLocaleString(WorkTimeApp.i18n.locale, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      ) +
      WorkTimeApp.i18n.t("copy.b336d19181");
    const records = log.records;
    $("sourceBody").innerHTML =
      '<div class="import-detail-toolbar"><span class="muted">' +
      records.length +
      WorkTimeApp.i18n.t("copy.0d19dbc09e") +
      records.filter((record) => anomalyReason(record)).length +
      WorkTimeApp.i18n.t("copy.6827141ae0") +
      '<div class="import-parsed-list">' +
      records
        .map((record) => "<article>" + recordCells(record) + "</article>")
        .join("") +
      (records.length ? "" : WorkTimeApp.i18n.t("copy.dafb4362f7")) +
      "</div>" +
      WorkTimeApp.i18n.t("copy.ae4748b462") +
      WorkTimeApp.i18n.t("copy.d7f42a424c") +
      esc(log.sources.map((source) => source.raw).join("\n\n")) +
      "</textarea></div>";
    pane.querySelector(".dialog-foot").innerHTML =
      WorkTimeApp.i18n.t("copy.5c7f465892") +
      (index === 0 ? " disabled" : "") +
      '><svg class="ui-icon" aria-hidden="true"><use href="#ms-chevron-left"/></svg></button><span class="muted">' +
      (index + 1) +
      " / " +
      logs.length +
      WorkTimeApp.i18n.t("copy.80bab87117") +
      (index === logs.length - 1 ? " disabled" : "") +
      '><svg class="ui-icon" aria-hidden="true"><use href="#ms-chevron-right"/></svg></button>';
    $("sourceBody").scrollTop = 0;
    if (changedDetail && pane.open)
      WorkTimeApp.ui.motion?.play($("sourceBody"), "motion-sidebar-forward");
    WorkTimeApp.ui.alignment?.refresh([pane]);
  }
  async function showSources() {
    try {
      await hydrateImports();
    } catch (error) {
      actions.toast(WorkTimeApp.i18n.message(error.message), "error");
      return;
    }
    if (disposed) return;
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
      actions.toast(WorkTimeApp.i18n.t("copy.184ad4d4ad"));
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
        throw Error(WorkTimeApp.i18n.t("copy.617fe2d78b"));
      // A popup may suspend painting before blur/visibilitychange is delivered.
      // Leave the sidebar at its final state before handing focus to OA.
      actions.finishSidebarNavigation();
      window.open(url.href, "_blank", "noopener,noreferrer");
    } catch (error) {
      if (disposed) return;
      editOALink();
      $("oaLinkError").textContent = WorkTimeApp.i18n.message(error.message);
    }
  }
  function cancelOANavigation() {
    clearTimeout(oaNavigationTimer);
    oaNavigationTimer = null;
  }
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    disposed = false;
    events.listen(document, "worktime:languagechange", () => {
      if (preview) {
        const choices = [
          ...$("importRows").querySelectorAll("[data-conflict]"),
        ].map((select) => [select.dataset.conflict, select.value]);
        parseImport();
        for (const [index, value] of choices) {
          const select = $("importRows").querySelector(
            '[data-conflict="' + index + '"]',
          );
          if (select) select.value = value;
        }
      } else renderImportHistory();
      if ($("sourceDialog").open && detailId) showImportDetail(detailId);
    });
    events.listen($("importDialog"), "close", resetImportInput);
    events.listen($("importDialog"), "close", cancelOANavigation);
    events.listen($("importDialog"), "sidebar-open", renderImportHistory);
    events.handler($("importHistoryList"), "onclick", async (e) => {
      await hydrateImports();
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
      $("deleteImportSummary").textContent = WorkTimeApp.i18n.t(
        "import.deleteSummary",
        {
          date: new Date(log.at).toLocaleString(WorkTimeApp.i18n.locale),
          sources: log.sources.map((s) => s.name).join(", "),
          affected: impact.affected,
          restored: impact.restored,
          cleared: impact.cleared,
        },
      );
      actions.open("deleteImportDialog");
    });
    events.handler($("confirmDeleteImport"), "onclick", async () => {
      if (!importToDelete) return;
      const commit = await application.removeImport(importToDelete);
      const result = commit.impact;
      importToDelete = null;
      $("deleteImportDialog").close();
      if (!result.removed) {
        actions.toast(WorkTimeApp.i18n.t("copy.38e1e768da"));
        return;
      }
      const saved = commit.persisted;
      actions.render();
      renderImportHistory();
      actions.saveFeedback(saved, WorkTimeApp.i18n.t("copy.5986f6bd33"));
    });
    events.handler($("sourceOpen"), "onclick", showSources);
    events.handler($("importOASite"), "onclick", () => {
      parseImport();
      actions.open("importDialog", { motionDuration: 0 });
      cancelOANavigation();
      // Give the browser time to paint the settled sidebar before OA takes focus.
      oaNavigationTimer = setTimeout(() => {
        oaNavigationTimer = null;
        if (!disposed && $("importDialog").open) openOAWebsite();
      }, 10);
    });
    events.listen($("sourceDialog"), "click", detailClick);
    events.handler($("importOpen"), "onclick", () => {
      parseImport();
      actions.open("importDialog");
    });
    holdAction = WorkTimeApp.ui.createHoldAction({
      button: oaShortcut,
      enabled: () => !!model.state.oaUrl,
      onShort: openOAWebsite,
      onLong: editOALink,
      cancelShortAfterFeedback: true,
    });
    events.listen($("importDialog"), "close", () => holdAction.cancel());
    events.handler($("oaLinkForm"), "onsubmit", async (event) => {
      event.preventDefault();
      try {
        const url = new URL($("oaLinkInput").value.trim());
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw Error(WorkTimeApp.i18n.t("copy.1b5b47c899"));
        if ((await application.saveOAUrl(url.href)).persisted) {
          $("oaLinkDialog").close();
          actions.toast(WorkTimeApp.i18n.t("copy.130c1e06f3"));
        }
      } catch (error) {
        $("oaLinkError").textContent = WorkTimeApp.i18n.message(error.message);
      }
    });
    events.handler($("pasteText"), "oninput", scheduleImportParse);
    events.handler($("pasteOAClipboard"), "onclick", async () => {
      const button = $("pasteOAClipboard"),
        input = $("pasteText"),
        start = input.selectionStart,
        end = input.selectionEnd;
      if (button.disabled) return;
      button.disabled = true;
      try {
        const text = await clipboard.readText();
        if (disposed || !$("importDialog").open) return;
        if (!text.trim()) {
          actions.toast(WorkTimeApp.i18n.t("copy.041c1e0625"));
          return;
        }
        input.setRangeText(text, start, end, "end");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus({ preventScroll: true });
      } catch (error) {
        if (disposed || !$("importDialog").open) return;
        actions.toast(WorkTimeApp.i18n.t("copy.a97d627f90"), "error");
        input.focus({ preventScroll: true });
      } finally {
        button.disabled = false;
      }
    });
    events.handler($("commitImport"), "onclick", async () => {
      if (!preview || !preview.rows.length || $("commitImport").disabled)
        return;
      const processed = preview.rows.length,
        acceptedRecords = WorkTimeApp.services.imports.acceptedRecords(
          preview,
          (row, i) =>
            $("importRows").querySelector('[data-conflict="' + i + '"]')
              ?.value || "new",
        );
      const saved = await commitOARecords(
        acceptedRecords,
        preview.year,
        preview.sources,
        processed,
        preview.rows[0]?.record.date,
      );
      $("importDialog").close();
      actions.saveFeedback(
        saved,
        WorkTimeApp.i18n.t("copy.a3fdb05924") +
          processed +
          WorkTimeApp.i18n.t("copy.bed75b3651"),
      );
    });
  }
  function detailClick(event) {
    if (!$("sourceDialog").classList.contains("import-detail-view")) return;
    const step = event.target.closest("[data-detail-step]");
    if (step && !step.disabled) {
      const logs = importHistoryByTime(),
        index = logs.findIndex((log) => log.id === detailId);
      const next = logs[index + Number(step.dataset.detailStep)];
      if (next) showImportDetail(next.id);
    }
  }
  function dispose() {
    events.dispose();
    bound = false;
    $("sourceDialog").removeEventListener("click", detailClick);
    disposed = true;
    $("importDialog").removeEventListener("sidebar-open", renderImportHistory);
    holdAction?.dispose();
    clearTimeout(importParseTimer);
    cancelOANavigation();
  }
  const hasDraft = () =>
    !!$("pasteText").value.trim() ||
    ($("oaLinkDialog").open &&
      $("oaLinkInput").value.trim() !== model.state.oaUrl);
  return { bind, dispose, hasDraft };
};

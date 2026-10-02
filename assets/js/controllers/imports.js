"use strict";
/** imports controller. Instantiate once, then bind after all actions are connected. */
WorkUI.createImportController = function (options) {
  const {
    element: $,
    core: C,
    escape: esc,
    model,
    actions,
    clipboard,
    clock,
    importIndex,
  } = options;
  let oaFinishTimer = null;
  let preview = null;
  let disposed = false;
  let importParseTimer = null;
  function resetImportInput() {
    $("pasteText").value = "";
    $("importRows").innerHTML = "";
    invalidatePreview();
  }
  function setImportParseStatus(status) {
    const button = $("previewImport"),
      state = status === "pending" ? "idle" : status;
    button.dataset.state = state;
    button.textContent = {
      idle: "暂无解析",
      success: "解析成功",
      error: "解析失败",
      warning: "解析异常",
    }[state];
    button.disabled = !["success", "warning"].includes(state);
    button.setAttribute("aria-busy", String(status === "pending"));
    button.title =
      state === "warning"
        ? "点击查看具体解析情况"
        : state === "success"
          ? "没有异常，点击查看解析记录"
          : state === "error"
            ? "未能解析出可导入记录，请检查输入"
            : "请粘贴 OA 文本";
  }
  function collapseImportDetails() {
    $("importDetails").classList.add("hidden");
    $("previewImport").setAttribute("aria-expanded", "false");
  }
  function scheduleImportParse() {
    invalidatePreview();
    setImportParseStatus("pending", "正在解析…");
    importParseTimer = setTimeout(parseImport, 250);
  }
  function invalidatePreview() {
    collapseImportDetails();
    clearTimeout(importParseTimer);
    importParseTimer = null;
    setImportParseStatus("idle", "");
    preview = null;
    $("commitImport").disabled = true;
    $("importTable").classList.add("hidden");
    $("importSummary").textContent = "暂无解析";
    $("importWarnings").textContent = "";
  }
  function parseImport(inputSources = null) {
    invalidatePreview();
    const year = updateImportYearHint(),
      sources = Array.isArray(inputSources) ? inputSources : [];
    if (!inputSources && $("pasteText").value.trim())
      sources.push({ name: "粘贴文本", raw: $("pasteText").value });
    if (!sources.length) return;
    try {
      const plan = WorkImports.prepare(C, model.state, sources, year),
        { records, warnings, rows } = plan;
      preview = rows.length ? plan : null;
      $("importWarnings").textContent = warnings.join("\n");
      $("importSummary").textContent =
        records.length +
        " 条可导入记录 · " +
        warnings.length +
        " 条提示 · " +
        rows.filter((x) => x.result.conflict).length +
        " 条冲突";
      $("importRows").innerHTML = rows
        .map(
          (x, i) =>
            "<tr><td>" +
            x.record.date +
            "</td><td>" +
            esc((x.record.start || "—") + " / " + (x.record.end || "—")) +
            "</td><td>" +
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
              : esc(x.result.action)) +
            (model.state.days[x.record.date] &&
            model.state.days[x.record.date].actual
              ? '<div class="muted">手动填写仍保留</div>'
              : "") +
            "</td></tr>",
        )
        .join("");
      $("importTable").classList.toggle("hidden", !rows.length);
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
    for (const record of records) C.applyObservation(model.state, record, id);
    model.state.imports.push({
      id,
      at: clock.now().toISOString(),
      year,
      sources,
      count,
      records: records.map((record) => ({ ...record })),
    });
    if (focusDate) {
      model.month = focusDate.slice(0, 7);
      model.selected = focusDate;
    }
    const saved = actions.save();
    actions.render();
    return saved;
  }
  async function importFromClipboard() {
    try {
      const raw = await clipboard.readText();
      if (disposed) return;
      if (!raw.trim()) throw Error("剪贴板中没有 OA 文本");
      if (raw.length > 5 * 1024 * 1024) throw Error("剪贴板文本超过 5MB");
      const year = clock.year(),
        sources = [{ name: "剪贴板", raw }],
        plan = WorkImports.prepare(C, model.state, sources, year);
      if (!plan.records.length)
        throw Error(plan.warnings[0] || "未识别到 OA 记录");
      if (plan.needsReview) {
        $("pasteText").value = raw;
        parseImport(sources);
        actions.open("importDialog");
        $("importDetails").classList.remove("hidden");
        $("previewImport").setAttribute("aria-expanded", "true");
        actions.toast("剪贴板记录存在冲突或提示，请核查后确认导入");
        return;
      }
      const saved = commitOARecords(
        WorkImports.acceptedRecords(plan),
        year,
        sources,
      );
      actions.saveFeedback(
        saved,
        "已从剪贴板导入 " + plan.records.length + " 条 OA 记录",
      );
    } catch (err) {
      if (disposed) return;
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
    $("importHistoryList").innerHTML = logs.length
      ? logs
          .map((log) => {
            const dates = importIndex.describe(log).rawDates;
            const range = dates.length
              ? dates[0] + " → " + dates[dates.length - 1]
              : "未识别日期";
            return (
              '<article class="import-history-item" data-history-id="' +
              esc(log.id) +
              '"><div class="row between"><h3>' +
              esc(new Date(log.at).toLocaleString("zh-CN")) +
              '</h3><div class="row"><button type="button" data-view-import="' +
              esc(log.id) +
              '">查看</button><button type="button" class="danger" data-delete-import="' +
              esc(log.id) +
              '">删除</button></div></div><div class="import-history-meta">' +
              esc(log.sources.map((s) => s.name).join("、")) +
              "<br>" +
              esc(range) +
              " · 识别 " +
              log.count +
              " 条记录 · " +
              log.sources.length +
              " 个来源</div><details><summary>" +
              actions.controlIcon("disclose") +
              "<span>查看导入原文</span></summary>" +
              log.sources
                .map(
                  (source) =>
                    '<h3 class="import-source-heading">' +
                    esc(source.name) +
                    "</h3><pre>" +
                    esc(source.raw) +
                    "</pre>",
                )
                .join("") +
              "</details></article>"
            );
          })
          .join("")
      : '<div class="import-history-empty">暂无导入历史</div>';
  }
  function showSources() {
    const day = model.state.days[model.selected] || {},
      logs = importIndex.logsForDate(model.state.imports, model.selected);
    $("sourceBody").innerHTML =
      "<h3>" +
      model.selected +
      "</h3>" +
      (day.oa
        ? '<p class="help">当前 OA：' +
          esc(day.oa.source) +
          '</p><pre class="source-record-text">' +
          esc(day.oa.raw) +
          "</pre>"
        : "") +
      logs
        .map(
          (log) =>
            '<details class="dialog-section-spacing"><summary>' +
            actions.controlIcon("disclose") +
            "<span>" +
            esc(new Date(log.at).toLocaleString("zh-CN")) +
            " · " +
            log.count +
            " 条记录</span></summary>" +
            log.sources
              .map(
                (src) =>
                  '<h3 class="dialog-section-spacing">' +
                  esc(src.name) +
                  '</h3><pre class="source-raw-text">' +
                  esc(src.raw) +
                  "</pre>",
              )
              .join("") +
            "</details>",
        )
        .join("");
    actions.open("sourceDialog");
  }
  function updateImportYearHint() {
    const year = clock.year();
    $("importYearHint").textContent = "将按浏览器当前年份 " + year + " 导入";
    return year;
  }
  const oaShortcut = $("oaShortcut");
  let oaHoldTimer = null,
    oaRingTimer = null,
    oaHeld = false,
    oaPressActive = false,
    oaCompleting = false,
    oaResetAnimation = null;
  function editOALink() {
    $("oaLinkInput").value = model.state.oaUrl || "";
    $("oaLinkError").textContent = "";
    actions.open("oaLinkDialog");
    $("oaLinkInput").focus();
  }
  function endOAHold() {
    clearTimeout(oaHoldTimer);
    clearTimeout(oaRingTimer);
    oaHoldTimer = null;
    oaRingTimer = null;
    const wasActive = oaPressActive;
    oaPressActive = false;
    if (
      oaCompleting ||
      !wasActive ||
      !oaShortcut.classList.contains("is-holding")
    )
      return;
    const ring = oaShortcut.querySelector(".hold-progress"),
      offset = getComputedStyle(ring).strokeDashoffset;
    oaShortcut.classList.remove("is-holding");
    oaShortcut.classList.add("is-resetting");
    oaResetAnimation = ring.animate(
      [{ strokeDashoffset: offset }, { strokeDashoffset: "100" }],
      {
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 300,
        easing: "ease-out",
        fill: "forwards",
      },
    );
    const animation = oaResetAnimation;
    animation.finished
      .then(() => {
        if (oaResetAnimation !== animation) return;
        oaShortcut.classList.remove("is-resetting");
        animation.cancel();
        oaResetAnimation = null;
      })
      .catch(() => {});
  }
  function startOAHold() {
    if (!model.state.oaUrl || oaPressActive || oaCompleting) return;
    oaResetAnimation?.cancel();
    oaResetAnimation = null;
    oaShortcut.classList.remove("is-resetting");
    oaHeld = false;
    oaPressActive = true;
    oaRingTimer = setTimeout(() => {
      if (oaPressActive) oaShortcut.classList.add("is-holding");
    }, 200);
    oaHoldTimer = setTimeout(() => {
      oaHeld = true;
      oaCompleting = true;
      endOAHold();
      oaShortcut.classList.add("is-completing");
      oaFinishTimer = setTimeout(() => {
        oaShortcut.classList.remove("is-holding", "is-completing");
        oaCompleting = false;
        editOALink();
      }, 450);
    }, 2000);
  }
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    $("importDialog").addEventListener("close", resetImportInput);
    $("previewImport").onclick = () => {
      const expanded =
        $("previewImport").getAttribute("aria-expanded") !== "true";
      $("importDetails").classList.toggle("hidden", !expanded);
      $("previewImport").setAttribute("aria-expanded", String(expanded));
    };
    $("importHistoryOpen").onclick = () => {
      renderImportHistory();
      actions.open("importHistoryDialog");
    };
    $("importHistoryList").onclick = (e) => {
      const view = e.target.closest("[data-view-import]"),
        remove = e.target.closest("[data-delete-import]");
      if (view) {
        const details = view
          .closest(".import-history-item")
          .querySelector("details");
        details.open = !details.open;
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
    };
    $("confirmDeleteImport").onclick = () => {
      if (!importToDelete) return;
      const result = C.deleteImport(model.state, importToDelete);
      importToDelete = null;
      $("deleteImportDialog").close();
      if (!result.removed) {
        actions.toast("该导入记录已不存在");
        return;
      }
      const saved = actions.save();
      actions.render();
      renderImportHistory();
      actions.saveFeedback(saved, "导入记录已删除，工时统计已更新");
    };
    $("sourceOpen").onclick = showSources;
    $("importOpen").onclick = (e) => {
      if (e.target.closest("[data-import-clipboard]")) importFromClipboard();
      else {
        updateImportYearHint();
        parseImport();
        actions.open("importDialog");
      }
    };
    $("importOpen").onkeydown = (e) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        importFromClipboard();
      }
    };
    oaShortcut.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      oaShortcut.setPointerCapture(event.pointerId);
      startOAHold();
    });
    oaShortcut.addEventListener("pointerup", () => {
      if (oaShortcut.classList.contains("is-holding")) oaHeld = true;
      endOAHold();
    });
    oaShortcut.addEventListener("pointermove", (event) => {
      if (!oaPressActive) return;
      const r = oaShortcut.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      ) {
        oaHeld = true;
        endOAHold();
      }
    });
    oaShortcut.addEventListener("pointercancel", () => {
      endOAHold();
      oaHeld = false;
    });
    oaShortcut.addEventListener("pointerleave", () => {
      if (oaPressActive) oaHeld = true;
      endOAHold();
    });
    oaShortcut.addEventListener("contextmenu", (event) =>
      event.preventDefault(),
    );
    oaShortcut.addEventListener("keydown", (event) => {
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) startOAHold();
      }
      if (event.key === "Escape") {
        endOAHold();
        oaHeld = false;
      }
    });
    oaShortcut.addEventListener("keyup", (event) => {
      if (event.code === "Space") {
        event.preventDefault();
        if (oaShortcut.classList.contains("is-holding")) oaHeld = true;
        endOAHold();
        oaShortcut.click();
      }
    });
    oaShortcut.addEventListener("blur", endOAHold);
    $("importDialog").addEventListener("close", () => {
      endOAHold();
      oaHeld = false;
    });
    oaShortcut.onclick = () => {
      if (oaCompleting) return;
      if (oaHeld) {
        oaHeld = false;
        return;
      }
      endOAHold();
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
    };
    $("oaLinkForm").onsubmit = (event) => {
      event.preventDefault();
      try {
        const url = new URL($("oaLinkInput").value.trim());
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw Error("请填写有效的 http 或 https 网页地址。");
        model.state.oaUrl = url.href;
        if (actions.save()) {
          $("oaLinkDialog").close();
          actions.toast("OA系统链接已保存");
        }
      } catch (error) {
        $("oaLinkError").textContent = error.message;
      }
    };
    updateImportYearHint();
    $("pasteText").oninput = scheduleImportParse;
    $("commitImport").onclick = () => {
      if (!preview || !preview.rows.length || $("commitImport").disabled)
        return;
      const processed = preview.rows.length,
        acceptedRecords = WorkImports.acceptedRecords(
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
    };
  }
  function dispose() {
    disposed = true;
    clearTimeout(oaFinishTimer);
    clearTimeout(importParseTimer);
    clearTimeout(oaHoldTimer);
    clearTimeout(oaRingTimer);
    oaResetAnimation?.cancel();
  }
  return { bind, dispose };
};

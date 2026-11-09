"use strict";
/** A proposed directory is kept separate until the explicit commit succeeds. */
WorkTimeApp.ui.showRuntimeFolderChange = (() => {
  let dialog;
  return () => {
    if (dialog?.open) return;
    dialog?.remove();
    const runtime = WorkTimeApp.services.runtimeFolder;
    const text = WorkTimeApp.ui.runtimeFolderText;
    dialog = document.createElement("dialog");
    const view = dialog;
    view.id = "runtimeFolderChange";
    view.setAttribute("aria-labelledby", "runtimeFolderChangeTitle");
    view.setAttribute("closedby", "none");
    const folderIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z"/></svg>`;
    view.innerHTML = `<div class="dialog-head">
        <h2 id="runtimeFolderChangeTitle"></h2>
      </div>
      <div class="dialog-body">
        <div class="folder-change-locations">
          <div class="folder-change-current">${folderIcon}<div class="folder-change-identity"><span class="folder-change-label" data-current-label></span><strong data-current></strong></div></div>
          <button type="button" class="folder-change-picker" data-select>
            <span class="folder-change-destination-icon">${folderIcon}</span>
            <span class="folder-change-identity"><span class="folder-change-label" data-target-label></span><strong data-target></strong></span>
            <span class="folder-change-select-action"><span data-select-label></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></span>
          </button>
        <label class="folder-change-migration"><span class="folder-change-checkbox"><input type="checkbox" data-migrate><span class="folder-change-check"><svg class="ui-icon" aria-hidden="true"><use href="#ms-check"/></svg></span></span><span><span class="folder-change-option-title" data-migrate-label></span><span class="folder-change-help" data-help></span></span></label>
        </div>
        <section class="folder-change-feedback hidden" data-feedback aria-live="polite">
          <div class="folder-change-feedback-head"><p role="status" data-status></p><span class="folder-change-percent" data-percent></span></div>
          <progress max="1" data-progress></progress>
          <p class="folder-change-stats" data-stats></p><p class="folder-change-path" data-path></p>
        </section>
        <p class="hidden"><button type="button" class="ui-button" data-authorize></button></p>
      </div><div class="dialog-foot">
        <button type="button" class="ui-button" data-close></button>
        <button type="button" class="ui-button" data-abort></button>
        <button type="button" class="ui-button primary" data-submit></button>
      </div>`;
    const find = (name) => view.querySelector(`[data-${name}]`);
    let selection = null,
      pending = false,
      selecting = false,
      abort = null,
      last = null,
      error = null,
      done = false,
      invalid = "";
    function render() {
      view.setAttribute("aria-busy", String(pending || selecting));
      const hide = (name, value) => {
        find(name).hidden = value;
        find(name).classList.toggle("hidden", value);
      };
      find("current-label").textContent = text("currentFolderTitle");
      find("target-label").textContent = text("newFolderTitle");
      find("current").textContent = done
        ? selection.source.name
        : runtime.state.name;
      find("target").textContent =
        selection?.selected.name || text("folderNotSelected");
      view.classList.toggle("has-selection", !!selection);
      view.dataset.state = done
        ? "done"
        : error || invalid
          ? "error"
          : pending
            ? "pending"
            : "ready";
      view.querySelector("h2").textContent = text("changeFolder");
      find("select-label").textContent = text("selectNewFolder");
      find("migrate-label").textContent = text("migrateFiles");
      find("help").textContent = text(
        find("migrate").checked ? "migrateHelp" : "switchHelp",
      );
      find("select").disabled =
        pending || selecting || done || runtime.state.busy;
      find("migrate").disabled = pending || selecting || done;
      find("submit").textContent = text("confirmFolder");
      hide("submit", done || pending);
      find("submit").disabled =
        !selection || !!invalid || pending || selecting || runtime.state.busy;
      find("close").textContent = text(done ? "finished" : "changeCancel");
      hide("close", pending);
      find("close").disabled = pending || selecting;
      find("abort").textContent = text("cancelMigration");
      hide("abort", !pending);
      find("abort").disabled =
        last?.phase === "saving" || !!abort?.signal.aborted;
      find("authorize").textContent = text("restorePermission");
      hide("authorize", error?.folderCode !== "sourcePermission");
      find("authorize").parentElement.classList.toggle(
        "hidden",
        error?.folderCode !== "sourcePermission",
      );
      find("authorize").disabled = pending || selecting;
      const bar = find("progress");
      hide("progress", !pending);
      bar.setAttribute("aria-label", text("migrateFiles"));
      if (last?.phase === "copying")
        bar.value = last.totalBytes
          ? Math.min(1, last.processedBytes / last.totalBytes)
          : 1;
      else bar.removeAttribute("value");
      let message = invalid ? text(invalid) : "";
      find("percent").textContent =
        pending && last?.phase === "copying"
          ? `${Math.floor(bar.value * 100)}%`
          : "";
      const bytes = (value) => {
        const unit =
          value > 0
            ? Math.min(3, Math.floor(Math.log(value) / Math.log(1024)))
            : 0;
        return `${new Intl.NumberFormat(WorkTimeApp.i18n.language, { maximumFractionDigits: 1 }).format(value / 1024 ** unit)} ${["B", "KB", "MB", "GB"][unit]}`;
      };
      find("stats").textContent =
        pending && last?.phase === "copying"
          ? `${last.completed + last.skipped} / ${last.total} · ${bytes(last.processedBytes)} / ${bytes(last.totalBytes)}`
          : "";
      find("path").textContent = pending ? last?.current || "" : "";
      if (error) {
        const code =
          error.name === "AbortError"
            ? "cancelled"
            : error.folderCode ||
              (error.name === "NotAllowedError"
                ? "permission"
                : "migrationFailed");
        message =
          text(code) +
          (error.path ? " · " + error.path : "") +
          " " +
          text("migrationRetained");
        if (error.cleanupFailed) message += " " + text("cleanupFailed");
      } else if (done) message = text("migrationDone", last);
      else if (pending && last) {
        message = text("migration" + last.phase);
      }
      find("status").textContent = message;
      hide("feedback", !message && !pending);
    }
    find("select").onclick = async () => {
      selecting = true;
      error = null;
      try {
        const task = runtime.pickReplacement();
        render();
        const next = await task;
        if (next) {
          selection = next;
          invalid = (await next.source.isSameEntry(next.selected))
            ? "sameFolder"
            : (await next.source.resolve(next.selected)) !== null ||
                (await next.selected.resolve(next.source)) !== null
              ? "nestedFolder"
              : "";
        }
      } catch (value) {
        error = value;
      } finally {
        selecting = false;
        render();
      }
    };
    find("authorize").onclick = async () => {
      selecting = true;
      try {
        const task = selection.source.requestPermission({ mode: "readwrite" });
        render();
        if ((await task) === "granted") error = null;
      } catch (value) {
        error = value;
      } finally {
        selecting = false;
        render();
      }
    };
    find("migrate").onchange = render;
    find("abort").onclick = () => {
      abort?.abort();
      render();
    };
    find("close").onclick = () => {
      if (!pending && !selecting) view.close();
    };
    view.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!pending && !selecting) view.close();
    });
    find("submit").onclick = async () => {
      if (!selection || invalid || pending || runtime.state.busy) return;
      pending = true;
      error = null;
      last = null;
      abort = new AbortController();
      render();
      try {
        last = await runtime.changeFolder(selection, {
          migrate: find("migrate").checked,
          signal: abort.signal,
          progress: (value) => {
            last = value;
            render();
          },
        });
        done = true;
        document.dispatchEvent(new Event("worktime:autobackupretry"));
      } catch (value) {
        error = value;
      } finally {
        pending = false;
        render();
        if (done) find("close").focus();
      }
    };
    const unsubscribe = runtime.subscribe(render);
    document.addEventListener("worktime:languagechange", render);
    view.addEventListener(
      "close",
      () => {
        unsubscribe();
        document.removeEventListener("worktime:languagechange", render);
      },
      { once: true },
    );
    document.body.append(view);
    render();
    view.showModal();
  };
})();

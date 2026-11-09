"use strict";
/** Persistent imports share feedback, permission recovery and cancellation. */
WorkTimeApp.ui.createRuntimeImport = function ({
  host,
  statusHost,
  kind,
  refresh,
}) {
  const runtime = WorkTimeApp.services.runtimeFolder;
  const text = WorkTimeApp.ui.runtimeFolderText;
  const status = document.createElement("div");
  status.className = "runtime-import-status";
  status.hidden = true;
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  const setup = document.createElement("button");
  setup.className = "ui-button";
  setup.type = "button";
  const cancel = document.createElement("button");
  cancel.className = "ui-button";
  cancel.type = "button";
  cancel.hidden = true;
  const progressBar = document.createElement("progress");
  progressBar.className = "runtime-import-progress";
  progressBar.max = 1;
  progressBar.value = 0;
  progressBar.hidden = true;
  const errors = document.createElement("details");
  const errorLabel = document.createElement("summary");
  const errorList = document.createElement("ul");
  errors.append(errorLabel, errorList);
  errors.hidden = true;
  status.append(message, progressBar, setup, cancel, errors);
  statusHost.append(status);
  let abort = null,
    last = null,
    problem = "";
  let copying = false,
    disposed = false;
  function render() {
    if (disposed) return;
    const state = runtime.state;
    for (const button of host.querySelectorAll(
      '[data-runtime-action="import"]',
    ))
      button.disabled = !!abort || state.busy || !state.supported;
    setup.textContent = text(state.name ? "authorize" : "label");
    setup.hidden = !!abort || state.status === "available";
    setup.disabled = state.busy || !state.supported;
    cancel.textContent = text("cancel");
    cancel.hidden = !abort || !copying;
    progressBar.hidden = !copying;
    progressBar.setAttribute("aria-label", text("importFiles"));
    progressBar.value = last?.totalBytes
      ? Math.min(1, last.processedBytes / last.totalBytes)
      : 0;
    let content = "";
    if (problem) content = problem;
    else if (last)
      content =
        (copying
          ? text("importing", { name: last.current }) +
            ` · ${Math.floor(progressBar.value * 100)}% · `
          : "") +
        text("summary", last) +
        (last.cancelled ? " · " + text("cancelled") : "");
    else if (state.status !== "available")
      content = text(
        !state.supported
          ? "unsupported"
          : state.status === "download"
            ? "needsInitialization"
            : state.status,
        { name: state.detail || state.progress },
      );
    if (message.textContent !== content) message.textContent = content;
    status.hidden = !message.textContent && !abort;
    if (!status.hidden) statusHost.hidden = false;
  }
  async function importFiles(files) {
    if (disposed || abort || !files.length) return;
    abort = new AbortController();
    copying = true;
    problem = "";
    errors.hidden = true;
    last = { completed: 0, skipped: 0, unsupported: 0, failed: 0, current: "" };
    render();
    try {
      const result = await runtime.importFiles(kind, files, {
        signal: abort.signal,
        progress(value) {
          last = value;
          render();
        },
      });
      if (disposed) return;
      last = result;
      copying = false;
      render();
      if (result.errors.length) {
        errorLabel.textContent = text("summary", result);
        errorList.replaceChildren(
          ...result.errors.map((entry) => {
            const item = document.createElement("li");
            item.textContent = entry.path + ": " + entry.message;
            return item;
          }),
        );
        errors.hidden = false;
      }
      await refresh(result);
    } catch (error) {
      problem = text(error.folderCode || "failed", {
        name: runtime.state.detail || error.message,
      });
    } finally {
      abort = null;
      copying = false;
      render();
    }
  }
  const inputs = [false, true].map((folder) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.hidden = true;
    input.dataset.runtimeImport = folder ? "folder" : "files";
    input.webkitdirectory = folder;
    if (!folder)
      input.accept =
        kind === "ebooks"
          ? ".epub,.pdf,.txt"
          : "audio/*,.mp3,.m4a,.mp4,.aac,.flac,.wav,.wave,.ogg,.oga,.opus,.webm,.lrc,.txt,.jpg,.jpeg,.png,.webp";
    input.onchange = () => {
      const files = [...input.files];
      input.value = "";
      void importFiles(files);
    };
    host.append(input);
    return input;
  });
  setup.onclick = async () => {
    if (disposed) return;
    problem = "";
    try {
      if (runtime.state.name) await runtime.authorize();
      else await runtime.choose();
      if (!disposed) await refresh();
    } catch (error) {
      problem = text(error.folderCode || "failed", {
        name: runtime.state.detail || error.message,
      });
    }
    render();
  };
  cancel.onclick = () => abort?.abort();
  const unsubscribe = runtime.subscribe(render);
  document.addEventListener("worktime:languagechange", render);
  render();
  return {
    get hasFeedback() {
      return !status.hidden;
    },
    get isImporting() {
      return !!abort;
    },
    open(folder = false) {
      if (disposed) return;
      if (runtime.state.status !== "available" || !runtime.state.supported) {
        problem = "";
        render();
        setup.focus();
        return;
      }
      if (!abort && !runtime.state.busy) inputs[folder ? 1 : 0].click();
    },
    importFiles,
    dispose() {
      if (disposed) return;
      disposed = true;
      abort?.abort();
      unsubscribe();
      document.removeEventListener("worktime:languagechange", render);
      status.remove();
      inputs.forEach((input) => input.remove());
    },
  };
};

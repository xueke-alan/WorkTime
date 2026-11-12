"use strict";
/** Folder settings copy stays available in all offline languages. */
WorkTimeApp.ui.autoBackupFolderText = (() => {
  const rows = {
    label: [
      "存档文件夹",
      "存檔資料夾",
      "存檔資料夾",
      "Backup folder",
      "保存先",
      "보관 폴더",
    ],
    choose: [
      "选择文件夹",
      "選擇資料夾",
      "選擇資料夾",
      "Choose folder",
      "フォルダーを選択",
      "폴더 선택",
    ],
    defaultAddress: [
      "默认地址",
      "預設位址",
      "預設位置",
      "Default location",
      "既定の場所",
      "기본 위치",
    ],
    change: ["更换", "更換", "更換", "Change folder", "変更", "변경"],
    retry: [
      "恢复授权并重试",
      "恢復授權並重試",
      "恢復授權並重試",
      "Authorize and retry",
      "許可して再試行",
      "권한 허용 및 재시도",
    ],
    loading: [
      "正在读取文件夹设置…",
      "正在讀取資料夾設定…",
      "正在讀取資料夾設定…",
      "Loading folder settings…",
      "フォルダー設定を読み込み中…",
      "폴더 설정 불러오는 중…",
    ],
    available: ["可用", "可用", "可用", "Available", "利用可能", "사용 가능"],
    permission: [
      "需要授权，请点击“恢复授权并重试”",
      "需要授權，請點擊「恢復授權並重試」",
      "需要授權，請按「恢復授權並重試」",
      "Permission needed. Select Authorize and retry.",
      "アクセス許可が必要です。「許可して再試行」を押してください。",
      "권한이 필요합니다. 권한 허용 및 재시도를 선택하세요.",
    ],
    failed: [
      "文件夹写入失败，请检查目录后重试或更换文件夹",
      "資料夾寫入失敗，請檢查目錄後重試或更換資料夾",
      "資料夾寫入失敗，請檢查目錄後重試或更換資料夾",
      "Folder write failed. Check the folder and retry, or choose another folder.",
      "書き込みに失敗しました。フォルダーを確認して再試行するか、変更してください。",
      "폴더 쓰기에 실패했습니다. 폴더를 확인하고 재시도하거나 변경하세요.",
    ],
    busy: [
      "正在处理存档，请稍后重试",
      "正在處理存檔，請稍後重試",
      "正在處理存檔，請稍後重試",
      "Archive operation in progress. Try again shortly.",
      "保存処理中です。後でもう一度お試しください。",
      "보관 작업 중입니다. 잠시 후 다시 시도하세요.",
    ],
    saved: [
      "备份已保存到存档文件夹",
      "備份已儲存至存檔資料夾",
      "備份已儲存至存檔資料夾",
      "Backup saved to archive folder",
      "バックアップをフォルダーに保存しました",
      "보관 폴더에 백업을 저장했습니다",
    ],
  };
  const languages = ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"];
  return (key) => {
    if (
      [
        "busy",
        "loading",
        "unsupported",
        "storageFailed",
        "permission",
        "failed",
      ].includes(key)
    )
      return WorkTimeApp.ui.runtimeFolderText(key, {
        name: WorkTimeApp.services.runtimeFolder.state.detail,
      });
    if (key === "defaultAddress")
      return WorkTimeApp.ui.runtimeFolderText("label");
    if (key === "label") return WorkTimeApp.ui.runtimeFolderText("folderLabel");
    if (["needsInitialization", "initializing", "conflict"].includes(key))
      return WorkTimeApp.ui.runtimeFolderText(key, {
        name:
          WorkTimeApp.services.runtimeFolder.state.detail ||
          WorkTimeApp.services.runtimeFolder.state.progress,
      });
    const value =
      rows[key]?.[Math.max(0, languages.indexOf(WorkTimeApp.i18n.language))] ||
      key;
    return value
      .replaceAll("存档文件夹", "运行文件夹")
      .replaceAll("存檔資料夾", "執行資料夾")
      .replaceAll("archive folder", "workspace folder");
  };
})();
(() => {
  function mount() {
    const host = document.querySelector(".auto-backup-settings");
    if (!host || document.documentElement.dataset.appState === "failed") return;
    const service = WorkTimeApp.services.autoBackupFolder;
    const t = WorkTimeApp.ui.autoBackupFolderText;
    const field = document.createElement("div");
    field.className = "field auto-backup-folder";
    field.id = "autoBackupFolder";
    const label = document.createElement("label");
    label.id = "autoBackupFolderLabel";
    // The group is named via aria-labelledby; associating this heading with
    // the button also forwards label hover outside the button's bounds.
    const control = document.createElement("div");
    control.className = "auto-backup-folder-control";
    control.setAttribute("role", "group");
    control.setAttribute("aria-labelledby", label.id);
    const status = document.createElement("p");
    status.id = "autoBackupFolderStatus";
    status.className = "help";
    status.setAttribute("role", "status");
    const buttons = document.createElement("div");
    buttons.className = "row";
    const controls = {};
    let pending = false,
      notice = "";
    async function act(action) {
      if (pending) return;
      pending = true;
      notice = "";
      try {
        // Invoke first: directory picker and permission prompt require this gesture.
        const result = action();
        render();
        if (await result)
          document.dispatchEvent(new Event("worktime:autobackupretry"));
      } catch (error) {
        notice = error.folderCode || "failed";
      } finally {
        pending = false;
        render();
      }
    }
    for (const [key, action] of Object.entries({
      choose: () => {
        if (!service.state.name) return service.choose();
        return WorkTimeApp.services.assets
          .script("assets/js/ui/runtime-folder-change.js")
          .then(() => WorkTimeApp.ui.showRuntimeFolderChange());
      },
      retry: service.authorize,
    })) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "autoBackupFolder" + key[0].toUpperCase() + key.slice(1);
      button.className =
        key === "retry" ? "ui-button" : "auto-backup-folder-action";
      button.setAttribute("aria-describedby", status.id);
      button.addEventListener("click", () => {
        if (pending || service.state.busy) return;
        void act(action);
      });
      controls[key] = button;
      if (key === "retry") buttons.append(button);
    }
    control.append(controls.choose);
    const chosenName = document.createElement("span");
    chosenName.className = "auto-backup-folder-name";
    controls.choose.append(chosenName);
    function render() {
      const state = service.state;
      label.textContent = t("label");
      const message =
        notice ||
        (state.busy && state.status !== "initializing"
          ? "busy"
          : !state.supported
            ? "unsupported"
            : state.status);
      status.textContent = message === "available" ? "" : t(message);
      status.hidden = !status.textContent;
      chosenName.textContent = state.name || t("defaultAddress");
      controls.choose.title = state.name
        ? t("change") + " · " + state.name
        : t("choose");
      controls.choose.setAttribute(
        "aria-label",
        state.name ? t("change") + " · " + state.name : t("choose"),
      );
      controls.retry.textContent = t("retry");
      controls.choose.disabled =
        !state.supported || state.busy || pending || state.status === "loading";
      controls.retry.hidden =
        !state.name || !state.supported || state.status === "available";
      controls.retry.disabled = state.busy || pending;
      buttons.hidden = controls.retry.hidden;
    }
    field.append(label, control, status, buttons);
    host.prepend(field);
    const unsubscribe = service.subscribe(render);
    document.addEventListener("worktime:languagechange", render);
    window.addEventListener(
      "pagehide",
      () => {
        unsubscribe();
        document.removeEventListener("worktime:languagechange", render);
      },
      { once: true },
    );
    render();
    void service.initialize();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();

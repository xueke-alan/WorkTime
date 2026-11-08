"use strict";
/** Folder settings copy stays available in all offline languages. */
WorkTimeApp.ui.autoBackupFolderText = (() => {
  const rows = {
    confirmReset: [
      "确定恢复默认文件夹？后续备份将改用浏览器下载，已有备份文件不会删除。下次打开页面时会重新提示选择存档文件夹。",
      "確定恢復預設資料夾？之後備份將改用瀏覽器下載，現有備份檔案不會刪除。下次開啟頁面時會再次提示選擇存檔資料夾。",
      "確定恢復預設資料夾？之後備份將改用瀏覽器下載，現有備份檔案不會刪除。下次開啟頁面時會再次提示選擇存檔資料夾。",
      "Restore the default folder? Future backups will use browser downloads. Existing backup files will be kept. You will be reminded to choose an archive folder on your next visit.",
      "既定の保存先に戻しますか？今後のバックアップはブラウザーでダウンロードされます。既存のファイルは削除されません。次回ページを開くと保存先の選択が再び表示されます。",
      "기본 폴더로 복원할까요? 이후 백업은 브라우저로 다운로드됩니다. 기존 백업 파일은 삭제되지 않습니다. 다음에 페이지를 열면 보관 폴더 선택 안내가 다시 표시됩니다.",
    ],
    label: [
      "存档文件夹",
      "存檔資料夾",
      "存檔資料夾",
      "Archive folder",
      "保存先フォルダー",
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
    reset: [
      "使用浏览器下载",
      "使用瀏覽器下載",
      "使用瀏覽器下載",
      "Use browser downloads",
      "ブラウザーでダウンロード",
      "브라우저 다운로드 사용",
    ],
    download: [
      "当前使用浏览器下载",
      "目前使用瀏覽器下載",
      "目前使用瀏覽器下載",
      "Using browser downloads",
      "ブラウザーでダウンロード中",
      "브라우저 다운로드 사용 중",
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
    storageFailed: [
      "文件夹设置读写失败，请重新选择文件夹或使用浏览器下载",
      "資料夾設定讀寫失敗，請重新選擇資料夾或使用瀏覽器下載",
      "資料夾設定讀寫失敗，請重新選擇資料夾或使用瀏覽器下載",
      "Folder settings could not be saved or loaded. Choose the folder again or use browser downloads.",
      "フォルダー設定を保存または読み込めません。再選択するか、ブラウザーでダウンロードしてください。",
      "폴더 설정을 저장하거나 불러오지 못했습니다. 다시 선택하거나 브라우저 다운로드를 사용하세요.",
    ],
    unsupported: [
      "当前环境不支持选择文件夹；可使用浏览器下载",
      "目前環境不支援選擇資料夾；可使用瀏覽器下載",
      "目前環境不支援選擇資料夾；可使用瀏覽器下載",
      "Folder selection is unavailable here. Browser downloads are available.",
      "この環境ではフォルダーを選択できません。ブラウザーでダウンロードできます。",
      "이 환경에서는 폴더를 선택할 수 없습니다. 브라우저 다운로드를 사용할 수 있습니다.",
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
  return (key) =>
    rows[key]?.[Math.max(0, languages.indexOf(WorkTimeApp.i18n.language))] ||
    key;
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
    label.htmlFor = "autoBackupFolderChoose";
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
      choose: service.choose,
      retry: service.authorize,
      reset: service.reset,
    })) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "autoBackupFolder" + key[0].toUpperCase() + key.slice(1);
      button.className =
        key === "retry" ? "ui-button" : "auto-backup-folder-action";
      button.setAttribute("aria-describedby", status.id);
      button.addEventListener("click", () => {
        if (pending || service.state.busy) return;
        if (key === "reset" && !window.confirm(t("confirmReset"))) return;
        void act(action);
      });
      controls[key] = button;
      if (key === "retry") buttons.append(button);
    }
    const resetIcon = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    resetIcon.setAttribute("class", "ui-icon");
    resetIcon.setAttribute("aria-hidden", "true");
    const resetUse = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "use",
    );
    resetUse.setAttribute("href", "#ms-restart-alt");
    resetIcon.append(resetUse);
    controls.reset.append(resetIcon);
    control.append(controls.choose, controls.reset);
    function render() {
      const state = service.state;
      label.textContent = t("label");
      const message =
        notice ||
        (state.status === "download" && !state.supported
          ? "unsupported"
          : state.status);
      status.textContent = t(message);
      status.hidden =
        !notice &&
        (state.status === "available" ||
          (state.status === "download" && state.supported));
      controls.choose.textContent = state.name || t("defaultAddress");
      controls.choose.title = state.name
        ? t("change") + " · " + state.name
        : t("choose");
      controls.choose.setAttribute(
        "aria-label",
        state.name ? t("change") + " · " + state.name : t("choose"),
      );
      controls.retry.textContent = t("retry");
      controls.reset.title = t("reset");
      controls.reset.setAttribute("aria-label", t("reset"));
      controls.choose.disabled =
        !state.supported || state.busy || pending || state.status === "loading";
      controls.retry.hidden =
        !state.name || !state.supported || state.status === "available";
      controls.retry.disabled = state.busy || pending;
      controls.reset.hidden = !state.name && state.status !== "storageFailed";
      controls.reset.disabled = state.busy || pending;
      buttons.hidden = controls.retry.hidden;
    }
    field.append(label, control, status, buttons);
    host.append(field);
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

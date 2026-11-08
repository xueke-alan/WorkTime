"use strict";
/** First-run setup for a new browser profile. */
WorkTimeApp.ui.onboarding = (() => {
  const KEY = "worktime.onboarding.v1";
  const copy = {
    title: ["欢迎使用 HWorkTime", "Welcome to HWorkTime"],
    folderTitle: ["先选择存档文件夹", "Choose an archive folder"],
    folderText: [
      "选择一个文件夹后，网站可以自动把备份保存到这里。文件只保存在你的设备上。",
      "Choose a folder so backups can be saved there automatically. Files stay on your device.",
    ],
    folderUnsupported: [
      "当前浏览器不支持直接选择文件夹，可以稍后在支持的浏览器中设置。",
      "This browser cannot choose a folder directly. You can set one later in a supported browser.",
    ],
    choose: ["选择文件夹", "Choose folder"],
    skip: ["稍后设置", "Set up later"],
    installTitle: [
      "把 HWorkTime 安装为浏览器应用",
      "Install HWorkTime as an app",
    ],
    installText: [
      "安装后可以从桌面或应用列表快速打开，并获得更适合独立窗口的体验。",
      "Install it for quick access from your desktop or app list and a focused standalone window.",
    ],
    install: ["安装应用", "Install app"],
    manual: [
      "如果浏览器支持，请打开地址栏或浏览器菜单中的“安装应用”或“添加到主屏幕”。",
      "If supported, use “Install app” or “Add to home screen” from the address bar or browser menu.",
    ],
    finish: ["开始使用", "Start using HWorkTime"],
    installed: [
      "应用已安装，可以从应用列表打开。",
      "The app is installed. Open it from your app list.",
    ],
    error: [
      "文件夹选择失败，请重试或稍后设置。",
      "Folder selection failed. Try again or set it up later.",
    ],
  };
  const languages = ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"];
  const translations = {
    title: [
      "歡迎使用 HWorkTime",
      "HWorkTime へようこそ",
      "HWorkTime에 오신 것을 환영합니다",
    ],
    folderTitle: [
      "先選擇存檔資料夾",
      "保存先フォルダーを選択",
      "보관 폴더 선택",
    ],
    folderText: [
      "選擇資料夾後可自動儲存備份，檔案只保存在你的裝置上。",
      "バックアップの保存先を選択してください。ファイルは端末内に保存されます。",
      "백업을 자동 저장할 폴더를 선택하세요. 파일은 기기에만 저장됩니다.",
    ],
    folderUnsupported: [
      "此瀏覽器不支援選擇資料夾，可稍後設定。",
      "このブラウザーではフォルダーを選択できません。後で設定できます。",
      "이 브라우저는 폴더 선택을 지원하지 않습니다. 나중에 설정할 수 있습니다.",
    ],
    choose: ["選擇資料夾", "フォルダーを選択", "폴더 선택"],
    skip: ["稍後設定", "後で設定", "나중에 설정"],
    installTitle: [
      "將 HWorkTime 安裝為應用程式",
      "HWorkTime をアプリとしてインストール",
      "HWorkTime을 앱으로 설치",
    ],
    installText: [
      "安裝後可從桌面或應用程式清單快速開啟。",
      "インストールするとデスクトップから専用ウィンドウで開けます。",
      "설치하면 바탕 화면이나 앱 목록에서 전용 창으로 열 수 있습니다.",
    ],
    install: ["安裝應用程式", "インストール", "앱 설치"],
    manual: [
      "請使用瀏覽器選單中的「安裝應用程式」或「加入主畫面」。本機檔案請改用網站網址安裝。",
      "ブラウザーの「アプリをインストール」または「ホーム画面に追加」を使用してください。ローカルファイルの場合は公開サイトを開いてください。",
      "브라우저 메뉴의 앱 설치 또는 홈 화면에 추가를 사용하세요. 로컬 파일은 게시된 웹사이트를 열어 설치하세요.",
    ],
    finish: ["開始使用", "使い始める", "시작하기"],
    installed: [
      "應用程式已安裝，可從應用程式清單開啟。",
      "インストール済みです。アプリ一覧から開けます。",
      "설치되었습니다. 앱 목록에서 열 수 있습니다.",
    ],
    error: [
      "資料夾選擇失敗，請重試或稍後設定。",
      "フォルダーを選択できません。再試行するか後で設定してください。",
      "폴더 선택에 실패했습니다. 재시도하거나 나중에 설정하세요.",
    ],
  };
  const t = (key) => {
    const values = copy[key] || [key, key];
    const index = languages.indexOf(WorkTimeApp.i18n.language);
    return index < 2
      ? values[Math.max(0, index)]
      : translations[key]?.[index < 4 ? 0 : index - 3] || values[0];
  };
  const read = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const complete = () => {
    try {
      localStorage.setItem(KEY, "done");
    } catch {}
  };
  async function mount() {
    if (read() === "dismissed") return;
    await WorkTimeApp.services.autoBackupFolder.initialize();
    if (read() === "dismissed") return;
    const folderState = WorkTimeApp.services.autoBackupFolder.state;
    if (
      read() === "done" &&
      folderState.supported &&
      folderState.status === "download"
    ) {
      try {
        localStorage.setItem(KEY, "pending");
      } catch {}
    }
    if (document.getElementById("onboardingDialog") || read() === "done")
      return;
    if (
      document.documentElement.dataset.firstRun !== "true" &&
      !["pending", "pending-install"].includes(read())
    ) {
      complete();
      return;
    }
    const installOnly = read() === "pending-install" && !!folderState.name;
    try {
      localStorage.setItem(KEY, "pending");
    } catch {}
    const dialog = document.createElement("dialog");
    dialog.id = "onboardingDialog";
    dialog.className = "onboarding-dialog";
    dialog.setAttribute("aria-labelledby", "onboardingTitle");
    dialog.innerHTML = `
      <div class="dialog-head"><h2 id="onboardingTitle"></h2><span class="onboarding-step" aria-live="polite"></span></div>
      <div class="dialog-body">
        <section data-onboarding-step="folder">
          <h3 data-onboarding-title></h3><p data-onboarding-text></p>
          <p class="help" data-onboarding-support></p><p class="warnings" data-onboarding-error role="alert"></p>
        </section>
        <section data-onboarding-step="install" hidden>
          <h3 data-onboarding-title></h3><p data-onboarding-text></p><p class="help" data-onboarding-manual></p>
        </section>
        <label class="onboarding-dismiss"><input type="checkbox" id="onboardingDontRemind"><span></span></label>
      </div>
      <div class="dialog-foot">
        <button class="ui-button subtle" type="button" data-onboarding-skip></button>
        <button class="ui-button primary" type="button" data-onboarding-next></button>
      </div>`;
    document.body.append(dialog);
    const service = WorkTimeApp.services.autoBackupFolder;
    const pwa = WorkTimeApp.services.pwaInstall;
    const folder = dialog.querySelector('[data-onboarding-step="folder"]');
    const install = dialog.querySelector('[data-onboarding-step="install"]');
    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "ui-button primary onboarding-folder-button";
    folder.querySelector("[data-onboarding-text]").after(choose);
    const error = folder.querySelector("[data-onboarding-error]");
    const next = dialog.querySelector("[data-onboarding-next]");
    const skip = dialog.querySelector("[data-onboarding-skip]");
    const dontRemind = dialog.querySelector("#onboardingDontRemind");
    let step = installOnly ? "install" : "folder";
    folder.hidden = installOnly;
    install.hidden = !installOnly;
    let pending = false;
    let remindNextVisit = false;
    function render() {
      const dismissLabels = [
        "不再提示",
        "Don't show again",
        "不再提示",
        "不再提示",
        "今後表示しない",
        "다시 표시하지 않기",
      ];
      dialog.querySelector(".onboarding-dismiss span").textContent =
        dismissLabels[
          Math.max(0, languages.indexOf(WorkTimeApp.i18n.language))
        ];
      dontRemind.disabled = pending;
      const state = service.state;
      const installState = pwa.state;
      dialog.querySelector("#onboardingTitle").textContent = t("title");
      dialog.querySelector(".onboarding-step").textContent =
        step === "folder" ? "1 / 2" : "2 / 2";
      folder.querySelector("[data-onboarding-title]").textContent =
        t("folderTitle");
      folder.querySelector("[data-onboarding-text]").textContent =
        t("folderText");
      folder.querySelector("[data-onboarding-support]").textContent =
        state.supported ? "" : t("folderUnsupported");
      choose.textContent = state.name || t("choose");
      choose.disabled = pending || !state.supported;
      choose.hidden = !state.supported;
      install.querySelector("[data-onboarding-title]").textContent =
        t("installTitle");
      install.querySelector("[data-onboarding-text]").textContent = t(
        installState.installed ? "installed" : "installText",
      );
      install.querySelector("[data-onboarding-manual]").textContent =
        installState.installable || installState.installed ? "" : t("manual");
      next.textContent =
        step === "install" && installState.installable
          ? t("install")
          : step === "folder"
            ? t("skip")
            : t("finish");
      next.disabled = pending;
      skip.textContent = t("finish");
      skip.hidden = step === "folder" || !installState.installable;
    }
    async function advance() {
      if (step === "folder") {
        step = "install";
        folder.hidden = true;
        install.hidden = false;
        render();
        return;
      }
      if (dontRemind.checked) {
        try {
          localStorage.setItem(KEY, "dismissed");
        } catch {}
      } else if (!remindNextVisit) complete();
      dialog.close();
      dialog.remove();
    }
    choose.addEventListener("click", async () => {
      if (pending) return;
      pending = true;
      error.textContent = "";
      render();
      try {
        if (await service.choose()) {
          if (service.state.status !== "available") throw Error("permission");
          document.dispatchEvent(new Event("worktime:autobackupretry"));
          await advance();
        }
      } catch {
        error.textContent = t("error");
      } finally {
        pending = false;
        render();
      }
    });
    next.addEventListener("click", async () => {
      if (step === "folder") remindNextVisit = true;
      if (step === "folder" || !pwa.state.installable) return advance();
      pending = true;
      render();
      await pwa.prompt();
      pending = false;
      render();
    });
    skip.addEventListener("click", advance);
    const unsubscribeFolder = service.subscribe(render);
    const unsubscribePwa = pwa.subscribe(render);
    document.addEventListener("worktime:languagechange", render);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!pending) {
        remindNextVisit = true;
        void advance();
      }
    });
    dialog.addEventListener(
      "close",
      () => {
        unsubscribeFolder();
        unsubscribePwa();
        document.removeEventListener("worktime:languagechange", render);
        dialog.remove();
      },
      { once: true },
    );
    render();
    dialog.showModal();
  }
  document.addEventListener(
    "worktime:ready",
    () => {
      WorkTimeApp.services.pwaInstall.initialize();
      mount();
    },
    { once: true },
  );
  document.addEventListener("worktime:folderreset", () => {
    if (read() === "dismissed") return;
    try {
      localStorage.setItem(KEY, "pending");
    } catch {}
  });
  document.addEventListener("worktime:installavailable", () => {
    if (read() !== "done") return;
    try {
      localStorage.setItem(KEY, "pending-install");
    } catch {}
    if (document.documentElement.dataset.appState === "ready") void mount();
  });
  return { mount };
})();

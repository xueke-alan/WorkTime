"use strict";
/** First-run setup for a new browser profile. */
WorkTimeApp.ui.onboarding = (() => {
  const KEY = "worktime.onboarding.v1";
  const INSTALL_REMINDER_KEY = "worktime.installReminder.dismissed.v1";
  let installReminderDismissed = false;
  let closed = false;
  window.addEventListener(
    "pagehide",
    () => {
      closed = true;
    },
    { once: true },
  );
  const skipInstallReminder = () => {
    try {
      return localStorage.getItem(INSTALL_REMINDER_KEY) === "true";
    } catch {
      return installReminderDismissed;
    }
  };
  const setSkipInstallReminder = (value) => {
    installReminderDismissed = value;
    try {
      if (value) localStorage.setItem(INSTALL_REMINDER_KEY, "true");
      else localStorage.removeItem(INSTALL_REMINDER_KEY);
    } catch {}
  };
  const copy = {
    title: ["欢迎使用 HWorkTime", "Welcome to HWorkTime"],
    folderTitle: [
      "选择一个运行文件夹以保存数据",
      "Choose a workspace folder to save your data",
    ],
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
      "浏览器暂未提供安装弹窗，可在浏览器菜单中选择“安装应用”或“添加到主屏幕”。本地文件请先打开网站在线地址再安装。",
      "The browser has not provided an installation prompt. Use Install app or Add to home screen in its menu. For local files, open the online website first.",
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
      "選擇一個執行資料夾以儲存資料",
      "データを保存する作業フォルダーを選択",
      "데이터를 저장할 작업 폴더를 선택하세요",
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
  const timelineCopy = {
    folderSelected: [
      "已选择：",
      "Selected: ",
      "已選擇：",
      "已選擇：",
      "選択済み：",
      "선택됨: ",
    ],
    dontRemindInstall: [
      "不再提示",
      "Don't remind me again",
      "不再提示",
      "不再提示",
      "今後表示しない",
      "다시 알리지 않기",
    ],
    folderRequired: [
      "请选择运行文件夹",
      "Please choose a workspace folder",
      "請選擇執行資料夾",
      "請選擇執行資料夾",
      "作業フォルダーを選択してください",
      "작업 폴더를 선택하세요",
    ],
    backup: [
      "自动备份",
      "Automatic backups",
      "自動備份",
      "自動備份",
      "自動バックアップ",
      "자동 백업",
    ],
    launch: [
      "推荐创建快捷启动",
      "Recommended: create quick access",
      "建議建立快速啟動",
      "建議建立快速啟動",
      "クイックアクセスの作成を推奨",
      "빠른 실행 만들기 권장",
    ],
    optional: ["可选", "Optional", "可選", "可選", "任意", "선택 사항"],
    current: [
      "当前步骤",
      "Current step",
      "目前步驟",
      "目前步驟",
      "現在のステップ",
      "현재 단계",
    ],
    completed: ["已完成", "Complete", "已完成", "已完成", "完了", "완료"],
    later: [
      "稍后设置",
      "Set up later",
      "稍後設定",
      "稍後設定",
      "後で設定",
      "나중에 설정",
    ],
    back: ["上一步", "Back", "上一步", "上一步", "前へ", "이전"],
    busy: [
      "正在连接…",
      "Connecting…",
      "正在連接…",
      "正在連接…",
      "接続中…",
      "연결 중…",
    ],
  };
  const t = (key) => {
    if (timelineCopy[key])
      return timelineCopy[key][
        Math.max(0, languages.indexOf(WorkTimeApp.i18n.language))
      ];
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
    if (closed) return;
    await WorkTimeApp.services.autoBackupFolder.initialize();
    const folderState = WorkTimeApp.services.autoBackupFolder.state;
    if (closed || document.getElementById("onboardingDialog")) return;
    // Folder setup is mandatory. Installation reminders recur on each visit
    // until the user opts out or the browser reports an installed app.
    if (
      folderState.status === "available" &&
      (skipInstallReminder() || WorkTimeApp.services.pwaInstall.state.installed)
    ) {
      complete();
      return;
    }
    // Established profiles never need these styles. Base dialog styles remain
    // usable if an optional stylesheet fails, so folder setup stays available.
    await WorkTimeApp.services.assets
      .style("assets/css/onboarding.css")
      .catch(() => {});
    if (
      closed ||
      document.getElementById("onboardingDialog") ||
      ["failed", "initializing"].includes(
        document.documentElement.dataset.appState,
      )
    )
      return;
    if (
      WorkTimeApp.services.autoBackupFolder.state.status === "available" &&
      (skipInstallReminder() || WorkTimeApp.services.pwaInstall.state.installed)
    ) {
      complete();
      return;
    }
    try {
      localStorage.setItem(KEY, "pending");
    } catch {}
    const dialog = document.createElement("dialog");
    dialog.id = "onboardingDialog";
    dialog.className = "onboarding-dialog";
    dialog.setAttribute("aria-labelledby", "onboardingTitle");
    dialog.setAttribute("closedby", "none");
    dialog.innerHTML = `
      <div class="dialog-head"><div><span class="onboarding-brand">HWorkTime</span><h2 id="onboardingTitle" tabindex="-1"></h2></div></div>
      <div class="dialog-body">
        <ol class="onboarding-timeline">
        <li class="onboarding-item" data-stage="folder">
          <span class="onboarding-node" aria-hidden="true"><span class="onboarding-node-text">01</span><svg class="ui-icon onboarding-node-check" aria-hidden="true" hidden><use href="#ms-check"/></svg></span>
          <div class="onboarding-stage">
          <h3 class="onboarding-stage-heading" data-onboarding-heading="folder"><span data-stage-title></span><span class="onboarding-stage-status"></span></h3>
        <section id="onboardingFolder" data-onboarding-step="folder">
          <h3 data-onboarding-title></h3><p data-onboarding-text></p>
          <p class="help" data-onboarding-support></p><p class="warnings" data-onboarding-error role="alert"></p>
        </section>
          </div>
        </li>
        <li class="onboarding-item" data-stage="install">
          <span class="onboarding-node" aria-hidden="true"><span class="onboarding-node-text">02</span><svg class="ui-icon onboarding-node-check" aria-hidden="true" hidden><use href="#ms-check"/></svg></span>
          <div class="onboarding-stage">
          <h3 class="onboarding-stage-heading" data-onboarding-heading="install"><span data-stage-title></span><span class="onboarding-stage-status"></span></h3>
        <section id="onboardingInstall" data-onboarding-step="install">
          <div class="onboarding-install-head"><h3 data-onboarding-title></h3><label class="onboarding-install-dismiss"><input type="checkbox" data-onboarding-dismiss-install><span></span></label></div><p data-onboarding-text></p><button class="ui-button onboarding-install-button" type="button" data-onboarding-install></button><p class="help" data-onboarding-manual role="status"></p>
        </section>
          </div>
        </li>
        </ol>
      </div>
      <div class="dialog-foot">
        <p class="onboarding-folder-required" id="onboardingFolderRequired" role="status"></p>
        <div class="onboarding-actions">
        <button class="ui-button primary" type="button" data-onboarding-next></button>
        </div>
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
    const installButton = dialog.querySelector("[data-onboarding-install]");
    const dismissInstall = dialog.querySelector(
      "[data-onboarding-dismiss-install]",
    );
    dismissInstall.addEventListener("change", () => {
      setSkipInstallReminder(dismissInstall.checked);
    });
    let pending = false;
    const folderReady = () => service.state.status === "available";
    function render() {
      const state = service.state;
      const installState = pwa.state;
      dialog.querySelector("#onboardingTitle").textContent = t("title");
      dialog.setAttribute("aria-busy", String(pending));
      for (const item of dialog.querySelectorAll("[data-stage]")) {
        const active =
          item.dataset.stage ===
          (state.status === "available" ? "install" : "folder");
        const done =
          item.dataset.stage === "folder"
            ? state.status === "available"
            : installState.installed;
        item.dataset.state = done
          ? "complete"
          : active
            ? "current"
            : "upcoming";
        if (active) item.setAttribute("aria-current", "step");
        else item.removeAttribute("aria-current");
        item.querySelector("[data-stage-title]").textContent =
          item.dataset.stage === "folder"
            ? WorkTimeApp.ui.runtimeFolderText("label")
            : t("launch");
        item.querySelector(".onboarding-stage-status").textContent = t(
          done
            ? "completed"
            : active
              ? "current"
              : item.dataset.stage === "folder"
                ? "later"
                : "optional",
        );
        const node = item.querySelector(".onboarding-node-text");
        node.hidden = done;
        item
          .querySelector(".onboarding-node-check")
          .toggleAttribute("hidden", !done);
      }
      folder.querySelector("[data-onboarding-title]").textContent =
        t("folderTitle");
      folder.querySelector("[data-onboarding-text]").textContent =
        WorkTimeApp.ui.runtimeFolderText("description");
      folder.querySelector("[data-onboarding-support]").textContent =
        state.supported ? "" : WorkTimeApp.ui.runtimeFolderText("unsupported");
      choose.textContent = pending
        ? WorkTimeApp.ui.runtimeFolderText("initializing", {
            name: state.progress || state.name,
          })
        : state.name
          ? t("folderSelected") + state.name
          : t("choose");
      choose.classList.toggle("is-selected", !!state.name);
      choose.disabled = pending || !state.supported;
      choose.hidden = !state.supported;
      install.querySelector("[data-onboarding-title]").textContent =
        t("installTitle");
      install.querySelector("[data-onboarding-text]").textContent = t(
        installState.installed ? "installed" : "installText",
      );
      install.querySelector("[data-onboarding-manual]").textContent =
        installState.installable || installState.installed ? "" : t("manual");
      installButton.textContent = t(
        installState.installed ? "installed" : "install",
      );
      installButton.disabled = pending || installState.installed;
      dismissInstall.checked = skipInstallReminder();
      dialog.querySelector(".onboarding-install-dismiss span").textContent =
        t("dontRemindInstall");
      // Keep the entry visible even before the browser offers its native prompt.
      installButton.hidden = false;
      installButton.setAttribute("aria-busy", String(pending));
      next.textContent = t("finish");
      next.disabled = pending || !folderReady();
      const required = dialog.querySelector("#onboardingFolderRequired");
      required.textContent = t("folderRequired");
      required.hidden = folderReady();
      if (folderReady()) next.removeAttribute("aria-describedby");
      else next.setAttribute("aria-describedby", required.id);
    }
    function finish() {
      if (pending || !folderReady()) return;
      complete();
      dialog.close();
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
        }
      } catch (problem) {
        error.textContent = WorkTimeApp.ui.runtimeFolderText(
          problem.folderCode || "failed",
          { name: service.state.detail || problem.message },
        );
      } finally {
        pending = false;
        render();
        choose.focus({ preventScroll: true });
      }
    });
    installButton.addEventListener("click", async () => {
      if (pending || pwa.state.installed) return;
      if (!pwa.state.installable) {
        install.querySelector("[data-onboarding-manual]").textContent =
          t("manual");
        return;
      }
      pending = true;
      try {
        const result = pwa.prompt();
        render();
        await result;
      } finally {
        pending = false;
        render();
        if (!installButton.disabled)
          installButton.focus({ preventScroll: true });
      }
    });
    next.addEventListener("click", () => {
      finish();
    });
    const unsubscribeFolder = service.subscribe(render);
    const unsubscribePwa = pwa.subscribe(render);
    document.addEventListener("worktime:languagechange", render);
    // Only the explicit Start button completes setup, including after selection.
    // Keep cancel protection for browsers without closedby support.
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
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
    dialog.querySelector("#onboardingTitle").focus({ preventScroll: true });
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
    try {
      localStorage.setItem(KEY, "pending");
    } catch {}
    void mount();
  });
  document.addEventListener("worktime:installavailable", () => {
    if (skipInstallReminder() || read() !== "done") return;
    try {
      localStorage.setItem(KEY, "pending-install");
    } catch {}
    if (document.documentElement.dataset.appState === "ready") void mount();
  });
  return { mount };
})();

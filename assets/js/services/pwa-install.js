"use strict";
/** Browser installation capability; harmless on file:// and unsupported browsers. */
WorkTimeApp.services.pwaInstall = (() => {
  let deferred = null;
  let installed = false;
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  const standalone = () =>
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true;
  const canUse = () => !!deferred && !standalone() && !installed;
  function onBeforeInstall(event) {
    event.preventDefault();
    installed = false;
    deferred = event;
    notify();
    document.dispatchEvent(new Event("worktime:installavailable"));
  }
  function onInstalled() {
    installed = true;
    deferred = null;
    notify();
  }
  window.addEventListener("beforeinstallprompt", onBeforeInstall);
  window.addEventListener("appinstalled", onInstalled);
  function initialize() {
    if (standalone()) installed = true;
    if (
      /^https?:$/.test(location.protocol) &&
      window.isSecureContext &&
      "serviceWorker" in navigator
    )
      void navigator.serviceWorker
        .register("./service-worker.js")
        .catch(() => {});
    notify();
  }
  async function prompt() {
    if (!canUse()) return false;
    const event = deferred;
    deferred = null;
    notify();
    try {
      await event.prompt();
      const result = await event.userChoice;
      if (result.outcome === "accepted") installed = true;
      return result.outcome === "accepted";
    } catch {
      return false;
    } finally {
      notify();
    }
  }
  return {
    initialize,
    prompt,
    get state() {
      return {
        installable: canUse(),
        installed: installed || standalone(),
        supported: window.isSecureContext && "serviceWorker" in navigator,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();

/** Settings entry stays available even when the browser has no install API. */
(() => {
  const languages = ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"];
  const copy = {
    heading: ["安装", "安裝", "安裝", "App", "導入", "설치"],
    install: [
      "安装为 APP",
      "安裝為 APP",
      "安裝為 APP",
      "Install as app",
      "アプリとしてインストール",
      "앱으로 설치",
    ],
    installed: [
      "APP 已安装",
      "APP 已安裝",
      "APP 已安裝",
      "App installed",
      "インストール済み",
      "앱 설치됨",
    ],
    manual: [
      "当前浏览器暂未提供直接安装功能。你可以在浏览器菜单中选择“安装应用”或“添加到主屏幕”。如果正在打开本地文件，请先打开网站在线地址再安装。",
      "目前瀏覽器尚未提供直接安裝功能。你可以在瀏覽器選單中選擇「安裝應用程式」或「加入主畫面」。若正在開啟本機檔案，請先開啟網站網址再安裝。",
      "目前瀏覽器尚未提供直接安裝功能。你可以在瀏覽器選單中選擇「安裝應用程式」或「加入主畫面」。若正在開啟本機檔案，請先開啟網站網址再安裝。",
      "Direct installation is not currently available. Use Install app or Add to home screen in your browser menu. If you opened a local file, open the online website first.",
      "現在、直接インストールは利用できません。ブラウザーのメニューで「アプリをインストール」または「ホーム画面に追加」を選択してください。ローカルファイルの場合は先に公開サイトを開いてください。",
      "현재 직접 설치를 사용할 수 없습니다. 브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 선택하세요. 로컬 파일을 열었다면 온라인 웹사이트를 먼저 여세요.",
    ],
  };
  const t = (key) =>
    copy[key][Math.max(0, languages.indexOf(WorkTimeApp.i18n.language))];
  document.addEventListener(
    "worktime:ready",
    () => {
      const host = document.querySelector(".auto-backup-settings");
      if (!host) return;
      const service = WorkTimeApp.services.pwaInstall;
      const heading = document.createElement("label");
      heading.id = "appInstallLabel";
      heading.className = "label";
      heading.htmlFor = "appInstallButton";
      const button = document.createElement("button");
      button.id = "appInstallButton";
      button.type = "button";
      button.className = "ui-button icon-only";
      const icon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      icon.setAttribute("class", "ui-icon");
      icon.setAttribute("aria-hidden", "true");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", "#ms-install-desktop");
      icon.append(use);
      button.append(icon);
      host.append(heading, button);
      let pending = false;
      function render() {
        heading.textContent = t("heading");
        const label = t(service.state.installed ? "installed" : "install");
        button.title = label;
        button.setAttribute("aria-label", label);
        button.disabled = pending || service.state.installed;
      }
      button.addEventListener("click", async () => {
        if (pending || service.state.installed) return;
        if (!service.state.installable) {
          window.alert(t("manual"));
          return;
        }
        pending = true;
        try {
          // Invoke synchronously from the click to retain browser user activation.
          const result = service.prompt();
          render();
          await result;
        } finally {
          pending = false;
          render();
        }
      });
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
    },
    { once: true },
  );
})();

"use strict";
WorkTimeApp.services.clipboard = (() => {
  async function readPermission(navigator) {
    if (!navigator.clipboard?.readText || !navigator.permissions?.query)
      return null;
    try {
      return (await navigator.permissions.query({ name: "clipboard-read" }))
        .state;
    } catch {
      return null;
    }
  }
  function create(getClipboard) {
    return {
      async readText() {
        const source = getClipboard();
        if (!source?.readText) throw Error("当前浏览器不支持读取剪贴板");
        return source.readText();
      },
      async writeText(text) {
        const source = getClipboard();
        if (!source?.writeText) throw Error("当前浏览器不支持写入剪贴板");
        return source.writeText(text);
      },
    };
  }
  return { create, readPermission };
})();

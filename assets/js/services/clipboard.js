"use strict";
WorkTimeApp.services.clipboard = (() => {
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
  return { create };
})();

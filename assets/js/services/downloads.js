"use strict";
const WorkDownloads = (() => {
  function create({
    document,
    URL,
    Blob,
    schedule = setTimeout,
    cancel = clearTimeout,
  }) {
    const pending = new Map();
    function download(name, content, type) {
      const url = URL.createObjectURL(new Blob([content], { type }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      try {
        link.click();
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
      pending.set(
        url,
        schedule(() => {
          URL.revokeObjectURL(url);
          pending.delete(url);
        }, 1000),
      );
    }
    function dispose() {
      for (const [url, timer] of pending) {
        cancel(timer);
        URL.revokeObjectURL(url);
      }
      pending.clear();
    }
    return { download, dispose };
  }
  return { create };
})();

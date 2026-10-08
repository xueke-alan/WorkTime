"use strict";
const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const realm = vm.createContext({});
vm.runInContext(
  fs.readFileSync("assets/js/namespace.js", "utf8") +
    fs.readFileSync("assets/js/ui/storage-status.js", "utf8") +
    ";globalThis.create=WorkTimeApp.ui.createStorageStatus",
  realm,
);
const nodes = Object.fromEntries(
  ["storageUsage", "storageNotice", "storageNoticeText", "retryStorage"].map(
    (id) => [
      id,
      {
        textContent: "",
        classList: {
          toggle(name, value) {
            this[name] = value;
          },
        },
      },
    ],
  ),
);
const listeners = new Set(),
  window = {
    addEventListener(type, listener) {
      assert.equal(type, "storage");
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.delete(listener);
    },
  };
let value = null,
  unavailable = false,
  reads = 0;
const view = realm.create({
  element: (id) => nodes[id],
  key: "key",
  window,
  getStorage() {
    if (unavailable) throw Error("blocked");
    return {
      getItem(key) {
        assert.equal(key, "key");
        reads++;
        return value;
      },
    };
  },
});
const fire = (key) => {
  for (const listener of listeners) listener({ key });
};
for (let i = 0; i < 3; i++) {
  value = null;
  view.mount();
  view.mount();
  assert.equal(listeners.size, 1);
  assert.equal(nodes.storageUsage.textContent, "当前占用：0 B");
  value = "abc";
  fire("other");
  assert.equal(nodes.storageUsage.textContent, "当前占用：0 B");
  fire("key");
  assert.equal(nodes.storageUsage.textContent, "当前占用：12 B");
  value = "x".repeat(512);
  fire(null);
  assert.equal(nodes.storageUsage.textContent, "当前占用：1.01 KB");
  view.commit({ persisted: false, error: Error("quota") }, true);
  assert.equal(nodes.storageNotice.classList.hidden, false);
  assert.match(nodes.storageNoticeText.textContent, /quota/);
  view.commit({ persisted: true }, false);
  assert.equal(nodes.storageNotice.classList.hidden, true);
  view.accessFailed({ code: "LOCK_BUSY", message: "busy" });
  assert.match(nodes.storageNoticeText.textContent, /后台/);
  view.accessFailed({ code: "UNSUPPORTED", message: "blocked" });
  assert.match(nodes.storageNoticeText.textContent, /当前修改仍保留/);
  view.recoveryFailed(Error("invalid"));
  assert.match(nodes.storageNoticeText.textContent, /重新检查失败：invalid/);
  unavailable = true;
  view.commit({ persisted: true }, false);
  assert.equal(nodes.storageUsage.textContent, "当前占用：无法读取");
  unavailable = false;
  view.dispose();
  view.dispose();
  const before = reads;
  fire("key");
  assert.equal(reads, before);
  assert.equal(listeners.size, 0);
}
view.mount({ readError: Error("bad data"), accessError: Error("busy") });
assert.match(
  nodes.storageNoticeText.textContent,
  /浏览器数据无法读取：bad data/,
);
view.dispose();
view.mount({ accessError: Error("busy") });
assert.equal(nodes.storageNoticeText.textContent, "当前页面无法保存：busy。");
view.dispose();
let issue = "corrupt";
view.mount();
view.bindRetry({
  available: true,
  getLoadIssue: () => issue,
  retry: async () => {},
});
assert.equal(nodes.retryStorage.hidden, true);
issue = null;
view.updateRecovery();
assert.equal(
  nodes.retryStorage.hidden,
  false,
  "Recovery updates the existing retry button",
);
issue = "unsupported";
view.updateRecovery();
assert.equal(nodes.retryStorage.hidden, true);
issue = "unavailable";
view.updateRecovery();
assert.equal(nodes.retryStorage.hidden, false);
view.dispose();
assert.equal(nodes.retryStorage.onclick, null);
console.log(
  "Storage status passed: usage units, initial failures, stable-code recovery text and three mount/dispose rounds without writes or retained listeners.",
);

"use strict";
/** Real OPFS workspace, with only the interactive directory picker simulated. */
function installRuntimeFixture() {
  window.showDirectoryPicker = async () =>
    (await navigator.storage.getDirectory()).getDirectoryHandle(
      "runtime-fixture",
      { create: true },
    );
  FileSystemDirectoryHandle.prototype.queryPermission = async () => "granted";
  FileSystemDirectoryHandle.prototype.requestPermission = async () => "granted";
  localStorage.setItem("worktime.onboarding.v1", "dismissed");
  document.addEventListener(
    "worktime:ready",
    () => {
      void WorkTimeApp.services.runtimeFolder.initialize().then(() => {
        if (WorkTimeApp.services.runtimeFolder.state.status !== "available")
          return WorkTimeApp.services.runtimeFolder.choose();
      });
    },
    { once: true },
  );
}
async function runtimeServer(root) {
  const fs = require("node:fs"),
    path = require("node:path"),
    http = require("node:http");
  const server = http.createServer((req, res) => {
    const file = path.resolve(
      root,
      "." + new URL(req.url, "http://local").pathname,
    );
    if (!file.startsWith(path.resolve(root) + path.sep))
      return res.writeHead(403).end();
    fs.readFile(file, (error, data) => {
      if (error) return res.writeHead(404).end();
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "application/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/index.html`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
/** Exercise the dormant reader bundle without changing the product placeholder. */
async function enableReaderRuntime(page) {
  const fs = require("node:fs"),
    path = require("node:path");
  const loader = fs
    .readFileSync(path.join(__dirname, "../assets/js/music.js"), "utf8")
    .replaceAll("music", "reader");
  // This also works with bundled releases and service-worker reloads.
  await page.addInitScript({
    content:
      'document.addEventListener("worktime:ready", () => {\n' +
      loader +
      '\ndocument.querySelector(".reader-placeholder")?.remove();\n}, {once:true});',
  });
}
module.exports = { installRuntimeFixture, runtimeServer, enableReaderRuntime };

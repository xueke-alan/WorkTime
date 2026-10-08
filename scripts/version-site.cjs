"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { version: siteVersion } = require("../package.json");
function versionHtml(html, root, { entryPath = "index.html" } = {}) {
  if (entryPath === "index.html") {
    html = html.replace(
      /(<span id="siteVersion">)[^<]*(<\/span>)/,
      (_, open, close) => open + "v" + siteVersion + close,
    );
  }
  return html.replace(
    /\b(src|href)="([^"?#]+)(?:\?[^"#]*)?(#[^"]*)?"/g,
    (original, attribute, asset, fragment = "") => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(asset)) return original;
      if (!/^(?:\.\.\/)*assets\//.test(asset) && !/\.(?:js|css)$/.test(asset))
        return original;
      const file = path.resolve(root, path.dirname(entryPath), asset);
      if (!file.startsWith(path.resolve(root) + path.sep))
        throw Error("Asset escapes site directory");
      const version = crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex")
        .slice(0, 16);
      return attribute + '="' + asset + "?v=" + version + fragment + '"';
    },
  );
}
function versionSite(root) {
  // Resolve every dependency before writing either page; a bad conversion page
  // must fail the build rather than leave apparently complete versioned output.
  const pages = ["index.html", "tools/convert-backup.html"].map((entryPath) => {
    const file = path.join(root, entryPath);
    return [
      file,
      versionHtml(fs.readFileSync(file, "utf8"), root, { entryPath }),
    ];
  });
  for (const [file, html] of pages) fs.writeFileSync(file, html);
}
if (require.main === module) {
  const root = path.resolve(process.argv[2] || "_site");
  versionSite(root);
  console.log(
    "Versioned application and conversion page dependencies by content hash.",
  );
}
module.exports = { versionHtml, versionSite };

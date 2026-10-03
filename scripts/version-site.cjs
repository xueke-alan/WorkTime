"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
function versionHtml(html, root) {
  return html.replace(
    /\b(src|href)="(assets\/[^"?#]+)(?:\?[^"#]*)?"/g,
    (_, attribute, asset) => {
      const file = path.resolve(root, asset);
      if (!file.startsWith(path.resolve(root) + path.sep))
        throw Error("Asset escapes site directory");
      const version = crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex")
        .slice(0, 16);
      return attribute + '="' + asset + "?v=" + version + '"';
    },
  );
}
if (require.main === module) {
  const root = path.resolve(process.argv[2] || "_site");
  const file = path.join(root, "index.html");
  fs.writeFileSync(file, versionHtml(fs.readFileSync(file, "utf8"), root));
  console.log("Versioned site assets by content hash.");
}
module.exports = { versionHtml };

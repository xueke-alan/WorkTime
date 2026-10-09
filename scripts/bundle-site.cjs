"use strict";
// Bundle only the published copy; index.html remains usable directly offline.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
function bundleSite(root) {
  const entry = path.join(root, "index.html");
  let html = fs.readFileSync(entry, "utf8");
  const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)];
  const scripts = [
    ...html.matchAll(/<script (defer )?src="([^"]+)"><\/script>/g),
  ];
  const read = (asset) => {
    const file = path.resolve(root, asset);
    if (!file.startsWith(path.resolve(root) + path.sep))
      throw Error("Asset escapes site directory");
    return fs.readFileSync(file, "utf8");
  };
  const versions = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, "0");
      const hash = crypto
        .createHash("sha256")
        .update(read("assets/data/history/" + month + ".js"))
        .digest("hex")
        .slice(0, 16);
      return [month, hash];
    }),
  );
  // Keep CSS in the same directory so relative image URLs retain their meaning.
  fs.writeFileSync(
    path.join(root, "assets/css/site.css"),
    styles.map((match) => read(match[1])).join("\n"),
  );
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (tag) =>
    tag === styles[0][0]
      ? '<link rel="stylesheet" href="assets/css/site.css">'
      : "",
  );
  for (const deferred of [false, true]) {
    const group = scripts.filter((match) => Boolean(match[1]) === deferred);
    const asset = deferred ? "assets/js/site.js" : "assets/js/site-theme.js";
    const source = group
      .map((match) => "/* " + match[2] + " */\n" + read(match[2]))
      .join("\n;\n");
    fs.writeFileSync(
      path.join(root, asset),
      source +
        (deferred
          ? ""
          : "\n;WorkTimeApp.data.historyVersions = " +
            JSON.stringify(versions) +
            ";\n"),
    );
    for (const [index, match] of group.entries())
      html = html.replace(
        match[0],
        index === 0
          ? "<script " +
              (deferred ? "defer " : "") +
              'src="' +
              asset +
              '"></script>'
          : "",
      );
  }
  fs.writeFileSync(entry, html);
  console.log(
    `Bundled ${styles.length} styles and ${scripts.length} scripts into 3 requests.`,
  );
}
if (require.main === module)
  bundleSite(path.resolve(process.argv[2] || "_site"));
module.exports = { bundleSite };

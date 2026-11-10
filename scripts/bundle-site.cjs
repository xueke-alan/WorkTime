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
  // Dynamic resources need the same content-addressed cache invalidation as HTML dependencies.
  function dynamicFiles(directory) {
    return fs
      .readdirSync(path.join(root, directory), { withFileTypes: true })
      .flatMap((entry) => {
        const asset = directory + "/" + entry.name;
        return entry.isDirectory()
          ? dynamicFiles(asset)
          : /\.(js|css)$/.test(asset)
            ? [asset]
            : [];
      });
  }
  const assetVersions = Object.fromEntries(
    [
      "assets/js/locales/runtime",
      "assets/js/games",
      "assets/css",
      "assets/data",
      "assets/vendor/reader",
      "assets/vendor/pikafish",
      "assets/vendor/misty-jungle",
      "assets/vendor/utttai",
    ]
      .flatMap(dynamicFiles)
      .concat([
        "assets/vendor/lunar.min.js",
        "assets/js/ui/core-runtime.min.js",
        "assets/js/ui/date-runtime.min.js",
        "assets/js/ui/view-runtime.min.js",
        "assets/js/ui/startup-runtime.min.js",
        "assets/js/auto-backup-folder.js",
        "assets/js/services/music-library.js",
        "assets/js/services/music-storage.js",
        "assets/js/controllers/music.js",
        "assets/js/controllers/workspace-expansion.js",
        "assets/js/ui/music.js",
        "assets/js/ui/music-runtime.min.js",
        "assets/js/services/reader-storage.js",
        "assets/js/services/reader-library.js",
        "assets/js/services/reader-adapters.js",
        "assets/js/controllers/reader.js",
        "assets/js/ui/reader.js",
        "assets/js/ui/reader-runtime.min.js",
        "assets/js/services/runtime-import.js",
        "assets/js/services/xiangqi-prefetch.js",
        "assets/js/services/utttai-prefetch.js",
        "assets/js/services/runtime-migration.js",
        "assets/js/ui/runtime-folder-change.js",
      ])
      .map((asset) => [
        asset,
        crypto
          .createHash("sha256")
          .update(read(asset))
          .digest("hex")
          .slice(0, 16),
      ]),
  );
  // Only locale catalogs can be requested before deferred startup begins.
  const earlyVersions = Object.fromEntries(
    Object.entries(assetVersions).filter(([asset]) =>
      asset.startsWith("assets/js/locales/runtime/"),
    ),
  );
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
  for (const language of ["en", "zh-TW", "zh-HK"])
    versions[language] = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => {
        const month = String(index + 1).padStart(2, "0");
        return [
          month,
          crypto
            .createHash("sha256")
            .update(
              read("assets/data/history/" + language + "/" + month + ".js"),
            )
            .digest("hex")
            .slice(0, 16),
        ];
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
      .map(
        (match) =>
          "/* " +
          match[2] +
          " */\n" +
          read(match[2]) +
          (match[2] === "assets/js/namespace.js"
            ? "\n;WorkTimeApp.data.assetVersions = " +
              JSON.stringify(earlyVersions) +
              ";\n"
            : ""),
      )
      .join("\n;\n");
    fs.writeFileSync(
      path.join(root, asset),
      (deferred
        ? '"use strict";\nObject.assign(WorkTimeApp.data.assetVersions,' +
          JSON.stringify(assetVersions) +
          ");\nWorkTimeApp.data.historyVersions = " +
          JSON.stringify(versions) +
          ";\n"
        : "") + source,
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
  // Download independent stages in parallel; boot.js still executes them in order.
  // Low priority lets the render-blocking stylesheet and theme finish first.
  const preloads = ["core", "date", "view", "startup"].map(
    (stage) =>
      '<link rel="preload" as="script" href="assets/js/ui/' +
      stage +
      '-runtime.min.js" fetchpriority="low">',
  );
  html = html.replace(
    '<script defer src="assets/js/site.js"></script>',
    preloads.join("\n") + '\n<script defer src="assets/js/site.js"></script>',
  );
  fs.writeFileSync(entry, html);
  console.log(
    `Bundled ${styles.length} styles and ${scripts.length} scripts into 3 entry bundles.`,
  );
}
if (require.main === module)
  bundleSite(path.resolve(process.argv[2] || "_site"));
module.exports = { bundleSite };

"use strict";
/** Reproducible, offline, classic-script reader engines and binary resources. */
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
const dest = path.join(root, "assets/vendor/reader");
function prepareReader() {
  fs.mkdirSync(dest, { recursive: true });
  const packages = new Set(["epubjs", "pdfjs-dist", "jszip"]);
  const entries = {
    epub: 'import ePub from "epubjs"; import JSZip from "jszip"; globalThis.WorkTimeReaderEPUB = { ePub, JSZip };',
    pdf: 'import * as pdf from "pdfjs-dist/build/pdf.mjs"; globalThis.WorkTimeReaderPDF = pdf;',
    "pdf-worker": 'import "pdfjs-dist/build/pdf.worker.mjs";',
  };
  for (const [name, contents] of Object.entries(entries)) {
    const result = esbuild.buildSync({
      stdin: { contents, resolveDir: root },
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      minify: true,
      legalComments: "eof",
      metafile: true,
      outfile: path.join(dest, name + ".js"),
    });
    for (const name of Object.keys(result.metafile.inputs)) {
      const match = name.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)/);
      if (match) packages.add(match[1]);
    }
  }
  for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    const source = path.join(root, "node_modules/pdfjs-dist", folder);
    if (!fs.existsSync(source)) continue;
    const target = path.join(dest, folder);
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(source)) {
      if (/LICENSE|\.js$|\.map$|\.md$/i.test(name)) continue;
      const data = fs.readFileSync(path.join(source, name)).toString("base64");
      fs.writeFileSync(
        path.join(target, name + ".js"),
        "/* PDF.js resource; Apache-2.0. See licenses/reader.txt. */\n" +
          "(globalThis.WorkTimeReaderBinary ||= {})[" +
          JSON.stringify(folder + "/" + name) +
          "] = " +
          JSON.stringify(data) +
          ";\n",
      );
    }
  }
  let license = "Reader dependencies are bundled locally.\n";
  for (const pkg of [...packages].sort()) {
    const pkgRoot = path.join(root, "node_modules", pkg);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"),
    );
    license += "\n--- " + pkg + " " + manifest.version + " ---\n";
    for (const file of fs
      .readdirSync(pkgRoot)
      .filter((name) => /^(license|copying|notice)(\.|$|-)/i.test(name)))
      if (fs.statSync(path.join(pkgRoot, file)).isFile())
        license += fs.readFileSync(path.join(pkgRoot, file), "utf8") + "\n";
  }
  // Preserve resource-specific notices as supplied by PDF.js.
  for (const folder of ["standard_fonts", "wasm", "cmaps"]) {
    const source = path.join(root, "node_modules/pdfjs-dist", folder);
    for (const file of fs
      .readdirSync(source)
      .filter((name) => /LICENSE/i.test(name)))
      license +=
        "\n--- " +
        folder +
        "/" +
        file +
        " ---\n" +
        fs.readFileSync(path.join(source, file), "utf8");
  }
  fs.writeFileSync(path.join(root, "licenses/reader.txt"), license);
}
if (require.main === module) prepareReader();
module.exports = { prepareReader };

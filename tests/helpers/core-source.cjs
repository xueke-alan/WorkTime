"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
/** Match the browser entry point rather than maintaining a second module list. */
function coreFiles() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  return [
    ...html.matchAll(
      /<script defer src="(assets\/(?:js\/(?:domain\/[^" ]+|core)|data\/calendars)\.js)"><\/script>/g,
    ),
  ].map((match) => match[1]);
}
function readCoreSource() {
  return coreFiles()
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n");
}
module.exports = { coreFiles, readCoreSource };

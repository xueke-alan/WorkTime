"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
/** Read the production entry's ordered pure modules for development tools. */
function domainFiles() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  return [
    "assets/js/namespace.js",
    ...[
      ...html.matchAll(
        /<script(?: defer)? src="(assets\/(?:js\/domain\/[^" ]+|data\/(?:calendars|struggle-days|major-festivals))\.js)"><\/script>/g,
      ),
    ].map((match) => match[1]),
  ];
}
function readDomainSource() {
  return domainFiles()
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n");
}
module.exports = { domainFiles, readDomainSource };

"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const results = path.resolve(__dirname, "../../test-results");
fs.mkdirSync(results, { recursive: true });
function launchBrowser() {
  return chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
}
module.exports = { launchBrowser, results };

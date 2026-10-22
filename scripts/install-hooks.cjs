"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
if (fs.existsSync(path.join(root, ".git"))) {
  const result = spawnSync("git", ["config", "--get", "core.hooksPath"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1)
    throw Error("Unable to inspect Git hooks configuration.");
  const current = result.stdout.trim();
  if (current && current !== ".githooks") {
    throw Error(
      "Existing core.hooksPath: " + current + "; integrate pre-push manually.",
    );
  }
  fs.chmodSync(path.join(root, ".githooks/pre-push"), 0o755);
  execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
    cwd: root,
  });
  console.log("Installed pre-push release checks.");
}

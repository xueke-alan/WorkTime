"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
function git(args, options = {}) {
  return execFileSync("git", args, { cwd: root, ...options });
}
let snapshot;
try {
  const revisions = new Set(
    fs
      .readFileSync(0, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[1])
      .filter((sha) => !/^0+$/.test(sha)),
  );
  for (const revision of revisions) {
    const lock = git(["show", revision + ":package-lock.json"]);
    if (!lock.equals(fs.readFileSync(path.join(root, "package-lock.json"))))
      throw Error(
        "Pushed lockfile differs from working tree; install that revision's dependencies first.",
      );
    snapshot = fs.mkdtempSync(path.join(os.tmpdir(), "worktime-pre-push-"));
    const archive = git(["archive", "--format=tar", revision], {
      maxBuffer: 256 * 1024 * 1024,
    });
    execFileSync("tar", ["-xf", "-", "-C", snapshot], { input: archive });
    fs.symlinkSync(
      path.join(root, "node_modules"),
      path.join(snapshot, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    console.log("Checking pushed commit " + revision + " in " + snapshot);
    const result = spawnSync(
      process.execPath,
      [path.join(snapshot, "scripts/verify-release.cjs")],
      {
        cwd: snapshot,
        env: process.env,
        stdio: "inherit",
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error("Checks failed; push blocked.");
    fs.rmSync(snapshot, { recursive: true, force: true });
    snapshot = undefined;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (snapshot) fs.rmSync(snapshot, { recursive: true, force: true });
}

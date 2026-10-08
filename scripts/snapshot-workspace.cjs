"use strict";
// Preserve the actual worktree, including untracked work, before refactoring.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const destination = path.join(
  root,
  ".refactor-backups",
  `workspace-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root },
)
  .toString()
  .split("\0")
  .filter(Boolean);
const manifest = [];
for (const relative of [...new Set(files)].sort()) {
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) {
    manifest.push({ path: relative, deleted: true });
    continue;
  }
  const content = fs.readFileSync(source);
  const target = path.join(destination, "files", relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  const category = relative.startsWith("tests/")
    ? "tests"
    : relative.startsWith("scripts/") || relative.startsWith(".github/")
      ? "tooling"
      : relative.startsWith("docs/") || /\.md$/.test(relative)
        ? "documentation"
        : /(?:^data\/|assets\/data\/)/.test(relative)
          ? "data"
          : relative.startsWith("assets/icons/") ||
              relative.startsWith("licenses/")
            ? "resources"
            : "runtime";
  manifest.push({
    path: relative,
    category,
    bytes: content.length,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    review: "pending",
  });
}
fs.writeFileSync(
  path.join(destination, "manifest.json"),
  JSON.stringify(
    { capturedAt: new Date().toISOString(), files: manifest },
    null,
    2,
  ) + "\n",
);
fs.writeFileSync(
  path.join(destination, "git-status.txt"),
  execFileSync("git", ["status", "--short"], { cwd: root }),
);
console.log(`${manifest.length} worktree files preserved in ${destination}`);

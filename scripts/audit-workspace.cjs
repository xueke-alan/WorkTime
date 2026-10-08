"use strict";
// Inventory is evidence for review coverage, not an automatic semantic approval.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process");
const { retainReview } = require("./lib/audit-review.cjs");
const root = path.resolve(__dirname, ".."),
  snapshot = ".refactor-backups/workspace-2026-10-04T03-32-53-659Z",
  args = process.argv.slice(2);
const index = args.indexOf("--output"),
  relativeOutput =
    index < 0 ? "test-results/workspace-audit.json" : args[index + 1];
assert(relativeOutput, "Output path required");
const output = path.resolve(root, relativeOutput);
assert(
  output.startsWith(root + path.sep),
  "Audit output must stay inside workspace",
);
assert(!fs.existsSync(output), "Refusing to overwrite a previous audit");
const priorIndex = args.indexOf("--prior"),
  priorPath = priorIndex < 0 ? null : path.resolve(root, args[priorIndex + 1]);
if (priorPath)
  assert(
    priorPath.startsWith(root + path.sep),
    "Prior audit must stay inside workspace",
  );
const prior = priorPath ? JSON.parse(fs.readFileSync(priorPath, "utf8")) : null,
  reviewed = new Map((prior?.files || []).map((file) => [file.path, file]));
const original = JSON.parse(
  fs.readFileSync(path.join(root, snapshot, "manifest.json"), "utf8"),
);
const baseline = new Map(original.files.map((file) => [file.path, file]));
const current = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root },
)
  .toString()
  .split("\0")
  .filter(Boolean);
const outputRelative = path.relative(root, output).replaceAll(path.sep, "/");
const priorRelative = priorPath
  ? path.relative(root, priorPath).replaceAll(path.sep, "/")
  : null;
const excludedOutputs = [outputRelative, priorRelative].filter(Boolean);
const paths = [...new Set([...baseline.keys(), ...current, ...reviewed.keys()])]
  .filter((file) => !excludedOutputs.includes(file))
  .sort();
const history = new Set([
  "docs/REFACTOR_PLAN.md",
  "docs/REFACTOR_PROGRESS.md",
  "docs/COMPLETION_AUDIT.md",
  "docs/DELIVERY_AUDIT.md",
  "docs/PERFORMANCE_BASELINE.md",
  "docs/PERFORMANCE_COMPARISON.md",
  "docs/PERFORMANCE_FINAL.md",
  "docs/PERFORMANCE_FINAL_STAGE27.md",
]);
const generated = new Map([
  [
    "assets/data/weather-cities.js",
    "assets/data/weather-locations.json; scripts/sync-weather-cities.cjs",
  ],
  [
    "data/weather.json",
    "scripts/fetch_weather.py; .github/workflows/weather.yml",
  ],
]);
const deleted = new Map([
  [
    "assets/js/core.js",
    "Removed forwarding facade; index and public tools load domain modules explicitly; namespace/offline-entry gates.",
  ],
  [
    "assets/js/domain/migrations.js",
    "Old schema conversion belongs to independent tools/convert-backup.html, excluded from runtime; backup-conversion gate.",
  ],
  [
    "tests/helpers/button-style-change.cjs",
    "No remaining callers after five strict style references; historical helper preserved in protected snapshot.",
  ],
]);
function category(file) {
  if (generated.has(file)) return "generated";
  if (history.has(file)) return "history";
  if (/^tests\//.test(file)) return "tests";
  if (
    /^(scripts\/|\.github\/)/.test(file) ||
    /^\.(?:gitignore|prettierignore)$/.test(file) ||
    /^(?:package(?:-lock)?\.json|eslint\.config\.cjs)$/.test(file)
  )
    return "scripts";
  if (/^(data\/|assets\/data\/)/.test(file)) return "data";
  if (
    /^(assets\/(?:icons|images|fonts)\/|licenses\/)/.test(file) ||
    /\.(?:png|jpg|svg|woff2?)$/.test(file)
  )
    return "resources";
  if (/^docs\//.test(file) || /\.md$/.test(file)) return "documentation";
  return "runtime";
}
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const files = paths.map((file) => {
  const previous = baseline.get(file),
    exists = fs.existsSync(path.join(root, file)),
    bytes = exists ? fs.readFileSync(path.join(root, file)) : null;
  if (previous?.sha256)
    assert.equal(
      hash(fs.readFileSync(path.join(root, snapshot, "files", file))),
      previous.sha256,
      "Protected original changed: " + file,
    );
  const sha256 = bytes && hash(bytes),
    change = !exists
      ? "absent"
      : !previous
        ? "added"
        : sha256 === previous.sha256
          ? "unchanged"
          : "modified";
  const entry = {
    path: file,
    category: category(file),
    change,
    baselineSha256: previous?.sha256 ?? null,
    sha256,
    bytes: bytes?.length ?? null,
    review:
      !exists && deleted.has(file)
        ? {
            status: "reviewed",
            decision: "delete",
            reason: deleted.get(file),
            originalPreserved: Boolean(previous?.sha256),
          }
        : { status: "pending", decision: null },
    ...(generated.has(file) ? { authority: generated.get(file) } : {}),
  };
  const inherited = retainReview(entry, reviewed.get(file));
  if (inherited) entry.review = { ...inherited, inheritedFrom: priorRelative };
  else if (reviewed.get(file)?.review.status === "reviewed")
    entry.previousReviewInvalidated = {
      sha256: reviewed.get(file).sha256,
      decision: reviewed.get(file).review.decision,
      reason:
        "Content, baseline identity or category differs; explicit review required.",
    };
  return entry;
});
const count = (field) =>
  Object.fromEntries(
    [...new Set(files.map((file) => file[field]))].map((value) => [
      value,
      files.filter((file) => file[field] === value).length,
    ]),
  );
const report = {
  capturedAt: new Date().toISOString(),
  baseline: snapshot + "/manifest.json",
  baselineFiles: original.files.length,
  completeSemanticReview: false,
  enumeration:
    "git cached plus nonignored untracked plus every original and prior audit path; audit input/output excluded to avoid recursive hashes",
  excludedOutput: outputRelative,
  excludedOutputs,
  priorAudit: priorRelative,
  reviewsInherited: files.filter((file) => file.review.inheritedFrom).length,
  reviewsInvalidated: files.filter((file) => file.previousReviewInvalidated)
    .length,
  categories: count("category"),
  changes: count("change"),
  pending: files.filter((file) => file.review.status === "pending").length,
  files,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify({
    output,
    baselineFiles: report.baselineFiles,
    files: files.length,
    categories: report.categories,
    changes: report.changes,
    pending: report.pending,
    completeSemanticReview: false,
  }),
);

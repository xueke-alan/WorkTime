"use strict";
/* global WorkTime, WorkUI -- lexical exports read only inside the frozen-page capture callback. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "../.."),
  snapshotDirectory = path.join(
    root,
    ".refactor-backups/workspace-2026-10-04T03-32-53-659Z",
  ),
  snapshotRoot = path.join(snapshotDirectory, "files");
function create(group, defaultBaseline) {
  const args = process.argv.slice(2),
    frozen = args.includes("--frozen"),
    label = args.find((arg) => arg.startsWith("--capture="))?.slice(10),
    reference = args.find((arg) => arg.startsWith("--reference="))?.slice(12);
  if (label && !/^[a-z0-9-]+$/.test(label))
    throw Error("Invalid capture label");
  if (frozen && !label)
    throw Error("Frozen reference requires a unique --capture label");
  if (label && reference)
    throw Error("Capture and comparison cannot run together");
  if (args.includes("--record-settings"))
    throw Error(
      "Do not overwrite existing baselines; use --capture=<unique label>",
    );
  const sourceRoot = frozen ? snapshotRoot : root,
    baseline = label
      ? path.join(root, "test-results", `styles-${group}-${label}.json.gz`)
      : reference
        ? path.resolve(root, reference)
        : path.join(root, defaultBaseline);
  if (!baseline.startsWith(root + path.sep))
    throw Error("Style reference must remain in the workspace");
  if (label && fs.existsSync(baseline))
    throw Error("Refusing to replace captured style evidence");
  const html = fs.readFileSync(path.join(sourceRoot, "index.html"), "utf8"),
    files = [
      ...new Set([
        "index.html",
        ...[
          ...html.matchAll(/(?:src|href)="(assets\/[^"?#]+\.(?:js|css))"/g),
        ].map((match) => match[1]),
      ]),
    ],
    hashes = files.map((file) => ({
      path: file,
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(sourceRoot, file)))
        .digest("hex"),
    }));
  if (frozen) {
    const snapshot = JSON.parse(
        fs.readFileSync(path.join(snapshotDirectory, "manifest.json"), "utf8"),
      ),
      expected = new Map(
        snapshot.files.map((file) => [file.path, file.sha256]),
      );
    for (const file of hashes)
      if (expected.get(file.path) !== file.sha256)
        throw Error("Frozen source changed: " + file.path);
  }
  if (label) {
    fs.mkdirSync(path.dirname(baseline), { recursive: true });
    fs.writeFileSync(
      baseline + ".source.json",
      JSON.stringify({ group, frozen, sourceRoot, files: hashes }, null, 2) +
        "\n",
      { flag: "wx" },
    );
  }
  async function visit(page) {
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(path.join(sourceRoot, "index.html")).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    if (frozen)
      await page.evaluate(() => {
        // Capture-only access to the untouched historical page. Never loaded by the application.
        globalThis.WorkTimeApp = {
          domain: { state: WorkTime, time: WorkTime, statistics: WorkTime },
          ui: {
            alignment: globalThis.UIAlignment,
            numbers: globalThis.SummaryNumbers,
            createSummary: (options) =>
              WorkUI.createSummary({
                ...options,
                core: {
                  ...options.core,
                  formatMinutes: WorkTime.formatMinutes,
                },
              }),
            dateInfo: globalThis.DateInfoUI,
          },
          services: { dateInfo: globalThis.DateInfo },
        };
      });
  }
  function domainSource() {
    if (!frozen) return require("./core-source.cjs").readCoreSource();
    return (
      "globalThis.window=globalThis;\n" +
      require(
        path.join(snapshotRoot, "tests/helpers/core-source.cjs"),
      ).readCoreSource() +
      "\nconst DomainTest=WorkTime;"
    );
  }
  return {
    frozen,
    baseline,
    capture: !!label,
    referenceSpecified: !!reference,
    visit,
    domainSource,
  };
}
module.exports = { create };

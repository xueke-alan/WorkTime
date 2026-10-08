"use strict";
// Development-only download. The application renders embedded SVGs without network requests.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  revision = "737e3324305806514d7909874fa1818ae1808232",
  mappings = {
    backup: "share_windows",
    "delete-outline": "delete",
    restore: "output_circle",
    clock: "schedule",
    sun: "light_mode",
    calendar: "calendar_month",
    "weather-rain": "rainy",
    "weather-snow": "weather_snowy",
    "weather-fog": "foggy",
    "weather-thunder": "thunderstorm",
  },
  additions = [
    "check",
    "calculate",
    "notifications",
    "notifications-off",
    "clock",
    "sun",
    "cloud",
    "calendar",
    "person-add",
    "currency-yen",
    "download",
    "attach-file",
  ];
async function build(html, fetchSvg = fetch) {
  const ids = [
    ...new Set([
      ...[...html.matchAll(/<symbol id="ms-([^"]+)"/g)].map(
        (match) => match[1],
      ),
      ...additions,
    ]),
  ];
  const icons = await Promise.all(
    ids.map(async (id) => {
      const name = mappings[id] || id.replaceAll("-", "_"),
        source = `https://raw.githubusercontent.com/google/material-design-icons/${revision}/symbols/web/${name}/materialsymbolsrounded/${name}_24px.svg`;
      const response = await fetchSvg(source, {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw Error(`${name}: ${response.status}`);
      const svg = await response.text(),
        viewBox = svg.match(/viewBox="([^"]+)"/)?.[1],
        content = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1];
      if (
        viewBox !== "0 -960 960 960" ||
        !/^<path d="[\w\s.,-]+"\s*\/>$/.test(content || "")
      )
        throw Error(`Unexpected SVG: ${name}`);
      return { id, name, source, viewBox, content, svg };
    }),
  );
  const symbols = icons
    .map(
      ({ id, viewBox, content }) =>
        ` <symbol id="ms-${id}" viewBox="${viewBox}">${content}</symbol>`,
    )
    .join("\n");
  if ([...html.matchAll(/<svg class="icon-sprite"[^>]*>/g)].length !== 1)
    throw Error("Expected exactly one icon sprite");
  html = html
    .replace(
      /(<svg class="icon-sprite"[^>]*>)[\s\S]*?(<\/svg>)/,
      `$1\n${symbols}\n$2`,
    )
    .replaceAll("#ui-plan-check", "#ms-check");
  const manifest =
    JSON.stringify(
      {
        family: "Material Symbols Rounded",
        weight: 400,
        fill: 0,
        opticalSize: 24,
        license: "Apache-2.0",
        source: "https://fonts.google.com/icons",
        revision,
        icons: icons.map(({ id, name, source, viewBox, content }) => ({
          id: "ms-" + id,
          name,
          source,
          viewBox,
          sha256: crypto.createHash("sha256").update(content).digest("hex"),
        })),
      },
      null,
      2,
    ) + "\n";
  return { html, manifest, count: ids.length };
}
async function replacePair(entries, io = fs) {
  const suffix =
      ".icons-" + process.pid + "-" + crypto.randomBytes(6).toString("hex"),
    originals = await Promise.all(entries.map(([file]) => io.readFile(file))),
    staged = entries.map(([file]) => file + suffix),
    replaced = [];
  try {
    for (let index = 0; index < entries.length; index++)
      await io.writeFile(staged[index], entries[index][1], { flag: "wx" });
    for (let index = 0; index < entries.length; index++) {
      if (!(await io.readFile(entries[index][0])).equals(originals[index]))
        throw Error(
          "External change prevents icon update: " + entries[index][0],
        );
    }
    for (let index = 0; index < entries.length; index++) {
      await io.rename(staged[index], entries[index][0]);
      replaced.push(index);
    }
  } catch (error) {
    for (const index of replaced.reverse()) {
      await io.writeFile(staged[index], originals[index]);
      await io.rename(staged[index], entries[index][0]);
    }
    throw error;
  } finally {
    for (const file of staged) await io.rm(file, { force: true });
  }
}
async function main(args = process.argv.slice(2)) {
  if (args.some((arg) => arg !== "--check"))
    throw Error("Usage: node scripts/sync-material-icons.cjs [--check]");
  const file = path.join(root, "index.html"),
    manifestFile = path.join(root, "assets/icons/material-symbols.json"),
    original = await fs.readFile(file, "utf8"),
    result = await build(original),
    manifest = await fs.readFile(manifestFile, "utf8"),
    normalize = (text) => text.replaceAll("\r\n", "\n");
  if (args.includes("--check")) {
    if (
      normalize(original) !== normalize(result.html) ||
      normalize(manifest) !== normalize(result.manifest)
    )
      throw Error(
        "Embedded icons or manifest differ from the pinned source; run sync-material-icons.cjs",
      );
    console.log(
      `Checked ${result.count} official symbols at ${revision}; no files written.`,
    );
  } else {
    await replacePair([
      [file, result.html],
      [manifestFile, result.manifest],
    ]);
    console.log(
      `Embedded ${result.count} official symbols at ${revision} and saved source manifest.`,
    );
  }
}
module.exports = { build, replacePair, revision };
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

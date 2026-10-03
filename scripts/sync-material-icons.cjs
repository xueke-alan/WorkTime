"use strict";
// Development-only download. The application renders embedded SVGs without network requests.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  mappings = {
    "delete-outline": "delete",
    restore: "history",
    clock: "schedule",
    sun: "light_mode",
    calendar: "calendar_month",
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
async function main() {
  const file = path.join(root, "index.html");
  let html = await fs.readFile(file, "utf8");
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
        source = `https://raw.githubusercontent.com/google/material-design-icons/master/symbols/web/${name}/materialsymbolsrounded/${name}_24px.svg`;
      const response = await fetch(source);
      if (!response.ok) throw Error(`${name}: ${response.status}`);
      const svg = await response.text(),
        viewBox = svg.match(/viewBox="([^"]+)"/)[1],
        content = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];
      if (!/^<path d="[\w\s.,-]+"\s*\/>$/.test(content))
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
  html = html
    .replace(
      /(<svg class="icon-sprite"[^>]*>)[\s\S]*?(<\/svg>)/,
      `$1\n${symbols}\n$2`,
    )
    .replaceAll("#ui-plan-check", "#ms-check");
  await fs.writeFile(file, html);
  const directory = path.join(root, "assets/icons");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "material-symbols.json"),
    JSON.stringify(
      {
        family: "Material Symbols Rounded",
        weight: 400,
        fill: 0,
        opticalSize: 24,
        license: "Apache-2.0",
        source: "https://fonts.google.com/icons",
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
    ) + "\n",
  );
  console.log(
    `Embedded ${ids.length} official symbols and saved source manifest.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

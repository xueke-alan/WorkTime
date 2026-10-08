"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  {
    build,
    replacePair,
    revision,
  } = require("../scripts/sync-material-icons.cjs");
async function main() {
  const html =
      '<svg class="icon-sprite"><symbol id="ms-stacks"></symbol></svg>',
    urls = [],
    svg = '<svg viewBox="0 -960 960 960"><path d="M0 0Z"/></svg>',
    result = await build(html, async (url) => {
      urls.push(url);
      return { ok: true, text: async () => svg };
    });
  assert(urls.every((url) => url.includes("/" + revision + "/")));
  assert.equal(JSON.parse(result.manifest).revision, revision);
  await assert.rejects(
    build(html, async () => ({ ok: false, status: 503 })),
    /503/,
  );
  for (const invalid of [
    "<svg/>",
    '<svg viewBox="0 -960 960 960"><script>bad</script></svg>',
  ])
    await assert.rejects(
      build(html, async () => ({ ok: true, text: async () => invalid })),
      /Unexpected SVG/,
    );
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "worktime-icon-sync-"),
  );
  try {
    const first = path.join(directory, "index.html"),
      second = path.join(directory, "manifest.json"),
      entries = [
        [first, result.html],
        [second, result.manifest],
      ];
    await fs.writeFile(first, "original html");
    await fs.writeFile(second, "original manifest");
    let failed = false;
    await assert.rejects(
      replacePair(entries, {
        ...fs,
        async rename(from, to) {
          if (to === second && !failed) {
            failed = true;
            throw Error("Injected second-file failure");
          }
          return fs.rename(from, to);
        },
      }),
      /Injected second-file failure/,
    );
    assert.equal(await fs.readFile(first, "utf8"), "original html");
    assert.equal(await fs.readFile(second, "utf8"), "original manifest");
    assert.deepEqual((await fs.readdir(directory)).sort(), [
      "index.html",
      "manifest.json",
    ]);
    await replacePair(entries);
    assert.equal(await fs.readFile(first, "utf8"), result.html);
    assert.equal(await fs.readFile(second, "utf8"), result.manifest);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
  console.log(
    "Icon sync passed: pinned sources, malformed/download failure, pair rollback and staged cleanup.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

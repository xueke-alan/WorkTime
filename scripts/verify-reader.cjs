"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const JSZip = require("jszip");
const source = path.resolve(__dirname, "..");
const root = path.resolve(process.argv[2] || source);
const output = path.join(
  source,
  "test-results/reader",
  root === source ? "source" : "published",
);
const fixtures = path.join(output, "books");
fs.mkdirSync(fixtures, { recursive: true });
const padding = Buffer.from(
  "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
  "hex",
);
const md5 = (b) => crypto.createHash("md5").update(b).digest();
function padded(text) {
  return Buffer.concat([Buffer.from(text), padding]).subarray(0, 32);
}
function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
  }
  let i = 0;
  j = 0;
  return Buffer.from(
    [...data].map((b) => {
      i = (i + 1) % 256;
      j = (j + s[i]) % 256;
      [s[i], s[j]] = [s[j], s[i]];
      return b ^ s[(s[i] + s[j]) % 256];
    }),
  );
}
function pdf({ password = false, scan = false, chinese = false } = {}) {
  const id = Buffer.alloc(16, 7),
    owner = rc4(md5(padded("owner")).subarray(0, 5), padded("secret")),
    permission = Buffer.alloc(4);
  permission.writeInt32LE(-4);
  const key = md5(
      Buffer.concat([padded("secret"), owner, permission, id]),
    ).subarray(0, 5),
    user = rc4(key, padding);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 2 /Kids [3 0 R 6 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    chinese
      ? "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [8 0 R] >>"
      : "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    null,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>",
    null,
  ];
  const text = scan
    ? "q 180 0 0 180 20 350 cm BI /W 1 /H 1 /CS /RGB /BPC 8 ID \x60\x80\x90 EI Q"
    : chinese
      ? "BT /F1 20 Tf 30 500 Td <4e2d65876d4b8bd5> Tj ET"
      : "BT /F1 20 Tf 30 500 Td (Hello local reader first page) Tj ET";
  for (const [n, value] of [
    [5, text],
    [7, scan ? text : "BT /F1 20 Tf 30 500 Td (Second searchable page) Tj ET"],
  ]) {
    let bytes = Buffer.from(value, "latin1");
    if (password) {
      const suffix = Buffer.from([n, 0, 0, 0, 0]);
      bytes = rc4(md5(Buffer.concat([key, suffix])).subarray(0, 10), bytes);
    }
    objects[n - 1] = Buffer.concat([
      Buffer.from(`<< /Length ${bytes.length} >>\nstream\n`),
      bytes,
      Buffer.from("\nendstream"),
    ]);
  }
  if (chinese)
    objects.push(
      "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 9 0 R >>",
      "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>",
    );
  if (password)
    objects.push(
      `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -4 >>`,
    );
  let data = Buffer.from("%PDF-1.4\n"),
    offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(data.length);
    data = Buffer.concat([
      data,
      Buffer.from(`${index + 1} 0 obj\n`),
      Buffer.isBuffer(body) ? body : Buffer.from(body),
      Buffer.from("\nendobj\n"),
    ]);
  });
  const xref = data.length;
  return Buffer.concat([
    data,
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${password ? `/Encrypt ${objects.length} 0 R /ID [<${id.toString("hex")}><${id.toString("hex")}>]` : ""} >>\nstartxref\n${xref}\n%%EOF`,
    ),
  ]);
}
async function epub(fixed = false) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    "OEBPS/book.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">reader-${fixed}</dc:identifier><dc:title>${fixed ? "Fixed sample" : "Local EPUB"}</dc:title><dc:creator>Local Author</dc:creator><dc:language>en</dc:language>${fixed ? '<meta property="rendition:layout">pre-paginated</meta>' : ""}</metadata><manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`,
  );
  zip.file(
    "OEBPS/nav.xhtml",
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">First chapter</a></li><li><a href="two.xhtml">Second chapter</a></li></ol></nav></body></html>',
  );
  for (const [name, title] of [
    ["one", "First chapter"],
    ["two", "Second chapter"],
  ])
    zip.file(
      `OEBPS/${name}.xhtml`,
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><meta name="viewport" content="width=400,height=600"/><style>@import 'https://reader-test.invalid/evil.css';p{background:url(https://reader-test.invalid/bg.png)}</style></head><body><h1>${title}</h1><script>parent.READER_UNSAFE=true</script><img src="https://reader-test.invalid/evil.png"/><p>${"Searchable EPUB paragraph. ".repeat(fixed ? 3 : 150)}</p><a href="two.xhtml">Next chapter</a></body></html>`,
    );
  return zip.generateAsync({ type: "nodebuffer" });
}
async function main() {
  const files = {
    "Novel.txt": Buffer.from(
      "第一章 开始\n" +
        "中文阅读测试 searchable text。\n".repeat(900) +
        "第二章 继续\n" +
        "最后一章正文。\n".repeat(100),
    ),
    "UTF16.txt": Buffer.concat([
      Buffer.from([255, 254]),
      Buffer.from("第一章 编码\n中文 UTF16 测试", "utf16le"),
    ]),
    "GB.txt": Buffer.from([
      0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xb2, 0xe2, 0xca, 0xd4,
    ]),
    "Document.pdf": pdf(),
    "Scanned.pdf": pdf({ scan: true }),
    "Password.pdf": pdf({ password: true }),
    "Chinese.pdf": pdf({ chinese: true }),
    "Book.epub": await epub(),
    "Fixed.epub": await epub(true),
    "Broken.pdf": Buffer.from("broken"),
  };
  for (const [name, bytes] of Object.entries(files))
    fs.writeFileSync(path.join(fixtures, name), bytes);
  const audioDir = path.join(output, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const audio = Buffer.alloc(44 + 8000 * 2 * 30);
  audio.write("RIFF");
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  fs.writeFileSync(path.join(audioDir, "Track.wav"), audio);
  const browser = await chromium.launch({ headless: true });
  const server = http.createServer((req, res) => {
    const file = path.resolve(
      root,
      "." + decodeURIComponent(req.url.split("?")[0]),
    );
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const mime = {
        ".js": "text/javascript",
        ".html": "text/html",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      };
      res.setHeader(
        "Content-Type",
        mime[path.extname(file)] || "application/octet-stream",
      );
      res.end(fs.readFileSync(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    for (const protocol of ["file", "http"]) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 960 },
        reducedMotion: "reduce",
      });
      const errors = [],
        remote = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") console.log("BROWSER", msg.text());
      });
      await page.route(/^https?:/, (route) => {
        if (route.request().url().startsWith("http://127.0.0.1:"))
          return route.continue();
        if (route.request().url().includes("reader-test.invalid"))
          remote.push(route.request().url());
        return route.abort();
      });
      await page.addInitScript(() => {
        window.showDirectoryPicker = undefined;
      });
      const url =
        protocol === "file"
          ? pathToFileURL(path.join(root, "index.html")).href
          : `http://127.0.0.1:${server.address().port}/index.html`;
      await page.addInitScript(() =>
        localStorage.setItem("worktime.onboarding.v1", "done"),
      );
      await page.goto(url);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      assert.equal(
        await page.evaluate(
          () => !!window.WorkTimeReaderPDF || !!window.WorkTimeReaderEPUB,
        ),
        false,
        "No reader engines at startup",
      );
      await page.locator("#readerOpen").click();
      await page.waitForFunction(
        () => document.querySelector("#readerDialog")?.dataset.state === "open",
      );
      async function emptyMiniRoundTrip(expectedBooks, reload = false) {
        await page.evaluate(async (expected) => {
          for (let n = 0; n < 100; n++) {
            if (
              Object.keys(
                (await WorkTimeApp.services.readerStorage.read()).books,
              ).length === expected
            )
              return;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          throw Error("Library save did not settle");
        }, expectedBooks);
        const records = () =>
          page.evaluate(async () => {
            const state = await WorkTimeApp.services.readerStorage.read();
            return {
              books: Object.values(state.books).map((b) => ({
                id: b.id,
                location: b.location,
                progress: b.progress,
                status: b.status,
                annotations: b.annotations,
                bookmarks: b.bookmarks,
              })),
              daily: state.daily,
            };
          });
        const before = await records();
        for (let round = 0; round < 2; round++) {
          assert.equal(
            await page.locator("#readerMinimize").isDisabled(),
            false,
            "Empty library can minimize",
          );
          await page.locator("#readerMinimize").click();
          await page.waitForFunction(
            () =>
              document.querySelector("#readerDialog").hidden &&
              !document.querySelector("#readerPanel").hidden &&
              document
                .querySelector("#readerMiniViewport")
                .getAttribute("aria-busy") === "false",
          );
          assert.equal(
            await page.locator(".reader-mini-empty").isVisible(),
            true,
          );
          for (const id of [
            "readerMiniPrevious",
            "readerMiniNext",
            "readerMiniProgress",
          ])
            assert.equal(await page.locator("#" + id).isDisabled(), true);
          assert.equal(
            await page.locator(".reader-stage").count(),
            0,
            "Empty presentation never creates a renderer",
          );
          await page.waitForFunction(
            () => document.activeElement?.id === "readerMiniExpand",
          );
          await page.locator("#readerMiniExpand").click();
          await page.waitForFunction(
            () =>
              document.querySelector("#readerDialog").dataset.state === "open",
          );
          assert.equal(
            await page.locator(".reader-book").count(),
            expectedBooks,
          );
        }
        assert.deepEqual(
          await records(),
          before,
          "Empty mode preserves progress and does not count reading time",
        );
        if (reload) {
          await page.locator("#readerMinimize").click();
          await page.waitForFunction(
            () =>
              document.querySelector("#readerDialog").hidden &&
              !document.querySelector("#readerPanel").hidden,
          );
          await page.evaluate(async () => {
            for (let n = 0; n < 100; n++) {
              if (
                (await WorkTimeApp.services.readerStorage.readPresentation()) ===
                "mini"
              )
                return;
              await new Promise((r) => setTimeout(r, 10));
            }
            throw Error("Empty mode preference was not saved");
          });
          await page.reload();
          await page.waitForFunction(
            () => document.documentElement.dataset.appState === "ready",
          );
          await page.locator("#readerOpen").click();
          await page.waitForSelector(".reader-mini-empty");
          assert.equal(await page.locator("#readerDialog").isVisible(), false);
          assert.equal(await page.locator(".reader-stage").count(), 0);
          assert.equal(
            await page.evaluate(
              () => !!window.WorkTimeReaderPDF || !!window.WorkTimeReaderEPUB,
            ),
            false,
            "Empty reload does not load book engines",
          );
          await page.locator("#readerMiniExpand").click();
          await page.waitForFunction(
            () =>
              document.querySelector("#readerDialog").dataset.state === "open",
          );
        }
      }
      await emptyMiniRoundTrip(0, true);
      await page.evaluate(() => {
        const original = WorkTimeApp.services.readerAdapters.create;
        WorkTimeApp.services.readerAdapters.create = (...args) =>
          original(...args).catch((error) => {
            console.error("Reader initialization:", error.message);
            throw error;
          });
      });
      await page
        .locator('#readerDialog > input[type="file"]')
        .first()
        .setInputFiles(fixtures);
      await page
        .waitForFunction(
          () => document.querySelectorAll(".reader-book").length === 10,
        )
        .catch(async (error) => {
          console.log(
            await page.evaluate(() => ({
              status: document.querySelector(".reader-status")?.textContent,
              count: document.querySelectorAll(".reader-book").length,
              crypto: !!crypto.subtle,
              errors: document.body.innerText.slice(-1200),
            })),
          );
          throw error;
        });
      await page.waitForFunction(
        () => document.querySelector("#readerCancelScan").hidden,
        { timeout: 60000 },
      );
      await page.screenshot({
        path: path.join(output, protocol + "-shelf.png"),
      });
      await emptyMiniRoundTrip(10);
      let expectedShelfScroll = 0;
      async function openBook(name) {
        const entry = page
          .locator(".reader-book-open")
          .filter({ has: page.locator("h4", { hasText: name }) });
        await entry.scrollIntoViewIfNeeded();
        expectedShelfScroll = await page
          .locator(".reader-library-content")
          .evaluate((e) => e.scrollTop);
        await entry.click();
        await page.waitForFunction(
          (title) =>
            document.querySelector(".reader-book-title")?.textContent ===
              title &&
            !!document.querySelector("#readerViewport .reader-stage"),
          name,
        );
      }
      async function shelf() {
        await page.locator("#readerShelf").click();
        await page.waitForFunction(
          () => !document.querySelector(".reader-library").hidden,
        );
        const restored = await page
          .locator(".reader-library-content")
          .evaluate((e) => e.scrollTop);
        assert.ok(
          Math.abs(restored - expectedShelfScroll) <= 2,
          "Returning to library restores its scroll position",
        );
      }
      async function tool(name) {
        const button = page.locator("#reader-" + name);
        if (!(await button.isVisible()))
          await page.locator("#readerSidebarToggle").click();
        await button.click();
      }
      let musicChecked = false;
      async function miniRoundTrip(format, fallback = false) {
        const fullBefore = await page.locator(".reader-percent").textContent();
        const supported = await page.evaluate((fallback) => {
          window.readerMoveNative = Element.prototype.moveBefore;
          window.readerMiniFrame = document.querySelector(
            "#readerViewport iframe",
          )?.contentWindow;
          window.readerMiniStage = document.querySelector(
            "#readerViewport .reader-stage",
          );
          if (fallback) Element.prototype.moveBefore = undefined;
          return typeof window.readerMoveNative === "function";
        }, fallback);
        await page.locator("#readerMinimize").click();
        await page.waitForFunction(
          () =>
            document.querySelector("#readerDialog").hidden &&
            !document.querySelector("#readerPanel").hidden &&
            document
              .querySelector("#readerMiniViewport")
              .getAttribute("aria-busy") === "false" &&
            document.querySelector("#readerMiniViewport .reader-stage"),
        );
        assert.equal(
          await page.locator("#readerOpen").getAttribute("role"),
          "tab",
        );
        assert.equal(
          await page.locator("#readerOpen").getAttribute("aria-selected"),
          "true",
        );
        assert.equal(
          await page.locator(".reader-stage").count(),
          1,
          "Only one reading renderer exists",
        );
        assert.equal(
          await page.locator(".reader-mini .reader-button").count(),
          3,
          "Mini only has previous/next/expand controls",
        );
        if (supported && !fallback)
          assert.equal(
            await page.evaluate(
              (format) =>
                document.querySelector("#readerMiniViewport .reader-stage") ===
                  window.readerMiniStage &&
                (format !== "txt" ||
                  !window.readerMiniFrame ||
                  document.querySelector("#readerMiniViewport iframe")
                    .contentWindow === window.readerMiniFrame),
              format,
            ),
            true,
            "Atomic move preserves iframe state",
          );
        const before = Number(
          await page.locator("#readerMiniProgress").inputValue(),
        );
        await page.locator("#readerMiniNext").click();
        await page.waitForTimeout(120);
        assert.ok(
          Number(await page.locator("#readerMiniProgress").inputValue()) >=
            before,
          "Mini next advances the book",
        );
        await page.locator("#readerMiniPrevious").click();
        await page.locator("#readerMiniProgress").evaluate((e) => {
          e.value = "300";
          e.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await page.waitForTimeout(180);
        if (format === "txt") {
          const font = await page
            .locator("#readerMiniViewport iframe")
            .evaluate((e) =>
              parseFloat(
                e.contentWindow.getComputedStyle(e.contentDocument.body)
                  .fontSize,
              ),
            );
          assert.ok(font <= 18);
          await page.locator("#readerMiniViewport").focus();
          await page.keyboard.press("Control+f");
          assert.equal(
            await page.locator("#readerDialog").isVisible(),
            false,
            "Mini shortcut does not open full search",
          );
          await page.keyboard.press("Escape");
        }
        await page.screenshot({
          path: path.join(
            output,
            protocol +
              "-mini-" +
              format +
              (fallback ? "-fallback" : "") +
              ".png",
          ),
        });
        if (!musicChecked) {
          musicChecked = true;
          await page.locator("#musicOpen").click();
          await page.waitForFunction(
            () =>
              document.querySelector("#musicDialog")?.dataset.state === "open",
          );
          await page
            .locator('#musicDialog input[type="file"]')
            .first()
            .setInputFiles(audioDir);
          await page.waitForSelector(".music-track");
          await page.locator("#musicPlay").click();
          await page.waitForFunction(() =>
            document
              .querySelector("#musicOpen")
              .classList.contains("is-playing"),
          );
          await page.locator("#musicMinimize").click();
          await page.waitForFunction(
            () =>
              document.querySelector("#musicDialog").hidden &&
              !document.querySelector("#musicPanel").hidden,
          );
          await page.locator("#readerOpen").click();
          await page.waitForFunction(
            () =>
              !document.querySelector("#readerPanel").hidden &&
              document
                .querySelector("#readerMiniViewport")
                .getAttribute("aria-busy") === "false",
          );
          assert.equal(
            await page
              .locator("#musicOpen")
              .evaluate((e) => e.classList.contains("is-playing")),
            true,
            "Music continues while reading in the mini panel",
          );
          await page.locator("#musicOpen").click();
          await page.locator("#musicMiniPlay").click();
          await page.waitForFunction(
            () =>
              !document
                .querySelector("#musicOpen")
                .classList.contains("is-playing"),
          );
          await page.locator("#readerOpen").click();
          await page.waitForFunction(
            () =>
              !document.querySelector("#readerPanel").hidden &&
              document
                .querySelector("#readerMiniViewport")
                .getAttribute("aria-busy") === "false",
          );
        }
        await page.locator("#date-tab-notifications").click();
        assert.equal(await page.locator("#readerPanel").isVisible(), false);
        await page.locator("#readerOpen").click();
        await page.waitForFunction(
          () =>
            !document.querySelector("#readerPanel").hidden &&
            document
              .querySelector("#readerMiniViewport")
              .getAttribute("aria-busy") === "false",
        );
        await page.locator("#readerMiniExpand").click();
        await page.waitForFunction(
          () =>
            document.querySelector("#readerDialog").dataset.state === "open" &&
            document.querySelector("#readerViewport .reader-stage"),
        );
        await page.waitForTimeout(160);
        assert.equal(await page.locator(".reader-stage").count(), 1);
        assert.equal(
          await page.locator("#readerPanel").isVisible(),
          false,
          "Full mode does not leave an empty mini surface behind",
        );
        if (format === "txt") {
          const font = await page
            .locator("#readerViewport iframe")
            .evaluate((e) =>
              parseFloat(
                e.contentWindow.getComputedStyle(e.contentDocument.body)
                  .fontSize,
              ),
            );
          assert.equal(
            font,
            28,
            "Mini overrides do not overwrite full typography",
          );
        }
        await page.evaluate(() => {
          Element.prototype.moveBefore = window.readerMoveNative;
        });
        assert.ok(fullBefore.length);
      }
      // Library commands live in the sidebar; book metadata lives in its menu.
      await page.locator("#readerNewGroup").click();
      await page.locator(".reader-prompt textarea").fill("For later");
      await page.locator('.reader-prompt button[type="submit"]').click();
      const novelCard = page
        .locator(".reader-book")
        .filter({ has: page.locator("h4", { hasText: "Novel" }) });
      await novelCard.locator(".reader-card-more summary").click();
      await novelCard
        .locator('select[aria-label="分组"]')
        .selectOption("For later");
      await novelCard.locator(".reader-heart").click();
      await page.locator('[data-category="favorites"]').click();
      assert.equal(await page.locator(".reader-book").count(), 1);
      await page
        .locator(".reader-group-nav button", { hasText: "For later" })
        .click();
      assert.equal(await page.locator(".reader-book").count(), 1);
      await page
        .locator(".reader-library-sidebar > button", {
          hasText: "删除当前分组",
        })
        .click();
      await page.locator('[data-category="all"]').click();
      await page.locator("#readerBookSearch").fill("Novel");
      assert.equal(await page.locator(".reader-book").count(), 1);
      await page.locator("#readerBookSearch").fill("");
      await page.locator("#readerStats").click();
      assert.equal(
        await page.locator(".reader-standalone-panel").isVisible(),
        true,
      );
      assert.equal(await page.locator(".reader-filters").isVisible(), false);
      await page.locator('[data-category="all"]').click();
      await openBook("Novel");
      await page.waitForSelector("#readerViewport iframe");
      await page.evaluate(async () => {
        for (let n = 0; n < 100; n++) {
          if (
            Object.keys((await WorkTimeApp.services.readerStorage.read()).books)
              .length === 10
          )
            return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw Error("Reading storage did not settle");
      });
      const first = JSON.parse(
        await page.evaluate(async () =>
          JSON.stringify(await WorkTimeApp.services.readerStorage.read()),
        ),
      );
      assert.ok(
        Object.values(first.books).some((b) => b.title === "Novel"),
        JSON.stringify(first),
      );
      await page.locator("#readerNext").click();
      await tool("search");
      await page.locator("#readerFulltextSearch").fill("searchable");
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".reader-search-results .reader-result")
            .length > 1,
      );
      await page
        .locator(".reader-search-results .reader-result")
        .nth(10)
        .click();
      await page.locator(".reader-panel-header button").click();
      await page.locator("#readerViewport iframe").evaluate((frame) => {
        const doc = frame.contentDocument,
          walker = doc.createTreeWalker(
            doc.querySelector("main"),
            NodeFilter.SHOW_TEXT,
          );
        walker.nextNode();
        const text = walker.currentNode;
        const range = doc.createRange();
        range.setStart(text, 0);
        range.setEnd(text, Math.min(10, text.length));
        doc.getSelection().removeAllRanges();
        doc.getSelection().addRange(range);
        doc.dispatchEvent(new Event("pointerup"));
      });
      await page.locator("#readerHighlight").click();
      await page.waitForFunction(() =>
        document
          .querySelector("#readerViewport iframe")
          .contentDocument.querySelector("mark"),
      );
      await tool("settings");
      await page
        .locator('.reader-panel-content input[aria-label="字号"]')
        .fill("28");
      await page
        .locator('.reader-panel-content input[aria-label="字号"]')
        .dispatchEvent("change");
      await page.screenshot({ path: path.join(output, protocol + "-txt.png") });
      await miniRoundTrip("txt");
      await miniRoundTrip("txt", true);
      const beforeCollapse = await page
        .locator(".reader-percent")
        .textContent();
      await page.locator("#readerSidebarToggle").click();
      await page.waitForTimeout(250);
      assert.equal(
        await page.locator(".reader-percent").textContent(),
        beforeCollapse,
        "Collapsing sidebar retains reading progress",
      );
      await page.evaluate(() => WorkTimeApp.ui.reader.close());
      await page.waitForFunction(
        () => document.querySelector("#readerDialog").hidden,
      );
      await page.locator("#readerOpen").click();
      await page.waitForFunction(
        () => document.querySelector("#readerDialog").dataset.state === "open",
      );
      assert.equal(
        await page.locator(".reader-book-title").textContent(),
        "Novel",
      );
      assert.equal(
        await page.locator(".reader-percent").textContent(),
        beforeCollapse,
      );
      assert.equal(
        await page
          .locator("#readerSidebarToggle")
          .getAttribute("aria-expanded"),
        "false",
      );
      await shelf();
      await openBook("Local EPUB");
      await page.waitForFunction(() =>
        document
          .querySelector("#readerViewport iframe")
          ?.contentDocument?.body.textContent.includes("First chapter"),
      );
      await tool("search");
      await page.locator("#readerFulltextSearch").fill("Searchable");
      await page.waitForSelector(".reader-search-results .reader-result");
      assert.equal(await page.evaluate(() => !!window.READER_UNSAFE), false);
      await page.locator(".reader-panel-header button").click();
      // The side panel changes viewport width; let its debounced reflow finish
      // before creating a native iframe text selection.
      await page.waitForTimeout(400);
      await page.locator("#readerViewport iframe").evaluate((frame) => {
        const doc = frame.contentDocument,
          text = doc.querySelector("p").firstChild,
          range = doc.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 10);
        doc.getSelection().removeAllRanges();
        doc.getSelection().addRange(range);
        doc.dispatchEvent(new Event("selectionchange"));
      });
      await page.locator("#readerHighlight").click();
      await tool("notes");
      assert.equal(
        await page.locator(".reader-note").count(),
        1,
        "EPUB CFI annotation saved",
      );
      await miniRoundTrip("epub");
      await shelf();
      await openBook("Fixed sample");
      await tool("settings");
      assert.equal(
        await page
          .locator('.reader-panel-content input[aria-label="字号"]')
          .count(),
        0,
      );
      await miniRoundTrip("fixed");
      await shelf();
      await openBook("Document");
      await page.waitForSelector('.reader-pdf-page[data-ready="true"]');
      assert.ok(await page.locator(".textLayer span").count());
      await page.locator("#readerNext").click();
      await page.waitForFunction(
        () => document.querySelector(".reader-pdf-page")?.dataset.page === "2",
      );
      await tool("search");
      await page.locator("#readerFulltextSearch").fill("Hello");
      await page.waitForSelector(".reader-search-results .reader-result");
      await page
        .locator(".reader-search-results .reader-result")
        .first()
        .click();
      await page.screenshot({ path: path.join(output, protocol + "-pdf.png") });
      await page.locator(".reader-panel-header button").click();
      await page.waitForSelector(
        '.reader-pdf-page[data-ready="true"] .textLayer span',
      );
      await page
        .locator(".textLayer span")
        .first()
        .evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
          element.dispatchEvent(new Event("pointerup", { bubbles: true }));
        });
      await page.locator("#readerHighlight").click();
      await page.waitForSelector(".reader-pdf-mark").catch(async (error) => {
        console.log(
          await page.evaluate(() => ({
            page: document
              .querySelector(".reader-pdf-page")
              ?.outerHTML.slice(0, 1500),
            message: document.querySelector(".reader-status")?.textContent,
            marks: [...document.querySelectorAll(".reader-pdf-mark")].map((e) =>
              e.getAttribute("style"),
            ),
            span: document.querySelector(".textLayer span")?.outerHTML,
            layer: document
              .querySelector(".textLayer")
              ?.outerHTML.slice(0, 800),
            rect: document
              .querySelector(".textLayer span")
              ?.getBoundingClientRect()
              .toJSON(),
          })),
        );
        throw error;
      });
      await tool("settings");
      await page
        .locator(".reader-panel-content button", { hasText: "旋转" })
        .click();
      await page.waitForSelector(
        '.reader-pdf-page[data-ready="true"] .reader-pdf-mark',
      );
      assert.equal(
        await page
          .locator(".reader-pdf-mark")
          .first()
          .evaluate(
            (e) =>
              e.getBoundingClientRect().width > 0 &&
              e.getBoundingClientRect().height > 0,
          ),
        true,
        "PDF highlight survives rotation",
      );
      await miniRoundTrip("pdf");
      await shelf();
      await openBook("Scanned");
      await page.waitForSelector('.reader-pdf-page[data-ready="true"]');
      assert.equal(await page.locator(".textLayer span").count(), 0);
      await shelf();
      await page
        .locator(".reader-book-open")
        .filter({ has: page.locator("h4", { hasText: "Password" }) })
        .click();
      await page.waitForSelector(".reader-prompt[open]");
      await page.locator('.reader-prompt input[type="password"]').fill("wrong");
      await page.locator('.reader-prompt button[type="submit"]').click();
      await page.waitForSelector(".reader-prompt[open]");
      await page
        .locator('.reader-prompt input[type="password"]')
        .fill("secret");
      await page.locator('.reader-prompt button[type="submit"]').click();
      await page.waitForSelector('.reader-pdf-page[data-ready="true"]');
      await shelf();
      await openBook("Chinese");
      await page.waitForSelector('.reader-pdf-page[data-ready="true"]');
      const encoding = await page.evaluate(async () => {
        const lib = WorkTimeApp.services.readerLibrary;
        return [
          lib.decode(new Uint8Array([0xff, 0xfe, 0x2d, 0x4e]).buffer).text,
          lib.decode(new Uint8Array([0xb2, 0xe2, 0xca, 0xd4]).buffer).text,
        ];
      });
      assert.deepEqual(encoding, ["中", "测试"]);
      const backup = await page.evaluate(async () => {
        const s = WorkTimeApp.services.readerStorage;
        return s.backup(await s.read());
      });
      assert.ok(!JSON.stringify(backup).includes('"handle"'));
      assert.ok(!JSON.stringify(backup).includes("secret"));
      const invalid = await page.evaluate(() => {
        try {
          WorkTimeApp.services.readerStorage.validate({ version: 99 });
          return false;
        } catch {
          return true;
        }
      });
      assert.ok(invalid);
      const validation = await page.evaluate((backup) => {
        const storage = WorkTimeApp.services.readerStorage;
        const parsed = storage.validate(backup);
        const original = JSON.stringify(parsed.books);
        const state = storage.defaults();
        storage.merge(state, parsed);
        storage.merge(state, parsed);
        const malicious = storage.cleanSettings({
          foreground: "</style>",
          fontSize: 99999,
          rotation: 42,
          theme: "dark",
        });
        return {
          unchanged: original === JSON.stringify(state.books),
          malicious,
          count: Object.keys(state.books).length,
        };
      }, backup);
      assert.equal(validation.count, 10);
      assert.equal(validation.unchanged, true);
      assert.deepEqual(validation.malicious, { fontSize: 48, theme: "dark" });
      await shelf();
      const exportedEvent = page.waitForEvent("download");
      await page.locator(".reader-backup-menu > summary").click();
      await page.locator("#readerExport").click();
      const exported = await exportedEvent;
      const exportPath = await exported.path();
      const exportedData = JSON.parse(fs.readFileSync(exportPath, "utf8"));
      assert.equal(exportedData.format, "worktime-reader");
      await page
        .locator('#readerDialog > input[type="file"]')
        .nth(1)
        .setInputFiles({
          name: "reading-backup.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(exportedData)),
        });
      await page.waitForFunction(() =>
        document
          .querySelector(".reader-status")
          ?.textContent.includes("已合并"),
      );
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#readerOpen").click();
      await page.waitForFunction(
        () => document.querySelector("#readerDialog")?.dataset.state === "open",
      );
      assert.equal(await page.locator(".reader-book").count(), 10);
      for (const width of [1024, 820]) {
        await page.setViewportSize({ width, height: 740 });
        const layout = await page.locator(".reader-library").evaluate((e) => ({
          sidebar: e.querySelector("aside").getBoundingClientRect().width,
          main: e.querySelector(".reader-library-main").getBoundingClientRect()
            .width,
          overflow: e.scrollWidth > e.clientWidth,
        }));
        assert.equal(layout.sidebar, 170);
        assert.equal(layout.overflow, false);
        assert.ok(layout.main > 300);
      }
      await page.setViewportSize({ width: 1440, height: 540 });
      assert.equal(
        await page
          .locator(".reader-library-sidebar")
          .evaluate((e) => e.scrollHeight >= e.clientHeight),
        true,
      );
      await page.setViewportSize({ width: 1440, height: 960 });
      await page
        .locator('#readerDialog > input[type="file"]')
        .first()
        .setInputFiles(fixtures);
      await page.waitForFunction(
        () => document.querySelector("#readerCancelScan").hidden,
      );
      await openBook("Document");
      await page.waitForSelector(".reader-pdf-mark");
      await shelf();
      for (const [language, title] of [
        ["en", "Reading"],
        ["zh-TW", "閱讀"],
        ["zh-HK", "閱讀"],
        ["ja", "読書"],
        ["ko", "독서"],
        ["zh-CN", "阅读"],
      ]) {
        await page.evaluate(async (language) => {
          await WorkTimeApp.i18n.setLanguage(language);
          WorkTimeApp.ui.reader.refresh();
        }, language);
        assert.equal(await page.locator("#readerTitle").textContent(), title);
      }
      const controls = await page.evaluate(async () => {
        const services = WorkTimeApp.services,
          originalStorage = services.readerStorage,
          originalLibrary = services.readerLibrary;
        const saved = [];
        let permission = "prompt",
          prompts = 0,
          slowScan = false;
        services.readerLibrary = {
          ...originalLibrary,
          scan: async (...args) => {
            if (slowScan)
              await new Promise((resolve) => setTimeout(resolve, 30));
            return originalLibrary.scan(...args);
          },
        };
        services.readerStorage = {
          ...originalStorage,
          read: async () => originalStorage.defaults(),
          write: async (value) => saved.push(value),
        };
        const file = new File(["stable book content"], "Initial.txt");
        const handle = {
          name: "Books",
          queryPermission: async () => permission,
          requestPermission: async () => {
            prompts++;
            permission = "granted";
            return permission;
          },
          async *values() {
            yield { kind: "file", name: file.name, getFile: async () => file };
          },
        };
        const picker = window.showDirectoryPicker;
        window.showDirectoryPicker = async () => handle;
        const controller = WorkTimeApp.ui.createReaderController();
        const wait = async () => {
          for (let n = 0; n < 200; n++) {
            if (!controller.snapshot().scanning) return;
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          throw Error("Scan stalled");
        };
        try {
          await controller.ready;
          const initialPrompts = prompts;
          await controller.choose();
          await wait();
          await controller.reconnect();
          await wait();
          const reconnectPrompts = prompts;
          const id = [...controller.snapshot().entries.keys()][0];
          controller.updateBook(id, { favorite: true });
          controller.importFiles([
            new File(["stable book content"], "Renamed.txt"),
          ]);
          await wait();
          await new Promise((resolve) => setTimeout(resolve, 20));
          await wait();
          const renamed =
            controller.snapshot().entries.get(id)?.path === "Renamed.txt" &&
            controller.snapshot().state.books[id].favorite;
          await controller.reconnect(); // fallback selection intentionally clears the old handle
          window.showDirectoryPicker = async () => {
            throw new DOMException("Cancelled", "AbortError");
          };
          await controller.choose();
          const cancelledKept = controller.snapshot().entries.has(id);
          slowScan = true;
          controller.importFiles([new File(["new content"], "Other.txt")]);
          await new Promise((resolve) => setTimeout(resolve, 5));
          controller.cancelScan();
          await new Promise((resolve) => setTimeout(resolve, 50));
          const scanCancelledKept =
            controller.snapshot().entries.has(id) &&
            controller.snapshot().entries.size === 1;
          services.readerLibrary = {
            ...originalLibrary,
            scan: async () => {
              await new Promise((resolve) => setTimeout(resolve, 20));
              throw new DOMException("Revoked", "NotAllowedError");
            },
          };
          const denied = WorkTimeApp.ui.createReaderController();
          await denied.ready;
          window.showDirectoryPicker = async () => handle;
          await denied.choose();
          await new Promise((resolve) => setTimeout(resolve, 40));
          const deniedMessage = denied.snapshot().message;
          denied.dispose();
          return {
            renamed,
            initialPrompts,
            cancelledKept,
            reconnectPrompts,
            scanCancelledKept,
            deniedMessage,
            writes: saved.length,
          };
        } finally {
          controller.dispose();
          services.readerStorage = originalStorage;
          services.readerLibrary = originalLibrary;
          window.showDirectoryPicker = picker;
        }
      });
      assert.equal(controls.renamed, true);
      assert.equal(controls.initialPrompts, 0);
      assert.equal(controls.cancelledKept, true);
      assert.equal(controls.reconnectPrompts, 1);
      assert.equal(controls.scanCancelledKept, true);
      assert.equal(controls.deniedMessage, "accessHint");
      assert.ok(controls.writes);
      const activityCounts = await page.evaluate(async () => {
        const services = WorkTimeApp.services,
          originalStorage = services.readerStorage,
          originalLibrary = services.readerLibrary,
          originalAdapters = services.readerAdapters;
        const interval = window.setInterval,
          now = Date.now,
          hidden = Object.getOwnPropertyDescriptor(document, "hidden");
        let tick,
          clock = now(),
          invisible = false,
          c;
        try {
          services.readerStorage = {
            ...originalStorage,
            read: async () => originalStorage.defaults(),
            write: async () => {},
          };
          services.readerAdapters = {
            ...originalAdapters,
            create: async (format, options) => {
              options.changed({ location: { offset: 0 }, progress: 0 });
              return {
                position: () => ({ offset: 0 }),
                settings: async () => {},
                annotations: async () => {},
                destroy: async () => {},
              };
            },
          };
          window.setInterval = (fn) => {
            tick = fn;
            return -10000;
          };
          c = WorkTimeApp.ui.createReaderController();
          window.setInterval = interval;
          Date.now = () => clock;
          Object.defineProperty(document, "hidden", {
            configurable: true,
            get: () => invisible,
          });
          await c.ready;
          c.importFiles([new File(["reading clock"], "Clock.txt")]);
          for (let n = 0; n < 100 && !c.snapshot().entries.size; n++)
            await new Promise((resolve) => setTimeout(resolve, 5));
          await c.open(
            [...c.snapshot().entries.keys()][0],
            document.createElement("div"),
            async () => null,
          );
          const total = () =>
              Object.values(c.snapshot().state.daily).reduce(
                (a, b) => a + b,
                0,
              ),
            result = [];
          c.setActive(true);
          tick();
          result.push(total());
          clock += 61000;
          tick();
          result.push(total());
          c.setActive(true);
          tick();
          result.push(total());
          c.activity();
          tick();
          result.push(total());
          c.setActive(false);
          tick();
          result.push(total());
          c.setActive(true);
          invisible = true;
          tick();
          result.push(total());
          return result;
        } finally {
          c?.dispose();
          window.setInterval = interval;
          Date.now = now;
          if (hidden) Object.defineProperty(document, "hidden", hidden);
          else delete document.hidden;
          services.readerStorage = originalStorage;
          services.readerLibrary = originalLibrary;
          services.readerAdapters = originalAdapters;
        }
      });
      assert.deepEqual(
        activityCounts,
        [5, 5, 5, 10, 10, 10],
        "Reading clock stops when idle, covered, inactive or hidden",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator("#readerSidebarToggle").click();
      assert.equal(
        await page.locator(".reader-library-main").evaluate((e) => e.inert),
        true,
      );
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() =>
          document
            .querySelector(".reader-library-sidebar")
            .contains(document.activeElement),
        ),
        true,
      );
      await page.locator('[data-category="all"]').click();
      assert.equal(
        await page
          .locator("#readerSidebarToggle")
          .getAttribute("aria-expanded"),
        "false",
      );
      await page.screenshot({
        path: path.join(output, protocol + "-mobile.png"),
      });
      assert.equal(
        await page
          .locator("#readerDialog")
          .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        true,
      );
      await openBook("Novel");
      await tool("settings");
      await page.screenshot({
        path: path.join(output, protocol + "-mobile-reading.png"),
      });
      assert.equal(
        await page
          .locator("#readerDialog")
          .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        true,
      );
      await page.locator(".reader-panel-header button").click();
      await page.waitForTimeout(250);
      await page.screenshot({
        path: path.join(output, protocol + "-mobile-text.png"),
      });
      await page.locator("#readerViewport").focus();
      await page.keyboard.press("ArrowRight");
      await page.locator("#readerMinimize").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#readerDialog").hidden &&
          !document.querySelector("#readerPanel").hidden &&
          document
            .querySelector("#readerMiniViewport")
            .getAttribute("aria-busy") === "false",
      );
      await page.evaluate(async () => {
        for (let n = 0; n < 100; n++) {
          if (
            (await WorkTimeApp.services.readerStorage.readPresentation()) ===
            "mini"
          )
            return;
          await new Promise((r) => setTimeout(r, 10));
        }
        throw Error("Mini preference not saved");
      });
      await page.screenshot({
        path: path.join(output, protocol + "-mobile-mini.png"),
      });
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.locator("#readerOpen").click();
      await page.waitForSelector(".reader-mini-empty");
      assert.equal(await page.locator("#readerDialog").isVisible(), false);
      assert.equal(await page.locator("#readerMiniNext").isDisabled(), true);
      assert.equal(
        await page.locator("#readerMiniViewport .reader-stage").count(),
        0,
        "Reload never reads book files automatically",
      );
      await page.locator("#readerMiniExpand").click();
      await page.waitForFunction(
        () => document.querySelector("#readerDialog").dataset.state === "open",
      );
      await page
        .locator('#readerDialog > input[type="file"]')
        .first()
        .setInputFiles(fixtures);
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".reader-book").length === 10 &&
          document.querySelector("#readerCancelScan").hidden,
      );
      await openBook("Novel");
      await shelf();
      await page
        .locator(".reader-book-open")
        .filter({ has: page.locator("h4", { hasText: "Broken" }) })
        .click();
      await page.waitForFunction(() =>
        document
          .querySelector(".reader-status")
          ?.textContent.includes("无法打开"),
      );
      assert.equal(
        await page.locator(".reader-book").count(),
        10,
        "A broken book does not discard the library",
      );
      await page.locator("#readerExit").click();
      await page.waitForFunction(
        () => document.querySelector("#readerDialog").hidden,
      );
      assert.equal(
        await page
          .locator("#readerOpen")
          .evaluate((e) => e === document.activeElement),
        true,
      );
      assert.deepEqual(
        remote,
        [],
        "Book resources never load from the network",
      );
      assert.deepEqual(errors, [], "No uncaught browser errors");
      console.log(
        protocol +
          ": reader source, TXT, EPUB, fixed EPUB, text/scanned/password/CJK PDF, notes, search, persistence and narrow layout verified",
      );
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const zlib = require("node:zlib");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

// Decode browser screenshots without adding an image-library dependency.
function pixels(png) {
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  assert.equal(png[24], 8);
  assert.ok([2, 6].includes(png[25]));
  const channels = png[25] === 6 ? 4 : 3,
    chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks)),
    stride = width * channels,
    data = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c,
      x = Math.abs(p - a),
      y = Math.abs(p - b),
      z = Math.abs(p - c);
    return x <= y && x <= z ? a : y <= z ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x,
        a = x >= channels ? data[i - channels] : 0,
        b = y ? data[i - stride] : 0,
        c = y && x >= channels ? data[i - stride - channels] : 0;
      const prediction =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? Math.floor((a + b) / 2)
                : paeth(a, b, c);
      data[i] = (raw[y * (stride + 1) + 1 + x] + prediction) & 255;
    }
  }
  return (x, y) => [
    ...data.subarray(
      Math.floor(y) * stride + Math.floor(x) * channels,
      Math.floor(y) * stride + Math.floor(x) * channels + 3,
    ),
  ];
}

async function verify() {
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    fs.mkdirSync(path.resolve("artifacts"), { recursive: true });
    for (const [width, scale, zoom] of [
      [1920, 1, 1],
      [2560, 1, 1],
      [1920, 1.25, 1],
      [1920, 1.5, 1],
      [1920, 2, 1],
      [1920, 1, 1.25],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 1200 },
        deviceScaleFactor: scale,
        locale: "zh-CN",
        reducedMotion: "reduce",
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto(
        pathToFileURL(path.resolve(process.argv[2] || ".", "index.html")).href,
      );
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.appState === "ready" &&
          !document.documentElement.classList.contains("app-loading"),
      );
      await page.locator("#agendaMode").click();
      await page.locator("#agendaNew").click();
      await page.locator("#agendaTitle").fill("跨日日程边框检查");
      await page.locator("#agendaScheduleOpen").click();
      await page.locator("#agendaDateInput").fill("2026-10-14");
      await page.locator("#agendaMultiDay").check();
      await page.locator("#agendaEndDateInput").fill("2026-10-17");
      await page.locator("[data-schedule-close]").click();
      await page.locator("#agendaSave").click();
      await page.locator("#agendaForm").waitFor({ state: "hidden" });
      await page.evaluate((zoom) => {
        document.body.style.zoom = String(zoom);
      }, zoom);
      await page.addStyleTag({
        content:
          ".workspace { --theme-edge: #1964bf; --accent: #1964bf; } #calendar { background: white; } #calendar .day { transition: none !important; }",
      });
      for (const view of ["month", "week", "fortnight"]) {
        if (view !== "month") await page.locator("#agendaViewToggle").click();
        for (const day of [15, 16, 14]) {
          await page
            .locator(`#calendar .day[data-date="2026-10-${day}"] .day-select`)
            .click({ position: { x: 10, y: 10 } });
          await page.evaluate(async () => {
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          });
          const geometry = await page.evaluate(() => {
            const card = document.querySelector("#calendar .day.selected"),
              box = card.getBoundingClientRect();
            const chip = [
              ...document.querySelectorAll(".agenda-week-lane .agenda-chip"),
            ]
              .find(
                (node) =>
                  node.dataset.agendaSegmentStart <= card.dataset.date &&
                  node.dataset.agendaSegmentEnd >= card.dataset.date,
              )
              .getBoundingClientRect();
            const left = card.previousElementSibling?.getBoundingClientRect(),
              right = card.nextElementSibling?.getBoundingClientRect();
            return {
              box: box.toJSON(),
              border:
                parseFloat(getComputedStyle(card).borderLeftWidth) *
                Number(document.body.style.zoom || 1),
              chip: chip.toJSON(),
              gaps: [
                left && (left.right + box.left) / 2,
                right && (box.right + right.left) / 2,
              ].filter((x) => x > chip.left && x < chip.right),
            };
          });
          const png = await page.screenshot(),
            pixel = pixels(png);
          const unselected = await page.evaluate(() => {
            const chip = document.querySelector(
              '.agenda-chip[data-agenda-segment-start="2026-10-14"]',
            );
            const strip = chip.getBoundingClientRect();
            return [
              ...document.querySelectorAll("#calendar .day:not(.selected)"),
            ]
              .filter(
                (card) =>
                  card.dataset.date >= "2026-10-14" &&
                  card.dataset.date <= "2026-10-17",
              )
              .map((card) => ({
                box: card.getBoundingClientRect().toJSON(),
                border:
                  parseFloat(getComputedStyle(card).borderLeftWidth) *
                  Number(document.body.style.zoom || 1),
                strip: strip.toJSON(),
              }));
          });
          for (const { box, strip, border } of unselected) {
            for (const [start, end] of [
              [box.left, box.left + border],
              [box.right - border, box.right],
            ]) {
              if (start <= strip.left || end >= strip.right) continue;
              for (
                let x = Math.ceil(start * scale);
                x < Math.floor(end * scale);
                x++
              ) {
                for (
                  let y = Math.floor(strip.top * scale);
                  y < Math.ceil(strip.bottom * scale);
                  y++
                ) {
                  const actual = pixel(x, y),
                    expected = pixel(x, (strip.top - 4 * zoom) * scale);
                  if (
                    !actual.every(
                      (value, index) => Math.abs(value - expected[index]) <= 8,
                    )
                  ) {
                    fs.writeFileSync(
                      "artifacts/agenda-unselected-border-failure.png",
                      png,
                    );
                    assert.fail(
                      `Unselected border: width ${width} scale ${scale} zoom ${zoom} ${view} day ${day} pixel ${x},${y}: ${actual} != ${expected}`,
                    );
                  }
                }
              }
            }
          }
          for (const [start, end] of [
            [geometry.box.left, geometry.box.left + geometry.border + zoom],
            [geometry.box.right - geometry.border - zoom, geometry.box.right],
          ]) {
            for (
              let x = Math.ceil(start * scale);
              x < Math.floor(end * scale);
              x++
            ) {
              for (
                let y = Math.floor(geometry.chip.top * scale);
                y < Math.ceil(geometry.chip.bottom * scale);
                y++
              ) {
                const actual = pixel(x, y),
                  expected = pixel(x, (geometry.box.top + 25) * scale);
                if (
                  !actual.every(
                    (value, index) => Math.abs(value - expected[index]) <= 8,
                  )
                ) {
                  fs.writeFileSync("artifacts/agenda-border-failure.png", png);
                  console.log(
                    geometry,
                    await page.locator(".agenda-chip").evaluateAll((nodes) =>
                      nodes
                        .filter((node) => !node.hidden)
                        .map((node) => ({
                          rect: node.getBoundingClientRect().toJSON(),
                          slices: node.querySelectorAll(".agenda-slice").length,
                        })),
                    ),
                  );
                  assert.fail(
                    `Full border band: width ${width} scale ${scale} zoom ${zoom} ${view} day ${day} pixel ${x},${y}: ${actual} != ${expected}`,
                  );
                }
              }
            }
          }
          for (const x of [geometry.box.left + 0.8, geometry.box.right - 0.8]) {
            const reference = pixel(x * scale, (geometry.box.top + 25) * scale);
            for (const y of [
              geometry.chip.top + 1,
              (geometry.chip.top + geometry.chip.bottom) / 2,
              geometry.chip.bottom - 1,
            ]) {
              const actual = pixel(x * scale, y * scale);
              assert.ok(
                actual.every(
                  (value, index) => Math.abs(value - reference[index]) <= 8,
                ),
                `Unbroken selected outline: scale ${scale} ${view} day ${day}`,
              );
            }
          }
          for (const x of geometry.gaps) {
            const middle = (geometry.chip.top + geometry.chip.bottom) / 2;
            const connectorFill = pixel(x * scale, middle * scale);
            const stripFill = pixel(
              (geometry.chip.right - 30 * zoom) * scale,
              middle * scale,
            );
            assert.ok(
              connectorFill.every(
                (value, index) => Math.abs(value - stripFill[index]) <= 3,
              ),
              `Connector matches ribbon fill without a pale seam: ${width} ${scale} ${zoom} ${view}`,
            );
            const actual = pixel(
              x * scale,
              Math.ceil(geometry.chip.top * scale),
            );
            assert.ok(
              actual.some((value) => value < 250) &&
                actual.every((value) => value >= 190),
              `Connected ribbon between date outlines: scale ${scale} ${view} day ${day}`,
            );
          }
          if (width === 2560 && scale === 1 && zoom === 1 && view === "month")
            fs.writeFileSync(
              path.resolve(`artifacts/agenda-border-fixed-${day}.png`),
              png,
            );
        }
        const selectedStrip = page
          .locator(".agenda-week-lane .agenda-chip")
          .first();
        await selectedStrip.click({ position: { x: 12, y: 8 } });
        const selectedGeometry = await selectedStrip.evaluate((node) => ({
          box: node.getBoundingClientRect().toJSON(),
          selected: node.classList.contains("is-selected"),
          title: getComputedStyle(
            node.querySelector(":scope > .agenda-chip-title"),
          ).visibility,
          slicesHidden: [
            ...node.querySelectorAll(":scope > .agenda-slice"),
          ].every((slice) => getComputedStyle(slice).display === "none"),
        }));
        assert.ok(selectedGeometry.selected && selectedGeometry.slicesHidden);
        assert.equal(selectedGeometry.title, "visible");
        const selectedPng = await page.screenshot(),
          selectedPixel = pixels(selectedPng);
        const box = selectedGeometry.box;
        // Both selected horizontal strokes must cross all date boundaries
        // without holes, including the gutters and the date borders themselves.
        for (const y of [box.top + 1.3 * zoom, box.bottom - 1.3 * zoom]) {
          const reference = selectedPixel(
            (box.left + 6 * zoom) * scale,
            y * scale,
          );
          for (
            let x = Math.ceil((box.left + 6 * zoom) * scale);
            x < Math.floor((box.right - 6 * zoom) * scale);
            x++
          ) {
            const actual = selectedPixel(x, y * scale);
            assert.ok(
              actual.every(
                (value, index) => Math.abs(value - reference[index]) <= 8,
              ),
              `Continuous selected ribbon: ${width} ${scale} ${zoom} ${view} pixel ${x},${y}`,
            );
          }
        }
        if (width === 2560 && scale === 1 && zoom === 1 && view === "month")
          fs.writeFileSync(
            "artifacts/agenda-selected-continuous.png",
            selectedPng,
          );
        await page.locator("#agendaCancel").click();
      }
      if (width === 1920 && scale === 1 && zoom === 1) {
        const strip = page.locator(".agenda-week-lane .agenda-chip").first();
        const painted = await strip.evaluate((node) => ({
          mask: getComputedStyle(node).maskImage,
          faces: [
            ...node.querySelectorAll(
              ".agenda-slice:not(.agenda-bridge) .agenda-chip-face",
            ),
          ].map((face) => getComputedStyle(face).backgroundColor),
        }));
        assert.equal(painted.mask, "none");
        assert.equal(painted.faces.length, 4);
        assert.ok(painted.faces.every((color) => color !== "rgba(0, 0, 0, 0)"));
        await strip.click({ position: { x: 12, y: 8 } });
        await page.locator("#agendaForm").waitFor({ state: "visible" });
        assert.equal(
          await page.locator("#agendaDateInput").inputValue(),
          "2026-10-14",
        );
        await page.locator("#agendaCancel").click();
        const handle = await strip
          .locator(":scope > .agenda-resize-handle")
          .boundingBox();
        const target = await page
          .locator('#calendar .day[data-date="2026-10-18"]')
          .boundingBox();
        await page.mouse.move(
          handle.x + handle.width / 2,
          handle.y + handle.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(target.x + target.width / 2, target.y + 15, {
          steps: 12,
        });
        assert.equal(
          await page.locator(".agenda-resize-preview .agenda-slice").count(),
          0,
        );
        assert.equal(
          await page
            .locator(".agenda-resize-segment")
            .first()
            .evaluate((node) => getComputedStyle(node).maskImage),
          "none",
        );
        assert.ok(
          await page
            .locator(
              ".agenda-resize-segment :is(.agenda-chip-title-text, .agenda-chip-time, .agenda-chip-note)",
            )
            .evaluateAll((nodes) =>
              nodes.every(
                (node) => getComputedStyle(node).maskImage === "none",
              ),
            ),
        );
        await page.screenshot({
          path: path.resolve("artifacts/agenda-resize-continuous.png"),
        });
        await page.mouse.up();
        await page.waitForFunction(
          () =>
            document.querySelector("#agendaEndDateInput").value ===
            "2026-10-18",
        );
        await page.locator("#agendaCancel").click();
        const source = await strip.boundingBox();
        const destination = await page
          .locator('#calendar .day[data-date="2026-10-15"]')
          .boundingBox();
        await page.mouse.move(source.x + 12, source.y + 8);
        await page.mouse.down();
        await page.mouse.move(
          destination.x + destination.width / 2,
          destination.y + 15,
          { steps: 12 },
        );
        const ghost = page.locator(".agenda-drag-preview").first();
        assert.equal(await ghost.locator(".agenda-slice").count(), 0);
        assert.ok(
          await ghost
            .locator(
              ":is(.agenda-chip-title-text, .agenda-chip-time, .agenda-chip-note)",
            )
            .evaluateAll((nodes) =>
              nodes.every(
                (node) => getComputedStyle(node).maskImage === "none",
              ),
            ),
        );
        assert.equal(
          await ghost.evaluate((node) => getComputedStyle(node).maskImage),
          "none",
        );
        await page.screenshot({
          path: path.resolve("artifacts/agenda-drag-continuous.png"),
        });
        await page.mouse.up();
        await page.waitForFunction(
          () =>
            document.querySelector("#agendaDateInput").value === "2026-10-15",
        );
        assert.equal(
          await page.locator("#agendaEndDateInput").inputValue(),
          "2026-10-19",
        );
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(
      "Cross-day outlines, matching gutter fills and continuous drag/resize previews verified across 1920/2560px widths, 100%/125%/150%/200% display scales, 125% layout zoom, and month/week/fortnight views.",
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";
require("../lib/browser-test-setup.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const {
  runtimeServer,
  installRuntimeFixture,
} = require("../runtime-test-helpers.cjs");
const root = path.resolve(__dirname, "../..");
async function main() {
  const site = path.resolve(
    process.argv.find((arg, index) => index > 1 && !arg.startsWith("--")) ||
      root,
  );
  const server = process.argv.includes("--http")
    ? await runtimeServer(site)
    : null;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await context.addInitScript(() =>
      localStorage.setItem(
        "worktime.vocabulary.audio-settings",
        JSON.stringify({ enabled: false }),
      ),
    );
    if (process.argv.includes("--with-folder"))
      await context.addInitScript(installRuntimeFixture);
    const external = [],
      errors = [];
    await context.route(/^https?:\/\//, (route) => {
      if (new URL(route.request().url()).hostname === "127.0.0.1")
        return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error")
        console.error(message.text().slice(0, 300));
    });
    await page.goto(
      server?.url || pathToFileURL(path.join(site, "index.html")).href,
    );
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    if (process.argv.includes("--with-folder"))
      await page.waitForFunction(
        () => WorkTimeApp.services.runtimeFolder.state.status === "available",
      );
    await page.locator("#date-tab-tools").click();
    await page.locator("#vocabularyOpen").click();
    await page.locator(".vocabulary-card").waitFor();
    const packagePath = process.argv
      .find((arg) => arg.startsWith("--package="))
      ?.slice(10);
    if (packagePath) {
      const chooser = page.waitForEvent("filechooser");
      await page.locator('[data-page="preferences"]').click();
      await page
        .getByRole("button", { name: "导入离线模型包", exact: true })
        .click();
      await (await chooser).setFiles(path.resolve(packagePath));
      await page.waitForFunction(
        () => WorkTimeApp.services.vocabularyModels.state.phase === "installed",
        null,
        { timeout: 120000 },
      );
      await page.locator('[data-page="learning"]').click();
    }
    assert.equal(
      await page.locator(".vocabulary-pronunciation-play span").innerText(),
      "美",
    );
    await page.locator('[data-page="preferences"]').click();
    assert.equal(
      await page
        .getByRole("combobox", { name: "发音模型", exact: true })
        .count(),
      0,
    );
    assert.equal(await page.locator("[data-voice-accent]").count(), 0);
    assert.deepEqual(
      await page.evaluate(() => [
        WorkTimeApp.services.vocabularyIdle.profile("us"),
        WorkTimeApp.services.vocabularyIdle.profile("uk"),
      ]),
      [
        { engine: "supertonic", voice: "F1", speed: 1.05, steps: 16 },
        {
          voice: "en_GB-jenny_dioco-medium",
          speed: 1,
          speaker: 0,
          noiseScale: 0.5,
          noiseW: 0.333,
        },
      ],
    );
    const output = path.join(root, ".cache/speech-previews");
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({
      path: path.join(output, "fixed-speech-settings.png"),
    });
    if (!process.argv.includes("--ui-only")) {
      await page.evaluate(() => {
        WorkTimeApp.services.vocabularyIdle.configure({ enabled: false });
        const NativeWorker = window.Worker;
        window.speechWorkers = 0;
        window.Worker = class extends NativeWorker {
          constructor(...args) {
            super(...args);
            window.latestSpeechWorker = this;
            window.speechWorkers++;
          }
        };
      });
      const voices = ["F1", "en_GB-jenny_dioco-medium"];
      for (const voice of voices) {
        for (const word of ["government", "voice", "car", "hard", "teacher"]) {
          const result = await page.evaluate(
            async ({ voice, word }) => {
              const speech = WorkTimeApp.services.vocabularySpeech,
                accent = voice === "F1" ? "us" : "uk",
                start = performance.now();
              const blob = await speech.synthesize({ word }, accent),
                buffer = await blob.arrayBuffer(),
                view = new DataView(buffer);
              let energy = 0;
              for (let i = 44; i < buffer.byteLength; i += 2)
                energy += Math.abs(view.getInt16(i, true));
              const cached = await speech.synthesize({ word }, accent);
              return {
                bytes: [...new Uint8Array(buffer)],
                sampleRate: view.getUint32(24, true),
                energy,
                elapsedMs: Math.round(performance.now() - start),
                cached: cached.size,
              };
            },
            { voice, word },
          );
          const bytes = Buffer.from(result.bytes);
          assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
          assert.equal(result.sampleRate, voice === "F1" ? 44100 : 22050);
          assert(result.energy > 0);
          assert.equal(result.cached, bytes.length);
          fs.writeFileSync(
            path.join(output, voice + "-" + word + ".wav"),
            bytes,
          );
          console.log(voice, word, bytes.length, result.elapsedMs + "ms");
        }
      }
      assert.equal(
        await page.evaluate(() => window.speechWorkers),
        2,
        "Accent changes load the corresponding engine",
      );
    }
    await page.evaluate(() =>
      localStorage.setItem(
        "worktime.vocabulary.audio-settings",
        JSON.stringify({
          ...WorkTimeApp.services.vocabularyIdle.settings,
          models: { us: "piper", uk: "aru" },
          voices: { us: "F3", uk: "M2" },
        }),
      ),
    );
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.locator("#date-tab-tools").click();
    await page.locator("#vocabularyOpen").click();
    await page.locator(".vocabulary-card").waitFor();
    await page.locator('[data-page="preferences"]').click();
    assert.deepEqual(
      await page.evaluate(() => [
        WorkTimeApp.services.vocabularyIdle.profile("us").voice,
        WorkTimeApp.services.vocabularyIdle.profile("uk").voice,
      ]),
      ["F1", "en_GB-jenny_dioco-medium"],
    );
    assert.equal(await page.locator("[data-voice-accent]").count(), 0);
    const preferences = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("worktime.vocabulary.audio-settings")),
    );
    assert.equal(preferences.models, undefined);
    assert.equal(preferences.voices, undefined);
    await page.getByRole("switch", { name: /^口音/ }).click();
    await page.waitForFunction(
      () =>
        WorkTimeApp.services.vocabularyStorage.read().settings.accent === "uk",
    );
    await page.locator('[data-page="learning"]').click();
    assert.equal(
      await page.locator(".vocabulary-pronunciation-play span").innerText(),
      "英",
    );
    if (process.argv.includes("--background")) {
      await page.evaluate(() => WorkTimeApp.services.vocabularySpeech.clear());
      await page.evaluate(() => {
        const all = WorkTimeApp.data.vocabularyCatalog.entries;
        WorkTimeApp.data.vocabularyCatalog.entries = all
          .filter((entry) => ["government", "water"].includes(entry.word))
          .map((entry) => ({
            ...entry,
            books: [
              WorkTimeApp.services.vocabularyStorage.read().settings.book,
            ],
            examples: [
              {
                en:
                  entry.word === "water"
                    ? "We drink clean water."
                    : "The government supports local schools.",
              },
            ],
          }));
        WorkTimeApp.services.vocabularyIdle.configure({
          enabled: true,
          paused: false,
        });
        // Keep browsing throughout the real background job.
        window.browsingTimer = setInterval(() => {
          window.dispatchEvent(
            new PointerEvent("pointermove", { clientX: 50, clientY: 50 }),
          );
          window.dispatchEvent(new Event("click"));
          window.dispatchEvent(new Event("scroll"));
        }, 200);
      });
      await page.waitForFunction(
        () => WorkTimeApp.services.vocabularyIdle.state.status === "complete",
        null,
        { timeout: 120000 },
      );
      const summary = await page.evaluate(async () => ({
        state: WorkTimeApp.services.vocabularyIdle.state,
        info: await WorkTimeApp.services.vocabularyAudioCache.info(),
        names: await WorkTimeApp.services.runtimeFolder.withEnglish(
          async (root) => {
            const names = [];
            for await (const name of root.keys()) names.push(name);
            return names;
          },
        ),
      }));
      await page.evaluate(() => clearInterval(window.browsingTimer));
      assert.equal(summary.state.completed, 8);
      assert.equal(summary.state.generatedTotal, 8);
      assert.equal(summary.state.audioTotal, 8);
      assert.equal(summary.info.count, 4);
      assert(
        summary.names.includes("audio") &&
          summary.names.includes("resources-piper"),
      );
      console.log(
        "Real idle synthesis cached words and examples in both accents, with unique-audio progress.",
      );
      const exampleAudio = await page.evaluate(async () => {
        const S = WorkTimeApp.services;
        const entry = { word: "We drink clean water." };
        const us = await S.vocabularyAudioCache.read(entry, "us");
        const uk = await S.vocabularyAudioCache.read(entry, "uk");
        const original = Worker.prototype.postMessage;
        let generations = 0;
        Worker.prototype.postMessage = function (message, ...args) {
          if (message.type === "generate") generations++;
          return original.call(this, message, ...args);
        };
        try {
          const played = await S.vocabularySpeech.play(entry, "uk");
          S.vocabularySpeech.stop();
          return {
            us: new DataView(await us.arrayBuffer()).getUint32(24, true),
            uk: new DataView(await uk.arrayBuffer()).getUint32(24, true),
            played,
            generations,
          };
        } finally {
          Worker.prototype.postMessage = original;
        }
      });
      assert.deepEqual(
        exampleAudio,
        { us: 44100, uk: 22050, played: true, generations: 0 },
        "Idle examples produce real WAV audio in both voices and manual playback reuses it",
      );
      await page.evaluate(async () => {
        const data = structuredClone(
          WorkTimeApp.services.vocabularyStorage.read(),
        );
        data.settings.accent = "us";
        await WorkTimeApp.services.vocabularyStorage.save(data);
        WorkTimeApp.services.vocabularyIdle.configure({
          enabled: true,
          paused: false,
        });
      });
      await page.waitForFunction(
        () => WorkTimeApp.services.vocabularyIdle.state.status === "complete",
        null,
        { timeout: 180000 },
      );
      const supertonicCache = await page.evaluate(async () => {
        const cache = WorkTimeApp.services.vocabularyAudioCache;
        const blob = await cache.read({ word: "water" }, "us");
        const resources = await WorkTimeApp.services.runtimeFolder.withEnglish(
          async (root) =>
            !!(await root.getDirectoryHandle("resources-supertonic-3")),
        );
        return {
          info: await cache.info(),
          sampleRate: new DataView(await blob.arrayBuffer()).getUint32(
            24,
            true,
          ),
          resources,
        };
      });
      assert.equal(supertonicCache.info.count, 4);
      assert.equal(supertonicCache.sampleRate, 44100);
      assert(supertonicCache.resources);
      console.log(
        "Real idle Supertonic US generation and separate resource directory verified.",
      );
    }
    assert.equal(
      external.filter((url) => /huggingface|jsdelivr/.test(url)).length,
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Fixed Supertonic F1 / Jenny Dioco, removed selectors, ignored legacy choices, offline synthesis and cache isolation verified.",
    );
  } finally {
    await browser.close();
    await server?.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

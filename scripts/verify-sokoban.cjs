"use strict";
const { launchGame } = require("./game-test-helpers.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const entry = path.resolve(
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) || root,
  "index.html",
);
const output = path.join(root, "test-results/sokoban");
const key = "worktime.games.sokoban.v1";
const context = vm.createContext({ WorkTimeApp: { games: {}, data: {} } });
for (const file of [
  "assets/data/sokoban.js",
  "assets/js/games/sokoban-rules.js",
])
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
const bank = context.WorkTimeApp.data.sokoban;
const {
  originals: readOriginals,
  signature,
  assess,
} = require("./sokoban-bank.cjs");
const rules = context.WorkTimeApp.games.sokobanRules;
function verifyRules() {
  const source = fs.readFileSync(
    path.join(root, "assets/data/sources/microban.txt"),
    "utf8",
  );
  assert.equal(
    crypto.createHash("sha256").update(source).digest("hex"),
    bank.sha256,
  );
  const sourceMaps = new Map();
  const historicalSolutions = JSON.parse(
    fs.readFileSync(
      path.join(root, "assets/data/sources/sasquatch-solutions.json"),
      "utf8",
    ),
  ).ByPuzzles;
  for (const entry of [...bank.sources, bank.solutionSource]) {
    const text = fs.readFileSync(
      path.join(root, "assets/data/sources", entry.file),
      "utf8",
    );
    assert.equal(
      crypto.createHash("sha256").update(text).digest("hex"),
      entry.sha256,
    );
    if (entry.id) sourceMaps.set(entry.id, readOriginals(text));
  }
  const selection = require("./sokoban-selection.json");
  const lookup = new Map(bank.levels.map((level) => [level.id, level]));
  assert.equal(bank.levels.length, 140);
  assert.equal(lookup.size, 140);
  assert.equal(
    new Set(bank.levels.map((level) => signature(level.rows))).size,
    140,
  );
  const legacyIds = new Set(selection.previousOrder.slice(0, 60));
  const legacy = selection.previousOrder.slice(0, 60).map((id) => {
    const { source, difficulty, difficultyScore, difficultyMetrics, ...level } =
      lookup.get(id);
    return level;
  });
  assert.equal(
    crypto.createHash("sha256").update(JSON.stringify(legacy)).digest("hex"),
    selection.legacySha256,
    "Original 60 levels keep their geometry, solutions and optimal push counts",
  );
  for (const { id, sha256 } of selection.previousLevels) {
    const level = lookup.get(id);
    assert.ok(level);
    assert.equal(
      crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            rows: level.rows,
            solution: level.solution,
            minPushes: level.minPushes,
          }),
        )
        .digest("hex"),
      sha256,
      "All previous 100 levels remain compatible",
    );
  }
  assert.deepEqual(
    Array.from(bank.chapters, (entry) => entry.skin),
    ["forest", "desert", "greenhouse", "glacier", "space", "forge", "palace"],
  );
  assert.deepEqual(
    Array.from(bank.chapters, (entry) => Array.from(entry.ratingRange)),
    [
      [1, 2.5],
      [3, 4.5],
      [5, 6.5],
      [7, 7.5],
      [8, 8.5],
      [9, 9.5],
      [10, 10],
    ],
  );
  for (const chapter of bank.chapters) {
    const entries = bank.levels.slice(
      chapter.start,
      chapter.start + chapter.count,
    );
    assert.equal(entries.length, 20);
    assert.ok(entries.every((level) => level.difficulty === chapter.id));
  }
  bank.levels.forEach((level, index) => {
    assert.deepEqual(
      Array.from(level.rows),
      sourceMaps.get(level.source).get(level.sourceNumber),
      "original geometry",
    );
    if (index)
      assert.ok(
        level.difficultyScore >= bank.levels[index - 1].difficultyScore,
      );
    assert.equal(level.difficultyScore, assess(level, rules).score);
    if (!legacyIds.has(level.id))
      assert.equal(
        level.minPushes,
        undefined,
        "Unproven solutions do not claim optimality",
      );
    if (level.solutionId) {
      const record = Object.values(historicalSolutions)
        .flat()
        .find((entry) => entry.SolutionId === level.solutionId);
      assert.ok(record, "Historical solution attribution retained");
      assert.equal(
        record.Path.replace(/\s/g, "").toLowerCase(),
        level.solution,
      );
      assert.equal(record.TotalNodes, level.searchNodes);
    }
    const map = rules.parse(level),
      state = rules.create();
    for (const direction of level.solution)
      assert.equal(
        rules.move(map, state, direction),
        true,
        level.id + " solution move",
      );
    assert.ok(rules.won(map, state), level.id + " solvable");
    assert.equal(state.pushes, level.minPushes ?? level.solutionPushes);
    const restored = rules.restore(map, { path: state.path });
    assert.ok(restored && rules.won(map, restored));
    rules.undo(state);
    assert.equal(rules.won(map, state), false);
    assert.equal(rules.move(map, state, level.solution.at(-1)), true);
  });
  const map = rules.parse({
    rows: ["#######", "#  .  #", "#  $@ #", "#######"],
  });
  const state = rules.create();
  assert.equal(rules.move(map, state, "d"), false, "wall blocks movement");
  assert.equal(state.moves, 0);
  assert.equal(rules.move(map, state, "l"), true);
  assert.equal(rules.move(map, state, "l"), true);
  assert.equal(rules.deadlocked(map, state), true, "wall corner detected");
  rules.undo(state);
  assert.equal(rules.deadlocked(map, state), false);
  const blocked = rules.parse({
    rows: ["#######", "# . . #", "# $$@ #", "#######"],
  });
  assert.equal(
    rules.move(blocked, rules.create(), "l"),
    false,
    "cannot push two boxes",
  );
  assert.equal(
    rules.restore(map, { path: "d" }),
    null,
    "reject illegal replay",
  );
  assert.equal(rules.restore(map, { path: "xyz" }), null);
  assert.equal(rules.restore(map, { path: "l".repeat(20001) }), null);
  assert.throws(() => rules.parse({ rows: ["@$."] }), /boundary/);
}
async function main() {
  verifyRules();
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const session = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
      reducedMotion: "reduce",
    });
    // Folder onboarding is covered separately and can reopen after language changes.
    await session.addInitScript(() => {
      const showModal = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () {
        if (this.id !== "onboardingDialog") showModal.call(this);
      };
    });
    const page = await session.newPage(),
      errors = [];
    await page.addInitScript((key) => {
      const fixture = localStorage.getItem(key + ".fixture");
      if (fixture) {
        localStorage.setItem(key, fixture);
        localStorage.removeItem(key + ".fixture");
      }
    }, key);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    const action = (name) =>
      page.locator('[data-sokoban-action="' + name + '"]');
    const board = page.locator(".sokoban-board");
    const saved = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    async function launch() {
      // The compact app restores the game detail panel instead of the menu list.
      // Launch through the desktop menu, then restore the requested game viewport.
      const viewport = page.viewportSize();
      await page.setViewportSize({ width: 1440, height: 1000 });
      const url = pathToFileURL(entry).href;
      if (page.url() === url) {
        await page.locator("#gameExitButton").click();
        await page.waitForFunction(
          () => document.querySelector("#gameShell").dataset.state === "closed",
        );
        await page.reload();
      } else await page.goto(url);
      await page.waitForFunction(
        () => document.documentElement.dataset.appState === "ready",
      );
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      await page.locator("#date-tab-games").click();
      // Startup notices can return the sidebar to notifications after reload.
      await page.waitForFunction(() => {
        if (document.querySelector("#gamesPanel").hidden)
          document.querySelector("#date-tab-games").click();
        return !document.querySelector("#gamesPanel").hidden;
      });
      try {
        await page.waitForFunction(() => {
          const shell = document.querySelector("#gameShell");
          if (
            shell.dataset.state === "open" &&
            document.querySelector(".game-sokoban")
          )
            return true;
          if (shell.dataset.state !== "closed") return false;
          // Recovery and startup notices finish asynchronously; retry the real
          // menu action until the controller is ready to accept a launch.
          document.querySelector("#date-tab-games").click();
          document
            .querySelector('#gamesPanel [data-game="game-sokoban"]')
            .click();
          document.querySelector("#gamesPanel .game-menu-play").click();
          return false;
        });
      } catch (error) {
        await page.screenshot({
          path: path.join(output, "launch-failure.png"),
        });
        throw error;
      }
      await page.waitForFunction(
        () => document.querySelector("#gameShell").dataset.state === "open",
      );
      assert.equal(await page.locator("[data-game-error]").count(), 0);
      await page.setViewportSize(viewport);
    }
    await launch();
    assert.equal(await page.locator(".sokoban-levels button").count(), 20);
    assert.equal(
      await page.locator(".sokoban-levels button:enabled").count(),
      20,
    );
    const columnCount = () =>
      page
        .locator(".sokoban-levels")
        .evaluate(
          (grid) =>
            getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        );
    assert.equal(await columnCount(), 5);
    assert.equal(await action("level-0").innerText(), "01");
    assert.equal(
      await page.locator(".sokoban-catalog .game-level-page-summary").count(),
      0,
    );
    await action("chapter-2").click();
    assert.equal(
      await action("chapter-2").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await action("level-0").innerText(), "41");
    await action("chapter-6").click();
    assert.equal(await action("level-0").innerText(), "121");
    await action("level-19").click();
    const lastLevel = bank.levels.at(-1);
    const laterSave = await saved();
    assert.equal(laterSave.current, lastLevel.id);
    assert.deepEqual(laterSave.completed, {});
    assert.equal(
      await page.evaluate(
        (save) =>
          WorkTimeApp.services.gameArchive.normalize("game-sokoban", save)
            .current,
        laterSave,
      ),
      lastLevel.id,
    );
    await launch();
    assert.equal(await board.isVisible(), true);
    assert.equal((await saved()).current, lastLevel.id);
    assert.deepEqual(
      await page.locator(".sokoban-theory-card strong").allTextContents(),
      [
        bank.optima[lastLevel.id]?.moves?.value?.toString() ?? "未验证",
        bank.optima[lastLevel.id]?.moves?.pushes?.toString() ?? "未验证",
      ],
      "A feasible reference solution never masquerades as a proven optimum",
    );
    await action("choose").click();
    await action("chapter-0").click();
    await page.screenshot({ path: path.join(output, "levels-desktop.png") });
    await action("level-0").click();
    assert.deepEqual(
      await page.locator(".sokoban-theory-card strong").allTextContents(),
      ["1", "1"],
    );
    if (process.argv.includes("--theory-only")) {
      await action("choose").click();
      await action("level-17").click();
      const optimum = bank.optima[bank.levels[17].id].moves;
      assert.deepEqual(
        await page.locator(".sokoban-theory-card strong").allTextContents(),
        [String(optimum.value), String(optimum.pushes)],
      );
      assert.ok(
        (await page.locator(".sokoban-theory-card").innerText()).includes(
          "对应推动次数",
        ),
      );
      assert.notEqual(optimum.pushes, bank.levels[17].minPushes);
      console.log(
        "Offline minimum-move and corresponding-push display verified.",
      );
      return;
    }
    const theory = await page.locator(".sokoban-theory-section").boundingBox();
    const meters = await page.locator(".sokoban-meters").boundingBox();
    assert.ok(
      theory.y + theory.height <= meters.y,
      "theoretical minima precede current statistics",
    );
    assert.equal(await page.locator(".sokoban-status").innerText(), "");
    assert.equal(
      await page.locator(".sokoban-keyboard-hint, .sokoban-source").count(),
      0,
    );
    const before = await board.boundingBox();
    const stage = await page.locator(".sokoban-stage").boundingBox();
    const sidebar = await page.locator(".sokoban-sidebar").boundingBox();
    assert.ok(Math.abs(stage.width - stage.height) < 1, "square game area");
    assert.ok(sidebar.x >= stage.x + stage.width, "controls stay on the right");
    assert.ok(
      (await action("undo").boundingBox()).y >
        (await page.locator(".sokoban-meters").boundingBox()).y,
      "level information precedes actions",
    );
    assert.ok(before.width >= 300, "intro board is large enough to read");
    assert.equal(
      await action("next").isVisible(),
      false,
      "next appears on completion",
    );
    assert.equal(
      await page.locator(".sokoban-directions").isVisible(),
      false,
      "desktop uses keyboard guidance",
    );
    await page.screenshot({ path: path.join(output, "intro-desktop.png") });
    await board.press("ArrowRight");
    assert.equal((await saved()).drafts[bank.levels[0].id].path, "r");
    assert.ok((await saved()).completed[bank.levels[0].id]);
    assert.equal(await action("next").isDisabled(), false);
    assert.equal(await action("next").isVisible(), true);
    assert.ok(
      await page.locator(".sokoban-box").evaluateAll((pieces) =>
        pieces.every((piece) => {
          const bounds = piece.getBoundingClientRect();
          return Math.abs(bounds.width - bounds.height) < 1;
        }),
      ),
      "goal icons keep crates square",
    );
    await page.screenshot({ path: path.join(output, "complete-desktop.png") });
    assert.deepEqual(
      await board.boundingBox(),
      before,
      "status keeps board stationary",
    );
    await action("undo").click();
    assert.equal((await saved()).drafts[bank.levels[0].id].path, "");
    assert.ok(
      (await saved()).completed[bank.levels[0].id],
      "undo keeps earned completion",
    );
    await board.press("ArrowRight");
    await action("next").click();
    const level = bank.levels[1],
      first = level.solution[0];
    await board.press(
      { u: "ArrowUp", r: "ArrowRight", d: "ArrowDown", l: "ArrowLeft" }[first],
    );
    const draft = (await saved()).drafts[level.id].path;
    await action("restart").click();
    await action("cancel").press("Tab");
    assert.equal(
      await action("reset").evaluate(
        (element) => document.activeElement === element,
      ),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal((await saved()).drafts[level.id].path, draft);
    assert.equal(await page.locator("[data-game-help]").count(), 0);
    assert.ok(
      fs
        .readFileSync(
          path.join(path.dirname(entry), "licenses/microban.txt"),
          "utf8",
        )
        .includes("David W. Skinner"),
      "puzzle attribution remains in the distributed license",
    );
    await launch();
    assert.equal(
      (await saved()).current,
      level.id,
      "refresh resumes current level",
    );
    assert.equal((await saved()).drafts[level.id].path, draft);
    await action("restart").click();
    await action("reset").click();
    assert.equal((await saved()).drafts[level.id].path, "");
    const swipeDirection = level.solution[0];
    const touch = await session.newCDPSession(page);
    const touchBounds = await board.boundingBox();
    const x = touchBounds.x + touchBounds.width / 2,
      y = touchBounds.y + touchBounds.height / 2;
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x:
            x +
            (swipeDirection === "r" ? 40 : swipeDirection === "l" ? -40 : 0),
          y:
            y +
            (swipeDirection === "d" ? 40 : swipeDirection === "u" ? -40 : 0),
        },
      ],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.equal((await saved()).drafts[level.id].path, swipeDirection);
    // Six translations, themes and narrow layout use the real offline app.
    for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"]) {
      await page.evaluate(
        (language) => WorkTimeApp.i18n.setLanguage(language),
        language,
      );
      assert.ok(
        !(await page.locator(".game-sokoban").innerText()).includes(
          "games.sokoban.",
        ),
      );
    }
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    const colors = new Set();
    for (const theme of [
      "green",
      "blue",
      "purple",
      "orange",
      "rose",
      "slate",
      "cyan",
      "mint",
      "olive",
      "gold",
      "red",
      "brown",
    ]) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      colors.add(
        await page
          .locator(".sokoban-cell.is-wall")
          .first()
          .evaluate((element) => getComputedStyle(element).color),
      );
    }
    assert.equal(colors.size, 1, "skin palette is independent of site accent");
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "green"),
    );
    await page.screenshot({ path: path.join(output, "board-desktop.png") });
    await page
      .locator(".sokoban-stage")
      .screenshot({ path: path.join(output, "artwork-preview.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await page.waitForFunction(() =>
      document
        .querySelector("#gameShell")
        .classList.contains("game-shell-compact"),
    );
    const bounds = await board.boundingBox();
    const phoneStage = await page.locator(".sokoban-stage").boundingBox();
    assert.ok(
      Math.abs(phoneStage.width - phoneStage.height) < 1,
      "phone game area stays square",
    );
    assert.equal(
      await page.locator(".sokoban-directions").isVisible(),
      true,
      "touch has direction buttons",
    );
    for (const name of ["u", "r", "d", "l"]) {
      const buttonBounds = await action(name).boundingBox();
      assert.ok(
        buttonBounds.width >= 44 && buttonBounds.height >= 44,
        "touch targets are at least 44px",
      );
    }
    assert.ok(
      bounds.x >= 0 && bounds.x + bounds.width <= 390,
      "board fits phone",
    );
    assert.equal(
      await page
        .locator(".game-content")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
      false,
      "game has no horizontal overflow",
    );
    await page.screenshot({
      path: path.join(output, "board-phone.png"),
    });
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const language of ["en", "ja", "ko", "zh-CN"]) {
        await page.evaluate(
          (language) => WorkTimeApp.i18n.setLanguage(language),
          language,
        );
        assert.ok(
          await page
            .locator(".game-sokoban")
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
          "translated controls fit narrow screens",
        );
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // Theme selection, return, reload and boundary transitions use real saves.
    const skins = bank.chapters.map((chapter) => chapter.skin);
    const shapeSignatures = new Set();
    for (const [chapter, skin] of skins.entries()) {
      await action("choose").click();
      await action("chapter-" + chapter).click();
      assert.equal(
        await page.locator(".game-sokoban").getAttribute("data-skin"),
        skin,
      );
      assert.equal(await page.locator(".sokoban-card-motif svg").count(), 20);
      await action("level-19").click();
      shapeSignatures.add(
        await page.locator(".sokoban-player svg").innerHTML(),
      );
      await launch();
      assert.equal(
        await page.locator(".game-sokoban").getAttribute("data-skin"),
        skin,
      );
      await action("choose").click();
      await action("chapter-" + ((chapter + 1) % skins.length)).click();
      await page.locator(".sokoban-catalog .game-level-return").click();
      assert.equal(
        await page.locator(".game-sokoban").getAttribute("data-skin"),
        skin,
      );
      await page.setViewportSize({ width: 320, height: 844 });
      for (const language of ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"]) {
        await page.evaluate(
          (language) => WorkTimeApp.i18n.setLanguage(language),
          language,
        );
        await action("choose").click();
        assert.ok(
          !(await page.locator(".sokoban-catalog").innerText()).includes(
            "games.sokoban.",
          ),
        );
        assert.ok(
          await page
            .locator(".sokoban-catalog")
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
          "Seven translated categories fit 320px screens",
        );
        if (language === "zh-CN")
          await page
            .locator(".sokoban-catalog")
            .screenshot({ path: path.join(output, skin + "-catalog-320.png") });
        await page.locator(".sokoban-catalog .game-level-return").click();
      }
      await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({
          width,
          height: width === 1440 ? 1000 : 844,
        });
        for (const colorScheme of ["light", "dark"]) {
          await page.emulateMedia({ colorScheme });
          await page.locator(".sokoban-stage").screenshot({
            path: path.join(
              output,
              skin + "-" + width + "-" + colorScheme + ".png",
            ),
          });
          const rect = await board.boundingBox();
          assert.ok(
            rect.width > 0 && rect.x >= 0 && rect.x + rect.width <= width,
            "themed board fits viewport",
          );
          if (colorScheme === "light") {
            await board.evaluate((element) => {
              element.style.filter = "grayscale(1)";
            });
            await page.locator(".sokoban-stage").screenshot({
              path: path.join(output, skin + "-" + width + "-grayscale.png"),
            });
            await board.evaluate((element) => {
              element.style.filter = "";
            });
          }
        }
      }
    }
    assert.equal(
      shapeSignatures.size,
      7,
      "each theme has a distinct character",
    );
    for (const index of [19, 39, 59, 79, 99, 119]) {
      const level = bank.levels[index];
      await page.evaluate(
        ({ key, level, chapter }) =>
          localStorage.setItem(
            key + ".fixture",
            JSON.stringify({
              version: 1,
              chapter,
              current: level.id,
              drafts: { [level.id]: { path: level.solution.slice(0, -1) } },
              completed: {},
            }),
          ),
        { key, level, chapter: Math.floor(index / 20) },
      );
      await launch();
      assert.equal(
        await page.locator(".game-sokoban").getAttribute("data-skin"),
        skins[Math.floor(index / 20)],
      );
      await board.press(
        { u: "ArrowUp", r: "ArrowRight", d: "ArrowDown", l: "ArrowLeft" }[
          level.solution.at(-1)
        ],
      );
      assert.ok(await page.locator(".sokoban-box.on-goal").count());
      await action("next").click();
      assert.equal(
        await page.locator(".game-sokoban").getAttribute("data-skin"),
        skins[Math.floor((index + 1) / 20)],
      );
      assert.equal((await saved()).current, bank.levels[index + 1].id);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 390, height: 844 });
    // Exercise the last-level completion and all chapters using verified replays.
    const fixture = {
      version: 1,
      chapter: 6,
      current: bank.levels.at(-1).id,
      completed: Object.fromEntries(
        bank.levels
          .slice(0, -1)
          .map((level) => [level.id, { path: level.solution }]),
      ),
      drafts: {
        [bank.levels.at(-1).id]: {
          path: bank.levels.at(-1).solution.slice(0, -1),
        },
      },
    };
    async function finishLastLevel(completed) {
      await page.evaluate(
        ({ key, fixture }) =>
          localStorage.setItem(key + ".fixture", JSON.stringify(fixture)),
        { key, fixture: { ...fixture, completed } },
      );
      await launch();
      await board.press(
        { u: "ArrowUp", r: "ArrowRight", d: "ArrowDown", l: "ArrowLeft" }[
          lastLevel.solution.at(-1)
        ],
      );
    }
    await finishLastLevel({});
    assert.equal(Object.keys((await saved()).completed).length, 1);
    assert.equal(await page.locator(".sokoban-status").innerText(), "");
    await finishLastLevel(fixture.completed);
    assert.equal(Object.keys((await saved()).completed).length, 140);
    assert.equal(await page.locator(".sokoban-status").innerText(), "");
    await action("next").click();
    assert.equal(
      await page
        .locator('.sokoban-levels .game-level-badge[data-state="complete"]')
        .count(),
      20,
    );
    assert.equal(
      await columnCount(),
      2,
      "Compact chapter picker uses two columns",
    );
    assert.equal(
      await page
        .locator(".sokoban-progress, .sokoban-catalog .game-level-page-summary")
        .count(),
      0,
    );
    // Invalid storage falls back to the catalog without adding records.
    await page.evaluate(
      (key) =>
        localStorage.setItem(
          key + ".fixture",
          JSON.stringify({
            version: 1,
            current: "microban-999",
            drafts: {},
            completed: { "microban-44": { path: "BAD" } },
          }),
        ),
      key,
    );
    await launch();
    assert.equal(await action("level-1").isVisible(), true);
    assert.equal(
      await page
        .locator('.sokoban-levels .game-level-badge[data-state="complete"]')
        .count(),
      0,
    );
    await page.evaluate(
      (key) => localStorage.setItem(key + ".fixture", "broken json"),
      key,
    );
    await launch();
    assert.ok((await page.locator(".sokoban-warning").innerText()).length);
    await page.screenshot({ path: path.join(output, "storage-warning.png") });
    // Native animation tracks are paused and sampled to check actual geometry.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await action("level-0").click();
    const tracks = await board.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      const tracks = element.getAnimations({ subtree: true });
      tracks.forEach((track) => {
        track.pause();
        track.currentTime = 60;
      });
      return tracks.map((track) => ({
        piece: track.effect.target.dataset.piece,
        frames: track.effect.getKeyframes().map((frame) => frame.transform),
        duration: track.effect.getTiming().duration,
        offset: new DOMMatrixReadOnly(
          getComputedStyle(track.effect.target).transform,
        ).m41,
      }));
    });
    assert.equal(tracks.length, 2, "player and pushed box animate together");
    assert.deepEqual(tracks.map((track) => track.piece).sort(), [
      "box-0",
      "player",
    ]);
    assert.ok(
      tracks.every(
        (track) =>
          track.duration === 120 && track.offset < -1 && track.offset > -60,
      ),
    );
    assert.deepEqual(
      tracks[0].frames,
      tracks[1].frames,
      "push tracks have matching displacement",
    );
    await board.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", bubbles: true }),
      );
      element
        .getAnimations({ subtree: true })
        .forEach((track) => track.finish());
    });
    await page.waitForFunction(
      (key) =>
        JSON.parse(localStorage.getItem(key)).drafts["microban-44"].path === "",
      key,
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length === 0,
    );
    await board.evaluate((element) =>
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () =>
        document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length === 0,
    );
    await action("undo").click();
    assert.equal(
      await board.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
      0,
      "reduced motion skips movement tracks",
    );
    await board.press("ArrowRight");
    await action("next").click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const burst = bank.levels[1].solution.slice(0, 8);
    await board.evaluate((element, burst) => {
      const keys = {
        r: "ArrowRight",
        l: "ArrowLeft",
        u: "ArrowUp",
        d: "ArrowDown",
      };
      for (const direction of burst)
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key: keys[direction], bubbles: true }),
        );
    }, burst);
    await page.waitForFunction(
      ({ key, id, burst }) =>
        JSON.parse(localStorage.getItem(key)).drafts[id].path === burst,
      { key, id: bank.levels[1].id, burst },
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length === 0,
    );
    // Catalog, resize and exit settle the current step and discard unplayed input.
    await board.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      element
        .getAnimations({ subtree: true })
        .forEach((track) => track.pause());
    });
    await action("choose").click();
    assert.equal(
      await board.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
      0,
    );
    await page.locator(".sokoban-catalog .game-level-return").click();
    await board.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", bubbles: true }),
      );
      element
        .getAnimations({ subtree: true })
        .forEach((track) => track.pause());
    });
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.waitForFunction(
      () =>
        document
          .querySelector(".sokoban-board")
          .getAnimations({ subtree: true }).length === 0,
    );
    await board.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", bubbles: true }),
      );
      element
        .getAnimations({ subtree: true })
        .forEach((track) => track.pause());
    });
    await page.locator("#gameExitButton").click();
    await page.waitForFunction(
      () => document.querySelector("#gameShell").dataset.state === "closed",
    );
    assert.equal(await page.locator(".sokoban-player").count(), 0);
    assert.deepEqual(errors, []);
    const noStorage = await session.newPage();
    await noStorage.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw Error("disabled");
      };
      Storage.prototype.getItem = () => {
        throw Error("disabled");
      };
    });
    await noStorage.goto(pathToFileURL(entry).href);
    await noStorage.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await noStorage.locator("#date-tab-games").click();
    await launchGame(noStorage, "game-sokoban");
    await noStorage.locator('[data-sokoban-action="level-0"]').click();
    await noStorage.locator(".sokoban-board").press("ArrowRight");
    assert.equal(
      await noStorage.locator('[data-sokoban-action="next"]').isDisabled(),
      false,
    );
    assert.ok((await noStorage.locator(".sokoban-warning").innerText()).length);
    console.log(
      "Sokoban: 140 source puzzles and solutions, rules, free level selection, saves, undo, restart, keyboard, touch, six languages, responsive layout and storage failures verified: " +
        entry,
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const entry = path.resolve(process.argv[2] || root, "index.html");
function verifyRules() {
  const context = vm.createContext({ WorkTimeApp: { games: {} } });
  for (const file of ["tank-stages", "tank-rules"])
    vm.runInContext(
      fs.readFileSync(
        path.join(root, "assets/js/games/" + file + ".js"),
        "utf8",
      ),
      context,
    );
  const r = context.WorkTimeApp.games.tankRules;
  const tick = (s, seconds, inputs = []) => {
    for (let i = 0; i < Math.ceil(seconds * 60); i++)
      r.step(s, inputs, 1 / 60, () => 0.3);
  };
  const empty = (players = 1) => {
    const s = r.create({ players, custom: Array(2704).fill(0) });
    s.spawnTimer = 1000;
    return s;
  };
  const enemy = (s, x, y, type = 0) => {
    const t = {
      ...s.tanks[0],
      id: ++s.serial,
      player: -1,
      x,
      y,
      type,
      hp: type === 3 ? 4 : 1,
      shield: 0,
      frozen: 100,
      carrier: false,
    };
    s.tanks.push(t);
    return t;
  };
  const bullet = (s, x, y, dir, player = 0, steel = false) =>
    s.bullets.push({
      x,
      y,
      dir,
      player,
      owner: -100,
      speed: 180,
      steel,
      dead: false,
    });
  // Independent decoded Famicom stage reference; includes the separate eagle wall.
  const expectedMaps = [
    "90397045e532c74621effc9424dde4dde2b9607d9a9a6b6229219a1337995ec8",
    "7e3628c27ba93cf53b8e21dc34539e60f9f5f677d78ecdf32d6dbe45b51d6a6e",
    "7f63f46845dfc0667a5dec68c820a5c611a0207875cc8457cc035e88cd5fd7d0",
    "21a36c9d4dd0c4f72ac104b08ba6f1d85855915ae93dadf27829443602d39223",
    "1c0c6474e42db989d6f39f08dff48b82894e9a4ae160cda6a5ee955842410216",
    "b193b264141ba733db2d1eb59fcc735bd098426d93f5e0b4f59cee705b536ddc",
    "59814155b8dda1c8510c58d9c182d3c63f0d23692601129873147f2bfc37a249",
    "3eae3f0f247d84a845fa6e4a706aface1d19546ab18370dfdb77f3cc06feba72",
    "82a33f762d97538f2ae64b838a238f6ee55481d3b8d41b53777297c5b4b0e552",
    "59843f6a38f1b5970b7c7f3e14e5e7259908d5e670f00b85728e798c881a0898",
    "4381a6f2208e2244ea04f6a6193e60862209acdd36f998aa1adb836b28c06971",
    "dc9d5b2d9cf7862b29b05a48254d9d8db700062a6c6a346336dfea4e15acf736",
    "4e8433ed4167a49f018ae47622549077ce7273bedbd2c31f4e058fc4eb740c48",
    "ea95fe67135968c32cde21b7da9228f5c90fa97cba1fada7bdbb3ec0229cf3c1",
    "9a047604e50b22599ff39a682ebb84af5428a0e4dcf2b6cca157b3b490354af4",
    "4a4ba948f44c680157461e71c2fd82960ac4fc8ba1f9fe36936b58e179faaa51",
    "706e0c0a44d1418877a564907e30dc0d3943ffd38e8c65cec07b7564f16094cc",
    "e34abaae9754e252815f9ce87a058aaea44087fdb5d9ec0ab36d486650924149",
    "efe5162381f0c0fe494e9c15ff90e52583e57deb2fe86b9b0b009d5492c66f0d",
    "0347691e4b51e2e78f075307c36f8471013e6d6d541e7e4ea549d02f9123e2a5",
    "3ae1a52e1412416c079e218acbde7cbb1e7f08392a4cb45be77aa56a88b00818",
    "dea2eaa33e8a9a5985dab5eb6dcd124b89f49cc423153878bcf2ecc451712376",
    "2dd8ee65393efbec41f01e8cc4f69b0ae6469dd73c97cffd287b4b60bdaac7e1",
    "121ed03d4dbfacde7c0b94d160e7368d6354ff20aa2838a1768d9fe3b36dc770",
    "bc0d2ba3bd89e819354a6c86b45a91b9f3b0a666b468d8d2b6c28382cd90c68f",
    "7c5061978134aafebd5afc239c5c318cfe8656c58bc4c8562db7a1b0496943f5",
    "892645f5df493128f6b5f52264c095d0ff1a5eb0d239984614196288d2854708",
    "28222b2cd2dee351026329ab13eebf61810ee4a9dda77e05a678a472e65c25fa",
    "10990a613c5806b1febb613a9dd8f0824d2a74029c49dc6c6cf819dd3dc887f8",
    "06b7964024f9ef939be78749c08a876dc2c5603a0be6cc5285352504face0657",
    "9c9e1b0a6aae5686e6a529be2533f74c5ca128c695b0803e2e7746888eca2ccd",
    "2a3c280618ab381bf618da68165fc3ebb3c5fc3b9f4e0c9f31573c9205d3d55e",
    "396f6c305d5e12e8188ca0cf5fb22a1252e1ad0f0940d0b447d457212dba704b",
    "6c54a7919824994861e5938b24cd16b57389cf9f195eb20c8c5dae48fffe308a",
    "145514ba664c19ba715b2e69d750e07f63017455df7ddd13b8d2d992f110d1ac",
  ];
  const maps = new Set();
  const expectedWaves = [
    "205b9cb358fad8b55e189a690b4c2e913bbde31d7a30eb65e5fb75974cf68815",
    "c52d6808e03fd088a53c9744268c61569cc427818dfebcd55668f2b87d511c87",
    "932d3292fdbb9596b40476771ef41c992c97934afded5a3045f097f0ac748ec5",
    "402074c2742e12256f82c3e307d62a81e6987e28b49cf85c38c4b92e3c695aa7",
    "dd6ea213961acfd7c7801d3cc330d9f8b3f2f1867b9092245025faef63253142",
    "ec4d5e813a2baa5a97848299d28971b726eb30b397d104e99c6ff1b4d79df655",
    "e1b111d9b3cb9366a132f049d56d11b3b1af09a877f65b1e1fe5e38c9e74b299",
    "6955d59bd0101089d73717dad4143fb18e92b7e4f38e0dff13a3efc8253c6ec1",
    "8ba97ccada45061f919450aefb3268953da7daa4e7e4776fe143e58c7e785ff5",
    "0b6ded5ea532bb0aba48f21d0399f08884d865dbedd700070b37d7afe67eed8c",
    "7855bee493cf537ea705db5503fad8c1d675cd707542d6f6da23f4b8260f3984",
    "b92922ebe0970f1d4040a9d8cfb83bac1d164e857ce3a8a2d6981de652bf1cab",
    "483eb97e17df132e76fc193e90ef0247365171be642b85e9d3dae1c1f1d4fc4c",
    "98e693d893af7ca1481b775cd3ecaf049c70b51c4f529b6e4113608f5e5e554c",
    "591cfa6158f1736dc2f9b8b48b6d230942a9f437f0e47dd658e97b5e5d012b0e",
    "a8d2d02d82e967df8a09b8238d2267c09587fc2537ef7ecc9bf764a6a15b671f",
    "00533a084f46d339fe9e8f12960ca1467dec8666b8fe932ab735fbb020067481",
    "e8fa0a2dfeb69f13e7ad95dc7b410b697989dcad789849254a4d152a68bcb818",
    "158b721715fb2cace711aa9ba4627897b73da3d4968e3bca5debd818f067e387",
    "80382d924e7884b4c2bea3c021138f3edd4f13b9e824e6d52b0636d94fb4db3e",
    "7b72f16022842b321bc2e2a584d439983e63999e6eeec34f86237beb7adcb74f",
    "080078e6b837f55cba27099d5695aed9d2dbba96c2bbd1d9bbea17fe2058eed9",
    "6b0cbf577bd183257d1426c827e6b25dcfdb7640d925c07e3b3b662e0fde115a",
    "914d1017b37997e965d3ad4636d2248807e73c2cc5074c2fb7aa0aa6a3f2a0b3",
    "2435e3627d43ad2caa868509bb8a54bc28d926c41e9f034075f10c40a5044a05",
    "d2ae8ba453831a09a2b6882120515ef05efbc68fd3094c0c9c57f88d008eea45",
    "b94258b053a263eb6315a098559a9f19abc54abf96f4854e4f1171e2d1dc2c65",
    "4fcff62bf5e2228d35ce3f814266e80fd23741abb2092ae6e3e641267a3884a8",
    "98e693d893af7ca1481b775cd3ecaf049c70b51c4f529b6e4113608f5e5e554c",
    "377f7fdb6003a03ac786bb2f3401a596da238cb38b289d7a28c9494300069c99",
    "938a9967e0f972bcc3c3cdd40faf7036f2e38029d33b5dc547bd021f7db65f95",
    "1f9d1df52bb910666e6ad4a297a9a1f06c60bd178862b64b7f038b3e3e9412d0",
    "84363764bfb96618b893959c423ce8587b06721cfecc871c4d4c4bfde70f3175",
    "785a668e011eec0a75a948a321d2647ab8116c70bd72ba68d2b12bf90bd0a955",
    "48983deeff1cc204667df06314aeed86160cb1f20ccb4cde60c70b79898f634b",
  ];
  for (let stage = 1; stage <= 35; stage++) {
    const s = r.create({ stage, players: 2 });
    assert.equal(s.map.length, 2704);
    assert.equal(
      crypto.createHash("sha256").update(Buffer.from(s.map)).digest("hex"),
      expectedMaps[stage - 1],
      "Famicom terrain and half-wall orientation: " + stage,
    );
    assert.ok(s.map.every((v) => Number.isInteger(v) && v >= 0 && v <= 5));
    assert.equal(
      context.WorkTimeApp.games.tankStages.npc[stage - 1].length,
      20,
    );
    assert.equal(
      crypto
        .createHash("sha256")
        .update(
          Buffer.from(context.WorkTimeApp.games.tankStages.npc[stage - 1]),
        )
        .digest("hex"),
      expectedWaves[stage - 1],
      "ordered enemy types: " + stage,
    );
    const simulation = r.create({ stage });
    for (let i = 0; i < 20; i++) {
      simulation.spawnTimer = 0;
      r.step(simulation, [], 1 / 60, () => 0.99);
      const spawned = simulation.tanks.find((t) => t.player < 0);
      assert.ok(spawned, "wave can spawn on stage " + stage);
      assert.equal(
        spawned.type,
        context.WorkTimeApp.games.tankStages.npc[stage - 1][i],
      );
      assert.equal(spawned.carrier, [3, 10, 17].includes(i));
      assert.ok(
        spawned.spawn > 0,
        "spawn animation protects enemies before activation",
      );
      simulation.tanks = simulation.tanks.filter((t) => t.player >= 0);
    }
    assert.equal(simulation.spawned, 20);
    for (const t of s.tanks)
      assert.equal(r.blocked(s, t.x, t.y, t), false, "player pad " + stage);
    assert.ok(
      [0, 96, 192].some((x) => !r.blocked(s, x, 0)),
      "an enemy pad is available: " + stage,
    );
    maps.add(JSON.stringify(s.map));
  }
  assert.equal(maps.size, 35);
  assert.equal(JSON.stringify(r.mapFor(1)), JSON.stringify(r.mapFor(36)));
  assert.equal(r.create().spawnTimer, 186 / 60, "stage 1 spawn interval");
  assert.equal(
    r.create({ stage: 35, players: 2 }).spawnTimer,
    30 / 60,
    "late co-op spawn interval",
  );
  for (const level of [0, 1, 2, 3]) {
    const upgraded = empty();
    upgraded.tanks[0].level = level;
    tick(upgraded, 1, [{ dir: 0 }]);
    assert.ok(
      Math.abs(upgraded.tanks[0].y - 147) < 0.01,
      "stars do not change driving speed",
    );
    r.fire(upgraded, upgraded.tanks[0]);
    assert.equal(upgraded.bullets[0].speed, level ? 240 : 120);
    assert.equal(upgraded.bullets[0].steel, level === 3);
    upgraded.tanks[0].cooldown = 0;
    r.fire(upgraded, upgraded.tanks[0]);
    assert.equal(
      upgraded.bullets.length,
      level >= 2 ? 2 : 1,
      "star projectile capacity",
    );
  }
  let lane = empty();
  for (let type = 0; type < 4; type++) {
    const speedCase = empty();
    const moving = enemy(speedCase, 0, 64, type);
    moving.frozen = 0;
    moving.dir = 2;
    moving.turn = 100;
    tick(speedCase, 0.5);
    assert.ok(
      Math.abs(moving.y - (type === 1 ? 94 : 79)) < 0.01,
      "enemy driving speed type " + type,
    );
  }
  const reverseCase = empty();
  tick(reverseCase, 0.1, [{ dir: 1 }]);
  const beforeReverse = reverseCase.tanks[0].x;
  tick(reverseCase, 0.05, [{ dir: 3 }]);
  assert.ok(
    Math.abs(reverseCase.tanks[0].x - (beforeReverse - 2.25)) < 0.01,
    "reversing does not snap sideways",
  );
  for (let y = 38; y < 42; y++)
    for (let x = 16; x < 20; x++) lane.map[y * 52 + x] = 1;
  for (let shot = 0; shot < 4; shot++) {
    bullet(lane, 71, 180, 0);
    tick(lane, 0.25);
  }
  assert.ok(
    lane.map
      .slice(38 * 52, 42 * 52)
      .every((v, i) => i % 52 < 16 || i % 52 >= 20 || v === 0),
    "four strips open a full tank-width lane",
  );
  tick(lane, 1, [{ dir: 0 }]);
  assert.ok(lane.tanks[0].y < 152, "tank can drive through the cleared lane");
  for (const kills of [
    [12, 8],
    [8, 12],
    [10, 10],
  ]) {
    const coop = empty(2);
    coop.destroyed = 20;
    coop.spawned = 20;
    coop.players.forEach((p, i) => (p.kills = [kills[i], 0, 0, 0]));
    r.step(coop, []);
    const winner = kills[0] === kills[1] ? null : kills[0] > kills[1] ? 0 : 1;
    assert.equal(coop.bonusPlayer, winner, "co-op kill-count winner");
    assert.equal(
      coop.players.reduce((sum, p) => sum + p.score, 0),
      winner === null ? 0 : 1000,
    );
    r.step(coop, []);
    assert.equal(
      coop.players.reduce((sum, p) => sum + p.score, 0),
      winner === null ? 0 : 1000,
      "bonus awarded once",
    );
  }
  const construction = empty();
  construction.players[0].score = 500;
  construction.players[0].level = 2;
  const normal = r.next(construction);
  assert.equal(normal.custom, false);
  assert.equal(normal.stage, 2);
  assert.equal(normal.players[0].score, 500);
  assert.equal(normal.tanks[0].level, 2);
  const powerStay = empty();
  powerStay.power = { x: 0, y: 16, kind: "helmet", life: Infinity };
  tick(powerStay, 25);
  assert.ok(powerStay.power, "power-up remains until collected or replaced");
  powerStay.spawned = 3;
  powerStay.spawnTimer = 0;
  r.step(powerStay, []);
  assert.equal(
    powerStay.power,
    null,
    "next carrier clears uncollected power-up",
  );
  const surviving = empty(2);
  surviving.players[0].lives = 0;
  surviving.tanks = surviving.tanks.filter((t) => t.player === 1);
  const nextCoop = r.next(surviving);
  assert.equal(nextCoop.tanks.length, 1);
  r.collect(nextCoop, nextCoop.tanks[0], "bomb");
  assert.equal(
    nextCoop.players[0].lives,
    0,
    "out player stays out without a personal extra life",
  );
  let s = empty();
  tick(s, 1, [{ dir: 0 }]);
  assert.ok(Math.abs(s.tanks[0].y - 147) < 0.01, "45 px/sec movement");
  s.map.fill(1, 35 * 52, 36 * 52);
  tick(s, 2, [{ dir: 0 }]);
  assert.ok(s.tanks[0].y >= 144 && s.tanks[0].y <= 145, "wall blocks movement");
  s = empty();
  s.map[40 * 52 + 17] = 1;
  bullet(s, 70, 180, 0);
  tick(s, 0.3);
  assert.equal(s.map[40 * 52 + 17], 0, "brick destroyed");
  for (const steel of [false, true]) {
    s = empty();
    s.map[40 * 52 + 17] = 2;
    bullet(s, 70, 180, 0, 0, steel);
    tick(s, 0.3);
    assert.equal(s.map[40 * 52 + 17], steel ? 0 : 2, "steel requires upgrade");
  }
  s = empty();
  const armor = enemy(s, 64, 128, 3);
  for (let i = 0; i < 4; i++) {
    bullet(s, 71, 150, 0);
    tick(s, 0.15);
  }
  assert.equal(s.destroyed, 1);
  assert.equal(armor.dead, true);
  assert.equal(s.players[0].score, 400);
  const blast = s.effects.find((e) => e.big);
  assert.equal(blast.points, 400, "kill effect carries the awarded score");
  assert.equal(blast.total, 0.72);
  assert.ok(blast.life > 0 && blast.life <= blast.total);
  assert.ok(Number.isFinite(blast.seed));
  s = empty();
  const carrier = enemy(s, 64, 128, 3);
  carrier.carrier = true;
  bullet(s, 71, 150, 0);
  tick(s, 0.15);
  assert.ok(s.power);
  assert.equal(carrier.carrier, false);
  s = empty(2);
  s.tanks[1].x = 64;
  s.tanks[1].y = 128;
  s.tanks[1].shield = 0;
  bullet(s, 71, 150, 0);
  tick(s, 0.15);
  assert.ok(s.tanks[1].frozen > 2);
  assert.equal(s.players[1].lives, 3);
  s = empty();
  s.tanks[0].shield = 0;
  bullet(s, 71, 180, 2, -1);
  tick(s, 0.2);
  assert.equal(s.players[0].lives, 2);
  tick(s, 1.3);
  assert.ok(s.tanks.some((t) => t.player === 0 && t.shield > 0));
  s = empty();
  bullet(s, 104, 192, 2);
  tick(s, 0.1);
  assert.equal(s.reason, "base");
  for (const power of r.powers) {
    s = empty();
    const tank = s.tanks[0];
    enemy(s, 0, 64);
    r.collect(s, tank, power);
    assert.ok(s.players[0].score >= 500);
    if (power === "star") assert.equal(tank.level, 1);
    if (power === "helmet") assert.equal(tank.shield, 10);
    if (power === "clock") assert.equal(s.freeze, 10);
    if (power === "life") assert.equal(s.players[0].lives, 4);
    if (power === "bomb") assert.equal(s.destroyed, 1);
    if (power === "shovel") {
      assert.equal(s.map[46 * 52 + 24], 2);
      tick(s, 20.1);
      assert.equal(s.map[46 * 52 + 24], 1);
    }
  }
  s = empty();
  s.players[0].score = 19500;
  r.collect(s, s.tanks[0], "star");
  assert.equal(s.players[0].lives, 4);
  s = empty();
  s.destroyed = 19;
  s.spawned = 20;
  enemy(s, 64, 128);
  bullet(s, 71, 150, 0);
  tick(s, 0.2);
  assert.equal(s.status, "clear");
  assert.ok(
    s.effects.some((e) => e.big),
    "last kill keeps its explosion",
  );
  const finished = { time: s.time, score: s.players[0].score, x: s.tanks[0].x };
  tick(s, 0.8, [{ dir: 1, fire: true }]);
  assert.equal(s.effects.length, 0, "terminal explosions expire");
  assert.deepEqual(
    { time: s.time, score: s.players[0].score, x: s.tanks[0].x },
    finished,
    "combat stays frozen during the final explosion",
  );
  const n = r.next(s);
  assert.equal(n.stage, 2);
  assert.equal(n.players[0].score, 100);
  for (const players of [1, 2]) {
    s = empty(players);
    s.spawnTimer = 0;
    // Keep enemies alive, immobile and away from the three spawn pads.
    for (let i = 0; i < 1500; i++) {
      r.step(s, [], 1 / 60, () => 0.9);
      s.tanks
        .filter((t) => t.player < 0)
        .forEach((t, j) => {
          t.x = j * 24;
          t.y = 64;
          t.frozen = 100;
        });
    }
    assert.equal(
      s.tanks.filter((t) => t.player < 0).length,
      players === 2 ? 6 : 4,
    );
  }
  console.log(
    "Tank rules: 35 distinct maps, waves, collision, armor, friendly fire, respawn, base loss, six power-ups, extra lives and progression verified.",
  );
}
async function main() {
  verifyRules();
  const browser = await chromium.launch({
    channel: process.env.WORKTIME_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(entry).href);
    await page.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await page.evaluate(() => {
      const r = WorkTimeApp.games.tankRules,
        create = r.create;
      r.create = (...args) => (window.tankTest = create(...args));
      const next = r.next;
      r.next = (...args) => (window.tankTest = next(...args));
    });
    const action = (key) => page.locator(`[data-tank-action="${key}"]`);
    await page.locator("#date-tab-games").click();
    await page.locator('[data-game="game-tank"]').click();
    await page
      .locator('[data-game="game-tank"]')
      .locator('xpath=ancestor::div[contains(@class,"game-library")]')
      .locator(".game-menu-play")
      .click();
    await page.waitForSelector('#gameShell[data-state="open"]');
    assert.equal(await page.locator(".game-tank").count(), 1);
    const statsBox = await page.locator(".tank-counters").boundingBox();
    const controlsBox = await page.locator(".tank-controls").boundingBox();
    const fieldBox = await page.locator(".tank-board").boundingBox();
    assert.ok(
      statsBox.x + statsBox.width <= fieldBox.x,
      "scores stay left of the field",
    );
    assert.ok(
      controlsBox.x >= fieldBox.x + fieldBox.width,
      "actions stay right of the field",
    );
    assert.ok(
      fieldBox.width > 720,
      "sidebars release space for a larger field",
    );
    await action("start").click();
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(250);
    await page.keyboard.up("KeyW");
    assert.ok(await page.evaluate(() => window.tankTest.tanks[0].y < 190));
    await page.keyboard.press("KeyP");
    const time = await page.evaluate(() => window.tankTest.time);
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.tankTest.time), time);
    await action("start").click();
    await page.keyboard.down("Space");
    await page.waitForTimeout(80);
    await page.keyboard.up("Space");
    assert.ok(await page.evaluate(() => window.tankTest.bullets.length > 0));
    await page.locator("[data-game-help]").click();
    assert.equal(await page.locator(".game-help-screen").isVisible(), true);
    await page.locator("[data-game-help-close]").click();
    assert.equal(
      await page.locator(".game-tank").getAttribute("data-paused"),
      "true",
    );
    await action("editor").click();
    await action("clearMap").click();
    await action("brush3").click();
    const canvas = page.locator(".tank-board canvas");
    const box = await canvas.boundingBox();
    assert.equal(await page.locator("[data-brush]").count(), 14);
    for (let brush = 0; brush < 14; brush++) {
      await action("brush" + brush).click();
      await page.mouse.click(
        box.x + (box.width * 40) / 240,
        box.y + (box.height * 40) / 208,
      );
      const painted = await page.evaluate(() => {
        const values = [];
        for (let y = 8; y < 12; y++)
          for (let x = 8; x < 12; x++)
            values.push(window.tankTest.map[y * 52 + x]);
        return values;
      });
      const type = brush < 6 ? brush : brush < 10 ? 1 : 2;
      const direction = brush < 6 ? -1 : (brush - 6) % 4;
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++)
          assert.equal(
            painted[y * 4 + x],
            direction < 0 || [y < 2, x >= 2, y >= 2, x < 2][direction]
              ? type
              : 0,
            "editor brush " + brush,
          );
    }
    await action("brush3").click();
    await page.mouse.click(
      box.x + (box.width * 40) / 240,
      box.y + (box.height * 40) / 208,
    );
    await action("testMap").click();
    assert.equal(await page.evaluate(() => window.tankTest.custom), true);
    assert.equal(await page.evaluate(() => window.tankTest.map[8 * 52 + 8]), 3);
    await page.evaluate(() => {
      const s = window.tankTest;
      s.players[0].score = 1234;
      s.status = "over";
      s.reason = "base";
    });
    await page.waitForSelector('.game-tank[data-mode="over"]');
    assert.ok(
      (await page.locator(".tank-results").textContent()).includes("1234"),
    );
    await action("start").click();
    assert.equal(
      await page.evaluate(() => window.tankTest.custom),
      true,
      "custom map retry",
    );
    await page.evaluate(() => {
      const s = window.tankTest;
      s.status = "clear";
    });
    await page.waitForSelector('.game-tank[data-mode="clear"]');
    await action("start").click();
    assert.equal(
      await page.locator(".game-tank").getAttribute("data-mode"),
      "playing",
    );
    assert.equal(
      await page.evaluate(() => window.tankTest.custom),
      false,
      "custom clear advances to the next standard map",
    );
    assert.equal(await page.evaluate(() => window.tankTest.stage), 2);
    await page.locator(".tank-board").focus();
    await page.keyboard.press("Escape");
    await page.locator('#gameShell [data-game="game-tank"]').click();
    await page
      .locator('#gameShell [data-game="game-tank"]')
      .locator('xpath=ancestor::div[contains(@class,"game-library")]')
      .locator(".game-menu-play")
      .click();
    await page.evaluate(() => {
      const el = document.querySelector('[data-tank-select="players"]');
      el.value = "2";
      el.dispatchEvent(new Event("change"));
    });
    await action("start").click();
    assert.equal(await page.evaluate(() => window.tankTest.players.length), 2);
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(200);
    await page.keyboard.up("ArrowUp");
    assert.ok(
      await page.evaluate(
        () => window.tankTest.tanks.find((t) => t.player === 1).y < 192,
      ),
    );
    await page.evaluate(() => {
      window.tankTest.status = "clear";
    });
    await page.waitForSelector('.game-tank[data-mode="clear"]');
    await action("start").click();
    assert.equal(
      await page
        .locator(".game-tank .game-stat")
        .nth(2)
        .locator("strong")
        .textContent(),
      "2",
    );
    for (const language of ["zh-CN", "en", "zh-TW", "zh-HK", "ja", "ko"]) {
      await page.evaluate(
        (lang) => WorkTimeApp.i18n.setLanguage(lang),
        language,
      );
      assert.equal(
        await page.locator("#gameTitle").textContent(),
        await page.evaluate(() => WorkTimeApp.i18n.t("games.tank.name")),
      );
    }
    fs.mkdirSync(path.join(root, "test-results/tank"), { recursive: true });
    await page.evaluate(() => WorkTimeApp.i18n.setLanguage("zh-CN"));
    await page.screenshot({
      path: path.join(root, "test-results/tank/desktop.png"),
    });
    await page.locator(".tank-board").focus();
    await page.keyboard.press("KeyP");
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(80);
      const board = await page.locator(".tank-board").boundingBox();
      assert.ok(board.x >= 0 && board.x + board.width <= viewport.width + 1);
      const fire = await action("fire").boundingBox();
      if (fire)
        assert.ok(
          fire.y + fire.height <= viewport.height,
          "touch controls fit viewport",
        );
      assert.ok(
        board.y + board.height <= viewport.height,
        "battlefield fits viewport",
      );
      await page.screenshot({
        path: path.join(root, `test-results/tank/${viewport.width}.png`),
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await action("start").click();
    const before = await page.evaluate(() => window.tankTest.tanks[0].y);
    const touchBox = await action("dir0").boundingBox();
    await page.mouse.move(
      touchBox.x + touchBox.width / 2,
      touchBox.y + touchBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
    assert.ok(
      await page.evaluate((y) => window.tankTest.tanks[0].y < y, before),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    assert.equal(
      await page.locator(".game-tank").getAttribute("data-paused"),
      "true",
    );
    await action("start").click();
    await page.evaluate(() => {
      const s = window.tankTest;
      s.map.fill(0);
      s.effects = [];
      s.spawned = 20;
      s.destroyed = 19;
      s.tanks = s.tanks.filter((t) => t.player >= 0);
      s.tanks.push({
        ...s.tanks[0],
        id: 999,
        player: -1,
        x: 64,
        y: 128,
        shield: 0,
        spawn: 0,
        frozen: 99,
        hp: 1,
        type: 0,
      });
      s.bullets = [
        {
          x: 71,
          y: 148,
          dir: 0,
          speed: 180,
          owner: -100,
          player: 0,
          steel: false,
          dead: false,
        },
      ];
    });
    await page.waitForFunction(() => window.tankTest.status === "clear");
    assert.equal(
      await page.locator(".tank-cover").isVisible(),
      false,
      "the last explosion plays before the result cover",
    );
    await page.waitForSelector('.game-tank[data-mode="clear"]');
    assert.equal(await page.locator(".tank-cover").isVisible(), true);
    await page.locator("#gameExitButton").click();
    await page.waitForSelector('#gameShell[data-state="closed"]', {
      state: "attached",
    });
    assert.equal(await page.locator(".game-tank").count(), 0);
    assert.deepEqual(errors, []);
    const blocked = await browser.newPage();
    await blocked.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw Error("Blocked");
      };
      Storage.prototype.setItem = () => {
        throw Error("Blocked");
      };
    });
    await blocked.route(/^https?:/, (route) => route.abort());
    await blocked.goto(pathToFileURL(entry).href);
    await blocked.waitForFunction(
      () => document.documentElement.dataset.appState === "ready",
    );
    await blocked.locator("#date-tab-games").click();
    await blocked.locator('[data-game="game-tank"]').click();
    await blocked
      .locator('[data-game="game-tank"]')
      .locator('xpath=ancestor::div[contains(@class,"game-library")]')
      .locator(".game-menu-play")
      .click();
    assert.ok((await blocked.locator(".tank-warning").textContent()).length);
    await blocked.locator('[data-tank-action="start"]').click();
    assert.equal(
      await blocked.locator(".game-tank").getAttribute("data-mode"),
      "playing",
    );
    console.log(
      "Tank UI: offline entry, keyboard/co-op, pause/help, editor/save/retry, results, six languages, touch, mobile/landscape, storage failure and disposal verified: " +
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

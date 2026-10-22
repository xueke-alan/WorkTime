"use strict";
/** Fixed-step, DOM-free Battle City simulation. Coordinates use a 208px field.
 * Terrain is stored at 4px resolution so each shot removes a strip of brick.
 */
WorkTimeApp.games.tankRules = (() => {
  const size = 208,
    cells = 52,
    unit = 4;
  const directions = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  const powers = ["star", "helmet", "shovel", "clock", "bomb", "life"];
  const spawnDelay = (stage, players) =>
    (190 - Math.min(35, stage) * 4 - (players === 2 ? 20 : 0)) / 60;
  const overlap = (a, b, w = 14, h = w, bw = 14, bh = bw) =>
    a.x < b.x + bw && a.x + w > b.x && a.y < b.y + bh && a.y + h > b.y;
  function fence(map, type) {
    for (let y = 46; y < 52; y++)
      for (let x = 22; x < 30; x++)
        if (y < 48 || x < 24 || x >= 28) map[y * cells + x] = type;
  }
  function mapFor(stage) {
    const data = WorkTimeApp.games.tankStages;
    const index = (stage - 1) % 35;
    const map = Array(cells * cells).fill(0);
    for (const [key, type] of [
      ["forest", 4],
      ["water", 3],
      ["ice", 5],
    ])
      for (const grid of data[key][index]) {
        const x = (grid % 100) * 4,
          y = Math.floor(grid / 100) * 4;
        for (let dy = 0; dy < 4; dy++)
          for (let dx = 0; dx < 4; dx++) map[(y + dy) * cells + x + dx] = type;
      }
    for (const [grid, texture, rotation] of data.wall[index]) {
      const x = (grid % 100) * 4,
        y = Math.floor(grid / 100) * 4;
      const shape = texture % 4;
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 4; dx++) {
          const half = [dy < 2, dx >= 2, dy >= 2, dx < 2][rotation];
          const corner = [
            dx < 2 && dy < 2,
            dx >= 2 && dy < 2,
            dx < 2 && dy >= 2,
            dx >= 2 && dy >= 2,
          ][rotation];
          if (shape === 3 || (shape === 1 && half) || (shape === 0 && corner))
            map[(y + dy) * cells + x + dx] = texture >= 4 ? 2 : 1;
        }
    }
    return map;
  }
  function tank(s, player, x, y, type = 0) {
    return {
      id: ++s.serial,
      player,
      x,
      y,
      type,
      dir: player >= 0 ? 0 : 2,
      hp: type === 3 ? 4 : 1,
      level: 0,
      shield: player >= 0 ? 3 : 0,
      spawn: player >= 0 ? 0 : 0.9,
      arrival: player >= 0 ? 0.55 : 0,
      cooldown: 0,
      turn: 0.5,
      frozen: 0,
      slide: 0,
      carrier: false,
      dead: false,
      tread: 0,
    };
  }
  function create({ players = 1, stage = 1, custom = null } = {}) {
    const s = {
      stage,
      playerCount: players,
      custom: !!custom,
      map: custom ? [...custom] : mapFor(stage),
      serial: 0,
      time: 0,
      status: "playing",
      reason: "",
      bonusPlayer: null,
      base: true,
      spawned: 0,
      destroyed: 0,
      spawnTimer: spawnDelay(stage, players),
      spawnPoint: 0,
      freeze: 0,
      fortify: 0,
      tanks: [],
      bullets: [],
      effects: [],
      power: null,
      events: [],
      players: Array.from({ length: players }, () => ({
        lives: 3,
        score: 0,
        level: 0,
        respawn: 0,
        extra: 20000,
        kills: [0, 0, 0, 0],
      })),
    };
    fence(s.map, 1);
    for (let p = 0; p < players; p++)
      s.tanks.push(tank(s, p, 64 + p * 64, 192));
    return s;
  }
  function blocked(s, x, y, self = null) {
    if (x < 0 || y < 0 || x + 14 > size || y + 14 > size) return true;
    if (overlap({ x, y }, { x: 96, y: 192 }, 14, 14, 16)) return true;
    for (
      let row = Math.floor(y / unit);
      row <= Math.floor((y + 13.999) / unit);
      row++
    )
      for (
        let col = Math.floor(x / unit);
        col <= Math.floor((x + 13.999) / unit);
        col++
      )
        if ([1, 2, 3].includes(s.map[row * cells + col])) return true;
    return s.tanks.some((t) => !t.dead && t !== self && overlap({ x, y }, t));
  }
  function move(s, t, dir, distance) {
    if (dir !== t.dir && dir % 2 !== t.dir % 2) {
      let x = t.x,
        y = t.y;
      if (dir % 2) y = Math.round(y / 8) * 8;
      else x = Math.round(x / 8) * 8;
      if (!blocked(s, x, y, t)) {
        t.x = x;
        t.y = y;
      }
    }
    t.dir = dir;
    const [dx, dy] = directions[dir];
    // Subpixel stepping keeps movement solid even under a slow frame.
    let moved = false;
    for (let left = distance; left > 0; left -= 0.5) {
      const amount = Math.min(0.5, left);
      const x = t.x + dx * amount,
        y = t.y + dy * amount;
      if (blocked(s, x, y, t)) break;
      t.x = x;
      t.y = y;
      moved = true;
    }
    if (moved) t.tread += distance;
    return moved;
  }
  function fire(s, t) {
    if (t.cooldown > 0 || t.spawn > 0 || t.dead || t.frozen > 0) return;
    const limit = t.player >= 0 && t.level >= 2 ? 2 : 1;
    if (s.bullets.filter((b) => !b.dead && b.owner === t.id).length >= limit)
      return;
    const [dx, dy] = directions[t.dir];
    s.bullets.push({
      owner: t.id,
      player: t.player,
      x: t.x + 7 + dx * 7,
      y: t.y + 7 + dy * 7,
      dir: t.dir,
      speed: t.level > 0 || t.type === 2 ? 240 : 120,
      steel: t.player >= 0 && t.level >= 3,
      dead: false,
    });
    t.cooldown = t.player >= 0 ? 0.17 : 0.65;
    if (t.player >= 0) s.events.push("shot");
  }
  function effect(s, x, y, big = false, points = 0) {
    s.effects.push({
      x,
      y,
      life: big ? 0.72 : 0.16,
      total: big ? 0.72 : 0.16,
      big,
      points,
      // Visual variation never consumes the simulation's gameplay RNG.
      seed: (Math.round(x * 17 + y * 31 + s.time * 60) % 97) / 97,
    });
  }
  function award(s, player, points) {
    if (player < 0 || !s.players[player]) return;
    const p = s.players[player];
    p.score += points;
    while (p.score >= p.extra) {
      p.extra += 20000;
      p.lives++;
      s.events.push("life");
    }
  }
  function drop(s, random) {
    const spaces = [];
    for (let y = 16; y <= 176; y += 16)
      for (let x = 0; x <= 192; x += 16)
        if (!blocked(s, x, y)) spaces.push({ x, y });
    if (!spaces.length) return;
    const spot =
      spaces[Math.min(spaces.length - 1, Math.floor(random() * spaces.length))];
    s.power = {
      ...spot,
      kind: [
        "helmet",
        "clock",
        "shovel",
        "star",
        "bomb",
        "life",
        "bomb",
        "star",
      ][Math.min(7, Math.floor(random() * 8))],
      // Remains until collected or replaced by the next carrier.
      life: Infinity,
    };
  }
  function destroy(s, t, player = -1) {
    if (t.dead) return;
    t.dead = true;
    effect(
      s,
      t.x + 7,
      t.y + 7,
      true,
      t.player < 0 && player >= 0 ? (t.type + 1) * 100 : 0,
    );
    s.events.push("explosion");
    if (t.player < 0) {
      s.destroyed++;
      if (player >= 0) {
        award(s, player, (t.type + 1) * 100);
        s.players[player].kills[t.type]++;
      }
    } else {
      const p = s.players[t.player];
      p.lives--;
      p.level = 0;
      p.respawn = 1.2;
    }
  }
  function collect(s, t, kind) {
    award(s, t.player, 500);
    s.events.push("power");
    if (kind === "star") {
      t.level = Math.min(3, t.level + 1);
      s.players[t.player].level = t.level;
    }
    if (kind === "helmet") t.shield = 10;
    if (kind === "clock") s.freeze = 10;
    if (kind === "life") s.players[t.player].lives++;
    if (kind === "shovel") {
      s.fortify = 20;
      fence(s.map, 2);
    }
    if (kind === "bomb")
      for (const enemy of s.tanks)
        if (enemy.player < 0 && !enemy.dead) destroy(s, enemy, t.player);
    s.power = null;
  }
  function chooseEnemyDirection(s, t, random) {
    // Early pressure on HQ, then a growing tendency to hunt surviving players.
    const players = s.tanks.filter((other) => other.player >= 0 && !other.dead);
    const target =
      s.time > 45 && players.length && random() < 0.6
        ? players.reduce((best, p) =>
            Math.abs(p.x - t.x) + Math.abs(p.y - t.y) <
            Math.abs(best.x - t.x) + Math.abs(best.y - t.y)
              ? p
              : best,
          )
        : { x: 96, y: 192 };
    const horizontal = target.x > t.x ? 1 : 3;
    const vertical = target.y > t.y ? 2 : 0;
    const preferred =
      Math.abs(target.x - t.x) > Math.abs(target.y - t.y)
        ? [horizontal, vertical]
        : [vertical, horizontal];
    const options = random() < 0.65 ? preferred : [Math.floor(random() * 4)];
    for (const dir of [
      ...options,
      t.dir,
      (t.dir + 1) % 4,
      (t.dir + 3) % 4,
      (t.dir + 2) % 4,
    ]) {
      const [dx, dy] = directions[dir];
      const x = dir % 2 ? t.x : Math.round(t.x / 8) * 8;
      const y = dir % 2 ? Math.round(t.y / 8) * 8 : t.y;
      if (!blocked(s, x, y, t) && !blocked(s, x + dx, y + dy, t)) return dir;
    }
    return (t.dir + 2) % 4;
  }
  function hitTerrain(s, b) {
    const horizontal = b.dir % 2;
    const x0 = Math.floor((b.x - (horizontal ? 1 : 3)) / 4);
    const x1 = Math.floor((b.x + (horizontal ? 1 : 3)) / 4);
    const y0 = Math.floor((b.y - (horizontal ? 3 : 1)) / 4);
    const y1 = Math.floor((b.y + (horizontal ? 3 : 1)) / 4);
    let hit = false;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= cells || y >= cells) continue;
        const i = y * cells + x,
          tile = s.map[i];
        if (tile === 1 || tile === 2) {
          hit = true;
          if (tile === 1 || b.steel) {
            // Cut a tank-width strip, so repeated shots actually open a lane.
            const start = Math.floor(((horizontal ? b.y : b.x) - 7) / 8) * 2;
            const depth = b.steel ? 2 : 1;
            for (let across = start; across < start + 4; across++)
              for (let d = 0; d < depth; d++) {
                const col = horizontal ? x + (b.dir === 1 ? d : -d) : across;
                const row = horizontal ? across : y + (b.dir === 2 ? d : -d);
                if (col < 0 || row < 0 || col >= cells || row >= cells)
                  continue;
                const k = row * cells + col;
                if (s.map[k] === 1 || (b.steel && s.map[k] === 2)) s.map[k] = 0;
              }
          }
        }
      }
    return hit;
  }
  function step(s, inputs, dt = 1 / 60, random = Math.random) {
    s.events = [];
    dt = Math.min(1 / 30, Math.max(0, dt));
    // Let the last explosion finish without advancing combat after victory/loss.
    for (const e of s.effects) e.life -= dt;
    s.effects = s.effects.filter((e) => e.life > 0);
    if (s.status !== "playing") return;
    s.time += dt;
    for (const key of ["freeze", "fortify"]) {
      const before = s[key];
      s[key] = Math.max(0, s[key] - dt);
      if (key === "fortify" && before > 0 && s[key] === 0) fence(s.map, 1);
    }
    if (s.power) {
      s.power.life -= dt;
      if (s.power.life <= 0) s.power = null;
    }
    s.players.forEach((p, i) => {
      p.respawn = Math.max(0, p.respawn - dt);
      if (
        p.lives > 0 &&
        !p.respawn &&
        !s.tanks.some((t) => !t.dead && t.player === i)
      ) {
        const x = 64 + i * 64;
        if (!blocked(s, x, 192)) {
          const revived = tank(s, i, x, 192);
          revived.level = p.level;
          s.tanks.push(revived);
        }
      }
    });
    s.spawnTimer -= dt;
    if (
      s.spawned < 20 &&
      s.spawnTimer <= 0 &&
      s.tanks.filter((t) => !t.dead && t.player < 0).length <
        (s.playerCount === 2 ? 6 : 4)
    ) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const x = [0, 96, 192][s.spawnPoint++ % 3];
        if (blocked(s, x, 0)) continue;
        const type =
          WorkTimeApp.games.tankStages.npc[Math.min(s.stage, 35) - 1][
            s.spawned
          ];
        const enemy = tank(s, -1, x, 0, type);
        enemy.carrier = [3, 10, 17].includes(s.spawned);
        if (enemy.carrier) s.power = null;
        s.tanks.push(enemy);
        s.spawned++;
        s.spawnTimer = spawnDelay(s.stage, s.playerCount);
        break;
      }
    }
    for (const t of s.tanks) {
      if (t.dead) continue;
      for (const key of ["shield", "spawn", "arrival", "cooldown", "frozen"])
        t[key] = Math.max(0, t[key] - dt);
      if (t.spawn > 0 || t.frozen > 0) continue;
      if (t.player >= 0) {
        const input = inputs[t.player] || {};
        const tile =
          s.map[Math.floor((t.y + 7) / 4) * cells + Math.floor((t.x + 7) / 4)];
        if (Number.isInteger(input.dir) && input.dir >= 0 && input.dir < 4) {
          t.slide = tile === 5 ? 0.22 : 0;
          move(s, t, input.dir, 45 * dt);
        } else if (tile === 5 && t.slide > 0) {
          t.slide -= dt;
          move(s, t, t.dir, 45 * dt);
        } else t.slide = 0;
        if (input.fire) fire(s, t);
        if (s.power && overlap(t, s.power, 14, 14, 16))
          collect(s, t, s.power.kind);
      } else if (s.freeze <= 0) {
        t.turn -= dt;
        const moved = move(s, t, t.dir, (t.type === 1 ? 60 : 30) * dt);
        const aligned =
          Math.abs(t.x / 8 - Math.round(t.x / 8)) < 0.07 &&
          Math.abs(t.y / 8 - Math.round(t.y / 8)) < 0.07;
        if (!moved || (t.turn <= 0 && aligned)) {
          t.turn = 0.35 + random() * 1.1;
          const dir = chooseEnemyDirection(s, t, random);
          // Turns snap back onto the original 8px travel lanes.
          move(s, t, dir, 0);
        }
        if (random() < dt * 1.4) fire(s, t);
      }
    }
    for (const b of s.bullets) {
      if (b.dead) continue;
      const [dx, dy] = directions[b.dir];
      for (let travel = b.speed * dt; travel > 0 && !b.dead; travel -= 1) {
        const d = Math.min(1, travel);
        b.x += dx * d;
        b.y += dy * d;
        if (
          b.x < 0 ||
          b.y < 0 ||
          b.x >= size ||
          b.y >= size ||
          hitTerrain(s, b)
        ) {
          b.dead = true;
          effect(s, b.x, b.y);
          s.events.push("hit");
          break;
        }
        if (
          s.base &&
          overlap({ x: b.x - 1, y: b.y - 1 }, { x: 96, y: 192 }, 2, 2, 16)
        ) {
          b.dead = true;
          s.base = false;
          s.status = "over";
          s.reason = "base";
          effect(s, 104, 200, true);
          s.events.push("explosion");
          break;
        }
        const other = s.bullets.find(
          (o) =>
            !o.dead &&
            o !== b &&
            o.player !== b.player &&
            Math.abs(o.x - b.x) < 3 &&
            Math.abs(o.y - b.y) < 3,
        );
        if (other) {
          other.dead = b.dead = true;
          effect(s, b.x, b.y);
          break;
        }
        for (const t of s.tanks) {
          if (
            t.dead ||
            t.spawn > 0 ||
            t.id === b.owner ||
            (b.player < 0 && t.player < 0)
          )
            continue;
          if (!overlap({ x: b.x - 1, y: b.y - 1 }, t, 2, 2)) continue;
          b.dead = true;
          if (t.shield > 0) break;
          if (b.player >= 0 && t.player >= 0) {
            t.frozen = 3;
            break;
          }
          if (t.carrier) {
            t.carrier = false;
            drop(s, random);
          }
          t.hp--;
          s.events.push("hit");
          if (t.hp <= 0) destroy(s, t, b.player);
          break;
        }
      }
    }
    s.bullets = s.bullets.filter((b) => !b.dead);
    s.tanks = s.tanks.filter((t) => !t.dead);
    if (s.status !== "playing") return;
    if (s.players.every((p) => p.lives <= 0)) {
      s.status = "over";
      s.reason = "lives";
    } else if (s.destroyed >= 20 && !s.tanks.some((t) => t.player < 0)) {
      if (s.playerCount === 2) {
        const totals = s.players.map((p) =>
          p.kills.reduce((sum, n) => sum + n, 0),
        );
        if (totals[0] !== totals[1]) {
          s.bonusPlayer = totals[0] > totals[1] ? 0 : 1;
          award(s, s.bonusPlayer, 1000);
        }
      }
      s.status = "clear";
      s.events.push("clear");
    }
  }
  function next(s) {
    const n = create({ players: s.playerCount, stage: s.stage + 1 });
    n.players = s.players.map((p) => ({ ...p, kills: [0, 0, 0, 0] }));
    n.tanks = n.tanks.filter((t) => n.players[t.player].lives > 0);
    for (const t of n.tanks) t.level = n.players[t.player].level;
    return n;
  }
  return {
    size,
    cells,
    powers,
    directions,
    create,
    mapFor,
    fence,
    step,
    fire,
    collect,
    next,
    blocked,
  };
})();

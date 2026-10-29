"use strict";
/** Game-only transport, validation and recoverable localStorage transactions. */
WorkTimeApp.services.gameArchive = (() => {
  const PREFIX = "WORKTIME:GAMES:1:";
  const TYPE = "worktime-games";
  const MAX_BYTES = 16 * 1024 * 1024;
  const REVISION = "worktime.games.archive.revision.v1";
  const JOURNAL = "worktime.games.archive.journal.v1";
  const BACKUP = "worktime.games.archive.before.v1";
  const keys = Object.freeze(
    Object.fromEntries(
      [
        "2048",
        "minesweeper",
        "snake",
        "sudoku",
        "jump",
        "sokoban",
        "link",
        "garden",
        "tank",
      ].map((id) => [
        "game-" + id,
        "worktime.games." + id + (id === "jump" ? ".best" : "") + ".v1",
      ]),
    ),
  );
  const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const stable = (v) =>
    JSON.stringify(v, function (key, value) {
      return plain(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, value[k]]),
          )
        : value;
    });
  const same = (a, b) => stable(a) === stable(b);
  const integer = (n, max = Number.MAX_SAFE_INTEGER) =>
    Number.isSafeInteger(n) && n >= 0 && n <= max;
  function fail(code, game = "") {
    const error = Error(code);
    error.code = code;
    error.game = game;
    throw error;
  }
  function requireValue(condition, id) {
    if (!condition) fail("invalid", id);
  }
  function fields(value, names) {
    return Object.fromEntries(
      names
        .filter((name) => Object.hasOwn(value, name))
        .map((name) => [name, clone(value[name])]),
    );
  }
  function normalize(id, input) {
    requireValue(Object.hasOwn(keys, id), id);
    if (id === "game-jump") {
      requireValue(integer(input), id);
      return input;
    }
    requireValue(plain(input), id);
    if (Object.hasOwn(input, "version") && input.version !== 1)
      fail("version", id);
    const G = WorkTimeApp.games;
    let result;
    if (["game-2048", "game-minesweeper", "game-snake"].includes(id)) {
      const rules =
        id === "game-2048"
          ? G.rules2048
          : id === "game-snake"
            ? G.snakeRules
            : G.minesweeperRules;
      if (id === "game-snake") {
        requireValue(
          plain(input.best) &&
            Object.keys(G.snakeRules.modes).every((m) =>
              integer(input.best[m]),
            ),
          id,
        );
      }
      result = rules.restore(input);
      requireValue(result, id);
      result.version = 1;
      if (id === "game-snake") {
        result.state = fields(result.state, [
          "mode",
          "columns",
          "rows",
          "body",
          "direction",
          "food",
          "bonus",
          "alternative",
          "score",
          "eaten",
          "ticks",
          "combo",
          "status",
        ]);
        for (const name of ["food", "alternative", "bonus"])
          if (result.state[name])
            result.state[name] = fields(
              result.state[name],
              name === "bonus" ? ["x", "y", "ttl", "duration"] : ["x", "y"],
            );
        result.state.body = result.state.body.map((cell) =>
          fields(cell, ["x", "y"]),
        );
      }
      return result;
    }
    if (id === "game-tank") {
      requireValue(integer(input.best), id);
      requireValue(
        input.custom == null ||
          (Array.isArray(input.custom) &&
            input.custom.length === 2704 &&
            input.custom.every((v) => integer(v, 5))),
        id,
      );
      requireValue(
        input.muted === undefined || typeof input.muted === "boolean",
        id,
      );
      return {
        best: input.best,
        custom: input.custom == null ? null : [...input.custom],
        ...(input.muted === undefined ? {} : { muted: input.muted }),
      };
    }
    if (id === "game-link") {
      requireValue(
        plain(input.best) &&
          ["zen", "quest", "tide"].every((m) =>
            integer(input.best[m], 10000000),
          ),
        id,
      );
      const state =
        input.state === null ? null : G.linkRules.restore(input.state);
      requireValue(input.state === null || state, id);
      return { state, best: fields(input.best, ["zen", "quest", "tide"]) };
    }
    requireValue(input.version === 1, id);
    if (id === "game-garden") {
      const state = G.gardenRules.restore(input.state);
      const previous =
        input.previous == null ? null : G.gardenRules.restore(input.previous);
      requireValue(state && (input.previous == null || previous), id);
      requireValue(
        Array.isArray(input.records) &&
          input.records.length <= G.gardenRules.levelCount &&
          input.records.every((n) => integer(n, 3)),
        id,
      );
      requireValue(
        !previous ||
          (previous.level === state.level &&
            previous.seed === state.seed &&
            previous.layoutVersion === state.layoutVersion &&
            previous.moves + 1 === state.moves &&
            previous.undoLeft === state.undoLeft),
        id,
      );
      return {
        version: 1,
        state,
        previous,
        records: Array.from(
          { length: G.gardenRules.levelCount },
          (_, index) => input.records[index] ?? 0,
        ),
      };
    }
    const sudoku = id === "game-sudoku";
    const bank = sudoku
      ? WorkTimeApp.data.sudoku.groups.flatMap((g) => g.puzzles)
      : WorkTimeApp.data.sokoban.levels;
    const lookup = new Map(bank.map((entry) => [entry.id, entry]));
    const drafts = {},
      completed = {};
    requireValue(plain(input.drafts) && plain(input.completed), id);
    for (const [kind, output] of [
      ["drafts", drafts],
      ["completed", completed],
    ]) {
      for (const [level, value] of Object.entries(input[kind])) {
        const entry = lookup.get(level);
        requireValue(entry && plain(value), id);
        if (sudoku && kind === "completed") {
          requireValue(
            Number.isFinite(value.elapsed) &&
              value.elapsed >= 0 &&
              value.elapsed <= 315360000 &&
              integer(value.hints, 1000000),
            id,
          );
          output[level] = fields(value, ["elapsed", "hints"]);
        } else if (sudoku) {
          const restored = G.sudokuRules.restore(entry, value);
          requireValue(restored, id);
          output[level] = fields(restored, [
            "values",
            "notes",
            "elapsed",
            "hints",
          ]);
        } else {
          const map = G.sokobanRules.parse(entry);
          const restored = G.sokobanRules.restore(map, value);
          requireValue(
            restored &&
              (kind !== "completed" || G.sokobanRules.won(map, restored)),
            id,
          );
          output[level] = { path: restored.path };
        }
      }
    }
    requireValue(input.current == null || lookup.has(input.current), id);
    if (sudoku)
      requireValue(
        WorkTimeApp.data.sudoku.groups.some((g) => g.id === input.group),
        id,
      );
    else requireValue(integer(input.chapter, 2), id);
    result = {
      version: 1,
      ...(sudoku ? { group: input.group } : { chapter: input.chapter }),
      current: input.current ?? null,
      drafts,
      completed,
    };
    return fixSelection(id, result);
  }
  function fixSelection(id, value) {
    if (!value.current) return value;
    const sudoku = id === "game-sudoku";
    const group = sudoku
      ? WorkTimeApp.data.sudoku.groups.find((g) =>
          g.puzzles.some((p) => p.id === value.current),
        )
      : null;
    const levels = sudoku ? group.puzzles : WorkTimeApp.data.sokoban.levels;
    const index = levels.findIndex((p) => p.id === value.current);
    if (
      !value.drafts[value.current] ||
      (index > 0 &&
        !value.completed[levels[index - 1].id] &&
        !value.completed[value.current])
    )
      value.current = null;
    else if (sudoku) value.group = group.id;
    else value.chapter = Math.floor(index / 20);
    return value;
  }
  function hasContent(id, v) {
    if (id === "game-jump") return v > 0;
    if (id === "game-tank")
      return v.best > 0 || v.custom !== null || v.muted === true;
    if (id === "game-2048")
      return v.best > 0 || v.state.score > 0 || v.previous !== null;
    if (id === "game-minesweeper")
      return (
        v.state.status !== "ready" ||
        Object.values(v.stats).some((s) => s.wins > 0)
      );
    if (id === "game-snake")
      return v.state.ticks > 0 || Object.values(v.best).some((n) => n > 0);
    if (id === "game-link")
      return Object.values(v.best).some((n) => n > 0) || hasProgress(id, v);
    if (id === "game-garden")
      return hasProgress(id, v) || v.records.some((n) => n > 0);
    if (Object.keys(v.completed).length) return true;
    return Object.entries(v.drafts).some(([level, draft]) => {
      if (id === "game-sokoban") return draft.path.length > 0;
      const puzzle = WorkTimeApp.data.sudoku.groups
        .flatMap((g) => g.puzzles)
        .find((p) => p.id === level);
      return (
        draft.elapsed > 0 ||
        draft.hints > 0 ||
        draft.notes.some(Boolean) ||
        draft.values.some((n, i) => n !== Number(puzzle.givens[i]))
      );
    });
  }
  function hasProgress(id, v) {
    if (id === "game-jump") return false;
    if (id === "game-tank") return v.custom !== null || v.muted !== undefined;
    if (id === "game-2048") return v.state.score > 0 || v.previous !== null;
    if (id === "game-minesweeper") return v.state.status !== "ready";
    if (id === "game-snake") return v.state.ticks > 0;
    if (id === "game-link")
      return (
        !!v.state &&
        (v.state.score > 0 ||
          v.state.level > 0 ||
          v.state.phase !== "playing" ||
          v.state.hints < 3 ||
          v.state.shuffles < 2 ||
          v.state.energy < 3 ||
          v.state.board.some((tile) => tile === 0))
      );
    if (id === "game-garden") {
      const tools = WorkTimeApp.games.gardenRules.difficulty(
        v.state.level,
      ).tools;
      return (
        v.state.moves > 0 ||
        v.state.hintsLeft < tools ||
        v.state.undoLeft < tools
      );
    }
    return !!v.current || Object.keys(v.drafts).length > 0;
  }
  function validate(value) {
    if (!plain(value) || value.type !== TYPE) fail("wrongType");
    if (value.version !== 1) fail("version");
    requireValue(
      typeof value.exportedAt === "string" &&
        Number.isFinite(Date.parse(value.exportedAt)) &&
        plain(value.games),
      "",
    );
    const games = {};
    for (const [id, save] of Object.entries(value.games))
      games[id] = normalize(id, save);
    return { type: TYPE, version: 1, exportedAt: value.exportedAt, games };
  }
  function checkSize(text) {
    if (new TextEncoder().encode(text).length > MAX_BYTES) fail("tooLarge");
  }
  async function encode(value) {
    const raw = JSON.stringify(validate(value));
    checkSize(raw);
    const text =
      typeof CompressionStream === "function"
        ? PREFIX +
          "GZIP:" +
          (await WorkTimeApp.services.backup.encode(raw)).slice(
            WorkTimeApp.services.backup.PREFIX.length,
          )
        : PREFIX + "JSON:" + raw;
    checkSize(text);
    return text;
  }
  async function decodeText(text) {
    if (typeof text !== "string") fail("invalid");
    text = text.trim();
    checkSize(text);
    if (text.startsWith("WORKTIME:GAMES:") && !text.startsWith(PREFIX))
      fail("version");
    if (text.startsWith(PREFIX + "GZIP:"))
      return WorkTimeApp.services.backup.decode(
        WorkTimeApp.services.backup.PREFIX +
          text.slice((PREFIX + "GZIP:").length),
        validate,
        { maxBytes: MAX_BYTES, allowGameArchive: true },
      );
    if (text.startsWith(PREFIX + "JSON:"))
      text = text.slice((PREFIX + "JSON:").length);
    else if (!text.startsWith("{")) fail("wrongType");
    return validate(JSON.parse(text));
  }
  async function decode(text) {
    try {
      return await decodeText(text);
    } catch (error) {
      if (
        ["invalid", "wrongType", "version", "empty", "tooLarge"].includes(
          error.code,
        )
      )
        throw error;
      fail("invalid");
    }
  }
  function progress(id, v) {
    if (id === "game-jump") return null;
    if (id === "game-tank") return fields(v, ["custom", "muted"]);
    if (["game-sudoku", "game-sokoban"].includes(id))
      return fields(v, ["current", "group", "chapter", "drafts"]);
    return fields(
      v,
      id === "game-minesweeper"
        ? ["state", "elapsed", "manualPaused"]
        : ["state", "previous"],
    );
  }
  function merge(id, local, incoming, source = "local") {
    if (local === null)
      return {
        value: clone(incoming),
        conflict: false,
        improved: hasContent(id, incoming),
      };
    let conflict = false;
    if (["game-sudoku", "game-sokoban"].includes(id)) {
      conflict = Object.keys(local.drafts).some(
        (key) =>
          Object.hasOwn(incoming.drafts, key) &&
          !same(local.drafts[key], incoming.drafts[key]),
      );
      conflict ||= !!(
        local.current &&
        incoming.current &&
        local.current !== incoming.current
      );
    } else if (id === "game-tank") {
      conflict = !!(
        local.custom &&
        incoming.custom &&
        !same(local.custom, incoming.custom)
      );
      conflict ||=
        local.muted !== undefined &&
        incoming.muted !== undefined &&
        local.muted !== incoming.muted;
    } else
      conflict =
        id !== "game-jump" &&
        hasProgress(id, local) &&
        hasProgress(id, incoming) &&
        !same(progress(id, local), progress(id, incoming));
    const preferred =
      source === "incoming" && hasProgress(id, incoming)
        ? incoming
        : hasProgress(id, local)
          ? local
          : hasProgress(id, incoming)
            ? incoming
            : local;
    let out = clone(preferred);
    if (id === "game-jump") out = Math.max(local, incoming);
    else if (["game-2048", "game-tank"].includes(id)) {
      out.best = Math.max(local.best, incoming.best);
      if (id === "game-tank") {
        out.custom = clone(preferred.custom ?? local.custom ?? incoming.custom);
        out.muted = preferred.muted ?? local.muted ?? incoming.muted ?? false;
      }
    } else if (["game-snake", "game-link"].includes(id)) {
      out.best = Object.fromEntries(
        Object.keys(local.best).map((mode) => [
          mode,
          Math.max(local.best[mode], incoming.best[mode]),
        ]),
      );
    } else if (id === "game-minesweeper") {
      for (const mode of Object.keys(local.stats)) {
        const a = local.stats[mode],
          b = incoming.stats[mode];
        out.stats[mode] = {
          wins: Math.max(a.wins, b.wins),
          best:
            a.best === null
              ? b.best
              : b.best === null
                ? a.best
                : Math.min(a.best, b.best),
        };
      }
    } else if (id === "game-garden")
      out.records = local.records.map((n, i) =>
        Math.max(n, incoming.records[i]),
      );
    else {
      out.drafts = {
        ...(source === "incoming" ? local.drafts : incoming.drafts),
        ...preferred.drafts,
      };
      out.completed = clone(local.completed);
      for (const [level, b] of Object.entries(incoming.completed)) {
        const a = local.completed[level];
        let better = !a;
        if (a && id === "game-sudoku")
          better =
            b.hints < a.hints || (b.hints === a.hints && b.elapsed < a.elapsed);
        if (a && id === "game-sokoban") {
          const map = WorkTimeApp.games.sokobanRules.parse(
            WorkTimeApp.data.sokoban.levels.find((p) => p.id === level),
          );
          const ar = WorkTimeApp.games.sokobanRules.restore(map, a),
            br = WorkTimeApp.games.sokobanRules.restore(map, b);
          better =
            br.pushes < ar.pushes ||
            (br.pushes === ar.pushes && br.moves < ar.moves);
        }
        if (better) out.completed[level] = clone(b);
      }
      if (!out.current) {
        const other = source === "incoming" ? local : incoming;
        Object.assign(out, fields(other, ["current", "group", "chapter"]));
      }
      fixSelection(id, out);
    }
    // A pristine local session must not hide meaningful imported progress.
    if (
      !hasProgress(id, local) &&
      hasProgress(id, incoming) &&
      id !== "game-jump"
    ) {
      Object.assign(out, progress(id, incoming));
    }
    const achievement = (v) =>
      id === "game-jump"
        ? v
        : fields(v, ["best", "stats", "records", "completed"]);
    return {
      value: normalize(id, out),
      conflict,
      improved: !same(achievement(local), achievement(out)),
    };
  }
  function create(getStorage, notify = () => {}, notifySaved = () => {}) {
    let recovering = false;
    function rawRead() {
      const storage = getStorage();
      return Object.fromEntries(
        Object.entries(keys).map(([id, key]) => [id, storage.getItem(key)]),
      );
    }
    function restoreRaw(raw) {
      requireValue(
        plain(raw) &&
          Object.keys(raw).length === Object.keys(keys).length &&
          Object.keys(keys).every(
            (id) => raw[id] === null || typeof raw[id] === "string",
          ),
        "",
      );
      const storage = getStorage();
      for (const [id, key] of Object.entries(keys)) {
        if (raw[id] === null) storage.removeItem(key);
        else storage.setItem(key, raw[id]);
      }
    }
    function recover() {
      const storage = getStorage();
      const raw = storage.getItem(JOURNAL);
      if (!raw || recovering) return;
      recovering = true;
      try {
        const journal = JSON.parse(raw);
        requireValue(
          journal.version === 1 && typeof journal.revision === "string",
          "",
        );
        restoreRaw(journal.before);
        storage.setItem(REVISION, journal.revision);
        storage.removeItem(JOURNAL);
        notify();
      } catch {
        fail("recovery");
      } finally {
        recovering = false;
      }
    }
    function read() {
      if (getStorage().getItem(JOURNAL)) fail("recovery");
      const raw = rawRead(),
        games = {};
      for (const [id, value] of Object.entries(raw)) {
        if (value !== null) {
          try {
            games[id] = normalize(id, JSON.parse(value));
          } catch {
            fail("localInvalid", id);
          }
        }
      }
      return { raw, games, revision: getStorage().getItem(REVISION) };
    }
    function pack(games) {
      return {
        type: TYPE,
        version: 1,
        exportedAt: new Date().toISOString(),
        games,
      };
    }
    function exportArchive({
      allowEmpty = false,
      includeDefaults = false,
    } = {}) {
      const { games } = read();
      const saves = Object.fromEntries(
        Object.entries(games).filter(
          ([id, value]) => includeDefaults || hasContent(id, value),
        ),
      );
      if (!allowEmpty && !Object.keys(saves).length) fail("empty");
      return pack(saves);
    }
    async function replace(archive, apply) {
      const incoming = validate(archive),
        latest = read(),
        storage = getStorage();
      const revision =
        Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
      storage.setItem(
        BACKUP,
        JSON.stringify({
          version: 1,
          exportedAt: new Date().toISOString(),
          raw: latest.raw,
        }),
      );
      storage.setItem(
        JOURNAL,
        JSON.stringify({ version: 1, revision, before: latest.raw }),
      );
      let result;
      try {
        storage.setItem(REVISION, revision);
        restoreRaw(
          Object.fromEntries(
            Object.keys(keys).map((id) => [
              id,
              Object.hasOwn(incoming.games, id)
                ? JSON.stringify(incoming.games[id])
                : null,
            ]),
          ),
        );
        result = await apply();
        if (!result.persisted) {
          recover();
          return result;
        }
        storage.removeItem(JOURNAL);
      } catch (error) {
        if (!result?.persisted) recover();
        throw error;
      }
      notify();
      return result;
    }
    function preview(archive, choices = {}) {
      const incoming = validate(archive),
        snapshot = read();
      const rows = Object.entries(incoming.games).map(([id, save]) => {
        const local = snapshot.games[id] ?? null;
        const result = merge(id, local, save, choices[id]);
        return {
          id,
          ...result,
          draftsAdded: Object.keys(result.value?.drafts || {}).filter(
            (key) => !Object.hasOwn(local?.drafts || {}, key),
          ).length,
          completedAdded: Object.keys(result.value?.completed || {}).filter(
            (key) => !Object.hasOwn(local?.completed || {}, key),
          ).length,
          status:
            local === null
              ? "added"
              : same(local, result.value)
                ? "unchanged"
                : "merged",
        };
      });
      return { archive: incoming, snapshot, choices: { ...choices }, rows };
    }
    function commit(previewed) {
      const latest = read();
      if (
        !same(latest.raw, previewed.snapshot.raw) ||
        latest.revision !== previewed.snapshot.revision
      )
        fail("changed");
      // Recompute from validated data instead of trusting a caller-provided write set.
      const current = preview(previewed.archive, previewed.choices);
      const changed = current.rows.filter((row) => row.status !== "unchanged");
      if (!changed.length) return current.rows;
      const storage = getStorage();
      const revision =
        Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
      const before = {
        version: 1,
        exportedAt: new Date().toISOString(),
        raw: latest.raw,
      };
      // No game writes occur unless both the backup and recovery journal are durable.
      storage.setItem(BACKUP, JSON.stringify(before));
      storage.setItem(
        JOURNAL,
        JSON.stringify({ version: 1, revision, before: latest.raw }),
      );
      try {
        storage.setItem(REVISION, revision);
        for (const row of changed)
          storage.setItem(keys[row.id], JSON.stringify(row.value));
        storage.removeItem(JOURNAL);
      } catch (error) {
        try {
          recover();
        } catch {
          fail("recovery");
        }
        throw error;
      }
      notify();
      return current.rows;
    }
    function previousBackup() {
      const text = getStorage().getItem(BACKUP);
      if (!text) fail("noBackup");
      const saved = JSON.parse(text),
        games = {};
      for (const [id, raw] of Object.entries(saved.raw))
        if (raw !== null) games[id] = normalize(id, JSON.parse(raw));
      return { ...pack(games), exportedAt: saved.exportedAt };
    }
    function session() {
      let revision,
        unavailable = null;
      try {
        revision = getStorage().getItem(REVISION);
      } catch (error) {
        unavailable = error;
      }
      return {
        getItem(key) {
          return getStorage().getItem(key);
        },
        setItem(key, text) {
          if (unavailable) throw unavailable;
          const storage = getStorage();
          if (
            storage.getItem(JOURNAL) ||
            storage.getItem(REVISION) !== revision
          ) {
            notify();
            fail("stale");
          }
          if (!Object.values(keys).includes(key)) fail("wrongType");
          storage.setItem(key, text);
          notifySaved(Object.keys(keys).find((id) => keys[id] === key));
        },
      };
    }
    return {
      read,
      recover,
      exportArchive,
      replace,
      preview,
      commit,
      previousBackup,
      session,
      pendingRecovery: () => !!getStorage().getItem(JOURNAL),
    };
  }
  const owner = create(
    () => window.localStorage,
    () => window.dispatchEvent(new Event("worktime:gamearchive")),
    (id) =>
      window.dispatchEvent(
        new CustomEvent("worktime:gamesaved", { detail: id }),
      ),
  );
  const exclusive = (run) =>
    window.navigator.locks
      ? window.navigator.locks.request("worktime-game-archive", run)
      : Promise.resolve().then(run);
  return {
    PREFIX,
    TYPE,
    MAX_BYTES,
    keys,
    REVISION,
    JOURNAL,
    BACKUP,
    normalize,
    merge,
    validate,
    hasContent,
    encode,
    decode,
    create,
    ...owner,
    initialize: () => exclusive(owner.recover),
    commit: (value) => exclusive(() => owner.commit(value)),
    replace: (value, apply) => exclusive(() => owner.replace(value, apply)),
  };
})();

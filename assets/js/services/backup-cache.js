"use strict";
/** Memory-only backup cache. Jobs capture frozen state before entering a serial queue. */
WorkTimeApp.services.backupCache = (() => {
  function mergeChanges(a, b) {
    const out = { ...a, ...b };
    for (const key of ["days", "imports"])
      if (a[key] || b[key])
        out[key] = [...new Set([...(a[key] || []), ...(b[key] || [])])];
    return out;
  }
  function create({
    source,
    getGames = () => window.localStorage,
    prepareGames = (ids) => WorkTimeApp.games.prepareArchive(ids),
  }) {
    const G = WorkTimeApp.services.gameArchive;
    let queue = Promise.resolve(),
      dirty = {},
      reset = true,
      disposed = false;
    let timer = null,
      deadline = null,
      document = null,
      parts = new Map(),
      gameParts = new Map();
    let gameRaw = {},
      gameHeader = null,
      needsFull = false;
    let warming = null,
      pendingUpdate = true;
    const stats = { fullExports: 0, partialExports: 0 };
    function clearTimers() {
      clearTimeout(timer);
      clearTimeout(deadline);
      timer = deadline = null;
    }
    function invalidate(changes = {}, replace = false) {
      if (disposed) return;
      pendingUpdate = true;
      dirty = mergeChanges(dirty, changes);
      reset ||= replace;
      clearTimeout(timer);
      timer = setTimeout(warm, 300);
      if (!deadline) deadline = setTimeout(warm, 2000);
    }
    function request(withText) {
      if (disposed) return Promise.reject(Error("Backup cache disposed"));
      clearTimers();
      const changes = dirty,
        replace = reset,
        state = source.snapshot();
      dirty = {};
      reset = false;
      pendingUpdate = false;
      let raw;
      try {
        const storage = getGames();
        const revision = storage.getItem(G.REVISION);
        if (storage.getItem(G.JOURNAL))
          throw Error(WorkTimeApp.i18n.t("gameArchive.recovery"));
        raw = Object.fromEntries(
          Object.entries(G.keys).map(([id, key]) => [id, storage.getItem(key)]),
        );
        if (
          storage.getItem(G.JOURNAL) ||
          storage.getItem(G.REVISION) !== revision
        )
          throw Error(WorkTimeApp.i18n.t("gameArchive.changed"));
      } catch (error) {
        dirty = mergeChanges(changes, dirty);
        reset ||= replace;
        return Promise.reject(error);
      }
      const at = new Date().toISOString();
      const run = async () => {
        if (disposed) throw Error("Backup cache disposed");
        // Empty games need no rules or puzzle data. Warm only saved games so
        // preparing work backups does not defeat lazy game loading at startup.
        await prepareGames(Object.keys(raw).filter((id) => raw[id] !== null));
        let nextDocument = document,
          nextParts = new Map(parts),
          nextGames = new Map(gameParts);
        if (replace || !document || needsFull) {
          stats.fullExports++;
          nextDocument = await source.export(state);
          nextParts = new Map();
          for (const module of nextDocument.modules)
            nextParts.set(module.id, module);
        } else if (Object.keys(changes).length) {
          stats.partialExports++;
          const modules = await source.exportChanges(state, changes);
          for (const patch of modules) {
            let module = patch;
            if (
              patch.id === "worktime.days" ||
              patch.id === "worktime.imports" ||
              patch.id === "worktime.observations" ||
              patch.id === "worktime.evidence"
            ) {
              const previous = nextParts.get(patch.id);
              const oldRows = previous?.records || [];
              const removed = new Set(
                patch.id === "worktime.days" ? changes.days : changes.imports,
              );
              const rows = oldRows.filter(
                (row) =>
                  !removed.has(
                    ["worktime.observations", "worktime.evidence"].includes(
                      patch.id,
                    )
                      ? row.data.importId
                      : row.id,
                  ),
              );
              rows.push(...patch.records);
              if (
                patch.id === "worktime.days" ||
                patch.id === "worktime.imports"
              ) {
                const ids =
                  patch.id === "worktime.days"
                    ? Object.keys(state.days)
                    : state.imports.map((log) => log.id);
                const order = new Map(ids.map((id, index) => [id, index]));
                for (let i = 0; i < rows.length; i++) {
                  const index = order.get(rows[i].id);
                  if (rows[i].order !== index)
                    rows[i] = { ...rows[i], order: index };
                }
                rows.sort((a, b) => a.order - b.order);
              } else {
                const order = new Map(
                  state.imports.map((log, i) => [log.id, i]),
                );
                rows.sort(
                  (a, b) =>
                    order.get(a.data.importId) - order.get(b.data.importId) ||
                    a.data.index - b.data.index,
                );
              }
              module = { ...patch, records: rows };
            }
            nextParts.set(module.id, module);
          }
        }
        let nextHeader = gameHeader;
        if (
          !gameHeader ||
          Object.keys(raw).some((id) => gameRaw[id] !== raw[id])
        ) {
          // Normalize captured strings, never later game ticks.
          const captured = new Map(
            Object.entries(G.keys).map(([id, key]) => [key, raw[id]]),
          );
          const archive = G.create(() => ({
            getItem: (key) => captured.get(key) ?? null,
          })).exportArchive({ allowEmpty: true, includeDefaults: true });
          nextHeader = (({ games, ...header }) => header)(archive);
          for (const [id, text] of Object.entries(raw)) {
            if (Object.hasOwn(gameRaw, id) && gameRaw[id] === text) continue;
            const value = archive.games[id];
            if (value !== undefined) nextGames.set(id, value);
            else nextGames.delete(id);
          }
        }
        if (disposed) throw Error("Backup cache disposed");
        document = (({ modules, ...header }) => header)(nextDocument);
        parts = nextParts;
        gameParts = nextGames;
        gameRaw = raw;
        gameHeader = nextHeader;
        needsFull = false;
        if (!withText) return;
        const work = document;
        const result = {
          format: "worktime-full-backup",
          version: 1,
          exportedAt: at,
          work: { ...work, exportedAt: at, modules: [...parts.values()] },
          games: {
            ...gameHeader,
            exportedAt: at,
            games: Object.fromEntries(gameParts),
          },
        };
        const text = JSON.stringify(result);
        if (
          new TextEncoder().encode(text).length >
          WorkTimeApp.services.backup.MAX_BYTES
        )
          throw Error(WorkTimeApp.i18n.t("backup.tooLarge", { size: 100 }));
        return text;
      };
      const result = queue.then(run);
      queue = result.catch(() => {
        needsFull = true;
      });
      return result;
    }
    function warm() {
      if (disposed) return Promise.resolve();
      if (warming) {
        // A debounce deadline may fire while a slow export is still running.
        // Clear expired handles so the next batch gets its own maximum wait.
        clearTimers();
        return warming;
      }
      warming = request(false)
        .catch(() => {})
        .finally(() => {
          warming = null;
          if (pendingUpdate && !disposed) invalidate();
        });
      return warming;
    }
    return {
      invalidate,
      warm,
      capture: () => request(true),
      stats,
      dispose() {
        disposed = true;
        clearTimers();
        parts.clear();
        gameParts.clear();
      },
    };
  }
  return { create };
})();

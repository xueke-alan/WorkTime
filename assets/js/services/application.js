"use strict";
/** Application state and navigation model. Storage and views are supplied separately. */
WorkTimeApp.services.application = (() => {
  /** @param {{state:WorkStateData,writable:boolean,readError:Error|null,corrupt:boolean,today:string}} input @returns {WorkApplicationModel} */
  function create(input) {
    return {
      state: input.state,
      revision: 0,
      storageFailed: !!input.readError || !input.writable,
      loadCorrupt: input.corrupt,
      today: input.today,
      month: input.today.slice(0, 7),
      selected: input.today,
      batchMode: false,
      batchDays: new Set(),
      batchAnchor: null,
      yearMode: false,
      viewYear: Number(input.today.slice(0, 4)),
      returnMonth: input.today.slice(0, 7),
    };
  }
  /** Own business state. Views receive frozen snapshots, operations own all writes. */
  function createState({
    state: initial,
    persistence,
    core: C,
    failed = false,
    corrupt = false,
    unsaved = false,
  }) {
    const clone = (value) => JSON.parse(JSON.stringify(value));
    function freeze(value) {
      if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
      return value;
    }
    const A = WorkTimeApp.services.archive;
    let state = freeze(initial),
      revision = 0,
      dirty = unsaved,
      saveFailed = failed,
      loadCorrupt = corrupt,
      pending = 0,
      exclusive = false;
    let dirtyChanges = {};
    function collect(before, after, hints) {
      const changes = { ...hints };
      for (const key of [
        "personal",
        "preferences",
        "settings",
        "overtimeRequirements",
        "oaUrl",
        "scheduleRanges",
        "timeTemplates",
      ])
        if (before[key] !== after[key]) changes[key] = true;
      if (before.days !== after.days && !changes.days)
        changes.days = [
          ...new Set([...Object.keys(before.days), ...Object.keys(after.days)]),
        ].filter((key) => before.days[key] !== after.days[key]);
      if (before.imports !== after.imports && !changes.imports)
        changes.imports = [
          ...new Set([
            ...before.imports.map((log) => log.id),
            ...after.imports.map((log) => log.id),
          ]),
        ];
      return changes;
    }
    function combine(left, right) {
      const result = { ...left, ...right };
      for (const key of ["days", "imports"])
        if (left[key] || right[key])
          result[key] = [
            ...new Set([...(left[key] || []), ...(right[key] || [])]),
          ];
      return result;
    }
    function commit(
      candidate,
      { atomic = false, restore = false, changes = {} } = {},
    ) {
      if (persistence.loadIssue === "unsupported")
        return Promise.resolve({
          persisted: false,
          applied: false,
          error: A.error(
            "当前存档版本需要更新的应用，已启用只读保护。",
            "UNSUPPORTED_VERSION",
          ),
        });
      if (exclusive)
        return Promise.resolve({
          persisted: false,
          applied: false,
          error: A.error("正在恢复或应用作息，请完成后重试。", "BUSY"),
        });
      const before = state,
        changed = candidate !== state;
      const patch = collect(before, candidate, changes);
      if (!changed && !dirty && !saveFailed && !restore)
        return Promise.resolve({
          changed: false,
          applied: false,
          persisted: true,
          dirty: false,
          error: null,
        });
      if (atomic) exclusive = true;
      else if (changed) {
        state = freeze(candidate);
        revision++;
        dirty = true;
      }
      if (!atomic) dirtyChanges = combine(dirtyChanges, patch);
      const generation = revision;
      pending++;
      const work = restore
        ? persistence.restore(candidate)
        : persistence.commit(
            candidate,
            atomic ? combine(dirtyChanges, patch) : { ...dirtyChanges },
          );
      return Promise.resolve(work)
        .then((saved) => {
          if (saved.persisted && atomic) {
            state = freeze(candidate);
            revision++;
          }
          if (saved.persisted && (atomic || generation === revision)) {
            dirty = false;
            dirtyChanges = {};
          }
          if (!saved.persisted && !atomic) dirty = true;
          saveFailed = !saved.persisted;
          if (restore && saved.persisted) loadCorrupt = false;
          return {
            changed,
            applied: changed && (!atomic || saved.persisted),
            persisted: saved.persisted,
            dirty,
            error: saved.error || null,
            code: saved.error?.code || null,
            message: saved.error?.message || "",
          };
        })
        .finally(() => {
          pending--;
          if (atomic) exclusive = false;
        });
    }
    const service = {
      get state() {
        return state;
      },
      get revision() {
        return revision;
      },
      get pending() {
        return pending > 0;
      },
      get dirty() {
        return dirty;
      },
      get failed() {
        return saveFailed;
      },
      get loadCorrupt() {
        return persistence.loadIssue === undefined
          ? loadCorrupt
          : persistence.loadIssue !== null;
      },
      markUnsaved() {
        dirty = true;
        saveFailed = true;
      },
      retry() {
        return commit(state);
      },
      saveDay(date, day) {
        const previous = state.days[date] || {};
        const known = [
          "oa",
          "actual",
          "estimate",
          "draft",
          "kind",
          "leaveMinutes",
          "note",
          "plannedOvertime",
        ];
        const extras = Object.fromEntries(
          Object.entries(previous).filter(([key]) => !known.includes(key)),
        );
        const next = { ...extras, ...clone(day) };
        for (const key of ["oa", "actual", "estimate", "draft"])
          if (next[key]) next[key] = A.merge(previous[key], next[key]);
        return commit(
          { ...state, days: { ...state.days, [date]: next } },
          { changes: { days: [date] } },
        );
      },
      togglePlanned(date) {
        const day = { ...state.days[date] };
        if (C.calendarInfo(date, day).work) return commit(state);
        if (day.plannedOvertime) delete day.plannedOvertime;
        else day.plannedOvertime = true;
        return service.saveDay(date, day);
      },
      resetDay(date) {
        const days = { ...state.days },
          old = days[date];
        if (!old) return commit(state);
        const owned = [
          "oa",
          "actual",
          "estimate",
          "draft",
          "kind",
          "leaveMinutes",
          "note",
          "plannedOvertime",
        ];
        const extras = Object.fromEntries(
          Object.entries(old).filter(([key]) => !owned.includes(key)),
        );
        if (old.oa) days[date] = { ...extras, oa: old.oa };
        else if (Object.keys(extras).length) days[date] = extras;
        else delete days[date];
        return commit({ ...state, days }, { changes: { days: [date] } });
      },
      saveTemplate(template, editing) {
        const clean = C.validateTimeTemplate(template),
          templates = [...state.timeTemplates];
        if (editing) {
          const index = templates.findIndex((item) => item.id === clean.id);
          if (index < 0) throw Error("模板已不存在。");
          templates[index] = { ...templates[index], ...clean };
        } else {
          if (templates.length >= 4)
            throw Error("最多保存 4 个模板，请先删除一个模板。");
          templates.push(clean);
        }
        return commit({ ...state, timeTemplates: templates });
      },
      removeTemplate(id) {
        return commit({
          ...state,
          timeTemplates: state.timeTemplates.filter((item) => item.id !== id),
        });
      },
      saveBatch(dates, record) {
        const days = { ...state.days };
        for (const date of dates) {
          if (!C.canBatchEditDate(state, date)) continue;
          const day = { ...days[date] };
          const field = day.oa || day.actual ? "actual" : "estimate";
          const extensions = Object.fromEntries(
            Object.entries(day[field] || {}).filter(
              ([key]) =>
                !["start", "end", "nextDay", "effectiveMinutes"].includes(key),
            ),
          );
          if (day.oa || day.actual) {
            day.actual = { ...extensions, ...record };
            delete day.estimate;
          } else day.estimate = { ...extensions, ...record };
          delete day.draft;
          days[date] = day;
        }
        return commit({ ...state, days });
      },
      importRecords(log) {
        const candidate = {
          ...state,
          days: { ...state.days },
          imports: [...state.imports],
        };
        for (const record of log.records)
          if (candidate.days[record.date])
            candidate.days[record.date] = clone(candidate.days[record.date]);
        for (const record of log.records)
          C.applyObservation(candidate, record, log.id);
        candidate.imports.push(clone(log));
        const compact = C.compactOAState({
          ...candidate,
          days: Object.fromEntries(
            log.records.map((record) => [
              record.date,
              candidate.days[record.date],
            ]),
          ),
          imports: [candidate.imports.at(-1)],
        });
        candidate.days = { ...candidate.days, ...compact.days };
        candidate.imports[candidate.imports.length - 1] = compact.imports[0];
        return commit(candidate, {
          changes: {
            days: log.records.map((record) => record.date),
            imports: [log.id],
          },
        });
      },
      async removeImport(id) {
        await service.hydrateImports();
        const dates = Object.keys(state.days).filter(
          (date) => state.days[date].oa?.importId === id,
        );
        const affected = new Set(dates);
        const candidate = {
          ...state,
          days: Object.fromEntries(
            Object.entries(state.days).map(([date, day]) => [
              date,
              affected.has(date) ? clone(day) : day,
            ]),
          ),
          imports: [...state.imports],
        };
        const impact = C.deleteImport(candidate, id);
        for (const date of dates)
          if (!candidate.days[date]) {
            const known = [
              "oa",
              "actual",
              "estimate",
              "draft",
              "kind",
              "leaveMinutes",
              "note",
              "plannedOvertime",
            ];
            const extras = Object.fromEntries(
              Object.entries(state.days[date]).filter(
                ([key]) => !known.includes(key),
              ),
            );
            if (Object.keys(extras).length) candidate.days[date] = extras;
          }
        return {
          ...(await commit(candidate, {
            changes: { days: dates, imports: [id] },
          })),
          impact,
        };
      },
      saveOAUrl(oaUrl) {
        return commit({ ...state, oaUrl });
      },
      saveSettings(settings, overtimeRequirements) {
        return commit({
          ...state,
          settings: { ...state.settings, ...clone(settings) },
          overtimeRequirements: [...overtimeRequirements],
        });
      },
      applySchedule(candidate) {
        return commit(candidate, { atomic: true });
      },
      savePersonal(personal) {
        return commit({
          ...state,
          personal: { ...state.personal, ...clone(personal) },
        });
      },
      restore(candidate) {
        if (saveFailed && Object.keys(dirtyChanges).length)
          return Promise.resolve({
            persisted: false,
            error: A.error(
              "请先导出本页未保存修改并刷新，再恢复备份。",
              "UNSAVED",
            ),
          });
        return commit(A.migrate(candidate), {
          restore: true,
          atomic: true,
        });
      },
      initialize(pageTheme) {
        if (persistence.loadIssue !== "corrupt")
          throw Error("仅损坏的存档可以初始化。");
        const candidate = A.migrate(C.defaultState());
        candidate.preferences.pageTheme = pageTheme;
        return commit(candidate, { restore: true, atomic: true });
      },
      savePreferences(preferences) {
        return commit({
          ...state,
          preferences: { ...state.preferences, ...preferences },
        });
      },
      async hydrateImports() {
        if (!state.imports.some((log) => log._lazy)) return;
        const captured = state;
        const hydrated = await persistence.hydrateImports(captured);
        const full = new Map(hydrated.imports.map((log) => [log.id, log]));
        state = freeze({
          ...state,
          _archive: {
            ...state._archive,
            recordExtras:
              hydrated._archive?.recordExtras || state._archive?.recordExtras,
            dataExtras:
              hydrated._archive?.dataExtras || state._archive?.dataExtras,
          },
          imports: state.imports.map((log) =>
            log._lazy ? full.get(log.id) : log,
          ),
        });
      },
      async export(preferences) {
        return persistence.export(
          preferences
            ? {
                ...state,
                preferences: { ...state.preferences, ...preferences },
              }
            : state,
        );
      },
      reload(candidate) {
        state = freeze(candidate);
        revision++;
        dirty = false;
        dirtyChanges = {};
        saveFailed = false;
        loadCorrupt = false;
      },
    };
    return service;
  }
  return { create, createState };
})();

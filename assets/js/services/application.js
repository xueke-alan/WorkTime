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
    const compactInitial = C.compactOAState(clone(initial));
    let state = freeze(compactInitial),
      revision = 0,
      dirty =
        unsaved || JSON.stringify(initial) !== JSON.stringify(compactInitial),
      saveFailed = failed,
      loadCorrupt = corrupt;
    function commit(candidate, { atomic = false, restore = false } = {}) {
      const changed = JSON.stringify(candidate) !== JSON.stringify(state);
      if (!changed && !dirty && !saveFailed && !restore)
        return {
          changed: false,
          applied: false,
          persisted: true,
          dirty: false,
          error: null,
          code: null,
          message: "",
        };
      if (changed && !atomic) {
        state = freeze(candidate);
        revision++;
      }
      const saved = restore
        ? persistence.replace(candidate)
        : persistence.save(candidate);
      if (restore && saved.persisted) loadCorrupt = false;
      if (saved.persisted && changed && atomic) {
        state = freeze(candidate);
        revision++;
      }
      saveFailed = !saved.persisted;
      dirty = saved.persisted ? false : atomic ? dirty : true;
      return {
        changed,
        applied: changed && (!atomic || saved.persisted),
        persisted: saved.persisted,
        dirty,
        error: saved.error || null,
        code: saved.error?.code || (saved.persisted ? null : "WRITE_FAILED"),
        message: saved.error?.userMessage || saved.error?.message || "",
      };
    }
    const service = {
      get state() {
        return state;
      },
      get revision() {
        return revision;
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
        return commit({
          ...state,
          days: { ...state.days, [date]: clone(day) },
        });
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
        if (old.oa) days[date] = { oa: old.oa };
        else delete days[date];
        return commit({ ...state, days });
      },
      saveTemplate(template, editing) {
        const clean = C.validateTimeTemplate(template),
          templates = [...state.timeTemplates];
        if (editing) {
          const index = templates.findIndex((item) => item.id === clean.id);
          if (index < 0) throw Error("模板已不存在。");
          templates[index] = clean;
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
          if (day.oa || day.actual) {
            day.actual = { ...record };
            delete day.estimate;
          } else day.estimate = { ...record };
          delete day.draft;
          days[date] = day;
        }
        return commit({ ...state, days });
      },
      importRecords(log) {
        const candidate = clone(state);
        for (const record of log.records)
          C.applyObservation(candidate, record, log.id);
        candidate.imports.push(clone(log));
        return commit(C.compactOAState(candidate));
      },
      removeImport(id) {
        const candidate = clone(state),
          impact = C.deleteImport(candidate, id);
        return { ...commit(candidate), impact };
      },
      saveOAUrl(oaUrl) {
        return commit({ ...state, oaUrl });
      },
      saveSettings(settings, overtimeRequirements) {
        return commit({
          ...state,
          settings: clone(settings),
          overtimeRequirements: [...overtimeRequirements],
        });
      },
      applySchedule(candidate) {
        return commit(clone(candidate), { atomic: true });
      },
      savePersonal(personal) {
        return commit({ ...state, personal: clone(personal) });
      },
      restore(candidate) {
        return commit(C.compactOAState(C.validateBackup(clone(candidate))), {
          restore: true,
          atomic: true,
        });
      },
      initialize(pageTheme) {
        if (persistence.loadIssue !== "corrupt")
          throw Error("仅损坏的存档可以初始化。");
        const candidate = C.defaultState();
        candidate.preferences.pageTheme = pageTheme;
        return commit(candidate, { restore: true, atomic: true });
      },
      reload(candidate) {
        const compact = C.compactOAState(clone(candidate));
        const changed = JSON.stringify(compact) !== JSON.stringify(state);
        if (changed) {
          state = freeze(compact);
          revision++;
        }
        dirty = JSON.stringify(candidate) !== JSON.stringify(compact);
        saveFailed = false;
        loadCorrupt = false;
      },
    };
    return service;
  }
  return { create, createState };
})();

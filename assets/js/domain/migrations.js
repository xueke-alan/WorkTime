"use strict";
/** Legacy schema-1 metadata migration. User settings always survive unchanged. */
const WorkMigrations = (() => {
  const { DEFAULT_START, DEFAULT_END, DEFAULT_BREAKS } = WorkState;
  /** @param {WorkStateData} state Validated state; mutates missing defaults and metadata only. */
  function applyScheduleDefaults(state) {
    let changed = false;
    for (const [key, fallback] of [
      ["workStart", DEFAULT_START],
      ["workEnd", DEFAULT_END],
    ]) {
      if (!state.settings[key]) {
        state.settings[key] = fallback;
        changed = true;
      }
    }
    if (!Array.isArray(state.settings.breaks)) {
      state.settings.breaks = DEFAULT_BREAKS.map((rest) => ({ ...rest }));
      changed = true;
    }
    if (state.scheduleDefaultsVersion !== 1) {
      // Versionless backups may already contain intentional custom or empty breaks.
      state.scheduleDefaultsVersion = 1;
      changed = true;
    }
    return changed;
  }
  return { applyScheduleDefaults };
})();

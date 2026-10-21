"use strict";
/** Long-lived preferences belong to the archive; localStorage is only a paint cache. */
WorkTimeApp.services.preferences = (() => {
  const key = "worktime.pageTheme",
    rules = WorkTimeApp.domain.preferences;
  function create({ getStorage }) {
    const listeners = new Set();
    let state,
      revision = 0,
      dirty = false,
      mountedWindow = null,
      archive = null,
      pendingPreferences = {};
    function read() {
      try {
        return rules.normalize(
          getStorage().getItem("worktime.themePaintCache"),
        );
      } catch {
        return "green";
      }
    }
    state = Object.freeze({
      pageTheme: read(),
      language: WorkTimeApp.i18n.preference,
    });
    const result = (changed, persisted, error = null) => ({
      changed,
      applied: changed,
      persisted,
      dirty,
      error,
      code: error ? "PREFERENCE_WRITE_FAILED" : null,
      message: error?.message || "",
    });
    function publish(operation) {
      for (const listener of listeners) listener(state, operation);
      return operation;
    }
    async function savePreference(preferences) {
      const patch = { ...pendingPreferences, ...preferences };
      const operationResult = (...args) => ({
        ...result(...args),
        preferenceNames: Object.keys(patch),
      });
      const changed = Object.entries(preferences).some(
        ([name, value]) => state[name] !== value,
      );
      if (!changed && !dirty) return operationResult(false, true);
      pendingPreferences = patch;
      state = Object.freeze({ ...state, ...preferences });
      WorkTimeApp.i18n.setLanguage(state.language || "auto");
      const generation = ++revision;
      let error = null;
      dirty = true;
      publish({ ...operationResult(changed, false), pending: true });
      try {
        if (!archive) throw Error("存档尚未准备完成，请稍后重试。");
        const saved = await archive.save(patch);
        if (!saved.persisted)
          throw saved.error || Error("Preference write did not persist");
      } catch (failure) {
        error = failure;
      }
      // Older completions must not clear a newer pending/failed preference.
      if (generation !== revision) return result(changed, !error, error);
      dirty = !!error;
      if (!error) pendingPreferences = {};
      if (!error)
        try {
          getStorage().setItem("worktime.themePaintCache", state.pageTheme);
        } catch {}
      return publish(operationResult(changed, !error, error));
    }
    function saveTheme(id) {
      if (!rules.isTheme(id)) throw Error("Invalid theme identity");
      return savePreference({ pageTheme: id });
    }
    function adopt(preferences) {
      state = Object.freeze({ ...preferences });
      const language = WorkTimeApp.i18n.normalize(state.language);
      WorkTimeApp.i18n.setLanguage(language);
      revision++;
      dirty = false;
      pendingPreferences = {};
      if (state.language !== language) {
        // Save through the archive owner so old backups and fresh stores migrate alike.
        void savePreference({ language });
      } else publish(result(true, true));
    }
    function storage(event) {
      let store;
      try {
        store = getStorage();
      } catch {
        return;
      }
      if (
        event.storageArea !== store ||
        (event.key !== "worktime.themePaintCache" && event.key !== null)
      )
        return;
      if (archive) return;
      const id = read(),
        changed = id !== state.pageTheme;
      if (changed) {
        state = Object.freeze({ ...state, pageTheme: id });
        revision++;
      }
      dirty = false;
      publish(result(changed, true));
    }
    const owner = {
      get state() {
        return state;
      },
      get revision() {
        return revision;
      },
      get dirty() {
        return dirty;
      },
      saveTheme,
      saveWeatherDays(days) {
        if (![0, 3, 5, 7].includes(days))
          throw Error("Invalid weather display range");
        return savePreference({ weatherDays: days });
      },
      saveLanguage(language) {
        return savePreference({
          language: WorkTimeApp.i18n.normalize(language),
        });
      },
      attach(adapter) {
        archive = adapter;
        adopt(adapter.state);
      },
      synchronize() {
        if (!archive) return;
        adopt(archive.getState());
      },
      async saveForecastMode(mode) {
        if (!archive || !["hourly", "daily"].includes(mode)) return;
        return savePreference({ forecastMode: mode });
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      mount(window) {
        if (mountedWindow === window) return;
        if (mountedWindow)
          mountedWindow.removeEventListener("storage", storage);
        mountedWindow = window;
        window.addEventListener("storage", storage);
      },
      dispose() {
        mountedWindow?.removeEventListener("storage", storage);
        mountedWindow = null;
        listeners.clear();
      },
    };
    return owner;
  }
  const page = create({ getStorage: () => window.localStorage });
  page.mount(window);
  return { key, create, page };
})();

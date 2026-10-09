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
      archive = null;
    function read() {
      try {
        return rules.normalize(
          getStorage().getItem("worktime.themePaintCache"),
        );
      } catch {
        return "green";
      }
    }
    state = Object.freeze({ pageTheme: read() });
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
      const changed = Object.entries(preferences).some(
        ([name, value]) => state[name] !== value,
      );
      if (!changed && !dirty) return result(false, true);
      state = Object.freeze({ ...state, ...preferences });
      const generation = ++revision;
      let error = null;
      dirty = true;
      publish({ ...result(changed, false), pending: true });
      try {
        if (!archive) throw Error("存档尚未准备完成，请稍后重试。");
        const saved = await archive.save(preferences);
        if (!saved.persisted) throw saved.error;
      } catch (failure) {
        error = failure;
      }
      // Older completions must not clear a newer pending/failed preference.
      if (generation !== revision) return result(changed, !error, error);
      dirty = !!error;
      if (!error)
        try {
          getStorage().setItem("worktime.themePaintCache", state.pageTheme);
        } catch {}
      return publish(result(changed, !error, error));
    }
    function saveTheme(id) {
      if (!rules.isTheme(id)) throw Error("Invalid theme identity");
      return savePreference({ pageTheme: id });
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
        state = Object.freeze({ pageTheme: id });
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
      attach(adapter) {
        archive = adapter;
        state = Object.freeze({ ...adapter.state });
        revision++;
        dirty = false;
        publish(result(true, true));
      },
      synchronize() {
        if (!archive) return;
        state = Object.freeze({ ...archive.getState() });
        revision++;
        dirty = false;
        publish(result(true, true));
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

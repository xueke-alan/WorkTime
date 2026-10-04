"use strict";
/** Independently persisted appearance; never writes or locks the work-record store. */
WorkTimeApp.services.preferences = (() => {
  const key = "worktime.pageTheme",
    rules = WorkTimeApp.domain.preferences;
  function create({ getStorage }) {
    const listeners = new Set();
    let state,
      revision = 0,
      dirty = false,
      mountedWindow = null;
    function read() {
      try {
        return rules.normalize(getStorage().getItem(key));
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
    function saveTheme(id) {
      if (!rules.isTheme(id)) throw Error("Invalid theme identity");
      const changed = id !== state.pageTheme;
      if (!changed && !dirty) return result(false, true);
      if (changed) {
        state = Object.freeze({ pageTheme: id });
        revision++;
      }
      let error = null;
      try {
        getStorage().setItem(key, id);
        dirty = false;
      } catch (failure) {
        dirty = true;
        error = failure;
      }
      return publish(result(changed, !error, error));
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
        (event.key !== key && event.key !== null)
      )
        return;
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

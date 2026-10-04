"use strict";
/** Own the saved-session boundary and recovery; views receive explicit callbacks. */
WorkTimeApp.services.createSaveSession = function ({
  owner,
  persistence,
  locks,
  hasDraft,
  onCommit,
  onReload,
  onRecovered,
  onRecoveryError,
  onAccessError,
  onRecoveryDone,
}) {
  let disposed = false,
    savedSnapshot = JSON.stringify(owner.state);
  function commit(result) {
    if (disposed) return result;
    onCommit(result);
    if (result.persisted) savedSnapshot = JSON.stringify(owner.state);
    return result;
  }
  function recover(result) {
    if (disposed || !result.ok) return;
    try {
      // Adopt newer data only when both formal state and every draft are untouched.
      if (
        !owner.loadCorrupt &&
        !hasDraft() &&
        JSON.stringify(owner.state) === savedSnapshot &&
        persistence.hasExternalUpdate()
      ) {
        const latest = persistence.load();
        if (latest.error) throw latest.error;
        owner.reload(latest.state);
        onReload();
      }
      if (commit(owner.retry()).persisted) onRecovered();
    } catch (error) {
      owner.markUnsaved();
      onRecoveryError(error);
    }
    onRecoveryDone();
  }
  function wait() {
    if (!disposed && !persistence.canWrite && locks?.request)
      void persistence.acquireWriteAccess(locks, { wait: true }).then(recover);
  }
  return {
    commit,
    wait,
    async retry() {
      if (disposed) return;
      const result = await persistence.acquireWriteAccess(locks, {
        retry: true,
      });
      if (disposed) return;
      if (result.ok) recover(result);
      else {
        onAccessError(result.error);
        wait();
      }
    },
    dispose() {
      disposed = true;
    },
  };
};

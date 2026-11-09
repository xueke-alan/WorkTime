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
    savedRevision = owner.revision,
    recovering = false;
  async function commit(operation) {
    if (!disposed) onCommit({ pending: true, applied: true, persisted: false });
    const result = await operation;
    if (disposed) return result;
    onCommit(result);
    if (result.persisted && !owner.dirty) savedRevision = owner.revision;
    return result;
  }
  async function recover(result) {
    if (disposed || !result.ok || recovering) return;
    recovering = true;
    const revision = owner.revision;
    const assertUnedited = () => {
      if (hasDraft() || owner.revision !== revision)
        throw Error(
          "读取失败后已有临时修改，请先下载当前页面备份并刷新，再读取原存档",
        );
    };
    try {
      if (persistence.loadIssue === "unavailable") {
        if (hasDraft() || owner.revision !== savedRevision)
          throw Error(
            "读取失败后已有临时修改，请先下载当前页面备份并刷新，再读取原存档",
          );
        const latest = await persistence.load();
        if (disposed) return;
        if (latest.error) throw latest.error;
        assertUnedited();
        owner.reload(latest.state);
        savedRevision = owner.revision;
        await onReload();
        if (disposed) return;
      }
      // Adopt newer data only when both formal state and every draft are untouched.
      if (
        !owner.loadCorrupt &&
        !hasDraft() &&
        owner.revision === savedRevision &&
        (await persistence.hasExternalUpdate())
      ) {
        if (disposed) return;
        assertUnedited();
        const latest = await persistence.load();
        if (disposed) return;
        if (latest.error) throw latest.error;
        assertUnedited();
        owner.reload(latest.state);
        savedRevision = owner.revision;
        await onReload();
      }
      if (disposed) return;
      if ((await commit(owner.retry())).persisted && !disposed) onRecovered();
    } catch (error) {
      if (disposed) return;
      owner.markUnsaved();
      await commit({ persisted: false, error });
      onRecoveryError(error);
    } finally {
      recovering = false;
      if (!disposed) onRecoveryDone();
    }
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
      if (result.ok) await recover(result);
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

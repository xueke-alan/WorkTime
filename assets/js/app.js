"use strict";
WorkBootstrap.run(
  async (lifecycle) => {
    lifecycle.defer(() => window.UIAlignment?.dispose());
    lifecycle.defer(() => window.DateInfoUI?.dispose());
    lifecycle.defer(() => window.WorkMotion?.dispose());
    lifecycle.defer(() => window.WorkBackground?.dispose());
    let C = WorkTime;
    const elements = WorkUI.createElements(document);
    const { element: $, escape: esc, icon, controlIcon, trendIcon } = elements;
    elements.initialize();
    const persistence = WorkStorage.create({
      key: C.KEY,
      validate: C.validateBackup,
      defaultState: C.defaultState,
      getStorage: () => localStorage,
    });
    lifecycle.defer(() => persistence.releaseWriteAccess());
    const access = await persistence.acquireWriteAccess(navigator.locks);
    if (lifecycle.closed) {
      persistence.releaseWriteAccess();
      return;
    }
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) location.reload();
    });
    const loaded = persistence.load();
    const clock = WorkClock.create({ dateKey: C.businessDate });
    const model = WorkApplication.create({
      state: loaded.state,
      writable: access.ok,
      readError: loaded.error,
      corrupt: loaded.corrupt,
      today: clock.today(),
    });
    const actions = {};
    if (loaded.error)
      $("storageNoticeText").textContent =
        "浏览器数据无法读取：" +
        loaded.error.message +
        "。当前数据尚未保存，请先下载备份或恢复有效备份。";
    else if (!access.ok)
      $("storageNoticeText").textContent =
        "当前页面无法保存：" + access.error.message + "。";
    const defaultsUpdated =
      !model.loadCorrupt && C.applyScheduleDefaults(model.state);
    const derived = WorkDerived.create({
      core: C,
      getState: () => model.state,
      getRevision: () => model.revision,
      now: clock.now,
    });
    C = derived.core;
    const importIndex = WorkImportIndex.create({ core: C });
    lifecycle.defer(() => derived.dispose());
    lifecycle.defer(() => importIndex.dispose());
    const getState = () => model.state;
    const getView = () => ({
      today: model.today,
      month: model.month,
      selected: model.selected,
      batchMode: model.batchMode,
      batchDays: model.batchDays,
      yearMode: model.yearMode,
      viewYear: model.viewYear,
    });
    const shared = {
      core: C,
      element: $,
      escape: esc,
      getState,
      getView,
      document,
      window,
    };
    const {
      isFullLeave,
      timeAnomaly,
      stateLabel,
      visibleStatus,
      tag,
      statusTag,
    } = WorkUI.createDayPresentation(shared);
    const {
      decorateStaticNotices,
      updateNotificationEmptyState,
      toast,
      renderTimeAnomalyNotice,
      renderOAStaleNotice,
    } = WorkUI.createNotifications({
      ...shared,
      getRange: monthBounds,
      icon,
      timeAnomaly,
    });
    const { renderStats } = WorkUI.createSummary({
      ...shared,
      getRange: monthBounds,
      isStorageFailed: () => model.storageFailed,
    });
    const calendarUI = WorkUI.createCalendar({
      ...shared,
      getRange: monthBounds,
      closeLeavePanel: (...args) => closeLeavePanel(...args),
      renderTimeAnomalyNotice,
      updateNotificationEmptyState,
      stateLabel,
      isFullLeave,
      visibleStatus,
      statusTag,
      tag,
      trendIcon,
      year: WorkYear,
    });
    const { renderCalendar } = calendarUI;
    const {
      updateResetDayButton,
      renderEditor,
      formDay,
      previewDay,
      closeLeavePanel,
    } = WorkUI.createEditor({
      ...shared,
      renderTimeTemplates: (...args) => actions.renderTimeTemplates(...args),
      timeAnomaly,
      isFullLeave,
    });
    function clone(x) {
      return JSON.parse(JSON.stringify(x));
    }
    decorateStaticNotices();
    function save() {
      // Every committed in-memory change invalidates derived values, even if storage fails.
      model.revision++;
      window.WorkCountdown?.setState(model.state);
      const result = persistence.save(model.state);
      model.storageFailed = !result.persisted;
      $("storageNotice").classList.toggle("hidden", result.persisted);
      if (!result.persisted)
        $("storageNoticeText").textContent =
          "更改未保存：" + result.error.message + "；关闭页面前请备份。";
      return result.persisted;
    }
    function saveFeedback(saved, message) {
      toast(
        saved ? message : "更改保留在当前页面，但未能保存，请查看提醒并备份",
        saved ? "countdown" : "error",
      );
    }
    function monthBounds() {
      const [y, m] = model.month.split("-").map(Number);
      return [model.month + "-01", C.dateKey(new Date(y, m, 0, 12))];
    }
    function render() {
      renderOAStaleNotice();
      renderStats();
      renderCalendar();
      renderEditor();
      updateNotificationEmptyState();
    }
    function open(id) {
      $(id).showModal();
    }
    Object.assign(actions, {
      controlIcon,
      clone,
      save,
      saveFeedback,
      render,
      open,
      toast,
      previewDay,
      formDay,
      renderStats,
      renderCalendar,
      updateResetDayButton,
      closeLeavePanel,
      renderEditor,
    });
    const controllerOptions = {
      core: C,
      element: $,
      escape: esc,
      model,
      persistence,
      actions,
      clock,
      importIndex,
      clipboard: WorkClipboard.create(() => navigator.clipboard),
      downloads: WorkDownloads.create({ document, URL, Blob }),
    };
    lifecycle.defer(() => controllerOptions.downloads.dispose());
    const controllers = [];
    for (const create of [
      WorkUI.createTemplateController,
      WorkUI.createSettingsController,
      WorkUI.createBackupController,
      WorkUI.createImportController,
      WorkUI.createDayController,
      WorkUI.createNavigationController,
      WorkUI.createDialogController,
    ]) {
      const controller = create(controllerOptions);
      controllers.push(controller);
      lifecycle.defer(() => controller.dispose());
    }
    for (const controller of controllers) {
      const { bind, dispose, ...commands } = controller;
      Object.assign(actions, commands);
    }
    for (const controller of controllers) controller.bind();
    const calendarFooter = document.querySelector(".calendar-footer"),
      notificationTabs = document.querySelector(".editor>.notification-tabs");
    const syncNotificationBarHeight = () => {
      notificationTabs.style.height =
        calendarFooter.getBoundingClientRect().height + "px";
    };
    const footerObserver = new ResizeObserver(syncNotificationBarHeight);
    footerObserver.observe(calendarFooter);
    lifecycle.defer(() => footerObserver.disconnect());
    render();
    syncNotificationBarHeight();
    if (defaultsUpdated) save();
    lifecycle.defer(
      clock.watch({
        document,
        onChange(today) {
          model.today = today;
          renderOAStaleNotice();
          renderStats();
          renderCalendar(true);
          updateNotificationEmptyState();
        },
      }),
    );
  },
  { document },
);

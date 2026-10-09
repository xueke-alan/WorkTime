"use strict";
WorkTimeApp.services.bootstrap.run(
  async (lifecycle) => {
    lifecycle.defer(() => WorkTimeApp.services.preferences.page.dispose());
    lifecycle.defer(() => WorkTimeApp.ui.theme.dispose());
    lifecycle.defer(() => WorkTimeApp.ui.alignment?.dispose());
    lifecycle.defer(() => WorkTimeApp.ui.numbers?.dispose());
    lifecycle.defer(() => WorkTimeApp.ui.dateInfo?.dispose());
    lifecycle.defer(() => WorkTimeApp.ui.motion?.dispose());
    lifecycle.defer(() => WorkTimeApp.ui.background?.dispose());
    lifecycle.defer(() => WorkTimeApp.ui.notificationMotion?.dispose());
    const D = WorkTimeApp.domain;
    const elements = WorkTimeApp.ui.createElements(document);
    const { element: $, escape: esc, icon, controlIcon, trendIcon } = elements;
    elements.initialize();
    const sidebarPanels = WorkTimeApp.ui.createSidebarPanels({
      document,
      window,
      leaveBatch: () => workspace.leaveBatch(),
    });
    lifecycle.defer(() => sidebarPanels.dispose());
    const persistence = WorkTimeApp.services.storage.create({
      key: D.state.KEY,
      validate: D.validation.validateBackup,
      defaultState: D.state.defaultState,
      getStorage: () => localStorage,
    });
    lifecycle.defer(() => persistence.releaseWriteAccess());
    const access = await persistence.acquireWriteAccess(navigator.locks);
    if (lifecycle.closed) {
      persistence.releaseWriteAccess();
      return;
    }
    const loaded = persistence.load();
    const storageStatus = WorkTimeApp.ui.createStorageStatus({
      element: $,
      key: D.state.KEY,
      getStorage: () => localStorage,
      window,
    });
    lifecycle.defer(() => storageStatus.dispose());
    storageStatus.mount({
      readError: loaded.error,
      loadIssue: loaded.loadIssue,
      accessError: access.ok ? null : access.error,
    });
    const clock = WorkTimeApp.services.clock.create({
      dateKey: D.time.businessDate,
    });
    const model = WorkTimeApp.services.application.create({
      state: loaded.state,
      writable: access.ok,
      readError: loaded.error,
      corrupt: loaded.corrupt,
      today: clock.today(),
    });
    const actions = {};
    const stateOwner = WorkTimeApp.services.application.createState({
      state: model.state,
      persistence,
      core: {
        defaultState: D.state.defaultState,
        canBatchEditDate: D.schedule.canBatchEditDate,
        validateBackup: D.validation.validateBackup,
        applyObservation: D.observations.applyObservation,
        compactOAState: D.observations.compactOAState,
        calendarInfo: D.calendar.calendarInfo,
        deleteImport: D.observations.deleteImport,
        validateTimeTemplate: D.validation.validateTimeTemplate,
      },
      failed: !!loaded.error || !access.ok,
      corrupt: loaded.corrupt,
      unsaved: !!loaded.error,
    });
    Object.defineProperties(model, {
      state: { get: () => stateOwner.state },
      revision: { get: () => stateOwner.revision },
      storageFailed: { get: () => stateOwner.failed },
      loadCorrupt: { get: () => stateOwner.loadCorrupt },
      loadIssue: { get: () => persistence.loadIssue },
    });
    const derived = WorkTimeApp.services.derived.create({
      core: {
        DEFAULT_START: D.state.DEFAULT_START,
        attendanceHoursThrough: D.statistics.attendanceHoursThrough,
        businessDate: D.time.businessDate,
        businessMinutes: D.time.businessMinutes,
        calculate: D.records.calculate,
        countRestOvertimeDays: D.statistics.countRestOvertimeDays,
        cumulativeAverageOvertime: D.statistics.cumulativeAverageOvertime,
        dateKey: D.time.dateKey,
        localDate: D.time.localDate,
        oaStaleness: D.statistics.oaStaleness,
        pendingWorkdays: D.statistics.pendingWorkdays,
        scheduleForDate: D.schedule.scheduleForDate,
        selectOvertimeRequirement: D.statistics.selectOvertimeRequirement,
        summary: D.statistics.summary,
        targetPace: D.statistics.targetPace,
        timeMin: D.time.timeMin,
        validDate: D.time.validDate,
      },
      getState: () => model.state,
      getRevision: () => model.revision,
      now: clock.now,
    });
    const queries = derived.queries;
    const importIndex = WorkTimeApp.services.importIndex.create({
      core: { parseText: D.observations.parseText },
    });
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
    const monthBounds = () => D.time.monthBounds(model.month);
    const shared = {
      element: $,
      escape: esc,
      getState,
      getView,
      numbers: WorkTimeApp.ui.numbers,
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
    } = WorkTimeApp.ui.createDayPresentation({
      ...shared,
      core: {
        calendarInfo: D.calendar.calendarInfo,
        complete: D.records.complete,
        effectiveRecord: D.records.effectiveRecord,
        scheduleForDate: D.schedule.scheduleForDate,
        timeMin: D.time.timeMin,
      },
    });
    const notifications = WorkTimeApp.ui.createNotifications({
      ...shared,
      core: { oaStaleness: queries.oaStaleness },
      getRange: monthBounds,
      icon,
      timeAnomaly,
    });
    lifecycle.defer(() => notifications.dispose());
    const {
      decorateStaticNotices,
      updateNotificationEmptyState,
      toast,
      renderTimeAnomalyNotice,
    } = notifications;
    const { renderStats } = WorkTimeApp.ui.createSummary({
      ...shared,
      core: {
        pendingWorkdays: queries.pendingWorkdays,
        selectOvertimeRequirement: queries.selectOvertimeRequirement,
        summary: queries.summary,
        targetPace: queries.targetPace,
        validDate: D.time.validDate,
      },
      getRange: monthBounds,
      isStorageFailed: () => model.storageFailed,
    });
    const weatherLayer = WorkTimeApp.ui.createCalendarWeather({
      calendar: $("calendar"),
      weather: WorkTimeApp.services.weather,
      weatherUI: WorkTimeApp.ui.weather,
      now: clock.now,
      businessDate: D.time.businessDate,
    });
    lifecycle.defer(() => weatherLayer.dispose());
    WorkTimeApp.ui.calendarWeather = weatherLayer;
    const calendarUI = WorkTimeApp.ui.createCalendar({
      ...shared,
      core: {
        canBatchEditDate: D.schedule.canBatchEditDate,
        actualRecord: D.records.actualRecord,
        calculate: queries.calculate,
        calendarInfo: D.calendar.calendarInfo,
        calendarKnown: D.calendar.calendarKnown,
        complete: D.records.complete,
        cumulativeAverageOvertime: queries.cumulativeAverageOvertime,
        dateKey: D.time.dateKey,
        effectiveRecord: D.records.effectiveRecord,
        formatMinutes: D.time.formatMinutes,
        hours: D.time.hours,
        localDate: D.time.localDate,
        pad: D.time.pad,
        payday: D.payday.calculate,
        pendingWorkdays: queries.pendingWorkdays,
        scheduleForDate: D.schedule.scheduleForDate,
        scheduleSignature: D.schedule.scheduleSignature,
        validDate: D.time.validDate,
      },
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
      year: WorkTimeApp.ui.year,
      weatherLayer,
    });
    const { renderCalendar } = calendarUI;
    const {
      updateResetDayButton,
      renderEditor,
      formDay,
      previewDay,
      openLeavePanel,
      closeLeavePanel,
    } = WorkTimeApp.ui.createEditor({
      ...shared,
      core: {
        attendanceHoursThrough: queries.attendanceHoursThrough,
        calculate: queries.calculate,
        calendarInfo: D.calendar.calendarInfo,
        editedDay: D.records.editedDay,
        employmentDay: D.time.employmentDay,
        cumulativeAverageOvertime: queries.cumulativeAverageOvertime,
        effectiveRecord: D.records.effectiveRecord,
        formatMinutes: D.time.formatMinutes,
        hours: D.time.hours,
        localDate: D.time.localDate,
        scheduleForDate: D.schedule.scheduleForDate,
      },
      renderTimeTemplates: (...args) => actions.renderTimeTemplates(...args),
      timeAnomaly,
      isFullLeave,
    });
    const workspace = WorkTimeApp.ui.createWorkspace({
      model,
      element: $,
      document,
      window,
      sidebarPanels,
      notifications,
      renderStats,
      renderCalendar,
      renderEditor,
      refreshSettings: () => actions.refreshSettings(),
    });
    const { render, open, saveFeedback } = workspace;
    lifecycle.defer(() => workspace.dispose());
    decorateStaticNotices();
    const saveSession = WorkTimeApp.services.createSaveSession({
      owner: stateOwner,
      persistence,
      locks: navigator.locks,
      hasDraft: () => controllers.some((controller) => controller.hasDraft?.()),
      onCommit(result) {
        if (result.applied)
          WorkTimeApp.services.countdown.setState(model.state);
        storageStatus.commit(result, stateOwner.failed);
        storageStatus.updateRecovery();
        for (const controller of controllers) controller.updateRecovery?.();
      },
      onReload: workspace.reload,
      onRecovered() {
        for (const controller of controllers) controller.onSaveRecovered?.();
      },
      onRecoveryError: storageStatus.recoveryFailed,
      onAccessError: storageStatus.accessFailed,
      onRecoveryDone: workspace.recoveryDone,
    });
    lifecycle.defer(() => saveSession.dispose());
    const application = Object.fromEntries(
      [
        "saveDay",
        "togglePlanned",
        "resetDay",
        "saveTemplate",
        "removeTemplate",
        "saveBatch",
        "importRecords",
        "removeImport",
        "saveOAUrl",
        "saveSettings",
        "savePersonal",
        "restore",
        "initialize",
        "applySchedule",
      ].map((name) => [
        name,
        (...args) => saveSession.commit(stateOwner[name](...args)),
      ]),
    );
    Object.assign(actions, {
      controlIcon,
      clone: D.state.cloneState,
      saveFeedback,
      render,
      open,
      closeSettings: sidebarPanels.closeSettings,
      toast,
      previewDay,
      formDay,
      renderStats,
      renderCalendar,
      updateResetDayButton,
      openLeavePanel,
      closeLeavePanel,
      renderEditor,
    });
    const controllerOptions = {
      element: $,
      escape: esc,
      model,
      application,
      getOriginalStorageText: () => persistence.originalText,
      actions,
      clock,
      preferences: {
        get state() {
          return WorkTimeApp.services.preferences.page.state;
        },
        saveTheme: WorkTimeApp.services.preferences.page.saveTheme,
      },
      importIndex,
      clipboard: WorkTimeApp.services.clipboard.create(
        () => navigator.clipboard,
      ),
      downloads: WorkTimeApp.services.downloads.create({ document, URL, Blob }),
    };
    lifecycle.defer(() => controllerOptions.downloads.dispose());
    const controllers = [];
    for (const [create, operations, core] of [
      [
        WorkTimeApp.ui.createTemplateController,
        ["saveTemplate", "removeTemplate"],
        {
          scheduleForDate: D.schedule.scheduleForDate,
          validateTimeTemplate: D.validation.validateTimeTemplate,
        },
      ],
      [
        WorkTimeApp.ui.createSettingsController,
        ["saveSettings", "applySchedule"],
        {
          applyScheduleRange: D.schedule.applyScheduleRange,
          breakMin: D.time.breakMin,
          hours: D.time.hours,
          pad: D.time.pad,
          scheduleForDate: D.schedule.scheduleForDate,
          scheduleRangeForChoice: D.schedule.scheduleRangeForChoice,
          validateOvertimeRequirements:
            D.validation.validateOvertimeRequirements,
          validateSchedule: D.schedule.validateSchedule,
        },
      ],
      [
        WorkTimeApp.ui.createPersonalSettingsController,
        ["savePersonal"],
        { validDate: D.time.validDate },
      ],
      [
        WorkTimeApp.ui.createBackupController,
        ["restore", "initialize"],
        { hours: D.time.hours, validateBackup: D.validation.validateBackup },
      ],
      [
        WorkTimeApp.ui.createImportController,
        ["importRecords", "removeImport", "saveOAUrl"],
        {
          deleteImport: D.observations.deleteImport,
          timeMin: D.time.timeMin,
          parseText: D.observations.parseText,
          mergeObservation: D.observations.mergeObservation,
        },
      ],
      [
        WorkTimeApp.ui.createDayController,
        ["saveDay", "togglePlanned", "resetDay"],
        {
          calendarInfo: D.calendar.calendarInfo,
          effectiveRecord: D.records.effectiveRecord,
          hours: D.time.hours,
          pad: D.time.pad,
          scheduleForDate: D.schedule.scheduleForDate,
        },
      ],
      [
        WorkTimeApp.ui.createNavigationController,
        ["saveBatch"],
        {
          canBatchEditDate: D.schedule.canBatchEditDate,
          calendarInfo: D.calendar.calendarInfo,
          complete: D.records.complete,
          dateKey: D.time.dateKey,
          endForDuration: D.records.endForDuration,
          localDate: D.time.localDate,
          scheduleForDate: D.schedule.scheduleForDate,
          scheduleSignature: D.schedule.scheduleSignature,
          timeMin: D.time.timeMin,
          validDate: D.time.validDate,
        },
      ],
      [WorkTimeApp.ui.createDialogController, [], {}],
    ]) {
      const controller = create({
        ...controllerOptions,
        core,
        application: Object.fromEntries(
          operations.map((name) => [name, application[name]]),
        ),
      });
      controllers.push(controller);
      lifecycle.defer(() => controller.dispose());
    }
    for (const controller of controllers) {
      const { bind, dispose, hasDraft, onSaveRecovered, ...commands } =
        controller;
      Object.assign(actions, commands);
    }
    for (const controller of controllers) controller.bind();
    workspace.mount();
    storageStatus.bindRetry({
      available: !!navigator.locks?.request,
      corrupt: model.loadCorrupt,
      getLoadIssue: () => model.loadIssue,
      retry: saveSession.retry,
    });
    if (stateOwner.dirty && !loaded.error && access.ok) {
      saveSession.commit(stateOwner.retry());
      workspace.recoveryDone();
    }
    if (!access.ok) saveSession.wait();
    lifecycle.defer(
      clock.watch({
        document,
        onChange: workspace.dateChanged,
      }),
    );
  },
  { document },
);

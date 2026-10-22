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
    const persistence = WorkTimeApp.services.indexedStorage.create({
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
    const loaded = await persistence.load();
    WorkTimeApp.services.archiveCache = persistence.cache;
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
      unsaved: loaded.corrupt,
    });
    Object.defineProperties(model, {
      state: { get: () => stateOwner.state },
      revision: { get: () => stateOwner.revision },
      storageFailed: { get: () => stateOwner.failed },
      loadCorrupt: { get: () => stateOwner.loadCorrupt },
      loadIssue: { get: () => persistence.loadIssue },
    });
    const getPreviewState = () => {
      if (!model.batchMode || !model.batchDraft) return model.state;
      if (model.batchPreview?.base !== model.state)
        model.batchPreview = {
          base: model.state,
          state: D.batch.applyBatchChanges(model.state, model.batchDraft),
        };
      return model.batchPreview.state;
    };
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
      getState: getPreviewState,
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
      batchDraft: model.batchDraft,
      batchSaving: model.batchSaving,
      yearMode: model.yearMode,
      analysisMode: model.analysisMode,
      analysisIncludeManual: model.analysisIncludeManual,
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
      getState: getPreviewState,
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
      getState: getPreviewState,
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
    const analysisUI = WorkTimeApp.ui.createAnalysis(shared);
    lifecycle.defer(() => analysisUI.dispose());
    const calendarUI = WorkTimeApp.ui.createCalendar({
      renderAnalysis: analysisUI.render,
      ...shared,
      getState: getPreviewState,
      getOriginalState: getState,
      core: {
        canBatchEditDate: D.schedule.canBatchEditDate,
        actualRecord: D.records.actualRecord,
        calculate: queries.calculate,
        calendarInfo: D.calendar.calendarInfo,
        calendarKnown: D.calendar.calendarKnown,
        complete: D.records.complete,
        cumulativeAverageOvertime: queries.cumulativeAverageOvertime,
        selectOvertimeRequirement: queries.selectOvertimeRequirement,
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
      updatePlannedOvertime,
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
        complete: D.records.complete,
        duration: D.records.duration,
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
        if (result.pending) {
          storageStatus.saving();
          return;
        }
        if (result.applied)
          WorkTimeApp.services.countdown.setState(model.state);
        storageStatus.commit(result, stateOwner.failed);
        if (stateOwner.pending) storageStatus.saving();
        if (result.persisted) channel?.postMessage({ updated: true });
        storageStatus.updateRecovery();
        for (const controller of controllers) controller.updateRecovery?.();
      },
      onReload() {
        WorkTimeApp.services.preferences.page.synchronize();
        workspace.reload();
      },
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
        "cancelPlanned",
        "toggleSourcePriority",
        "resetDay",
        "resetBatch",
        "saveTemplate",
        "removeTemplate",
        "replaceTemplates",
        "saveBatch",
        "confirmBatch",
        "importRecords",
        "removeImport",
        "saveOAUrl",
        "saveSettings",
        "savePersonal",
        "savePreferences",
        "restore",
        "initialize",
        "applySchedule",
      ].map((name) => [
        name,
        (...args) => saveSession.commit(stateOwner[name](...args)),
      ]),
    );
    WorkTimeApp.services.preferences.page.attach({
      state: model.state.preferences,
      save: (preferences) => application.savePreferences(preferences),
      getState: () => model.state.preferences,
    });
    const beforeUnload = (event) => {
      if (
        !stateOwner.pending &&
        !stateOwner.dirty &&
        !stateOwner.failed &&
        !WorkTimeApp.services.preferences.page.dirty &&
        !controllers.some((controller) => controller.hasDraft?.())
      )
        return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    lifecycle.defer(() =>
      window.removeEventListener("beforeunload", beforeUnload),
    );
    Object.assign(actions, {
      controlIcon,
      clone: D.state.cloneState,
      saveFeedback,
      render,
      open,
      closeSettings: sidebarPanels.closeSettings,
      finishSidebarNavigation: sidebarPanels.finishNavigationMotion,
      toast,
      previewDay,
      formDay,
      renderStats,
      renderCalendar,
      updateResetDayButton,
      updatePlannedOvertime,
      openLeavePanel,
      closeLeavePanel,
      renderEditor,
      leaveBatch: workspace.leaveBatch,
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
      persistence,
      exportArchive: () =>
        stateOwner.export(WorkTimeApp.services.preferences.page.state),
      hydrateImports: () => stateOwner.hydrateImports(),
      importIndex,
      clipboard: WorkTimeApp.services.clipboard.create(
        () => navigator.clipboard,
      ),
      downloads: WorkTimeApp.services.downloads.create({ document, URL, Blob }),
    };
    lifecycle.defer(() => controllerOptions.downloads.dispose());
    const controllers = [];
    let channel;
    if (typeof BroadcastChannel === "function") {
      channel = new BroadcastChannel("worktime-archive");
      channel.onmessage = async () => {
        try {
          if (await persistence.hasExternalUpdate())
            storageStatus.externalUpdate();
        } catch {}
      };
      lifecycle.defer(() => channel.close());
    }
    const legacyChanged = async (event) => {
      if (event.key !== D.state.KEY && event.key !== null) return;
      try {
        await persistence.checkLegacy();
      } catch (error) {
        stateOwner.markUnsaved();
        storageStatus.commit({ persisted: false, error }, true);
      }
    };
    window.addEventListener("storage", legacyChanged);
    lifecycle.defer(() => window.removeEventListener("storage", legacyChanged));
    for (const [create, operations, core] of [
      [
        WorkTimeApp.ui.createTemplateController,
        ["saveTemplate", "removeTemplate", "replaceTemplates"],
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
        ["saveDay", "togglePlanned", "cancelPlanned", "resetDay"],
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
        ["confirmBatch", "toggleSourcePriority"],
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
    const games = WorkTimeApp.ui.createGamesController({ document, window });
    lifecycle.defer(() => games.dispose());
    function refreshLanguage() {
      const errors = WorkTimeApp.ui.fieldErrors.snapshot();
      const focusId = document.activeElement?.id;
      const leaveOpen =
        $("dayLeaveToggle").getAttribute("aria-expanded") === "true";
      const drafts = [
        ...document.querySelectorAll("input,textarea,select"),
      ].map((element) => ({
        element,
        value: element.value,
        checked: element.checked,
        start: element.selectionStart,
        end: element.selectionEnd,
      }));
      renderStats();
      renderCalendar(true);
      renderEditor();
      notifications.refreshLanguage();
      if (model.batchMode) actions.refreshBatchPreview();
      for (const { element, value, checked, start, end } of drafts) {
        if (!element.isConnected || element.id === "languageSelect") continue;
        element.value = value;
        if ("checked" in element) element.checked = checked;
        if (start !== null) element.setSelectionRange?.(start, end);
      }
      if (leaveOpen) openLeavePanel();
      previewDay();
      for (const [element, error] of errors)
        if (element.isConnected)
          WorkTimeApp.ui.fieldErrors.show(element, error);
      if (focusId) $(focusId)?.focus({ preventScroll: true });
      WorkTimeApp.ui.alignment?.refresh();
    }
    document.addEventListener("worktime:languagechange", refreshLanguage);
    lifecycle.defer(() =>
      document.removeEventListener("worktime:languagechange", refreshLanguage),
    );
    if (model.loadIssue === "unsupported") {
      const allowed = new Set([
        "prevMonth",
        "nextMonth",
        "todayButton",
        "backup",
        "recoveryOpen",
        "exportCorruptStorage",
        "downloadRecovery",
      ]);
      for (const element of document.querySelectorAll(
        "button,input,select,textarea",
      )) {
        if (
          allowed.has(element.id) ||
          element.dataset.close ||
          element.hasAttribute("data-date")
        )
          continue;
        element.disabled = true;
      }
    }
    storageStatus.bindRetry({
      available: true,
      corrupt: model.loadCorrupt,
      getLoadIssue: () => model.loadIssue,
      retry: saveSession.retry,
    });
    if (stateOwner.dirty && !loaded.error && access.ok) {
      await saveSession.commit(stateOwner.retry());
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

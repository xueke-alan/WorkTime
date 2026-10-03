"use strict";
const WorkValidation = (() => {
  const { validDate, timeMin } = WorkTimeValues,
    { DEFAULT_START, SCHEMA, defaultState } = WorkState,
    { complete, duration, inferWorkEnd } = WorkRecords;
  const object = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  function fail(path, message) {
    const error = Error(message + " [" + path + "]");
    error.name = "BackupValidationError";
    error.path = path;
    error.userMessage = message;
    throw error;
  }
  function clock(value, path, allowEmpty = false) {
    if (
      typeof value !== "string" ||
      ((value !== "" || !allowEmpty) && timeMin(value) === null)
    )
      fail(path, "请填写有效的 HH:MM 时间。");
  }
  function text(value, path) {
    if (
      value != null &&
      !["string", "number", "boolean"].includes(typeof value)
    )
      fail(path, "备份中的文本字段无效。");
    return String(value || "");
  }
  function validateOvertimeRequirements(values, path = "overtimeRequirements") {
    const message = "加班条件须为五档 0–24 小时要求，最低要求不能为空。";
    if (!Array.isArray(values) || values.length !== 5) fail(path, message);
    if (values[0] === null) fail(path + "[0]", message);
    Array.from(values, (value, index) => {
      if (
        value !== null &&
        (!Number.isFinite(value) || value < 0 || value > 1440)
      )
        fail(path + "[" + index + "]", message);
    });
    return [...values];
  }
  function validateImportRecord(record, year, path = "importRecord") {
    if (!object(record)) fail(path, "备份中的导入打卡记录无效。");
    if (
      typeof record.date !== "string" ||
      !validDate(record.date) ||
      Number(record.date.slice(0, 4)) !== year
    )
      fail(path + ".date", "备份中的导入打卡日期无效。");
    clock(record.start, path + ".start", true);
    clock(record.end, path + ".end", true);
    if (typeof record.nextDay !== "boolean")
      fail(path + ".nextDay", "备份中的次日下班标记无效。");
    if (!["complete", "pending", "off"].includes(record.status))
      fail(path + ".status", "备份中的导入打卡状态无效。");
    if (record.effectiveMinutes != null)
      fail(path + ".effectiveMinutes", "导入原始打卡不支持修正工时。");
    if (
      record.status === "complete" &&
      (timeMin(record.start) === null ||
        timeMin(record.end) === null ||
        timeMin(record.end) + (record.nextDay ? 1440 : 0) <
          timeMin(record.start))
    )
      fail(path + ".end", "备份中的完整导入记录无效。");
    return {
      date: record.date,
      start: record.start,
      end: record.end,
      nextDay: record.nextDay,
      status: record.status,
      source: text(record.source, path + ".source"),
      raw: text(record.raw, path + ".raw"),
    };
  }
  function validateTimeTemplate(template, path = "timeTemplate") {
    if (!object(template)) fail(path, "模板标识无效。");
    if (
      typeof template.id !== "string" ||
      !template.id.trim() ||
      template.id.length > 100
    )
      fail(path + ".id", "模板标识无效。");
    if (
      typeof template.name !== "string" ||
      !template.name.trim() ||
      template.name.trim().length > 30
    )
      fail(path + ".name", "模板名称须为 1–30 个字符。");
    clock(template.start, path + ".start");
    clock(template.end, path + ".end");
    if (typeof template.nextDay !== "boolean")
      fail(path + ".nextDay", "请填写完整的上下班时间。");
    if (
      timeMin(template.end) + (template.nextDay ? 1440 : 0) <
      timeMin(template.start)
    )
      fail(path + ".end", "下班早于上班，跨午夜请勾选“次日下班”。");
    return {
      id: template.id,
      name: template.name.trim(),
      start: template.start,
      end: template.end,
      nextDay: template.nextDay,
    };
  }
  function validateDay(key, day, standard) {
    const path = "days." + key;
    if (!validDate(key) || !object(day)) fail(path, "备份中的日期记录无效。");
    if (day.kind !== undefined && !["work", "rest"].includes(day.kind))
      fail(path + ".kind", key + " 的日历属性无效。");
    if (
      day.leaveMinutes !== undefined &&
      (!Number.isInteger(day.leaveMinutes) ||
        day.leaveMinutes < 0 ||
        day.leaveMinutes > standard)
    )
      fail(
        path + ".leaveMinutes",
        key + " 的请假时长无效，不能超过规范化后的标准工时。",
      );
    const clean = {};
    if (day.plannedOvertime !== undefined) {
      if (typeof day.plannedOvertime !== "boolean")
        fail(path + ".plannedOvertime", key + " 的计划加班标记无效。");
      clean.plannedOvertime = day.plannedOvertime;
    }
    if (day.kind) clean.kind = day.kind;
    if (day.note !== undefined) {
      if (typeof day.note !== "string") fail(path + ".note", "备注格式无效。");
      clean.note = day.note;
    }
    if (day.leaveMinutes !== undefined) clean.leaveMinutes = day.leaveMinutes;
    for (const name of ["oa", "actual", "estimate", "draft"]) {
      const record = day[name],
        field = path + "." + name;
      // Null represents an absent record in legacy backups; false/0/string are malformed.
      if (record === undefined || record === null) continue;
      if (!object(record)) fail(field, key + " 的打卡记录无效。");
      clock(record.start, field + ".start", true);
      clock(record.end, field + ".end", true);
      if (typeof record.nextDay !== "boolean")
        fail(field + ".nextDay", key + " 的次日下班标记无效。");
      if (
        record.effectiveMinutes !== undefined &&
        record.effectiveMinutes !== null &&
        (!Number.isInteger(record.effectiveMinutes) ||
          record.effectiveMinutes < 0 ||
          record.effectiveMinutes > 2880)
      )
        fail(field + ".effectiveMinutes", key + " 的修正工时无效。");
      if (name === "oa" && record.effectiveMinutes != null)
        fail(
          field + ".effectiveMinutes",
          key + " 的 OA 原始打卡不支持修正工时，请使用手动记录。",
        );
      if (
        name === "oa" &&
        !["complete", "pending", "off"].includes(record.status)
      )
        fail(field + ".status", key + " 的 OA 状态无效。");
      if (
        ((name === "oa" && record.status === "complete") ||
          name === "actual" ||
          name === "estimate") &&
        !complete(record)
      )
        fail(field + ".end", key + " 的完整工时记录无效。");
      const result = {
        start: record.start,
        end: record.end,
        nextDay: record.nextDay,
      };
      if (name === "oa") {
        if (record.date !== key) fail(field + ".date", "OA 日期不匹配。");
        Object.assign(result, {
          date: key,
          status: record.status,
          source: text(record.source, field + ".source"),
          raw: text(record.raw, field + ".raw"),
          importId: text(record.importId, field + ".importId"),
        });
      } else
        result.effectiveMinutes =
          record.effectiveMinutes === undefined
            ? null
            : record.effectiveMinutes;
      clean[name] = result;
    }
    return clean;
  }
  /** @param {*} input Untrusted decoded backup. @returns {WorkStateData} New normalized state; errors contain path and userMessage. */
  function validateBackup(input) {
    if (!object(input)) fail("$", "不是支持的工作记录备份文件。");
    if (input.schemaVersion !== SCHEMA)
      fail("schemaVersion", "不是支持的工作记录备份文件。");
    if (!object(input.settings)) fail("settings", "备份中的计算设置无效。");
    if (!object(input.days)) fail("days", "备份中的日期记录无效。");
    if (!Array.isArray(input.imports))
      fail("imports", "备份中的导入历史无效。");
    const settings = input.settings;
    if (typeof settings.configured !== "boolean")
      fail("settings.configured", "备份中的计算设置无效。");
    if (
      !Number.isInteger(settings.standardMinutes) ||
      settings.standardMinutes <= 0 ||
      settings.standardMinutes > 1440
    )
      fail("settings.standardMinutes", "备份中的计算设置无效。");
    if (!Array.isArray(settings.breaks))
      fail("settings.breaks", "备份中的休息时段无效。");
    const breaks = Array.from(settings.breaks, (rest, index) => {
      const path = "settings.breaks[" + index + "]";
      if (!object(rest)) fail(path, "备份中的休息时段无效。");
      if (!Number.isInteger(rest.start) || rest.start < 0 || rest.start >= 1440)
        fail(path + ".start", "备份中的休息时段无效。");
      if (
        !Number.isInteger(rest.end) ||
        rest.end > 1440 ||
        rest.end <= rest.start
      )
        fail(path + ".end", "备份中的休息时段无效。");
      return { start: rest.start, end: rest.end };
    });
    for (const key of ["workStart", "workEnd"])
      if (settings[key] !== undefined && settings[key] !== "")
        clock(settings[key], "settings." + key);
    const workStart = settings.workStart || DEFAULT_START,
      workEnd =
        settings.workEnd ||
        inferWorkEnd(workStart, settings.standardMinutes, breaks);
    if (!workEnd || timeMin(workEnd) <= timeMin(workStart))
      fail("settings.workEnd", "备份中的标准上下班时间无效。");
    const standard = duration(
      {
        start: workStart,
        end: workEnd,
        nextDay: false,
        effectiveMinutes: null,
      },
      { breaks },
    );
    if (!Number.isInteger(standard) || standard <= 0)
      fail("settings.standardMinutes", "备份中的标准工时区间无效。");
    if (
      settings.employmentDate !== undefined &&
      (typeof settings.employmentDate !== "string" ||
        (settings.employmentDate && !validDate(settings.employmentDate)))
    )
      fail("settings.employmentDate", "备份中的入职日期无效。");
    if (
      settings.workCity !== undefined &&
      (typeof settings.workCity !== "string" || settings.workCity.length > 64)
    )
      fail("settings.workCity", "备份中的工作城市须为不超过64字的文本。");
    const clean = defaultState();
    clean.scheduleDefaultsVersion = input.scheduleDefaultsVersion === 1 ? 1 : 0;
    clean.settings = {
      configured: settings.configured,
      workStart,
      workEnd,
      standardMinutes: standard,
      breaks,
      employmentDate: settings.employmentDate || "",
      workCity: settings.workCity || "",
    };
    if (input.oaUrl !== undefined) {
      if (
        typeof input.oaUrl !== "string" ||
        (input.oaUrl &&
          !/^https?:\/\/[^\s/]+(?:[/?#][^\s]*)?$/i.test(input.oaUrl))
      )
        fail("oaUrl", "备份中的 OA 链接无效。");
      clean.oaUrl = input.oaUrl;
    }
    if (input.targetAverageMinutes !== undefined) {
      if (
        !Number.isFinite(input.targetAverageMinutes) ||
        input.targetAverageMinutes < 0 ||
        input.targetAverageMinutes > 1440
      )
        fail("targetAverageMinutes", "备份中的月均加班目标无效。");
      clean.targetAverageMinutes = input.targetAverageMinutes;
    }
    clean.overtimeRequirements =
      input.overtimeRequirements === undefined
        ? [clean.targetAverageMinutes, null, null, null, null]
        : validateOvertimeRequirements(input.overtimeRequirements);
    for (const [key, day] of Object.entries(input.days))
      clean.days[key] = validateDay(key, day, standard);
    const importIds = new Set();
    clean.imports = Array.from(input.imports, (log, index) => {
      const path = "imports[" + index + "]";
      if (!object(log)) fail(path, "备份中的导入历史无效。");
      if (typeof log.id !== "string" || !log.id || importIds.has(log.id))
        fail(path + ".id", "备份中的导入历史标识无效或重复。");
      if (typeof log.at !== "string" || !Number.isFinite(Date.parse(log.at)))
        fail(path + ".at", "备份中的导入时间无效。");
      if (!Number.isInteger(log.year) || log.year < 1900 || log.year > 9999)
        fail(path + ".year", "备份中的导入年份无效。");
      if (!Array.isArray(log.sources))
        fail(path + ".sources", "备份中的导入来源无效。");
      const sources = Array.from(log.sources, (source, sourceIndex) => {
        const field = path + ".sources[" + sourceIndex + "]";
        if (!object(source)) fail(field, "备份中的导入来源无效。");
        return {
          name: text(source.name, field + ".name"),
          raw: text(source.raw, field + ".raw"),
        };
      });
      if (log.count != null && !["number", "string"].includes(typeof log.count))
        fail(path + ".count", "备份中的导入数量无效。");
      const count = log.count == null ? 0 : Number(log.count);
      if (
        log.count != null &&
        (!["number", "string"].includes(typeof log.count) ||
          !Number.isInteger(count) ||
          count < 0)
      )
        fail(path + ".count", "备份中的导入数量无效。");
      importIds.add(log.id);
      const result = { id: log.id, at: log.at, year: log.year, sources, count };
      if (log.records !== undefined) {
        if (!Array.isArray(log.records))
          fail(path + ".records", "备份中的导入打卡记录无效。");
        result.records = Array.from(log.records, (record, recordIndex) =>
          validateImportRecord(
            record,
            log.year,
            path + ".records[" + recordIndex + "]",
          ),
        );
      }
      return result;
    });
    if (
      input.timeTemplates !== undefined &&
      !Array.isArray(input.timeTemplates)
    )
      fail("timeTemplates", "备份中的时间模板无效。");
    const templateIds = new Set();
    clean.timeTemplates = Array.from(
      input.timeTemplates || [],
      (template, index) => {
        const path = "timeTemplates[" + index + "]",
          result = validateTimeTemplate(template, path);
        if (templateIds.has(result.id))
          fail(path + ".id", "备份中有重复的模板标识。");
        templateIds.add(result.id);
        return result;
      },
    );
    return clean;
  }
  return {
    validateOvertimeRequirements,
    validateImportRecord,
    validateTimeTemplate,
    validateBackup,
  };
})();

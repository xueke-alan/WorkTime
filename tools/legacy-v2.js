"use strict";
/** One-time schema 1/2 conversion only. No runtime core or editing/statistics facade.
 * Retained validation/replay bodies preserve historical rules; test-only frozen oracle has full provenance. */
const WorkLegacyV2 = (() => {
  const WorkTimeValues = (() => {
    const pad = (n) => String(n).padStart(2, "0");
    const dateKey = (d) =>
      d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    const localDate = (k) => {
      const a = k.split("-").map(Number);
      return new Date(a[0], a[1] - 1, a[2], 12);
    };
    const validDate = (k) =>
      /^\d{4}-\d{2}-\d{2}$/.test(k) &&
      dateKey(localDate(k)) === k &&
      Number(k.slice(0, 4)) >= 1900;
    const timeMin = (t) =>
      /^([01]\d|2[0-3]):[0-5]\d$/.test(t || "")
        ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
        : null;
    return { pad, localDate, validDate, timeMin };
  })();

  const WorkState = (() => {
    const DEFAULT_START = "08:00",
      DEFAULT_END = "17:30",
      DEFAULT_BREAKS = [
        { start: 720, end: 810 },
        { start: 1050, end: 1080 },
      ];
    const SCHEMA = 2;
    function defaultState() {
      return {
        schemaVersion: SCHEMA,
        scheduleDefaultsVersion: 1,
        targetAverageMinutes: 120,
        overtimeRequirements: [120, null, null, null, null],
        oaUrl: "",
        settings: {
          employmentDate: "",
          workCity: "",
          configured: true,
          workStart: DEFAULT_START,
          workEnd: DEFAULT_END,
          standardMinutes: 480,
          breaks: DEFAULT_BREAKS.map((b) => ({ ...b })),
        },
        scheduleRanges: [],
        timeTemplates: [],
        days: {},
        imports: [],
      };
    }
    return { DEFAULT_START, SCHEMA, defaultState };
  })();

  const WorkRecords = (() => {
    const { pad, timeMin } = WorkTimeValues;
    function complete(r) {
      if (!r) return false;
      if (r.effectiveMinutes !== null && r.effectiveMinutes !== undefined)
        return Number.isInteger(r.effectiveMinutes) && r.effectiveMinutes >= 0;
      const a = timeMin(r.start),
        b = timeMin(r.end);
      return a !== null && b !== null && b + (r.nextDay ? 1440 : 0) >= a;
    }
    function duration(r, settings) {
      if (!complete(r)) return null;
      if (r.effectiveMinutes !== null && r.effectiveMinutes !== undefined)
        return r.effectiveMinutes;
      const start = timeMin(r.start),
        end = timeMin(r.end) + (r.nextDay ? 1440 : 0),
        intervals = [];
      for (let offset = 0; offset <= 1440; offset += 1440)
        for (const rest of settings.breaks) {
          const a = Math.max(start, rest.start + offset),
            b = Math.min(end, rest.end + offset);
          if (b > a) intervals.push([a, b]);
        }
      intervals.sort((a, b) => a[0] - b[0]);
      let deduction = 0,
        left = null,
        right = null;
      for (const [a, b] of intervals) {
        if (left === null) {
          left = a;
          right = b;
        } else if (a <= right) right = Math.max(right, b);
        else {
          deduction += right - left;
          left = a;
          right = b;
        }
      }
      if (left !== null) deduction += right - left;
      return Math.max(0, end - start - deduction);
    }
    function inferWorkEnd(start, targetMinutes, breaks) {
      const startMinutes = timeMin(start);
      if (startMinutes === null) return null;
      for (let elapsed = 1; elapsed <= 1440 - startMinutes; elapsed++) {
        const absolute = startMinutes + elapsed,
          end = pad(Math.floor(absolute / 60)) + ":" + pad(absolute % 60);
        if (
          duration(
            { start, end, nextDay: false, effectiveMinutes: null },
            { breaks },
          ) >= targetMinutes
        )
          return end;
      }
      return null;
    }
    return { complete, duration, inferWorkEnd };
  })();

  const WorkSchedule = (() => {
    const { validDate, timeMin } = WorkTimeValues;
    function scheduleForDate(state, date) {
      const range = (state.scheduleRanges || []).find(
        (r) => r.start <= date && (!r.end || date <= r.end),
      );
      return range ? { ...state.settings, ...range.schedule } : state.settings;
    }
    function scheduleError(path, message) {
      const error = Error(message + " [" + path + "]");
      error.path = path;
      error.userMessage = message;
      throw error;
    }
    function validateSchedule(input, path = "schedule") {
      const fail = (key, message) => scheduleError(path + "." + key, message);
      if (!input || typeof input !== "object" || Array.isArray(input))
        scheduleError(path, "作息格式无效。");
      if (timeMin(input.workStart) === null)
        fail("workStart", "标准上班时间无效。");
      if (
        timeMin(input.workEnd) === null ||
        timeMin(input.workEnd) <= timeMin(input.workStart)
      )
        fail("workEnd", "标准下班时间必须晚于上班时间。");
      if (!Array.isArray(input.breaks)) fail("breaks", "休息时段格式无效。");
      const breaks = Array.from(input.breaks, (rest, i) => {
        if (
          !rest ||
          !Number.isInteger(rest.start) ||
          rest.start < 0 ||
          rest.start >= 1440
        )
          fail("breaks[" + i + "].start", "休息开始时间无效。");
        if (
          !Number.isInteger(rest.end) ||
          rest.end <= rest.start ||
          rest.end > 1440
        )
          fail("breaks[" + i + "].end", "休息结束时间无效。");
        return { start: rest.start, end: rest.end };
      });
      const standardMinutes = WorkRecords.duration(
        {
          start: input.workStart,
          end: input.workEnd,
          nextDay: false,
          effectiveMinutes: null,
        },
        { breaks },
      );
      if (standardMinutes < 1)
        fail("standardMinutes", "扣除休息后标准工时必须大于0。");
      if (
        input.standardMinutes !== undefined &&
        input.standardMinutes !== standardMinutes
      )
        fail("standardMinutes", "标准工时与作息不一致。");
      return {
        workStart: input.workStart,
        workEnd: input.workEnd,
        breaks,
        standardMinutes,
      };
    }
    function validateScheduleRanges(ranges) {
      if (!Array.isArray(ranges))
        scheduleError("scheduleRanges", "作息区间格式无效。");
      let previous = null;
      return Array.from(ranges, (r, i) => {
        const path = "scheduleRanges[" + i + "]";
        if (!r || !validDate(r.start))
          scheduleError(path + ".start", "作息开始日期无效。");
        if (r.end !== null && (!validDate(r.end) || r.end < r.start))
          scheduleError(path + ".end", "作息结束日期无效。");
        if (previous && (!previous.end || r.start <= previous.end))
          scheduleError(path + ".start", "作息区间必须有序且不能重叠。");
        const result = {
          start: r.start,
          end: r.end,
          schedule: validateSchedule(r.schedule, path + ".schedule"),
        };
        previous = result;
        return result;
      });
    }
    return { scheduleForDate, validateScheduleRanges };
  })();

  const WorkObservations = (() => {
    const { pad, localDate, validDate, timeMin } = WorkTimeValues;
    function parseText(raw, year, source = "粘贴文本") {
      const warnings = [],
        records = [];
      if (!Number.isInteger(year) || year < 1900 || year > 9999)
        return { records, warnings: ["年份必须为 1900–9999 的整数。"] };
      const lines = raw
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      let block = null;
      function finish() {
        if (!block) return;
        const k = year + "-" + pad(block.month) + "-" + pad(block.day);
        if (!validDate(k)) {
          warnings.push(source + "：无效日期 " + block.month + "/" + block.day);
          return;
        }
        const weekday = block.lines.find((x) =>
          /^(周|星期)[一二三四五六日天]$/.test(x),
        );
        if (weekday) {
          const w = "日一二三四五六"[localDate(k).getDay()];
          if (!weekday.endsWith(w) && !(w === "日" && weekday.endsWith("天")))
            warnings.push(
              source + "：" + k + " 的星期与文本不一致，请检查年份。",
            );
        }
        const times = block.lines.filter((x) => timeMin(x) !== null),
          off = block.lines.some((x) => /^[-—–]{2,}$/.test(x));
        if (times.length > 2) {
          warnings.push(
            source + "：" + k + " 有超过两次打卡，需手动核查；该日未导入。",
          );
          return;
        }
        if (!times.length && !off) {
          warnings.push(source + "：" + k + " 未识别到打卡或 --，该日未导入。");
          return;
        }
        const record = {
          date: k,
          start: times[0] || "",
          end: times[1] || "",
          nextDay: false,
          status:
            times.length === 2 ? "complete" : times.length ? "pending" : "off",
          source,
          raw: [block.header, ...block.lines].join("\n"),
        };
        if (times.length === 2 && timeMin(times[1]) < timeMin(times[0])) {
          record.status = "pending";
          warnings.push(
            source + "：" + k + " 下班早于上班，请在当天勾选“次日下班”后补录。",
          );
        }
        if (off && times.length)
          warnings.push(source + "：" + k + " 同时含 -- 与打卡，以打卡为准。");
        records.push(record);
      }
      for (const line of lines) {
        const m = /^(\d{1,2})[\/-](\d{1,2})$/.exec(line);
        if (m) {
          finish();
          block = {
            month: Number(m[1]),
            day: Number(m[2]),
            header: line,
            lines: [],
          };
        } else if (block) block.lines.push(line);
      }
      finish();
      if (!records.length && !warnings.length)
        warnings.push(source + "：未识别到 MM/DD 日期记录。");
      return { records, warnings };
    }
    function importRecords(log) {
      if (Array.isArray(log.records)) return log.records;
      return log.sources.flatMap(
        (source) => parseText(source.raw, log.year, source.name).records,
      );
    }
    return { importRecords };
  })();

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
    function validateOvertimeRequirements(
      values,
      path = "overtimeRequirements",
    ) {
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
        if (typeof day.note !== "string")
          fail(path + ".note", "备注格式无效。");
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
      if (input.schemaVersion !== 1 && input.schemaVersion !== SCHEMA)
        fail("schemaVersion", "不是支持的工作记录备份文件。");
      if (!object(input.settings))
        fail("settings", "备份中的工作时间设置无效。");
      if (!object(input.days)) fail("days", "备份中的日期记录无效。");
      if (!Array.isArray(input.imports))
        fail("imports", "备份中的导入历史无效。");
      const settings = input.settings;
      if (typeof settings.configured !== "boolean")
        fail("settings.configured", "备份中的工作时间设置无效。");
      if (
        !Number.isInteger(settings.standardMinutes) ||
        settings.standardMinutes <= 0 ||
        settings.standardMinutes > 1440
      )
        fail("settings.standardMinutes", "备份中的工作时间设置无效。");
      if (!Array.isArray(settings.breaks))
        fail("settings.breaks", "备份中的休息时段无效。");
      const breaks = Array.from(settings.breaks, (rest, index) => {
        const path = "settings.breaks[" + index + "]";
        if (!object(rest)) fail(path, "备份中的休息时段无效。");
        if (
          !Number.isInteger(rest.start) ||
          rest.start < 0 ||
          rest.start >= 1440
        )
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
      clean.scheduleDefaultsVersion =
        input.scheduleDefaultsVersion === 1 ? 1 : 0;
      clean.settings = {
        configured: settings.configured,
        workStart,
        workEnd,
        standardMinutes: standard,
        breaks,
        employmentDate: settings.employmentDate || "",
        workCity: settings.workCity || "",
      };
      clean.scheduleRanges =
        input.schemaVersion === 1
          ? []
          : WorkSchedule.validateScheduleRanges(input.scheduleRanges);
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
        clean.days[key] = validateDay(
          key,
          day,
          WorkSchedule.scheduleForDate(clean, key).standardMinutes,
        );
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
        if (
          log.count != null &&
          !["number", "string"].includes(typeof log.count)
        )
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
        const result = {
          id: log.id,
          at: log.at,
          year: log.year,
          sources,
          count,
        };
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
      if (input.pageTheme !== undefined) {
        if (
          !["green", "blue", "purple", "orange", "rose", "slate"].includes(
            input.pageTheme,
          )
        )
          fail("pageTheme", "备份中的页面主题无效。");
        clean.pageTheme = input.pageTheme;
      }
      return clean;
    }
    return {
      validateOvertimeRequirements,
      validateImportRecord,
      validateTimeTemplate,
      validateBackup,
    };
  })();
  return {
    validate: WorkValidation.validateBackup,
    acceptedRecords: WorkObservations.importRecords,
  };
})();

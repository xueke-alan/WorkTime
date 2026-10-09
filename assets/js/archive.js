"use strict";
/** Portable format. Database layout, domain model and wire versions are independent. */
WorkTimeApp.services.archive = (() => {
  const FORMAT = "worktime-archive",
    VERSION = 1;
  const names = [
    "profile",
    "rules",
    "schedule",
    "days",
    "templates",
    "imports",
    "observations",
    "evidence",
    "preferences",
  ];
  const ids = Object.fromEntries(
    names.map((name) => [name, "worktime." + name]),
  );
  const registry = new Map(
    Object.values(ids).map((id) => [id, { version: 1, migrations: {} }]),
  );
  function registerModule(id, { version, migrations = {} }) {
    check(
      typeof id === "string" &&
        id.includes(".") &&
        Number.isInteger(version) &&
        version > 0,
      "模块注册参数无效。",
    );
    registry.set(id, { version, migrations });
  }
  const clone = (value) => structuredClone(value);
  const uuid = () => crypto.randomUUID();
  function error(message, code = "INVALID_BACKUP") {
    return Object.assign(Error(message), { code });
  }
  const object = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  function check(condition, message) {
    if (!condition) throw error(message);
  }
  function safe(value) {
    if (Array.isArray(value)) return value.map(safe);
    if (!object(value)) return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      check(
        !["__proto__", "constructor", "prototype"].includes(key),
        "存档包含不安全的字段。",
      );
      out[key] = safe(item);
    }
    return out;
  }
  function merge(base, clean) {
    if (Array.isArray(clean)) {
      // Dates identify observations; equal clock times do not identify a day.
      const identity = (item) =>
        !object(item)
          ? null
          : item.id !== undefined
            ? JSON.stringify(["id", item.id])
            : item.date !== undefined
              ? JSON.stringify(["date", item.date])
              : item.start !== undefined
                ? JSON.stringify(["range", item.start, item.end])
                : null;
      const originals = new Map();
      if (Array.isArray(base))
        for (const item of base) {
          const key = identity(item);
          if (key !== null && !originals.has(key)) originals.set(key, item);
        }
      return clean.map((item, i) => {
        const match = originals.get(identity(item));
        return merge(match || base?.[i], item);
      });
    }
    if (!object(clean)) return clean;
    const out = { ...(object(base) ? base : {}) };
    for (const [key, item] of Object.entries(clean))
      out[key] = merge(base?.[key], item);
    return out;
  }
  function validateState(input) {
    const clean = WorkTimeApp.domain.validation.validateBackup(input);
    const result = merge(input, clean);
    const logs = new Map(
      result.imports.map((log) => [
        log.id,
        new Set(log.records.map((record) => record.date)),
      ]),
    );
    for (const [date, day] of Object.entries(result.days)) {
      if (!day.oa?.importId) continue;
      const log = logs.get(day.oa.importId);
      check(log?.has(date), date + " 的 OA 导入关联不存在。");
    }
    return result;
  }
  function encode(state, { exportedAt } = {}) {
    const metadata = state._archive || {};
    const header = metadata.header || {
      id: uuid(),
      createdAt: new Date().toISOString(),
    };
    const buckets = Object.fromEntries(names.map((name) => [name, []]));
    const record = (name, id, data, order = 0) =>
      buckets[name].push({ id, order, data });
    record("profile", "main", state.personal);
    record("rules", "main", {
      settings: state.settings,
      overtimeRequirements: state.overtimeRequirements,
      oaUrl: state.oaUrl,
    });
    record("preferences", "main", {
      ...state.preferences,
      forecastMode: state.preferences.forecastMode || "hourly",
    });
    state.scheduleRanges.forEach((range, order) =>
      record("schedule", range.start, range, order),
    );
    Object.entries(state.days).forEach(([date, day], order) =>
      record("days", date, day, order),
    );
    state.timeTemplates.forEach((template, order) =>
      record("templates", template.id, template, order),
    );
    state.imports.forEach((log, order) => {
      const { records, sources, _lazy, ...info } = log;
      record("imports", log.id, info, order);
      if (!log._lazy) {
        records.forEach((data, index) =>
          record("observations", JSON.stringify([log.id, index]), {
            importId: log.id,
            index,
            record: data,
          }),
        );
        sources.forEach((data, index) =>
          record("evidence", JSON.stringify([log.id, index]), {
            importId: log.id,
            index,
            source: data,
          }),
        );
      }
    });
    const modules = names.map((name) => ({
      ...(metadata.modules?.[ids[name]] || {}),
      id: ids[name],
      version: registry.get(ids[name]).version,
      records: buckets[name].map((item) => ({
        ...(metadata.recordExtras?.[ids[name]]?.[item.id] || {}),
        ...item,
        data: {
          ...(metadata.dataExtras?.[ids[name]]?.[item.id] || {}),
          ...item.data,
        },
      })),
    }));
    modules.push(...(metadata.unknownModules || []));
    return {
      ...(metadata.envelope || {}),
      format: FORMAT,
      formatVersion: VERSION,
      archive: { ...header },
      ...(exportedAt ? { exportedAt } : {}),
      modules,
    };
  }
  function decode(input, { partial = false } = {}) {
    input = safe(input);
    check(input.format === FORMAT, "不是支持的工作记录存档。");
    if (input.formatVersion !== VERSION)
      throw error(
        "存档外层版本不受支持，请使用对应的新版本应用。",
        "UNSUPPORTED_VERSION",
      );
    check(
      object(input.archive) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          input.archive.id,
        ),
      "存档身份无效。",
    );
    check(
      typeof input.archive.createdAt === "string" &&
        Number.isFinite(Date.parse(input.archive.createdAt)),
      "存档创建时间无效。",
    );
    check(Array.isArray(input.modules), "存档模块列表无效。");
    const map = new Map(),
      recordExtras = {},
      dataExtras = {},
      headers = {};
    for (let module of input.modules) {
      check(
        object(module) &&
          typeof module.id === "string" &&
          module.id.length > 0 &&
          !map.has(module.id),
        "模块标识无效或重复。",
      );
      check(
        Number.isInteger(module.version) &&
          module.version >= 1 &&
          Array.isArray(module.records),
        "模块版本或记录无效。",
      );
      const specification = registry.get(module.id);
      if (specification && module.version > specification.version)
        throw error(
          "模块 " + module.id + " 需要更新版本应用。",
          "UNSUPPORTED_VERSION",
        );
      while (specification && module.version < specification.version) {
        const migrate = specification.migrations[module.version];
        if (!migrate)
          throw error(
            "模块 " + module.id + " 缺少转换程序。",
            "UNSUPPORTED_VERSION",
          );
        const previous = module.version;
        const previousId = module.id;
        module = safe(migrate(clone(module)));
        check(
          module.id === previousId && module.version === previous + 1,
          "模块转换必须保留模块身份并逐版本升级。",
        );
      }
      const seen = new Set();
      recordExtras[module.id] = {};
      dataExtras[module.id] = {};
      for (const item of module.records) {
        check(
          object(item) &&
            typeof item.id === "string" &&
            item.id.length > 0 &&
            !seen.has(item.id) &&
            object(item.data),
          "模块记录标识或内容无效。",
        );
        check(
          Number.isInteger(item.order ?? 0) && (item.order ?? 0) >= 0,
          "记录顺序无效。",
        );
        seen.add(item.id);
        const { data, ...extra } = item;
        recordExtras[module.id][item.id] = extra;
        const owned =
          module.id === ids.rules
            ? ["settings", "overtimeRequirements", "oaUrl"]
            : module.id === ids.observations
              ? ["importId", "index", "record"]
              : module.id === ids.evidence
                ? ["importId", "index", "source"]
                : null;
        if (owned)
          dataExtras[module.id][item.id] = Object.fromEntries(
            Object.entries(data).filter(([key]) => !owned.includes(key)),
          );
      }
      const { records, ...header } = module;
      headers[module.id] = header;
      map.set(module.id, module);
    }
    const rows = (name) =>
      (map.get(ids[name])?.records || [])
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    const single = (name) => {
      const records = rows(name);
      check(
        records.length === 1 && records[0].id === "main",
        name + " 模块缺失或无效。",
      );
      return records[0].data;
    };
    for (const name of names)
      check(map.has(ids[name]), "缺少必要模块：" + name);
    const defaults = WorkTimeApp.domain.state.defaultState();
    const rules = single("rules");
    const logs = rows("imports").map((item) => ({
      ...item.data,
      id: item.id,
      records: [],
      sources: [],
      ...(partial ? { _lazy: true } : {}),
    }));
    const logMap = new Map(logs.map((log) => [log.id, log]));
    for (const [name, field, valueField] of [
      ["observations", "records", "record"],
      ["evidence", "sources", "source"],
    ]) {
      const entries = rows(name);
      for (const row of entries) {
        const data = row.data,
          log = logMap.get(data.importId);
        check(
          log &&
            Number.isInteger(data.index) &&
            data.index >= 0 &&
            data.index < entries.length &&
            object(data[valueField]),
          "导入记录引用无效。",
        );
        check(
          row.id === JSON.stringify([data.importId, data.index]) &&
            log[field][data.index] === undefined,
          "导入记录顺序或身份无效。",
        );
        log[field][data.index] = data[valueField];
      }
      if (!partial)
        for (const log of logs)
          check(Array.from(log[field]).every(object), "导入记录顺序不连续。");
    }
    const state = {
      ...defaults,
      personal: single("profile"),
      ...rules,
      preferences: {
        ...defaults.preferences,
        forecastMode: "hourly",
        ...single("preferences"),
      },
      scheduleRanges: rows("schedule").map((item) => {
        check(item.id === item.data.start, "作息身份无效。");
        return item.data;
      }),
      days: Object.fromEntries(
        rows("days").map((item) => [item.id, item.data]),
      ),
      timeTemplates: rows("templates").map((item) => {
        check(item.data.id === item.id, "模板身份无效。");
        return item.data;
      }),
      imports: logs,
    };
    check(
      ["hourly", "daily"].includes(state.preferences.forecastMode),
      "天气偏好无效。",
    );
    if (partial)
      for (const [date, day] of Object.entries(state.days))
        if (day.oa?.importId)
          check(logMap.has(day.oa.importId), date + " 的 OA 导入关联不存在。");
    const clean = partial
      ? merge(state, WorkTimeApp.domain.validation.validateBackup(state))
      : validateState(state);
    const { modules, archive, format, formatVersion, exportedAt, ...envelope } =
      input;
    clean._archive = {
      header: archive,
      envelope,
      modules: headers,
      recordExtras,
      dataExtras,
      unknownModules: [...map.values()].filter(
        (module) => !Object.values(ids).includes(module.id),
      ),
    };
    return clean;
  }
  function migrate(input, preferences = {}) {
    if (input?.format === FORMAT) return decode(input);
    const original = safe(input);
    check(object(original), "不是支持的工作记录存档。");
    for (const field of ["imports", "timeTemplates"])
      if (Array.isArray(original[field]))
        for (const item of original[field])
          if (object(item) && (item.id === undefined || item.id === ""))
            item.id = uuid();
    if (original.schemaVersion === 1 || original.schemaVersion === 2)
      input = WorkTimeApp.services.legacyConversion.convert(original);
    else input = original;
    input = validateState(input);
    if (WorkTimeApp.domain.preferences.isTheme(preferences.pageTheme))
      input.preferences.pageTheme = preferences.pageTheme;
    input.preferences.forecastMode = ["daily", "hourly"].includes(
      preferences.forecastMode,
    )
      ? preferences.forecastMode
      : input.preferences.forecastMode || "hourly";
    return decode(encode(input));
  }
  const needsMigration = (document) =>
    document.modules.some(
      (module) =>
        registry.has(module.id) &&
        module.version < registry.get(module.id).version,
    );
  return {
    FORMAT,
    VERSION,
    ids,
    names,
    uuid,
    clone,
    merge,
    encode,
    decode,
    migrate,
    error,
    registerModule,
    needsMigration,
  };
})();

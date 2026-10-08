"use strict";
/** observations domain. No DOM or storage access. Loaded as an ordered classic script for file://. */
WorkTimeApp.domain.observations = (() => {
  const { pad, localDate, validDate, timeMin } = WorkTimeApp.domain.time;
  const dateHeader = /^(\d{1,2})[\/-](\d{1,2})$/,
    weekdayLine = /^(周|星期)[一二三四五六日天]$/,
    offLine = /^[-—–]{2,}$/,
    timeLikeLine = /^\d{1,3}\s*[:：]\s*\d{1,3}(?:\s*[:：]\s*\d{1,3})?$/;
  function textLines(raw) {
    return raw
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  /** Preserve recognizable evidence, including rejected date blocks, without page noise. */
  function compactOAText(raw) {
    const lines = [];
    let inBlock = false;
    for (const line of textLines(raw)) {
      if (dateHeader.test(line)) {
        inBlock = true;
        lines.push(line);
      } else if (
        inBlock &&
        (weekdayLine.test(line) ||
          timeMin(line) !== null ||
          offLine.test(line) ||
          timeLikeLine.test(line))
      )
        lines.push(line);
    }
    return lines.join("\n");
  }
  /** Only raw text changes; accepted observations remain authoritative. Input is untouched. */
  function compactOAState(state) {
    const compactRecord = (record) => ({
      ...record,
      raw: compactOAText(record.raw),
    });
    return {
      ...state,
      days: Object.fromEntries(
        Object.entries(state.days).map(([date, day]) => [
          date,
          day.oa ? { ...day, oa: compactRecord(day.oa) } : day,
        ]),
      ),
      imports: state.imports.map((log) => ({
        ...log,
        sources: log.sources.map((source) => ({
          ...source,
          raw: compactOAText(source.raw),
        })),
        records: log.records.map(compactRecord),
      })),
    };
  }
  function parseText(raw, year, source = "粘贴文本") {
    const warnings = [],
      records = [];
    if (!Number.isInteger(year) || year < 1900 || year > 9999)
      return { records, warnings: ["年份必须为 1900–9999 的整数。"] };
    const lines = textLines(raw);
    let block = null;
    function finish() {
      if (!block) return;
      const k = year + "-" + pad(block.month) + "-" + pad(block.day);
      if (!validDate(k)) {
        warnings.push(source + "：无效日期 " + block.month + "/" + block.day);
        return;
      }
      const weekday = block.lines.find((x) => weekdayLine.test(x));
      if (weekday) {
        const w = "日一二三四五六"[localDate(k).getDay()];
        if (!weekday.endsWith(w) && !(w === "日" && weekday.endsWith("天")))
          warnings.push(
            source + "：" + k + " 的星期与文本不一致，请检查年份。",
          );
      }
      const times = block.lines.filter((x) => timeMin(x) !== null),
        off = block.lines.some((x) => offLine.test(x));
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
      const m = dateHeader.exec(line);
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
  /** @returns {WorkObservationMerge} Stable semantics; presentation owns labels. */
  function mergeObservation(old, incoming) {
    if (!old) return { record: incoming, code: "ADDED" };
    if (
      ["start", "end", "nextDay", "status"].every((k) => old[k] === incoming[k])
    )
      return { record: old, code: "DUPLICATE" };
    if (old.status === "complete" && incoming.status !== "complete")
      return { record: old, code: "KEEP_COMPLETE" };
    if (old.status === "complete" && incoming.status === "complete")
      return { record: incoming, code: "COMPLETE_CONFLICT", conflict: true };
    if (incoming.status === "complete")
      return { record: incoming, code: "COMPLETED" };
    if (old.start && !incoming.start)
      return { record: old, code: "KEEP_START" };
    return { record: incoming, code: "UPDATED" };
  }
  function applyObservation(state, record, importId) {
    const day = state.days[record.date] || (state.days[record.date] = {});
    const result = mergeObservation(day.oa, record);
    if (result.record !== day.oa) day.oa = { ...result.record, importId };
    if (day.oa.status === "complete") delete day.estimate;
    return result;
  }
  function importRecords(log) {
    return log.records;
  }
  function deleteImport(state, id) {
    if (!state.imports.some((log) => log.id === id))
      return { removed: false, affected: 0, restored: 0, cleared: 0 };
    const remaining = state.imports.filter((log) => log.id !== id),
      rebuilt = {};
    for (const log of remaining)
      for (const record of importRecords(log)) {
        const result = mergeObservation(rebuilt[record.date], record);
        if (result.record !== rebuilt[record.date])
          rebuilt[record.date] = { ...result.record, importId: log.id };
      }
    const result = { removed: true, affected: 0, restored: 0, cleared: 0 };
    for (const [date, day] of Object.entries(state.days)) {
      if (!day.oa || day.oa.importId !== id) continue;
      result.affected++;
      if (rebuilt[date]) {
        day.oa = rebuilt[date];
        result.restored++;
      } else {
        delete day.oa;
        result.cleared++;
      }
      if (
        !day.oa &&
        !day.actual &&
        !day.estimate &&
        !day.draft &&
        !day.kind &&
        !day.leaveMinutes &&
        !day.note &&
        !day.plannedOvertime
      )
        delete state.days[date];
    }
    state.imports = remaining;
    return result;
  }
  return {
    compactOAText,
    compactOAState,
    parseText,
    mergeObservation,
    applyObservation,
    importRecords,
    deleteImport,
  };
})();

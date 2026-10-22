"use strict";
/** time domain. No DOM or storage access. Loaded as an ordered classic script for file://. */
const WorkTimeDomainTime = (() => {
  /** @param {number} n */
  const pad = (n) => String(n).padStart(2, "0");
  /** @param {Date} d */
  const dateKey = (d) =>
    d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  // Business "today" uses China Standard Time; calendar cursors remain host-local noon dates.
  /** @param {Date} d */
  const businessDate = (d) =>
    new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  /** @param {Date} d */
  const businessMinutes = (d) => {
    const shifted = new Date(d.getTime() + 8 * 3600000);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  };
  /** @param {string} k */
  const localDate = (k) => {
    const a = k.split("-").map(Number);
    return new Date(a[0], a[1] - 1, a[2], 12);
  };
  /** @param {string} month */
  const monthBounds = (month) => {
    const [year, number] = month.split("-").map(Number);
    return [month + "-01", dateKey(new Date(year, number, 0, 12))];
  };
  /** @param {string} k */
  const validDate = (k) =>
    /^\d{4}-\d{2}-\d{2}$/.test(k) &&
    dateKey(localDate(k)) === k &&
    Number(k.slice(0, 4)) >= 1900;
  // Calendar-day distance is independent of the host's time zone and DST.
  const employmentDay = (employmentDate, selected) => {
    if (!validDate(employmentDate) || !validDate(selected)) return null;
    const utcDay = (date) =>
      Date.UTC(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10)),
      );
    const elapsed = Math.floor(
      (utcDay(selected) - utcDay(employmentDate)) / 86400000,
    );
    return {
      started: elapsed >= 0,
      days: elapsed >= 0 ? elapsed + 1 : -elapsed,
    };
  };
  /** @param {string} t */
  const timeMin = (t) =>
    /^([01]\d|2[0-3]):[0-5]\d$/.test(t || "")
      ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
      : null;
  /** @param {string} t */
  const breakMin = (t) => (t === "24:00" ? 1440 : timeMin(t));
  /** @param {number|null|undefined} m */
  const formatMinutes = (m) =>
    m === null || m === undefined ? "—" : (m / 60).toFixed(2) + " h";
  /** @param {number} m */
  const hours = (m) => Number((m / 60).toFixed(4));
  return {
    pad,
    dateKey,
    businessDate,
    businessMinutes,
    localDate,
    monthBounds,
    validDate,
    employmentDay,
    timeMin,
    breakMin,
    formatMinutes,
    hours,
  };
})();

WorkTimeApp.domain.time = WorkTimeDomainTime;

"use strict";
/** time domain. No DOM or storage access. Loaded as an ordered classic script for file://. */
const WorkTimeValues = (() => {
  const pad = (n) => String(n).padStart(2, "0");
  const dateKey = (d) =>
    d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  // Business "today" uses China Standard Time; calendar cursors remain host-local noon dates.
  const businessDate = (d = new Date()) =>
    new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const businessMinutes = (d = new Date()) => {
    const shifted = new Date(d.getTime() + 8 * 3600000);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  };
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
  const breakMin = (t) => (t === "24:00" ? 1440 : timeMin(t));
  const formatMinutes = (m) =>
    m === null || m === undefined ? "—" : (m / 60).toFixed(2) + " h";
  const hours = (m) => Number((m / 60).toFixed(4));
  return {
    pad,
    dateKey,
    businessDate,
    businessMinutes,
    localDate,
    validDate,
    timeMin,
    breakMin,
    formatMinutes,
    hours,
  };
})();

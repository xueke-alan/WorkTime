"use strict";
const businessTime = "2026-10-02T12:00:00+08:00";
async function fixBusinessDate(page, time = businessTime) {
  await page.addInitScript((timestamp) => {
    const NativeDate = Date;
    const now = () => timestamp;
    window.Date = new Proxy(NativeDate, {
      apply() {
        return new NativeDate(timestamp).toString();
      },
      construct(target, args, newTarget) {
        return Reflect.construct(
          target,
          args.length ? args : [timestamp],
          newTarget,
        );
      },
      get(target, property, receiver) {
        return property === "now"
          ? now
          : Reflect.get(target, property, receiver);
      },
    });
  }, Date.parse(time));
}
module.exports = { businessTime, fixBusinessDate };

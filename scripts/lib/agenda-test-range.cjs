"use strict";
/** Fill both endpoints through the UI, including when fixtures move backwards. */
module.exports = async function setScheduleRange(page, start, end = start) {
  await page.locator("#agendaEndDateInput").fill(start);
  await page.locator("#agendaDateInput").fill(start);
  await page.locator("#agendaEndDateInput").fill(end);
};

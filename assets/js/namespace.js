"use strict";
/** Ordered classic scripts publish modules here; no runtime module loader. */
/** @type {WorkTimeNamespace} */
const WorkTimeApp = {
  domain: /** @type {WorkDomainNamespace} */ ({}),
  services: /** @type {WorkServiceNamespace} */ ({}),
  ui: {},
  data: /** @type {{dateInfo:Object,[key:string]:any}} */ ({
    dateInfo: { history: {}, festivals: [] },
  }),
};

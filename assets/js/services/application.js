"use strict";
/** Application state and navigation model. Storage and views are supplied separately. */
const WorkApplication = (() => {
  /** @param {{state:WorkStateData,writable:boolean,readError:Error|null,corrupt:boolean,today:string}} input @returns {WorkApplicationModel} */
  function create(input) {
    return {
      state: input.state,
      revision: 0,
      storageFailed: !!input.readError || !input.writable,
      loadCorrupt: input.corrupt,
      today: input.today,
      month: input.today.slice(0, 7),
      selected: input.today,
      batchMode: false,
      batchDays: new Set(),
      batchAnchor: null,
      yearMode: false,
      viewYear: Number(input.today.slice(0, 4)),
      returnMonth: input.today.slice(0, 7),
    };
  }
  return { create };
})();

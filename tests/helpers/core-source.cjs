"use strict";
const {
  domainFiles,
  readDomainSource,
} = require("../../scripts/lib/domain-source.cjs");
/** Convenience assembly for isolated assertions, never loaded by production. */
function readCoreSource() {
  return (
    readDomainSource() +
    "\nconst DomainTest = Object.assign({}, ...Object.values(WorkTimeApp.domain));"
  );
}
module.exports = { coreFiles: domainFiles, readCoreSource };

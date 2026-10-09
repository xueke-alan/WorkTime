"use strict";
/** Standalone and startup conversion use the same registry. */
const WorkBackupConversion = {
  convert(input) {
    return WorkTimeApp.services.archive.encode(
      WorkTimeApp.services.archive.migrate(input),
    );
  },
};

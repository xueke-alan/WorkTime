"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const context = vm.createContext({ WorkTimeApp: { games: {} } });
vm.runInContext(
  fs.readFileSync(
    path.join(__dirname, "../assets/js/games/gomoku-search.js"),
    "utf8",
  ),
  context,
);
module.exports = context.WorkTimeApp.games.gomokuSearch;

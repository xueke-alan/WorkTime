"use strict";
// Original tactical exercises, with stable IDs and symmetry/position variations.
WorkTimeApp.data.gomokuLegacy = (() => {
  const levels = [];
  const patterns = {
    1: [[-2, 0], [-1, 0], [1, 0], [2, 0]],
    2: [[-1, 0], [0, 0], [1, 0]],
    3: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  };
  for (let goal = 1; goal <= 3; goal++)
    for (let variant = 0; variant < 12; variant++) {
      const board = Array(225).fill(0);
      const cx = 6 + (variant % 3), cy = 5 + Math.floor(variant / 3);
      function transform([x, y]) {
        if (variant % 4 === 1) [x, y] = [-y, x];
        else if (variant % 4 === 2) [x, y] = [x + y, y - x];
        else if (variant % 4 === 3) [x, y] = [y - x, x + y];
        return (cy + y) * 15 + cx + x;
      }
      for (const pair of patterns[goal]) board[transform(pair)] = 1;
      // Dispersed white stones keep Black to move without an unrelated threat.
      const whites = [[-4, -3], [3, -4], [4, 3], [-3, 4]];
      for (const [x, y] of whites.slice(0, patterns[goal].length)) board[(cy + y) * 15 + cx + x] = 2;
      levels.push({ id: "gm-" + (levels.length + 1), goal, board, center: cy * 15 + cx });
    }
  return levels;
})();

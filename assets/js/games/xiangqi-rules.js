"use strict";

WorkTimeApp.games.xiangqiRules = (() => {
  const initialPosition =
    "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR";
  const columns = 9;
  const rows = 10;
  const size = columns * rows;
  const x = (square) => square % columns;
  const y = (square) => Math.floor(square / columns);
  const side = (piece) => piece !== "." && piece === piece.toUpperCase();
  const encode = (from, to) => from * size + to;
  const decode = (move) => [Math.floor(move / size), move % size];
  const crossed = (square, red) => (red ? y(square) < 5 : y(square) > 4);
  const palace = (square, red) =>
    x(square) >= 3 && x(square) <= 5 && (red ? y(square) >= 7 : y(square) <= 2);

  function parse(position) {
    const ranks = position.split("/");
    if (ranks.length !== rows) return null;
    const expanded = ranks.map((rank) =>
      rank.replace(/[1-9]/g, (count) => ".".repeat(Number(count))),
    );
    if (
      expanded.some(
        (rank) => rank.length !== columns || /[^KAEHRCPkaehrcp.]/.test(rank),
      )
    )
      return null;
    const board = expanded.join("");
    for (const red of [true, false]) {
      const king = red ? "K" : "k";
      const square = board.indexOf(king);
      if (
        square < 0 ||
        square !== board.lastIndexOf(king) ||
        !palace(square, red)
      )
        return null;
    }
    return board;
  }

  function between(board, from, to) {
    const step = (x(from) === x(to) ? columns : 1) * Math.sign(to - from);
    let pieces = 0;
    for (let square = from + step; square !== to; square += step)
      if (board[square] !== ".") pieces++;
    return pieces;
  }

  function reaches(board, from, to) {
    if (from === to) return false;
    const dx = x(to) - x(from);
    const dy = y(to) - y(from);
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const red = side(board[from]);
    switch (board[from].toLowerCase()) {
      case "k":
        return ax + ay === 1 && palace(to, red);
      case "a":
        return ax === 1 && ay === 1 && palace(to, red);
      case "e":
        return (
          ax === 2 &&
          ay === 2 &&
          !crossed(to, red) &&
          board[(from + to) / 2] === "."
        );
      case "h": {
        if (ax * ay !== 2) return false;
        const leg = ax === 2 ? Math.sign(dx) : Math.sign(dy) * columns;
        return board[from + leg] === ".";
      }
      case "r":
        return (ax === 0 || ay === 0) && between(board, from, to) === 0;
      case "c":
        return (
          (ax === 0 || ay === 0) &&
          between(board, from, to) === Number(board[to] !== ".")
        );
      case "p":
        return (
          (ax === 0 && dy === (red ? -1 : 1)) ||
          (ay === 0 && ax === 1 && crossed(from, red))
        );
      default:
        return false;
    }
  }

  function checked(board, red) {
    const king = board.indexOf(red ? "K" : "k");
    const opponent = board.indexOf(red ? "k" : "K");
    if (x(king) === x(opponent) && between(board, king, opponent) === 0)
      return true;
    for (let from = 0; from < size; from++)
      if (
        board[from] !== "." &&
        side(board[from]) !== red &&
        reaches(board, from, king)
      )
        return true;
    return false;
  }

  function apply(board, move) {
    const [from, to] = decode(move);
    if (from === to) return board.slice(0, from) + "." + board.slice(from + 1);
    if (from < to)
      return (
        board.slice(0, from) +
        "." +
        board.slice(from + 1, to) +
        board[from] +
        board.slice(to + 1)
      );
    return (
      board.slice(0, to) +
      board[from] +
      board.slice(to + 1, from) +
      "." +
      board.slice(from + 1)
    );
  }

  function destinations(board, red, from, checkingOnly = false) {
    const moves = [];
    if (board[from] === "." || side(board[from]) !== red) return moves;
    for (let to = 0; to < size; to++) {
      const target = board[to];
      if (
        target !== "." &&
        (side(target) === red || target.toLowerCase() === "k")
      )
        continue;
      if (reaches(board, from, to)) {
        const move = encode(from, to);
        const after = apply(board, move);
        if ((!checkingOnly || checked(after, !red)) && !checked(after, red))
          moves.push(move);
      }
    }
    return moves;
  }

  function legalMoves(board, red, checkingOnly = false) {
    const moves = [];
    for (let from = 0; from < size; from++)
      moves.push(...destinations(board, red, from, checkingOnly));
    return moves;
  }

  function result(board, red) {
    for (let from = 0; from < size; from++)
      if (destinations(board, red, from).length) return "playing";
    return checked(board, red) ? "mate" : "stalemate";
  }

  // Program play: the same board AND side to move appearing three times.
  // Only perpetual check is adjudicated here; chase/mixed-threat cases need
  // their own piece-identity and protection analysis, not a check counter.
  function repetition(initialBoard, path, occurrences = 3) {
    let board = initialBoard;
    const boards = [board];
    const checks = [];
    for (let index = 0; index < path.length; index++) {
      board = apply(board, path[index]);
      boards.push(board);
      checks.push(checked(board, index % 2 !== 0));
    }
    const matches = [];
    for (let index = path.length; index >= 0; index -= 2) {
      if (boards[index] === board) matches.push(index);
      if (matches.length === occurrences) break;
    }
    if (matches.length < occurrences) return null;
    const start = matches[occurrences - 1];
    const perpetual = [true, false].map((red) => {
      for (let index = start; index < path.length; index++)
        if ((index % 2 === 0) === red && !checks[index]) return false;
      return true;
    });
    return perpetual[0] !== perpetual[1]
      ? { outcome: "perpetualCheck", loser: perpetual[0] }
      : { outcome: "repetition", loser: null };
  }

  function avoidPerpetualCheck(initialBoard, path, move) {
    const red = path.length % 2 === 0;
    // Change course on the second occurrence, before a third can end the game.
    const repeatsCheck = (candidate) =>
      repetition(initialBoard, [...path, candidate], 2)?.loser === red;
    if (!repeatsCheck(move)) return move;
    let board = initialBoard;
    for (const played of path) board = apply(board, played);
    const alternatives = legalMoves(board, red).filter(
      (value) => !repeatsCheck(value),
    );
    // With no alternative the move is played and the referee awards the loss.
    return suggest(board, red, alternatives) ?? move;
  }

  // Each node stores [distance to forced mate, red moves]. A red move
  // maps to null for mate, or to a map of all legal black replies.
  function reply(replies) {
    return Object.keys(replies)
      .map(Number)
      .reduce(
        (best, move) =>
          best === null || replies[move][0] > replies[best][0] ? move : best,
        null,
      );
  }

  const material = { r: 500, h: 270, c: 270, e: 120, a: 120, p: 100 };

  function terminalScore(red) {
    return red ? -10000 : 10000;
  }

  function evaluate(board, red) {
    const outcome = result(board, red);
    if (outcome !== "playing") return terminalScore(red);
    let score = 0;
    for (const piece of board)
      score += (material[piece.toLowerCase()] ?? 0) * (side(piece) ? 1 : -1);
    return score;
  }

  function suggest(board, red, moves = legalMoves(board, red)) {
    let best = null;
    let bestScore = -Infinity;
    const direction = red ? 1 : -1;
    for (const move of moves) {
      const after = apply(board, move);
      const answers = legalMoves(after, !red);
      let score = Infinity;
      if (!answers.length) {
        score = direction * terminalScore(!red);
      }
      for (const answer of answers) {
        score = Math.min(
          score,
          direction * evaluate(apply(after, answer), red),
        );
        if (score < bestScore) break;
      }
      if (score > bestScore || (score === bestScore && move < best)) {
        best = move;
        bestScore = score;
      }
    }
    return best;
  }

  function legal(board, red, move) {
    return (
      Number.isInteger(move) &&
      move >= 0 &&
      move < size * size &&
      destinations(board, red, decode(move)[0]).includes(move)
    );
  }

  // An omitted defense selects the computer's move. Null represents an
  // unfinished off-tree round or a round that ends on Red's move.
  function playRound(position, move, defense) {
    if (position.status !== "playing" || !legal(position.board, true, move))
      return null;
    let board = apply(position.board, move);
    const replies = position.node?.[1][move];
    if (defense === undefined)
      defense =
        replies === undefined
          ? suggest(board, false)
          : replies && reply(replies);
    if (defense === null) {
      const outcome = result(board, false);
      if (outcome === "playing" && replies !== undefined) return null;
      return {
        board,
        node: null,
        status: outcome === "playing" ? "playing" : "won",
        outcome,
        defense,
      };
    }
    if (!legal(board, false, defense)) return null;
    board = apply(board, defense);
    return {
      board,
      node: replies?.[defense] ?? null,
      status: result(board, true) === "playing" ? "playing" : "lost",
      defense,
    };
  }

  function restore(level, path) {
    if (!Array.isArray(path)) return null;
    const initialBoard = parse(level.position);
    if (!initialBoard) return null;
    let position = {
      board: initialBoard,
      node: level.tree,
      status: "playing",
      defense: null,
    };
    for (let i = 0; i < path.length; i += 2) {
      const hasDefense = i + 1 < path.length;
      if (hasDefense && !Number.isInteger(path[i + 1])) return null;
      position = playRound(position, path[i], hasDefense ? path[i + 1] : null);
      if (!position) return null;
    }
    if (
      position.status === "playing" &&
      !position.node &&
      repetition(initialBoard, path)
    )
      return { ...position, status: "draw", outcome: "repetition" };
    return position;
  }

  function matchPosition(initialBoard, path, humanRed) {
    let board = initialBoard;
    for (const move of path) board = apply(board, move);
    const redTurn = path.length % 2 === 0;
    const outcome = result(board, redTurn);
    let repeated = outcome === "playing" && repetition(initialBoard, path);
    // Casual AI matches allow the human to keep checking.
    if (repeated && repeated.loser === humanRed) repeated = null;
    return {
      board,
      status: repeated
        ? repeated.loser === null
          ? "draw"
          : repeated.loser === humanRed
            ? "lost"
            : "won"
        : outcome === "playing"
          ? "playing"
          : redTurn === humanRed
            ? "lost"
            : "won",
      outcome: repeated ? repeated.outcome : outcome,
    };
  }

  function restoreMatch(match) {
    if (
      !match ||
      !["normal", "hard", "master"].includes(match.difficulty) ||
      typeof match.humanRed !== "boolean" ||
      !Array.isArray(match.handicaps) ||
      new Set(match.handicaps).size !== match.handicaps.length ||
      !match.handicaps.every((piece) => ["R", "H", "C"].includes(piece)) ||
      !Number.isInteger(match.undosRemaining) ||
      match.undosRemaining < 0 ||
      match.undosRemaining > 4 - match.handicaps.length ||
      typeof match.initialBoard !== "string" ||
      match.initialBoard.length !== size ||
      !Array.isArray(match.path) ||
      match.path.length > 10000
    )
      return null;
    const expected = parse(initialPosition).split("");
    const pairs = match.humanRed
      ? [
          [0, 8],
          [1, 7],
          [19, 25],
        ]
      : [
          [81, 89],
          [82, 88],
          [64, 70],
        ];
    for (const [index, piece] of ["R", "H", "C"].entries()) {
      if (!match.handicaps.includes(piece)) continue;
      const removed = pairs[index].filter(
        (square) => match.initialBoard[square] === ".",
      );
      if (removed.length !== 1) return null;
      expected[removed[0]] = ".";
    }
    if (expected.join("") !== match.initialBoard) return null;
    let position = matchPosition(match.initialBoard, [], match.humanRed);
    const path = [];
    for (const move of match.path) {
      if (
        position.status !== "playing" ||
        !Number.isInteger(move) ||
        !legalMoves(position.board, path.length % 2 === 0).includes(move)
      )
        return null;
      path.push(move);
      position = matchPosition(match.initialBoard, path, match.humanRed);
    }
    return position;
  }

  return {
    initialPosition,
    matchPosition,
    restoreMatch,
    columns,
    rows,
    side,
    parse,
    encode,
    decode,
    checked,
    apply,
    destinations,
    legalMoves,
    result,
    repetition,
    avoidPerpetualCheck,
    reply,
    suggest,
    playRound,
    restore,
  };
})();

"use strict";

// Development-only exact search. Cache results so interrupted searches can resume.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const source = require("./xiangqi-classics-source.json");
const cachePath = path.join(root, ".cache/xiangqi-search.json");
const results = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, "utf8"))
  : {};
const verify = process.argv.includes("--verify");
const inspect = process.argv.includes("--inspect");
const advancedOnly = process.argv.includes("--advanced");
const limit = Number(process.argv[2]) || (verify ? 10000000 : 200000);
const max = Number(process.argv[3]) || 16;
const dll = path.join(root, ".cache/xiangqi-solver/xiangqi-solver.dll");
let cursor = 0;
const position = (fen) =>
  fen
    .split(" ")[0]
    .replace(/[nbNB]/g, (p) => ({ n: "h", b: "e", N: "H", B: "E" })[p]);
const bank = require("./xiangqi-positions.json");
const tasks =
  verify || inspect ? [...bank, ...require("./xiangqi-retired.json")] : source;
const { rules, verifyTree } = require("./build-xiangqi.cjs");
function select() {
  const basic = [1, 2, 3].flatMap((goal) =>
    bank.filter((x) => x.goal === goal).slice(0, goal === 1 ? 20 : 30),
  );
  const category = ({ goal }) => (goal <= 5 ? 0 : goal <= 8 ? 1 : 2);
  const quotas = [45, 60, 15];
  const originals = bank.filter(
    ({ id, title }) => title && /^xq-\d+$/.test(id),
  );
  assert.equal(originals.length, 10, "Preserve the ten original classics");
  const classics = quotas.flatMap((quota, group) =>
    bank
      .filter((entry) => entry.title && category(entry) === group)
      .sort(
        (a, b) =>
          Number(/^xq-\d+$/.test(b.id)) - Number(/^xq-\d+$/.test(a.id)) ||
          a.sourceIndex - b.sourceIndex,
      )
      .slice(0, quota),
  );
  const saved = require("./xiangqi-classics-solutions.json");
  const certificates = Object.fromEntries(
    classics.map(({ id }) => [id, saved[id]]),
  );
  for (let i = 0; i < source.length && classics.length < 120; i++) {
    const result = results[i];
    if (!(result?.goal >= 4)) continue;
    const group = category(result);
    if (
      classics.filter((entry) => category(entry) === group).length >=
      quotas[group]
    )
      continue;
    const board = position(source[i].fen);
    if (classics.some((entry) => entry.position === board)) continue;
    const id = "xq-classic-" + String(i + 1).padStart(3, "0");
    classics.push({
      id,
      goal: result.goal,
      position: board,
      title: source[i].name
        .replace(/^第\d+局\s*/, "")
        .replace(/\s*-\s*适情雅趣$/, ""),
      sourceIndex: i,
    });
    certificates[id] = { goal: result.goal, tree: result.tree };
  }
  assert.equal(classics.length, 120, "Not enough verified classic positions");
  quotas.forEach((quota, group) =>
    assert.equal(
      classics.filter((entry) => category(entry) === group).length,
      quota,
    ),
  );
  classics.sort((a, b) => a.goal - b.goal || a.sourceIndex - b.sourceIndex);
  fs.writeFileSync(
    path.join(root, "scripts/xiangqi-positions.json"),
    JSON.stringify([...basic, ...classics], null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(root, "scripts/xiangqi-classics-solutions.json"),
    JSON.stringify(certificates, null, 2) + "\n",
  );
}
function next() {
  if (
    advancedOnly &&
    Object.values(results).filter(({ goal }) => goal >= 9).length >= 15
  )
    return null;
  while (cursor < tasks.length) {
    const index = cursor++;
    const old = results[index];
    if (
      verify ||
      inspect ||
      !old ||
      (old.status === "limit" && old.limit < limit) ||
      (old.goal == null && old.max < max)
    )
      return index;
  }
  return null;
}
async function worker() {
  const child = spawn("dotnet", [dll], { stdio: ["pipe", "pipe", "inherit"] });
  let current = next();
  const send = () => {
    if (current === null) child.stdin.end();
    else {
      const task = tasks[current];
      const board = task.position ?? position(task.fen);
      child.stdin.write(
        inspect
          ? `${board}|inspect\n`
          : `${board}|${verify ? task.goal : max}|${limit}\n`,
      );
    }
  };
  send();
  for await (const line of createInterface({ input: child.stdout })) {
    const result = JSON.parse(line);
    if (inspect) {
      const board = rules.parse(tasks[current].position);
      for (const [key, red] of [
        ["red", true],
        ["black", false],
      ]) {
        assert.deepEqual(
          result[key],
          rules.legalMoves(board, red).sort((a, b) => a - b),
        );
        assert.equal(result[key + "Checked"], rules.checked(board, red));
      }
    } else if (verify) {
      const level = tasks[current];
      assert.equal(result.status, "ok", level.id + " search exceeded budget");
      assert.equal(
        result.goal,
        level.goal,
        level.id + " is not a shortest mate",
      );
      verifyTree(rules.parse(level.position), result.tree);
    } else {
      results[current] = { ...result, limit, max };
      fs.writeFileSync(cachePath, JSON.stringify(results));
      const solved = Object.values(results).filter(({ goal }) => goal >= 4);
      console.log(
        `${current + 1}: ${source[current].name} ${result.status} ${result.goal ?? ""}; classics ${solved.length}, advanced ${solved.filter(({ goal }) => goal >= 9).length}`,
      );
    }
    if (verify || inspect)
      console.log(
        `${tasks[current].id}: ${inspect ? "rules match" : "shortest mate verified"}`,
      );
    current = next();
    send();
  }
  if (child.exitCode !== null) {
    assert.equal(child.exitCode, 0, "Offline solver failed");
    return;
  }
  await new Promise((resolve, reject) => {
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(Error("Solver exit " + code)),
    );
    child.on("error", reject);
  });
}
if (require.main === module && process.argv.includes("--select")) select();
else if (require.main === module)
  Promise.all(Array.from({ length: 3 }, worker)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { position };

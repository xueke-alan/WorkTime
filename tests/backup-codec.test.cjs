"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path");
const context = vm.createContext({
  TextEncoder,
  Uint8Array,
  Response,
  Blob,
  CompressionStream,
  DecompressionStream,
  btoa,
  atob,
});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../assets/js/backup.js"), "utf8") +
    ";globalThis.B=WorkBackup",
  context,
);
const B = context.B;
(async () => {
  const data = {
      note: "中文备份🙂",
      days: { "2026-10-08": { start: "08:00" } },
    },
    raw = JSON.stringify(data),
    validate = (value) => value;
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(await B.decode(raw, validate)), data);
  assert.deepEqual(plain(await B.decode(await B.encode(raw), validate)), data);
  await assert.rejects(() => B.decode("{broken", validate));
  await assert.rejects(() => B.decode(B.PREFIX + "!!!!", validate));
  await assert.rejects(() => B.decode(B.PREFIX + btoa("not gzip"), validate));
  await assert.rejects(
    () =>
      B.decode(raw, () => {
        throw Error("schema rejected");
      }),
    /schema rejected/,
  );
  const boundary = JSON.stringify({ text: "x".repeat(245) });
  assert.equal(Buffer.byteLength(boundary), 256);
  assert.equal(
    (await B.decode(boundary, validate, { maxBytes: 256 })).text.length,
    245,
  );
  await assert.rejects(
    () =>
      B.decode(JSON.stringify({ text: "x".repeat(246) }), validate, {
        maxBytes: 256,
      }),
    /大小限制/,
  );
  await assert.rejects(
    () =>
      B.decode(JSON.stringify({ text: "中".repeat(100) }), validate, {
        maxBytes: 256,
      }),
    /大小限制/,
  );
  const oversized = await B.encode(JSON.stringify({ text: "x".repeat(10000) }));
  await assert.rejects(
    () => B.decode(oversized, validate, { maxBytes: 256 }),
    /大小限制/,
  );
  console.log(
    "Backup codec passed: JSON/gzip, UTF-8, malformed transport, validation errors, exact boundary and decompressed size cap.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

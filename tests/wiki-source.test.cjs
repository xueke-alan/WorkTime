"use strict";
const assert = require("node:assert/strict"),
  {
    dates,
    stripReferences,
    fetchPages,
  } = require("../scripts/lib/wiki-source.cjs");
(async () => {
  assert.equal(dates.length, 366);
  assert.equal(new Set(dates).size, 366);
  assert(dates.includes("2月29日"));
  assert.equal(dates[365], "12月31日");
  assert.equal(
    stripReferences(
      '正文[[世界环境日]]<ref name="a">reference</ref><ref name="b"/><!-- comment -->',
    ),
    "正文[[世界环境日]]",
  );
  const delays = [],
    urls = [],
    expected = { query: { pages: { 1: { title: "2月29日" } } } };
  let attempts = 0;
  const actual = await fetchPages(["2月29日", "3月1日"], {
    async request(url, { signal }) {
      urls.push(url);
      assert(signal instanceof AbortSignal);
      attempts++;
      if (attempts === 1) return { ok: false, status: 503 };
      if (attempts === 2) throw Error("network");
      if (attempts === 3)
        return { ok: true, json: async () => ({ error: { code: "maxlag" } }) };
      return { ok: true, json: async () => expected };
    },
    pause: async (delay) => delays.push(delay),
  });
  assert.equal(actual, expected);
  assert.deepEqual(delays, [3000, 6000, 9000]);
  assert(urls.every((url) => url === urls[0]));
  assert.equal(new URL(urls[0]).searchParams.get("titles"), "2月29日|3月1日");
  let failures = 0;
  await assert.rejects(
    fetchPages(["1月1日"], {
      request: async () => {
        failures++;
        return { ok: true, json: async () => ({ query: {} }) };
      },
      pause: async () => {},
    }),
    /Missing Wikipedia pages/,
  );
  assert.equal(failures, 4, "invalid source fails after bounded retries");
  console.log(
    "Wikipedia source passed: 366 dates, reference cleanup, bounded HTTP/network/schema retries and encoded batch titles.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

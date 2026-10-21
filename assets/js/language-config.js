"use strict";
/** Shared identities for storage, offline assets and presentation. */
WorkTimeApp.data.languages = Object.freeze(
  [
    ["zh-CN", "简体中文", "zh-CN", true, "zh-CN"],
    ["zh-TW", "繁體中文-台", "zh-TW", true, "zh-TW"],
    ["zh-HK", "繁體中文-港", "zh-HK", true, "zh-HK"],
    ["en", "English", "en-GB", false, "en"],
    ["ko", "한국어", "ko-KR", false, "en"],
    ["ja", "日本語", "ja-JP", false, "en"],
  ].map(([id, name, locale, almanac, history]) =>
    Object.freeze({
      id,
      name,
      locale,
      almanac,
      history,
      cjk: /^(zh|ja|ko)/.test(id),
    }),
  ),
);

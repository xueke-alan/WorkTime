"use strict";
/** Offline language owner. Domain identities and user-authored text stay unchanged. */
WorkTimeApp.i18n = (() => {
  const catalogs = WorkTimeApp.data.locales;
  const languages = WorkTimeApp.data.languages;
  const cacheKey = "worktime.languagePaintCache";
  const listeners = new Set();
  // Calendar/year renders share a small set of formats across hundreds of values.
  const formatters = new Map();
  function formatter(kind, options = {}) {
    const entries = Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    const key = JSON.stringify([kind, owner.locale, entries]);
    if (!formatters.has(key)) {
      formatters.set(
        key,
        new Intl[kind](owner.locale, Object.fromEntries(entries)),
      );
      if (formatters.size > 96)
        formatters.delete(formatters.keys().next().value);
    }
    return formatters.get(key);
  }
  // Resolve legacy automatic settings once, then keep an explicit preference.
  function matchLanguage(value) {
    const tag = String(value || "").toLowerCase();
    if (/^zh(?:-|$)/.test(tag)) {
      if (/-(hk|mo)(?:-|$)/.test(tag)) return "zh-HK";
      if (/-(tw|hant)(?:-|$)/.test(tag)) return "zh-TW";
      return "zh-CN";
    }
    return languages.find(
      (item) =>
        tag === item.id.toLowerCase() ||
        tag.startsWith(item.id.toLowerCase() + "-"),
    )?.id;
  }
  const detected =
    (navigator.languages || [navigator.language])
      .map(matchLanguage)
      .find(Boolean) || "en";
  let preference = detected;
  const normalize = (value) =>
    languages.some((item) => item.id === value) ? value : preference;
  try {
    preference = normalize(localStorage.getItem(cacheKey));
  } catch {}
  let language = preference;
  let changing = false;
  const sourceKeys = new Map(
    Object.entries(catalogs["zh-CN"]).map(([key, value]) => [value, key]),
  );
  const englishSources = new Map(
    Object.values(catalogs).flatMap((catalog) =>
      Object.entries(catalog).map(([key, value]) => [
        value,
        catalogs["zh-CN"][key],
      ]),
    ),
  );
  const canonical = (value) =>
    englishSources.get(String(value ?? "")) ?? String(value ?? "");
  const content = () =>
    language === "en"
      ? WorkTimeApp.data.contentEnglish
      : WorkTimeApp.data.contentLocales?.[language] || {};
  const fragments = [
    ...sourceKeys.keys(),
    ...Object.keys(WorkTimeApp.data.contentEnglish),
  ]
    .filter((text) => text.trim() && /[\u3400-\u9fff]/.test(text))
    .sort((a, b) => b.length - a.length);
  const contentFragments = Object.fromEntries(
    languages.map(({ id }) => [
      id,
      Object.keys(WorkTimeApp.data.contentLocales?.[id] || {})
        .filter((text) => text.length > 1)
        .sort((a, b) => b.length - a.length),
    ]),
  );
  function t(key, values = {}) {
    const text = catalogs[language]?.[key] ?? catalogs["zh-CN"][key] ?? key;
    return text.replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : match,
    );
  }
  function message(value) {
    const text = String(value ?? "");
    if (language === "zh-CN" || !/[\u3400-\u9fff]/.test(text)) return text;
    if (Object.hasOwn(content(), text)) return content()[text];
    const exact = sourceKeys.get(text);
    if (exact) return t(exact);
    // Legacy diagnostics are stored as source prose. Translate once at the UI
    // boundary, never by observing or rewriting arbitrary DOM/user content.
    let result = text;
    if (owner.config.almanac) {
      for (const source of contentFragments[language] || [])
        result = result.split(source).join(content()[source]);
    }
    for (const source of fragments) {
      if (source.length < 2) continue;
      result = result
        .split(source)
        .join(
          content()[source] ??
            (sourceKeys.has(source) ? t(sourceKeys.get(source)) : source),
        );
    }
    if (owner.config.almanac)
      return [...result].map((char) => content()[char] || char).join("");
    if (owner.config.cjk) return result;
    return result
      .replaceAll("、", ", ")
      .replaceAll("；", "; ")
      .replaceAll("：", ": ")
      .replaceAll("，", ", ")
      .replaceAll("。", ".");
  }
  function date(value, options = {}) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
      ? new Date(value + "T12:00:00+08:00")
      : new Date(value);
    return formatter("DateTimeFormat", {
      timeZone: "Asia/Shanghai",
      day: "numeric",
      month: owner.config.cjk ? "numeric" : "short",
      year: "numeric",
      ...options,
    })
      .format(parsed)
      .replace(/\bSept\b/g, "Sep");
  }
  function month(value) {
    return date(value + "-01", { day: undefined });
  }
  function monthName(value) {
    return date(value, { year: undefined, day: undefined });
  }
  function weekday(value) {
    return date(value, {
      year: undefined,
      month: undefined,
      day: undefined,
      weekday: "short",
    });
  }
  function city(value) {
    const name = message(value.replace(/市$/, ""));
    return owner.config.almanac ? name + "市" : name;
  }
  function apply(root = document) {
    const nodes = root.querySelectorAll(
      "[data-i18n-text],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder]",
    );
    for (const element of nodes) {
      if (element.dataset.i18nText) {
        const texts = [...element.childNodes].filter(
          (node) => node.nodeType === 3,
        );
        for (const [index, key] of Object.entries(
          JSON.parse(element.dataset.i18nText),
        ))
          if (texts[index]) texts[index].data = t(key);
      }
      for (const name of ["title", "aria-label", "placeholder"]) {
        const key = element.getAttribute("data-i18n-" + name);
        if (key) element.setAttribute(name, t(key));
      }
    }
    document.documentElement.lang = language;
  }
  function setLanguage(value) {
    const next = normalize(value),
      previous = language;
    preference = next;
    language = next;
    try {
      localStorage.setItem(cacheKey, next);
    } catch {}
    document.documentElement.lang = language;
    if (previous !== language) {
      // Translation changes presentation, not the values or navigation state.
      // Keep all synchronous view refreshes in one non-animated update.
      changing = true;
      try {
        apply();
        for (const listener of listeners) listener(language);
        document.dispatchEvent(new Event("worktime:languagechange"));
      } finally {
        changing = false;
      }
    }
  }
  const owner = {
    languages,
    matchLanguage,
    t,
    canonical,
    message,
    date,
    month,
    monthName,
    weekday,
    city,
    apply,
    normalize,
    setLanguage,
    get changing() {
      return changing;
    },
    get language() {
      return language;
    },
    get preference() {
      return preference;
    },
    get locale() {
      return owner.config.locale;
    },
    get config() {
      return languages.find((item) => item.id === language);
    },
    number(value, options) {
      return formatter("NumberFormat", options).format(value);
    },
    get decimalSeparator() {
      return formatter("NumberFormat")
        .formatToParts(1.1)
        .find((part) => part.type === "decimal").value;
    },
    duration(minutes) {
      return minutes === null || minutes === undefined
        ? "—"
        : owner.number(minutes / 60, {
            useGrouping: false,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }) + " h";
    },
    plural(value, one, other) {
      return t(formatter("PluralRules").select(value) === "one" ? one : other, {
        count: owner.number(value),
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  document.documentElement.lang = language;
  document.addEventListener("DOMContentLoaded", () => apply(), { once: true });
  return Object.freeze(owner);
})();

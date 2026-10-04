(function (g) {
  "use strict";
  const providers = new Map();
  function register(p) {
    if (!p || !p.id || !p.label || typeof p.getContent !== "function")
      throw Error("Invalid date info provider");
    providers.set(p.id, p);
  }
  function validDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error("日期格式无效");
    const [y, m, d] = date.split("-").map(Number),
      v = new Date(Date.UTC(y, m - 1, d));
    if (
      v.getUTCFullYear() !== y ||
      v.getUTCMonth() !== m - 1 ||
      v.getUTCDate() !== d
    )
      throw Error("日期无效");
    return [y, m, d];
  }
  function lunar(date) {
    const [y, m, d] = validDate(date);
    if (y < 1900 || y > 2100) throw Error("农历、节气及黄历支持 1900–2100 年");
    if (!g.Solar) throw Error("本地农历资料未能加载");
    return g.Solar.fromYmd(y, m, d).getLunar();
  }
  function merged(items) {
    return [...new Map(items.map((x) => [x.id, x])).values()];
  }
  function getContent(id, date) {
    try {
      validDate(date);
      const p = providers.get(id);
      if (!p) throw Error("模块未注册");
      return { ok: true, ...p.getContent(date) };
    } catch (e) {
      return {
        ok: false,
        title: providers.get(id)?.label || "日期资讯",
        message: e.message,
      };
    }
  }
  register({
    id: "history",
    label: "历史上的今天",
    icon: "history",
    getContent(date) {
      const [year] = validDate(date),
        rows = WorkTimeApp.data.dateInfo.history[date.slice(5)];
      if (!rows) throw Error("该日期的本地历史资料未能加载");
      return {
        title: "历史上的今天",
        events: merged(rows)
          .filter((e) => e.year <= year)
          .sort((a, b) => a.year - b.year),
        empty: "选中日期之前没有已收录的事件",
        source: "中文维基百科 · CC BY-SA 4.0",
      };
    },
  });
  register({
    id: "festivals",
    label: "节气及节日",
    icon: "sun",
    getContent(date) {
      const l = lunar(date),
        s = l.getSolar(),
        [y, m, d] = validDate(date),
        data = WorkTimeApp.data.dateInfo,
        aliases = data.festivalAliases || {},
        internationalNames = new Set(data.internationalFestivals || []),
        entries = new Map();
      const add = (name, category, url) => {
        name = aliases[name] || name;
        entries.set(name, {
          name,
          category:
            category ||
            (internationalNames.has(name) ? "international" : "domestic"),
          url,
        });
      };
      for (const name of [...s.getFestivals(), ...l.getFestivals()]) add(name);
      for (const r of merged(data.festivals || [])) {
        let hit = false;
        if (r.kind === "solar") hit = m === r.month && d === r.day;
        if (r.kind === "lunar")
          hit = l.getMonth() === r.month && l.getDay() === r.day;
        if (r.kind === "weekday") {
          const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
          hit = m === r.month && w === r.weekday && Math.ceil(d / 7) === r.week;
        }
        if (hit) add(r.name, r.category, r.url);
      }
      const tomorrow = s.next(1).getLunar();
      if (
        l.getMonth() === 12 &&
        tomorrow.getMonth() === 1 &&
        tomorrow.getDay() === 1
      )
        add("除夕", "domestic");
      for (const entry of data.internationalByDate?.[date.slice(5)] || [])
        add(entry.name, "international", entry.url);
      const domestic = [...entries.values()].filter(
          (e) => e.category !== "international",
        ),
        international = [...entries.values()]
          .filter((e) => e.category === "international")
          .map((e) => ({
            text: e.name,
            url:
              e.url ||
              "https://zh.wikipedia.org/wiki/" + encodeURIComponent(e.name),
          }));
      const prev = l.getPrevJieQi(true),
        next = l.getNextJieQi(true),
        termRows = l.getJieQi()
          ? [["当日", l.getJieQi()]]
          : [
              ["上一", prev.getName() + " · " + prev.getSolar().toYmd()],
              ["下一", next.getName() + " · " + next.getSolar().toYmd()],
            ];
      return {
        title: "节气及节日",
        sections: [
          ...(domestic.length
            ? [
                {
                  label: "国内节日",
                  text: domestic.map((e) => e.name).join("、"),
                  kind: "domestic",
                },
              ]
            : []),
          { label: "节气", rows: termRows, kind: "terms" },
          ...(international.length
            ? [
                {
                  label: "国际节日",
                  links: international,
                  kind: "international",
                },
              ]
            : []),
          ...(!domestic.length && !international.length
            ? [{ label: "节日", text: "当日暂无已收录节日", kind: "empty" }]
            : []),
        ],
        rows: [
          ["国内节日", domestic.map((e) => e.name).join("、")],
          ...termRows,
          ["国际节日", international.map((e) => e.text).join("、")],
        ],
      };
    },
  });
  register({
    id: "almanac",
    label: "农历黄历",
    icon: "calendar",
    getContent(date) {
      const l = lunar(date);
      return {
        title: "农历黄历",
        almanac: {
          month: (l.getMonth() < 0 ? "闰" : "") + l.getMonthInChinese() + "月",
          day: l.getDayInChinese(),
          details: [
            ["值神", l.getDayTianShen()],
            ["建除", l.getZhiXing() + "日"],
            ["喜神", l.getDayPositionXiDesc()],
            ["财神", l.getDayPositionCaiDesc()],
          ],
        },
        rows: [
          ["农历", l.toString()],
          [
            "干支",
            l.getYearInGanZhi() +
              "年 " +
              l.getMonthInGanZhi() +
              "月 " +
              l.getDayInGanZhi() +
              "日",
          ],
          ["生肖", l.getYearShengXiao()],
          ["宜", l.getDayYi().join("、") || "无"],
          ["忌", l.getDayJi().join("、") || "无"],
          ["冲煞", l.getDayChongDesc() + " · 煞" + l.getDaySha()],
        ],
        source:
          "lunar-javascript " +
          (WorkTimeApp.data.dateInfo.sources?.lunar.version || "") +
          " · 传统民俗参考",
        sourceUrl: "https://github.com/6tail/lunar-javascript",
      };
    },
  });
  WorkTimeApp.services.dateInfo = {
    register,
    getContent,
    list: () => [...providers.values()],
    lunar,
  };
})(typeof window === "undefined" ? globalThis : window);

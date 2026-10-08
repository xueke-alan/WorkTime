"use strict";
/** Theme identities shared by backup validation, preference storage and presentation. */
WorkTimeApp.domain.preferences = (() => {
  const themes = Object.freeze(
    [
      { id: "green", name: "清新绿", color: "#157e68" },
      { id: "blue", name: "天空蓝", color: "#2563a6" },
      { id: "purple", name: "柔和紫", color: "#7652a3" },
      { id: "orange", name: "暖橙色", color: "#a85616" },
      { id: "rose", name: "玫瑰红", color: "#a64165" },
      { id: "slate", name: "雾蓝灰", color: "#526979" },
      { id: "cyan", name: "孔雀青", color: "#087481" },
      { id: "mint", name: "薄荷绿", color: "#397a59" },
      { id: "olive", name: "橄榄绿", color: "#6b742b" },
      { id: "gold", name: "琥珀金", color: "#846312" },
      { id: "red", name: "朱砂红", color: "#ad3e3e" },
      { id: "brown", name: "可可棕", color: "#805b43" },
    ].map(Object.freeze),
  );
  const isTheme = (id) => themes.some((theme) => theme.id === id);
  return Object.freeze({
    themes,
    isTheme,
    normalize: (id) => (isTheme(id) ? id : "green"),
  });
})();

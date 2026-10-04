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
    ].map(Object.freeze),
  );
  const isTheme = (id) => themes.some((theme) => theme.id === id);
  return Object.freeze({
    themes,
    isTheme,
    normalize: (id) => (isTheme(id) ? id : "green"),
  });
})();

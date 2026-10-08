"use strict";
WorkTimeApp.ui.createCalendarWeather = function ({
  calendar,
  weather,
  weatherUI,
  now,
  businessDate,
}) {
  let disposed = false;
  const compat = WorkTimeApp.ui.animationCompat;
  const reducedMotion = compat.preference();
  const animations = new Map();
  const decodes = new Map();
  const revisions = new WeakMap();
  function cancel(picture) {
    animations.get(picture)?.cancel();
    animations.delete(picture);
    decodes.get(picture)?.cancel();
    decodes.delete(picture);
    revisions.delete(picture);
    picture.style.opacity = "";
  }
  function animate(picture, frames, options, outgoing = false) {
    const handle = compat.animate(picture, frames, options);
    animations.set(picture, handle);
    handle.finished.then(() => {
      if (animations.get(picture) !== handle) return;
      animations.delete(picture);
      if (outgoing) picture.remove();
    });
    return handle.finished;
  }
  function retire(picture) {
    if (!picture) return;
    const opacity = getComputedStyle(picture).opacity;
    cancel(picture);
    if (reducedMotion.matches || document.hidden) return picture.remove();
    picture.style.opacity = "";
    picture.classList.replace(
      "calendar-weather-icon",
      "calendar-weather-outgoing",
    );
    return animate(
      picture,
      [{ opacity }, { opacity: 0 }],
      {
        duration: 220,
        easing: "ease-out",
        fill: "forwards",
      },
      true,
    );
  }
  function reveal(picture, key, departure) {
    if (
      reducedMotion.matches ||
      document.hidden ||
      typeof picture.animate !== "function"
    )
      return;
    const revision = {};
    revisions.set(picture, revision);
    const decoding = compat.decode(picture.querySelector("img"));
    decodes.set(picture, decoding);
    picture.style.opacity = "0";
    Promise.all([decoding.finished, departure]).then(() => {
      if (
        !picture.isConnected ||
        disposed ||
        revisions.get(picture) !== revision ||
        picture.dataset.weatherKey !== key ||
        !picture.classList.contains("calendar-weather-icon")
      )
        return;
      decodes.delete(picture);
      picture.style.opacity = "";
      if (reducedMotion.matches || document.hidden) return;
      animate(picture, [{ opacity: 0 }, { opacity: 0.5 }], {
        duration: 300,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      });
    });
  }
  function iconFor(code) {
    return weatherUI.iconFor(code);
  }
  function refresh() {
    if (disposed) return;
    for (const picture of new Set([...animations.keys(), ...decodes.keys()]))
      if (!picture.isConnected) cancel(picture);
    const value = weather.snapshot();
    const today = businessDate(now());
    const end = Date.parse(today + "T00:00:00+08:00") + 5 * 86400000;
    const days = new Map(
      (value.record?.daily || [])
        .filter(
          (row) =>
            row.date >= today && Date.parse(row.date + "T00:00:00+08:00") < end,
        )
        .map((row) => [row.date, row]),
    );
    for (const cell of calendar.querySelectorAll(
      ".day[data-date], .day[data-preview-date]",
    )) {
      const row = days.get(cell.dataset.date || cell.dataset.previewDate);
      const icon = row && iconFor(row.weatherCode);
      let picture = cell.querySelector(".calendar-weather-icon");
      if (!icon) {
        retire(picture);
        cell.classList.remove("has-weather");
        continue;
      }
      const description =
        value.city.name + " · " + weather.weatherText(row.weatherCode);
      const key = value.city.name + ":" + icon;
      let departure = Promise.all(
        [...cell.querySelectorAll(".calendar-weather-outgoing")].flatMap(
          (old) => animations.get(old)?.finished || [],
        ),
      );
      if (picture && picture.dataset.weatherKey !== key) {
        cell.querySelectorAll(".calendar-weather-outgoing").forEach((old) => {
          cancel(old);
          old.remove();
        });
        departure = retire(picture);
        picture = null;
      }
      const changed = !picture;
      if (!picture) {
        picture = document.createElement("picture");
        picture.classList.add("calendar-weather-icon");
        picture.setAttribute("aria-hidden", "true");
        const still = document.createElement("source");
        still.media = "(prefers-reduced-motion: reduce)";
        const image = document.createElement("img");
        image.alt = "";
        image.draggable = false;
        picture.append(still, image);
        cell.append(picture);
      }
      picture.title = description;
      picture.dataset.weatherKey = key;
      const root = "assets/icons/meteocons/";
      const src = root + "svg/" + icon + ".svg";
      if (picture.lastElementChild.getAttribute("src")?.split("?")[0] !== src) {
        picture.firstElementChild.srcset = root + "svg-static/" + icon + ".svg";
        picture.lastElementChild.src = src;
      }
      cell.classList.add("has-weather");
      if (changed) reveal(picture, key, departure);
    }
  }
  const unsubscribe = weather.subscribe(refresh);
  function settle() {
    for (const picture of new Set([
      ...animations.keys(),
      ...decodes.keys(),
      ...calendar.querySelectorAll(
        ".calendar-weather-icon, .calendar-weather-outgoing",
      ),
    ])) {
      cancel(picture);
      if (picture.classList.contains("calendar-weather-outgoing"))
        picture.remove();
    }
  }
  const unlisten = compat.listen(reducedMotion, () => {
    if (reducedMotion.matches) settle();
  });
  function visibilityChanged() {
    if (disposed) return;
    if (document.hidden) return settle();
    refresh();
    weatherUI.resumeImages(calendar);
  }
  document.addEventListener("visibilitychange", visibilityChanged);
  weather.setDemand("calendar", true);
  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    unlisten();
    document.removeEventListener("visibilitychange", visibilityChanged);
    weather.setDemand("calendar", false);
    settle();
  }
  return { refresh, iconFor, dispose };
};

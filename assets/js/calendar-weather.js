"use strict";
WorkTimeApp.ui.createCalendarWeather = function ({
  calendar,
  weather,
  weatherUI,
  now,
  businessDate,
}) {
  const g = window;
  let disposed = false;
  const reducedMotion = g.matchMedia("(prefers-reduced-motion: reduce)");
  function retire(picture) {
    if (!picture) return;
    const opacity = getComputedStyle(picture).opacity;
    picture.getAnimations().forEach((animation) => animation.cancel());
    if (reducedMotion.matches) return picture.remove();
    picture.style.opacity = "";
    picture.classList.replace(
      "calendar-weather-icon",
      "calendar-weather-outgoing",
    );
    return picture
      .animate([{ opacity }, { opacity: 0 }], {
        duration: 220,
        easing: "ease-out",
        fill: "forwards",
      })
      .finished.then(() => picture.remove())
      .catch(() => picture.remove());
  }
  function reveal(picture, key, departure) {
    if (reducedMotion.matches) return;
    picture.style.opacity = "0";
    Promise.all([
      picture
        .querySelector("img")
        .decode()
        .catch(() => {}),
      departure,
    ]).then(() => {
      if (
        !picture.isConnected ||
        disposed ||
        picture.dataset.weatherKey !== key ||
        !picture.classList.contains("calendar-weather-icon")
      )
        return;
      picture.style.opacity = "";
      if (reducedMotion.matches) return;
      picture.animate([{ opacity: 0 }, { opacity: 0.5 }], {
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
          (old) =>
            old
              .getAnimations()
              .map((animation) => animation.finished.catch(() => {})),
        ),
      );
      if (picture && picture.dataset.weatherKey !== key) {
        cell
          .querySelectorAll(".calendar-weather-outgoing")
          .forEach((old) => old.remove());
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
  function visibilityChanged() {
    if (document.hidden || disposed) return;
    refresh();
    weatherUI.resumeImages(calendar);
  }
  document.addEventListener("visibilitychange", visibilityChanged);
  weather.setDemand("calendar", true);
  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    document.removeEventListener("visibilitychange", visibilityChanged);
    weather.setDemand("calendar", false);
    for (const picture of calendar.querySelectorAll(
      ".calendar-weather-icon, .calendar-weather-outgoing",
    ))
      picture.getAnimations().forEach((animation) => animation.cancel());
  }
  return { refresh, iconFor, dispose };
};

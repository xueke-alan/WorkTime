"use strict";
/** Own keyed calendar DOM reconciliation, preserving focus, weather layers and text profiles. */
WorkTimeApp.ui.createCalendarRenderer = function ({
  element: $,
  document,
  weatherLayer,
}) {
  let calendarMarkup = "";
  const calendarNodes = new Map(),
    markup = new WeakMap();
  function attributeValue(element, attribute) {
    if (attribute.name !== "class") return attribute.value;
    // Font profiles belong to alignment, not the calendar's business markup.
    const profiles = [...element.classList].filter((token) =>
      ["ui-font-13", "ui-font-14-plus"].includes(token),
    );
    return [attribute.value, ...profiles].join(" ");
  }

  function updateHTML(element, html) {
    if (markup.get(element) === html) return;
    element.innerHTML = html;
    markup.set(element, html);
  }

  function updateText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  function updateYearMonth(element, candidate) {
    const buttons = new Map(
      [...element.querySelectorAll("[data-year-date]")].map((button) => [
        button.dataset.yearDate,
        button,
      ]),
    );
    const nextButtons = [...candidate.querySelectorAll("[data-year-date]")];
    if (
      buttons.size !== nextButtons.length ||
      nextButtons.some((button) => !buttons.has(button.dataset.yearDate))
    )
      return false;
    // The same year/month has fixed day order and blank offsets. Keep every day
    // button and its aligned text layer, including keyboard focus and animation.
    updateHTML(
      element.querySelector(".year-month-stats"),
      candidate.querySelector(".year-month-stats").innerHTML,
    );
    updateText(
      element.querySelector(".year-month-number"),
      candidate.querySelector(".year-month-number").textContent,
    );
    for (const next of nextButtons) {
      const button = buttons.get(next.dataset.yearDate);
      for (const attribute of [...button.attributes])
        if (!next.hasAttribute(attribute.name))
          button.removeAttribute(attribute.name);
      for (const attribute of next.attributes) {
        const value = attributeValue(button, attribute);
        if (button.getAttribute(attribute.name) !== value)
          button.setAttribute(attribute.name, value);
      }
      updateText(button.querySelector("span"), next.textContent);
    }
    return true;
  }

  function updateCalendar(html) {
    if (html === calendarMarkup) return;
    const focused = document.activeElement,
      focusDate = focused?.closest(".day[data-date]")?.dataset.date,
      focusSource = focused?.matches(".source-toggle");
    const container = $("calendar"),
      template = document.createElement("template"),
      next = new Map();
    template.innerHTML = html;
    for (const card of template.content.querySelectorAll(
      "div.day[data-date]",
    )) {
      const select = document.createElement("button");
      select.type = "button";
      select.className = "day-select";
      for (const name of ["aria-label", "aria-pressed", "aria-disabled"]) {
        if (card.hasAttribute(name))
          select.setAttribute(name, card.getAttribute(name));
        if (name !== "aria-disabled") card.removeAttribute(name);
      }
      card.prepend(select);
    }
    const candidates = [...template.content.children],
      nodeKey = (candidate, index) =>
        candidate.tagName +
        ":" +
        (candidate.dataset.date ||
          candidate.dataset.previewDate ||
          candidate.dataset.yearMonth ||
          candidate.getAttribute("aria-label") ||
          index);
    if (
      !candidates.some((candidate, index) => {
        const previous = calendarNodes.get(nodeKey(candidate, index));
        return previous?.element.parentElement === container;
      })
    ) {
      // A different month/year structure must switch in one operation; intermediate
      // layouts otherwise change the browser's scroll anchor on narrow screens.
      container.replaceChildren(...candidates);
      calendarNodes.clear();
    }
    candidates.forEach((candidate, index) => {
      const key = nodeKey(candidate, index),
        previous = calendarNodes.get(key),
        source = candidate.outerHTML,
        candidateContent = candidate.innerHTML;
      let element = candidate,
        sourceMotion;
      if (previous && previous.element.parentElement === container) {
        element = previous.element;
        if (previous.source !== source) {
          // Preserve the day surface and weather layers across record updates.
          for (const attribute of previous.attributes)
            if (!candidate.hasAttribute(attribute))
              element.removeAttribute(attribute);
          for (const attribute of candidate.attributes) {
            const value = attributeValue(element, attribute);
            if (element.getAttribute(attribute.name) !== value)
              element.setAttribute(attribute.name, value);
          }
          if (
            previous.content !== candidateContent &&
            !(
              element.matches(".year-month") &&
              updateYearMonth(element, candidate)
            )
          ) {
            // Keep the painted positions so redraws and rapid clicks stay smooth.
            const sourceToggle = element.querySelector(".source-toggle"),
              nextSourceToggle = candidate.querySelector(".source-toggle");
            if (sourceToggle && nextSourceToggle) {
              if (
                sourceToggle.getAttribute("aria-pressed") !==
                  nextSourceToggle.getAttribute("aria-pressed") &&
                !WorkTimeApp.ui.animationCompat.preference().matches
              )
                sourceMotion = [...sourceToggle.children].map((dot) => ({
                  dot,
                  transform: getComputedStyle(dot).transform,
                }));
              for (const attribute of [...sourceToggle.attributes])
                if (!nextSourceToggle.hasAttribute(attribute.name))
                  sourceToggle.removeAttribute(attribute.name);
              for (const attribute of nextSourceToggle.attributes)
                sourceToggle.setAttribute(attribute.name, attribute.value);
              nextSourceToggle.replaceWith(sourceToggle);
            }
            const markers = element.querySelector(".date-markers"),
              nextMarkers = candidate.querySelector(".date-markers");
            if (
              markers &&
              nextMarkers &&
              markers.outerHTML === nextMarkers.outerHTML
            )
              nextMarkers.replaceWith(markers);
            // Weather owns these persistent layers. Keep them attached so editing
            // attendance neither reloads the SVG nor replays the weather fade.
            for (const child of [...element.childNodes])
              if (
                !(child instanceof Element) ||
                !child.matches(
                  ".calendar-weather-icon, .calendar-weather-outgoing",
                )
              )
                child.remove();
            const content = document.createDocumentFragment();
            content.append(...candidate.childNodes);
            element.insertBefore(content, element.firstChild);
          }
          if (element.querySelector(".calendar-weather-icon"))
            element.classList.add("has-weather");
        }
      }
      next.set(key, {
        element,
        source,
        content: candidateContent,
        attributes: [...candidate.attributes].map(
          (attribute) => attribute.name,
        ),
      });
      if (container.children[index] !== element)
        container.insertBefore(element, container.children[index] || null);
      for (const { dot, transform } of sourceMotion || []) {
        for (const animation of dot.getAnimations?.() || []) animation.cancel();
        WorkTimeApp.ui.animationCompat.animate(
          dot,
          [{ transform }, { transform: getComputedStyle(dot).transform }],
          { duration: 260, easing: "cubic-bezier(0.2, 0.65, 0.3, 1)" },
        );
      }
    });
    for (const [key, previous] of calendarNodes)
      if (!next.has(key)) previous.element.remove();
    if (focusDate && document.activeElement !== focused)
      container
        .querySelector(
          '[data-date="' +
            focusDate +
            '"] ' +
            (focusSource ? ".source-toggle" : ".day-select"),
        )
        ?.focus({ preventScroll: true });
    calendarNodes.clear();
    for (const [key, value] of next) calendarNodes.set(key, value);
    calendarMarkup = html;
    weatherLayer.refresh();
  }
  return { updateHTML, updateText, updateCalendar };
};

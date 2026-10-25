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
    const headerAlignment = [],
      contentMotions = [],
      sourceMotions = [];
    candidates.forEach((candidate, index) => {
      const key = nodeKey(candidate, index),
        previous = calendarNodes.get(key),
        source = candidate.outerHTML,
        candidateContent = candidate.innerHTML,
        headerMarkup = candidate.querySelector(".daytop")?.outerHTML,
        bodies = [...candidate.children].filter((element) =>
          element.matches(".daytime, .dayhours, .day-footer"),
        ),
        bodyMarkup = bodies.map((element) => element.outerHTML);
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
            const header = element.querySelector(".daytop"),
              nextHeader = candidate.querySelector(".daytop"),
              preserveHeader =
                header && nextHeader && previous.headerMarkup === headerMarkup;
            const markers = element.querySelector(".date-markers"),
              nextMarkers = candidate.querySelector(".date-markers");
            if (
              markers &&
              nextMarkers &&
              !preserveHeader &&
              markers.outerHTML === nextMarkers.outerHTML
            )
              nextMarkers.replaceWith(markers);
            // Selection only changes the day surface. Keep its already aligned
            // header, otherwise the replacement's taller raw line boxes move
            // agenda contents until the next alignment frame.
            if (preserveHeader) nextHeader.replaceWith(header);
            else if (nextHeader) headerAlignment.push(nextHeader);
            // Weather and agenda own persistent layers. Selecting a different
            // date must not destroy their nodes or restart their animations.
            for (const child of [...element.childNodes])
              if (
                !(child instanceof Element) ||
                !child.matches(
                  ".calendar-weather-icon, .calendar-weather-outgoing, .agenda-card-items",
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
      if (element === candidate) {
        const header = element.querySelector(".daytop");
        if (header) headerAlignment.push(header);
      }
      next.set(key, {
        element,
        source,
        content: candidateContent,
        headerMarkup,
        bodyMarkup,
        attributes: [...candidate.attributes].map(
          (attribute) => attribute.name,
        ),
      });
      if (container.children[index] !== element)
        container.insertBefore(element, container.children[index] || null);
      // Animate changed attendance fields inside the shared card, leaving its date,
      // weather and selection surface still. Agenda owns its own content transitions.
      if (previous?.bodyMarkup && !container.closest(".agenda-mode")) {
        const currentBodies = [...element.children].filter((child) =>
          child.matches(".daytime, .dayhours, .day-footer"),
        );
        currentBodies.forEach((child, bodyIndex) => {
          if (previous.bodyMarkup[bodyIndex] !== bodyMarkup[bodyIndex])
            contentMotions.push(child);
        });
      }
      for (const { dot, transform } of sourceMotion || []) {
        sourceMotions.push({ dot, transform });
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
    // Agenda measures header geometry in this render, before observers run.
    // Finish new/changed headers now so layout and animation share one height.
    // Attendance can use the normal batched alignment frame. Only the agenda
    // measures these headers synchronously to place its overlay lanes.
    if (headerAlignment.length && container.closest(".agenda-mode"))
      WorkTimeApp.ui.alignment?.refresh(headerAlignment);
    weatherLayer.refresh();
    const plans = sourceMotions.map(({ dot, transform }) => ({
      element: dot,
      frames: [{ transform }, { transform: getComputedStyle(dot).transform }],
      options: {
        duration: WorkTimeApp.ui.motion.calendar.navigationDuration,
        easing: WorkTimeApp.ui.motion.calendar.easing,
      },
    }));
    for (const { dot } of sourceMotions)
      for (const animation of dot.getAnimations?.() || []) animation.cancel();
    WorkTimeApp.ui.motion.animateCalendar(plans);
    for (const child of contentMotions)
      WorkTimeApp.ui.motion.play(child, "motion-card-content");
  }
  return { updateHTML, updateText, updateCalendar };
};

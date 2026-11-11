"use strict";
/** Agenda rendering helpers with explicit dependencies; no persistence or view state. */
WorkTimeApp.ui.createAgendaCardRenderer = function ({
  document,
  transferChips,
  chipSignatures,
}) {
  function updateMarkup(node, html) {
    if (node.innerHTML === html) return;
    const focused = document.activeElement;
    const identity = node.contains(focused)
      ? [...focused.attributes].find((attribute) =>
          attribute.name.startsWith("data-agenda-"),
        )
      : null;
    const scrollTop = node.scrollTop;
    if (node.id === "agendaList") {
      const template = document.createElement("template");
      template.innerHTML = html;
      const previous = new Map(
        [...node.querySelectorAll(":scope > .agenda-item")].map((entry) => [
          entry.querySelector("[data-agenda-status]").dataset.agendaStatus,
          entry,
        ]),
      );
      const children = [...template.content.children].map((candidate) => {
        const id = candidate.querySelector("[data-agenda-status]")?.dataset
          .agendaStatus;
        const old = previous.get(id);
        if (
          !old ||
          old.querySelector(".agenda-item-copy").innerHTML !==
            candidate.querySelector(".agenda-item-copy").innerHTML
        )
          return candidate;
        old.className = candidate.className;
        const oldButtons = [...old.querySelectorAll("button")];
        [...candidate.querySelectorAll("button")].forEach((button, index) => {
          const current = oldButtons[index];
          for (const attribute of [...current.attributes])
            if (!button.hasAttribute(attribute.name))
              current.removeAttribute(attribute.name);
          for (const attribute of button.attributes)
            if (current.getAttribute(attribute.name) !== attribute.value)
              current.setAttribute(attribute.name, attribute.value);
        });
        return old;
      });
      children.forEach((child, index) => {
        if (node.children[index] !== child)
          node.insertBefore(child, node.children[index] || null);
      });
      for (const child of [...node.children])
        if (!children.includes(child)) child.remove();
    } else if (node.classList.contains("agenda-card-items")) {
      const template = document.createElement("template");
      template.innerHTML = html;
      const key = (button) =>
        button.dataset.agendaEdit || button.dataset.agendaDate;
      const previous = new Map(
        [...node.children].map((button) => [key(button), button]),
      );
      [...template.content.children].forEach((candidate, index) => {
        const old =
          previous.get(key(candidate)) || transferChips.get(key(candidate));
        const signature = candidate.outerHTML;
        const button =
          old &&
          (chipSignatures.get(old) === signature ||
            updateCompletion(old, candidate))
            ? old
            : candidate;
        chipSignatures.set(button, signature);
        if (button === old) button.title = candidate.title;
        if (button === transferChips.get(key(candidate))) {
          for (const property of ["left", "top", "width"])
            button.style.removeProperty(property);
        }
        delete button.dataset.agendaSegmentStart;
        delete button.dataset.agendaSegmentEnd;
        if (old && old !== button) old.remove();
        previous.delete(key(candidate));
        if (node.children[index] !== button)
          node.insertBefore(button, node.children[index] || null);
      });
      for (const button of previous.values()) button.remove();
    } else node.innerHTML = html;
    node.scrollTop = scrollTop;
    if (identity)
      [...node.querySelectorAll("button")]
        .find((button) => button.getAttribute(identity.name) === identity.value)
        ?.focus({ preventScroll: true });
  }
  function updateCompletion(previous, candidate) {
    // Status/selection are paint changes. Reuse chips independently of the
    // save's lifetime, including form saves and deferred ResizeObserver renders.
    if (previous.dataset.agendaEdit !== candidate.dataset.agendaEdit)
      return false;
    for (const name of ["continues-before", "continues-after"])
      if (
        previous.classList.contains(name) !== candidate.classList.contains(name)
      )
        return false;
    for (const key of ["agendaSegmentStart", "agendaSegmentEnd"])
      if (
        candidate.dataset[key] &&
        previous.dataset[key] !== candidate.dataset[key]
      )
        return false;
    for (const selector of [
      ".agenda-chip-title-text",
      ".agenda-chip-time",
      ".agenda-chip-note",
    ])
      if (
        previous.querySelector(selector)?.textContent !==
        candidate.querySelector(selector)?.textContent
      )
        return false;
    if (
      !!previous.querySelector(".agenda-resize-handle") !==
      !!candidate.querySelector(".agenda-resize-handle")
    )
      return false;
    const status = previous.querySelector(".agenda-chip-status");
    const nextStatus = candidate.querySelector(".agenda-chip-status");
    if (!status || !nextStatus) return false;
    previous.classList.toggle(
      "is-selected",
      candidate.classList.contains("is-selected"),
    );
    previous.setAttribute(
      "aria-current",
      candidate.getAttribute("aria-current"),
    );
    previous.dataset.status = candidate.dataset.status;
    previous.title = candidate.title;
    status.dataset.status = nextStatus.dataset.status;
    previous.classList.toggle(
      "is-complete",
      candidate.classList.contains("is-complete"),
    );
    if (status.innerHTML !== nextStatus.innerHTML)
      status.innerHTML = nextStatus.innerHTML;
    status.setAttribute("aria-label", nextStatus.getAttribute("aria-label"));
    return true;
  }
  return { updateMarkup, updateCompletion };
};

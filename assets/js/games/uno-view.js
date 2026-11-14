"use strict";

// Each game owns its cache. Stable keyed nodes retain CSS/WAAPI animation clocks.
WorkTimeApp.games.unoViewFactory = function () {
  const artCache = new Map(),
    artIdentity = new WeakMap(),
    viewReferences = new WeakMap();
  function setArt(el, html) {
    let cached = artCache.get(html);
    if (!cached) {
      cached = document.createElement("template");
      cached.innerHTML = html;
      if (artCache.size >= 256) artCache.delete(artCache.keys().next().value);
      artCache.set(html, cached);
    }
    const copy = cached.content.cloneNode(true);
    for (const child of copy.children) artIdentity.set(child, cached);
    el.append(copy);
  }
  function viewKey(el) {
    if (viewReferences.has(el)) return viewKey(viewReferences.get(el));
    if (el.nodeType !== 1) return "#" + el.nodeType;
    const stable =
      el.dataset.card !== undefined
        ? "card:" + el.dataset.card
        : el.dataset.seat !== undefined
          ? "seat:" + el.dataset.seat
          : el.dataset.backIndex !== undefined
            ? "back:" + el.dataset.backIndex
            : el.dataset.unoAction
              ? "action:" + el.dataset.unoAction
              : el.getAttribute("class")?.split(" ")[0] || "";
    return el.nodeName + ":" + stable;
  }
  function referenceView(parent, actual) {
    const placeholder = document.createComment("retained view");
    viewReferences.set(placeholder, actual);
    parent.append(placeholder);
  }
  // moveBefore preserves compositor layers, focus and running animations.
  // Older browsers still avoid touching children already in the right order.
  function moveView(parent, child, before = null) {
    if (child === before) return;
    if (parent.moveBefore && parent.isConnected && child.isConnected)
      parent.moveBefore(child, before);
    else parent.insertBefore(child, before);
  }
  function patchView(parent, fresh) {
    const pools = new Map();
    for (const old of parent.childNodes) {
      const key = viewKey(old);
      if (!pools.has(key)) pools.set(key, []);
      pools.get(key).push(old);
    }
    let cursor = parent.firstChild;
    for (const next of [...fresh.childNodes]) {
      const matches = pools.get(viewKey(next)),
        current = matches?.shift();
      const retained = viewReferences.get(next);
      if (retained) {
        if (current && current !== retained) current.remove();
        if (retained !== cursor) moveView(parent, retained, cursor);
        cursor = retained.nextSibling;
        continue;
      }
      if (!current) {
        parent.insertBefore(next, cursor);
        continue;
      }
      if (current !== cursor) moveView(parent, current, cursor);
      if (current.nodeType !== 1) {
        if (current.nodeValue !== next.nodeValue)
          current.nodeValue = next.nodeValue;
      } else {
        const sameArt =
          artIdentity.has(next) &&
          artIdentity.get(current) === artIdentity.get(next);
        const dynamic = current.matches(
            ".uno-direction,.uno-player-pointer,.uno-hand-actions",
          ),
          head = current.matches(".uno-direction-head-a,.uno-direction-head-b");
        for (const attr of [...current.attributes]) {
          if (
            (dynamic && attr.name === "style") ||
            (head && attr.name === "transform")
          )
            continue;
          if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
        }
        for (const attr of next.attributes) {
          if (dynamic && attr.name === "style") continue;
          if (current.getAttribute(attr.name) !== attr.value)
            current.setAttribute(attr.name, attr.value);
        }
        for (const name of [
          "onclick",
          "onchange",
          "onmouseenter",
          "onmouseleave",
          "onfocus",
          "onblur",
          "onkeydown",
          "onfocusin",
          "onfocusout",
        ]) {
          if (current.matches(".uno-card") || !current[name])
            current[name] = next[name];
        }
        if (!sameArt) {
          patchView(current, next);
          if (artIdentity.has(next))
            artIdentity.set(current, artIdentity.get(next));
          else artIdentity.delete(current);
        }
        if (
          current instanceof HTMLSelectElement &&
          current.value !== next.value
        )
          current.value = next.value;
      }
      cursor = current.nextSibling;
    }
    for (const leftovers of pools.values())
      for (const old of leftovers) old.remove();
  }

  return { setArt, referenceView, patchView, moveView };
};

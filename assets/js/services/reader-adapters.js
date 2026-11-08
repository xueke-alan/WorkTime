"use strict";
/** Format adapters expose semantic locations rather than transient screen pages. */
WorkTimeApp.services.readerAdapters = (() => {
  const lib = WorkTimeApp.services.readerLibrary;
  const clamp = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
  const fonts = {
    serif: 'Georgia, "Noto Serif CJK SC", "Songti SC", SimSun, serif',
    sans: 'system-ui, "Microsoft YaHei", sans-serif',
    mono: "Consolas, monospace",
  };
  function forwardKey(host, event) {
    if (
      event.shiftKey ||
      event.altKey ||
      event.target.matches?.("input,textarea,select")
    )
      return;
    const forwarded = new KeyboardEvent("keydown", {
      key: event.key,
      bubbles: true,
      cancelable: true,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
    if (!host.dispatchEvent(forwarded)) event.preventDefault();
  }
  const colors = (s) =>
    s.theme === "dark"
      ? ["#20252b", "#e0e3e7"]
      : s.theme === "sepia"
        ? ["#f3ead7", "#403a30"]
        : s.theme === "custom"
          ? [s.background || "#ffffff", s.foreground || "#292c32"]
          : ["#ffffff", "#292c32"];
  function rules(s) {
    const [bg, fg] = colors(s);
    return {
      body: {
        "font-family": (fonts[s.font] || fonts.serif) + " !important",
        "font-size": (clamp(s.fontSize || 20, 48) || 20) + "px !important",
        "line-height": String(s.lineHeight || 1.8) + " !important",
        padding: (s.margin ?? 36) + "px !important",
        color: fg + " !important",
        background: bg + " !important",
      },
      p: { "margin-bottom": (s.paragraph ?? 12) + "px !important" },
      img: { "max-width": "100%", "object-fit": "contain" },
    };
  }
  function rangeAt(root, from, to) {
    const walker = root.ownerDocument.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
    );
    const range = root.ownerDocument.createRange();
    let offset = 0,
      start = false,
      last;
    while (walker.nextNode()) {
      const text = walker.currentNode,
        end = offset + text.length;
      if (!start && from <= end) {
        range.setStart(text, Math.max(0, from - offset));
        start = true;
      }
      if (start && to <= end) {
        range.setEnd(text, Math.max(0, to - offset));
        return range;
      }
      offset = end;
      last = text;
    }
    if (start && last) {
      range.setEnd(last, last.length);
      return range;
    }
    return null;
  }
  function selectionOffsets(root, range) {
    const before = range.cloneRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    return {
      start: before.toString().length,
      end: before.toString().length + range.toString().length,
    };
  }
  async function txt({
    file,
    host,
    settings,
    location,
    changed,
    selected,
    encoding,
  }) {
    const decoded = lib.decode(await file.arrayBuffer(), encoding || "auto"),
      text = decoded.text;
    const toc = lib.chapters(text),
      chunks = [];
    for (let i = 0; i < toc.length; i++) {
      const start = toc[i].location.offset,
        end = toc[i + 1]?.location.offset ?? text.length;
      for (let p = start; p < end; p += 16000)
        chunks.push({ start: p, end: Math.min(end, p + 16000) });
    }
    if (!chunks.length) chunks.push({ start: 0, end: 0 });
    const iframe = document.createElement("iframe");
    iframe.title = file.name;
    iframe.sandbox = "allow-same-origin";
    host.replaceChildren(iframe);
    const ready = new Promise((resolve) => (iframe.onload = resolve));
    iframe.srcdoc =
      '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style></style></head><body><main></main></body></html>';
    await ready;
    const doc = iframe.contentDocument,
      body = doc.querySelector("main"),
      style = doc.querySelector("style");
    let s = settings,
      pos = clamp(location?.offset, text.length),
      at = -1,
      annotations = [],
      disposed = false,
      paging = false;
    function paint() {
      const chunk = chunks[at],
        source = text.slice(chunk.start, chunk.end),
        points = new Set([0, source.length]);
      const marks = annotations.filter(
        (a) => a.location.offset < chunk.end && a.location.end > chunk.start,
      );
      for (const a of marks) {
        points.add(clamp(a.location.offset - chunk.start, source.length));
        points.add(clamp(a.location.end - chunk.start, source.length));
      }
      const ordered = [...points].sort((a, b) => a - b);
      body.replaceChildren();
      for (let i = 0; i < ordered.length - 1; i++) {
        const from = ordered[i],
          to = ordered[i + 1],
          a = marks.find(
            (m) =>
              m.location.offset <= from + chunk.start &&
              m.location.end >= to + chunk.start,
          );
        // Paragraph wrappers retain their newline text, so stored offsets never
        // depend on layout or inserted highlight elements.
        for (const line of source.slice(from, to).match(/[^\n]*\n|[^\n]+$/g) ||
          []) {
          let paragraph = body.lastElementChild;
          if (!paragraph || paragraph.textContent.endsWith("\n")) {
            paragraph = doc.createElement("p");
            body.append(paragraph);
          }
          const part = doc.createElement(a ? "mark" : "span");
          part.textContent = line;
          if (a) {
            part.style.backgroundColor = a.color;
            part.style.color = "#222";
            part.title = a.note || "";
          }
          paragraph.append(part);
        }
      }
    }
    function layout() {
      const [bg, fg] = colors(s),
        gap = clamp(s.margin ?? 36, 100),
        width = Math.max(
          160,
          Math.min(s.width || 900, iframe.clientWidth - gap * 2),
        ),
        height = Math.max(120, iframe.clientHeight - gap * 2);
      const columns = s.spread === "double" && width > 620 ? 2 : 1;
      style.textContent = `*{box-sizing:border-box}html{background:${bg};color:${fg};height:100%;overflow:${s.flow === "scroll" ? "auto" : "hidden"}}body{margin:0;padding:${gap}px;font:${s.fontSize || 20}px/${s.lineHeight || 1.8} ${fonts[s.font] || fonts.serif}}main{white-space:pre-wrap;overflow-wrap:anywhere;width:${width}px;max-width:100%;margin:auto;tab-size:4;${s.flow === "scroll" ? "" : `height:${height}px;overflow:hidden;column-width:${(width - gap * (columns - 1)) / columns}px;column-gap:${gap}px;column-fill:auto;`}}p{margin:0 0 ${s.paragraph ?? 12}px;white-space:pre-wrap}span,mark{white-space:pre-wrap}main{line-height:${s.lineHeight || 1.8};word-spacing:normal}`;
    }
    function locate() {
      const range = rangeAt(
        body,
        pos - chunks[at].start,
        pos - chunks[at].start,
      );
      if (!range) return;
      const rect = range.getBoundingClientRect();
      if (s.flow === "scroll")
        doc.documentElement.scrollTop += rect.top - (s.margin || 36);
      else {
        const step = body.clientWidth + (s.margin || 36),
          page = Math.floor(
            (rect.left + body.scrollLeft - body.getBoundingClientRect().left) /
              step,
          );
        body.scrollLeft = Math.max(0, page * step);
      }
    }
    function report() {
      changed({
        location: { offset: pos },
        progress: text.length ? pos / text.length : 0,
      });
    }
    async function go(target) {
      pos = clamp(
        typeof target === "number" ? target * text.length : target?.offset,
        Math.max(0, text.length - 1),
      );
      const index = Math.max(
        0,
        chunks.findIndex((c) => pos >= c.start && pos < c.end),
      );
      if (index !== at) {
        at = index;
        paint();
      }
      layout();
      await new Promise(requestAnimationFrame);
      if (disposed) return;
      paging = true;
      locate();
      setTimeout(() => (paging = false), 50);
      report();
    }
    function readPosition(force = false) {
      if ((paging && !force) || disposed) return;
      const margin = (s.margin || 36) + 2;
      const caret = doc.caretRangeFromPoint?.(
        Math.max(margin, body.getBoundingClientRect().left + 2),
        margin,
      );
      if (caret && body.contains(caret.startContainer)) {
        const before = caret.cloneRange();
        before.selectNodeContents(body);
        before.setEnd(caret.startContainer, caret.startOffset);
        pos = chunks[at].start + before.toString().length;
        report();
      }
    }
    doc.addEventListener(
      "scroll",
      () => {
        if (s.flow === "scroll") readPosition();
      },
      true,
    );
    for (const event of ["pointerdown", "wheel", "touchstart"])
      doc.addEventListener(
        event,
        () =>
          host.dispatchEvent(new Event("readeractivity", { bubbles: true })),
        { passive: true },
      );
    doc.addEventListener("pointerup", () => {
      const selection = doc.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (!body.contains(range.commonAncestorContainer)) return;
      const offsets = selectionOffsets(body, range);
      selected({
        text: selection.toString(),
        location: {
          offset: chunks[at].start + offsets.start,
          end: chunks[at].start + offsets.end,
        },
      });
    });
    doc.addEventListener("keydown", (event) => forwardKey(host, event));
    doc.addEventListener(
      "wheel",
      (event) => {
        if (s.flow !== "scroll") {
          event.preventDefault();
          void next(event.deltaY > 0 ? 1 : -1);
        } else if (
          event.deltaY > 0 &&
          doc.documentElement.scrollTop + iframe.clientHeight >=
            doc.documentElement.scrollHeight - 2 &&
          at < chunks.length - 1
        )
          void go({ offset: chunks[at + 1].start });
        else if (
          event.deltaY < 0 &&
          doc.documentElement.scrollTop <= 0 &&
          at > 0
        )
          void go({ offset: chunks[at - 1].end - 1 });
      },
      { passive: false },
    );
    let touchX, touchY;
    doc.addEventListener(
      "touchstart",
      (e) => {
        touchX = e.changedTouches[0].clientX;
        touchY = e.changedTouches[0].clientY;
      },
      { passive: true },
    );
    doc.addEventListener(
      "touchend",
      (e) => {
        if (
          s.flow !== "scroll" &&
          Math.abs(e.changedTouches[0].clientX - touchX) > 60
        )
          void next(e.changedTouches[0].clientX < touchX ? 1 : -1);
        if (s.flow === "scroll") {
          const root = doc.documentElement,
            dy = e.changedTouches[0].clientY - touchY;
          if (
            dy < -30 &&
            root.scrollTop + iframe.clientHeight >= root.scrollHeight - 2 &&
            chunks[at + 1]
          )
            void go({ offset: chunks[at + 1].start });
          if (dy > 30 && root.scrollTop <= 0 && chunks[at - 1])
            void go({ offset: chunks[at - 1].end - 1 });
        }
      },
      { passive: true },
    );
    async function next(direction) {
      // Explicit navigation wins over the short scroll guard used by reflow.
      // Otherwise a quick first click after remount can move pixels without
      // updating the semantic location, and a subsequent resize restores it.
      const previous = pos;
      paging = true;
      locate();
      const horizontal = s.flow !== "scroll",
        root = horizontal ? body : doc.documentElement,
        step = horizontal
          ? body.clientWidth + (s.margin || 36)
          : iframe.clientHeight * 0.85;
      const offset = horizontal ? root.scrollLeft : root.scrollTop,
        max = horizontal
          ? root.scrollWidth - body.clientWidth
          : root.scrollHeight - iframe.clientHeight;
      if (
        (direction > 0 && offset >= max - 3) ||
        (direction < 0 && offset <= 1)
      ) {
        if (chunks[at + direction])
          await go({
            offset:
              direction > 0 ? chunks[at + 1].start : chunks[at - 1].end - 1,
          });
      } else {
        if (horizontal) root.scrollLeft += step * direction;
        else root.scrollTop += step * direction;
        readPosition(true);
        pos = direction > 0 ? Math.max(previous, pos) : Math.min(previous, pos);
        report();
      }
      setTimeout(() => (paging = false), 50);
    }
    await go({ offset: pos });
    return {
      capabilities: { reflow: true, text: true, encoding: true },
      toc,
      encoding: decoded.encoding,
      go,
      next,
      position: () => ({ offset: pos }),
      async search(query, cancelled) {
        const results = [],
          lower = text.toLocaleLowerCase(),
          needle = query.toLocaleLowerCase();
        for (
          let p = lower.indexOf(needle);
          p >= 0 && results.length < 1000;
          p = lower.indexOf(needle, p + needle.length)
        ) {
          if (cancelled()) break;
          results.push({
            label: text.slice(Math.max(0, p - 25), p + query.length + 50),
            location: { offset: p },
          });
          if (results.length % 100 === 0) await lib.pause();
        }
        return results;
      },
      async settings(value) {
        s = value;
        await go({ offset: pos });
      },
      async annotations(value) {
        annotations = value;
        paint();
        locate();
      },
      destroy() {
        disposed = true;
        iframe.remove();
      },
    };
  }
  async function epub({ file, host, settings, location, changed, selected }) {
    const bytes = await lib.sanitized(file),
      book = window.WorkTimeReaderEPUB.ePub(bytes, { replacements: "blobUrl" });
    let rendition,
      disposed = false,
      current = location || {},
      s = settings;
    try {
      await book.ready;
      const fixed = book.packaging.metadata.layout === "pre-paginated";
      const toc = [];
      const flatten = (items, depth = 0) => {
        for (const item of items) {
          toc.push({
            label: "　".repeat(depth) + item.label.trim(),
            location: {
              href: item.href,
              spineIndex: book.spine.get(item.href)?.index || 0,
            },
          });
          flatten(item.subitems || [], depth + 1);
        }
      };
      flatten(book.navigation.toc);
      rendition = book.renderTo(host, {
        width: "100%",
        height: "100%",
        flow: fixed || s.flow !== "scroll" ? "paginated" : "scrolled-doc",
        spread: s.spread === "double" ? "auto" : "none",
        minSpreadWidth: 620,
        allowScriptedContent: false,
        allowPopups: false,
        ignoreClass: "reader-annotation",
      });
      rendition.on("relocated", (position) => {
        if (disposed) return;
        current = { cfi: position.start.cfi, spineIndex: position.start.index };
        const percent = book.locations.length()
          ? book.locations.percentageFromCfi(position.start.cfi)
          : (position.start.index +
              (position.start.displayed.page - 1) /
                position.start.displayed.total) /
            Math.max(1, book.spine.length);
        changed({
          location: current,
          progress: percent,
          page: position.start.displayed.page,
        });
      });
      rendition.on("selected", async (cfi) => {
        const range = await book.getRange(cfi);
        if (!disposed) selected({ text: range.toString(), location: { cfi } });
      });
      rendition.on("keydown", (event) => forwardKey(host, event));
      rendition.hooks.content.register((contents) => {
        contents.document.addEventListener("pointerdown", () =>
          host.dispatchEvent(new Event("readeractivity", { bubbles: true })),
        );
        contents.document.addEventListener(
          "wheel",
          () =>
            host.dispatchEvent(new Event("readeractivity", { bubbles: true })),
          { passive: true },
        );
        let start;
        contents.document.addEventListener(
          "touchstart",
          (e) => (start = e.changedTouches[0].clientX),
          { passive: true },
        );
        contents.document.addEventListener(
          "touchend",
          (e) => {
            const delta = e.changedTouches[0].clientX - start;
            if (s.flow !== "scroll" && Math.abs(delta) > 60)
              void (delta < 0 ? rendition.next() : rendition.prev());
          },
          { passive: true },
        );
      });
      if (!fixed) {
        rendition.themes.default(rules(s));
      }
      await rendition.display(location?.cfi || location?.href || undefined);
      if (!fixed)
        rendition.resize(
          Math.min(host.clientWidth, s.width || 900),
          host.clientHeight,
        );
      // Generate stable percentage navigation without delaying first paint.
      book.locations.generate(1600).catch(() => {});
      let previous = [];
      return {
        capabilities: { reflow: !fixed, text: true },
        toc,
        position: () => current,
        async go(target) {
          await rendition.display(
            typeof target === "number"
              ? book.locations.length()
                ? book.locations.cfiFromPercentage(Math.min(0.9999, target))
                : book.spine.get(
                    Math.min(
                      book.spine.length - 1,
                      Math.floor(target * book.spine.length),
                    ),
                  ).href
              : target.cfi || target.href,
          );
        },
        next: (direction) =>
          direction > 0 ? rendition.next() : rendition.prev(),
        async settings(value) {
          s = value;
          if (fixed) {
            rendition.spread(s.spread === "double" ? "auto" : "none");
            rendition.resize(host.clientWidth, host.clientHeight);
            await rendition.display(current.cfi);
            return;
          }
          rendition.themes.default(rules(s));
          rendition.flow(s.flow === "scroll" ? "scrolled-doc" : "paginated");
          rendition.spread(s.spread === "double" ? "auto" : "none");
          rendition.resize(
            Math.min(host.clientWidth, s.width || 900),
            host.clientHeight,
          );
          await rendition.display(current.cfi);
        },
        async search(query, cancelled) {
          const results = [];
          for (const section of book.spine.spineItems) {
            if (cancelled() || disposed || results.length >= 1000) break;
            await section.load(book.load.bind(book));
            for (const match of section.find(query)) {
              results.push({
                label: match.excerpt,
                location: { cfi: match.cfi },
              });
              if (results.length >= 1000) break;
            }
            section.unload();
            await lib.pause();
          }
          return results;
        },
        async annotations(value) {
          for (const cfi of previous)
            rendition.annotations.remove(cfi, "highlight");
          previous = [];
          for (const a of value)
            if (a.location.cfi) {
              try {
                rendition.annotations.highlight(
                  a.location.cfi,
                  {},
                  null,
                  "reader-annotation",
                  {
                    fill: a.color,
                    "fill-opacity": "0.4",
                    "mix-blend-mode": "multiply",
                  },
                );
                previous.push(a.location.cfi);
              } catch {
                /* Keep unmatched annotations in the list. */
              }
            }
        },
        destroy() {
          disposed = true;
          rendition.destroy();
          book.destroy();
        },
      };
    } catch (error) {
      rendition?.destroy();
      book.destroy();
      throw error;
    }
  }
  class BinaryDataFactory {
    async fetch({ kind, filename }) {
      const folder = {
        cMapUrl: "cmaps",
        standardFontDataUrl: "standard_fonts",
        wasmUrl: "wasm",
      }[kind];
      if (!folder || !/^[\w.\-]+$/.test(filename))
        throw Error("Invalid PDF resource");
      const key = folder + "/" + filename;
      await WorkTimeApp.services.assets.script(
        "assets/vendor/reader/" + key + ".js",
      );
      const value = window.WorkTimeReaderBinary[key];
      return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    }
  }
  async function pdf({
    file,
    host,
    settings,
    location,
    changed,
    selected,
    password,
    signal,
  }) {
    await lib.engine("pdf");
    const pdfjs = window.WorkTimeReaderPDF;
    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      BinaryDataFactory,
      useWorkerFetch: false,
      isEvalSupported: false,
      enableXfa: false,
      useWasm: true,
      cMapUrl: "cmaps/",
      standardFontDataUrl: "standard_fonts/",
      wasmUrl: "wasm/",
    });
    const abort = () => {
      void task.destroy();
    };
    signal?.addEventListener("abort", abort, { once: true });
    task.onPassword = async (update, reason) => {
      const value = await password(reason);
      if (value === null) {
        void task.destroy();
        return;
      }
      update(value);
    };
    let doc;
    try {
      doc = await task.promise;
    } catch (error) {
      await task.destroy();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    const scroller = document.createElement("div");
    scroller.className = "reader-pdf-scroll";
    host.replaceChildren(scroller);
    let s = settings,
      pageNumber = clamp(location?.page || 1, doc.numPages) || 1,
      fraction = clamp(location?.fraction, 1),
      disposed = false,
      generation = 0,
      annotations = [],
      renderTasks = new Set();
    const pages = new Map(),
      toc = [];
    async function destination(dest) {
      const resolved =
        typeof dest === "string" ? await doc.getDestination(dest) : dest;
      return resolved
        ? (typeof resolved[0] === "object"
            ? await doc.getPageIndex(resolved[0])
            : resolved[0]) + 1
        : 1;
    }
    async function flatten(items, depth = 0) {
      for (const item of items || []) {
        toc.push({
          label: "　".repeat(depth) + item.title,
          location: { page: await destination(item.dest) },
        });
        await flatten(item.items, depth + 1);
      }
    }
    await flatten(await doc.getOutline());
    function overlays(node, page, viewport) {
      node.querySelectorAll(".reader-pdf-mark").forEach((n) => n.remove());
      for (const a of annotations.filter(
        (value) => value.location.page === page,
      ))
        for (const rectangle of a.location.rects || []) {
          const r = [
              ...viewport.convertToViewportPoint(rectangle[0], rectangle[1]),
              ...viewport.convertToViewportPoint(rectangle[2], rectangle[3]),
            ],
            mark = document.createElement("span");
          mark.className = "reader-pdf-mark";
          Object.assign(mark.style, {
            left: Math.min(r[0], r[2]) + "px",
            top: Math.min(r[1], r[3]) + "px",
            width: Math.abs(r[2] - r[0]) + "px",
            height: Math.abs(r[3] - r[1]) + "px",
            background: a.color,
          });
          mark.title = a.note || "";
          node.append(mark);
        }
    }
    async function render(number, node, token) {
      if (node.dataset.ready || disposed || token !== generation) return;
      node.dataset.ready = "loading";
      try {
        const page = await doc.getPage(number);
        if (disposed || token !== generation) return;
        const base = page.getViewport({
          scale: 1,
          rotation: (page.rotate + (s.rotation || 0)) % 360,
        });
        const available = Math.max(180, scroller.clientWidth - 32),
          height = Math.max(150, scroller.clientHeight - 32);
        const scale =
          s.zoom === "page"
            ? Math.min(available / base.width, height / base.height)
            : s.zoom === "width" || !s.zoom
              ? available / base.width
              : clamp(s.zoom, 4) || 1;
        const viewport = page.getViewport({
          scale,
          rotation: (page.rotate + (s.rotation || 0)) % 360,
        });
        node.style.width = viewport.width + "px";
        node.style.height = viewport.height + "px";
        const canvas = document.createElement("canvas"),
          ratio = Math.min(2, devicePixelRatio || 1);
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio);
        canvas.style.width = viewport.width + "px";
        canvas.style.height = viewport.height + "px";
        node.replaceChildren(canvas);
        const job = page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        renderTasks.add(job);
        try {
          await job.promise;
        } finally {
          renderTasks.delete(job);
        }
        if (disposed || token !== generation) return;
        const layer = document.createElement("div");
        layer.className = "textLayer";
        layer.style.setProperty("--total-scale-factor", String(scale));
        layer.style.setProperty("--scale-round-x", "1px");
        layer.style.setProperty("--scale-round-y", "1px");
        node.append(layer);
        const content = await page.getTextContent();
        const textLayer = new pdfjs.TextLayer({
          textContentSource: content,
          container: layer,
          viewport,
        });
        await textLayer.render();
        node._viewport = viewport;
        node.dataset.ready = "true";
        overlays(node, number, viewport);
      } catch (error) {
        if (
          !disposed &&
          token === generation &&
          error.name !== "RenderingCancelledException"
        ) {
          node.dataset.ready = "error";
          node.textContent = String(error.message);
        }
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting)
            void render(
              Number(entry.target.dataset.page),
              entry.target,
              generation,
            );
      },
      { root: scroller, rootMargin: "600px" },
    );
    async function build() {
      const token = ++generation;
      for (const job of renderTasks) job.cancel();
      renderTasks.clear();
      observer.disconnect();
      pages.clear();
      scroller.replaceChildren();
      const numbers =
        s.flow === "scroll"
          ? Array.from({ length: doc.numPages }, (_, i) => i + 1)
          : [pageNumber];
      for (const n of numbers) {
        const node = document.createElement("div");
        node.className = "reader-pdf-page";
        node.dataset.page = String(n);
        node.style.height = "1000px";
        scroller.append(node);
        pages.set(n, node);
        observer.observe(node);
      }
      const current = pages.get(pageNumber);
      await render(pageNumber, current, token);
      if (disposed || token !== generation) return;
      scroller.scrollTop =
        current.offsetTop -
        scroller.offsetTop +
        current.clientHeight * fraction;
    }
    function report() {
      changed({
        location: { page: pageNumber, fraction },
        progress: (pageNumber - 1 + fraction) / doc.numPages,
        page: pageNumber,
        total: doc.numPages,
      });
    }
    scroller.addEventListener("scroll", () => {
      if (disposed) return;
      const top = scroller.getBoundingClientRect().top;
      for (const [n, node] of pages) {
        const r = node.getBoundingClientRect();
        if (r.bottom > top + 20) {
          pageNumber = n;
          fraction = clamp((top - r.top) / r.height, 1);
          break;
        }
      }
      report();
      // Bound raster memory in continuous mode while keeping layout placeholders.
      for (const [n, node] of pages)
        if (Math.abs(n - pageNumber) > 4 && node.dataset.ready === "true") {
          node.replaceChildren();
          delete node.dataset.ready;
          node._viewport = null;
          void doc
            .getPage(n)
            .then((page) => page.cleanup())
            .catch(() => {});
        }
    });
    scroller.addEventListener("pointerup", () => {
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return;
      const range = selection.getRangeAt(0),
        container =
          range.startContainer.parentElement.closest(".reader-pdf-page");
      if (!container?._viewport || !container.contains(range.endContainer))
        return;
      const bounds = container.getBoundingClientRect(),
        viewport = container._viewport;
      const rects = [...range.getClientRects()]
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => [
          ...viewport.convertToPdfPoint(
            r.left - bounds.left,
            r.top - bounds.top,
          ),
          ...viewport.convertToPdfPoint(
            r.right - bounds.left,
            r.bottom - bounds.top,
          ),
        ]);
      selected({
        text: selection.toString(),
        location: { page: Number(container.dataset.page), fraction: 0, rects },
      });
    });
    await build();
    report();
    return {
      capabilities: { pdf: true, text: true },
      toc,
      total: doc.numPages,
      position: () => ({ page: pageNumber, fraction }),
      async go(target) {
        pageNumber =
          typeof target === "number"
            ? Math.min(doc.numPages, Math.floor(target * doc.numPages) + 1)
            : clamp(target.page || 1, doc.numPages) || 1;
        fraction = typeof target === "number" ? 0 : clamp(target.fraction, 1);
        if (s.flow !== "scroll") await build();
        else {
          const node = pages.get(pageNumber);
          await render(pageNumber, node, generation);
          scroller.scrollTop =
            node.offsetTop - scroller.offsetTop + node.clientHeight * fraction;
        }
        report();
      },
      async next(direction) {
        await this.go({
          page: clamp(pageNumber + direction, doc.numPages) || 1,
        });
      },
      async settings(value) {
        s = value;
        await build();
        report();
      },
      async annotations(value) {
        annotations = value;
        for (const [n, node] of pages)
          if (node._viewport) overlays(node, n, node._viewport);
      },
      async search(query, cancelled) {
        const results = [],
          needle = query.toLocaleLowerCase();
        for (let n = 1; n <= doc.numPages && results.length < 1000; n++) {
          if (cancelled() || disposed) break;
          const page = await doc.getPage(n),
            text = (await page.getTextContent()).items
              .map((x) => x.str || "")
              .join(" ");
          for (
            let p = text.toLocaleLowerCase().indexOf(needle);
            p >= 0 && results.length < 1000;
            p = text.toLocaleLowerCase().indexOf(needle, p + needle.length)
          )
            results.push({
              label:
                n +
                " · " +
                text.slice(Math.max(0, p - 25), p + query.length + 50),
              location: { page: n },
            });
          await lib.pause();
        }
        return results;
      },
      async thumbnail(n) {
        const page = await doc.getPage(n),
          viewport = page.getViewport({ scale: 0.18 }),
          canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const job = page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
        });
        renderTasks.add(job);
        try {
          await job.promise;
          return canvas.toDataURL();
        } finally {
          renderTasks.delete(job);
        }
      },
      async destroy() {
        disposed = true;
        ++generation;
        observer.disconnect();
        for (const job of renderTasks) job.cancel();
        scroller.remove();
        await task.destroy();
      },
    };
  }
  return {
    create: async (format, options) => {
      await lib.engine(format);
      const signal = options.signal;
      const aborted = () => new DOMException("Cancelled", "AbortError");
      if (signal?.aborted) throw aborted();
      return new Promise((resolve, reject) => {
        const abort = () => reject(aborted());
        signal?.addEventListener("abort", abort, { once: true });
        Promise.resolve({ txt, epub, pdf }[format](options)).then(
          async (adapter) => {
            signal?.removeEventListener("abort", abort);
            if (signal?.aborted) {
              await adapter.destroy();
              reject(aborted());
            } else resolve(adapter);
          },
          (error) => {
            signal?.removeEventListener("abort", abort);
            reject(error);
          },
        );
      });
    },
    colors,
  };
})();

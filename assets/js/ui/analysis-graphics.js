"use strict";
/** Stateless SVG and timeline markup; interaction and animation belong to the analysis view. */
WorkTimeApp.ui.createAnalysisGraphics = function ({
  escape: esc,
  window,
  t,
  number,
  date,
}) {
  function clock(minutes) {
    if (minutes === null) return "—";
    const rounded = Math.round(minutes),
      value = rounded % 1440;
    return (
      (rounded >= 1440 ? t("nextDay") + " " : "") +
      String(Math.floor(value / 60)).padStart(2, "0") +
      ":" +
      String(value % 60).padStart(2, "0")
    );
  }

  function scale(values, top, bottom, minimumSpan) {
    let low = Math.min(...values),
      high = Math.max(...values);
    const center = (low + high) / 2;
    if (high - low < minimumSpan) {
      low = center - minimumSpan / 2;
      high = center + minimumSpan / 2;
    }
    const step = 15;
    low = Math.max(0, Math.floor(low / step) * step);
    high = Math.ceil(high / step) * step;
    const ticks = [];
    for (let tick = low; tick <= high; tick += 15) ticks.push(tick);
    const labelStep =
      [30, 60, 120, 180, 240, 360, 720, 1440].find(
        (interval) => ((bottom - top) * interval) / (high - low) >= 22,
      ) || 1440;
    return {
      ticks,
      labelStep,
      y: (value) => top + ((value - low) / (high - low)) * (bottom - top),
    };
  }

  function chart(data, width, height) {
    const right = width,
      top = 18,
      bottom = height - 76,
      startHeight = (bottom - top - 64) * 0.36,
      lanes = [
        {
          key: "start",
          references: [data.referenceStart, data.referenceStart + 60],
          top,
          bottom: top + startHeight,
        },
        {
          key: "end",
          references: [data.referenceEnd, data.referenceEnd + 180],
          top: top + startHeight + 64,
          bottom,
        },
      ];
    for (const lane of lanes) {
      const values = [
        ...lane.references,
        ...data.chartDays.map((day) => day[lane.key]),
      ];
      lane.scale = scale(
        values,
        lane.top,
        lane.bottom,
        lane.key === "start" ? 60 : 180,
      );
      lane.scale.ticks = [
        ...new Set([...lane.scale.ticks, ...lane.references]),
      ].sort((a, b) => a - b);
      // Reserve label positions for the four requested reference times first.
      lane.labels = new Set(lane.references);
      for (const tick of lane.scale.ticks)
        if (
          tick % lane.scale.labelStep === 0 &&
          [...lane.labels].every(
            (label) => Math.abs(lane.scale.y(label) - lane.scale.y(tick)) >= 22,
          )
        )
          lane.labels.add(tick);
    }
    const context = window.document.createElement("canvas").getContext("2d");
    if (context)
      context.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
    // Fit the gutter to visible labels, including next-day times only when shown.
    const labelWidths = lanes
      .flatMap((lane) => [...lane.labels])
      .map((tick) =>
        context
          ? context.measureText(clock(tick)).width
          : clock(tick).length * 7,
      );
    const left = Math.max(44, Math.ceil(Math.max(...labelWidths)) + 8),
      step = (right - left) / data.calendarDays.length,
      x = (index) => left + (index + 0.5) * step;
    let svg =
      '<svg class="analysis-plot" viewBox="0 0 ' +
      width +
      " " +
      height +
      '" role="group" aria-label="' +
      esc(t("dailyDescription")) +
      '">';
    for (const lane of lanes) {
      const y = lane.scale.y;
      svg +=
        '<g class="analysis-lane" data-lane="' +
        lane.key +
        '" role="group" aria-label="' +
        esc(t(lane.key)) +
        '">';
      for (const tick of lane.scale.ticks)
        svg +=
          '<g class="analysis-grid' +
          (lane.references.includes(tick)
            ? " analysis-grid-reference"
            : lane.labels.has(tick)
              ? ""
              : " analysis-grid-minor") +
          '" data-minute="' +
          tick +
          '"><line x1="' +
          left +
          '" x2="' +
          right +
          '" y1="' +
          y(tick) +
          '" y2="' +
          y(tick) +
          '"/>' +
          (lane.labels.has(tick)
            ? '<text x="2" y="' +
              (y(tick) + 4) +
              '" text-anchor="start">' +
              esc(clock(tick)) +
              "</text>"
            : "") +
          "</g>";
      for (const [index, day] of data.calendarDays.entries()) {
        if (!day.work)
          svg +=
            '<rect class="analysis-rest-band" data-key="rest-' +
            index +
            '" x="' +
            (left + index * step) +
            '" y="' +
            lane.top +
            '" width="' +
            step +
            '" height="' +
            (lane.bottom - lane.top) +
            '"/>';
      }
      svg += "</g>";
    }
    // One accessible target per observed date links both tracks and the detail strip.
    for (const day of data.chartDays) {
      const cx = x(Number(day.date.slice(8)) - 1),
        startY = lanes[0].scale.y(day.start),
        endY = lanes[1].scale.y(day.end),
        late = day.end > 1260,
        label =
          date(day.date) +
          " · " +
          t("start") +
          " " +
          clock(day.start) +
          " · " +
          t("end") +
          " " +
          clock(day.end) +
          " · " +
          t("overtime") +
          " " +
          WorkTimeApp.i18n.duration(day.overtime) +
          (!day.work ? " · " + t("restOvertime") : "") +
          (day.manual ? " · " + t("manualRecord") : "");
      svg +=
        '<g class="analysis-range' +
        (day.manual ? " is-manual" : "") +
        (day.date > data.asOf ? " is-future" : "") +
        (!day.work ? " is-rest-overtime" : "") +
        '" tabindex="0" role="img" data-date="' +
        day.date +
        '" aria-label="' +
        esc(label) +
        '"><rect class="analysis-hit" x="' +
        (cx - step / 2) +
        '" y="' +
        (top - 7) +
        '" width="' +
        step +
        '" height="' +
        (bottom - top + 14) +
        '"/><line class="analysis-connector" x1="' +
        cx +
        '" x2="' +
        cx +
        '" y1="' +
        startY +
        '" y2="' +
        endY +
        '"/><circle class="analysis-halo" cx="' +
        cx +
        '" cy="' +
        startY +
        '" r="10"/><circle class="analysis-halo' +
        (late ? " is-late" : "") +
        '" cx="' +
        cx +
        '" cy="' +
        endY +
        '" r="10"/><circle class="analysis-point" data-lane="start" cx="' +
        cx +
        '" cy="' +
        startY +
        '" r="5.5"/>';
      svg +=
        '<circle data-key="end-circle" class="' +
        (late ? "analysis-point-alternate" : "analysis-point") +
        '" ' +
        (late ? "" : 'data-lane="end" ') +
        'opacity="' +
        (late ? 0 : 1) +
        '" cx="' +
        cx +
        '" cy="' +
        endY +
        '" r="5.5"/>' +
        '<path data-key="end-diamond" class="' +
        (late ? "analysis-point is-late" : "analysis-point-alternate is-late") +
        '" ' +
        (late ? 'data-lane="end" ' : "") +
        'opacity="' +
        (late ? 1 : 0) +
        '" d="M' +
        cx +
        " " +
        (endY - 6.5) +
        'l6.5 6.5 -6.5 6.5 -6.5 -6.5Z"/>';
      svg += "</g>";
    }
    return svg + dateAxis(data, left, step, height) + "</svg>";
  }

  function dateAxis(data, left, step, height) {
    const records = new Map(data.days.map((day) => [day.date, day])),
      longest = new Set(data.longest.dates),
      axisTop = height - 64,
      markerWidth = Math.max(4, step - 10);
    let markup =
      '<rect class="analysis-longest-band" data-key="longest-band" aria-hidden="true" x="' +
      (left +
        (data.longest.start ? Number(data.longest.start.slice(8)) - 1 : 0) *
          step) +
      '" y="' +
      axisTop +
      '" width="' +
      data.longest.count * step +
      '" height="56"/><line class="analysis-longest-underline" data-key="longest-underline" aria-hidden="true" x1="' +
      (left +
        (data.longest.start ? Number(data.longest.start.slice(8)) - 1 : 0) *
          step) +
      '" x2="' +
      (left +
        (data.longest.start ? Number(data.longest.start.slice(8)) - 1 : 0) *
          step +
        data.longest.count * step) +
      '" y1="' +
      (height - 8) +
      '" y2="' +
      (height - 8) +
      '" opacity="' +
      (data.longest.count ? 1 : 0) +
      '"/>';
    for (const [index, day] of data.calendarDays.entries()) {
      const record = records.get(day.date),
        status =
          day.date > data.asOf
            ? "future"
            : !record
              ? "missing"
              : record.overtime > 0
                ? day.work
                  ? "workedOvertime"
                  : "restOvertime"
                : "recorded",
        label =
          date(day.date) +
          " · " +
          t(status) +
          (longest.has(day.date) ? " · " + t("longest") : ""),
        cx = step / 2;
      markup +=
        '<text data-key="date-' +
        index +
        '" class="analysis-date' +
        (day.date > data.asOf ? " is-future" : "") +
        (day.date === data.asOf ? " is-today" : "") +
        '" data-workday="' +
        day.work +
        '" x="' +
        (left + (index + 0.5) * step) +
        '" y="' +
        (axisTop + 20) +
        '" text-anchor="middle" aria-hidden="true">' +
        esc(number(index + 1)) +
        "</text>" +
        '<svg class="analysis-day' +
        (longest.has(day.date) ? " is-longest" : "") +
        '" x="' +
        (left + index * step) +
        '" y="' +
        axisTop +
        '" width="' +
        step +
        '" height="56" overflow="visible" data-date="' +
        day.date +
        '" data-state="' +
        status +
        '" data-workday="' +
        day.work +
        '" tabindex="0" role="img" aria-label="' +
        esc(label) +
        '"><title>' +
        esc(label) +
        '</title><rect class="analysis-axis-hit" x="1" y="1" width="' +
        Math.max(0, step - 2) +
        '" height="54" rx="3"/><g class="analysis-marker" aria-hidden="true">' +
        ["workedOvertime", "restOvertime", "recorded", "missing", "future"]
          .map((shape) => {
            const attributes =
              ' class="analysis-marker-shape" data-key="' +
              shape +
              '" data-state="' +
              shape +
              '" data-active="' +
              (shape === status) +
              '"';
            if (shape === "missing")
              return (
                "<circle" + attributes + ' cx="' + cx + '" cy="38" r="3.5"/>'
              );
            if (shape === "future")
              return (
                "<line" +
                attributes +
                ' x1="' +
                (cx - markerWidth / 2) +
                '" x2="' +
                (cx + markerWidth / 2) +
                '" y1="38" y2="38"/>'
              );
            return (
              "<rect" +
              attributes +
              ' x="' +
              (cx - markerWidth / 2) +
              '" y="33.5" width="' +
              markerWidth +
              '" height="9" rx="2"/>'
            );
          })
          .join("") +
        "</g></svg>";
    }
    return markup;
  }

  function timelineLegend(data) {
    return ["workedOvertime", "restOvertime", "recorded", "missing", "future"]
      .filter(
        (status) =>
          status !== "future" ||
          data.calendarDays.some((day) => day.date > data.asOf),
      )
      .map(
        (status) =>
          '<span data-key="' +
          status +
          '" data-state="' +
          status +
          '"><i aria-hidden="true"></i>' +
          '<span class="analysis-legend-label">' +
          esc(t(status)) +
          "</span></span>",
      )
      .join("");
  }
  return { clock, chart, timelineLegend };
};

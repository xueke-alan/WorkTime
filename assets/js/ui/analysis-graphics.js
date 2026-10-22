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
      bottom = height - 31,
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
        ...data.days.map((day) => day[lane.key]),
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
    // Keep the axis gutter stable when a month gains or loses next-day records.
    const labelWidths = [0, 1440].map((tick) =>
      context ? context.measureText(clock(tick)).width : clock(tick).length * 7,
    );
    const left = Math.max(44, Math.ceil(Math.max(...labelWidths)) + 18),
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
    for (const day of data.days) {
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
    for (const [index, day] of data.calendarDays.entries())
      svg +=
        '<text data-key="date-' +
        index +
        '" class="analysis-date' +
        (day.date > data.asOf ? " is-future" : "") +
        (day.date === data.asOf ? " is-today" : "") +
        '" x="' +
        x(index) +
        '" y="' +
        (height - 8) +
        '" text-anchor="middle">' +
        esc(number(index + 1)) +
        "</text>";
    return svg + "</svg>";
  }

  function timeline(data) {
    const records = new Map(data.days.map((day) => [day.date, day])),
      longest = new Set(data.longest.dates);
    return (
      '<div class="analysis-streak-dates" style="--analysis-month-days:' +
      data.calendarDays.length +
      '"><span class="analysis-longest-band" data-key="longest-band" aria-hidden="true" style="left:' +
      (data.longest.start
        ? ((Number(data.longest.start.slice(8)) - 1) * 100) /
          data.calendarDays.length
        : 0) +
      "%;width:" +
      (data.longest.count * 100) / data.calendarDays.length +
      '%"></span>' +
      data.calendarDays
        .map((day, index) => {
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
              (longest.has(day.date) ? " · " + t("longest") : "");
          return (
            '<span style="left:' +
            (index * 100) / data.calendarDays.length +
            "%;width:" +
            100 / data.calendarDays.length +
            '%" class="analysis-day' +
            (longest.has(day.date) ? " is-longest" : "") +
            '" data-date="' +
            day.date +
            '" data-state="' +
            status +
            '" tabindex="0" title="' +
            esc(label) +
            '" aria-label="' +
            esc(label) +
            '"><span>' +
            esc(number(index + 1)) +
            '</span><span class="analysis-marker" aria-hidden="true">' +
            ["workedOvertime", "restOvertime", "recorded", "missing", "future"]
              .map(
                (shape) =>
                  '<i class="analysis-marker-shape" data-key="' +
                  shape +
                  '" data-state="' +
                  shape +
                  '" data-active="' +
                  (shape === status) +
                  '"></i>',
              )
              .join("") +
            "</span></span>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function timelineLegend() {
    return ["workedOvertime", "restOvertime", "recorded", "missing", "future"]
      .map(
        (status) =>
          '<span data-state="' +
          status +
          '"><i aria-hidden="true"></i>' +
          '<span class="analysis-legend-label">' +
          esc(t(status)) +
          "</span></span>",
      )
      .join("");
  }
  return { clock, chart, timeline, timelineLegend };
};

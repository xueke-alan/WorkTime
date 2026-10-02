"use strict";
/* Pure year-view data; shared calculations keep month and year consistent. */
const WorkYear = (() => {
  const zeroColor = [231, 238, 233],
    maxColor = [74, 145, 106],
    deficitColor = [194, 101, 96];
  function heatColor(minutes, maximum, minimum = 0) {
    const negative = minutes < 0,
      limit = negative ? Math.abs(minimum) : maximum;
    const ratio = limit > 0 ? Math.min(1, Math.abs(minutes || 0) / limit) : 0;
    const mix = (start, end) =>
      start.map((value, i) => Math.round(value + (end[i] - value) * ratio));
    const background = mix(zeroColor, negative ? deficitColor : maxColor),
      alpha = Number((0.85 + 0.15 * ratio).toFixed(4));
    // Composite translucent heat cells over the white calendar before measuring contrast.
    const channels = background.map((value) => {
      const s = (value * alpha + 255 * (1 - alpha)) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    const luminance =
      channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    const darkChannels = [60, 74, 69].map((value) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    const darkLuminance =
      darkChannels[0] * 0.2126 +
      darkChannels[1] * 0.7152 +
      darkChannels[2] * 0.0722;
    const darkContrast = (luminance + 0.05) / (darkLuminance + 0.05),
      whiteContrast = 1.05 / (luminance + 0.05);
    return {
      ratio,
      background: "rgba(" + background.join(",") + "," + alpha.toFixed(4) + ")",
      text:
        darkContrast >= 4.5 || darkContrast >= whiteContrast
          ? "#3c4a45"
          : "#ffffff",
    };
  }
  function scaleMaximum(months) {
    return (
      Math.ceil(
        Math.max(
          0,
          ...months.flatMap((month) =>
            month.days.map((day) => day.overtime || 0),
          ),
        ) / 60,
      ) * 60
    );
  }
  function scaleMinimum(months) {
    return (
      Math.floor(
        Math.min(
          0,
          ...months.flatMap((month) =>
            month.days.map((day) => day.overtime || 0),
          ),
        ) / 60,
      ) * 60
    );
  }
  function months(state, year, today) {
    const result = Array.from({ length: 12 }, (_, index) => {
      const prefix = year + "-" + WorkTime.pad(index + 1),
        first = prefix + "-01",
        total = new Date(year, index + 1, 0, 12).getDate();
      return {
        month: index + 1,
        offset: (WorkTime.localDate(first).getDay() + 6) % 7,
        days: Array.from({ length: total }, (_, i) => {
          const date = prefix + "-" + WorkTime.pad(i + 1),
            day = state.days[date] || {},
            info = WorkTime.calendarInfo(date, day),
            calc = WorkTime.calculate(date, day, state.settings, true);
          const leave = Math.min(
            state.settings.standardMinutes,
            Math.max(0, day.leaveMinutes || 0),
          );
          const rest =
            !info.work &&
            (day.kind === "rest" || date <= today) &&
            !(calc.minutes > 0) &&
            !day.plannedOvertime;
          const description = [
            date,
            info.label,
            calc.overtime === null
              ? "无完整工时记录"
              : (calc.overtime < 0 ? "欠工时 " : "加班 ") +
                WorkTime.hours(Math.abs(calc.overtime)) +
                " 小时",
            leave ? "请假 " + WorkTime.hours(leave) + " 小时" : "",
            rest ? "休息" : "",
            day.plannedOvertime ? "计划加班" : "",
            calc.record?.type === "estimate" ? "手动填写" : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return {
            date,
            number: i + 1,
            overtime: calc.overtime,
            leave: leave > 0,
            rest,
            today: date === today,
            description,
            complete: calc.minutes !== null,
          };
        }),
      };
    });
    const maximum = scaleMaximum(result),
      minimum = scaleMinimum(result);
    for (const month of result)
      for (const day of month.days)
        day.color = heatColor(day.overtime, maximum, minimum);
    return result;
  }
  return { heatColor, scaleMaximum, scaleMinimum, months };
})();

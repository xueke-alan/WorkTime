"use strict";
(() => {
  const messages = {
    "zh-CN": [
      "确认",
      "预览中，确认后保存",
      "重置 {count} 天",
      "全部月份重置 {count} 天",
      "填写 {count} 天",
      "批量修改已保存。",
      "保存失败，预览尚未录入，请重试或取消。",
    ],
    "zh-TW": [
      "確認",
      "預覽中，確認後儲存",
      "重設 {count} 天",
      "所有月份重設 {count} 天",
      "填寫 {count} 天",
      "批次修改已儲存。",
      "儲存失敗，預覽尚未寫入，請重試或取消。",
    ],
    "zh-HK": [
      "確認",
      "預覽中，確認後儲存",
      "重設 {count} 天",
      "所有月份重設 {count} 天",
      "填寫 {count} 天",
      "批次修改已儲存。",
      "儲存失敗，預覽尚未寫入，請重試或取消。",
    ],
    en: [
      "Confirm",
      "Preview · confirm to save",
      "Reset {count} days",
      "Reset {count} days across all months",
      "Fill {count} days",
      "Batch changes saved.",
      "Save failed. Preview has not been saved. Retry or cancel.",
    ],
    ja: [
      "確定",
      "プレビュー中・確定して保存",
      "{count} 日をリセット",
      "全月の {count} 日をリセット",
      "{count} 日を入力",
      "一括変更を保存しました。",
      "保存できませんでした。プレビューは未保存です。再試行またはキャンセルしてください。",
    ],
    ko: [
      "확인",
      "미리 보기 · 확인 후 저장",
      "{count}일 초기화",
      "모든 달의 {count}일 초기화",
      "{count}일 입력",
      "일괄 변경 사항이 저장되었습니다.",
      "저장하지 못했습니다. 미리 보기는 저장되지 않았습니다. 다시 시도하거나 취소하세요.",
    ],
  };
  const keys = [
    "confirm",
    "preview",
    "resetCount",
    "resetAllCount",
    "fillCount",
    "saved",
    "saveFailed",
  ];
  for (const [locale, values] of Object.entries(messages))
    keys.forEach((key, index) => {
      WorkTimeApp.data.locales[locale]["batch." + key] = values[index];
    });
})();
// Batch actions share a compact row; their existing title/ARIA keeps full scope.
(() => {
  for (const [language, [label, selected]] of Object.entries({
    "zh-CN": ["全部重置", "重置所选"],
    "zh-TW": ["全部重設", "重設所選"],
    "zh-HK": ["全部重設", "重設所選"],
    en: ["Reset all", "Reset"],
    ko: ["전체 초기화", "초기화"],
    ja: ["リセット", "リセット"],
  })) {
    WorkTimeApp.data.locales[language]["short.batchReset"] = label;
    WorkTimeApp.data.locales[language]["short.batchResetSelected"] = selected;
  }
})();
(() => {
  const labels = {
    "zh-CN": ["日历天气显示", "{days}天", "不显示"],
    "zh-TW": ["月曆天氣顯示", "{days}天", "不顯示"],
    "zh-HK": ["日曆天氣顯示", "{days}天", "不顯示"],
    en: ["Calendar weather", "{days} days", "Hidden"],
    ko: ["달력 날씨", "{days}일", "표시 안 함"],
    ja: ["カレンダーの天気", "{days}日", "非表示"],
  };
  for (const [locale, [label, days, off]] of Object.entries(labels))
    Object.assign(WorkTimeApp.data.locales[locale], {
      "weather.settings.label": label,
      "weather.settings.days": days,
      "weather.settings.off": off,
    });
})();
(() => {
  const rows = {
    "zh-CN": ["所需加班", "可用工时"],
    "zh-TW": ["所需加班", "可用工時"],
    "zh-HK": ["所需加班", "可用工時"],
    en: ["OT needed", "Available"],
    ko: ["필요 초과", "가능 시간"],
    ja: ["必要残業", "余裕時間"],
  };
  for (const [language, [needed, available]] of Object.entries(rows))
    Object.assign(WorkTimeApp.data.locales[language], {
      "short.needed": needed,
      "short.available": available,
      "short.target.remaining": "{label} · {count} d",
    });
})();
(() => {
  for (const [locale, value] of Object.entries({
    "zh-CN": "当日加班",
    "zh-TW": "當日加班",
    "zh-HK": "當日加班",
    en: "Daily overtime",
    ko: "일일 초과근무",
    ja: "当日の残業時間",
  }))
    WorkTimeApp.data.locales[locale]["preview.dailyOvertime"] = value;
})();
/** Short forms for fixed-width panels; full wording stays in titles/ARIA. */
(() => {
  const keys = [
    "short.brand",
    "short.target",
    "short.workOT",
    "short.restOT",
    "short.averageFormula",
    "short.balanceFormula",
    "short.planned",
    "short.preview.hours",
    "short.preview.ot",
    "short.preview.attendance",
    "short.preview.through",
    "short.preview.employment",
    "short.preview.starts",
  ];
  const rows = {
    "zh-CN": [
      "工时记录",
      "月度加班目标",
      "工作日加班",
      "休息日加班",
      "工作日加班 ÷ 出勤",
      "工作日加班 − 目标 × 出勤",
      "计划加班：{count} d",
      "工时",
      "加班",
      "出勤",
      "本月至 {date}",
      "入职 {count} 天",
      "距入职 {count} 天",
    ],
    "zh-TW": [
      "工時記錄",
      "每月加班目標",
      "工作日加班",
      "休息日加班",
      "工作日加班 ÷ 出勤",
      "工作日加班 − 目標 × 出勤",
      "預計加班：{count} d",
      "工時",
      "加班",
      "出勤",
      "本月至 {date}",
      "到職 {count} 天",
      "距到職 {count} 天",
    ],
    "zh-HK": [
      "工時記錄",
      "每月加班目標",
      "工作日加班",
      "休息日加班",
      "工作日加班 ÷ 出勤",
      "工作日加班 − 目標 × 出勤",
      "計劃加班：{count} d",
      "工時",
      "加班",
      "出勤",
      "本月至 {date}",
      "入職 {count} 天",
      "距入職 {count} 天",
    ],
    en: [
      "Timesheet",
      "Monthly OT target",
      "Weekday OT",
      "Rest-day OT",
      "Weekday OT ÷ attendance",
      "Weekday OT − target × attendance",
      "Planned OT: {count} d",
      "Hours",
      "OT",
      "Attendance",
      "Through {date}",
      "Day {count} at work",
      "Starts in {count} days",
    ],
    ko: [
      "근무 기록",
      "월 초과근무 목표",
      "평일 초과",
      "휴일 초과",
      "평일 초과 ÷ 출근일수",
      "평일 초과 − 목표 × 출근일수",
      "초과근무 예정: {count} d",
      "근무",
      "초과",
      "출근",
      "이달 {date}까지",
      "입사 {count}일째",
      "입사까지 {count}일",
    ],
    ja: [
      "勤務記録",
      "月間残業目標",
      "平日残業",
      "休日残業",
      "平日残業 ÷ 出勤日数",
      "平日残業 − 目標 × 出勤日数",
      "残業予定：{count} d",
      "勤務",
      "残業",
      "出勤",
      "今月{date}まで",
      "勤続{count}日目",
      "開始まで{count}日",
    ],
  };
  for (const [locale, values] of Object.entries(rows))
    Object.assign(
      WorkTimeApp.data.locales[locale],
      Object.fromEntries(keys.map((key, index) => [key, values[index]])),
    );
})();
/** Complete contextual messages shared by the new presentation paths. */
(() => {
  const keys = [
    "summary.remaining",
    "history.english",
    "history.chinese",
    "history.languageNote",
    "date.tabs",
    "calendar.kind.work",
    "calendar.kind.off",
    "calendar.kind.makeup",
    "calendar.kind.extra",
    "unit.hour",
    "unit.hourPerDay",
    "history.bce",
    "editor.timeIssue",
    "schedule.description",
    "backup.tooLarge",
  ];
  const rows = {
    "zh-CN": [
      "{label} · 剩余 {days}",
      "英文维基百科",
      "中文维基百科",
      "历史事件正文为英语。",
      "历史与节日",
      "工作日",
      "休息日",
      "调休日",
      "奋斗日",
      "h",
      "h/d",
      "公元前{year}年",
      "时间异常：下班 {end} 早于上班 {start}，不计入工时。",
      "{start}–{end} · 休息 {breaks}",
      "备份超过 {size} MB 大小限制。",
    ],
    en: [
      "{label} · {days} left",
      "English Wikipedia",
      "Chinese Wikipedia",
      "Historical event text is in English.",
      "History and festivals",
      "Work",
      "Off",
      "Makeup",
      "Extra",
      "h",
      "h/d",
      "{year} BCE",
      "Time issue: clock-out {end} is before clock-in {start}. Excluded from work hours.",
      "{start}–{end} · Breaks {breaks}",
      "Backup exceeds the {size} MB size limit.",
    ],
    "zh-TW": [
      "{label} · 剩餘 {days}",
      "英文維基百科",
      "中文維基百科",
      "歷史事件內文為英語。",
      "歷史與節日",
      "工作日",
      "休息日",
      "補班日",
      "額外工作日",
      "h",
      "h/d",
      "西元前{year}年",
      "時間異常：下班 {end} 早於上班 {start}，不計入工時。",
      "{start}–{end} · 休息 {breaks}",
      "備份超過 {size} MB 大小限制。",
    ],
    "zh-HK": [
      "{label} · 剩餘 {days}",
      "英文維基百科",
      "中文維基百科",
      "歷史事件內文為英語。",
      "歷史與節日",
      "工作日",
      "休息日",
      "補班日",
      "額外工作日",
      "h",
      "h/d",
      "公元前{year}年",
      "時間異常：下班 {end} 早於上班 {start}，不計入工時。",
      "{start}–{end} · 休息 {breaks}",
      "備份超過 {size} MB 大小限制。",
    ],
    ko: [
      "{label} · {days} 남음",
      "영어 위키백과",
      "중국어 위키백과",
      "역사 사건의 본문은 영어로 제공됩니다.",
      "역사 및 기념일",
      "근무",
      "휴무",
      "대체근무",
      "추가근무",
      "시간",
      "시간/일",
      "기원전 {year}년",
      "시간 오류: 퇴근 {end}이 출근 {start}보다 빠릅니다. 근무 시간에서 제외됩니다.",
      "{start}–{end} · 휴게 {breaks}",
      "백업이 {size} MB 제한을 초과합니다.",
    ],
    ja: [
      "{label} · 残り{days}",
      "英語版ウィキペディア",
      "中国語版ウィキペディア",
      "歴史上の出来事の本文は英語です。",
      "歴史と祝祭日",
      "勤務",
      "休み",
      "振替勤務",
      "追加勤務",
      "時間",
      "時間/日",
      "紀元前{year}年",
      "時刻の問題：退勤{end}が出勤{start}より前です。労働時間には含めません。",
      "{start}–{end} · 休憩 {breaks}",
      "バックアップが{size} MBの上限を超えています。",
    ],
  };
  for (const [locale, values] of Object.entries(rows))
    Object.assign(
      WorkTimeApp.data.locales[locale],
      Object.fromEntries(keys.map((key, index) => [key, values[index]])),
    );
})();

(() => {
  const rows = {
    "zh-CN": [
      "删除 {date} 导入的“{sources}”？将更新 {affected} 个日期，其中 {restored} 个恢复其他导入记录，{cleared} 个清除此批记录。",
      "共 {imports} 次导入 · {dates} 个有效日期",
    ],
    en: [
      "Delete “{sources}”, imported {date}? This updates {affected} dates: {restored} restored from other imports and {cleared} cleared from this batch.",
      "{imports} imports · {dates} valid dates",
    ],
    "zh-TW": [
      "刪除 {date} 匯入的「{sources}」？將更新 {affected} 個日期，其中 {restored} 個還原其他匯入記錄，{cleared} 個清除此批記錄。",
      "共 {imports} 次匯入 · {dates} 個有效日期",
    ],
    "zh-HK": [
      "刪除 {date} 匯入的「{sources}」？將更新 {affected} 個日期，其中 {restored} 個還原其他匯入記錄，{cleared} 個清除此批記錄。",
      "共 {imports} 次匯入 · {dates} 個有效日期",
    ],
    ko: [
      "{date}에 가져온 ‘{sources}’을 삭제할까요? {affected}개 날짜가 갱신됩니다. {restored}개는 다른 가져오기 기록으로 복원되고, {cleared}개는 이 묶음에서 제거됩니다.",
      "가져오기 {imports}회 · 유효 날짜 {dates}개",
    ],
    ja: [
      "{date}に取り込んだ「{sources}」を削除しますか？{affected}日分を更新し、{restored}日分は別の取込から復元、{cleared}日分はこの取込から消去します。",
      "取込{imports}件・有効な日付{dates}日分",
    ],
  };
  for (const [language, [confirmation, totals]] of Object.entries(rows))
    Object.assign(WorkTimeApp.data.locales[language], {
      "import.deleteSummary": confirmation,
      "import.historyTotals": totals,
    });
})();

// Per-card source preference and field-level OA completion.
(() => {
  const rows = {
    "zh-CN": [
      "OA 优先，缺失时间由手录补齐",
      "仅使用手录数据",
      "点击切换为手录优先",
      "点击切换为 OA 优先",
      "上班时间由手录补齐",
      "下班时间由手录补齐",
    ],
    "zh-TW": [
      "OA 優先，缺少時間由手動記錄補齊",
      "僅使用手動記錄",
      "點擊切換為手動優先",
      "點擊切換為 OA 優先",
      "上班時間由手動記錄補齊",
      "下班時間由手動記錄補齊",
    ],
    "zh-HK": [
      "OA 優先，缺少時間由手動記錄補齊",
      "僅使用手動記錄",
      "點擊切換為手動優先",
      "點擊切換為 OA 優先",
      "上班時間由手動記錄補齊",
      "下班時間由手動記錄補齊",
    ],
    en: [
      "OA first; missing times filled from manual entries",
      "Manual entries only",
      "Click to use manual entries only",
      "Click to prefer OA",
      "Start filled from manual entry",
      "End filled from manual entry",
    ],
    ja: [
      "OA 優先、不足時刻は手入力で補完",
      "手入力のみ使用",
      "クリックして手入力優先に切替",
      "クリックして OA 優先に切替",
      "出勤時刻を手入力で補完",
      "退勤時刻を手入力で補完",
    ],
    ko: [
      "OA 우선, 누락 시간은 수동 기록으로 보완",
      "수동 기록만 사용",
      "클릭하여 수동 우선으로 전환",
      "클릭하여 OA 우선으로 전환",
      "출근 시간을 수동 기록으로 보완",
      "퇴근 시간을 수동 기록으로 보완",
    ],
  };
  for (const [language, values] of Object.entries(rows))
    [
      "oa",
      "manual",
      "switchManual",
      "switchOA",
      "filledStart",
      "filledEnd",
    ].forEach((key, index) => {
      WorkTimeApp.data.locales[language]["source." + key] = values[index];
    });
})();

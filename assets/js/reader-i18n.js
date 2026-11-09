"use strict";
WorkTimeApp.ui.readerText = (() => {
  // Keep this small entry-point catalog independent from the lazy reader engines.
  const rows = {
    placeholderTitle: "电子书|電子書|電子書|Ebooks|電子書籍|전자책",
    placeholderMessage:
      "电子书功能暂缓开发，敬请期待。|電子書功能暫緩開發，敬請期待。|電子書功能暫緩開發，敬請期待。|Ebook development is on hold. Stay tuned.|電子書籍機能の開発は一時休止中です。|전자책 기능 개발은 잠시 보류 중입니다.",
    placeholderClose: "关闭|關閉|關閉|Close|閉じる|닫기",
    minimize:
      "最小化阅读|最小化閱讀|最小化閱讀|Minimize reader|読書を最小化|독서 최소화",
    expand:
      "展开阅读器|展開閱讀器|展開閱讀器|Expand reader|リーダーを開く|리더 펼치기",
    miniEmpty:
      "展开阅读器，选择或重新连接书籍。|展開閱讀器，選擇或重新連接書籍。|展開閱讀器，選擇或重新連接書籍。|Expand the reader to choose or reconnect a book.|リーダーを開いて本を選択・再接続してください。|리더를 펼쳐 책을 선택하거나 다시 연결하세요.",
    sidebar:
      "切换侧栏|切換側欄|切換側欄|Toggle sidebar|サイドバー切替|사이드바 전환",
    more: "更多|更多|更多|More|その他|더 보기",
    folder:
      "书籍文件夹|書籍資料夾|書籍資料夾|Book folder|本のフォルダー|책 폴더",
    backup:
      "备份与导出|備份與匯出|備份與匯出|Backup & export|バックアップと出力|백업 및 내보내기",
    sort: "排序|排序|排序|Sort by|並び順|정렬",
    view: "视图|檢視|檢視|View|表示|보기",
    bookCount: "{n} 本书|{n} 本書|{n} 本書|{n} books|{n} 冊|{n}권",
    title: "阅读|閱讀|閱讀|Reading|読書|독서",
    shelf: "书架|書架|書架|Library|本棚|서재",
    choose:
      "选择书籍文件夹|選擇書籍資料夾|選擇書籍資料夾|Choose book folder|本のフォルダーを選択|책 폴더 선택",
    chooseHint:
      "选择文件夹，开始你的阅读。EPUB · TXT · PDF，文件只读，保存在本机。|選擇資料夾開始閱讀。EPUB · TXT · PDF，原始檔案唯讀。|選擇資料夾開始閱讀。EPUB · TXT · PDF，原始檔案唯讀。|Choose a folder to read EPUB, TXT and PDF. Source files stay read-only and local.|フォルダーを選んで EPUB・TXT・PDF を読む。元のファイルは変更しません。|폴더를 선택해 EPUB·TXT·PDF를 읽으세요. 원본은 변경하지 않습니다.",
    reconnect:
      "重新连接文件夹|重新連接資料夾|重新連接資料夾|Reconnect folder|フォルダーに再接続|폴더 다시 연결",
    refresh:
      "刷新书架|重新整理書架|重新整理書架|Refresh library|本棚を更新|서재 새로 고침",
    cancel: "取消|取消|取消|Cancel|キャンセル|취소",
    exit: "返回日历|返回日曆|返回日曆|Return to calendar|カレンダーに戻る|달력으로 돌아가기",
    fullscreen: "全屏|全螢幕|全螢幕|Fullscreen|全画面|전체 화면",
    fullscreenFailed:
      "当前环境不支持全屏，可继续在工作区阅读。|目前環境不支援全螢幕，可繼續閱讀。|目前環境不支援全螢幕，可繼續閱讀。|Fullscreen is unavailable. Continue reading here.|全画面表示は利用できません。|전체 화면을 사용할 수 없습니다.",
    scanning:
      "正在扫描书籍|正在掃描書籍|正在掃描書籍|Scanning books|本を検索中|책 검색 중",
    opening:
      "正在打开书籍…|正在開啟書籍…|正在開啟書籍…|Opening book…|本を開いています…|책 여는 중…",
    empty:
      "这个文件夹中没有 EPUB、TXT 或 PDF。|此資料夾沒有 EPUB、TXT 或 PDF。|此資料夾沒有 EPUB、TXT 或 PDF。|No EPUB, TXT or PDF files in this folder.|対応する本がありません。|지원하는 책이 없습니다.",
    cancelled:
      "已取消扫描，原书架已保留。|已取消掃描，保留原書架。|已取消掃描，保留原書架。|Scan cancelled. Previous library retained.|検索をキャンセルしました。|검색을 취소했습니다.",
    partialScan:
      "部分文件无法读取，其余书籍已加入。|部分檔案無法讀取，其餘已加入。|部分檔案無法讀取，其餘已加入。|Some files could not be read. Other books were added.|一部のファイルを読み込めませんでした。|일부 파일을 읽을 수 없습니다.",
    changedFiles:
      "发现内容变化的书籍，旧阅读记录已保留。|發現內容變更的書籍，舊紀錄已保留。|發現內容變更的書籍，舊紀錄已保留。|Changed books found. Previous reading records retained.|変更された本の以前の記録を保持しました。|변경된 책의 이전 기록을 보관했습니다.",
    accessHint:
      "请重新连接或选择书籍所在的文件夹。|請重新連接或選擇書籍資料夾。|請重新連接或選擇書籍資料夾。|Reconnect or choose the folder containing this book.|本のフォルダーを再選択してください。|책이 있는 폴더를 다시 선택하세요.",
    openFailed:
      "无法打开这本书，请检查文件是否完整或重新连接目录。|無法開啟，請檢查檔案或重新連接資料夾。|無法開啟，請檢查檔案或重新連接資料夾。|Cannot open this book. Check the file or reconnect the folder.|本を開けません。ファイルを確認してください。|책을 열 수 없습니다. 파일을 확인하세요.",
    drm: "暂不支持加密或 DRM 保护的 EPUB。|不支援加密或 DRM 保護的 EPUB。|不支援加密或 DRM 保護的 EPUB。|Encrypted or DRM-protected EPUB is unsupported.|暗号化された EPUB には対応していません。|암호화된 EPUB은 지원하지 않습니다.",
    locationFailed:
      "无法定位到该位置，阅读记录仍保留。|無法定位，閱讀紀錄仍保留。|無法定位，閱讀紀錄仍保留。|Cannot locate this position. Reading records retained.|位置に移動できません。|해당 위치로 이동할 수 없습니다.",
    searchFailed:
      "搜索失败，请重试。|搜尋失敗，請重試。|搜尋失敗，請重試。|Search failed. Please retry.|検索に失敗しました。|검색에 실패했습니다.",
    storageIssue:
      "阅读数据暂时无法保存，请导出阅读备份。|閱讀資料無法儲存，請匯出備份。|閱讀資料無法儲存，請匯出備份。|Reading data cannot be saved. Export a reading backup.|読書データを保存できません。バックアップしてください。|독서 데이터를 저장할 수 없습니다. 백업을 내보내세요.",
    searchBooks:
      "搜索书名、作者|搜尋書名、作者|搜尋書名、作者|Search title or author|書名・著者を検索|제목·저자 검색",
    all: "全部|全部|全部|All|すべて|전체",
    unread: "未读|未讀|未讀|Unread|未読|읽지 않음",
    reading: "在读|閱讀中|閱讀中|Reading|読書中|읽는 중",
    finished: "已读|已讀|已讀|Finished|読了|완독",
    favorites: "收藏|收藏|收藏|Favorites|お気に入り|즐겨찾기",
    favorite:
      "收藏／取消收藏|收藏／取消收藏|收藏／取消收藏|Toggle favorite|お気に入り切替|즐겨찾기 전환",
    recent:
      "最近阅读|最近閱讀|最近閱讀|Recently read|最近読んだ本|최근 읽은 책",
    name: "书名|書名|書名|Title|書名|제목",
    author: "作者|作者|作者|Author|著者|저자",
    progress:
      "阅读进度|閱讀進度|閱讀進度|Reading progress|読書の進捗|독서 진행률",
    covers: "封面视图|封面檢視|封面檢視|Cover view|表紙表示|표지 보기",
    list: "列表视图|清單檢視|清單檢視|List view|一覧表示|목록 보기",
    groups: "分组|群組|群組|Groups|グループ|그룹",
    newGroup: "新建分组|新增群組|新增群組|New group|グループを作成|그룹 만들기",
    deleteGroup:
      "删除当前分组|刪除目前群組|刪除目前群組|Delete selected group|選択グループを削除|선택 그룹 삭제",
    ungrouped: "未分组|未分組|未分組|Ungrouped|未分類|미분류",
    unavailable:
      "待连接|待連接|待連接|Reconnect needed|再接続が必要|재연결 필요",
    continue:
      "继续阅读|繼續閱讀|繼續閱讀|Continue reading|続きを読む|계속 읽기",
    noResults:
      "没有匹配结果|沒有符合結果|沒有符合結果|No matching results|該当する結果なし|검색 결과 없음",
    previous: "上一页|上一頁|上一頁|Previous page|前のページ|이전 페이지",
    next: "下一页|下一頁|下一頁|Next page|次のページ|다음 페이지",
    previousChapter: "上一章|上一章|上一章|Previous chapter|前の章|이전 장",
    nextChapter: "下一章|下一章|下一章|Next chapter|次の章|다음 장",
    back: "返回跳转前|返回跳轉前|返回跳轉前|Back to previous location|移動前に戻る|이전 위치로",
    toc: "目录|目錄|目錄|Contents|目次|목차",
    bookmarks: "书签|書籤|書籤|Bookmarks|しおり|책갈피",
    bookmark:
      "添加书签|新增書籤|新增書籤|Add bookmark|しおりを追加|책갈피 추가",
    notes:
      "划线与笔记|劃線與筆記|劃線與筆記|Highlights & notes|ハイライトとメモ|밑줄과 메모",
    note: "笔记|筆記|筆記|Note|メモ|메모",
    edit: "编辑|編輯|編輯|Edit|編集|편집",
    remove: "删除|刪除|刪除|Delete|削除|삭제",
    copy: "复制选中文字|複製選取文字|複製選取文字|Copy selection|選択をコピー|선택 복사",
    copyFailed:
      "复制失败，可使用 Ctrl/Cmd+C 复制原选区。|複製失敗，可使用 Ctrl/Cmd+C。|複製失敗，可使用 Ctrl/Cmd+C。|Copy failed. Use Ctrl/Cmd+C on the selection.|コピーできません。Ctrl/Cmd+C を使用してください。|복사할 수 없습니다. Ctrl/Cmd+C를 사용하세요.",
    highlight:
      "保存划线／笔记|儲存劃線／筆記|儲存劃線／筆記|Save highlight / note|ハイライト・メモを保存|밑줄·메모 저장",
    color: "划线颜色|劃線顏色|劃線顏色|Highlight color|ハイライトの色|밑줄 색",
    search: "全文搜索|全文搜尋|全文搜尋|Search book|全文検索|본문 검색",
    searching: "搜索中…|搜尋中…|搜尋中…|Searching…|検索中…|검색 중…",
    searchLimit:
      "最多显示 1000 条结果，请缩小搜索范围。|最多顯示 1000 筆，請縮小搜尋範圍。|最多顯示 1000 筆，請縮小搜尋範圍。|Up to 1,000 results. Refine your search.|最大1000件表示。検索を絞ってください。|최대 1,000개 결과. 검색어를 구체화하세요.",
    thumbnails:
      "页面缩略图|頁面縮圖|頁面縮圖|Page thumbnails|ページのサムネイル|페이지 미리 보기",
    settings: "阅读设置|閱讀設定|閱讀設定|Reading settings|読書設定|독서 설정",
    font: "字体|字型|字型|Font|フォント|글꼴",
    serif: "衬线字体|襯線字型|襯線字型|Serif|明朝体|명조체",
    sans: "无衬线字体|無襯線字型|無襯線字型|Sans serif|ゴシック体|고딕체",
    mono: "等宽字体|等寬字型|等寬字型|Monospace|等幅|고정폭",
    fontSize: "字号|字級|字級|Font size|文字サイズ|글자 크기",
    lineHeight: "行距|行距|行距|Line spacing|行間|줄 간격",
    paragraph: "段距|段距|段距|Paragraph spacing|段落間隔|문단 간격",
    margin: "页边距|頁邊距|頁邊距|Page margins|余白|여백",
    width: "阅读宽度|閱讀寬度|閱讀寬度|Reading width|読書幅|읽기 너비",
    flow: "阅读方式|閱讀方式|閱讀方式|Reading mode|読書モード|읽기 방식",
    pages: "分页|分頁|分頁|Paginated|ページ|페이지",
    scroll:
      "连续滚动|連續捲動|連續捲動|Continuous scroll|連続スクロール|연속 스크롤",
    spread: "页面布局|頁面配置|頁面配置|Page layout|ページ配置|페이지 배치",
    single: "单页|單頁|單頁|Single page|単一ページ|한 페이지",
    double: "双页|雙頁|雙頁|Two pages|見開き|두 페이지",
    theme: "配色|配色|配色|Theme|配色|테마",
    light: "浅色|淺色|淺色|Light|ライト|밝게",
    dark: "深色|深色|深色|Dark|ダーク|어둡게",
    sepia: "护眼|護眼|護眼|Sepia|セピア|세피아",
    custom: "自定义|自訂|自訂|Custom|カスタム|사용자 지정",
    background: "背景色|背景色|背景色|Background|背景色|배경색",
    foreground: "文字色|文字色|文字色|Text color|文字色|글자색",
    encoding: "文本编码|文字編碼|文字編碼|Text encoding|文字コード|문자 인코딩",
    auto: "自动|自動|自動|Automatic|自動|자동",
    zoom: "缩放|縮放|縮放|Zoom|拡大率|확대",
    fitWidth: "适应宽度|符合寬度|符合寬度|Fit width|幅に合わせる|너비 맞춤",
    fitPage: "适应页面|符合頁面|符合頁面|Fit page|ページに合わせる|페이지 맞춤",
    rotate: "旋转 90°|旋轉 90°|旋轉 90°|Rotate 90°|90°回転|90° 회전",
    page: "页码|頁碼|頁碼|Page|ページ|페이지",
    password:
      "PDF 打开密码|PDF 開啟密碼|PDF 開啟密碼|PDF password|PDF パスワード|PDF 암호",
    passwordWrong:
      "密码不正确，请重试|密碼錯誤，請重試|密碼錯誤，請重試|Incorrect password. Try again|パスワードが違います|암호가 틀렸습니다",
    save: "保存|儲存|儲存|Save|保存|저장",
    stats: "阅读统计|閱讀統計|閱讀統計|Reading statistics|読書統計|독서 통계",
    minutes: "分钟|分鐘|分鐘|minutes|分|분",
    days: "连续天数|連續天數|連續天數|Day streak|連続日数|연속 일수",
    export:
      "导出阅读备份|匯出閱讀備份|匯出閱讀備份|Export reading backup|読書バックアップ出力|독서 백업 내보내기",
    restore:
      "恢复阅读备份|還原閱讀備份|還原閱讀備份|Restore reading backup|読書バックアップ復元|독서 백업 복원",
    restored:
      "阅读备份已合并，请重新选择书籍文件夹以连接原书。|備份已合併，請重新選擇書籍資料夾。|備份已合併，請重新選擇書籍資料夾。|Backup merged. Select the book folder to reconnect files.|復元しました。本のフォルダーを選択してください。|백업을 병합했습니다. 책 폴더를 다시 선택하세요.",
    restoreFailed:
      "备份格式无效，未导入。|備份格式無效，未匯入。|備份格式無效，未匯入。|Invalid reading backup. Nothing imported.|無効なバックアップです。|잘못된 백업입니다.",
    exportNotes:
      "导出笔记 Markdown|匯出筆記 Markdown|匯出筆記 Markdown|Export notes as Markdown|メモを Markdown 出力|메모 Markdown 내보내기",
    loadFailed:
      "阅读器加载失败，点击重试。|閱讀器載入失敗，點擊重試。|閱讀器載入失敗，點擊重試。|Reader failed to load. Click to retry.|読み込み失敗。再試行してください。|불러오기 실패. 다시 시도하세요.",
    shortcuts:
      "← → 翻页 · Ctrl/Cmd+F 搜索 · Esc 返回书架／日历|← → 翻頁 · Ctrl/Cmd+F 搜尋 · Esc 返回|← → 翻頁 · Ctrl/Cmd+F 搜尋 · Esc 返回|← → turn pages · Ctrl/Cmd+F search · Esc return|← → ページ移動 · Ctrl/Cmd+F 検索 · Esc 戻る|← → 페이지 이동 · Ctrl/Cmd+F 검색 · Esc 돌아가기",
  };
  const languages = ["zh-CN", "zh-TW", "zh-HK", "en", "ja", "ko"];
  return (key) =>
    key === "exit"
      ? WorkTimeApp.i18n.t("copy.11d0241540")
      : rows[key]?.split("|")[
          Math.max(0, languages.indexOf(WorkTimeApp.i18n.language))
        ] || key;
})();

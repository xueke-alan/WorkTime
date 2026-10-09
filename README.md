# 工时记录计算器

双击 `index.html` 即可使用，也可通过 GitHub Pages 在线访问，无需安装或构建。

- 记录上下班、跨日打卡、请假及计划加班，支持批量填写和时间模板。
- 导入 OA 记录，统计工时、平均加班和月度目标。
- 提供月历、年度热力图、天气、节日及下班倒计时。
- 数据保存在当前浏览器，支持 JSON/GZIP 备份与恢复；建议定期导出备份。

推荐使用新版 Edge 或 Chrome。同一浏览器同时打开多个页面时，只有取得写入锁的页面可以保存。

旧版备份请先通过 `tools/convert-backup.html` 转换，再恢复到应用。

维护：使用 Node.js 22.13+，运行 `npm ci`，通过 `npm run check`、`npm run lint` 和 `npm run check:format` 检查代码。GitHub Pages 自动发布，天气由 GitHub Actions 定时更新。测试、截图及历史审计资料仅在本地保留。

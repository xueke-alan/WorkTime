# 日期资讯资料维护

右栏底部的通知、历史、节气节日、农历黄历与选中日期联动。首次打开通知，之后恢复上次所选页签；资料随项目分发，不请求第三方资料接口。历史事件在打开历史页签时按选中月份加载，网站模式请求本站文件，双击模式读取本地文件；加载期间显示提示，失败可重试，不阻塞工时界面启动。日期转换使用中国标准时间对应的公历日期，黄历按当日计算，不提供时辰黄历。

## 文件与资料来源

- `assets/data/calendars.js`：2020–2026 年全国调休安排；metadata 保存覆盖范围、时区、官方通知链接及核查日期。2020 年含春节延期，2022 年含次年元旦跨年日期。资料外暂按周末及七类主要节日当天休息推算，个人日期覆盖仍优先。更新时核对年度原通知和补充通知，保持来源及元信息同步；日历提示依据实际覆盖范围。

- `assets/vendor/lunar.js`：保持本地供应商源码快照，`sources.js`声明版本为 lunar-javascript 1.7.7，许可证位于 `licenses/lunar-javascript.txt`。业务包装支持 1900–2100 年；该范围不是对供应商全部算法的声明。农历、节气、黄历独立于法定工作日规则。
- `assets/data/history/01.js` 至 `12.js`：全年 366 天的中文维基百科事件快照，收录大事记中可解析的事件，不设每日摘选上限，去重后按年份从早到晚排列。2026-10-09 快照共 12,984 条，每日 15–102 条，平均约 35 条。摘要在本地生成时统一转换为简体中文。每条有 ID、年份、摘要、来源名称和具体修订 URL；属于 CC BY-SA 4.0 资料，修改和再分发时保留来源及同许可证要求。无法可靠解析的维基模板等内容会跳过，资料不表示已通过独立史料考证。
- `assets/data/festivals.js`：补充公历、农历及按星期计算的节日。农历闰月不重复普通月份节日；除夕通过次日是否为正月初一判定。
- `assets/data/sources.js`：资料来源、版本及快照日期。历史资料只收录至 2025 年的事件，显示时进一步过滤晚于选中年份的事件。

## 新增和更新数据

历史月份数据以 `MM-DD` 为键，每条格式为 `{id,year,text,sourceUrl,sourceName,sourceDateUrl}`。年份为整数，公元前为负数。使用稳定 ID；同一 ID 后加载的记录覆盖前记录。历史月份包由 `WorkTimeApp.services.dateInfo.loadHistory(date)` 按需加载，不放回 `index.html` 的首屏脚本列表。新增历史条目应更新相应月份包，发布流程会重新计算月份包内容哈希；其他补充包可在 namespace.js 和基础资料之后、资讯模块之前以普通 defer 脚本加载。旧 DateInfoData 全局名不再存在。

节日规则格式为 `{id,name,kind,month,...}`，kind 为 solar（公历，含 day）、lunar（农历，含 day）或 weekday（含 week、weekday，星期日为 0）。相同 ID 后加入的规则覆盖前规则。官方工作日与调休仍由工时核心管理，不通过资讯节日改变。

运行 `node scripts/update-history.cjs` 可重新下载中文维基百科全年日页面，并刷新月份包。脚本使用低频批量请求、有限重试和具体修订链接；下载响应先存入 `.refactor-data-updates/`，完整校验366天、事件字段和来源修订后再替换月份包。`sources.js`的分项版本、覆盖范围、SHA256与日期自动同步；全局updated表示最后一次成功资料更新日期，不表示所有资料同日重新抓取。审阅资料差异后，运行 `npm run check` 验证语法与页面资源。更新需要网络，应用使用不需要。

两种更新脚本均支持 `--dry-run`：仍联网抓取并验证，但只输出暂存文件和日志，不替换正式资料。提交前核对正式文件与下载开始时的哈希，外部修改会使更新停止。写入使用排他锁、同盘临时文件重命名，发生异常时恢复已替换文件。多文件更新不具有操作系统层面的整体原子性，维护期间不要打开应用或同时编辑资料。

进程意外中断后，保留暂存目录、旧文件副本与manifest.json；运行 `node scripts/data-update.cjs --recover <日志中的id>`恢复该次更新前资料。仍运行的更新进程不能恢复；已退出进程的残留锁可由恢复命令解除。恢复前核对当前文件和旧副本哈希，检测外部修改或副本损坏时停止，保留材料供人工处理。此机制针对进程中断，不承诺硬盘故障或断电后的文件系统持久性。暂存目录忽略Git但保留诊断资料，确认更新成功后可自行归档。

## 新增页签

在普通 defer 脚本中调用 `WorkTimeApp.services.dateInfo.register({id,label,icon,getContent})`。id 唯一；label 用于悬停及无障碍名称；icon 支持 history、sun、calendar，未知图标使用 calendar。getContent 接收 YYYY-MM-DD，返回 `{title,rows,events,source,sourceUrl,empty}`：rows 为 `[名称,内容]` 数组，events 沿用历史条目格式；两种可以单独或一起返回。

首次注册脚本置于 date-info.js 与 date-info-ui.js 之间。运行中注册后调用 `WorkTimeApp.ui.dateInfo.refreshTabs()`。通知模块由 UI 适配器注册，保留原通知节点。每次 getContent 的异常仅显示在当前页签，不影响其他页签；内容使用 textContent 渲染，来源只允许 HTTPS 链接。

扩展数量较多时底部标签栏可横向滚动。页签使用方向键、Home、End 切换。切换日历日期后保持当前页签；重新打开页面恢复上次所选页签，保存不可用或页签已移除时回到通知。数据包不进入工时 JSON 备份。

节气节日页按国内节日、节气、国际节日排序。扩展节日规则可加入 `category:'international'` 和 HTTPS `url`；不指定分类时依据本地 `internationalFestivals` 名单分类，其他按国内节日展示。国际节日默认链接到同名中文维基百科页面。`festivalAliases` 用于统一内置节日和补充规则的名称，防止重复。分组数据使用 `sections:[{label,text,rows,links,empty}]`，links 为 `{text,url}` 数组；此页不展示库来源文本，资料来源继续保存在项目内。

历史事件卡片显示纯文字，不逐条提供点击或Tab入口；来源名称及具体修订链接保留在资料包，资料区的来源链接只接受HTTPS。生成脚本使用本地 OpenCC JS 1.4.2（scripts/vendor/opencc-t2cn.cjs）进行繁转简，不需要运行时转换。转换及依赖许可证见 licenses/。

倒计时模块位于 `assets/js/work-countdown.js`，注册 id 为 countdown 的页签。它忽略选中日期，使用应用传入的当前内存状态和实时中国标准时间；不修改工时数据，也不为不工作日启动计时。图标支持 clock。

## 国际节日资料

international-festivals.js 按月日索引，逐一核查中文维基百科全部 366 个日期的“节假日和习俗”段落，收录明确以国际、世界、全球或联合国命名的节日及纪念日。未收录的日期保存空数组，不代表现实中不存在节日。国家专属节日不纳入此包，既有跨国节日及按星期计算规则继续由 festivals.js 提供。

运行 node scripts/update-international-festivals.cjs 重新抓取资料；脚本需要联网，应用运行不需要联网。每条保存稳定 ID、简体名称、简体中文链接、来源名称和维基修订链接，资料遵循 CC BY-SA 4.0。新增条目时保留这些字段，并运行 npm run check 校验。首版核查于 2026-10-01，共 274 条、193 个日期，资料范围由来源内容决定。

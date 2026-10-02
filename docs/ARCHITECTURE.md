# 模块职责与维护契约

本文记录已实施的模块结构、CSS职责与性能重构契约。当前验收结果、性能证据和剩余交付事项见 REFACTOR_PROGRESS.md、DELIVERY_AUDIT.md。

## 离线入口

index.html 使用有序 classic defer 脚本，支持 file://。运行时没有 npm 依赖、打包产物或网络请求要求。Node、Playwright、PostCSS、Prettier、Acorn 仅用于开发与验证。

core.js 保留原 WorkTime 接口名称、返回类型和调用签名；外部 UI、年视图、倒计时和发薪日继续依赖该接口。内部 domain 模块通过闭包及显式依赖解构组织，不能读取 DOM、localStorage 或取得写入锁。

## 业务依赖

| 文件 | 输出 | 职责 | 依赖 |
|---|---|---|---|
| domain/time.js | WorkTimeValues | 日历游标日期键、中国标准时间业务日期/分钟、时间解析与显示 | 无 |
| domain/state.js | WorkState | 默认设置、存储键 | 无 |
| domain/migrations.js | WorkMigrations | 缺失默认值及旧排班标记迁移，保留已有设置 | state |
| assets/data/calendars.js | WorkCalendarData | 2020–2026 调休资料、覆盖范围、官方来源及核查日期 | 无 |
| domain/calendar.js | WorkCalendar | 工作日推算、覆盖日期类型、数据覆盖年份 | time、CalendarData |
| domain/records.js | WorkRecords | 有效记录优先级、完整性、休息扣除、有效工时 | time、calendar |
| domain/statistics.js | WorkStatistics | 月度统计、待录入、累计平均与目标进度 | time、state、calendar、records |
| domain/observations.js | WorkObservations | OA 解析、观察记录合并、导入撤回与历史回放 | time |
| domain/validation.js | WorkValidation | 设置、模板、导入记录和备份规范化校验 | time、state、records |
| core.js | WorkTime | 对原公开接口的兼容装配 | 上述模块 |

Node 测试的 helpers/core-source.cjs 从 index.html 提取 domain 和 core 的实际加载顺序，避免测试使用另一份模块清单。

domain/types.js 提供 State、Settings、Day、OA、ManualRecord、Draft、ImportLog 和 TimeTemplate 的 JSDoc 类型。关键默认状态、记录计算、备份校验和编辑候选函数引用这些契约；当前未启用完整 TypeScript 类型检查，不能把注释当作运行时验证。

## 界面视图

WorkUI 是视图工厂命名空间；各工厂仅实例化一次。presentation 提供日记录标签和 HTML 文本转义后的展示片段，summary 管理统计与目标，calendar 管理月/年视图及动画状态，editor 管理单日字段和候选记录，notifications 管理静态通知及临时反馈。

app 传入 core、element、escape、getState、getView 以及明确的回调。视图不缓存旧 state 对象；恢复备份替换状态后，各次 render 从 getter 获取当前状态。编辑器 formDay 创建候选副本，不直接保存；app 的保存用例决定持久化结果和反馈。ui/elements 提供公共元素查找、转义和图标槽位初始化。

编辑器完整流程回归覆盖旧自定义设置启动、输入规范化与自动保存、模板增删改和填入、来源、重置、恢复后新状态展示及 Shift 批量范围。

## 控制器与平台服务

app.js 承担写者锁/状态初始化、视图构造、命令连接与统一事件绑定；services/bootstrap 管理启动错误边界和清理作用域。先构造全部控制器并收集导出的跨模块命令，再统一 bind，避免初始化顺序导致未连接回调。bind 内有重复绑定保护。临时预览、待恢复数据、模板编辑 ID 与长按定时器留在各自控制器。

| 文件 | 职责 |
|---|---|
| controllers/templates.js | 模板 CRUD、填入与单日/批量模板列表 |
| controllers/settings.js | 设置表单、标准时长预览及设置提交 |
| controllers/backup.js | 备份复制/下载、恢复确认、文件回退与长按 |
| controllers/imports.js | OA 预览/提交/历史/来源、OA 链接与长按 |
| controllers/day-editor.js | 单日输入规范化、自动保存、请假与重置事件 |
| controllers/navigation.js | 月/年导航、日期选择、Shift 范围和批量提交 |
| controllers/dialogs.js | 通用关闭与帮助入口 |
| services/application.js | 集中 State 与导航模型；视图从实时 getter 获取 |
| services/bootstrap.js | 初始化状态、失败提示、逆序清理与退出取消 |
| services/clock.js | 可注入 now 与日期策略，返回独立时间副本 |
| services/clipboard.js | 可注入剪贴板读取/写入，保留权限错误并明确缺失 API |
| services/downloads.js | Blob 下载与对象 URL 的延迟/失败/退出回收 |

控制器通过显式 options 接收 core、element、model、actions 及所需平台服务。状态修改仍通过共享保存用例给出持久化结果，保存失败保留内存改动与导出能力。跨控制器仅导出调用需要的函数；bind/dispose 不混入命令注册表。

pagehide 释放写者锁、取消控制器的解析/长按/完成定时器与动画，并回收尚未释放的下载 URL。已退出的导入/恢复控制器忽略晚到的剪贴板结果，不再提交或打开弹窗。bfcache pageshow 继续刷新取得一致状态。

初始化资源取得后立即注册清理函数，控制器逐个注册；即使后续构造失败，已取得的写入锁、观察器和下载资源仍释放。启动失败显示 alert 并禁用表单操作，保留原始存储。首次揭示页面等待 ready/failed 事件，避免初始化过程中操作未连接的控件。

备份校验错误使用 BackupValidationError，包含 path、userMessage 和带路径的 message；例如 imports[0].records[0].effectiveMinutes。备份界面展示完整路径，普通设置/模板表单使用 userMessage。旧备份缺失的可选字段继续规范化；明确填写的非法时间、非对象记录、重复 ID、稀疏数组项和 OA 修正分钟拒绝恢复。旧 raw-only 导入日志不补造 records，以保留历史解析与回放语义。

业务“今天”、当前年份、待录入的上班时间边界及倒计时统一为中国标准时间（UTC+8）。dateKey/localDate 保留日历游标语义，不能把主机本地中午的日历游标直接换成业务日期转换。businessDate/businessMinutes 用于真实时间戳；历史导入时间戳仍按原值解析。

clock.watch 在中国午夜、页面恢复可见、窗口聚焦及延迟计时器恢复后检查日期，只在日期变化时更新模型与统计/日历/通知。自动跨日保留所选日期、导航月份和未完成输入，不重绘编辑器；“今天”按钮立即读取时钟后导航。pagehide 取消计时器和监听器。三个宿主时区的浏览器验收覆盖跨年、跳过多天与输入保留。

targetPace 的累计口径保留，界面在 remainingDays=0 时显示真实 difference：未达标差额、已达标或超出目标；每日分配显示“-”，避免历史月份错误显示零差额。调休日历提示依据 calendarKnown；不把所有非 2026 年份当作资料缺失。

file:// 离线浏览器验收会检查所有引用的本地资产存在，禁用网络后验证入口、年视图和设置，要求无远程请求、无资产加载失败与页面错误。长按/备份回归覆盖键盘短按、长按不重复动作、剪贴板拒绝、文件恢复及退出后的异步取消。

## 开发检查

维护代码统一由 Prettier 格式化。npm run lint 使用 ESLint flat config，检查未声明引用、重复参数/键、不可达代码等，要求零告警；生成资料和第三方/vendor 代码排除，运行时命名空间作为 classic-script 依赖契约声明。配置方式参照 [ESLint 官方配置文档](https://eslint.org/docs/latest/use/configure/configuration-files)。

开发工具要求 Node 22.13 或更高；当前验证环境为 Node 24.16.0。npm run check 也验证 eslint.config.cjs 的语法。格式、lint 与浏览器测试分别验证不同性质，不能相互替代。

## 数据约束与副作用

- 日期键为 YYYY-MM-DD；有效日期及时间解析由 time.js 集中承担。业务今天与分钟使用businessDate/businessMinutes固定为中国标准时间，由clock提供给UI；localDate/dateKey只用于日历游标的宿主本地正午，不用来推断业务今天。三时区与跨午夜自动化已通过，真实系统休眠等环境检查边界另见MANUAL_ENVIRONMENT_CHECK.md。
- 工时和请假时长用分钟；start/end 为 HH:mm，nextDay 表示跨午夜。effectiveMinutes 为手动修正，可为 null；OA 原始记录拒绝非空修正值。
- actualRecord/effectiveRecord 返回副本；calculate/summary 等计算不写入状态。defaultState 每次创建独立状态。
- applyScheduleDefaults、applyObservation、deleteImport 会修改传入状态。这些写操作在 UI 提交后调用，不能在预览阶段调用。
- validateBackup 返回新规范化状态或抛错；请假上限用规范化后的每日标准工时。不要将未校验输入直接传入存储或恢复。
- imports.js 为 UI 导入生成无副作用计划；acceptedRecords 只提交明确接受的记录。同批重复日期必须显式处理。
- storage.js 承担浏览器存储与写者锁；save 返回 ok/persisted/dirty/error。保存失败的内存修改仍可导出，不能显示成功提示。
- backup.js 承担 JSON/GZIP 编解码与解压大小上限，数据业务校验通过参数传入。

## CSS 规则来源

tokens.css集中根级主题、UI尺度、尺寸、五种字体家族和动画变量，先于base.css/layout.css及组件加载。base承担全局重置、通用工具类、表面与字段默认值；layout承担工作区、页面和页脚的断点布局；styles.css已移除。controls承担普通按钮几何、文字行高、时间/数值输入外观、原生placeholder、焦点及禁用态。editor、dialogs、date-info、summary、calendar各自保留组件布局和断点；旧共享文件中的通知/addBreak等规则已归回所属组件，motion承担动画行为和全部关键帧。组件局部变量仍由组件定义，布局例外必须说明用途并运行样式回归。加载顺序和必要例外见CSS_CONTRACT.md。

年视图日期属于日历组件，普通按钮规则使用 ui-button 标记限定范围。模板名称与模板时间字段保持输入高度，但名称保留普通文字字体。时间输入已移除重复 time-hint 覆盖文字。

scripts/clean-css.cjs 仅删除同选择器、同条件范围、同属性和值及 important 状态的重复声明以及空规则，然后格式化。不合并不同选择器，不重排覆盖，不删除建立层叠顺序的空 layer。使用前后应运行 npm test、npm run test:browser、npm run test:styles。

## 样式验收

tests/fixtures/styles-stage01-contract.json.gz 保存清理前的 66 状态基线，包括 6 宽度与月视图、六周月、年视图、批量、设置、模板、导入、历史、节日、黄历、倒计时。测试固定时间和随机数，比较可见控件的样式与宽高纵坐标。差异写入 docs/style-contract-differences.json。

基线需要 Windows Edge 与项目字体环境。它验证列出的状态，不等于整页像素对比，也不覆盖真实 Windows 系统缩放及浏览器缩放。工具栏专项另覆盖 11 宽度 × 4 DPR、键盘焦点与按下态。基线更新必须说明预期视觉变更；--record 拒绝覆盖已有文件。

当前样式入口合计748状态：整页66、资讯88、统计88、日历154、编辑器/弹窗352。日历响应式修复另有独立夹具，原夹具保留。表单矩阵覆盖16个实际状态×11宽度×2高度，包含全部现有弹窗、单日/批量、非法输入与请假浮层；捕获可见后代和弹窗backdrop。时间输入Esc在行内仍失焦，在原生弹窗内由dialog取消处理；回归检查暂存时间修改后取消不保存。

按钮偏上修复保留旧夹具，通过button-style-change.cjs仅接受统一文字行高和字号补偿产生的精确变化，其余样式仍比较原基线。button-ink.browser.cjs现覆盖24宽度×4 DPR×3类按钮共288组，960次标签测量最大中心偏差约0.622px；历史132组报告保留。普通按钮按实际字号分类：13px使用0.18em，14px以上使用0.07em，其余使用阶段26原生缩放复核后的0.11em；1920px以上支持round的浏览器将普通按钮字号取整，OA保留独立字号比例。补偿不按文字内容变化；图标/点击区域比较针对同一字号下文字补偿前后，不能据此声称旧大屏字体取整前后所有几何都相同。新增报告为button-font-profile-review.json及button-font-profile-summary.json。

## 派生值和来源索引

WorkTime仍为无缓存的纯业务门面。WorkDerived由app注入当前state、model.revision和时钟，向视图/控制器提供同签名计算接口；不改变JSON备份。每次actions.save在存储尝试前增加revision，所以失败写入也使旧派生值失效。恢复state、替换days/settings引用自动失效。后续新增数据写入必须经过同一提交入口；不要在原对象上修改后绕过save直接渲染。

派生Map最多128项，版本改变时清空。月份索引按版本惰性构建，范围State只保留相关日记录，并保留原Object.entries顺序，避免改变浮点累计结果。summary与targetPace共享同范围汇总，日历/统计共享pending计数与累计值；pending的键包含业务日期和上班前后状态。临时endDay不缓存，编辑器累计先复用此前日期的值，再单算预览当天；其他临时state/day/settings直接调用参考核心。派生对象视为只读，不写回业务State。

WorkImportIndex按不可变ImportLog对象缓存描述，用WeakMap避免长期持有已删除日志。已创建日志的year/sources/records应保持不变，若修改则替换日志对象；新增、删除、排序或恢复日志时，日期到日志索引根据对象序列重新建立。rawDates用于历史日期范围和来源查看，可能包含被拒绝冲突的日期；acceptedDates只来自显式records，[]表示没有已接受记录，legacy标明raw-only日志。来源索引不接管deleteImport或importRecords，拒绝项不会因展示索引参与回放。

最终集中验证需覆盖失败保存、恢复、设置、请假、删除导入、月份切换、开工前后/跨日、草稿预览与全量参考的等价性，并重新比较性能。实现期间只运行针对性检查，不将历史全量结果当作新代码已验收。

## 视图增量更新

统计卡片为常驻节点，组件用WeakMap保存自己提交的原始markup。字形测量和数字动画会增强实际DOM，因此比较原始输出，不能以增强后的innerHTML是否等于模板判断变化。目标区先构建完整显示模型，再提交变更，保留原目标口径与历史差额语义。

日历同样保存原始输出，以日期/相邻日期/年月份为键复用直接子节点。按钮保留身份，仅更改组件拥有的属性和变化的内部内容；组件没有变化时保留字形增强结果。渲染依然覆盖计算上相关的所有日期，如请假影响累计平均、设置影响全月计算、年历热力图尺度变化；年历内部按月份更新，不承诺所有年历日期单独增量刷新。不能绕过视图所有者直接替换calendar/cards子树，否则缓存与实际DOM可能失去一致性。

SummaryNumbers只处理本轮新提交的原始文字，已包装的未变化数字不修改上一值，也不重播动画。所有新数字轨道先写入，再集中读取实际行高，最后集中写动画变量；初始化暂停的动画先收集再暂停，避免逐卡片写后读布局。集中验收须验证正常/减少动画、月份与年视图转换、批量/选择状态、键盘焦点、所有旧计算样式夹具和对齐测量流程。

单日控制器在校验草稿和刷新预览后比较候选日与原日的可持久化内容。内容相同且上次保存成功时不再调用save、增加revision或重建统计/月历；失败/只读状态仍走正常保存路径，相同输入可以再次尝试保存，错误按本次结果更新。该规则不用于跳过实际数据变化，也不合并多个不同输入事件。

日期字形的128项缓存之外，仅惰性保留一张离屏栅格画布；复用前清空并设置确定变换，按DPR调整尺寸。二维上下文标记willReadFrequently供浏览器优化像素回读，不缓存像素数组；dispose清空画布尺寸并释放引用。文字/日期结果缓存及字体加载失效边界保持原契约。

启动揭示的两个RAF与数字揭示定时器由startup.js保留句柄；pagehide或worktime:failed时取消，fonts.ready及初始化事件迟到均受disposed守卫约束。退出也解除等待事件监听；不会在页面销毁后继续调用文字校准或数字揭示。

最后编辑预览把累计/单日/入职说明组合后一次按需写入；同值保留DOM，错误清空缓存并在合法输入恢复时重建。计算/候选校验每次仍执行，不缓存持久化状态或忽略失败重试。

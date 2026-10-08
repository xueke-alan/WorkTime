# 模块职责与维护契约

维护说明：文中历史阶段的测量报告和快照只在本地或 Git 历史保留，不随当前源码分发，也不作为当前版本通过检查的证明。现行样式与测量方法分别见 CSS_CONTRACT.md 和 PERFORMANCE_CONTRACT.md。主页面和独立转换页都必须在 domain/calendar.js 之前加载 assets/data/major-festivals.js。

本文记录已实施的模块结构、CSS职责与性能重构契约。本轮验收证据与剩余范围见REFACTOR_EXECUTION_2026-10-04.md；旧REFACTOR_PROGRESS.md、DELIVERY_AUDIT.md保留为历史记录。

## 离线入口

index.html 使用有序 classic defer 脚本，支持 file://。运行时没有 npm 依赖、打包产物或网络请求要求。Node、Playwright、PostCSS、Prettier、Acorn 仅用于开发与验证。

namespace.js在有序脚本之前声明唯一项目命名空间WorkTimeApp。领域与发薪日规则发布到domain，应用和平台服务、天气及日期信息发布到services，视图/控制器工厂、数字/年视图、主题/动效、天气/日期界面与对齐发布到ui，日历/奋斗日/城市/日期资料发布到data；不保留对应旧全局别名。领域函数不能读取DOM、localStorage或取得写入锁。旧core.js已删除，启动装配直接引用模块并按消费者所需函数注入，派生服务只返回缓存查询，不转发完整领域对象。第三方lunar库保持供应商自身接口，不纳入项目导出。

## 业务依赖

| 文件 | 输出 | 职责 | 依赖 |
|---|---|---|---|
| domain/time.js | WorkTimeApp.domain.time | 日历游标日期键、中国标准时间业务日期/分钟、时间解析与显示 | 无 |
| domain/state.js | WorkTimeApp.domain.state | 默认设置、存储键 | 无 |
| tools/legacy-v2.js、convert-backup.js | WorkBackupConversion | 独立离线转换 schema 1/2 备份，不由主入口加载 | 旧规则快照及新版校验 |
| assets/data/calendars.js | WorkTimeApp.data.calendars | 2020–2026 调休资料、覆盖范围、官方来源及核查日期 | namespace |
| domain/calendar.js | WorkTimeApp.domain.calendar | 工作日推算、覆盖日期类型、数据覆盖年份 | time、data.calendars、data.struggleDays |
| domain/records.js | WorkTimeApp.domain.records | 有效记录优先级、完整性、休息扣除、有效工时 | time、calendar |
| domain/schedule.js | WorkTimeApp.domain.schedule | 排班校验、日期区间选择、切割与合并 | time、records |
| domain/statistics.js | WorkTimeApp.domain.statistics | 月度统计、待录入、累计平均与目标进度 | time、state、calendar、records、schedule |
| domain/observations.js | WorkTimeApp.domain.observations | OA 解析、观察记录合并、导入撤回与历史回放 | time |
| domain/validation.js | WorkTimeApp.domain.validation | 设置、模板、导入记录和备份规范化校验 | time、state、records、schedule |

scripts/lib/domain-source.cjs从生产入口提取有序纯模块，供性能工具和测试共享；性能夹具不依赖测试目录。测试辅助模块在隔离VM中建立DomainTest便于断言，不进入生产入口。离线入口检查确认旧WorkTime及DomainTest均不存在。离线转换页也显式加载namespace.js。

转换专用WorkLegacyV2仅提供validate/acceptedRecords，不再携带无调用者的统计、日历、迁移或编辑门面。保留的命名函数和完整旧校验模块与精简前AST一致；转换编排仍调用新版validateBackup。完整旧实现仅保存在tests/fixtures/legacy-oracle-2026-10-04.js.gz，解压前后均校验来源哈希，测试VM将其绑定为FrozenLegacyOracle以比较计算/撤回结果。日历资料沿用测试环境来源；冻结范围是旧算法源码。生产页面不加载此夹具。

发布缓存版本覆盖index.html与tools/convert-backup.html两入口，按各HTML所在位置解析共享/本地依赖，在站点根目录边界内读取并添加16位内容SHA。远程/内联资源和页面导航不改，资源fragment保留；两页依赖全部预检后才写发布副本。converter-cache浏览器对照实际复现未版本化旧门面与新转换器混用失败，并验证内容版本修复和原存储保留，source离线页面不被发布工具改写。

namespace-contract测试从实际HTML读取全部项目脚本，通过AST核验只有一个项目顶层声明、无分离模块全局、无旧门面且无重复加载。日期生成器及其原子更新/恢复验证使用同一data.dateInfo结构。城市资料以weather-locations.json为权威，sync-weather-cities支持--check只验证不写入；正式一致性测试核对输出及原始字节保持，部署核心单元门禁会执行它。

domain/types.js 提供 State、Settings、Day、OA、ManualRecord、Draft、ImportLog 和 TimeTemplate 的 JSDoc 类型。关键默认状态、记录计算、备份校验和编辑候选函数引用这些契约；当前未启用完整 TypeScript 类型检查，不能把注释当作运行时验证。

## 界面视图

WorkTimeApp.ui保存视图与控制器工厂；启动时各实例只创建一次，拥有副作用的实例负责释放。presentation提供日记录标签和HTML转义后的展示片段，summary管理统计与目标，calendar管理月/年视图及动画状态，editor管理单日字段和候选记录，notifications管理通知与临时反馈。

app 传入 core、element、escape、getState、getView 以及明确的回调。视图不缓存旧 state 对象；恢复备份替换状态后，各次 render 从 getter 获取当前状态。编辑器 formDay 创建候选副本，不直接保存；app 的保存用例决定持久化结果和反馈。ui/elements 提供公共元素查找、转义和图标槽位初始化。

控件类型由HTML或创建它的组件声明。54个静态按钮及普通动态动作显式声明ui-button，icon-only限定图标按钮；日期资讯文本导航使用ui-text-action，主标签使用notification-tab，城市选项使用ui-option。对齐服务只接收已声明的ui-button，不再为任意按钮添加类型。日期文本和主标签退出按钮扫描，由各自CSS直接声明样式；其162组主题/宽度/交互样本、1134个控件的计算样式及几何与替换前完全一致。普通动作的文字层由HTML或组件直接声明，对齐服务不再包装按钮文本；其字号分类及其他单行文字的墨迹测量仍需后续审查，不能据此声称全部布局测量已移除。

编辑器完整流程回归覆盖旧自定义设置启动、输入规范化与自动保存、模板增删改和填入、来源、重置、恢复后新状态展示及 Shift 批量范围。

## 控制器与平台服务

app.js 承担写者锁/状态初始化、视图构造、命令连接与统一事件绑定；services/bootstrap 管理启动错误边界和清理作用域。先构造全部控制器并收集导出的跨模块命令，再统一 bind，避免初始化顺序导致未连接回调。bind 内有重复绑定保护。临时预览、待恢复数据、模板编辑 ID 与长按定时器留在各自控制器。

| 文件 | 职责 |
|---|---|
| controllers/templates.js | 模板 CRUD、填入与单日/批量模板列表 |
| controllers/settings.js | 设置表单、标准时长预览及设置提交 |
| controllers/personal-settings.js | 个人信息、城市选择及个人提交，不管理排班草稿 |
| controllers/backup.js | 备份复制/下载、恢复确认、文件回退与长按 |
| controllers/imports.js | OA 预览/提交/历史/来源、OA 链接与长按 |
| controllers/day-editor.js | 单日输入规范化、自动保存、请假与重置事件 |
| controllers/navigation.js | 月/年导航、日期选择、Shift 范围和批量提交 |
| controllers/dialogs.js | 通用关闭与帮助入口 |
| services/application.js | 集中 State 与导航模型；视图从实时 getter 获取 |
| domain/preferences.js | 六种主题的单一标识、名称和颜色来源；备份验证与界面共用 |
| services/preferences.js | 独立偏好状态所有者、冻结快照、保存结果、外部同步与生命周期 |
| services/bootstrap.js | 初始化状态、失败提示、逆序清理与退出取消 |
| services/clock.js | 可注入 now 与日期策略，返回独立时间副本 |
| services/clipboard.js | 可注入剪贴板读取/写入，保留权限错误并明确缺失 API |
| services/downloads.js | 应用和独立转换页共用Blob下载，统一取消定时器及对象URL的延迟/失败/退出回收 |

控制器通过显式 options 接收 core、element、只读业务状态和导航 model、界面 actions 及所需平台服务。正式状态由 services/application 的 createState 独占，递归冻结每次发布的状态；日期、计划标记、重置、模板、批量、导入、删除批次、OA链接、个人与工时设置、排班应用和恢复均调用具体应用操作。每个控制器只收到自身所需操作；不接收持久化适配器。

异步备份/恢复和剪贴板导入捕获本次挂载代次，在await之后和失败提示前核验代次；dispose以及新bind均改变代次，旧结果不能在重挂载后复活。旧finally不解除新请求的按钮锁。释放时恢复按钮与复制状态，当前挂载仍可正常重试。浏览器测试覆盖旧请求迟到和新恢复/导入成功。

应用操作统一返回 changed/applied/persisted/dirty/code/message/error。普通编辑在写入失败时保留会话状态；排班先写入成功才替换有效状态，失败的排班仍属于界面草稿，不计为未保存业务内容。存储失败状态与未保存内容分开管理。无变化且无待重试失败时不写存储、不增加修订号；相同内容重试不使派生缓存失效。storage.save 与允许恢复损坏存储的调用仅存在于应用状态所有者内；入口负责写者锁和外部状态重新读取。

全部控制器使用 ui/elements 的 createEventScope 管理 addEventListener 和事件属性，dispose 移除自身监听并恢复仍属于自身的处理器；作用域重复释放及重新绑定有独立测试。其他组件及异步重挂载的完整生命周期审计仍需完成。跨控制器仅导出调用需要的函数，bind/dispose 不混入命令注册表。

持久化使用 LOCK_UNSUPPORTED、LOCK_BUSY、LOCK_FAILED、LOCK_RELEASED、LOCK_REQUIRED、CORRUPT_STORAGE、EXTERNAL_UPDATE、QUOTA_EXCEEDED、STORAGE_UNAVAILABLE 等稳定错误码。入口不再通过中文字符串判断锁占用。主题由 services/preferences 的独立状态所有者管理，使用 worktime.pageTheme 偏好键，不获取工时写入锁或改写业务记录。主题标识、名称与颜色仅定义于 domain/preferences；备份校验也使用这一来源。

偏好操作发布冻结快照，返回 changed/applied/persisted/dirty/code/message/error；保存失败保留会话主题，错误代码为 PREFERENCE_WRITE_FAILED，相同主题重试不增加修订号，无变化且无失败时不写存储。只读工时窗口仍可独立保存主题。主题组件只渲染颜色与选择器，删除其 read/save/key/current 旧出口；启动释放偏好 storage 监听及呈现订阅。备份通过窄偏好接口读取当前快照，不读取 DOM 或界面组件的当前值；schema3 中的 preferences 是导出/恢复载体，日常偏好以独立存储所有者为准。恢复业务与偏好各自取得保存结果，两者均成功才提示完整恢复。

pagehide 释放写者锁、取消控制器的解析/长按/完成定时器与动画，并回收尚未释放的下载 URL。已退出的导入/恢复控制器忽略晚到的剪贴板结果，不再提交或打开弹窗。bfcache恢复通过启动边界的一次性pageshow动作完整重载，重新取得写入权限，不继续使用已释放的旧实例。

初始化资源取得后立即注册清理函数，控制器逐个注册；即使后续构造失败，已取得的写入锁、观察器和下载资源仍释放。启动失败显示 alert 并禁用表单操作，保留原始存储。首次揭示页面等待 ready/failed 事件，避免初始化过程中操作未连接的控件。

备份校验错误使用 BackupValidationError，包含 path、userMessage 和带路径的 message；例如 imports[0].records[0].effectiveMinutes。备份界面展示完整路径，普通设置/模板表单使用 userMessage。运行时只接受 schema 3；旧版本返回 UNSUPPORTED_VERSION 并提示独立转换页面。非法时间、非对象记录、重复 ID、稀疏数组项和 OA 修正分钟拒绝恢复。新版导入日志必须包含实际接受的 records，空数组不会从原文重建。

业务“今天”、当前年份、待录入的上班时间边界及倒计时统一为中国标准时间（UTC+8）。dateKey/localDate 保留日历游标语义，不能把主机本地中午的日历游标直接换成业务日期转换。businessDate/businessMinutes 必须接收显式Date；oaStaleness接收显式业务日期，pendingWorkdays同时接收业务日期和时间戳。当前时刻由services/clock或derived的可注入now提供，领域不使用无参数new Date或Date.now。历史导入时间戳仍按原值解析。

导入合并返回WorkImportMergeCode：ADDED、DUPLICATE、KEEP_COMPLETE、COMPLETE_CONFLICT、COMPLETED、KEEP_START、UPDATED。对象身份和冲突策略保持原契约，领域不返回中文动作字符串；冲突选择和说明由导入界面呈现。schema3的每份导入日志必须显式包含接受记录数组，类型标注与运行校验一致。

批量反推下班时间由领域 records.endForDuration(start, targetMinutes, schedule) 计算，返回最早达到有效工时的 {end,nextDay}，无法在严格小于24小时的范围内达到目标时返回 null。重复与重叠休息按 duration 的区间并集扣除，跨午夜计入次日休息。控制器负责选中日期作息一致性、输入校验、小时转分钟及结果文案；同日标准排班推断 inferWorkEnd 保留原有独立边界，不混用两种用途。

records.editedDay(old, input) 接收已校验的时钟、次日标志和请假分钟，构造独立编辑候选。OA原文及对象保留；原OA时间未变且没有手工层时清除草稿；补齐待录入OA的下班时间形成estimate，改变OA上班时间或覆盖完整OA形成actual；未完成输入形成draft，空输入无OA时清除手工层。界面负责输入单位转换、外部表单校验和预览，不再自行实现记录层之间的转换。候选只在应用操作接受后进入正式状态。日历发薪日通过启动入口注入的payday函数查询，视图不直接取得整个领域命名空间。

time.employmentDay(employmentDate, selected)以UTC日期键计算入职天数，返回独立{started,days}或无效日期的null。当日为入职第1天，未来入职为相距的自然日数；跨月/年/闰日及宿主夏令时均不改变自然日口径。编辑器仅据started选择文案并把days交给数字组件，不再自行做日期差计算，也不额外读取当前时间。

年视图更新同一年份内的记录时，以data-year-date保留日期按钮和原文字层，更新颜色、无障碍描述及月份汇总；不通过重建整个月份替换键盘焦点。相同内容不改节点或重播动画；切换年份则完整切换日期结构，包括闰日。年视图和月视图分别按自己的固定结构更新，不引入通用DOM差分框架。

天气详情每次刷新保留原预报标签页或预报面板的焦点 ID，包括加载中、成功和失败通知；恢复焦点时禁止滚动跳转。天气数据更新不能把“五天预报”的焦点改成“12小时预报”。

天气预报范围标签显式使用ui-text-action，字体、文字行和布局由weather.css管理，退出普通ui-button固定高度/字号和对齐字号分类。原外观所需的inline-flex、字重及间距直接声明，不再使用九条important抵消普通控件规则；方向键/Home/End、roving tabindex和刷新焦点契约保留。

clock.watch 在中国午夜、页面恢复可见、窗口聚焦及延迟计时器恢复后检查日期，只在日期变化时更新模型与统计/日历/通知。自动跨日保留所选日期、导航月份和未完成输入，不重绘编辑器；“今天”按钮立即读取时钟后导航。pagehide 取消计时器和监听器。三个宿主时区的浏览器验收覆盖跨年、跳过多天与输入保留。

targetPace 的累计口径保留，界面在 remainingDays=0 时显示真实 difference：未达标差额、已达标或超出目标；每日目标显示 `0.0`，以保持数字动画契约。按用户追加要求，平均加班缺失时在汇总卡片显示 `0.000 h`、编辑预览显示 `0.00 h`；非零值分别保持三位、两位小数，不省略末尾零，以稳定数字动画位数。此零值仅用于界面展示，领域计算的缺失值仍为 `null`，不能写回为真实零值。调休日历提示依据 calendarKnown；不把所有非 2026 年份当作资料缺失。

启动边界统一管理页面退出和浏览器往返缓存恢复：正常退出或初始化失败时移除退出监听并释放全部应用组件；只有 `pagehide.persisted=true` 时，在释放后安装一个不引用应用状态的一次性 `pageshow` 刷新动作。恢复时先移除该动作，再完整刷新页面重新获取写入权限。组装入口不再保留匿名恢复监听器，不能在销毁后继续使用缓存中的旧应用实例。

file:// 离线浏览器验收会检查所有引用的本地资产存在，禁用网络后验证入口、年视图和设置，要求无远程请求、无资产加载失败与页面错误。长按/备份回归覆盖键盘短按、长按不重复动作、剪贴板拒绝、文件恢复及退出后的异步取消。

## 开发检查

维护代码统一由 Prettier 格式化。npm run lint 使用 ESLint flat config，检查未声明引用、重复参数/键、不可达代码等，要求零告警；生成资料和第三方/vendor 代码排除，运行时命名空间作为 classic-script 依赖契约声明。配置方式参照 [ESLint 官方配置文档](https://eslint.org/docs/latest/use/configure/configuration-files)。

开发工具要求 Node 22.13 或更高；当前验证环境为 Node 24.16.0。npm run check 也验证 eslint.config.cjs 的语法。格式、lint 与浏览器测试分别验证不同性质，不能相互替代。

## 数据约束与副作用

- 日期键为 YYYY-MM-DD；有效日期及时间解析由 time.js 集中承担。业务今天与分钟使用businessDate/businessMinutes固定为中国标准时间，由clock提供给UI；localDate/dateKey只用于日历游标的宿主本地正午，不用来推断业务今天。三时区与跨午夜自动化已通过，真实系统休眠等环境检查边界另见MANUAL_ENVIRONMENT_CHECK.md。
- 工时和请假时长用分钟；start/end 为 HH:mm，nextDay 表示跨午夜。effectiveMinutes 为手动修正，可为 null；OA 原始记录拒绝非空修正值。
- actualRecord/effectiveRecord 返回副本；calculate/summary 等计算不写入状态。defaultState 每次创建独立状态。
- applyObservation、deleteImport 会修改传入候选状态。这些写操作由应用所有者调用，不能在预览阶段调用；启动不再迁移旧数据。
- validateBackup 返回新规范化状态或抛错；请假上限用规范化后的每日标准工时。不要将未校验输入直接传入存储或恢复。
- imports.js 为 UI 导入生成无副作用计划；acceptedRecords 只提交明确接受的记录。同批重复日期必须显式处理。
- storage.js 承担浏览器存储与写者锁；save 返回 ok/persisted/dirty/error。保存失败的内存修改仍可导出，不能显示成功提示。
- backup.js 承担 JSON/GZIP 编解码与解压大小上限，数据业务校验通过参数传入。

## CSS 规则来源

tokens.css集中根级主题、UI尺度、尺寸、五种字体家族和动画变量，先于base.css/layout.css及组件加载。base承担全局重置、通用工具类、表面与字段默认值；layout承担工作区、页面和页脚的断点布局；styles.css已移除。controls承担普通按钮几何、文字行高、时间/数值输入外观、原生placeholder、焦点及禁用态。editor、dialogs、date-info、summary、calendar各自保留组件布局和断点；旧共享文件中的通知/addBreak等规则已归回所属组件，motion承担动画行为和全部关键帧。组件局部变量仍由组件定义，布局例外必须说明用途并运行样式回归。加载顺序和必要例外见CSS_CONTRACT.md。

年视图日期属于日历组件，普通按钮规则使用 ui-button 标记限定范围。模板名称与模板时间字段保持输入高度，但名称保留普通文字字体。时间输入已移除重复 time-hint 覆盖文字。

scripts/clean-css.cjs的默认命令只删除同选择器、同条件范围、同属性和值及important状态的重复声明和空规则，然后格式化，不删除建立层叠顺序的空layer。显式导出的pruneShadowed只在相同选择器/条件/优先级且支持的同属性值间删除被后置覆盖声明；consolidateAdjacent只合并相邻且相同的选择器或media/supports/container条件，不跨中间规则重排，关键帧及匿名layer隔离。跨选择器删除由单独逐条证明管理。使用前后应运行业务、浏览器及严格样式检查。

## 样式验收

tests/fixtures/styles-stage01-contract.json.gz 保存历史清理前的66状态基线。当前整页比较使用独立冻结的styles-page-2026-10-04.json.gz，包括6宽度与月视图、六周月、年视图、批量、设置、模板、导入、历史、节日、黄历、倒计时。测试固定时间和随机数，比较可见控件的样式与宽高纵坐标。差异写入test-results/style-contract-differences.json，不能写回docs或覆盖参考。

基线需要 Windows Edge 与项目字体环境。它验证列出的状态，不等于整页像素对比，也不覆盖真实 Windows 系统缩放及浏览器缩放。工具栏专项另覆盖 11 宽度 × 4 DPR、键盘焦点与按下态。基线更新必须说明预期视觉变更；--record 拒绝覆盖已有文件。

当前样式入口合计748状态：整页66、资讯88、统计88、日历154、编辑器/弹窗352。日历响应式修复另有独立夹具，原夹具保留。表单矩阵覆盖16个实际状态×11宽度×2高度，包含全部现有弹窗、单日/批量、非法输入与请假浮层；捕获可见后代和弹窗backdrop。时间输入Esc在行内仍失焦，在原生弹窗内由dialog取消处理；回归检查暂存时间修改后取消不保存。

五类当前样式参考保存独立冻结对照与接受依据，原历史夹具保留。正式比较逐属性、逐矩形严格相等，不再使用旧按钮位移助手；无调用者的button-style-change.cjs已移除，其历史来源在保护快照保留。button-ink.browser.cjs现覆盖24宽度×4 DPR×3类按钮共288组，960次标签测量最大中心偏差约0.622px；历史132组报告保留。普通按钮按实际字号分类：13px使用0.18em，14px以上使用0.07em，其余使用阶段26原生缩放复核后的0.11em；1920px以上支持round的浏览器将普通按钮字号取整，OA保留独立字号比例。补偿不按文字内容变化；图标/点击区域比较针对同一字号下文字补偿前后，不能据此声称旧大屏字体取整前后所有几何都相同。新增报告为button-font-profile-review.json及button-font-profile-summary.json。

## 派生值和来源索引

领域模块保持无缓存的纯函数。WorkTimeApp.services.derived由app注入当前state、revision、时钟及其实际调用的领域函数，只发布queries和dispose；界面按实际需要收到查询函数，不再收到完整领域对象。正式会话变化由应用状态所有者增加revision；无变化提交和相同失败重试不增加。普通失败编辑已经应用到会话时仍使旧派生值失效，原子排班保存失败则保持原状态及查询。恢复或替换days/settings引用自动失效，所有正式写入必须经具体应用操作。

派生Map最多128项，版本改变时清空。月份索引按版本惰性构建，范围State只保留相关日记录，并保留原Object.entries顺序，避免改变浮点累计结果。summary与targetPace共享同范围汇总，日历/统计共享pending计数与累计值；pending的键包含业务日期和上班前后状态。默认pending查询只采样一次时钟，由同一时刻推导业务日期，避免两次读取跨过午夜而混用日期和分钟。临时endDay不缓存，编辑器累计先复用此前日期的值，再单算预览当天；其他临时state/day/settings直接调用参考核心。派生对象视为只读，不写回业务State。

WorkTimeApp.services.importIndex仅依赖原文解析函数，按不可变ImportLog对象缓存描述，用WeakMap避免长期持有已删除日志。已创建日志的year/sources/records应保持不变，若修改则替换日志对象；新增、删除、排序或恢复日志时，日期到日志索引根据对象序列重新建立。rawDates用于历史日期范围和来源查看，可能包含被拒绝冲突的日期；acceptedDates只来自显式records，[]表示没有已接受记录。来源索引不接管deleteImport或importRecords，拒绝项不会因展示索引参与回放。

最终集中验证需覆盖失败保存、恢复、设置、请假、删除导入、月份切换、开工前后/跨日、草稿预览与全量参考的等价性，并重新比较性能。实现期间只运行针对性检查，不将历史全量结果当作新代码已验收。

## 视图增量更新

统计卡片为常驻节点，组件用WeakMap保存自己提交的原始markup。字形测量和数字动画会增强实际DOM，因此比较原始输出，不能以增强后的innerHTML是否等于模板判断变化。目标区先构建完整显示模型，再提交变更，保留原目标口径与历史差额语义。

日历同样保存原始输出，以日期/相邻日期/年月份为键复用直接子节点。按钮保留身份，仅更改组件拥有的属性和变化的内部内容；组件没有变化时保留字形增强结果。渲染依然覆盖计算上相关的所有日期，如请假影响累计平均、设置影响全月计算、年历热力图尺度变化；年历内部按月份更新，不承诺所有年历日期单独增量刷新。不能绕过视图所有者直接替换calendar/cards子树，否则缓存与实际DOM可能失去一致性。

WorkTimeApp.ui.numbers.set直接接收数值或null，以及小数位、单位、后缀和缺失值格式；汇总、目标、月份标题与编辑预览分别提交数值，不扫描或解析页面文字。同一元素的显示值和单位没有变化时不修改DOM或重播动画。组件管理上一个数值、必要的轨道行高测量、动画完成后的单行归位和减少动态效果；dispose释放动画与媒体查询监听。四个编辑预览数字使用明确历史键（expectedHours/workedHours/previewAverage/employmentDays），入职字段按个人设置条件呈现，其他数值按元素保存。集中验收仍须覆盖正常/减少动画、月份与年视图转换、键盘焦点、计算样式与视觉对比。

汇总/目标调用显式传入alignInk，由数字组件创建缺失值span和单位small并声明data-number-ink；编辑预览保持自身数字结构。对齐脚本只测量已声明的汇总文字层，不再扫描metric/target容器的子节点、包裹直接文本或推断叶节点。文字层及数字轨道均由数字组件拥有，同值调用保留节点。

对齐服务提供幂等mount/dispose。重挂载恢复观察器、窗口/字体事件及当前可见页面的一次测量；释放取消待执行帧、解除监听并清空测量缓存。三轮重挂载分别验证文字变化和resize仅各执行一轮测量，释放后不响应文字、resize或字体事件。应用启动失败状态不重新挂载。

字段错误由ui.fieldErrors用WeakMap保存错误类型和错误对象，与呈现文案分离。UNSAVED表示当前已应用但未保存的提示，VALIDATION表示输入错误；重试持久化成功只清除UNSAVED。日编辑、排班设置和个人设置各提供onSaveRecovered清理自己的字段，启动入口不枚举字段或匹配中文文案。请假面板关闭时只同步清除同一错误对象，不因两个不同错误文案相同而误清；所有相关清空路径同时释放对应错误状态。

数字、公共动效和粒子背景提供幂等mount/dispose；默认首次加载自动挂载，显式释放后可重新订阅媒体查询及页面事件。释放取消数字动画处理器、动效定时器和背景帧，清空数字历史与背景点；重新挂载按当前减少动画偏好恢复。天气详情的mount维护可见性恢复监听，render会重新挂载并释放旧视图事件；点击、键盘、滚动和滚轮使用所属视图的AbortSignal，替换或dispose后旧节点不能继续改变预报模式，所属视图动效也停止。forecastState使用WeakMap保留同一面板的模式/滚动选择，不把交互记忆当作活动监听。

单日控制器在校验草稿和刷新预览后比较候选日与原日的可持久化内容。内容相同且上次保存成功时不再调用save、增加revision或重建统计/月历；失败/只读状态仍走正常保存路径，相同输入可以再次尝试保存，错误按本次结果更新。该规则不用于跳过实际数据变化，也不合并多个不同输入事件。

日期字形的128项缓存之外，仅惰性保留一张离屏栅格画布；复用前清空并设置确定变换，按DPR调整尺寸。二维上下文标记willReadFrequently供浏览器优化像素回读，不缓存像素数组；dispose清空画布尺寸并释放引用。文字/日期结果缓存及字体加载失效边界保持原契约。

启动揭示的两个RAF与数字揭示定时器由startup.js保留句柄；pagehide或worktime:failed时取消，fonts.ready及初始化事件迟到均受disposed守卫约束。退出也解除等待事件监听；不会在页面销毁后继续调用文字校准或数字揭示。

最后编辑预览把累计/单日/入职说明组合后一次按需写入；同值保留DOM，错误清空缓存并在合法输入恢复时重建。计算/候选校验每次仍执行，不缓存持久化状态或忽略失败重试。

OA左栏导航由ui/sidebar-panels.js独立管理：importDialog/sourceDialog及导入历史列表在HTML直接声明最终位置，以非模态dialog.show()呈现。隐藏前层视图而不close，因此详情返回保留预览和草稿；真实关闭才触发原close清理。open统一入口将两个视图路由到左栏，其余dialog仍用showModal。Escape仅在没有模态弹窗时返回当前侧栏层级；已注册生命周期释放监听。无调用者的importHistoryDialog空壳与隐藏入口已删除。历史原文在sourceDialog的详情视图展示；删除批次仍使用确认弹窗及应用操作。

个人信息与城市选择由personal-settings控制器负责，排班草稿与应用由settings控制器负责；schedule-range组件仅管理区间字段、菜单、日期说明、键盘与焦点，不接收正式状态或保存操作。settings通过open/read与其协作，并负责同步挂载和释放。日期信息区域、通知面板和dateInfoPanel在HTML中静态声明，日期信息组件只管理自己的内容和标签页监听。

天气服务通过subscribe提供共享状态，并按calendar/details两个消费者的需求调度刷新。日历天气组件订阅状态并只拥有日历天气层，天气详情订阅并管理详情面板；关闭详情不停止日历所需刷新。两者分别负责自身图片恢复，日历不使用MutationObserver修补渲染，也不依赖文档天气自定义事件。释放订阅和需求后，服务取消定时器与请求。

天气服务mount/dispose幂等管理三个页面事件。最后一个需求释放时立即中止在途请求、清除20秒超时及周期定时器；退出后城市变更/需求/订阅/迟到响应无副作用。取消未完成请求会解除该次尝试的刷新节流，重新挂载并启用需求后可重新请求；正常已完成缓存保留既有刷新间隔。没有消费者时仅选择城市不触发自动请求。

## 日期作息

WorkTimeApp.domain.schedule 在 records 后、statistics 前加载，提供 scheduleForDate、applyScheduleRange、validateSchedule、validateScheduleRanges、scheduleSignature 与 scheduleRangeForChoice。settings 保存基础作息及工时规则，personal 保存个人资料，preferences 保存主题；scheduleRanges 保存有序不重叠的最终区间。结束日期 null 表示持续生效；替换先切分原区间再合并相同相邻区间，不保存隐藏的覆盖层。

运行时 validateBackup 仅接受版本3，历史版本通过独立离线工具转换；所有记录按其所属日期校验请假上限。统计缓存包括逐日折算出勤及候选单日预览；保存作息调用应用所有者的原子操作，持久化成功后才替换正式状态并递增 revision。设置控制器管理作息草稿和离开保护，个人信息控制器管理资料输入，日期区间组件管理范围交互。

## 通知与日期资讯生命周期

存储界面由ui/storage-status拥有：按原UTF-16估算显示B/KB/MB占用，管理业务存储事件、初始/写入/重试提示和重试按钮；mount/dispose限制为一个监听，并用挂载代次阻止异步重试在释放后重启按钮。该组件不写入业务状态。services/save-session独立保存最近成功持久化快照，管理锁交接和恢复；只有无表单草稿、正式状态未改、非损坏且检测到外部更新时才采用外部状态。恢复结果通过回调更新界面，各控制器恢复自身字段提示；dispose之后锁等待和重试的迟到结果不调用任何界面或状态操作。

ui/workspace协调已有视图的完整刷新、侧栏/模态路由、保存反馈、批量退出和业务日期变化；它只改视图状态，不接收持久化服务。日历页脚与通知栏跨列边界的ResizeObserver由此组件拥有，mount幂等，dispose断开观察并守卫迟到回调；组件不修改子视图结构。domain.time.monthBounds提供月份首尾，domain.state.cloneState提供分离的JSON候选副本；启动入口只装配工厂、依赖、操作结果回调和生命周期释放。

通知视图的mount/dispose管理其创建的反馈节点和四段反馈定时器；释放立即取消计时并移除节点，释放后的toast无副作用。静态通知装饰可重复调用而不嵌套内容。notificationMotion独立管理通知子树观察器、媒体查询监听及Web Animations；重复mount只建立一个观察器，dispose取消全部未完成动画，系统切换为减少动态效果时立即取消动画。

dateInfo.mount/dispose管理主标签和日期子标签的事件、徽标观察器、农历尺寸观察器、天气订阅/详情需求与倒计时。释放后的refreshTabs不重新注册事件；重挂载恢复键盘切换、当前日期和标签，复用日期标题节点。连续三次挂载/释放验证订阅最多一个、每秒倒计时只更新一次、释放后不更新且不响应旧事件。

备份控制器重挂载时复用损坏存储导出按钮，事件作用域仅重绑定当前处理器；释放后按钮不触发下载。三轮验证节点数量始终为1、原始字节逐字保留、每次挂载点击仅下载一次。

图标同步固定Google仓库提交737e3324305806514d7909874fa1818ae1808232。下载全部完成并验证viewBox及单一路径内容后才替换页面和清单；同目录临时文件通过rename替换，第二个文件失败时恢复第一个。--check只核对固定来源的完整输出，不写文件。42项路径哈希及viewBox与重构前资源一致；Apache许可证和逐项来源保留。

两个百科资料生成器共享scripts/lib/wiki-source.cjs的366日标题、引用/注释清理及批量请求，保留各自的事件/节日解析和筛选。请求固定四次尝试、40秒超时和3/6/9秒退避，非法query.pages响应同样有限重试后失败；完整批次响应仍由原data-update事务捕获，生成和提交机制保持不变。共享工具可注入请求和等待用于离线故障测试；不会因测试执行而联网或更新正式资料。

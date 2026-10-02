# CSS 组件与验证契约

本文记录已实施范围。整体重构计划和剩余事项见 REFACTOR_PLAN.md、REFACTOR_PROGRESS.md；未完成的组件不能因当前回归通过视作完成。

## 加载及职责

index.html 按 tokens.css → base.css → layout.css → editor.css → dialogs.css → date-info.css → summary.css → calendar.css → controls.css → motion.css 加载普通本地样式表，保留 file:// 离线使用。styles.css已移除；通用基础先于布局和组件，原共享文件中残留的组件规则已归回其所有者，保留来源与原media条件。

| 文件 | 已有职责 | 当前维护边界 |
|---|---|---|
| tokens.css | 根级主题、尺寸、字体家族与动画变量 | 组件局部尺寸例外已记录并保留 |
| base.css | 全局重置、字体、共享表面与表单默认值 | 同条件冗余已剪枝，跨组件契约保留 |
| layout.css | 工作区、页面与页脚的断点布局 | Windows100%与正常动画原生浏览器缩放已验收 |
| editor.css | 单日/批量编辑器、请假浮层、模板列表、共享次日开关；已归并字段高度别名及被同条件覆盖的旧声明 | 34px编辑字段和模板子按钮作为已审查例外保留 |
| dialogs.css | 弹窗容器、模板/设置/导入/来源/恢复/OA链接等特有结构；已归并字段高度别名及被同条件覆盖的旧声明 | 设置删除休息段按钮与模板结构作为已审查例外保留 |
| date-info.css | 资讯区域、页签、历史、节日、黄历、倒计时；全部组件断点在此文件 | Windows100%与原生浏览器缩放已验收 |
| summary.css | 统计侧栏、汇总卡片、目标区、数字槽及单位；包括侧栏导入动作 | Windows100%与正常动画原生浏览器缩放已验收 |
| calendar.css | 月历、年历、工具栏、装饰和图例；容器响应式与月历内容滚动 | Windows100%与正常动画原生浏览器缩放已验收 |
| controls.css | 普通表单控件几何、公共字体、时钟/数值输入和焦点 | 组件几何/隐藏/字号例外已审查并列入清单 |
| motion.css | 动画与减少动画偏好 | 生命周期及动态偏好变化已回归验证 |

公共固定几何只用于普通 ui-button，使用 :where(:not(.notification-tab)) 排除页签且不提高特异性。不要换成普通 :not()：增加的特异性会让组合备份按钮和模板子按钮的必要尺寸例外失效。页签由组件管理并随 footer 行拉伸；普通按钮文字使用 .button-label 的公共字体/行高。

## 日期资讯组件

从原样式迁入140条规则，包含两条共享分组选项中属于资讯的分支；保留各条原始相对顺序和 media/container 条件。源位置及共享分支记录于 date-info-css-migration.json。迁移后删除43个同选择器、条件、属性和优先级下被后续支持值覆盖的旧声明，详情见 date-info-css-pruning.json。支持核验来自本机 Edge 154.0.4258.48 的 CSS.supports，不能解释为所有浏览器的证明。

HTML 与 date-info-ui.js 不再产生通知内嵌页签、almanac-month/day/seal 或资讯 h3；清理15条相关旧规则，详情见 date-info-css-obsolete.json。88个组件场景检查这些旧结构没有重新出现。以后扩展资料仍应使用 provider 数据契约，而不是依赖已删除的 DOM 类名。

date-info.css 保留一处 important：#dateInfoPanel[hidden] 必须覆盖组件 display，即使组件后续使用 flex/grid 也不能显示已隐藏面板。页签的六个尺寸/圆角覆盖已通过公共控件作用范围调整移除。不要机械删除其他文件的 important；每组都应核对实际胜出规则和状态。

资料行标签与正文使用 overflow-wrap:anywhere，固定标签列不会因长英文单词撑出横向滚动。390px场景的长标签曾溢出188px，新增场景验证修复后内部 scrollWidth 不超过 clientWidth+1px。

## 验证入口及限制

统计组件迁移361条规则（含4个共享分支），补齐侧栏导入按钮自身规则以保留窄屏16px剪贴板图标。使用支持谓词清理94个被覆盖声明，删除43组涉及旧rangebar/forecast/target-metric-row的选择器分支；保留混合分组中仍有效的分支。记录见 summary-css-migration/pruning/obsolete.json。组件当前295条规则、684个声明，无important；有效数字槽与单位布局保留。

统计矩阵为11宽度×2高度（700/1000）×4数据状态（空、完整记录、未配置、历史月份），共88场景。每个可见后代与侧栏根节点都记录样式和相对位置；另使用有效修正分钟上界2880及1分钟请假产生高精度折算出勤，检查数字与标签无碰撞。手机/桌面截图使用人工构造的边界数据，不是实际工时记录。

npm run test:styles 顺序运行66个整页控件状态、88个资讯组件状态、88个统计状态、154个日历状态与352个编辑器/弹窗状态，共748场景。资讯矩阵为11宽度（390/540/699/850/1150/1151/1300/1301/1600/1800/1920）×2高度（700/1000）×4页签（历史/节日/黄历/倒计时）。记录容器及可见后代的字体、颜色、边框、几何、滚动和相对位置；另验证方向键/Home、focus-visible、通知隐藏和中英文长文本。

四份 gzip 夹具分别为 tests/fixtures/styles-stage01-contract.json.gz、styles-date-info-contract.json.gz、styles-summary-contract.json.gz、styles-calendar-contract.json.gz，record 模式拒绝覆盖已有基线。差异文件为 docs/style-contract-differences.json、date-info-style-differences.json、summary-style-differences.json、calendar-style-differences.json。控件工具栏另外覆盖11宽度×4DPR，仍不代表实际 Windows 或浏览器缩放。

计算样式与位置回归可以识别级联变化，不能替代整页像素检查。环境固定为 Windows Edge、既有字体、固定日期和减少动画；真实缩放、正常动画及其余组件矩阵仍需完成。

## 日历组件与窄屏缺陷

迁入314条规则，包含两条共享选择器分支。分类时排除 :not() 中的类名，避免把普通按钮排除条件误认成日历所有权。经 Edge CSS.supports 核验841个声明值，清理45个被覆盖声明；删除 .day.blank、.dot.pending、.dot.rest 三组废弃结构，保留年历 .year-day.blank。源位置、条件及清理记录见 calendar-css-migration/pruning/obsolete.json。

年历排除普通按钮固定几何后，删除8处冗余 important；组合备份按钮保留4处必要的子按钮尺寸例外。迁移清理时calendar.css为296条规则、793个声明、4处 important。

日历矩阵为11宽度×2高度×7状态：四/五/六周月份、节假日装饰、批量选择、普通年和闰年，共154场景。记录组件可见后代、装饰伪元素的样式及几何；补验2024年366天和2月29日键盘选择。迁移前夹具未替换。

**已修复的P2缺陷（修复前证据）：390px月历状态文字被祖先裁切。** 后置 body .workspace .day 的9px内边距覆盖窄屏3px规则，状态标签保持 nowrap，日期格子 overflow:hidden。日期格宽约48.28px，“待录入”标签宽46px，右侧超出日期格约7.70px；请假标签同样受影响。标签自身 scrollWidth 等于 clientWidth，检查自身滚动宽度会漏报。修复前证据见 calendar-clipping-before-390.json；修复后见 calendar-clipping-390.json 与 refactor-calendar-month-390.png；使用人工测试数据。

修复要求：明确窄屏内边距胜出规则，使完整状态文本处于可用宽度内；如改为多行，同步审查 pill-text 的单行字形校正。验收应比较文字/标签与 overflow 裁切祖先的边界，覆盖全部11宽度、四/五/六周和请假/待录入/估算状态，并检查可访问名称、焦点及点击。预期视觉变化须逐项记录，不能重新生成旧基线掩盖差异。396场景零迁移差异不代表旧视觉缺陷已解决。

## 维护工具边界

npm run format:css 仅清理同条件/选择器下完全重复声明、空规则并格式化，不删除不同值的旧声明。clean-css.cjs 的 pruneShadowed 为显式调用接口，必须提供经过核验的支持谓词；自动格式化入口不会调用它。它不跨选择器、条件、重要优先级或匿名层级，不处理关键帧或未知嵌套作用域。空 @layer 仍保留其顺序意义。

匿名 @layer 各有独立级联身份，不能以同一个空名称合并声明。维护工具测试专门覆盖连续 red/blue/red important 的匿名层，防止误删最先且优先级更高的值。任何组件清理后都要运行相应矩阵，再检查整页回归和离线加载。



## 日历响应式修复与基线版本

日历面板使用具名inline-size容器，699px及以下按日历实际可用宽度（包括三栏窄日历）启用小内边距、顶部日期/类型分行和完整状态标签。标签允许换行，文本最小宽度为0，多行pill-text不使用单行字形位移。普通按钮的公共基线不变。月历行高采用minmax(max-content,1fr)，内容过多时在月历内滚动，避免固定等分行高裁掉标签；年历不使用此行高规则。1150px及以下单栏布局另使用auto行高和align-content:start，避免手机空日期格被最大内容行拉伸。部分请假日期的可访问名称补齐具体请假小时。

新增完整性断言比较标签边框及每个文字行矩形与祖先日期格的四个边界，另查标签文字scrollWidth；覆盖154状态中的所有可见状态标签。旧基线仍保留，完整修复后的默认夹具为styles-responsive-contract.json.gz与styles-calendar-responsive-contract.json.gz；资讯和统计继续沿用原夹具。record模式仍拒绝覆盖已有文件。--original仅用于审查历史差异；旧缺陷本来就可能触发完整性断言，不作为现状通过门槛。

新旧夹具逐项差异摘要为calendar-responsive-baseline-review.json：整页28状态有意变化（390/1150/1151px），日历118状态有意变化，主要为内边距、标签行高/换行、内容行高及滚动位置。原年历夹具部分1151/1300px场景存在597px负向滚动位移，新结果恢复顶部；年历字体、颜色与日期格尺寸未改变，699px另有0.001px坐标舍入差异。整页390px六周月份有一处鼠标悬停命中随布局变化，导致原悬停色/边框色不同，未改主题声明。截图和边界断言用于验证修复目标，不能只靠接受新夹具证明正确。

年历浏览器动画测试使用固定日期和受控时钟，初始化/重新加载后推进1000ms，切换后在计时清理前检查动画名称，避免CPU竞争使700ms清理先于断言。仍检查动画真实CSS名称，没有删除断言。



## 编辑器与弹窗组件

editor.css迁入307条规则，dialogs.css迁入182条规则；混合分组按归属拆分并保留有效分支及原media条件。迁移来源和共享分支见editor-css-migration.json、dialogs-css-migration.json。插入在styles.css之后、date-info.css之前，保持原来资讯覆盖表单容器的顺序。公共field/label/two/help等表单基础留在styles.css，普通控件外观留在controls.css。

经本机Edge CSS.supports核验编辑器879个声明、弹窗474个声明，分别清理51与44个同条件/选择器/属性/优先级下被支持值覆盖的旧值。31组废弃选择器清理记录在forms-css-obsolete.json：旧leave-toggle、上传区/文件标签、settings-schedule直接help段落均无当前HTML或JS生产路径；保留混合选择器组中的有效分支。全部表单状态断言旧结构未重新出现。

352场景基线在CSS迁移前创建（Esc行为修复后），16状态×11宽度×2高度：空/完整/非法单日、请假浮层、空/选中批量、设置、新建/编辑模板、导入预览/历史/删除确认、来源、恢复、说明和OA链接。捕获可见后代的字体、颜色、几何、相对位置和弹窗backdrop；验证初始/Tab焦点处于弹窗、Esc关闭，时间字段修改后取消不写入存储。record拒绝覆盖styles-forms-contract.json.gz，差异写入forms-style-differences.json。

实际缺陷修复：全局clock-input键盘处理原来吞掉弹窗时间字段的Esc，只失焦且阻止原生cancel。现在在打开的dialog内让Escape走原生取消；行内输入仍用Esc结束编辑，Enter行为保留。未添加自己的焦点陷阱或替代原生弹窗。

important分类：模板复合按钮的内层高度calc(control-height - 2px)必须覆盖普通按钮固定高度；相邻时间字段的次日开关使用input-height（38px）而非普通button的control-height（34px）；hidden状态覆盖组件display。现有尺寸别名仍有跨选择器冗余，下一步随tokens/基础样式归并处理；不能把剩余57个编辑器/22个弹窗important全部称为必要，也不能凭数量机械删除。统计见css-stage11-counts.json，分组拆分可能增加物理important计数，不代表新增视觉优先级。

手机/桌面编辑器、请假浮层、设置、模板截图已查看。额外测量390px完整入职日期2026-10-02：字宽约81.45px、可用96px，没有横向文本裁切；时间字段同样通过，见forms-text-width-review.json。输入框之外的长模板名可有明确省略显示，不能据此声称所有长文没有截断。
SVG子元素use的矩形比较只容许0.002px舍入误差，外层SVG和HTML几何及全部样式继续精确比较。850px两处0.001px观测保留在forms-svg-rounding-observed.json，未替换表单夹具。

## 按钮文字的实际字形居中

针对用户报告的OA记录、导入弹窗底部、模板保存按钮偏上，检查实际字体基线和Canvas字形边界，而不只检查flex盒子。Windows Edge当前字体栈下，普通12px文字墨迹中心约偏上1.305px。公共标签使用line-height:1.3，并按字号下移0.1em；大屏OA的13px字号基线不同，使用0.18em补偿。OA既有嵌套span接入同一规则。补偿按字体大小而不是按文字内容计算，同排标签保留共同基线，图标、边框和点击区域不移动。通知页签保持组件自己的规则。

tests/button-ink.browser.cjs覆盖3类按钮×11宽度×4 DPR，共132组，检查实际字形中心误差不超过0.85px、同排基线、图标与点击区域完全不变，并保存六张手机/桌面截图及button-ink-review.json。DPR覆盖不代表实际系统缩放验证。

旧视觉夹具未覆盖。tests/helpers/button-style-change.cjs仅接受标签的0.1em位移、OA大屏的0.18em位移，以及原line-height:1统一为1.3造成的文字盒子变化。行高重排的坐标容差限定为1/64px，纯位移仍为0.002px；其他样式和矩形分量必须完全相同。该规则不允许输入框、图标、控件外框或DOM数量变化。已有设置输入框内边距保留，未因本次修复重置。

## 用户要求移除聚焦外圈

2026-10-02根据设置按钮和弹窗关闭按钮截图，统一将焦点outline清零。styles.css、controls.css、calendar.css和date-info.css中的11组焦点轮廓规则已处理，并在controls.css提供全局focus/focus-visible默认值。outline-offset和outline-color的组件例外已移除。具体原始规则见focus-outline-removal.json。

控件继续接收原生键盘焦点。controls.browser.cjs增加设置按钮和弹窗关闭按钮聚焦后outlineWidth为0px的检查，以及Enter打开、Esc关闭流程；截图见focus-outline-close-removed.png与refactor-toolbar.png。页签继续验证方向键/Home及焦点元素。旧资讯夹具保留，仅允许四个日期页签的outlineStyle/outlineWidth清零，其他属性和几何继续精确比较；差异审查见focus-outline-visual-review.json。

## 根级token集中与尺寸别名归并

tokens.css从styles.css、controls.css、motion.css的无条件:root提取53条声明，依原加载顺序保留33个最终定义；删除被永久覆盖的旧主题/固定像素值。根声明均为自定义属性，无important和条件根规则；组件局部变量不迁移。每条旧来源及最终值见tokens-css-migration.json。

action-control-height、toolbar-control-height、compact-control-height只在根级定义且最终恒等于control-height；其消费者改为control-height，三种别名删除。form-control-height和editor-control-height在.panel.editor有34px局部覆盖，不能视为与响应式rem高度恒等，暂保留作为后续尺寸例外审查对象。

token-values-review.json使用同一隔离页面在迁移前后样式间切换，验证11宽度×4高度（700/800/900/1000），对比33个根变量在html/body/workspace/editor/OA按钮/时间输入/设置按钮上的计算值，并精确比较字体、颜色与控件宽高，44组合均一致。该证据补充组件矩阵，不代表真实系统缩放验证。

## 基础/布局与残余组件归属

styles.css剩余规则已迁入base（121组）、layout（40组）、editor（38组）、dialogs（3组）、summary（2组）、motion（5组含3个keyframes）。body字体与表面属于base，body的高度/display/对齐等几何属于layout；共享字段、表格与row/two等工具类仍是base默认值。通知区规则归回editor，addBreak归dialogs，动画/减少动画规则归motion。迁移来源、条件和属性分支见base-layout-css-migration.json。

18个无HTML或渲染生产路径的旧类，包括top/brand、rangebar/forecast、more-menu及旧sidebar-logo/status等，清理71组选择器，保留混合组中有效分支。原生time输入样式随后处理14组（8组完全删除、6组保留number/numeric分支）；当前时钟均使用text.clock-input。整页状态中断言旧结构及input[type=time]不再生成，记录分别为base-layout-css-obsolete.json和native-time-css-obsolete.json。

普通UI、数字输入、黄历、倒计时与反馈环分别使用font-ui/font-numeric/font-almanac/font-countdown/font-feedback，保留原回退链；迁移9处font-family，其中一个原生time分支后来删除。字体迁移后为38个根变量，后续字段高度别名归并后为37个。样式变更不按字串分别校正基线。

Edge154核验2441个声明后，安全剪枝56条被相同选择器/条件/属性/优先级的后续支持值覆盖的声明（base31、layout11、editor13、summary1）。未基于重复次数合并选择器或跨条件删除。支持核验与逐条来源见base-layout-css-pruning.json。

review-css.cjs改为从index.html读取实际CSS加载顺序，对普通标签translate进行原始/补偿测量，结果另存review-css-current-results.json，历史review-css-results.json保留。CSSOM会展开简写属性，其important计数不能直接与PostCSS物理声明数量比较。

## 特殊文字字体指标缓存

ui-alignment.js的Canvas TextMetrics缓存最多512项，日期像素墨迹边界缓存最多128项，命中更新访问顺序，超限淘汰最早项。字体、文本、fontStretch参与键；日期像素边界另含DPR。fonts.loadingdone清空缓存后刷新。普通按钮仍使用共享CSS补偿，不采用每段按钮文字的测量偏移。alignment-cache.browser.cjs验证复用、字体失效、新文本与超过容量后的淘汰。

阶段15缓存检查当时尚未解决局部触发、批量读写与生命周期；这些工作在后续阶段完成，见下节。阶段25原始timeline及实际refresh计量另见性能契约。

button-large-font-review.json保留为阶段15的大屏缺陷证据；该问题在阶段19按实际字号分类修复，覆盖范围扩展至24宽度×4 DPR，见末节。仍不能把DPR矩阵视为真实系统/浏览器缩放。

## 文字测量生命周期

UIAlignment.refresh在disposed、pagehide暂停或document.hidden期间不测量；显式刷新取消先前帧，避免稍后再执行一遍。隐藏/pagehide停止观察和待执行帧，可见/pageshow刷新当前内容。UIAlignment.dispose可重复调用，释放观察器、帧、缓存和事件监听；app退出清理和启动失败路径负责调用。fonts.ready迟到回调受同一disposed守卫约束。

alignment-lifecycle.browser.cjs隔离验证服务的合成页面恢复与可见性分支；实际应用在bfcache恢复后重载，不能将隔离测试当成真实后台或操作系统缩放验证。局部目标筛选与读写批处理已实现，见下节。

## 组件观察与局部更新

深度MutationObserver范围限定为工作区、弹窗与页面页脚；根节点和main.wrap只观察影响整体布局/字体或直接容器替换的属性与子节点。组件变化按最近作用域合并，一帧内收集这些作用域的既有文字目标；全局字体/尺寸及手工refresh仍完整扫描。open/hidden变化也触发检测。alignment-local.browser.cjs验证统计变化不测量日历、无关子树不触发、动态按钮包装和根字体全局刷新，局部对齐值与完整刷新一致。

逐节点probe读写阶段已在后续批处理中拆分；观察范围按组件合并，动画/倒计时仍可能触发所属组件刷新。阶段27实际刷新计量与1/5/10年正式性能结果见PERFORMANCE_FINAL_STAGE27.md。

## 特殊文字批量读写

alignTexts将文字层初始化、字体/换行读取、日期高度/基线探针写入、全部几何读取以及探针清理/偏移应用分为阶段。几何读取期间不逐个插入或移除探针。年历代表节点继续按原文本/字号/字体/字重键复用；换行状态标签不使用单行偏移，普通按钮不进入字形测量。

alignment-batch.browser.cjs验证多节点几何读取连续性及探针清理；alignment-batch-comparison.json保存原实现与候选在四宽度、月历/年历/设置的12场景直接等价比较。后续完整748样式、19浏览器及60次性能采集已完成；性能预算仍以正式报告为准。

批量测量会临时改变文字层和滚动溢出范围；移动端模板输入框聚焦时曾因此产生1px页面滚动漂移。alignTexts记录操作前的viewport，仅在测量期间位置改变时以instant恢复；不移动焦点。alignment-batch.browser.cjs包含真实应用390px模板输入聚焦后显式刷新及5秒计划任务的滚动稳定断言。原失败与复现记录为alignment-batch-style-failure.json（若失败报告保存成功）和alignment-batch-scroll-regression.json；最终66整页场景已恢复零差异，阶段27最终完整748样式矩阵已通过。

## 字段高度同义变量

根级和.panel.editor中form-control-height与editor-control-height都成对恒等；后者已删除，22处消费者改为form-control-height。保留根级跟随control-height及编辑区34px局部覆盖，避免误改编辑区其他响应式普通按钮。14宽度×3高度×月历/设置/模板共126组合在完整CSS切换下精确比较计算样式和控件矩形；field-height-values-review.json保存结果，field-height-migration.json保存定义与引用数量。

此前保留两别名的理由是它们不能直接替换为根control-height；本次将两者互相归并，仍明确保留编辑区尺寸例外。其余跨选择器高度/important已按组件契约审查，保留清单见阶段25最终优先级例外。

## 跨字号公共按钮校准

原大屏OA13px补偿不再按viewport直接套用。普通按钮在1920px以上、支持round时使用按1px取整的共享字号，OA仍使用自己的比例。UIAlignment在文字包装后集中读取按钮实际字号，再以ui-font-13/ui-font-14-plus分类；13px标签使用0.18em，14px以上使用0.07em，其余在阶段26原生缩放复核后改为0.11em。不读取普通按钮内容的墨迹指标，不按每串文字改变偏移；字号属性只由公共规则读取button-font-size变量，未增加important来源。前述阶段12的0.1em描述是历史值；夹具差异助手仅将低于13px字号的认可位移更新为0.11em，没有扩大几何容差。

常规button-ink.browser.cjs现覆盖24宽度×4 DPR×3按钮组，含13/14px转换边界及2560/3840，实际字号11–16px。288组960标签最大中心偏差约0.622px，保持0.85px门限及相对取消补偿更居中的断言。新结果另存button-font-profile-review.json及summary；旧132组结果作为历史证据保留。图标/点击区域比较针对同一字号下补偿前后，字体取整前后整个大屏布局不由该断言保证。真实系统/浏览器缩放须另验。

## 最终优先级例外审查（阶段25）

阶段27集中验收确认：R07新增缺记录说明会增加历史目标卡高度，整页六周历史月份出现357项几何差异，保存为stage27-before-missing-data-contract.json。这是文案产生的布局变化，不归为Canvas或日历栅格回归。新增styles-missing-data-contract.json.gz只包含六宽度的six-weeks状态，保留原两个整页夹具；该组六项严格比较当前样式/几何，不再套用旧按钮位移助手。其他60整页状态仍比较原夹具及既有精确位移契约。正常运行同时断言说明和“记录内差额”文案，新基线不会使隐藏说明通过。

已查看390/850/1600目标卡截图：长文正常换行、两列布局和小时/日单位可见。新基线创建是审查后的预期产品变化，不是扩大容差。新增格式化后的工具输出明确区分recorded与unchanged；完整集中样式终态另见实施记录。

css-important-stage25.json保留清理前清单；css-important-stage25-final.json记录清理后40组规则、98条important声明及选择器/条件/行号。删除21条无条件同属性旧声明：base的通用输入高度由后加载controls同选择器覆盖；day/batch的ID高度及宽度由后续body加同ID规则覆盖；模板时间字段高度/宽度由后续body加同类规则覆盖。各处padding、aspect-ratio及布局规则继续保留，不重排层叠。没有机械移除所有important。

保留类型包括：隐藏状态必须覆盖组件display；公共普通控件的固定几何/字号作为唯一公共入口；34px编辑字段和模板、组合备份、休息段删除按钮按组件结构覆盖公共控件；类级字段几何保留组件契约，页面ID规则落实实例布局；减少动画偏好的规则必须压过交互动效。具体每组仍可在清单定位，不将跨选择器/不同条件简单按同值判为重复。已修复倒计时的hidden原生属性被组件display覆盖：常驻time/end节点同时使用现有.hidden类，不新增优先级规则。

阶段27最终完整748样式矩阵已通过。Windows100%下正常动画浏览器100/125/150%原生36状态另有独立证据；用户最新要求以系统100%为准，其他系统缩放暂停且未实测。

最终局部校准覆盖单日、单卡、目标、标题和日历页脚；祖先容器结构、根字体、窗口尺寸和显式refresh仍走完整路径。四宽度保存后50节点与完整刷新精确一致，最终CSS文件哈希保持原748样式验收版本。

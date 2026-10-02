# 性能测量契约

使用 `npm run benchmark -- --samples 20 --output docs/performance-new.json`。默认每档20次，已有最终报告拒绝覆盖；重跑应另选输出名。开发工具不参与应用离线运行。

数据由真实domain/core接口生成并通过validateBackup及再次验证的往返检查，包含完整1/5/10年（365/1826/3652天）、每月两份OA来源及明确accepted records、手动覆盖、请假和三种模板。固定资料截止2026-09-30，不读取用户浏览器数据。生成器测试涵盖2020/2024闰日、日志与日记录唯一对应、月份边界及错误参数。

每次使用新的隔离浏览器context。通过同一file路径的空白种子文档预置localStorage并关闭，然后加载真实HTML；预置阶段不计入正式首屏。用正常动画、真实时钟、1600×1000、DPR1、Asia/Shanghai运行。首次可用首屏以app ready、fonts loaded、两帧及当前有限动画结束为边界；无限背景动画继续。首屏是本进程环境中的新页面，不承诺冷操作系统缓存或全新浏览器进程。

每个样本按固定顺序测首屏、两字段输入保存、切到年历、回到月历、导入当前月28日、从内存JSON File解析并立即确认恢复。保存操作先赋值完整上班/下班字段，再派发两个input事件，是受控输入工作量，不模拟人工逐字键入。导入含既有250ms解析防抖，恢复不含人工确认思考时间。每个操作后等待两帧及有限动画结束。保存必须实际落盘，年历必须有12个月，导入日志必须增加且accepted records为28，恢复后的持久化完整State必须等于原样本；任一失败或pageerror使结果无效。

耗时使用页面performance.now，包含自动化派发及异步就绪等待开销，不能直接当作纯函数耗时。另记录CDP LayoutCount/RecalcStyleCount及Layout/Style/Script/Task Duration差值（Duration原始单位秒），PerformanceObserver longtask的开始/时长，以及已对齐文本/基线探针的矩形读取、全Canvas measureText调用数。矩形计数不等同refresh调用次数。

`npm run trace -- docs/performance-trace-new.json.gz`另行采集十年数据六类操作原始CDP timeline，拒绝覆盖历史文件。仅在测试页面通过route注入refresh开始/结束的performance.measure，不改正式模块；记录注入前后SHA256、实际刷新次数/时长与分线程Layout/UpdateLayoutTree/脚本事件。trace有额外开销，是诊断资料，不与20次正式基线直接混作性能预算。阶段25已采集24280个原始事件；该trace先于集中验收中的滚动/隐藏节点修复，后续正式对比以最新源码和未注入的benchmark为准。

报告保存原始每次样本、中位数、nearest-rank p95、范围、长任务总数与最大时长，并记录浏览器/Node/机器信息、真实时间及HTML/本地引用资产/开发锁文件/测量方法SHA256。完成时再次检查源码哈希，测量期间源码变动会失败。partial.json在每个已完成样本后保存进度，只有最终complete=true且进程exit 0才能作为完整基线。

两次样本的pilot仅验证流程与结果契约，不用于制定性能预算。基线和优化后正式20次/档均已完成，结果、调查线及尚未解决回退见 PERFORMANCE_BASELINE.md、PERFORMANCE_COMPARISON.md。缓存/派生数据、来源索引、局部DOM更新、稳定倒计时、动态偏好/背景生命周期及维护脚本事务均已实施。性能结果绑定报告中的源码哈希；阶段27已完成当前源码60次正式采集、exitCode=0及结束哈希核验，完整结果与剩余回退见PERFORMANCE_FINAL_STAGE27.md。阶段25保留为中间版本。原生浏览器缩放另见NATIVE_ZOOM_REVIEW，不能替代其他Windows显示缩放及完整正常动画视觉组合。

最终源码完整测量见PERFORMANCE_FINAL.md及performance-after-stage31-final.json；60独立运行/18摘要/exit0，原方法哈希不变。阶段30前缀补测只覆盖首屏/保存，单独保留未冒充全项结果。用户选择新版动画，保存结束耗时变化如实保留；CPU/Layout调查线保持原规则。

# 性能测量契约

使用 `npm run benchmark -- --samples 20 --output test-results/performance-new.json`。默认每档 20 次；已有最终报告拒绝覆盖，重跑使用新的输出名。开发工具不参与应用离线运行，也不读取用户浏览器的实际记录。

公共 `scripts/lib/fixed-business-date.cjs` 只固定 Date 为北京时间 2026-10-02 12:00，保留原生 `performance.now/measure`、定时器及 requestAnimationFrame。`performance-clock.browser.cjs` 验证计时方法身份、定时器推进和 User Timing 条目。不能把虚拟时钟快进结果用于性能结论。

公共 `scripts/lib/domain-source.cjs` 从生产入口加载纯领域接口。夹具含完整 1/5/10 年、每月两份 OA 来源及明确已接受记录、手动覆盖、请假和三种模板，均经过 `validateBackup` 与往返验证。样本需覆盖闰日、月份边界及导入记录对应关系。

每次使用隔离浏览器 context、正常动画、1600×1000、DPR 1、Asia/Shanghai。预置 localStorage 后加载真实 HTML，预置阶段不计时。首屏以应用 ready、字体完成、两帧及有限动画结束为边界；无限背景动画继续。该指标不承诺操作系统冷缓存或全新浏览器进程。

每个样本按固定顺序测首屏、两字段输入保存、年历、返回月历、导入固定 28 日及解析确认恢复。保存必须实际落盘，年历必须有 12 个月，导入须增加日志且已接受记录为 28，恢复后的持久化状态须等于原样本。页面错误或任一业务断言失败使该样本无效。人工思考时间不计入恢复，导入包含实际解析防抖。

耗时使用页面 `performance.now`，包含自动化派发和异步就绪开销，不能作为纯函数耗时。另记录 CDP 布局/样式次数与耗时、长任务、文字矩形及 Canvas 测量调用数。矩形读取次数不等于 refresh 次数。

`npm run trace -- test-results/performance-trace-new.json.gz` 采集原始 CDP timeline，拒绝覆盖已有文件。诊断注入只在测试页面进行，不修改正式模块；记录源码哈希、refresh 测量及分线程事件。trace 有额外开销，不能直接混入正式采样预算。

报告保存逐次原始数据、中位数、nearest-rank p95、范围、长任务数量与最大时长，以及浏览器/Node/机器信息、真实时间、源码和测量工具哈希。测量结束再次核对源码；期间发生变化则失败。partial 文件仅表示进度，只有 `complete=true` 且进程 exit 0 才可作为完整结果。少于 20 次的试跑只验证流程。

正式前后比较串行运行，使用相同环境、同一测量方法与等价业务夹具，避免并行测试负载。`--snapshot` 需要本机已有对应历史快照，并核对原始哈希及记录/导入/排班/模板语义；本地快照和历史性能报告不随仓库分发，也不能证明当前源码的性能。截图、采样和诊断均写入 `test-results/`，原生缩放检查不能替代全部系统缩放或正常动画组合验证。

# UNO 维护与验证

## 模块边界

- `uno-rules.js`：108 张牌、合法动作、状态转换、计分、随机数与存档校验；不依赖 DOM。
- `uno-ai.js`：三档策略；仅使用 observe 产生的公开信息。困难档在 Worker 运行，超时或不可用时退回普通档。
- `uno-view.js`：按稳定 ID 更新节点、缓存不可变 SVG；现代浏览器用 moveBefore 保留排序时的动画与焦点，旧浏览器只移动确实需要调整的节点。
- `uno.js`：生命周期、状态提交、异步动画编排与交互。generation 令牌使旧 Worker 和动画回调失效。
- `uno.css`：牌桌、牌面、响应式座位与减少动态效果规则。绘图仅使用本地 SVG。

## 动画所有权

方向轮的匀速旋转由一个长期存活的 WAAPI 动画驱动；禁止用每帧 style 写入重复驱动。反转期间才临时运行 RAF，完成后退出。指针使用另一个 WAAPI 动画，重新定向前采样当前矩阵，同步插值角度与轨道半径；同一座位的摸牌不能额外绕圈。RAF 只在反转或缺少原生动画支持时使用。

发牌、摸牌、出牌沿连续正弦弧线插值；翻面在飞行前半段完成，落地前恢复目标节点，随后移除飞行节点。真人手牌和 AI 手牌使用 FLIP 整理，只测量受影响的手牌。飞行层级在创建时确定。不要在整理时整体替换手牌、头像或 1! 节点，以免动画时钟重置。

暂停、隐藏页面、退出及设置会停止计算与视觉任务；正常回合交接保留方向轮时钟。减少动态效果模式直接展示最终状态。新回合先回收旧牌，开局发牌后排序，再逐张翻出起始牌；空牌堆立即回收除顶牌外的弃牌。

## 本次检查与修复

- 消除正常旋转期间重复的主线程更新，以及指针由 RAF/WAAPI 同时驱动的问题。
- 指针换座时连同轨道半径一起平滑插值，避免半径直接变化导致跳动。
- SVG 使用独立弱引用身份，跳过不变图案的递归对比；皇冠等动态内容仍正常更新。
- 排序优先使用保留节点状态的 moveBefore；不再无条件 append 所有牌。
- 飞行路径用连续曲线替换在中点转折的折线，减小摸牌和落牌的顿挫。开局发牌先集中测量目标，再插入飞行节点；同批飞行缓存桌面原点，减少强制布局。
- 纯等待使用可取消计时器，不在整张牌桌上创建空动画；暂停或离开时清理计时器。SVG 模板缓存最多 256 项。
- 回合交接时头像边框、名称及中心方向颜色渐变；减少动态效果模式取消这些过渡。
- 先生成菜单依赖，再打包 view-runtime，修复增加依赖后一次资源生成仍引用旧菜单的问题。

## 验证命令

```sh
npm run prepare:assets
npm run check
npm run lint
npm run check:format
node scripts/verify-uno.cjs
node scripts/verify-uno-motion.cjs
node scripts/verify-uno-draw.cjs
node scripts/verify-uno-official.cjs
node scripts/verify-uno-performance.cjs --dense --trace
node scripts/verify-uno-performance.cjs --pointer
node scripts/verify-uno-performance.cjs --pointer --counterclockwise
npm run prepare:site
node scripts/verify-uno.cjs _site
node scripts/verify-uno-motion.cjs _site
```

浏览器测试使用 file://，拦截 HTTP 请求。覆盖 2～8 人、桌面与手机、发牌排序、摸后出牌、选色取消、功能牌、弃牌回收、计分、翻面、暂停恢复与退出取消。性能脚本在四倍 CPU 降速下采样，检查方向轮/1! 时钟不重置、正常旋转不逐帧写样式，以及整手牌不被移除重建；不使用跨机器不稳定的帧率作为硬性门槛。

本机同一八人场景首次采样，优化前 p95 约 33ms、最大帧约 83ms；去除重复驱动后的采样 p95 约 17ms、最大约 17ms。此数据说明该场景的改善，不保证所有设备始终达到 60fps。

最终独立发布工作区采样：p95 约 17ms，最大约 33ms，无超过 50ms 的帧；八人局四次交接期间中心运动样式仅写入 4 次，方向轮与 1! 动画时钟均保持连续。顺、逆时针各 25 次指针轨迹验证通过。

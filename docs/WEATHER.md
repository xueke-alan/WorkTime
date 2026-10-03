# 城市天气

当前覆盖上海、北京、深圳、东莞、成都、西安。每小时第17分钟由 GitHub Actions
拉取 Open-Meteo 数据，提交到 `assets/data/weather/`，随后发布整个 GitHub Pages 站点。
客户端只读取 Pages 上的索引和所选城市所在省份文件，不直连天气接口。

Pages 构建时为 HTML 引用的脚本、样式添加内容哈希版本参数，避免浏览器混用新页面
和旧缓存脚本。直接双击使用的源 `index.html` 保持不变；发布更新不清除本地工时记录。

## 首次启用

1. 将代码推送到仓库默认分支。在仓库 Settings → Pages 中将 Source 设为 GitHub Actions。
2. 在 Actions 中手动运行 **Pages and weather**，检查天气抓取、提交和发布是否成功。
3. 仓库须允许工作流写入内容；受保护分支可能需要为自动提交设置适当权限。
4. 打开设置，选择工作城市；点击右下角“天气”标签查看。

Pages 基础地址集中在 `assets/js/weather-config.js`，当前为
`https://xueke-alan.github.io/WorkTime/`。仓库迁移时更新该地址。
在 file:// 下打开应用也从此地址加载；离线时使用浏览器缓存。

## 添加城市

城市选择建议和抓取范围共用生成目录 `assets/data/weather-cities.js`。
向 `assets/data/weather-locations.json` 加入 QWeather LocationList 的地点标识，运行
`node scripts/sync-weather-cities.cjs` 后提交目录。不要手动编辑生成文件。
省份、城市、坐标均来自目录，西安使用陕西省西安市的标识，避免与同名区县混淆。
原有自由文本设置保留；短名称和“上海市”等名称兼容。未收录或重名输入显示空状态，
不自动猜测地点，不影响工时记录与备份恢复。

## 额度与失败处理

`node scripts/update-weather.cjs --estimate` 输出预算。当前6个地点、12个变量，保守估算
每天173次、31天5357次计费调用，未计重试。Open-Meteo 非商业免费接口限制为每天10000次、
每月300000次、每小时5000次。多地点批量请求不能按一次计费调用估算。
扩展后超过预算时脚本在请求前停止；配置 GitHub Secret `OPEN_METEO_API_KEY`
后使用 customer-api.open-meteo.com。按估算选择足够的付费套餐，并预留重试额度。

每批最多30地点，间隔4秒，失败最多尝试3次。无效城市响应保留该城市旧记录和时间。
全部失败时不修改文件；工作流仍发布原有文件，并通过 weather-status 标记失败。
部分成功时发布有效更新，Actions Summary 显示成功与失败数量，索引保存失败地点标识。
发布索引与省份文件有共同版本；客户端遇到版本变化重试，仍不匹配时使用旧缓存。

天气标签页打开时加载，打开期间每分钟检查是否到刷新时间，每小时刷新一次。
手动刷新不受一小时时间限制。20秒请求超时，失败时显示缓存；天气有效时间或抓取时间
距今超过3小时标记“旧数据”。当前天气来自天气模型，并非保证实时的气象站观测值。

## 来源

- 天气：[Open-Meteo](https://open-meteo.com/)，CC BY 4.0；字段和时间序列经过整理。
- 城市坐标：[QWeather LocationList](https://github.com/qwd/LocationList)，生成目录包含上游版本和来源。
- [接口文档](https://open-meteo.com/en/docs)
- [接口额度](https://open-meteo.com/en/pricing)

验证命令：`npm run test:weather`、`npm run check`、`npm run lint`。

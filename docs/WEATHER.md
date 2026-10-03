# 百度办公地点天气

天气数据来自百度地图国内天气 API。GitHub Actions 每小时第17分钟采集一次，
前端通过公开 Raw JSON 获取最新数据，不需要等待站点重新构建。AK 不进入网页。

## 首次启用

1. 在仓库 Settings → Secrets and variables → Actions 添加 Secret `BAIDU_MAP_AK`。
   使用开通国内天气查询的服务端 AK；普通 GitHub 运行器使用动态出口 IP，
   白名单可设为 `0.0.0.0/0`。密钥不要写入代码、JSON 或日志。
2. 推送至默认分支 `main` 后，修改采集脚本、地区配置或采集工作流会触发 **Baidu weather**；
   也可在 Actions 中手动运行。仓库与分支保护规则须允许工作流写入内容。
3. 首次成功才生成 `data/weather.json`；没有密钥或请求失败不会生成虚假天气。
4. Pages 的 Source 设为 GitHub Actions。**Pages** 在普通代码推送、手动运行及百度采集
   成功后发布，自动提交使用 `GITHUB_TOKEN` 不会递归触发采集。

## 办公地点配置

采集脚本读取 `assets/data/weather-locations.json`，前端城市目录由同一文件生成。
修改后运行 `node scripts/sync-weather-cities.cjs`，并提交生成的 `assets/data/weather-cities.js`。
选择器只显示城市名称；保留原城市 ID，兼容已有城市设置。

| 城市 | 办公地点 | 天气查询地区 | district_id | JSON 键 |
|---|---|---|---|---|
| 东莞 | 松山湖基地／溪流背坡村 | 东莞市 | 441900 | dongguan |
| 上海 | 练秋湖研发中心 | 青浦区 | 310118 | shanghai |
| 深圳 | 坂田基地 | 龙岗区 | 440307 | shenzhen |
| 成都 | 成都研究所 | 郫都区 | 510117 | chengdu |
| 西安 | 西安研究所（锦业路园区） | 雁塔区 | 610113 | xian |
| 南京 | 南京研究所 | 雨花台区 | 320114 | nanjing |
| 杭州 | 杭州研究所 | 滨江区 | 330108 | hangzhou |
| 北京 | 北京研究所（环保园基地） | 海淀区 | 110108 | beijing |
| 武汉 | 武汉研究所（九峰三路园区） | 江夏区 | 420115 | wuhan |
| 苏州 | 苏州研究所（桑田岛基地） | 苏州工业园区 | 320571 | suzhou |

编码已按[百度官方地区表](https://mapopen-website-wiki.bj.bcebos.com/cityList/weather_district_id.csv)
核对。表中没有松山湖独立选项，按约定使用东莞市。
区县查询提供区域天气，不代表园区内具体位置的气象站观测。

## 数据与失败处理

请求使用 `data_type=all`。JSON 包含 `schemaVersion: 1`、UTC 的 `updatedAt` 和 `cities`；
每城包含 `name`、`districtId` 和百度原始 `result`。天气有效时间 `now.uptime` 按北京时间解析。
十个城市全部成功且响应有效后才原子替换 JSON；任何一个失败均保留完整旧快照。

每次请求超时30秒，网络、限流及暂时服务故障最多尝试三次；鉴权和参数错误立即失败。
只提交 `data/weather.json`，推送最多尝试三次，不强制覆盖。
每天约240次请求，未计重试；配额和高级字段权限以百度控制台为准。

逐小时预报和降水概率等字段可能缺失，界面显示“暂无”，不补造数据。
风力等级和风向使用百度文本，不能将等级当作 m/s 风速。预报展示接口实际返回的天数。
前端使用百度独立缓存键，不读取旧来源缓存；失败时显示最近的百度缓存，无缓存时显示空状态。
采集时间或天气有效时间超过两小时标记旧数据。数据未变化时保留上次快照与时间，不额外提交。
不创建历史文件，但 Git 提交历史仍保留旧版本。

## 前端读取

[最新天气 JSON](https://raw.githubusercontent.com/xueke-alan/WorkTime/main/data/weather.json)
在首次采集成功后可用。地址配置在 `assets/js/weather-config.js`；迁移仓库时同步更新客户端地址校验。

```js
const response = await fetch(
  "https://raw.githubusercontent.com/xueke-alan/WorkTime/main/data/weather.json",
  { cache: "no-store", credentials: "omit" },
);
if (!response.ok) throw new Error("天气数据暂不可用");
const snapshot = await response.json();
const weather = snapshot.cities.shanghai.result;
const display = (value) => value == null || value === 999999 ? "暂无" : value;
console.log(display(weather.now.temp), snapshot.updatedAt);
const stale = Date.now() - Date.parse(snapshot.updatedAt) > 2 * 60 * 60 * 1000;
```

GitHub 调度可能延迟或丢弃任务，不能保证严格每60分钟运行；公开仓库长期无活动时定时任务
可能被停用。Raw 地址可能受缓存和网络影响。

验证：`python -m unittest discover -s tests -p test_fetch_weather.py`、`npm run test:weather`、`npm run check`。

- [百度天气接口](https://lbsyun.baidu.com/docs/webapi?title=weatherinquiry%2Fweather%2Fbase)
- [GitHub 调度说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- 天气图标：[Meteocons](https://meteocons.com/icons/)，Bas Milius，MIT

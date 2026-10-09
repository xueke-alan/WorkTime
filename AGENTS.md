# 项目协作约定

- 每次推送代码前必须更新应用版本号。默认递增补丁版本；用户指定版本或发布类型时按用户要求执行。
- 同步更新 `package.json` 的 `version`、`package-lock.json` 的顶层及根包 `version`、`index.html` 的 `siteVersion` 文本，保持一致。
- 推送前核对远程分支版本，将版本更新与本次代码变更一起提交；已推送的同一批代码重试推送时，不重复增加版本号。
- 仅自动更新天气快照等数据的推送不属于代码发布，不递增应用版本。
- 推送前运行 `npm run check`、`npm run lint`、`npm run check:format`。涉及启动或发布资源时，也验证离线入口与发布产物启动。

# 原生浏览器缩放与按钮复核

用户明确日常环境为Windows100%、浏览器100%。本轮优先覆盖此环境，在同机Edge154上使用隔离临时profile分别设置页面原生100/125/150%缩放，不改变用户日常配置或Windows显示设置。配置方法对应[Chromium页面缩放偏好实现](https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc)，同时核验实际DPR、CSS内容viewport缩放、visualViewport.scale=1及CSS zoom=1，不能只靠偏好文件声明成功。

最终证据为[native-zoom-review-full-viewport.json](native-zoom-review-full-viewport.json)，工具进程exit0、complete=true。1600/1920两种物理窗口宽度，三档页面缩放，月历/年历/计算设置/时间模板/导入/历史六状态，共36组。全部使用正常动画，等待有限动画结束后检查页面横向溢出、弹窗宽度、按钮可见外轮廓及文字中心。108个标签最大字形中心偏差0.8103 CSS px，门限仍为0.85。尚未证明其他Windows显示缩放或所有字体组合。

原生缩放会改变字体的物理栅格尺寸。工具最初用未缩放Canvas字号测量，导致普通按钮假偏差；修正为物理字号测量后，“OA系统”在150%下仍有约0.9302px真实校准差异。11/12px同族按钮统一补偿从0.1em微调至0.11em，13px及14–16px规则保持原校准。没有按文字字符串单独偏移。更新后既有24宽度×4DPR×3族288组、960标签也通过，最大偏差仍0.6216px；控制区域、图标几何及同排基线检查通过。独立结果保存为button-font-profile-stage26-review.json，未覆盖旧结果。

Playwright常规截图在本次原生缩放下按CSS尺寸裁剪物理画面，第一版native-zoom-review.json的截图不能作为完整页视觉证据。最终工具直接用CDP捕获完整物理viewport，并校验PNG宽度与CSS viewport×原生缩放一致；图片以native-zoom-full-viewport开头。已查看100%月历/导入/模板、150%导入/计算设置代表截图；自动化通过36状态不等于每张均经人工逐像素审查。

历史月份缺记录说明另由target-display及三时区date-behavior定点检查通过，截图refactor-historical-target-missing-data.png显示长文正常换行。该提示增加目标卡内容，是有意产品变化；此前748状态通过记录对应修改前源码，不据此宣称修改后的历史目标卡几何完全一致。历史夹具保留，后续统一验收须明确记录该产品变化。

工具复测：`node scripts/review-native-zoom.cjs 新标签`。保留临时profile和旧截图便于诊断；输出报告已存在时拒绝覆盖。原生缩放没有加入每次业务测试入口，避免重复昂贵验证。

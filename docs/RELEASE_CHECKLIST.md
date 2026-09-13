# 发布检查清单

## dev 分支版本更新

此流程用于开发分支交付。推送 dev 不等于创建正式版本标签、GitHub Release 或提交商店。

1. 检查 git status、当前分支与远程 dev，保留已有工作；推送前获取远程最新状态，确认可以普通推送，避免覆盖远程提交。
2. 以 package.json 为版本源更新版本，保持依赖锁文件根版本一致，再调用现有同步脚本。例如：

~~~powershell
npm version 2.3.3 --no-git-tag-version
node scripts/sync-version.cjs
~~~

3. 更新 CHANGELOG.md 的中文版本记录和日期、README 版本徽章，以及中英文商店资料标题。功能、设置或数据处理发生变化时，同步使用说明、架构和隐私文档。历史版本记录与依赖自身版本保持不变。
4. 运行 npm run package：同步 manifest，执行完整 npm run check，再生成 dist/danmaku-echo-v<version>.zip。核对 package.json、package-lock.json 根版本、public/manifest.json、构建产物 manifest 和 ZIP 中 manifest 一致。
5. 需要时运行本地浏览器回归；将实际通过的环境与尚未完成的真实页面验收分别记录。浏览器 E2E 不加入普通或发布 CI。
6. 检查待提交差异，只提交源代码、测试与文档；不提交 node_modules、build、dist、日志、浏览器用户目录或本地测试产物。
7. 提交并普通推送到 origin/dev，确认远程提交号一致。dev 推送不会更新仅由 main 部署的在线隐私页面。

## 正式发布自动检查

- [ ] 发布提交位于 main，工作区干净。
- [ ] package.json、package-lock.json 根版本、public/manifest.json、v* 标签和 CHANGELOG 版本标题一致。
- [ ] Windows 与 Fedora 上 npm ci 和 npm run check 通过。
- [ ] 本地稳定版 Chrome 与 Edge 浏览器 E2E 通过，无断言重试；此项不由 CI 执行。
- [ ] 商店提交前连续三次完整 CI 通过。
- [ ] Windows 发布任务生成 ZIP 与 SHA256SUMS。

## 真实直播间验收

- [ ] Chrome 与 Edge：虎牙、Bilibili、抖音和斗鱼侧边聊天。
- [ ] 视频弹幕、网页全屏和原生全屏；原生弹窗不被遮挡，操作弹窗时不会同时触发底层弹幕。
- [ ] B 站左上角和空白区域无隐藏节点产生的胶囊。
- [ ] 不同分辨率/显示缩放下自动大小与手动大小正常；雷达自动档可编辑通用设置。
- [ ] 普通文字、Unicode Emoji、连续图片表情和图文混排顺序。
- [ ] +1、回复准备、收藏、发送者关联和本人消息框线。
- [ ] 更新后原 schema-v2 收藏继续可用，已有大小与雷达设置保留。
- [ ] 运行日志导出、重开页面后保留及清空正常；B 站失败阶段与关联编号可用于排查。
- [ ] 不通过重复真实发送主动制造限流或禁言。

## 商店提交

- [ ] 检查中英文介绍、截图及版本号。
- [ ] 确认权限与主机匹配仍然必要；本次功能未新增权限。
- [ ] 远程代码回答为“否”。
- [ ] 隐私披露与 PRIVACY.md、docs/privacy/index.html 一致，公开隐私页面已更新。
- [ ] 手动上传 Chrome 与 Edge 包；仓库不保存商店 API 密钥。

日志说明见[故障排查指南](TROUBLESHOOTING.md)，真实站点验收状态见[入口重构回归记录](ENTRY_REFACTOR_REGRESSION.md)。

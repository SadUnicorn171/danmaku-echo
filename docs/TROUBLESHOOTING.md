# 运行日志与故障排查

适用于 2.3.3 及之后版本。运行日志默认开启，覆盖安装后的扩展运行过程。

## 收集一次问题的证据

1. 更新扩展后，在浏览器扩展管理页重新加载扩展，再刷新已打开的直播页面，避免旧内容脚本与新后台混用。
2. 记录平台、浏览器版本、发生时间、普通/网页全屏/原生全屏状态，以及触发问题的操作。涉及大小问题时同时记录屏幕分辨率、系统显示缩放与浏览器缩放。
3. 重现一次问题，打开扩展「常规设置 → 运行日志」，点击「导出日志」保存 JSON。
4. 将复现步骤与导出的文件附到问题报告。导出不会自动发送文件；只分享与排查相关的信息。
5. 如需隔离下一次复现，可先导出现有记录，再清空日志。清空只删除运行日志，不改变收藏或设置。

JSON 顶层包含 schemaVersion、exportedAt 和 entries。每条记录包含 id、at（Unix 毫秒时间）、level、source、message、details 和 context。同一次失败可能同时产生页面与后台记录，通过关联编号和时间判断，不应直接当成多次发送。

## B 站图片表情 +1

精准请求轨迹覆盖房间图片表情的**后备发送**，并不意味着每次普通文字发送或官方面板操作都会生成这些字段。

| 字段 | 用途 |
| --- | --- |
| attemptId | 关联同一次操作的页面、后台和后备发送诊断 |
| failedStage | 失败的具体阶段，例如 load-wbi-request、send-parse |
| failureKind | transport 网络请求异常；http 非成功 HTTP；api 平台业务拒绝；parse JSON 解析失败；validation 本地校验；runtime 执行异常 |
| errorName / errorMessage / errorStack | 异常类型、脱敏原因与可用堆栈 |
| requests | 按顺序记录 resolve-room、resolve-identity、load-wbi、send 请求；只列实际执行的阶段 |
| endpoint / method / httpStatus | 固定接口路径、请求方法和实际取得的 HTTP 状态；缺失状态不等于 0 |
| apiCode / apiMessage | 平台返回的业务码和脱敏说明，HTTP 200 也可能包含业务失败 |
| durationMs / elapsedMs | 单次请求耗时与整条后备链路耗时 |
| identityProvided / identityResolved | 是否已有或成功解析表情标识，日志不保留标识本身 |
| sendRequestStarted / sendResponseReceived | 是否调用最终发送 fetch、是否收到响应，用于判断失败发生在发送前还是响应阶段 |
| online | 浏览器的在线提示，仅作为辅助信息 |

先定位 attemptId，再看 failedStage 和 failureKind，最后对照 requests 中最后完成或失败的步骤。load-wbi-request 失败且 sendRequestStarted 为 false，说明停在发送前准备阶段；send-parse 则表示最终接口已返回响应但无法解析，不能据此断言消息未送达。sendRequestStarted 为 true 只代表调用了 fetch，不保证服务器收到请求。

仅凭 TypeError 或 online 状态无法区分 DNS、CORS、代理、扩展拦截器和其他网络故障。日志不会自动重试发送；无法确认是否送达时，先核对平台显示结果。

2.3.3 修复了注入函数解析表情列表时引用模块外 ROOM_EMOTICON_PATTERN 导致的 ReferenceError。旧日志中已被替换为 [redacted] 的错误原因无法恢复，应使用新版重新收集。

## 范围与保留策略

- 捕获扩展前缀的 console.warn/error、可识别为扩展来源的未捕获异常，以及显式运行时诊断。抖音 MAIN world 通过现有页面协议传递诊断。
- 记录版本、时间、平台域名、屏幕/窗口与像素比、可用堆栈和结构化状态；不按条保存弹幕流，不持久化普通 info/debug。
- 数据保存在 chrome.storage.local 的独立日志键，最多 500 条、约 1 MB；读写时清理超过 7 天的记录。后台重启后可重新读取已写入的日志。
- 凭证、正文、用户与房间字段会脱敏；网页 URL 移除路径及查询参数。B 站诊断允许保留固定接口路径与脱敏错误说明，不包含请求体、响应体或凭据。
- 采集和后台写入均有限流；高频错误可能被省略，过长信息可能裁剪。扩展初始化之前的异常、无法识别扩展来源的页面异常、强制崩溃前未写入的记录和存储失败可能无法保留。

## 构建或打包命令失败

运行日志不采集 npm 命令的终端输出。在项目目录运行以下 PowerShell 命令，将输出同时显示并保存：

~~~powershell
npm run check 2>&1 | Tee-Object -FilePath check.log
npm run package 2>&1 | Tee-Object -FilePath package.log
~~~

按需要选择命令；package 本身会执行完整 check。问题报告中注明 Node/npm 版本、命令和失败阶段。*.log、build、dist、test-results 均不提交到源码仓库。

## 本地自动回归

以下浏览器场景使用本地模拟页面，不需要真实发送弹幕：

~~~powershell
npm run test:browser -- --browser=chrome --scenario=bilibili-precise-logs
npm run test:browser -- --browser=chrome --scenario=bilibili-auto-scale
npm run test:browser -- --browser=chrome --scenario=douyin-auto-scale
~~~

bilibili-precise-logs 模拟签名准备请求失败，经过真实的 content → background → MAIN world → storage.local 链路，并验证最终发送接口没有调用。它验证诊断与注入隔离，不代表真实平台账号权限或发送成功。更多边界见[入口架构](ENTRY_RUNTIME_ARCHITECTURE.md)和[真实页面回归记录](ENTRY_REFACTOR_REGRESSION.md)。

# 抖音首次进入与弹幕停顿排查

日期：2026-09-29 至 2026-09-30。用户报告首次进入偶发失效、刷新后生效，以及弹幕整体暂停数秒后恢复。
本次没有用户故障现场日志；以下是对当前代码的确定性复现和修复，不将其描述为所有现场故障的唯一原因。

## 复现与原因

| 路径                               | 旧行为与影响                                                                                                                  | 修复                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Canvas 在挂载前转交 Worker         | 尚无弹幕标记时丢弃 OffscreenCanvas 对应关系；之后即使完整观察到创建和弹幕消息，也按“晚注入猜测”进入至少一个弹幕周期的安全等待 | 弱引用保存转交身份，待原 Canvas 出现弹幕标记后关联；完整创建链路可正常接管，真正晚注入仍保留安全等待               |
| Canvas 短暂脱离 DOM                | RAF 直接退出，不再续帧，直到下一条消息或 5 秒心跳重新启动；恰逢维护扫描还会被误删                                             | 脱离期间恢复官方 Canvas、隐藏覆盖层，保留帧循环；维护首次发现脱离后保留 500ms 宽限，重新挂载后继续，持续脱离仍释放 |
| SPA 新房间创建快于路由轮询         | 新实例刚出现，500ms 维护轮询又把它作为旧房间实例清空并进入安全等待                                                            | 每个 Renderer 命令处理前先同步路由，使旧实例清理发生在新实例创建之前                                               |
| 从首页进入直播时缓存了原生发送方法 | 首页未安装 MAIN hook，网站提前保存的 `postMessage.bind(...)` 绕过后续注入；刷新为直接直播页才恢复                             | 在已有授权的 `www.douyin.com/*` 范围内提前安装 MAIN hook，直播路由外不处理 Renderer 命令，不挂扩展业务 UI          |
| 浏览器返回缓存页面                 | content runtime 被永久销毁；MAIN hook 销毁重建后，网站保存的旧函数引用失去观察者                                              | BFCache 隐藏只暂停运行资源；保留桥接、设置订阅及 hook 身份，返回后恢复并握手；普通卸载仍彻底清理                   |
| MAIN ready，但 content 注入失败    | bootstrap 将 MAIN 的 ready 当成整个运行时成功，停止后续重试                                                                   | 分开记录 pageReady / runtimeReady，完整注入确认后才停止重试，并在缓存页面返回时恢复路由检查                        |
| 心跳到达时仍有待分配弹幕           | 恢复分配覆盖计时器句柄，旧重试仍继续运行；20 次心跳可多留 20 个重试计时器                                                     | 分配前取消旧重试，每个实例只持有一个分配计时器，避免重复调度累积                                                   |

挂载等待期的 `orphan-observed` 告警改为每个实例一次，避免把同一故障变成逐条弹幕日志。
注入确认只接受当前路由和当前重试轮次的响应，避免上一个房间延迟返回的成功结果取消当前房间仍需进行的重试。
扩展没有更换官方 Worker，没有拦截 WebSocket，没有新增权限；普通未标记 Canvas 不会被接管。

## 自动验证

- 集成单测通过真实 page-app 装配验证首次挂载、短暂脱离、维护扫描竞争、新房间建立、缓存方法返回、普通 Canvas 保护和心跳计时器数量保持稳定。
- content runtime 测试覆盖 BFCache 暂停/恢复及监听器清理；bootstrap 契约覆盖 MAIN 已 ready 但注入失败、旧房间响应延迟返回时的继续重试。
- 浏览器 fixture 使用真实 OffscreenCanvas、MessageChannel、扩展隔离世界和 MAIN hook；为本地可选测试，不加入 CI。
- `douyin-lifecycle` 验证直接进房、首次挂载、阻断心跳时自行恢复、切房维护、模拟 BFCache 事件、全屏往返和关闭扩展后的原生 Canvas 恢复。
- `douyin-spa-startup` 从 `www.douyin.com/` 开始，在进入直播之前缓存发送方法，再切换到直播路由，验证无需刷新即可接管；首页不显示业务 UI。
- 旧构建结果保留于 `test-results/douyin-lifecycle/before-direct/`、`before-spa/`：直接进房检出四项失败；SPA 缓存方法路径无法接管。

浏览器测试只向本地夹具发送内部 Renderer 命令，不发送真实弹幕。标准抖音 URL 的首个导航由精确匹配的 CDP 请求响应替换为回环服务器内容，避免测试端口改变生产 URL 识别语义。

### 本次结果（2026-09-30）

- `npm run check`：类型、lint、构建和静态校验通过；110 个单测文件、605 项测试及 137 项契约测试通过。完整输出保存在 `test-results/douyin-lifecycle/verified-check.log`。
- Linux；构建检查使用 Node 22.23.1，浏览器运行器使用 Node 24.19.0；Chrome 153.0.8010.52、Edge 153.0.4234.48。
- `npm run test:browser -- --browser=all --scenario=douyin-lifecycle`：Chrome / Edge 均通过，均为第一次尝试；结果在 `test-results/douyin-lifecycle/verified-direct/`。
- `npm run test:browser -- --browser=all --scenario=douyin-spa-startup`：Chrome / Edge 均通过，均为第一次尝试；结果在 `test-results/douyin-lifecycle/verified-spa/`。
- `npm run test:browser -- --browser=all --scenario=douyin-native-settings`：Chrome / Edge 均通过，均为第一次尝试；结果在 `test-results/douyin-lifecycle/verified-native-settings/`。
- 上述命令通过 `DANMAKU_E2E_CHROME_PATH` / `DANMAKU_E2E_EDGE_PATH` 指定浏览器，分别设置 `--artifact-root` 保留独立结果，不覆盖其他场景。
- 心跳计时器与过期注入响应均先复现失败，再修复通过；对应前后日志保存在 `test-results/douyin-lifecycle/unit-evidence/`。
- 对照执行 `douyin-side`（Chrome）仍有 12 项既有失败，与 `test-results/feature-optimization/douyin-side-context-fix/` 的修复前基线集合完全相同，新增失败为 0。本次结果在 `test-results/douyin-lifecycle/verified-side/`；不能据此宣称抖音完整交互套件通过。

`douyin-side` 的既有失败为 `actionBehindMessage`、`actionGapReserved`、`gapHoverKeptPaused`、
`favoriteRichAssetsRejected`、`replyPrefilled`、`replyInputFocused`、`replySurfaceCorrect`、
`clickSentMatchingMessage`、`ownMessageFramed`、`canvasRestoredAfterDisable`、
`layerInactiveAfterDisable` 和 `sendStatisticsRecorded`。本次未改动这些断言或将其排除。
新生命周期夹具独立验证关闭扩展后的原生恢复；它的通过不用于抵消旧综合场景的失败。

## 真实页面待验范围

fixture 的 BFCache 用例模拟生命周期事件，不证明当前 Chromium 会将某个真实直播页纳入 BFCache。
真实账号、网站当前 DOM、实际直播负载和进入方式仍需现场观察。验收时分别记录直接打开、从首页进入、切房、返回，以及页面是否可见。
若仍出现异常，优先导出同一次发生时间附近的运行日志，核对 `orphan-observed`、`renderer-route-reset`、
`renderer-heartbeat-timeout` 与注入失败记录；不要把缺失日志当作页面正常，也不要只以刷新后正常判定原因。

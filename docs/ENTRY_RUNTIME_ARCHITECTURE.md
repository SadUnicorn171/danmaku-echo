# 内容脚本入口运行架构

本文档记录入口拆分前的运行边界、抖音注入链路、跨世界协议和重构回归基线。它描述的是必须保持的行为契约，而不是要求保留当前文件组织。

## JavaScript world 与入口职责

| 入口 | 加载范围和时机 | 运行 world | 当前输入 | 当前输出 | 销毁条件 |
| --- | --- | --- | --- | --- | --- |
| `content.ts` | 虎牙、斗鱼、Bilibili；`document_idle`，Bilibili 使用 `all_frames` | 扩展隔离世界 | 页面 DOM、`chrome.storage`、平台设置、指针和全屏事件 | 通用操作胶囊、回复草稿、收藏、受保护发送、轻量雷达采集 | `pagehide`；页面隐藏时释放瞬时资源 |
| `douyin-bootstrap.ts` | `live.douyin.com/*` 与 `www.douyin.com/*`；`document_start` | 扩展隔离世界 | 当前 URL、SPA 路由变化、page hook 的 `ready` 消息 | 向 Service Worker 请求确保抖音运行时，向 page hook 发送 `ping` | `pagehide`；页面隐藏时停止轮询和待处理重试 |
| `douyin-content.ts` | 抖音直播路由；`document_start` 或由 Service Worker 补注入 | 扩展隔离世界 | 侧聊 DOM、设置、扩展 API、page hook 协议消息 | 扩展 UI、官方编辑器操作、收藏/雷达、本人消息意图和 Renderer 操作结果 | `pagehide`；SPA 切房、页面隐藏或设置关闭时释放对应资源 |
| `douyin-page-hook.ts` | 抖音直播路由；`document_start` 或由 Service Worker 补注入 | 页面 `MAIN` world | Canvas、Worker/MessagePort 已解码消息、content 协议消息 | 安全 DOM Renderer、单条悬停、Renderer 操作请求、雷达只读消息 | Canvas 脱离、路由变化、心跳超时、Renderer 失败或页面卸载 |
| `service-worker.ts` | Manifest V3 后台按事件唤醒 | 扩展后台 | runtime message、发送者标签页/frame、扩展存储 | 抖音运行时注入、表情目录、收藏写入、Bilibili 后备发送和人数 frame 汇总 | 由浏览器管理生命周期；所有状态必须可重建或有界 |

当前抖音隔离世界入口已完成分层：`douyin-content.ts` 只执行平台/重复加载检查并创建、启动运行时；`platforms/douyin/content/content-app.ts` 负责依赖装配；`content-runtime.ts` 统一拥有设置、SPA、可见性、监听器、计时器及逆序销毁。业务解析、发送、悬停、本人消息和雷达采集继续由各自控制器负责。

抖音 MAIN world 入口也已完成分层：`douyin-page-hook.ts` 只执行重复加载检查、调用 `createDouyinPageAppRuntime()`、登记全局 runtime 并启动；`platforms/douyin/page/page-app.ts` 负责严格类型化的模块装配与 Renderer 命令协调，具体算法和资源生命周期继续分别由页面子模块与 `page-runtime.ts` 持有。入口不再直接导入 Hook、bridge、DOM Renderer、频道或运动模块。

抖音 MAIN world 的核心状态由 `platforms/douyin/page/runtime-types.ts` 定义：一个 Renderer 实例独占一个 Canvas，并拥有轨道表、待调度队列、频道、DOM Layer、节点表和生命周期；每条轨道反向引用所属实例并独占自己的 DOM 渲染状态。时间、CSS 像素、设备像素、缩放比例、计时器和 RAF 标识均使用显式单位类型，后续页面模块拆分统一复用这组边界。

Canvas 识别和 Offscreen 转移观察由 `platforms/douyin/page/canvas-hook.ts` 独立拥有。Hook 只登记结构上可确认为弹幕层的 Canvas，为其分配稳定页面内 ID，并保存 OffscreenCanvas 到原 Canvas 的弱引用映射；普通 Canvas 只执行原生调用，不进入 Renderer 状态。原型补丁使用页面级共享记录防止重复包裹，最后一个所有者销毁后恢复原始方法。

Worker/MessagePort 旁路观察由 `platforms/douyin/page/worker-hook.ts` 独立拥有。Hook 不接触 WebSocket，只把可识别的页面 Renderer 消息转换为 `create-instance / add-barrage / update-config / clear / destroy / stop / start` 类型化命令；未知私有流量直接透传。原型 wrapper 保留官方调用的 `this`、参数引用、transfer list、顺序、调用次数和返回值，观察异常不会阻断页面消息。

官方 Renderer options/content 的纯解析由 `platforms/douyin/page/barrage-content.ts` 独立拥有，并统一输出 `PreparedBarrage`。正文、图片资源、消息 ID、发送者、首段样式和轨道元数据只解析一次，由 DOM Renderer 与轻量雷达共享；礼物和福袋的排除原因只影响雷达统计，不会阻断原生显示。

内容测量由 `platforms/douyin/page/content-measurer.ts` 独立拥有。它基于同一份有界富内容，以 CSS 像素计算文本、图片和嵌套 inline/block 内容尺寸，并使用有界 Canvas 文本度量缓存；缓存键包含字体、正文和字体可用状态，图片比例按调用实时读取。页面主循环只消费 `PreparedBarrage.description` 中已经完成的测量结果。

Renderer 实例与 Canvas 所有权由 `platforms/douyin/page/renderer-instance-registry.ts` 独立拥有。注册表保证一个 Canvas 同时只属于一个实例，并负责正常创建、重复实例替换、晚注入孤立消息恢复、首次挂载宽限、Canvas 脱离后的重新关联、路由重置和销毁。页面入口只能通过窄接口查询或遍历实例，不能直接修改实例 Map 或孤立消息 Map。

轨道运动由无 DOM 依赖的 `platforms/douyin/page/track-motion.ts` 描述。RAF 位移只使用单调回调时间，轨道暂停会冻结模型距离，恢复后从原位置按原速度继续；安全间距约束不会把轨道向后推。Unix 时间只用于消息观察和调度期限，不与 RAF 时间混算。

频道与待发送队列由 `platforms/douyin/page/channel-scheduler.ts` 统一调度。调度器根据 Canvas/config 同步频道数量，处理 pending 上限、优先级、多行占位、保留期限、前序安全间距和过期释放；Canvas 缩小时受影响轨道会解除全部旧占位并重新排队。该模块只读写类型化轨道状态，不持有或操作 DOM 节点。旧的根目录 `track-model.ts` 兼容重导出已删除，调用方和契约测试直接依赖 `track-motion.ts` 与 `channel-scheduler.ts`。

DOM 输出由 `platforms/douyin/page/dom-renderer.ts` 负责。`page-app.ts` 中的帧协调回调先通过 `readFrame()` 生成不写 DOM 的布局快照，再由 `commitFrame()` 创建或复用轨道节点并集中写入位置和尺寸。Canvas 仅在首批 DOM 节点全部连接后隐藏；禁用、异常、心跳超时、Worker/实例销毁、路由变化或页面退出时同步恢复原始 Canvas visibility 并移除全部 Renderer DOM。

页面胶囊与单条悬停由 `platforms/douyin/page/track-controller.ts` 独立拥有。控制器创建 action bar、按设置计算完整胶囊尺寸与左右位置、校验轨道/实例/正文元数据并通过页面 bridge 分发操作；同一时刻只允许一个 `currentTrack` 暂停，正文、间隙和胶囊共用一个悬停主体。雷达提示覆盖区域拒绝底层悬停并释放已有轨道，`+1` 成功或其他胶囊操作结束后恢复轨道。控制器只更新单条轨道的 motion/DOM 状态，不访问频道、pending 或实例注册表内部集合。

页面本人弹幕匹配由 `platforms/douyin/page/own-message-matcher.ts` 独立拥有。隔离世界登记或取消发送意图，页面 matcher 维护有界且会过期的意图队列，并按平台消息 ID、富文本签名、完整图片资源重数和规范化正文的顺序匹配 Renderer 轨道；一个意图只消费一次。手动发送与 Renderer 到达顺序颠倒时，只在短窗口内补匹配得分最高且最新的未标记轨道。`page-app.ts` 只负责把匹配结果交给 DOM Renderer 框选并通过页面 bridge 回执。

页面诊断由 `platforms/douyin/page/diagnostics-controller.ts` 独立拥有。业务路径只进行轻量计数和有界事件记录；普通 debug 事件按类型采样，完整实例快照和 JSON 序列化只发生在显式调试请求或最多每秒一次的隐藏 marker 刷新中。错误详情在进入缓冲区前移除凭证、Cookie、CSRF、Token 和签名等敏感值，并限制递归深度与长度。控制器可以整体关闭，销毁时会取消 marker 定时器并清除其 DOM/全局调试引用。

MAIN world 总生命周期由 `platforms/douyin/page/page-runtime.ts` 独立拥有。它以幂等 `start()`/`destroy()` 集中安装和释放 Canvas Hook、Worker/MessagePort Hook、页面 bridge、轨道控制器、维护定时器以及全屏、可见性和页面退出监听；同一个全局 runtime 会被重复注入复用，旧代维护回调必须通过 generation 校验。可见页面心跳超时、设置关闭、页面隐藏、路由切换、Canvas 脱离和普通卸载都会走明确的 Canvas 恢复路径；BFCache 往返则在释放活动资源后保留可恢复状态，并只重新启动一次。

## 抖音启动和恢复链路

```text
Manifest document_start
  ├─ MAIN world: douyin-page-hook.ts
  ├─ isolated world: douyin-bootstrap.ts
  └─ live route isolated world: shared.js + douyin-content.ts

普通抖音页面通过 SPA 进入直播
  douyin-bootstrap.ts
    → chrome.runtime.sendMessage(danmaku-echo.ensure-douyin-runtime)
    → service-worker.ts
      → 注入 douyin-page-hook.js（MAIN world）
      → 注入 shared.js + douyin-content.js（隔离世界）
      → 插入 douyin-content.css
    → bootstrap 发送 ping
    → page hook 返回 ready
```

约束：

- `douyin-bootstrap.ts` 只负责路由检测、注入恢复、有限重试和 ready 探测，不承载弹幕业务。
- MAIN world 可以观察页面 Canvas、Worker 和 MessagePort，但不得读取扩展私有存储或调用收藏仓库。
- 隔离世界可以使用扩展 API 并共享页面 DOM，但不得假定能直接访问页面创建的 Worker 对象。
- 两个 world 之间只通过 `window.postMessage` 的版本化协议通信。
- MAIN world 只有 `platforms/douyin/page/page-bridge.ts` 可以注册 `window.message` 或调用 `window.postMessage`；页面业务模块通过类型化的 `send()` / `request()` 接口通信。
- Renderer 操作请求由页面 bridge 按“响应类型 + requestId”关联；超时、重复响应和迟到响应只允许结算一次。
- 重复注入必须由加载标志、实例所有权和幂等生命周期共同防护。

## 当前跨世界消息基线

### content → page

| type | 用途 | 关键字段 |
| --- | --- | --- |
| `ping` | 探测 page hook 是否可用 | `requestId` |
| `debug-request` | 请求页面世界诊断快照 | `requestId` |
| `renderer-settings` | 同步 Renderer、雷达和胶囊设置 | `requestId`、`enabled`、`repeatReminderEnabled`、`actions`、`capsuleScale` |
| `emoji-catalog` | 同步抖音表情资源与括号 token 映射 | `items`/目录数据 |
| `renderer-message-resolved` | 将隔离世界恢复的完整富文本回传给轨道 | `trackId`、正文/富文本数据 |
| `own-message-intent` | 登记即将发送的本人弹幕 | `intentId`、`text`、`plainText`、`assets`、`signature`、`sourceType` |
| `own-message-cancel` | 取消失败或过期的本人弹幕意图 | `intentId` |
| `renderer-result` | 返回 Renderer `+1`/复制等操作结果 | `requestId`、`trackId`、`ok`、`reason` |
| `renderer-favorite-result` | 返回 Renderer 收藏结果 | `requestId`、`ok` |
| `renderer-copy-result` | 返回 Renderer 复制结果 | `requestId`、`ok` |

### page → content

| type | 用途 | 关键字段 |
| --- | --- | --- |
| `ready` | page hook 安装完成 | `requestId`、`version`、`instanceCount`、`orphanCount` |
| `renderer-ready` | Renderer 已应用设置 | `requestId` |
| `debug-snapshot` | 返回页面世界诊断快照 | `requestId`、`snapshot` |
| `repeat-reminder-message` | 从 Canvas 队列只读采集雷达消息 | 消息 ID、正文、时间、排除原因 |
| `renderer-activate` | 请求隔离世界执行轨道 `+1` | `requestId`、`trackId`、正文/富文本数据 |
| `renderer-reply` | 请求隔离世界准备回复 | `requestId`、`trackId`、正文和发送者线索 |
| `renderer-favorite` | 请求隔离世界收藏轨道消息 | `requestId`、`trackId`、正文/富文本数据 |
| `renderer-copy` | 请求隔离世界复制轨道正文 | `requestId`、`trackId`、正文/富文本数据 |
| `own-message-consumed` | 通知本人弹幕意图已匹配到画面轨道 | `intentId` |

所有消息必须同时满足：`event.source === window`、可信 `source`、已知 `type` 和对应 payload 守卫。MAIN world 的解析、分发、发送和请求响应生命周期已经统一收口到页面 bridge。

## 自动测试映射

| 行为 | 当前自动测试 | 重构期间的最低要求 |
| --- | --- | --- |
| 候选识别与平台契约 | `src/platforms/live/__tests__/adapter-contract.spec.ts`、`dom-fixtures.spec.ts`、各平台候选规则测试、`tests/contracts/*-dom-config.test.mjs` | 四平台 fixture 都能解析正文、发送者、消息 ID 和图片表情 |
| 悬停与单条选择 | `src/platforms/live/__tests__/hover-selection-controller.spec.ts`、Bilibili `overlay-motion.spec.ts`、斗鱼 `native-hover.spec.ts` / `native-motion-fallback.spec.ts`、抖音 `track-controller.spec.ts` | 一次只选择一条；正文—间隙—胶囊连续；雷达区域隔离 |
| 胶囊位置和缩放 | live `capsule-controller.spec.ts` / `capsule-position.spec.ts`、抖音 `track-controller.spec.ts` / `dom-renderer.spec.ts`、`tests/contracts/live-action-visibility.test.mjs` | 左右切换、全屏、缩放后锚点稳定 |
| 发送与平台反馈 | live `send-coordinator.spec.ts` / `send-protection.spec.ts` / `native-send-observer.spec.ts`、三个平台 `sender.spec.ts`、抖音 content `send-controller.spec.ts` | 成功、冷却、重复、限流、禁言、超时均返回结构化结果 |
| 回复 | `tests/contracts/reply.test.mjs`、live `editor-controller.spec.ts` / `editor-dom.spec.ts`、抖音 content `editor-controller.spec.ts` | 只填入并聚焦，不自动发送；无发送者/编辑器有明确反馈 |
| 收藏和表情 | `tests/contracts/favorites.test.mjs` / `emoji-fallback.test.mjs`、四平台 `rich-emoji` / `rich-message-sender` / `sender` 测试 | 展示名和发送身份分离，图文顺序不丢失，装饰资源不混入 |
| 轻量雷达 | `src/features/repeat-reminder/__tests__/collector.spec.ts` / `detector.spec.ts` / `runtime.spec.ts` / `similarity.spec.ts` / `traffic-flow.spec.ts`、live `repeat-reminder-adapter.spec.ts`、抖音 content `radar-collector.spec.ts` | 双源去重、合法重复、过滤项、阈值和队列行为不变 |
| 本人弹幕 | 抖音 content `own-message-controller.spec.ts`、page `own-message-matcher.spec.ts`、`tests/contracts/douyin-own-message.test.mjs` / `emoji-fallback.test.mjs` | 消息 ID/签名/资源/正文按优先级匹配；一个意图只消费一次；相同文本多人、连续表情、失败取消和超时行为稳定 |
| 页面诊断 | core `diagnostics.spec.ts`、抖音 content `content-diagnostics.spec.ts`、page `diagnostics-controller.spec.ts` | 事件和字段有界且错误脱敏；高频记录不会突破每秒 marker 上限；关闭和销毁不残留定时器或 DOM |
| MAIN world 生命周期 | 抖音 page `page-runtime.spec.ts` / `renderer-instance-registry.spec.ts`、`tests/contracts/content-media-safety.test.cjs` | 重复启动/销毁幂等；心跳、路由、Canvas 脱离、全屏、隐藏和 BFCache 恢复均由唯一 runtime 协调；入口不直接持有 Hook 安装、维护定时器或生命周期监听 |
| 抖音 Canvas 接管 | 抖音 page `canvas-hook.spec.ts` / `worker-hook.spec.ts` / `dom-renderer.spec.ts`、`tests/contracts/douyin-barrage-model.test.mjs` / `content-media-safety.test.cjs` / `live-action-visibility.test.mjs` | 不拦截 WebSocket；官方消息继续投递；失败或销毁恢复 Canvas |
| 构建与权限 | `tests/contracts/validate-manifest.cjs`、`validate-vue-architecture.cjs`、`validate-ci.cjs`、`validate-import-boundaries.cjs`、`validate-test-layout.cjs`、`validate-refactor-cleanup.cjs` | world、加载顺序、权限、依赖边界、迁移清理、测试分类和本地可选浏览器 E2E 约束保持不变 |

Vitest 单元测试保留在 `src/**/__tests__`；表中的 `*.test.cjs|mjs|js` 源码/构建契约位于
`tests/contracts` 并由 `test:regression` 自动发现；DOM 样本位于 `tests/fixtures`；浏览器脚本位于
`tests/browser`，只通过本地 `npm run test:browser` 执行。

Coverage 宽范围收集 `core`、`features`、`platforms` 的可执行模块，并按这三个领域分别设门槛；
入口文件只通过薄启动器和源码边界契约验证。报告契约要求富文本、发送、悬停、Douyin 协议、
轨道运动和两类轻量雷达适配模块始终存在于 coverage summary，避免重构后静默缩小统计范围。

抖音跨 world 协议当前发送 v1；为了覆盖扩展重载时页面暂留旧 MAIN-world Hook 的短暂混合状态，
2.x 仍接收缺少版本字段的旧消息。该兼容分支明确在 3.0.0 删除，旧实现细节不再作为公共导出。

## 必须保留的手工回归

浏览器 E2E 只作为本地可选工具，不加入 CI。涉及对应模块的阶段结束后，在真实直播间检查：

| 平台 | 普通页面 | 网页全屏 | 平台专项 |
| --- | --- | --- | --- |
| Bilibili | 文字、官方表情、房间表情、回复、收藏、雷达 | 画面弹幕、快捷输入和胶囊 | 多 iframe 只显示一个 UI；福袋/广告不进入雷达 |
| 虎牙 | 文字、图片表情、回复、收藏、雷达 | 画面弹幕和胶囊 | 贵宾数读取；平台限流文案 |
| 斗鱼 | 文字、专属表情、回复、收藏、雷达 | 单条悬停、连续区域和原生胶囊 | 无前后抽搐、无成片冻结、重叠弹幕只悬停一条 |
| 抖音 | 直接进房、SPA 进房/切房、连续表情、侧聊本人框选 | DOM 弹幕、单条悬停、胶囊和画面本人框选 | 礼物/福袋不进入雷达；失败、关闭或超时恢复 Canvas |

实际执行结果统一写入 `docs/ENTRY_REFACTOR_REGRESSION.md`；本表只定义稳定的验收范围。

## 当前自动化缺口

- 真实平台 DOM 哈希类名变化仍需手工验证，fixture 只能验证已知结构和解析契约。
- Bilibili 多 iframe 的真实 UI 所有权切换缺少稳定浏览器级自动测试。
- 斗鱼原生动画控制器与页面真实时间线的交互无法由 jsdom 完整模拟。
- 抖音 Worker/OffscreenCanvas 的真实浏览器性能和长期运行内存需要本地浏览器检查。
- 各平台账号权限、禁言、粉丝专属表情和真实限流只能在不主动制造滥用的前提下手工验证。

## 持久运行日志

`core/runtime-log.ts` 负责记录格式和有界脱敏，`core/runtime-logger.ts` 负责运行时采集；后台通过 `core/runtime-log-store.ts` 串行写入独立 storage.local 键。内容脚本和设置页立即提交警告/错误，失败最多重试一次；后台响应只在存储操作完成后发送。后台重新启动后从磁盘读取日志，清空、导出和写入共用一条串行队列，不改写收藏或 sync 设置。

运行日志默认将扩展警告、错误和未捕获异常的时间、版本、堆栈、平台域名、屏幕/窗口信息及结构化诊断上下文保存在 chrome.storage.local。日志不自动上传，不保存弹幕流；凭证字段、正文/用户/房间字段和网页 URL 路径及查询参数会被过滤。最多保留 500 条、约 1 MB，读写时清理超过 7 天的记录；用户可在常规设置中导出 JSON 或清空日志。

MAIN world 不接管平台 console，通过显式诊断事件和扩展来源的未捕获异常记录，沿用抖音版本化消息通道的 runtime-log 消息交给 bootstrap。早期消息保留最多 20 条，在已有 ping 到达时重发一次，后台按 id 去重。页面侧数据视为不可信，服务端再次校验和脱敏；出口只能由本扩展页面调用。扩展来源没有堆栈的 Promise 拒绝、安装前的异常、浏览器强制崩溃或磁盘写入失败不能保证记录。

单运行上下文每分钟最多提交 60 条，后台每个标签页/frame 每分钟最多接收 120 条，写入等待队列最多 100 条。正常 debug/info 和每条弹幕不持久化。日志挂钩按文档生命周期复用，BFCache 保留，普通 pagehide 清理。

## Bilibili 表情后备发送的精确日志

失败日志使用同一个 attemptId 关联后台和内容脚本。diagnostics 包含 failedStage、failureKind、errorName/errorMessage/errorStack、总耗时、浏览器在线提示、是否已有/解析出表情标识，以及 sendRequestStarted/sendResponseReceived。requests 按发生顺序记录 resolve-room、resolve-identity、load-wbi、send：只包含无查询参数的固定接口路径、GET/POST、起始时间、耗时、HTTP 状态、响应类型、Content-Type 和脱敏后的平台业务码/说明。不收集请求体、响应体或凭据。

失败类型区分 transport、http、api、parse、validation、runtime。例如 load-wbi-request 表示签名信息请求未正常返回，send-parse 表示最终发送接口已有响应但 JSON 解析失败；后者不能据此断定消息未送达。sendRequestStarted 只说明已调用 fetch，不保证服务器收到请求。HTTP 状态缺失时不伪造为 0；navigator.onLine 只是辅助信号，不能用来区分 CORS、DNS、代理或拦截器。

日志保留 errorMessage/apiMessage 专用文案及数值型 messageLength/senderIndex/sender；普通 message/text/用户字段仍脱敏。请求轨迹放在诊断对象顶层，避免深层摘要裁剪；单条日志过大时优先裁剪环境上下文，保留失败证据。JSON 解析异常不保留可能包含响应正文的原始错误片段。日志功能不增加网络重试或自动发送。

回归：本地 bilibili-precise-logs 浏览器场景模拟 load-wbi 请求拒绝，实际经过 content → background → MAIN world → background → storage.local，检查请求轨迹、错误原因和关联编号，并确认最终发送未被调用。

2026-09-13：精确日志浏览器回归发现表情列表解析引用模块外 ROOM_EMOTICON_PATTERN，序列化注入时抛出 ReferenceError。已改为函数内部 IDENTITY_PATTERN，并用独立 VM 作用域和实际浏览器注入覆盖。

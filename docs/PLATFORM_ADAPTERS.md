# Platform Adapter Guide

Danmaku Echo 支持 Bilibili、斗鱼、虎牙和抖音直播。四个平台追求一致的用户体验，但底层
实现不要求对称。

维护平台适配时优先：

```text
稳定 > 正确 > 平台原生兼容 > 跨平台复用 > 代码形式统一
```

本文描述当前适配器结构。入口重构的目标和完成状态以
`docs/ENTRY_REFACTOR_CHECKLIST.md` 为准。

---

# 1. Current platform boundaries

Bilibili、斗鱼和虎牙共用标准直播运行时：

```text
entries/content.ts
  → entries/content-app.ts
  → createLivePlatformAdapter()
  → platforms/live/* controllers
  → platform sender / feature runtime
```

抖音不经过 `createLivePlatformAdapter()`，而是使用独立的 isolated-world content runtime
和 MAIN-world page runtime。

平台修改默认限制在：

```text
src/platforms/<platform>/
```

只有多个平台以相同语义复用的能力才进入：

```text
src/platforms/live/
src/core/
```

每次修改公共层，都要检查另外三个平台。

---

# 2. Standard adapter contracts

标准三平台当前同时存在两层契约。

`LivePlatformAdapter` 提供：

- 候选查找和 `DanmakuDescriptor` 描述
- 官方编辑器查找
- 发送者解析
- 原生胶囊可见性
- 平台清理

`LiveCandidateAdapter` 提供类型化候选：

```text
chat | overlay | native-capsule
```

以及：

- 能力声明
- 路径命中
- 候选规范化
- 候选描述
- 基于 z-index、绘制顺序和指针距离的稳定排序输入

`createSelectorPlatformAdapter()` 是 Bilibili、斗鱼和虎牙的基础实现。平台特殊行为通过平台
模块或显式 runtime boundary 注入，不要在公共控制器里追加成串的 `platform === ...` 分支。

`platforms/live/adapters.ts` 是当前唯一允许直接登记三个平台工厂、并携带可选斗鱼 runtime
boundary 的公共装配缝；`content-app.ts` 是消费这些平台依赖的 composition root。其它
`platforms/live` 控制器不得直接导入具体平台实现。

平台 adapter 还携带自己的 `LivePlatformConfig`。Bilibili 与斗鱼配置分别位于平台
`config.ts`，虎牙完整配置由 `candidate-config.ts` 导出；斗鱼多正文片段通过
`LiveMessageElementsResolver` 交给通用 descriptor，Bilibili 福袋过滤通过
`RepeatReminderExclusion` 交给通用雷达 adapter。公共模块只看契约，不识别平台模块路径。

上述导入方向由 ESLint 和 `tests/contracts/validate-import-boundaries.cjs` 双重校验，并进入
`npm run check`。新增平台能力时应扩展 adapter 或入口装配，不应为通过检查添加新的公共层例外。

候选描述最终统一为 `DanmakuDescriptor`：

- 平台和来源
- 正文
- 消息 ID
- 发送者 ID/名称
- 有序富文本部件
- 图片资源 ID

---

# 3. Failure diagnosis order

平台失效时不要立即重写 adapter。按顺序检查：

1. Manifest 的 URL、world、`run_at` 和 `all_frames` 是否匹配
2. 共享脚本和对应 content/page entry 是否加载
3. 是否通过 SPA 切换、iframe 或全屏改变了运行位置
4. 是否发生重复初始化或旧 runtime 未销毁
5. player/chat 容器是否重新挂载
6. selector、消息属性或富文本结构是否变化
7. 候选是否被过滤规则排除
8. 官方编辑器、表情面板或发送反馈是否变化
9. 问题是否只出现在登录态、权限表情、网页全屏或 A/B 页面
10. 是否把平台自身系统消息误认成普通弹幕

只修改真正变化的边界。

---

# 4. Selectors and DOM observation

Selector 是第三方依赖，不是稳定 API。优先使用：

- 语义明确的属性
- 稳定容器关系
- 已有 platform config
- 平台提供的消息 ID、资源 ID 或 `alt/rel` 名称

避免依赖自动生成 hash class、`nth-child`、极长 selector 和当前偶然层级。

如果 selector 大量失效，先判断页面是否存在：

- A/B 测试或新旧播放器并存
- 登录态差异
- iframe / Shadow DOM
- Canvas 化
- 虚拟列表节点复用

不要无限堆积失效 fallback。长期 Observer 只观察必要的结构/文本变化，并必须可销毁。

---

# 5. Hover and capsule

视频弹幕交互由三个连续区域组成：

```text
弹幕正文 + 透明 hover bridge + 操作胶囊
```

从正文经过间隙移动到胶囊时，必须保持同一条选择；重叠弹幕一次只允许选中一条。雷达图标和
提示队列区域必须阻断底层弹幕悬停。

胶囊位置使用公共左右判断：

```text
弹幕尚未完整进入，或右侧空间不足 → 左侧
弹幕完整进入且右侧空间足够       → 右侧
```

缩放只改变 UI 尺寸，不改变锚点坐标系。处理 hover 时还要覆盖 pointer leave、节点移除、全屏
宿主变化、胶囊位置变化和点击操作后的恢复。

---

# 6. Rich messages

不要只读取 `textContent`。一条弹幕可能包含文字、Unicode Emoji、图片表情以及多段混排。
`platforms/live/rich-message.ts` 负责平台无关的有序部件和资源键；平台目录负责可信名称、
资源身份和发送 token。

必须区分：

- 用户可见的 display text
- 官方输入需要的 token
- 平台资源 identity
- 规范化资源 URL
- 装饰图片、头像、徽章和真正的弹幕表情

显示名称相同不代表资源相同，资源 ID 相同也不代表可以跨房间发送。

---

# 7. Sending and platform feedback

标准三平台通过 `LivePlatformSender` 暴露：

- `sendText`
- `sendRich`
- `sendFavorite`
- `prepareFavorite`

抖音由独立的 `content/send-controller.ts` 实现相同用户语义。所有路径都应复用官方输入框、
官方表情面板或当前已验证的后备能力，并经过 `SendCoordinator` 的误触、重复、并发和冷却
保护。

发送优先级：

```text
项目已验证的平台路径
> 官方输入框/按钮或官方表情面板
> 已有且受约束的平台内部能力
> 新增低层接口
```

平台返回发送过快、内容重复、禁言、登录失效、资源无权限或内容受限时，要保留清洗后的官方
反馈。不要自动重试绕过限制，也不要输出请求体、Cookie、CSRF、签名或请求头。

---

# 8. Lightweight radar adapter

当前雷达只做高频文字弹幕 `+1` 提醒，不做热词或模型分析。

标准三平台由 `platforms/live/repeat-reminder-adapter.ts` 将 candidate 转成提醒 observation；
抖音由 `platforms/douyin/content/radar-collector.ts` 接收侧聊和 Page Renderer 两个来源。

适配器必须保持：

- 3 秒内聊天/画面镜像合并
- 同一来源真实重复保留
- 图片表情不进入自动提示
- 礼物、福袋、广告和系统消息排除
- 房间切换后清理 suppression 与计数
- 斗鱼只读采集，不观察或改写运动 `style/class/animation`

自动阈值的规模来源是：

- Bilibili：页面观众数；iframe 样本可由 Service Worker 短期中转
- 抖音：页面公开在线人数
- 虎牙、斗鱼：页面贵宾数
- 无可靠规模数据：最近 60 秒弹幕流量，满足预热后再使用迟滞调整

虎牙和斗鱼不得使用直播热度估算人数。

---

# 9. Bilibili

当前主要模块：

```text
src/platforms/bilibili/
├─ adapter.ts
├─ candidate-rules.ts
├─ dom-config.ts
├─ direct-emoticon-send.ts
├─ emoticon-debug.ts
├─ emoticon-metadata.ts
├─ native-send-observer.ts
├─ overlay-motion.ts
├─ repeat-reminder-filter.ts
├─ rich-emoji.ts
├─ rich-message-sender.ts
├─ sender.ts
└─ __tests__/
```

职责要点：

- `candidate-rules.ts`：广告、快捷输入、聊天操作区和播放器区域排除
- `rich-emoji.ts`：官方/房间表情显示名、身份和装饰图隔离
- `sender.ts`：统一文字与富表情发送决策
- `rich-message-sender.ts`：官方表情面板路径
- `direct-emoticon-send.ts`：经过房间和身份校验的后备路径
- `native-send-observer.ts`：官方发送结果观察
- `overlay-motion.ts`：Bilibili 画面弹幕暂停/恢复

Bilibili 使用 `all_frames`。不要假设聊天区、播放器和观众数都位于顶层 frame，也不要在多个
frame 重复显示雷达提示。

图片表情发送优先走官方面板。只有身份唯一、房间一致且 metadata 可信时才可使用直发后备；
禁止根据 `[名称]` 猜测 `official_*` 或 `room_*`。

---

# 10. Douyu

当前主要模块：

```text
src/platforms/douyu/
├─ adapter.ts
├─ message-content.ts
├─ native-capsule.ts
├─ native-hover.ts
├─ native-motion-fallback.ts
├─ rich-emoji.ts
├─ rich-message-sender.ts
├─ sender.ts
└─ __tests__/
```

`adapter.ts` 通过 `DouyuRuntimeBoundary` 聚合：

- 原生胶囊选择器、可见性和目标
- 原生 hover controller
- 运动 fallback
- 多个并列正文片段的顺序合并

必须区分 Danmaku Echo 胶囊与斗鱼原生胶囊。关闭原生胶囊显示不能删除网站 DOM，也不能把
网站节点当成扩展节点清理。

斗鱼移动弹幕会高频写入 transform。公共采集器和 sender 关联观察器不得监听运动属性，不得
在逐帧路径读写布局。悬停问题优先在 `native-hover.ts` / `native-motion-fallback.ts` 修复，
不要将斗鱼暂停模型复制到公共 hover controller。

粉丝专属图片表情由 `rich-emoji.ts` 恢复名称和 token，`sender.ts` 负责通过官方表情面板
触发正确的 `pe` 发送路径；不能退化成仅发送 `[名称]` 的普通文本。

---

# 11. Huya

虎牙已不再只有一个 adapter 和一个 rich sender。当前主要模块：

```text
src/platforms/huya/
├─ adapter.ts
├─ candidate-config.ts
├─ rich-emoji.ts
├─ rich-message-sender.ts
├─ sender.ts
└─ __tests__/
```

- `candidate-config.ts`：聊天区、画面弹幕、正文和发送者 selector
- `rich-emoji.ts`：面板 token、资源键和可信名称恢复
- `sender.ts`：文字/图片表情发送分流

虎牙仍采用 selector adapter，不需要复制 Bilibili 的复杂身份后备或斗鱼的运动控制器。调试
顺序应为候选命中 → 描述/发送者 → 富表情恢复 → 编辑器/发送按钮 → 平台反馈。

---

# 12. Douyin

抖音代码分成共享模型、isolated-world content 模块和 MAIN-world page 模块：

```text
src/platforms/douyin/
├─ barrage-model.ts
├─ chat-message.ts
├─ emoji-catalog.ts
├─ emoji-token.ts
├─ input-order.ts
├─ own-message.ts
├─ protocol.ts
├─ repeat-reminder-filter.ts
├─ rich-data.ts
├─ rich-message-sender.ts
├─ content/
│  ├─ content-app.ts
│  ├─ content-runtime.ts
│  ├─ page-bridge.ts
│  ├─ chat-parser.ts
│  ├─ rich-content-resolver.ts
│  ├─ sender-index.ts
│  ├─ dom-hover-controller.ts
│  ├─ action-dispatcher.ts
│  ├─ editor-controller.ts
│  ├─ send-controller.ts
│  ├─ own-message-controller.ts
│  ├─ radar-collector.ts
│  └─ ...
└─ page/
   ├─ runtime-types.ts
   ├─ page-bridge.ts
   ├─ canvas-hook.ts
   ├─ worker-hook.ts
   ├─ barrage-content.ts
   ├─ content-measurer.ts
   ├─ renderer-instance-registry.ts
   ├─ track-motion.ts
   ├─ channel-scheduler.ts
   ├─ dom-renderer.ts
   ├─ track-controller.ts
   ├─ own-message-matcher.ts
   ├─ diagnostics-controller.ts
   ├─ page-runtime.ts
   ├─ page-app.ts
   └─ __tests__/
```

入口：

```text
entries/douyin-bootstrap.ts
entries/douyin-content.ts
entries/douyin-page-hook.ts
```

`douyin-content.ts` 已是薄启动器，业务修改应进入 `content/` 对应控制器。
`douyin-page-hook.ts` 也已完成 DP-15，当前只负责重复加载保护、创建并启动 runtime；严格类型化的
`page/page-app.ts` 负责模块装配和 Renderer 命令协调。频道
创建、pending 分配、碰撞间距和释放由无 DOM 的 `page/channel-scheduler.ts` 负责，富内容
节点、轨道节点、两阶段帧提交和 Canvas 安全接管/恢复由 `page/dom-renderer.ts` 负责；操作胶囊、
可信激活、左右位置、雷达遮挡和单条悬停由 `page/track-controller.ts` 负责；本人消息意图的
保存、取消、过期和一次性消费由 `page/own-message-matcher.ts` 负责；有界事件、计数、错误脱敏
和低频调试 marker 由 `page/diagnostics-controller.ts` 负责；Hook、bridge、轨道控制器、实例维护、
心跳、路由、全屏、可见性和页面退出由 `page/page-runtime.ts` 统一持有。

---

# 13. Douyin page safety

抖音运行链路可以简化为：

```text
bootstrap / route recovery
  → isolated content runtime
  ⇄ typed protocol
  → MAIN page runtime
  → Worker/MessagePort decoded commands + Canvas ownership
  → interactive DOM barrage
```

必须遵守：

- 原生 Worker 和官方消息调用继续执行
- 不主动拦截 WebSocket
- 只识别带弹幕结构标记的 Canvas
- 普通 Canvas 只执行原生调用
- 未知 Worker/MessagePort 消息透明透传
- 接管确认前不隐藏官方 Canvas
- 心跳超时、Renderer 失败、Canvas 脱离、切房、stop 或 destroy 时恢复 Canvas
- MAIN world 只有 `page/page-bridge.ts` 直接操作跨 world 消息

同时验证 `live.douyin.com/*` 直接进房和 `www.douyin.com/*` SPA 进入/切换直播。

---

# 14. Protocol and network investigation

分析 WebSocket、Worker、MessagePort 或二进制包时必须区分：

- client send
- server response / broadcast
- local echo
- heartbeat / auth / room join
- Renderer 内部命令

二进制分析顺序：

```text
frame → packet header → compression/encoding → payload → message type → direction
```

DevTools 中看到一个 frame 不代表它是发送接口。压缩代码可从 `WebSocket`、`postMessage`、
`Worker`、`fetch`、`TextDecoder`、`ArrayBuffer` 等调用链追踪，但必须用实际方向和行为验证。

---

# 15. Performance and diagnostics

直播页是高负载环境。禁止：

- 短周期扫描整个 document
- 为每条弹幕读取大量 layout
- 在 MutationObserver 中同步执行重解析
- 无界 Map/Set
- 重复 listener/observer
- 生产环境逐条弹幕日志

调试日志统一使用 `[Danmaku Echo][Platform]` 前缀，并输出阶段、结果和清洗后的摘要。平台网络
观察只在用户发送后的短窗口启用。

---

# 16. Tests and verification

平台 Bug 如果可稳定复现，优先用最小 fixture 建立回归：

```text
src/platforms/<platform>/__tests__/
src/platforms/live/__tests__/
src/platforms/douyin/content/__tests__/
src/platforms/douyin/page/__tests__/
tests/contracts/
tests/fixtures/live-dom/
tests/browser/
```

前三类 `src/**/__tests__` 由 Vitest 执行；`tests/contracts` 由 `test:regression` 自动发现；
`tests/browser` 只存放本地可选的浏览器 E2E 工具，不进入 CI。

普通平台修改至少考虑：

```bash
npm run build
npm run test:regression
```

涉及公共层、入口、协议或跨平台行为时运行 `npm run check`。浏览器 E2E 仅为本地可选测试，
不加入 CI。真实 hover、全屏、SPA、Worker/Canvas 和官方发送仍需要直播页手工验证，执行结果
统一记录在 `docs/ENTRY_REFACTOR_REGRESSION.md`。

`npm run test:coverage` 会收集所有平台目录中的可执行 TypeScript（排除测试、纯类型和抖音
composition root），并通过报告契约确认 `rich-message`、sender/send coordinator、hover、
Douyin protocol/track motion 和 repeat-reminder adapter 没有从 coverage 范围中消失。

---

# 17. Adding a platform

新增平台前先确认：

1. 侧聊和画面弹幕来源
2. 消息 ID、发送者和富文本身份
3. 视频弹幕是 DOM、Canvas 还是其它 Renderer
4. 官方编辑器、发送按钮和错误反馈
5. 图片表情权限与 token
6. hover/capsule 是否已有原生机制
7. 普通、网页全屏、iframe 和 SPA 生命周期
8. 雷达应排除的系统消息与可读取规模信号

只有普通 DOM 平台才优先使用 selector adapter；确实需要跨 world 数据或 Renderer 接管时才增加
独立 page hook。架构复杂度必须来自真实需求，不能从现有某个平台整目录复制。

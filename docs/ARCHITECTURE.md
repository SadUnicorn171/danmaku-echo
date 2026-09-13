# Danmaku Echo Architecture

本文记录 Danmaku Echo 当前已经落地的架构边界。它不是目标蓝图，也不把
`docs/ENTRY_REFACTOR_CHECKLIST.md` 中尚未完成的步骤描述成现状。

维护者可以用本文判断：

- 代码运行在哪个 JavaScript world
- 一个功能由谁装配、由谁持有生命周期
- 哪些行为属于平台适配，哪些能力可以跨平台复用
- Service Worker、存储、构建和测试之间如何协作

---

# 1. Runtime overview

Danmaku Echo 是 Manifest V3 扩展，同时构建设置页、Service Worker、共享脚本和多份内容脚本。

## 设置页

```text
App.vue / main.ts
        │
        ├─ components/ + composables/
        └─ chrome.storage.sync（扩展设置）
```

## Bilibili / Douyu / Huya

```text
manifest: shared.js + content.js
        │
        ▼
entries/content.ts                 薄启动器
        │
        ▼
entries/content-app.ts             依赖装配与现存编排胶水
        │
        ├─ platforms/live/*        通用候选、悬停、胶囊、编辑器、发送和生命周期
        ├─ platforms/<platform>/*  平台选择器、富表情、发送与专属边界
        └─ features/*              收藏、高频 +1 提醒
```

三者运行在扩展隔离世界，加载时机为 `document_idle`。Bilibili 使用
`all_frames: true`，其聊天 iframe 可以上报观众数；雷达提示只由顶层页面或当前全屏 frame
显示。

## Douyin

```text
douyin-bootstrap.ts（isolated world）
        │ 发现直接进房或 www.douyin.com SPA 直播路由
        ▼
Service Worker（必要时补注入）
        ├─ douyin-content.ts（isolated world）
        │      └─ platforms/douyin/content/*
        └─ douyin-page-hook.ts（MAIN world）
               └─ platforms/douyin/page/*

isolated world  ⇄  类型化 window.postMessage 协议  ⇄  MAIN world
```

抖音页面 Hook 旁路观察 Worker/MessagePort 已经解码的 Renderer 消息，不拦截
WebSocket，也不替换官方 Worker。只有安全接管条件成立后才隐藏官方 Canvas；失效时必须恢复。

## Service Worker

`entries/service-worker.ts` 不是常驻业务进程。当前职责包括：

- 恢复或补注入抖音 content/page runtime
- 串行写入 `chrome.storage.local` 中的收藏数据
- 缓存抖音表情目录
- 安装一次性的页面 MAIN world 发送观察器
- 执行经过校验的 Bilibili 房间表情后备发送
- 在 Bilibili 多 frame 之间中转短期观众数样本

不要把必须长期存在的状态只放在 Service Worker 全局变量中。

---

# 2. Source ownership

| 目录 | 当前职责 |
| --- | --- |
| `src/core/` | 跨平台类型、设置合并、文本/回复、国际化、剪贴板和诊断基础能力 |
| `src/entries/` | 扩展入口以及入口级依赖装配；入口文件本身应保持轻量 |
| `src/platforms/live/` | Bilibili、斗鱼、虎牙共享的直播候选、DOM、悬停、胶囊、编辑器、富消息、发送保护与生命周期 |
| `src/platforms/<platform>/` | 平台选择器、解析、富表情身份、发送策略和平台专属交互 |
| `src/platforms/douyin/content/` | 抖音隔离世界的解析器、控制器、桥接客户端、装配和生命周期 |
| `src/platforms/douyin/page/` | 抖音 MAIN world 已提取的类型、桥接、Canvas/Worker Hook、内容解析、实例注册、轨道运动、频道调度与 DOM Renderer |
| `src/features/favorites/` | 收藏模型、仓库、房间上下文、排序和直播页收藏入口 |
| `src/features/repeat-reminder/` | 轻量弹幕雷达：采集、去重、相似簇、阈值、流量计、队列和页面 UI |
| `src/components/`、`src/composables/` | 设置页和直播页 Vue UI |

判断一段逻辑是否属于 `core`：删除所有平台名称后它仍应合理存在。判断是否属于
`platforms/live`：至少两个非抖音平台正在以相同语义使用它，并且差异可由明确依赖表达。

---

# 3. Standard live runtime

`entries/content.ts` 当前只调用 `startLiveContentApp()`。实际装配位于
`entries/content-app.ts`：它选择平台适配器、创建控制器和 feature runtime，再交给
`LiveContentRuntime` 统一启动与销毁。

当前已形成的公共边界包括：

- `LiveCandidateAdapter`：查找、规范化和描述聊天/画面/原生胶囊候选
- `SenderIndex`：按消息 ID、正文、时间和节点生命周期关联发送者
- `HoverSelectionController`：单条选择、重叠候选抑制和连续悬停区域
- `CapsuleController`：portal、操作栏、透明 hover bridge、左右定位和全屏宿主
- `EditorController`：输入框发现、回复草稿写入、光标和聚焦
- `LivePlatformSender`：文字、富消息、收藏重发和收藏前规范化
- `SendCoordinator`：误触、重复、并发、冷却、网络观察和平台反馈
- `LiveContentRuntime`：设置监听、页面/全屏/可见性事件、房间切换和资源销毁

`content-app.ts` 仍包含较多装配闭包和兼容胶水。新代码应优先扩展上述模块或平台目录，
不应把已迁出的状态机重新放回入口装配文件。

---

# 4. Platform adapter contracts

`createLivePlatformAdapter()` 当前只接受 `bilibili | douyu | huya`。抖音有独立 runtime，
不经过该工厂。

适配器同时保留两层契约：

- `LivePlatformAdapter`：现有描述、候选、编辑器、发送者和清理接口
- `LiveCandidateAdapter`：类型化的 `chat | overlay | native-capsule` 候选能力

候选描述统一输出 `DanmakuDescriptor`：平台、来源、正文、消息 ID、发送者和富文本资源。
重叠候选使用 z-index、DOM 绘制顺序和指针距离稳定排序。

Bilibili 和虎牙以 selector adapter 为基础，并由平台模块补充候选/富表情/发送规则。
斗鱼另外通过 `DouyuRuntimeBoundary` 暴露原生胶囊、原生 hover、运动兜底和多正文片段能力。
斗鱼运动逻辑不得下沉到通用候选观察器。

`platforms/live/adapters.ts` 是当前允许导入三个平台 adapter 工厂、并暴露可选斗鱼 boundary 的
显式装配缝。各平台 selector/editor 配置、特殊正文解析和雷达排除规则由平台 adapter 暴露，
`platforms/live` 只消费类型化能力，不直接导入平台实现。

该方向由 ESLint `no-restricted-imports` 固化：除 `live/adapters.ts` 外，共享 live 模块不得导入
具体平台；feature 不得深层导入具体平台；非 entry 模块不得反向导入 entry。
`tests/contracts/validate-import-boundaries.cjs` 使用反例验证规则确实生效，并作为 `npm run check` 的构建
校验步骤运行。

---

# 5. Rich messages and sending

跨平台富消息模型位于 `platforms/live/rich-message.ts`。保存和重发的不是单一字符串，而是：

```text
有序文本/图片部件
+ 显示文本
+ 平台资源键与发送 token
+ 平台和房间上下文
```

平台专属名称恢复与身份校验留在各平台目录：

- Bilibili 区分显示名与 `official_*` / `room_*` 资源身份
- 斗鱼识别普通及粉丝专属图片表情，并由 sender 选择原生 `pe` 路径
- 虎牙恢复原生面板 token 和可信图片名称
- 抖音将 `[表情名]` 视为可由官方编辑器解析的文字 token，同时保留原始部件顺序

所有用户触发的发送应经过平台 sender 和 `SendCoordinator`。不得绕过登录、权限、禁言、
重复发送或频率限制；也不得把官方错误统一吞成“发送失败”。

---

# 6. Feature layer

## Favorites

收藏通过 Service Worker 串行写入 `chrome.storage.local`，以避免多 frame 或多 UI 同时写入
造成竞态。数据包含富消息 payload 和房间上下文，schema 变更必须兼容历史数据。

## Lightweight repeat reminder

当前“弹幕雷达”只是高频弹幕 `+1` 提醒，不是旧版热词分析侧栏。它：

- 在当前页面内存中统计最近 60 秒普通文字弹幕
- 合并 3 秒内聊天区/画面双源镜像，但保留同一来源的真实重复
- 以完全相同文本独立计数，以高置信相似簇避免提示队列被近似文案占满
- 排除图片表情、礼物、福袋、广告和平台系统消息
- 支持手动阈值和自动阈值；自动档优先读取 Bilibili/抖音观众数、虎牙/斗鱼贵宾数
- 无可靠人数/贵宾数时，以有预热和迟滞的最近弹幕流量调整阈值
- 在页面内维护提示队列、静默期、倒计时和可选的受保护自动 `+1`

它不持久化弹幕内容，不在 Service Worker 聚合，不生成热词、问题、时间线或摘要，也不使用
本地模型或云端分析。关闭雷达或刷新/切房会清理当前计数。

---

# 7. Douyin isolated-world runtime

`entries/douyin-content.ts` 已是薄启动器。`platforms/douyin/content/content-app.ts` 负责依赖装配，
`content-runtime.ts` 统一持有设置、SPA、可见性、监听器、计时器和逆序销毁。

已拆分的主要控制器包括：

- `chat-parser.ts`：侧边聊天结构化解析
- `rich-content-resolver.ts`：富内容和表情名称恢复
- `sender-index.ts`：画面消息与侧聊发送者关联
- `dom-hover-controller.ts`：侧聊/页面 DOM 的单条悬停和雷达遮挡保护
- `action-dispatcher.ts`：复制、收藏、回复和 `+1` 分发
- `editor-controller.ts`、`send-controller.ts`：官方编辑器与受保护发送
- `own-message-controller.ts`：本人消息意图和双处框选
- `radar-collector.ts`：侧聊与 Renderer 雷达消息的过滤和去重
- `page-bridge.ts`：隔离世界唯一跨 world 通道

不要重新在 `douyin-content.ts` 注册平行监听器或复制这些状态。

---

# 8. Douyin MAIN-world runtime

`entries/douyin-page-hook.ts` 已是严格类型化的薄启动器，只负责重复加载保护、创建页面应用
runtime、登记全局所有权和启动。`page/page-app.ts` 是 MAIN world 的 composition root，负责
构造模块和连接类型化回调，但不重新实现各模块内部算法。当前稳定边界包括：

- `page/runtime-types.ts`：Renderer 实例、轨道、频道、DOM 状态、生命周期和单位类型
- `page/page-bridge.ts`：MAIN world 唯一的 `window.message` / `window.postMessage` 所有者
- `page/canvas-hook.ts`：弹幕 Canvas 识别、Offscreen 映射、共享原型补丁与恢复
- `page/worker-hook.ts`：Worker/MessagePort 旁路观察和 Renderer 命令解析
- `page/barrage-content.ts`：官方 options/content 到 `PreparedBarrage` 的纯解析，供 Renderer 与雷达共享
- `page/content-measurer.ts`：CSS 像素内容测量、图片比例和有界文字度量缓存
- `page/renderer-instance-registry.ts`：实例、Canvas 唯一所有权、孤立消息恢复和销毁
- `page/track-motion.ts`：无 DOM 的位置、速度、暂停恢复、过期和安全间距模型
- `page/channel-scheduler.ts`：无 DOM 的频道同步、pending 分配、多行占位、保留和释放
- `page/dom-renderer.ts`：两阶段帧快照/提交、富内容节点复用、Canvas 安全接管和恢复
- `page/track-controller.ts`：页面胶囊创建/缩放/左右定位、可信激活、雷达遮挡和单条悬停
- `page/own-message-matcher.ts`：本人消息意图保存/取消/过期，以及按消息 ID、富文本签名、资源和正文的一次性匹配
- `page/diagnostics-controller.ts`：有界诊断计数/事件、脱敏错误、按类型采样、低频 marker 快照和调试资源清理
- `page/page-runtime.ts`：Hook、bridge、轨道控制器、实例维护、心跳、路由、全屏、可见性和页面退出的统一生命周期
- `page/page-app.ts`：MAIN world 模块装配、Renderer 命令协调和 runtime 工厂

`DouyinPageRuntime` 是 MAIN world 生命周期的唯一所有者；`page-app.ts` 构造各模块及其回调并
返回 runtime，入口只负责登记和启动。三个目标入口的拆分与严格类型化阶段已全部完成。

安全约束始终成立：官方 Worker 继续工作，未知消息透明透传，观察异常不得阻断官方调用，
接管失败、心跳超时、Canvas 移除、切房、停止或销毁时恢复官方 Canvas。

---

# 9. Cross-world protocol

`platforms/douyin/protocol.ts` 是抖音跨 world 消息的唯一事实来源。协议使用方向明确的判别联合、
版本字段、工厂、运行时守卫和穷尽式分发器。

只有以下桥接模块可以直接操作该通道：

- isolated world：`platforms/douyin/content/page-bridge.ts`
- MAIN world：`platforms/douyin/page/page-bridge.ts`

业务模块通过桥接接口发送请求或事件，不得自行新增 `window.postMessage` 监听。请求/响应必须按
消息类型和 `requestId` 关联，非法或未知消息只能进入有界诊断，不得抛入页面主循环。

---

# 10. Lifecycle and ownership

直播页面必须按完整生命周期设计：

```text
create → start → route/room/visibility/fullscreen change → destroy
```

每个 Observer、listener、timer、RAF、注入节点、悬停锁和隐藏 Canvas 都必须有明确所有者和
对称清理路径。

通用三平台由 `LiveContentRuntime` 统一处理 `pagehide`、storage、pointer、fullscreen、visibility、
scroll、resize、hashchange 和 popstate。切房时先释放瞬时资源和 feature runtime，再按新房间重建。

抖音隔离世界由 `DouyinContentRuntime` 处理同类生命周期；MAIN world 由 `DouyinPageRuntime`
统一管理 Hook、bridge、轨道控制器、实例维护、心跳、路由、全屏、可见性和页面退出。BFCache
往返采用可恢复暂停，普通卸载采用终止销毁；重复启动和销毁均为幂等操作。

---

# 11. Storage

当前只使用两类 Chrome Storage：

- `chrome.storage.sync`：扩展开关、平台设置、颜色、尺寸和雷达配置
- `chrome.storage.local`：收藏、雷达首次说明确认标记、抖音表情目录缓存

雷达计数、提示队列、发送关联、观众 frame 缓存和运行时诊断只存在于页面或 Service Worker
短期内存中，不使用 `chrome.storage.session`，也不会跨刷新恢复。

修改 schema 时允许旧字段缺失并补默认值，不得破坏已有收藏和用户设置。

---

# 12. Build and validation

Vite 按以下 mode 分别构建 IIFE 入口：

```text
popup
background
shared
content
douyin-bootstrap
douyin-content
douyin-page-hook
```

最终扩展位于 `build/extension`。修改 `vite.config.ts`、`public/manifest.json` 或入口时必须检查所有
相关 target、world、加载顺序、`all_frames` 和 host 权限。

验证层级：

```text
type-check → lint → build → manifest/architecture/CI/release validation
           → Vitest coverage → regression tests → optional browser E2E
           → real live-site validation
```

`npm run check` 是完整自动验证入口。`npm run test:browser` 只供本地选择执行，不在 CI 中运行。
真实平台的 DOM、发送、全屏、Worker 和动画时间线仍需手工回归。

测试按运行层级固定归档：Vitest 单元测试与源码相邻放在 `src/**/__tests__`，构建和源码契约
放在 `tests/contracts`，静态 DOM 样本放在 `tests/fixtures`，本地浏览器工具放在
`tests/browser`。`test:regression` 通过目录发现器自动执行全部 `*.test.cjs|mjs|js` 契约文件，
`validate-test-layout.cjs` 会拒绝根目录散落文件、未知分类和手工维护的长测试清单。

Coverage 对 `src/core/**/*.ts`、`src/features/**/*.ts` 和 `src/platforms/**/*.ts` 使用宽范围收集，
只排除类型文件、收藏 UI 入口以及两个抖音 composition root；`src/entries` 由启动/源码契约验证，
不以难以稳定模拟的 DOM 主循环覆盖率作为目标。全局门槛之外，core、features、platforms 分别
设置行、函数和分支门槛。`validate-coverage-report.cjs` 还会确认富消息、发送协调、悬停、协议、
轨道运动和轻量雷达适配等关键模块确实出现在报告中，并阻止覆盖范围退回少量 allowlist。

迁移收尾由 `validate-refactor-cleanup.cjs` 固化：三个薄入口不得恢复 TypeScript 抑制，已删除的
抖音 `track-model.ts` facade、重复 Emoji cache/event-path/patch-slot helper、无外部引用的 selector
导出和空源码目录不得回流。仍有必要的 2.x 设置迁移与抖音无版本协议兼容均标注在 3.0.0 删除。

---

# 13. Architecture change rule

出现以下变化时更新本文：

- runtime entry、运行 world 或注入时机变化
- adapter、sender、feature 或生命周期所有权变化
- Service Worker 职责或 storage 语义变化
- 抖音安全接管或跨 world 协议变化
- build target、Manifest 或 CI 验证链路变化

普通 selector 修复或局部 Bug 不需要更新本文。入口重构进度记录在
`docs/ENTRY_REFACTOR_CHECKLIST.md`，详细消息基线和手工回归表记录在
`docs/ENTRY_RUNTIME_ARCHITECTURE.md`，实际浏览器与真实直播间结果记录在
`docs/ENTRY_REFACTOR_REGRESSION.md`，不要在这些文档中复制完整清单。

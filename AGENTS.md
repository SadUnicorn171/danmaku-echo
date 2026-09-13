# Danmaku Echo — Codex Instructions

## 1. Project

Danmaku Echo / 弹幕回声是一个 Chrome / Microsoft Edge Manifest V3 浏览器扩展。

核心功能：

- 直播弹幕 `+1`
- 回复
- 复制
- 本地收藏
- 收藏快捷面板与轮盘
- 富文本 / Emoji / 平台图片表情处理
- 视频弹幕悬停操作
- 轻量弹幕雷达（高频弹幕 `+1` 提醒）
- 多直播平台统一体验

当前支持：

- Bilibili Live
- Douyu Live
- Huya Live
- Douyin Live

技术栈：

- TypeScript
- Vue 3
- Vite
- Manifest V3
- Vitest
- ESLint
- Oxlint
- Prettier

---

# 2. Communication

默认使用中文与用户交流。

代码、变量、类型、接口、commit message 等继续遵循项目原有语言和命名方式。

回答应直接说明：

- 找到了什么
- 修改了什么
- 验证了什么
- 是否存在限制

不要输出大量与任务无关的教程。

---

# 3. Primary principle

始终优先：

1. 正确理解现有代码
2. 找到问题根因
3. 最小正确修改
4. 保持现有架构
5. 验证修改
6. 避免影响其他平台

不要因为存在更“优雅”的设计，就主动重写已经工作的代码。

---

# 4. Before modifying code

修改前先检查：

```bash
git status
```

如果工作区已经存在未提交修改：

- 不要覆盖它们
- 不要删除它们
- 不要将无关修改混入当前任务
- 不要假设这些修改是 Codex 之前产生的

然后通过搜索和调用关系定位代码。

不要一开始读取整个仓库。

优先搜索：

- 功能名称
- 平台名称
- 类型名
- selector
- message type
- adapter
- sender
- entrypoint
- 测试

---

# 5. Repository map

主要代码边界：

```text
src/core/
```

放跨平台共享类型、文本处理、设置合并等核心逻辑。

```text
src/entries/
```

放浏览器扩展运行时入口。

当前实际构建入口包括：

- `content.ts`
- `service-worker.ts`
- `douyin-bootstrap.ts`
- `douyin-content.ts`
- `douyin-page-hook.ts`

入口旁的通用三平台装配模块是 `content-app.ts`。

`content.ts` 和 `douyin-content.ts` 已是薄启动器；通用三平台装配当前位于
`content-app.ts`，抖音隔离世界装配位于
`src/platforms/douyin/content/content-app.ts`。不要把复杂业务逻辑重新堆回薄入口，
也不要继续扩大装配文件中的平台细节。

```text
src/features/
```

放独立功能。

当前包括：

- `favorites/`
- `repeat-reminder/`

`repeat-reminder/` 是页面内存中的高频弹幕 `+1` 提醒，不是热词、问题、摘要或模型分析系统。

```text
src/platforms/
```

放平台适配代码。

包括：

- `bilibili/`
- `douyin/`
- `douyu/`
- `huya/`
- `live/`

`live/` 用于真正跨平台的直播公共能力。

平台专属行为不要泄漏到公共代码。

当前 `src/platforms/live/adapters.ts` 是允许引用三个平台 adapter 工厂和斗鱼可选 runtime
boundary 的显式装配缝；除该工厂和 entry composition root 外，通用控制器不应直接导入平台实现。

抖音平台内部还分为：

- `src/platforms/douyin/content/`：扩展隔离世界
- `src/platforms/douyin/page/`：页面 MAIN world

---

# 6. Architecture boundaries

优先保持：

```text
Platform-specific page/data
        ↓
Platform adapter / parser / controller
        ↓
shared live behavior（适用时）
        ↓
feature layer
        ↓
UI / send / favorite / reply
```

不要让公共模块通过大量：

```ts
if (platform === 'douyu') ...
if (platform === 'bilibili') ...
```

实现平台行为。

平台差异优先留在：

```text
src/platforms/<platform>/
```

如果多个平台真正共享相同行为，再提取到公共层。

不要为了“未来可能复用”提前抽象。

---

# 7. Platform behavior is not symmetrical

不要假设四个平台实现方式完全相同。

当前代码结构本身就存在明显差异。

修改某个平台时首先阅读该平台已有实现。

不要为了统一目录结构而强制：

- 添加无意义 adapter
- 添加空 wrapper
- 创建统一但复杂的 interface
- 重写成熟的平台实现

统一用户体验不等于强制统一底层实现。

---

# 8. Bilibili

Bilibili 相关逻辑主要位于：

```text
src/platforms/bilibili/
```

修改之前优先检查：

- `adapter.ts`
- `candidate-rules.ts`
- `dom-config.ts`
- `rich-emoji.ts`
- `sender.ts`
- `rich-message-sender.ts`
- `direct-emoticon-send.ts`
- `emoticon-metadata.ts`
- `native-send-observer.ts`
- `overlay-motion.ts`
- 对应 `__tests__/`

Bilibili 富弹幕和图片表情存在官方输入面板与后备发送逻辑。

不要随意把图片表情退化为普通文字。

不要绕过现有资源校验直接发送房间资源。

修改发送逻辑时必须同时考虑：

- 普通文字
- Unicode Emoji
- 图片表情
- 文字与表情混排
- 当前直播间
- 官方输入路径
- 后备发送路径

---

# 9. Douyin

Douyin 是项目中最特殊的平台。

相关入口：

```text
src/entries/douyin-bootstrap.ts
src/entries/douyin-content.ts
src/entries/douyin-page-hook.ts
```

相关模型：

```text
src/platforms/douyin/
```

当前分层包括：

- 根目录：barrage/track model、chat message、emoji catalog/token、rich data、
  protocol、own message、input order 和 rich message sender
- `content/`：侧聊解析、富内容恢复、发送者索引、悬停、操作分发、编辑器、发送、
  本人消息、雷达采集、page bridge、装配和生命周期
- `page/`：Renderer 类型、MAIN world page bridge、Canvas Hook、Worker/MessagePort Hook、
  官方弹幕内容解析器、CSS 像素内容测量器、Renderer 实例注册表、纯轨道运动模型和
  无 DOM 频道调度器、两阶段提交的 DOM Renderer、页面胶囊与单条悬停控制器，
  本人弹幕匹配器、页面诊断控制器、MAIN world 总生命周期 runtime 和页面装配工厂

`douyin-content.ts` 和 `douyin-page-hook.ts` 均已完成拆分并删除 `@ts-nocheck`。
`douyin-page-hook.ts` 只负责重复加载保护、创建并启动 runtime；MAIN world 装配位于
`page/page-app.ts`，总生命周期由 `page/page-runtime.ts` 统一持有。DP-01 至 DP-15 已完成。

当前抖音视频弹幕采用安全 DOM 接管架构。

除非用户明确要求改变架构：

不要将其重写为：

- 主动拦截 WebSocket
- 复制原生 Canvas 像素
- 直接替换官方 Worker
- 依赖私有 WebSocket 发包

修改抖音代码时必须考虑：

- `live.douyin.com`
- `www.douyin.com` SPA 进入直播
- 切换直播间
- Worker 生命周期
- Canvas 恢复
- DOM 接管失败回退
- 全屏
- 页面销毁
- 重复初始化

出现异常时，扩展应尽可能恢复官方原生行为，而不是留下隐藏 Canvas 或失效弹幕层。

---

# 10. Douyu

Douyu 相关逻辑位于：

```text
src/platforms/douyu/
```

优先检查：

- `adapter.ts`
- `message-content.ts`
- `native-capsule.ts`
- `native-hover.ts`
- `native-motion-fallback.ts`
- `rich-emoji.ts`
- `rich-message-sender.ts`
- `sender.ts`

斗鱼自身已经存在原生弹幕交互能力。

修改扩展胶囊时注意区分：

- Danmaku Echo 胶囊
- 斗鱼原生胶囊

不要因为隐藏扩展元素而误删、破坏或永久修改斗鱼原生功能。

---

# 11. Huya

Huya 相关逻辑位于：

```text
src/platforms/huya/
```

优先检查：

- `adapter.ts`
- `candidate-config.ts`
- `rich-emoji.ts`
- `rich-message-sender.ts`
- `sender.ts`

虎牙仍以 selector adapter 为基础，平台层比 Bilibili、抖音轻量。

不要为了与 Bilibili 或 Douyin 对齐而人为增加复杂层级。

如果现有 adapter 已能表达行为，优先继续扩展 adapter。

---

# 12. DOM

直播网站是动态页面。

不要假设：

```text
DOMContentLoaded
```

之后 DOM 不再变化。

必须考虑：

- SPA
- 切房
- React/Vue 重渲染
- 播放器重新创建
- 聊天容器替换
- 全屏容器变化

MutationObserver 应尽可能监听最小范围。

创建 Observer、Listener、Timer 后必须考虑清理。

禁止通过大量短周期轮询扫描整个 document。

---

# 13. Content script vs page context

牢记：

```text
Content Script
≠
Page JavaScript Context
```

不要假设 content script 可以直接访问页面内部对象。

需要 page context 数据时：

优先复用项目已有：

- page hook
- script injection
- postMessage / event channel

不要为了一个新功能新增第二套平行通信协议。

---

# 14. Manifest V3

不要假设：

```text
service worker 永久运行
```

不要把长期业务状态只保存在 background 全局变量。

修改 Service Worker 时考虑：

- suspend
- restart
- extension reload
- tab reload
- 多标签页

持久数据根据当前架构使用 Chrome Storage。

当前 Service Worker 还负责收藏串行写入、抖音 SPA runtime 补注入、抖音表情目录缓存、
短期 Bilibili frame 观众数中转、一次性发送观察器和受校验的 Bilibili 房间表情后备发送。
不要把这些能力误写成常驻后台聚合服务。

---

# 15. Storage

当前项目存在：

```text
chrome.storage.local
chrome.storage.sync
```

它们用途不同。

不要随意互换。

`storage.sync` 保存扩展设置；`storage.local` 保存收藏、雷达首次说明确认标记和抖音表情
目录缓存，以及脱敏运行日志。雷达计数、提示队列、发送关联和观众/贵宾短期样本只存在于运行时内存，不使用
`chrome.storage.session`，刷新后不会恢复。

收藏等本地数据与设置同步逻辑必须保持当前语义。

修改 storage schema 时考虑：

- 旧版本数据兼容
- 缺失字段
- 默认值
- 数据迁移

不要因为新字段出现就让旧用户数据失效。

---

# 16. Sending danmaku

优先沿用各平台已有官方输入与发送流程。

不要为了减少代码而把四个平台发送逻辑强制合并。

发送逻辑必须考虑：

- cooldown
- duplicate click
- concurrent send
- official error
- mute/rate limit
- rich content
- input focus
- full-screen input

不要使用固定 `setTimeout` 来掩盖状态同步问题。

当前 Bilibili、斗鱼、虎牙统一通过 `LivePlatformSender` 和 `SendCoordinator`；抖音通过
`content/send-controller.ts` 接入同一发送保护语义。平台 sender 负责 token/面板/后备路径，
协调器负责误触、重复、并发、冷却、网络观察和官方反馈。

---

# 17. WebSocket / protocol analysis

如果任务涉及 WebSocket、Worker、二进制 payload 或协议分析：

不要根据：

- URL
- 函数名
- 变量名
- 单个 frame

直接得出结论。

必须区分：

- client send
- server response
- server broadcast
- echo
- heartbeat
- auth
- room join
- system message

Base64 数据应先：

```text
Base64
→ bytes
→ header
→ encoding / compression
→ payload
→ message type
```

再判断业务含义。

不要把服务器回显误认为客户端发送协议。

---

# 18. Rich messages

富消息是项目的重要能力。

不要只保留：

```ts
content: string
```

而丢失已有：

- token 顺序
- emoji/resource identity
- display text
- 平台资源信息

修改富消息数据结构时，检查：

- 收藏
- 去重
- 再发送
- 跨直播间行为
- 旧数据兼容

---

# 19. Performance

直播页面本身负载较高。

避免：

- 高频全 DOM 扫描
- 无限 Map/Set 增长
- 重复 observer
- 重复 event listener
- 每条弹幕大量日志
- O(n²) 历史弹幕比较

优先：

- 事件驱动
- 有界缓存
- Map / Set
- 明确 cleanup
- 滑动窗口

轻量雷达只统计当前页面最近 60 秒普通文字弹幕。它会合并聊天区/画面的短时镜像，排除图片
表情、礼物、福袋、广告和系统消息；自动档优先读取 Bilibili/抖音观众数、虎牙/斗鱼贵宾数，
不可用时才按有预热和迟滞的弹幕流量调整阈值。禁止恢复旧版热词侧栏、本地模型、云端分析
或持久化弹幕内容，除非用户明确提出新的功能变更。

---

# 20. UI

新增设置页或组件前阅读：

```text
docs/DESIGN_SYSTEM.md
```

优先复用：

```text
src/components/
src/composables/
src/assets/styles/
```

不要为了一个小功能引入新的 UI 框架。

避免第三方站点 CSS 污染扩展 UI。

---

# 21. Entry architecture

如果修改：

```text
src/entries/
```

先阅读：

```text
docs/ENTRY_REFACTOR_CHECKLIST.md
docs/ENTRY_RUNTIME_ARCHITECTURE.md
```

特别注意：

- 注入顺序
- manifest 对应关系
- page/content 边界
- 抖音专用入口
- build mode
- 当前已完成步骤与尚未完成的 DP/F 步骤

不要随意合并入口文件。

---

# 22. Release-related changes

涉及：

- version
- manifest
- permissions
- packaging
- release
- store metadata

时先阅读：

```text
docs/RELEASE_CHECKLIST.md
```

不要手动复制版本号到多个位置，除非现有发布流程要求。

不要无必要添加新的 extension permission 或 host permission。

---

# 23. Security and privacy

禁止主动加入：

- `eval`
- `new Function`
- 远程下载并执行 JavaScript
- 用户密码收集
- Cookie/token 上传
- 无关浏览记录收集
- 隐藏的数据上传

本地可完成的功能优先本地完成。

保持 Chrome Web Store / Edge Add-ons 可审核性。

---

# 24. Dependencies

新增依赖前先判断：

1. 浏览器原生 API 能否完成
2. 项目现有依赖能否完成
3. 是否真的值得增加 dependency

不要为了几十行简单逻辑引入大型库。

不要无理由升级整个依赖树或修改 lockfile。

---

# 25. Verification

根据修改范围选择验证。

### 文档修改

通常无需执行完整测试。

### 小型 TypeScript / Vue 修改

至少考虑：

```bash
npm run type-check
npm run lint:check
```

### 平台逻辑 / Content Script / Entry 修改

至少执行：

```bash
npm run build
npm run test:regression
```

### 较大功能、跨平台或发布相关修改

优先执行：

```bash
npm run check
```

`npm run check` 是项目主要的完整验证入口。

### 浏览器真实交互相关

必要时执行：

```bash
npm run test:browser
```

浏览器 E2E 是本地可选测试，不得加入 CI。

自动测试无法完全覆盖直播网站真实 DOM 时，明确说明仍需要真实页面验证。

---

# 26. Do not claim unverified success

没有运行测试时不要说：

```text
测试通过
```

应该说：

```text
未运行测试
```

如果某项只能在真实直播间验证，也必须明确指出。

---

# 27. Git safety

未经用户明确要求，禁止执行：

```bash
git commit
git push
git reset --hard
git clean -fd
git rebase
git push --force
```

不要擅自：

- 创建分支
- 切换 main/dev
- 删除文件
- 修改 Git 历史

修改结束后使用：

```bash
git diff
```

确认实际 diff。

---

# 28. Scope control

发现当前任务之外的问题时可以指出，但不要顺手重构。

例如：

```text
正在修斗鱼 hover bug
```

不要同时：

- 重写收藏系统
- 升级 Vue
- 修改 Bilibili adapter
- 格式化整个仓库

除非这些修改是解决问题所必需的。

---

# 29. Documentation

架构相关任务阅读：

```text
docs/ARCHITECTURE.md
```

平台相关任务阅读：

```text
docs/PLATFORM_ADAPTERS.md
```

UI 相关任务阅读：

```text
docs/DESIGN_SYSTEM.md
```

入口相关任务阅读：

```text
docs/ENTRY_REFACTOR_CHECKLIST.md
```

发布相关任务阅读：

```text
docs/RELEASE_CHECKLIST.md
```

不要把所有细节继续堆进 `AGENTS.md`。

当架构发生长期变化时，应更新对应 docs。

---

# 30. Completion response

代码任务完成后使用简洁格式：

```text
已完成。

修改：
- ...
- ...

关键文件：
- ...

验证：
- npm run ...
- ...

仍需注意：
- ...
```

不要逐行复述代码。

---

# 31. Priority

发生冲突时优先级：

1. 用户当前明确要求
2. 当前代码的真实行为
3. 对应项目文档
4. 本 AGENTS.md
5. 通用最佳实践

最终原则：

```text
实际代码与实际数据
>
猜测
```

```text
最小正确修改
>
无关重构
```

```text
稳定与可验证
>
为了抽象而抽象
```

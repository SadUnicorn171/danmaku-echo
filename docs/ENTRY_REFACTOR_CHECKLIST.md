# 内容脚本入口拆分与类型化清单

> 适用范围：`src/entries/content.ts`、`src/entries/douyin-content.ts`、`src/entries/douyin-page-hook.ts`，以及与三者直接通信的 `src/entries/douyin-bootstrap.ts`。
>
> 本清单只做结构重构和类型安全改造。除非某一步明确说明，否则不得顺带修改交互、动画、发送策略、雷达阈值、表情识别规则或平台兼容行为。

## 1. 使用方法

后续每次改动只选择一个编号，示例：

```text
按照 docs/ENTRY_REFACTOR_CHECKLIST.md 执行 C-03。
只完成这个步骤，不继续后续步骤；完成测试后更新清单状态和实施记录。
```

状态约定：

- `[ ]`：尚未开始。
- `[-]`：正在进行，但没有满足完成标准。
- `[x]`：代码、测试和文档均满足本步骤完成标准。
- `[!]`：遇到阻塞；必须在实施记录中写明原因，不能跳过后直接假定完成。

执行规则：

1. 每次开始前确认上游依赖步骤已经完成。
2. 每一步先迁移现有行为，再做类型收紧；不得在同一步重写算法。
3. 新模块不得通过新的全局变量继续共享入口状态。
4. 有状态模块必须提供显式的 `start()` / `destroy()`，或者等价的可回收生命周期。
5. 所有事件监听、`MutationObserver`、`ResizeObserver`、RAF 和计时器必须能被释放。
6. 抖音 MAIN world 与扩展隔离世界只能通过已定义的协议通信。
7. 斗鱼采集和通用重构不得新增对弹幕运动 `style/class/animation` 的高频观察或改写。
8. 浏览器 E2E 继续作为本地可选测试，不加入 CI。
9. 每完成一个编号，在本文末尾“实施记录”添加日期、编号、变更摘要、测试结果和遗留问题。

## 2. 最终目标

完成全部清单后应满足：

- 三个大型入口全部删除 `@ts-nocheck`。
- `content.ts` 只负责检测平台、创建运行时、启动和销毁。
- `douyin-content.ts` 只负责创建抖音隔离世界运行时。
- `douyin-page-hook.ts` 只负责创建抖音 MAIN world 运行时。
- `douyin-bootstrap.ts` 继续保持轻量，仅负责 SPA 路由与运行时注入。
- 平台选择器、富文本解析、发送、悬停、采集和渲染均在明确模块中实现。
- 所有 `window.postMessage` 消息拥有精确的判别联合类型和运行时校验。
- 通用直播层不直接依赖 Bilibili、斗鱼、虎牙或抖音的具体实现。
- 任意运行时销毁后，不残留监听器、观察器、计时器、RAF、悬停锁或隐藏 Canvas。
- `npm run check` 通过，四个平台普通页面和网页全屏手工回归通过。

目标不是机械追求行数，但可用以下规模判断入口是否真正完成瘦身：

| 文件 | 当前约行数 | 建议最终范围 | 最终职责 |
| --- | ---: | ---: | --- |
| `content.ts` | 5878 | 100–400 | 三个平台通用运行时组装 |
| `douyin-content.ts` | 3698 | 50–250 | 抖音隔离世界运行时组装 |
| `douyin-page-hook.ts` | 2470 | 50–200 | 抖音 MAIN world 运行时组装 |
| `douyin-bootstrap.ts` | 266 | 不强制缩减 | SPA 路由检测与注入恢复 |

## 3. 推荐目标目录

目录可以在实施过程中按实际依赖微调，但职责边界不能倒退。

```text
src/
  entries/
    content.ts
    douyin-bootstrap.ts
    douyin-content.ts
    douyin-page-hook.ts

  platforms/
    live/
      runtime/
      dom/
      candidate/
      rich-message/
      hover/
      actions/

    bilibili/
      candidate/
      emoji/
      hover/
      sending/

    douyu/
      candidate/
      emoji/
      hover/
      sending/

    huya/
      candidate/
      emoji/
      hover/
      sending/

    douyin/
      protocol/
      content/
      page/
```

## 4. 阶段 R：基线与安全网

### [x] R-01 记录入口职责和跨入口通信

要做什么：

- 新增一份入口关系说明，记录四个脚本分别运行在哪个 JavaScript world。
- 记录 `douyin-bootstrap → service worker → douyin-content/page-hook` 的注入流程。
- 记录 `douyin-content ↔ douyin-page-hook` 当前所有消息类型。

实现什么：

- 后续拆分时有一个不依赖代码行号的职责基线。
- 明确 MAIN world 不可直接使用扩展私有 API，隔离世界不可直接读取页面内部 Worker 对象。

验证：

- 对照 `public/manifest.json`、`service-worker.ts` 和三个抖音入口检查说明完整性。
- 不修改运行代码。

完成标准：

- 文档列出每个入口的加载时机、运行世界、输入、输出和销毁条件。

### [x] R-02 建立重构前行为测试清单

要做什么：

- 将现有自动测试映射到悬停、胶囊、发送、回复、收藏、表情、雷达、本人弹幕和抖音 Canvas 接管。
- 标记缺少自动测试的关键行为。
- 为四个平台建立固定的手工回归表。

实现什么：

- 每次迁移后能判断是结构变化还是功能回归。

验证：

- 运行一次 `npm run check`，把结果写入实施记录。
- 浏览器 E2E 只登记为本地可选项，不修改 CI。

完成标准：

- 每项关键功能至少对应一个自动测试或明确的手工验证项。

### [x] R-03 补充关键 DOM fixture

要做什么：

- 为 Bilibili、虎牙、斗鱼的侧聊和画面弹幕补充最小 DOM fixture。
- 为抖音侧聊、普通弹幕、图片表情、礼物、福袋和本人弹幕补充 fixture。
- fixture 必须删除用户名、Cookie、令牌和无关页面内容。

实现什么：

- 后续 DOM 解析器可以脱离真实直播页测试。

验证：

- fixture 能被测试加载。
- 不包含账号凭据和网络请求头。

完成标准：

- 四个平台的正文、发送者、消息 ID 和图片表情至少各有一个可重复测试样本。

## 5. 阶段 P：抖音跨世界协议类型化

### [x] P-01 定义协议公共基础类型

依赖：`R-01`。

要做什么：

- 将现有宽泛的 `DouyinProtocolMessage` 拆成方向明确的消息类型。
- 定义 `DouyinContentToPageMessage` 和 `DouyinPageToContentMessage`。
- 定义品牌化的 `DouyinRequestId` 或统一的 `string | number` 约束。
- 增加协议版本字段，并确定兼容旧消息时的默认版本。

实现什么：

- 编译器能够根据 `message.type` 自动收窄 payload。
- 禁止任意字符串消息直接进入处理器。

验证：

- 为合法消息、错误 source、未知 type、缺失字段分别添加测试。

完成标准：

- `protocol.ts` 不再包含 `[key: string]: unknown` 的通配消息接口。

### [x] P-02 类型化 content → page 消息

依赖：`P-01`。

要做什么：

- 为以下消息逐一建立精确结构和守卫：
  - `ping`
  - `debug-request`
  - `renderer-settings`
  - `emoji-catalog`
  - `renderer-message-resolved`
  - `own-message-intent`
  - `own-message-cancel`
  - `renderer-result`
  - `renderer-favorite-result`
- 把创建消息的代码集中到协议工厂，避免两处手写字段。

实现什么：

- MAIN world 收到消息前完成字段、数组长度和基础值域校验。

验证：

- 每个消息类型至少一个成功用例和一个拒绝用例。

完成标准：

- `douyin-page-hook.ts` 不再直接信任 `event.data` 的任意字段。

### [x] P-03 类型化 page → content 消息

依赖：`P-01`。

要做什么：

- 为以下消息逐一建立精确结构和守卫：
  - `ready`
  - `renderer-ready`
  - `debug-snapshot`
  - `repeat-reminder-message`
  - `renderer-activate`
  - `renderer-reply`
  - `renderer-favorite`
  - `own-message-consumed`
- 定义操作结果和失败原因联合类型。

实现什么：

- 隔离世界只能处理通过守卫验证的页面消息。

验证：

- 测试错误 request ID、错误 payload、未知 action 和来源伪造。

完成标准：

- `douyin-content.ts` 中所有 `event.data.type` 分支均接收已收窄的消息类型。

### [x] P-04 建立穷尽式协议分发器

依赖：`P-02`、`P-03`。

要做什么：

- 两端分别实现一个 `switch (message.type)` 分发器。
- 使用 `assertNever` 保证新增消息时必须同步增加处理逻辑。
- 未知或非法消息只增加诊断计数，不抛出到页面主循环。

实现什么：

- 协议定义成为 content/page 通信的唯一事实来源。

验证：

- 类型测试证明删除任一 case 会触发编译错误。
- `npm run check` 通过。

完成标准：

- 两个大型抖音入口中不再散落协议类型判断。

### [x] P-05 让 bootstrap 复用 ready/ping 协议

依赖：`P-04`。

要做什么：

- 删除 `douyin-bootstrap.ts` 内重复的宽泛 `PageReadyMessage`。
- 复用协议中的 `ready` 和 `ping` 类型/守卫。
- 保持现有注入重试时间和 SPA 路由逻辑不变。

实现什么：

- 三个抖音脚本不再各自定义同名消息结构。

验证：

- bootstrap 现有测试通过。
- 直接进入直播页和 SPA 进入直播页的注入流程不变。

完成标准：

- bootstrap 仍然没有 `@ts-nocheck`，且不增加业务职责。

## 6. 阶段 C：拆分并类型化 `content.ts`

### [x] C-01 定义通用运行时状态类型

依赖：`R-02`。

要做什么：

- 定义 `LiveContentRuntimeState`。
- 将候选节点、候选类型、正文、发送者、富文本和选择时间组合为 `LiveSelection`。
- 给 roots、缓存、动画快照、计时器、观察器和 UI 引用补充类型。
- 为全局加载标志和 `DanmakuEchoShared` 添加 `global.d.ts` 声明。

实现什么：

- 后续模块不再接收一个无边界的可变 `state` 对象。

验证：

- 本步骤允许入口继续保留 `@ts-nocheck`，但新增类型模块自身必须通过类型检查。

完成标准：

- 状态中的每个字段都有明确类型和所有权说明。

### [x] C-02 提取深层 DOM 查询工具

依赖：`C-01`。

要做什么：

- 提取 `refreshRoots`、`queryAllDeep`、`queryDocumentElements`。
- 提取 `matchesAny`、`closestFromPath`、`closestMatching` 和 composed-tree 遍历。
- 通过参数传入 document、roots 和 selectors，不读取入口闭包状态。

实现什么：

- Shadow DOM/iframe 查询形成可测试的公共工具。

验证：

- 测试普通 DOM、开放 Shadow DOM、重复根节点和无效选择器。

完成标准：

- 入口中不再实现通用深层查询算法。

### [x] C-03 提取通用文本与元素序列化

依赖：`C-02`。

要做什么：

- 提取 `serializedTextFromElement`、`elementMarker`、基础可见性判断。
- 明确忽略按钮、装饰图标、平台胶囊和扩展自有节点的规则。
- 保留数字、Unicode Emoji 和图片表情顺序。

实现什么：

- 文本解析不再依赖当前悬停状态。

验证：

- 使用四平台 fixture 测试正文不会混入 `+1/回复/收藏` 文案。

完成标准：

- 文本序列化模块为纯函数，并有平台无关测试。

### [x] C-04 建立候选弹幕接口

依赖：`C-01`、`C-02`。

要做什么：

- 定义 `LiveCandidateKind`、`LiveCandidateDescriptor` 和 `LiveCandidateAdapter`。
- 将聊天区候选、画面候选、规范化候选和描述候选设为显式能力。
- 规定重叠弹幕选择的稳定排序输入。

实现什么：

- 通用入口不再通过大量 `platformId === ...` 判断候选。

验证：

- 为三个平台适配器建立契约测试。

完成标准：

- 候选接口能够表示聊天区、画面弹幕和平台原生胶囊来源。

### [x] C-05 迁移 Bilibili 候选规则

依赖：`C-04`。

要做什么：

- 将 Bilibili 广告、快捷输入区、播放器区域和 `.bili-danmaku-x-dm` 判断迁入 Bilibili 目录。
- 保留福袋/广告排除和多 iframe 行为。

实现什么：

- 通用入口不知道 Bilibili 的 class、文案和广告标志。

验证：

- 正常弹幕可选；广告、福袋、播放器设置项不可选。

完成标准：

- `content.ts` 不再声明 Bilibili 候选相关 selector 常量。

### [x] C-06 迁移斗鱼候选和原生胶囊边界

依赖：`C-04`。

要做什么：

- 将斗鱼正文片段合并、原生胶囊边界和候选命中迁入斗鱼目录。
- 保持当前原生悬停和运动控制器行为。
- 不在通用观察器中新增运动属性观察。

实现什么：

- 斗鱼 DOM 特例完全由斗鱼适配器拥有。

验证：

- 多正文片段按页面顺序合并。
- 重叠弹幕一次只选一条。
- 悬停、移出和原生胶囊无新抖动。

完成标准：

- `content.ts` 不再直接导入斗鱼 `message-content`、native hover 或 native capsule 选择器。

### [x] C-07 迁移虎牙候选规则

依赖：`C-04`。

要做什么：

- 将虎牙聊天区、画面弹幕和图片表情候选规则迁入虎牙目录。
- 保持聊天区胶囊开关和全屏行为。

实现什么：

- 虎牙选择器不再泄漏到通用入口。

验证：

- 普通文本、图片表情和全屏弹幕均可正确描述。

完成标准：

- 虎牙候选查找只通过适配器公开能力调用。

### [x] C-08 提取富文本公共模型和 DOM 解析器

依赖：`C-03`。

要做什么：

- 定义统一的 `RichMessagePayload`、`RichMessagePart`、`RichEmojiAsset`。
- 提取 DOM 中正文和图片部件的顺序遍历。
- 将当前借用抖音 `normalizedAssetKeys` 的通用算法迁入 live 公共层。

实现什么：

- 四个平台可以共享资源键算法，但不共享平台特有命名规则。

验证：

- 文字、单图、多图、图文混排和 Unicode Emoji 测试通过。

完成标准：

- 通用入口不再直接导入抖音 `rich-data`。

### [x] C-09 迁移 Bilibili 富表情补全

依赖：`C-08`。

要做什么：

- 将官方表情、房间表情、`official_*`、`room_*`、alt 名称和装饰图隔离逻辑放入 Bilibili emoji 模块。
- 统一聊天区和画面弹幕的展示名称解析。

实现什么：

- 收藏和 +1 共用同一份可信表情描述。

验证：

- 覆盖房间表情、官方表情、荣耀等级勋章、粉丝勋章和头像。

完成标准：

- `content.ts` 不再实现 Bilibili 表情名称评分和补全。

### [x] C-10 迁移斗鱼和虎牙富表情补全

依赖：`C-08`。

要做什么：

- 斗鱼处理 `img[rel]`、普通表情和粉丝专属表情。
- 虎牙处理表情面板 token、资源 URL 和文字回退。
- 每个平台返回统一 `RichEmojiAsset`。

实现什么：

- 收藏展示名称和发送 token 不再由入口临时拼装。

验证：

- 覆盖普通表情、专属表情、资源缺失和纯文字回退。

完成标准：

- 入口不再包含斗鱼/虎牙表情 DOM 细节。

### [x] C-11 提取发送者关联服务

依赖：`C-04`、`C-08`。

要做什么：

- 将 sender cache 扫描、消息 ID 提取和聊天区匹配封装为 `SenderIndex`。
- 平台只提供发送者字段和消息 ID 的提取策略。
- 明确 TTL、容量和虚拟列表节点移除策略。

实现什么：

- 回复功能不再直接依赖入口的多个 Map 和扫描计时器。

验证：

- 相同文本不同用户、消息 ID 命中、超时和节点复用测试通过。

完成标准：

- 入口只调用 `senderIndex.resolve(candidate)`。

### [x] C-12 提取悬停选择控制器

依赖：`C-04`。

要做什么：

- 封装 pointer over/move/out、候选选中、延迟隐藏和清理。
- 将弹幕正文、间隔桥和操作胶囊视为一个连续交互区域。
- 将雷达 UI 命中判断作为注入的 pointer guard。

实现什么：

- 每一时刻最多一个 `LiveSelection`。
- 平台运动控制通过接口执行，不由选择器直接修改动画。

验证：

- 测试正文到胶囊间隙、重叠弹幕、雷达覆盖、快速移入移出。

完成标准：

- 入口不再直接实现主要 pointer 状态机。

### [x] C-13 提取胶囊与悬停桥控制器

依赖：`C-12`。

要做什么：

- 封装 portal、action bar、hover bridge、左右位置和 viewport 更新。
- 保持缩放后锚点稳定。
- UI 只消费 `LiveSelection`，不重新解析弹幕。

实现什么：

- 胶囊布局与候选识别解耦。

验证：

- 弹幕未完全进入时显示左侧；空间足够后显示右侧。
- 普通模式和全屏模式位置正确。

完成标准：

- 入口不再保存 portal、button、bridge 的具体 DOM 操作逻辑。

### [x] C-14 提取编辑器与回复控制器

依赖：`C-11`。

要做什么：

- 封装输入面评分、官方编辑器查找、设置文本、光标定位和聚焦。
- 普通模式和全屏模式通过平台策略选择编辑器。
- 回复只填入 `@发送者 `，绝不自动发送。

实现什么：

- 回复流程可以独立测试和报告失败原因。

验证：

- 覆盖 contenteditable、input、textarea、快捷输入栏和无编辑器状态。

完成标准：

- 入口只调用 `replyController.prepare(selection)`。

### [x] C-15 提取通用发送协调器

依赖：`C-08`、`C-14`。

要做什么：

- 统一发送保护、网络观察、输入消费检测和结果提示。
- 定义 `SendResult`、`SendMethod`、`SendFailureReason`。
- 平台发送策略返回结构化结果，不直接操作 toast。

实现什么：

- 冷却、重复保护、平台限流和官方错误反馈只有一个协调入口。

验证：

- 覆盖成功、重复、冷却、并发、频率限制、禁言和超时。

完成标准：

- 入口不再实现 `beginProtectedSend` / `finishProtectedSend` 的业务细节。

### [x] C-16 迁移 Bilibili 发送策略

依赖：`C-09`、`C-15`。

要做什么：

- 将文字发送、官方表情面板点击、房间表情直发后备和原生发送确认迁入 Bilibili sending 模块。
- 保持房间 ID 校验和首次发送诊断。

实现什么：

- 一个 Bilibili sender 对外处理文字与富表情发送。

验证：

- 覆盖 `[大笑]`、`official_*`、`room_*`、错误房间、面板唯一/不唯一匹配。

完成标准：

- `content.ts` 不再包含 Bilibili 表情面板扫描和直接请求逻辑。

### [x] C-17 迁移斗鱼与虎牙发送策略

依赖：`C-10`、`C-15`。

要做什么：

- 将斗鱼 `pe` 类型和专属表情发送路径迁入斗鱼 sender。
- 将虎牙文字/图片表情发送迁入虎牙 sender。
- 保留官方输入框和官方发送流程。

实现什么：

- 通用发送协调器不需要了解平台 token 格式。

验证：

- 文字、普通表情、专属表情、无权限和平台限流反馈通过。

完成标准：

- 入口只通过统一 sender 接口发送。

### [x] C-18 提取雷达采集适配

依赖：`C-04`、`C-08`。

要做什么：

- 将 candidate → repeat reminder message 的转换放入平台适配器。
- 保留双源去重、福袋/广告过滤和当前房间 key。
- 入口只组装 `createRepeatReminderRuntime`。

实现什么：

- 雷达不再依赖入口内部的文本和表情解析函数。

验证：

- 相同聊天/画面消息合并；真实重复保留；排除项不计数。

完成标准：

- 入口不再实现平台雷达 suppression 和 describe 细节。

### [x] C-19 提取设置、诊断和生命周期

依赖：`C-11`、`C-12`、`C-13`、`C-15`、`C-18`。

要做什么：

- 建立 `LiveContentRuntime` 类或工厂。
- 集中注册 storage、pointer、fullscreen、visibility、scroll、resize 和 runtime message 监听。
- 集中启动/销毁观察器、收藏运行时、雷达运行时和平台控制器。

实现什么：

- 所有资源拥有明确所有者和对称销毁路径。

验证：

- 重复调用 `start()` 不重复安装。
- 重复调用 `destroy()` 不报错。
- 页面隐藏、刷新和切房后无残留 UI/监听器。

完成标准：

- 生命周期逻辑从入口闭包迁出。

### [x] C-20 瘦身入口并删除 `@ts-nocheck`

依赖：`C-01` 至 `C-19`。

要做什么：

- 将 `content.ts` 改为平台检测、依赖创建、runtime 启动和销毁。
- 删除未使用的旧函数、旧状态和直接平台导入。
- 删除 `@ts-nocheck`。

实现什么：

- `content.ts` 成为真正的 composition root。

验证：

- `npm run check`。
- Bilibili、虎牙、斗鱼普通页面与网页全屏完整手工回归。

完成标准：

- 入口通过严格类型检查，且不再拥有业务算法。

## 7. 阶段 DC：拆分并类型化 `douyin-content.ts`

### [x] DC-01 定义隔离世界运行时状态

依赖：`P-04`、`R-02`。

要做什么：

- 定义 `DouyinContentRuntimeState`、`DouyinDomCandidate`、`DouyinSelection`。
- 给 sender cache、本人消息意图、手动输入快照、请求表和计时器补充类型。
- 为抖音 content 全局加载和诊断字段增加 global 类型。

实现什么：

- 后续控制器通过窄接口访问状态。

验证：

- 新类型模块独立通过类型检查。

完成标准：

- 每个状态字段有明确创建、更新和销毁责任方。

### [x] DC-02 提取抖音选择器和 DOM 查询

依赖：`DC-01`。

要做什么：

- 将视频根、聊天根、消息、正文、用户名、输入框和发送按钮选择器迁入配置文件。
- 提取 `queryAll`、`matchesAny`、`closestAny`。

实现什么：

- 选择器更新不再需要修改运行入口。

验证：

- fixture 能找到预期节点，且不会把扩展自有节点当成平台节点。

完成标准：

- `douyin-content.ts` 不再声明大型 selector 数组。

### [x] DC-03 提取页面桥接客户端

依赖：`P-04`、`DC-01`。

要做什么：

- 封装消息发送、接收、request ID、待处理请求和超时。
- 提供 renderer ready、heartbeat 和 debug snapshot API。
- 处理页面 Hook 暂未加载和重新注入后的恢复。

实现什么：

- 业务控制器不直接调用 `window.postMessage`。

验证：

- 模拟成功响应、超时、重复响应、错误来源和页面重载。

完成标准：

- content 侧只有 bridge 模块注册 `window.message` 监听。

### [x] DC-04 提取侧边聊天解析器

依赖：`DC-02`。

要做什么：

- 提取聊天正文、发送者、消息 ID 和富文本载荷。

- 明确区分普通聊天、图片表情、礼物、福袋和系统消息。
- 处理虚拟列表节点更新和移除。

实现什么：

- 返回统一且不可变的 `DouyinChatMessageDescriptor`。

验证：

- 使用普通文字、连续表情、图文混排、礼物和福袋 fixture。

完成标准：

- 雷达、收藏和本人消息识别共用同一个侧聊解析结果。

### [x] DC-05 提取抖音富文本恢复器

依赖：`DC-04`。

要做什么：

- 合并 renderer content、Canvas 回退文本和侧聊富文本。
- 保证 `[杀马特][杀马特]cyh` 等连续表情 token 不丢失。
- 图片资源缺失时仍允许使用完整括号文字发送。
- 对解析失败返回结构化原因。

实现什么：

- 复制、收藏和 +1 使用同一份完整文本/部件结果。

验证：

- 覆盖纯表情、连续表情、图文交替、相同表情多次和资源加载失败。

完成标准：

- `douyin-content.ts` 不再实现富文本合并和资源评分。

### [x] DC-06 提取发送者索引

依赖：`DC-04`。

要做什么：

- 封装聊天行扫描、消息 ID 关联、文本后备关联和 TTL 清理。

- 明确相同文本不同用户的匹配优先级。
- 保存虚拟列表移除节点中仍有价值的发送者信息。

实现什么：

- 回复解析不再依赖入口中的多个缓存数组。

验证：

- 覆盖消息 ID、文本时间窗、用户冲突和缓存过期。

完成标准：

- 对外只暴露 `remember()`、`resolve()`、`prune()`、`destroy()`。

### [x] DC-07 提取 DOM 悬停和胶囊控制器

依赖：`DC-02`、`DC-05`。

要做什么：

- 封装侧聊/DOM 弹幕候选命中、卡片显示、位置更新和隐藏计时。
- 雷达图标和提示框区域必须阻断底层弹幕悬停。
- 保证一次只选择一条弹幕。

实现什么：

- DOM 交互与发送/收藏业务分离。

验证：

- 测试正文、间隙、胶囊、雷达覆盖和快速移动。

完成标准：

- 入口不再直接管理 card lock/sticky/hide 状态。

### [x] DC-08 提取操作分发控制器

依赖：`DC-03`、`DC-07`。

要做什么：

- 将 +1、回复、复制、收藏分发封装为独立控制器。
- 校验来自页面 renderer 的操作必须匹配近期可信指针操作。
- UI 只发出语义 action，不直接执行发送细节。

实现什么：

- DOM 胶囊和页面 renderer 胶囊共用同一操作服务。

验证：

- 覆盖可信点击、过期点击、伪造消息和操作禁用。

完成标准：

- 所有 action 最终进入一个类型化分发器。

### [x] DC-09 提取编辑器控制器

依赖：`DC-02`。

要做什么：

- 封装输入框评分、值写入、input 事件、光标和焦点。
- 支持抖音官方文本式 `[表情]` 输入。
- 回复只填入和聚焦，不自动发送。

实现什么：

- 输入面操作可以独立于悬停 UI 测试。

验证：

- 覆盖 contenteditable、输入框重建、发送后清空和焦点释放。

完成标准：

- 入口不再直接操作 Selection/Range 和输入事件。

### [x] DC-10 提取抖音发送控制器

依赖：`DC-05`、`DC-09`。

要做什么：

- 组合发送保护、文本恢复、输入写入、发送按钮和发送结果观察。
- 返回统一 `SendResult`。
- 图片资源不是抖音 `[表情]` 发送的硬依赖。

实现什么：

- 普通文本、连续表情和图文混排走一条明确发送路径。

验证：

- 覆盖连续 `[表情]`、混合文字、重复点击、冷却、限流和输入未消费。

完成标准：

- `repeatMessage` 业务从入口迁出。

### [x] DC-11 提取本人消息控制器

依赖：`DC-03`、`DC-04`、`DC-05`。

要做什么：

- 封装插件发送意图、手动输入快照、手动表情点击和侧聊匹配。
- 管理侧聊本人消息框选创建、定位和清理。
- 通过 bridge 向 page runtime 同步本人消息意图。

实现什么：

- 侧聊与直播流本人弹幕使用相同 intent ID 和 payload signature。

验证：

- 覆盖手动文字、手动图片表情、插件 +1、发送失败、重复内容和超时。

完成标准：

- 入口不再维护 manual intent、own chat frame 和 pending intent 状态。

### [x] DC-12 提取雷达采集器

依赖：`DC-03`、`DC-04`。

要做什么：

- 合并侧聊和 page renderer 两种来源。
- 保留 3 秒双源去重。
- 排除礼物、福袋、系统提示和图片表情。
- 管理当前房间内 suppression 生命周期。

实现什么：

- 抖音雷达消息过滤不再散落在入口消息处理和 DOM 扫描中。

验证：

- 普通重复弹幕计数；礼物和福袋不计数；双源只计一次。

完成标准：

- 入口只负责将 collector 注入 repeat reminder runtime。

### [x] DC-13 提取设置、诊断和 SPA 生命周期

依赖：`DC-03`、`DC-06` 至 `DC-12`。

要做什么：

- 建立 `DouyinContentRuntime`。
- 集中管理 storage、MutationObserver、route poll、visibility、pagehide 和 runtime message。
- 明确启动顺序：bridge → settings → collectors/controllers → observers。
- 明确销毁逆序。

实现什么：

- SPA 切房不会生成重复雷达、重复 UI 或重复观察器。

验证：

- start/destroy 幂等测试。
- 路由进入、切房、离开直播、重新进入测试。

完成标准：

- 所有隔离世界资源由一个 runtime 拥有。

### [x] DC-14 瘦身入口并删除 `@ts-nocheck`

依赖：`DC-01` 至 `DC-13`。

要做什么：

- 将 `douyin-content.ts` 改为环境检查、runtime 创建、启动和销毁。
- 删除旧闭包状态和迁移后无用函数。
- 删除 `@ts-nocheck`。

实现什么：

- 抖音隔离世界入口成为 composition root。

验证：

- `npm run check`。
- 抖音直接进房、SPA 进房、切房、普通模式和网页全屏手工回归。

完成标准：

- 入口严格类型检查通过，且不包含业务算法。

## 8. 阶段 DP：拆分并类型化 `douyin-page-hook.ts`

### [x] DP-01 定义页面运行时核心类型

依赖：`P-04`、`R-02`。

要做什么：

- 定义 `RendererConfig`、`RendererInstance`、`RendererTrack`、`RendererChannel`、`PendingBarrage`。
- 定义 renderer 生命周期状态和失败原因。
- 给 activation/favorite request、own messages、instances 和 timers 补充泛型。
- 为页面全局调试和加载标志增加 global 类型。

实现什么：

- Canvas、实例、轨道和 DOM 节点之间的所有权可由类型表达。

验证：

- 类型模块独立通过检查，不使用 `any` 逃逸核心状态。

完成标准：

- 每个实例字段有明确单位，例如毫秒、CSS 像素或设备像素。

### [x] DP-02 提取 MAIN world 协议桥

依赖：`P-04`、`DP-01`。

要做什么：

- 页面侧只有 bridge 注册 `window.message`。
- bridge 负责解析、分发、响应 request ID 和发送事件。
- renderer 业务模块不直接调用 `window.postMessage`。

实现什么：

- 页面业务逻辑与跨世界传输解耦。

验证：

- 模拟非法来源、非法 payload、响应超时和重复响应。

完成标准：

- page hook 中散落的消息判断全部迁出。

### [x] DP-03 提取 Canvas 识别与接管 Hook

依赖：`DP-01`。

要做什么：

- 封装弹幕 Canvas 识别、ID 生成、未认领 Canvas 查找和 `transferControlToOffscreen` 观察。
- 保存原始原型方法，保证补丁只安装一次。
- 不处理非弹幕 Canvas。

实现什么：

- Canvas Hook 有独立安装状态和诊断数据。

验证：

- 普通 Canvas 不受影响；重复安装不产生多层 wrapper。

完成标准：

- 入口不再直接修改 Canvas 原型。

### [x] DP-04 提取 Worker/MessagePort 消息观察

依赖：`DP-01`。

要做什么：

- 封装 Worker/MessagePort `postMessage` 旁路观察。
- 保留原消息投递顺序和参数。
- 将可识别的 add/clear/config 消息转换成内部命令。

实现什么：

- 不拦截 WebSocket，不解析无关私有流量，不吞掉官方消息。

验证：

- 原始 `postMessage` 每次仍被调用一次，参数引用和 transfer list 不被破坏。

完成标准：

- Worker Hook 对外只输出类型化 renderer command。

### [x] DP-05 提取弹幕内容解析器

依赖：`DP-01`、`DP-04`。

要做什么：

- 将官方 options/content 转换为 `PreparedBarrage`。
- 提取文本、图片、消息 ID、颜色、字体、轨道和持续时间。
- 保留礼物/福袋雷达排除原因，但不阻止其原生显示。

实现什么：

- 渲染和雷达消费同一份类型化描述，不重复猜测字段。

验证：

- 普通文字、连续表情、图文混排和未知结构测试通过。

完成标准：

- `prepareBarrage` 不再直接承担 DOM 创建和实例状态更新。

### [x] DP-06 提取内容测量器

依赖：`DP-05`。

要做什么：

- 提取文本测量、图片比例、嵌套内容测量和继承样式。
- 明确测量缓存 key 和失效条件。
- 测量结果使用 CSS 像素统一表达。

实现什么：

- 内容宽高计算可独立测试并避免重复布局读取。

验证：

- 文字、Emoji 图片、嵌套 inline/block 和缩放测试。

完成标准：

- renderer 主循环只读取已准备的测量结果。

### [x] DP-07 提取 Renderer 实例注册表

依赖：`DP-01`、`DP-03`、`DP-04`。

要做什么：

- 封装实例创建、恢复、孤立消息缓存、Canvas 重新关联和销毁。
- 路由变化和 Canvas 脱离时清理实例。
- 明确一个 Canvas 只能被一个实例拥有。

实现什么：

- instances Map 不再由入口和多个函数共同随意修改。

验证：

- 覆盖正常创建、晚注入恢复、重复认领、脱离和重新挂载。

完成标准：

- 对外提供 `get/create/recover/remove/destroyAll` 等窄接口。

### [x] DP-08 提取纯轨道运动模型

依赖：`DP-01`、`DP-05`。

要做什么：

- 将位置、速度、暂停、恢复、过期和安全间距计算改为纯函数。
- 明确时间基准，禁止混用 `Date.now()` 和 RAF timestamp。
- 悬停恢复必须从冻结位置按原速度继续，不追赶后台轨迹。

实现什么：

- 运动算法不直接读写 DOM。

验证：

- 固定时间序列测试正常移动、悬停、恢复、连续暂停和过期。

完成标准：

- 轨道模型可以在 jsdom 之外作为纯单元测试运行。

### [x] DP-09 提取频道调度器

依赖：`DP-08`。

要做什么：

- 封装频道创建、pending 分配、碰撞间距和频道释放。
- 保留当前进入画面和持续时间行为。

实现什么：

- queue/assign 逻辑与 DOM renderer 解耦。

验证：

- 突发弹幕、频道满载、长短文本混合和 Canvas 尺寸变化。

完成标准：

- 调度器输入输出均为类型化状态，不持有 DOM 节点。

### [x] DP-10 提取 DOM Renderer

依赖：`DP-06`、`DP-07`、`DP-08`、`DP-09`。

要做什么：

- 封装 renderer layer、内容节点、轨道节点和元数据创建。
- 封装 Canvas 隐藏、恢复和安全接管条件。
- 将一帧内布局读取与样式写入分成两个阶段。
- 复用节点或批量更新，避免逐帧全量 DOM 查询。

实现什么：

- 页面渲染性能和运动模型分别可测试。

验证：

- Canvas 只有在首批 DOM 节点连接后隐藏。
- renderer 异常、心跳超时和销毁时立即恢复 Canvas。

完成标准：

- `updateRendererFrame` 只协调模型快照与批量 DOM 提交。

### [x] DP-11 提取页面胶囊与单条悬停控制

依赖：`DP-08`、`DP-10`。

要做什么：

- 封装 action bar 创建、缩放、左右位置和可信激活。
- 保证一次只悬停一条轨道。
- 雷达提示覆盖区域内不激活底层轨道。
- 胶囊操作结束后正确释放当前轨道。

实现什么：

- 胶囊 UI 不直接修改调度器内部集合。

验证：

- 重叠弹幕、正文到胶囊、雷达覆盖、+1 后恢复、缩放和全屏测试。

完成标准：

- 悬停只通过 track controller 改变单条轨道状态。

### [x] DP-12 提取页面本人弹幕匹配器

依赖：`DP-02`、`DP-05`。

要做什么：

- 封装 own-message intent 保存、取消、消费和过期。
- 使用消息 ID/富文本签名优先，规范化文本作为后备。
- 一个意图只能消费一次。

实现什么：

- 本人弹幕框选不再混入 prepare/queue 主流程。

验证：

- 相同文本多人发送、连续表情、发送失败取消和超时。

完成标准：

- 对外只提供 `remember/cancel/match/prune`。

### [x] DP-13 提取页面诊断控制器

依赖：`DP-07`、`DP-10`。

要做什么：

- 封装 debug state、marker、快照和有界事件列表。
- 禁止在逐帧热路径中序列化大型对象或频繁更新 DOM marker。
- 错误只保存脱敏摘要。

实现什么：

- 诊断功能可关闭或降频，不影响弹幕帧率。

验证：

- 高频帧运行时 marker 更新频率符合上限。

完成标准：

- 页面业务模块只调用轻量 `diagnostics.increment/record`。

### [x] DP-14 建立 MAIN world 生命周期

依赖：`DP-02` 至 `DP-13`。

要做什么：

- 建立 `DouyinPageRuntime`。
- 集中管理 Hook 安装、bridge、instance registry、heartbeat、route、fullscreen 和 pointer 监听。
- 定义 start/destroy 幂等行为。
- 如果原型补丁无法安全卸载，使用 generation/active flag 使旧运行时彻底失效。

实现什么：

- 页面切房、扩展关闭和重新注入不会形成多个活动 renderer。

验证：

- 重复注入、心跳超时、Canvas 脱离、路由变化和页面隐藏测试。

完成标准：

- 所有页面世界资源由一个 runtime 统一持有。

### [x] DP-15 瘦身入口并删除 `@ts-nocheck`

依赖：`DP-01` 至 `DP-14`。

要做什么：

- 将 `douyin-page-hook.ts` 改为加载保护、runtime 创建和启动。
- 删除迁移后的旧闭包状态和无用函数。
- 删除 `@ts-nocheck`。

实现什么：

- 页面 Hook 成为严格类型化的 composition root。

验证：

- `npm run check`。
- 抖音首次进房、晚注入、SPA 切房、全屏、悬停、+1、本人弹幕和 Canvas 恢复手工回归。

完成标准：

- 入口严格类型检查通过，并且不实现渲染算法。

## 9. 阶段 F：边界、测试与收尾

### [x] F-01 增加模块依赖边界检查

依赖：`C-20`、`DC-14`、`DP-15`。

要做什么：

- 使用 ESLint `no-restricted-imports` 或独立依赖检查工具固化规则。
- `platforms/live` 不得导入具体平台。
- feature 不得深层导入具体平台内部实现。
- entry 可以组装模块，但模块不得反向导入 entry。

实现什么：

- 防止未来把拆出的逻辑重新堆进入口。

验证：

- 添加一个测试夹具或配置测试，证明非法导入会失败。

完成标准：

- 依赖边界检查加入 `npm run check`。

### [x] F-02 统一入口测试分类

依赖：`C-20`、`DC-14`、`DP-15`。

要做什么：

- 单元测试保留在 `src/**/__tests__`。
- 构建和源码契约测试归入 `tests/contracts`。
- DOM 样本归入 `tests/fixtures`。
- 浏览器测试保留在 `tests/browser` 并继续只在本地运行。
- 回归测试改为可验证的目录发现或清单机制，避免漏加文件。

实现什么：

- 测试位置和执行方式一一对应。

验证：

- `npm run check` 执行全部非浏览器测试。
- CI 不执行浏览器 E2E。

完成标准：

- 新增测试不需要手工修改一长串命令，或有自动校验防止遗漏。

### [x] F-03 扩大真实覆盖率范围

依赖：`F-02`。

要做什么：

- 将 `core`、`features`、`platforms` 中可测试模块纳入 coverage。
- entry 只验证启动契约，不强求 DOM 主循环达到高覆盖率。
- 分领域设置可实现的覆盖率门槛。

实现什么：

- 覆盖率不再只代表少量 allowlist 文件。

验证：

- `npm run test:coverage` 输出包含新拆出的控制器和纯函数。

完成标准：

- 富文本、发送、悬停、协议、轨道模型和雷达适配均进入覆盖率统计。

### [x] F-04 清理迁移遗留代码

依赖：`F-01` 至 `F-03`。

要做什么：

- 删除空目录、重复 helper、废弃协议类型和无引用选择器。
- 删除只为旧入口存在的 ESLint `@ts-nocheck` 例外。
- 保留必要的兼容迁移，并写明删除版本。

实现什么：

- 新结构成为唯一实现，不保留两套长期并行路径。

验证：

- `rg` 检查无旧符号引用。
- `npm run check`。

完成标准：

- 三个入口均无 `@ts-nocheck`，ESLint 不再为它们放宽规则。

### [ ] F-05 最终四平台回归与架构文档更新

依赖：所有前置步骤。

要做什么：

- 更新 README 项目结构。
- 完成四个平台普通页面和网页全屏回归。
- 记录浏览器版本、直播间模式和发现的问题。

必须回归：

- [ ] Bilibili：文字、官方表情、房间表情、回复、收藏、雷达、全屏。
- [ ] 虎牙：文字、图片表情、回复、收藏、雷达、贵宾数、全屏。
- [ ] 斗鱼：文字、专属表情、原生胶囊、单条悬停、无抽搐、雷达、贵宾数、全屏。
- [ ] 抖音：首次进房、SPA 进房/切房、连续表情、本人消息双处框选、单条悬停、雷达过滤、Canvas 恢复、全屏。

完成标准：

- `npm run check` 通过。
- 所有手工回归项有结果记录。
- 没有恢复浏览器 E2E CI。

## 10. 每一步通用完成定义

除具体步骤的完成标准外，每个编号还必须同时满足：

- [ ] 没有修改无关平台行为。
- [ ] 没有引入新的 `@ts-ignore`、`@ts-expect-error` 或 `any` 来掩盖核心错误。
- [ ] 新模块具有清楚的导出边界。
- [ ] 有状态资源可以销毁。
- [ ] 针对当前步骤运行了最小相关测试。
- [ ] 阶段末运行了完整 `npm run check`。
- [ ] 清单状态和实施记录已经更新。

## 11. 实施记录

按时间倒序添加记录。不要删除失败记录；后续修复时追加新记录。

### 2026-09-07 — F-05（进行中）

- 状态：进行中，尚未勾选 F-05。
- 文档：README 的中英文项目结构已按当前代码更新，补充五个构建入口、`content-app.ts` 装配根、四个平台目录职责、共享 live 控制器、分层测试目录和覆盖率门禁；新增 `docs/ENTRY_REFACTOR_REGRESSION.md`，将本地浏览器 fixture 与真实直播间人工结果分开记录，并提供逐项操作、通过标准和结果填写表；`ENTRY_RUNTIME_ARCHITECTURE.md` 的自动测试映射已从迁移前文件名更新为当前 `src/**/__tests__` 与 `tests/contracts` 结构。
- 浏览器基础设施：修复 Chrome/Edge 152 在当前 Windows headless 环境中的 GPU 启动、子进程输出读取、旧产物误用、雷达首次说明遮挡、收藏排序旧选择器、斗鱼原生表情异步终态和 Bilibili RAF 调度暂停计时问题。修改仅作用于本地可选浏览器测试，不改变扩展生产行为，也未恢复 CI 浏览器 E2E。
- 本地浏览器回归：Google Chrome `152.0.7977.76` 与 Microsoft Edge `152.0.4191.66` 各 20 个场景全部通过，覆盖设置页、四平台普通页面与网页全屏 fixture、富消息/图片表情、胶囊、回复/收藏、雷达过滤、斗鱼原生悬停释放、抖音 DOM Renderer，以及 Bilibili 1,500 条侧聊记录和 100 次悬停压力场景。详细结果见 `docs/ENTRY_REFACTOR_REGRESSION.md`。
- 自动验证：`npm run check` 通过（92 个 Vitest 文件、466 项测试、119 个覆盖率源码文件、12 个自动发现的契约文件、136 项回归测试）；类型检查、Oxlint、ESLint、全部构建、Manifest/架构/CI/发布配置/import 边界/测试布局/迁移清理和覆盖范围门禁均通过。
- 真实页面尝试：首次能够枚举当前 Chrome 的真实直播标签页，但 Bilibili 标签调试连接返回 `Debugger unattached`，新建受控标签页随后超时并重置；用户重新打开加载最新 `build/extension` 的 Chrome 后，可再次枚举 Bilibili、斗鱼和抖音直播标签页，但连接既有斗鱼与 Bilibili 标签页仍在取得页面状态前超时。为避免反复附加调试器影响直播页，已停止重试。没有可靠页面控制权，因此没有将真实直播间行为记为通过，也没有执行发送、回复或收藏。
- 遗留问题：F-05 仍需四个平台真实直播间人工回归并记录结果，尤其是斗鱼真实动画时间线、虎牙/斗鱼贵宾数、Bilibili 多 iframe、抖音 SPA 切房/Worker/Canvas 恢复，以及需要账号行为的真实发送、回复和收藏。

### 2026-09-06 — F-04

- 状态：已完成。
- 入口收尾：删除 ESLint 中仅为 `content.ts`、`douyin-content.ts` 和 `douyin-page-hook.ts` 设置的 `ban-ts-comment` 宽松规则；三个薄入口继续在严格类型检查下运行，且均不含 `@ts-nocheck`、`@ts-ignore` 或 `@ts-expect-error`。
- 迁移代码：删除已经没有生产调用方的 `src/platforms/douyin/track-model.ts` 兼容 facade，Node 契约测试改为直接构建和验证 `page/track-motion.ts` 与 `page/channel-scheduler.ts`；删除空的旧 `src/features/radar/__tests__` 及其父目录。
- 重复 helper：新增共享 `eventComposedPath()`，供通用悬停控制器和抖音操作分发器使用；新增共享 `richEmojiAssetCacheKey()`，供 Bilibili 与虎牙表情恢复缓存使用；Canvas/Worker Hook 删除重复的一行 `patchSlot()` 包装，改用局部类型化槽位。对应行为由既有控制器、表情恢复和 Hook 测试覆盖，并新增 event path 与 cache key 定向测试。
- 协议与 selector：将只在 `protocol.ts` 内部使用的 legacy version、message source、protocol version 和 entity ID 收回为私有实现，不再暴露废弃协议细节；将 `REPEAT_REMINDER_OWNED_SELECTOR` 收回为模块私有常量。扫描确认生产源码中不存在只声明一次的 selector 常量。
- 兼容期限：保留扩展重载时所需的抖音缺省版本协议输入，以及 2.x 的 `radar`/灵敏度/旧阈值设置迁移；代码和架构文档均明确这些兼容路径在 3.0.0 删除。
- 自动门禁：新增 `tests/contracts/validate-refactor-cleanup.cjs` 并加入 `validate:build`，防止入口抑制、已删 facade、旧协议公开导出、内部 selector 导出、重复 helper 和空源码目录回流。
- 验证：`npm run type-check`、`npm run lint:check`、7 个定向 Vitest 文件共 53 项测试、迁移清理验证器和 136 项自动发现的契约回归均通过；最终 `npm run check` 通过。
- 手工验证：本步骤未运行浏览器 E2E 或真实直播间回归；修改均为等价 helper 合并、公开边界收紧和无生产调用方遗留删除，真实页面行为仍由 F-05 统一回归。
- 遗留问题：下一未完成项为 F-05，需要更新 README 当前目录结构，并完成四个平台普通页面与网页全屏手工回归记录；浏览器 E2E 继续保持本地可选且不加入 CI。

### 2026-09-06 — F-03

- 状态：已完成。
- 收集范围：`vitest.config.ts` 从 10 个文件的显式 allowlist 改为覆盖 `src/core/**/*.ts`、`src/features/**/*.ts` 和 `src/platforms/**/*.ts`，当前报告包含 120 个可执行源码文件；仅排除测试自身、纯类型模块、收藏 UI 装配入口和两个抖音 composition root。`src/entries` 不进入 DOM 主循环覆盖率，继续由薄启动器与源码契约验证。
- 分领域门槛：保留全局行/函数/分支门槛 72%/70%/58%，并为 core 设置 75%/82%/55%，features 设置 60%/50%/45%，platforms 设置 78%/78%/60%。本次实测分别为 core 77.73%/86.79%/58.28%，features 65.06%/54.22%/49.47%，platforms 81.39%/80.50%/63.91%。
- 防回退契约：新增 `tests/contracts/validate-coverage-report.cjs` 并串入 `test:coverage`，要求报告至少包含 100 个源码文件、覆盖三个领域、排除 entry，同时明确验证富消息资源身份、富消息、发送协调、悬停、通用/抖音雷达适配、Douyin 协议和轨道运动模块具有可执行覆盖数据。
- 结果：整体覆盖率为行 77.90%、函数 74.58%、分支 60.97%；富文本、发送、悬停、协议、轨道模型和雷达适配均已出现在 coverage summary。相比旧 allowlist，未被 Vitest 直接执行的收藏仓库与少数 DOM 平台发送分支现在会明确显示为低覆盖或零覆盖，不再被统计范围隐藏。
- 验证：`npm run test:coverage` 通过（92 个 Vitest 文件、464 项测试、120 个源码文件），所有全局/领域门槛和覆盖范围契约通过；最终 `npm run check` 通过。
- 手工验证：本步骤不修改运行时逻辑，未运行浏览器 E2E 或真实直播间回归。
- 遗留问题：下一未完成项为 F-04；需要根据引用、入口例外和目录状态清理迁移遗留代码，且不得为了提高覆盖率删除仍在使用的低覆盖模块。

### 2026-09-06 — F-02

- 状态：已完成。
- 目录分类：12 个 Node 源码/构建契约测试统一迁入 `tests/contracts`；Manifest、Vue 架构、CI、发布配置和 import 边界验证器一并归入该目录；浏览器运行器、fixture server 和两个页面检查脚本迁入 `tests/browser`；已有四平台 DOM 样本继续保留在 `tests/fixtures/live-dom`，Vitest 单元测试继续与源码相邻保留在 `src/**/__tests__`。
- 自动发现：新增 `contract-files.cjs` 和 `run-contract-tests.cjs`，递归、稳定排序发现 `tests/contracts` 下所有 `*.test.cjs|mjs|js`，`test:regression` 不再维护 12 个文件的手工长清单；新增契约测试只要遵循命名即可自动进入回归。
- 自动门禁：新增 `validate-test-layout.cjs`，拒绝 `tests` 根目录散落文件、未知一级分类、空契约发现、回退到手工测试清单、Vitest 重复收集 `tests/**`，以及 `npm run check` 引入浏览器 E2E。既有 `validate-ci.cjs` 继续确认普通 CI 不执行 `test:browser`。
- 文档：在 `ARCHITECTURE.md`、`PLATFORM_ADAPTERS.md` 和 `ENTRY_RUNTIME_ARCHITECTURE.md` 中补充四类测试的位置、执行器和 CI 边界，并修正迁移后的验证器路径。
- 验证：自动发现器识别 12 个契约文件、136 项 Node 回归通过；最终 `npm run check` 通过（92 个 Vitest 文件、464 项覆盖率测试、12 个自动发现的契约文件、136 项回归测试），严格类型检查、Oxlint、ESLint、全部构建及 Manifest/架构/CI/发布/import 边界/测试布局校验均通过。
- 手工验证：未运行本地浏览器 E2E，也未连接真实直播间；本步骤只调整测试组织和执行入口，不改变扩展运行时代码。
- 遗留问题：下一未完成项为 F-03；当前 coverage 仍由少量文件 allowlist 构成，需要扩大到已拆出的 core、feature 和 platform 纯逻辑/控制器，并设置可实现的分领域门槛。

### 2026-09-06 — F-01

- 状态：已完成。
- 边界修复：将 Bilibili、斗鱼和虎牙的 selector/editor 配置移回各自平台目录，并由平台 adapter 暴露统一 `config`；斗鱼多正文片段解析改为 `LiveMessageElementsResolver` 注入，Bilibili 福袋过滤改为 `RepeatReminderExclusion` 注入。`platforms/live` 不再直接导入这些平台实现，唯一例外仍是显式工厂缝 `platforms/live/adapters.ts`。
- feature 解耦：将不适合展示为收藏名称的资源身份判断提取为 `core/rich-asset-identity.ts`，收藏仓库不再深层导入 Bilibili 内部模块；`live/rich-message-sender.ts` 只保留跨平台 sender 契约，原先仅供测试使用的平台分发器被移除，跨平台 sender 测试移至 `platforms/__tests__`。
- 自动门禁：在 ESLint flat config 中加入三组 `no-restricted-imports` 规则，禁止共享 live 模块导入具体平台、feature 深层导入具体平台，以及非 entry 模块反向导入 entry；`tests/contracts/validate-import-boundaries.cjs` 使用非法 import 夹具验证三类违规必定失败，并验证 `live/adapters.ts` 的显式装配例外仍可通过。该验证已加入 `validate:build`，因此属于 `npm run check` 门禁。
- 测试：更新平台配置、adapter 注入和 Bilibili 雷达过滤的源码/行为断言；定向 Vitest 4 个文件、30 项测试通过，边界反例验证通过，相关 Node 回归 13 项通过。
- 验证：最终 `npm run check` 通过（92 个 Vitest 文件、464 项覆盖率测试、136 项回归测试），严格类型检查、Oxlint、ESLint、全部构建及 Manifest/架构/CI/发布配置和新增 import 边界校验均通过。
- 手工验证：本步骤没有连接四个平台真实直播间；平台配置内容保持原值，但普通页面、全屏、切房、候选识别与 Bilibili 福袋过滤仍需最终真实页面回归。
- 遗留问题：下一未完成项为 F-02，将统一单元、源码契约、fixture 与浏览器测试目录，并让回归测试使用自动发现或受校验清单，避免新增文件遗漏。

### 2026-09-06 — DP-15

- 状态：已完成。
- 变更：新增严格类型化的 `page/page-app.ts` 作为 MAIN world 装配工厂，承接各页面模块的构造、Renderer 命令协调、帧调度回调、本人消息匹配、雷达只读事件和 runtime 依赖注入；`douyin-page-hook.ts` 从 751 行缩减为 12 行，只保留页面应用工厂导入、重复加载保护、runtime 创建、全局所有权登记和幂等启动。
- 类型化：删除页面入口最后的 `@ts-nocheck`，为协议 handler、Renderer 实例、弹幕 options、准备结果、Canvas 几何、RAF 时间、Unix 时间、配置和错误摘要补齐精确类型；未增加 `any`、`@ts-ignore` 或 `@ts-expect-error`。将既有富内容协议转换公开为 `rendererProtocolContent()`，让雷达消息和胶囊请求共用同一份递归安全转换，不使用不安全类型断言。
- 边界：入口不再导入 Canvas/Worker Hook、bridge、调度器、DOM Renderer 或运动模型，也不包含渲染算法、事件监听、定时器和跨 world 传输；`page-app.ts` 只负责装配与协调，具体解析、测量、运动、频道、DOM、悬停、匹配、诊断和生命周期继续位于各自模块。
- 测试：迁移 11 组页面模块源码边界断言和 4 组 Node 回归断言，使其分别验证薄入口、装配工厂和具体实现模块；新增的入口回归约束会拒绝 `@ts-*`、`any`、生命周期监听和 Hook 直接安装回流。
- 验证：`npm run type-check`、`npm run lint:check`、抖音 page 目录 Vitest（14 个文件、86 项）、相关 Node 回归（28 项）、完整回归（136 项）和 `npm run build` 已通过；最终 `npm run check` 通过（92 个 Vitest 文件、464 项覆盖率测试、136 项回归测试），严格类型检查、Oxlint、ESLint、全部构建及 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实抖音直播间；首次进房、晚注入、SPA 切房、全屏、悬停、`+1`、本人弹幕和 Canvas 恢复仍需真实页面回归。
- 遗留问题：三个目标入口的拆分和类型化阶段均已完成；下一未完成项为 F-01，将用自动检查固化模块依赖方向，防止业务逻辑回流入口或公共层反向依赖平台实现。

### 2026-09-06 — DP-14

- 状态：已完成。
- 变更：新增严格类型化的 `page/page-runtime.ts`，建立 `DouyinPageRuntime`，统一拥有 Canvas Hook、Worker/MessagePort Hook、页面 bridge、轨道控制器、维护定时器、Renderer 心跳、SPA 路由、全屏、可见性和 `pagehide/pageshow` 生命周期；`douyin-page-hook.ts` 只装配依赖并调用 runtime，不再直接安装 Hook、启动 bridge/控制器或注册这些生命周期资源。
- 幂等与恢复：`start()`/`destroy()` 均为幂等操作；重复注入优先复用全局 runtime；维护回调通过 generation 校验拒绝旧代执行。Canvas/Worker 原型 Hook 继续使用共享所有者记录，在最后一个所有者销毁时恢复原方法。BFCache `pagehide` 只暂停并完整释放活动资源，`pageshow` 只恢复一次；普通卸载则终止 runtime、销毁实例注册表和诊断控制器。
- 行为边界：可见页面心跳超时会关闭 Renderer/雷达并恢复 Canvas；路由键只在 origin/pathname 变化时重置实例，query/hash 变化不误判切房；页面隐藏统一暂停实例，恢复可见后只恢复当前有效实例；Canvas 脱离扫描、孤立实例恢复、首次挂载重试及全屏重排继续由 runtime 的单一维护循环协调。
- 测试：新增 `page-runtime.spec.ts` 7 项测试，覆盖资源启动/销毁幂等、心跳超时、路由变化与 Canvas 脱离维护、页面隐藏/恢复、Canvas 全屏、BFCache 往返，以及入口不再持有定时器、Hook 安装和生命周期监听的源码边界；同步迁移 Canvas Hook、页面 bridge 和 Node 回归测试的入口边界断言。
- 验证：定向 Vitest 17 项及实例注册表/运行时定向 Vitest 13 项通过；`npm run type-check`、`npm run lint:check`、`npm run build` 和 `npm run test:regression`（136 项）通过；最终 `npm run check` 通过（92 个 Vitest 文件、464 项覆盖率测试、136 项回归测试），严格类型检查、Oxlint、ESLint、全部构建及 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实抖音直播间；首次进房、SPA 切房、页面隐藏/BFCache、网页全屏、心跳超时和 Canvas 脱离恢复仍需真实页面回归。
- 遗留问题：`douyin-page-hook.ts` 仍保留渲染装配实现与 `@ts-nocheck`；下一未完成项为 DP-15，将瘦身入口并恢复严格类型检查。

### 2026-09-06 — DP-13

- 状态：已完成。
- 变更：新增严格类型化的 `page/diagnostics-controller.ts`，统一拥有 debug state、计数器、事件缓冲、快照、隐藏 DOM marker、全局调试引用和销毁清理；`douyin-page-hook.ts` 删除原有 `debugState`、对象裁剪、实例摘要、快照序列化与 marker 定时器，只通过 `diagnostics.increment/record` 记录业务事件，并在显式 `debug-request` 时读取快照。
- 热路径：`increment()` 只执行有界数字累加并复用单个 marker 定时器；普通 debug 事件按类型默认 250ms 采样，完整实例快照与 `JSON.stringify` 只在 marker 刷新或显式请求时执行，marker 默认最多每 1 秒更新一次，替代原来的 80ms 高频完整序列化。控制台默认只输出 warning/error。
- 隐私与边界：事件递归深度、数组项、对象键、字符串和总条数全部有界；Cookie、Authorization、CSRF、Token、SESSDATA、密码、密钥和 `w_rid` 等字段或查询参数会在保存前脱敏，错误仅保留脱敏后的短摘要。控制器支持通过 `enabled` 关闭诊断，并在 `destroy()` 时取消待处理定时器、移除 marker 与自身全局引用。
- 测试：新增 `diagnostics-controller.spec.ts` 6 项测试，覆盖计数与事件上限、高频事件采样和每秒 marker 上限、关闭诊断、错误脱敏、销毁清理，以及入口不再持有 debug state/marker/序列化实现的源码边界。
- 验证：定向 Vitest 6 项、`npm run type-check`、`npm run lint:check`、`npm run build` 和 `npm run test:regression`（135 项）通过；最终 `npm run check` 通过（91 个 Vitest 文件、457 项覆盖率测试、135 项回归测试），严格类型检查、Oxlint、ESLint、全部构建及 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实抖音直播间；高流量直播中的主线程占用、调试 marker 可读性和长时间事件采样仍需真实页面回归。
- 遗留问题：heartbeat、route、fullscreen、pagehide/pageshow、Hook 和 bridge 的启动/销毁仍分散在页面入口；下一未完成项为 DP-14，将建立统一 MAIN world 生命周期。

### 2026-09-06 — DP-12

- 状态：已完成。
- 变更：新增严格类型化的 `page/own-message-matcher.ts`，统一拥有本人消息意图的保存、取消、一次性消费、数量上限和超时清理；`douyin-page-hook.ts` 只在准备轨道时调用 `match()`，并通过事件回调保留本人框选、诊断计数和 `own-message-consumed` 回执。
- 匹配顺序：双方都有平台消息 ID 时以 ID 为准且不降级；否则依次使用富文本签名、完整图片资源重数与正文、规范化正文后备。富文本签名从原先“仅随意图保存”改为实际参与匹配，连续相同表情必须逐个找到独立资源才会消费意图。
- 竞态与安全：手动点击发送后若 Renderer 轨道已先到达，会在 2.5 秒窗口内选择得分最高且最新的未标记轨道补匹配；失败发送按稳定 `intentId` 取消，过期意图先清除，同一个意图从队列移除后才发出匹配事件，因此最多消费一次。
- 测试：新增 `own-message-matcher.spec.ts` 7 项测试，覆盖富文本签名、相同文本多人发送、连续表情资源重数、失败取消、超时、手动发送竞态和消息 ID 优先；旧 `emoji-fallback.test.mjs` 源码边界断言已改为验证 matcher 装配而非入口内联函数。
- 验证：定向 Vitest 7 项、`emoji-fallback.test.mjs` 17 项、`npm run build` 和 `npm run test:regression`（135 项）通过；最终 `npm run check` 通过（90 个 Vitest 文件、451 项覆盖率测试、135 项回归测试），严格类型检查、Oxlint、ESLint、全部构建及 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实抖音直播间；相同正文多人并发、连续图片表情、发送失败取消和 Canvas/侧聊双处本人框选仍需真实页面回归。
- 遗留问题：debug state、marker 和事件列表仍位于页面入口；下一未完成项为 DP-13，将提取页面诊断控制器。

### 2026-09-05 — DP-11

- 状态：已完成。
- 变更：新增严格类型化的 `page/track-controller.ts`，迁出 action bar 创建、可见操作组合、50%～200% 尺寸换算、设备像素对齐、左右侧定位、可信元数据校验、请求关联与反馈恢复；`page/dom-renderer.ts` 只负责节点和帧提交，通过控制器创建胶囊、绑定交互和计算胶囊布局。
- 单条悬停：控制器只保存一个 `currentTrack`；新轨道进入时先释放上一条，正文、间隙和胶囊共同位于同一轨道节点内，并保留 220ms 离开宽限，避免跨越间隙时短暂恢复移动。
- 雷达与操作：pointer 命中雷达提示覆盖区域时不激活底层轨道，已悬停轨道也会在捕获阶段释放；`+1` 成功、回复提交、收藏或复制结算后均释放当前轨道，请求超时和实例销毁会取消关联。
- 类型边界：Renderer 的递归 `SerializedBarrageItem` 在页面协议边界显式转换为有界内容记录；三类有响应操作分别使用精确判别联合，未引入 `any` 或新的并行消息协议。
- 测试：新增 `track-controller.spec.ts` 7 项测试，并扩充 `dom-renderer.spec.ts` 全屏挂载测试，覆盖重叠轨道单选、正文—间隙—胶囊连续悬停、雷达遮挡、`+1`/回复后恢复、缩放、左右换位、全屏容器、可信激活和销毁清理。
- 验证：`npm run check` 通过（89 个 Vitest 文件、444 项覆盖率测试、135 项回归测试）；真实直播页悬停与全屏仍需手工回归。
- 遗留问题：本人消息意图的保存、取消、消费、过期和近期轨道补匹配仍位于页面入口；下一未完成项为 DP-12，将提取页面本人弹幕匹配器。

### 2026-09-05 — DP-10

- 状态：完成
- 变更：新增严格类型化的 `page/dom-renderer.ts`，迁出 Renderer Layer、富内容节点、轨道节点、操作节点、可信元数据、节点复用、Canvas 隐藏/恢复、安全接管、尺寸提交和 Renderer 销毁；入口不再直接创建或定位 Renderer DOM。
- 帧阶段：`updateRendererFrame()` 现在只调用 `readFrame()` 生成类型化布局快照，再调用 `commitFrame()` 集中提交 DOM；读取阶段计算挂载点、边框圆角、轨道矩形、胶囊侧向和目标尺寸且不写状态，提交阶段才创建/复用节点并写入样式。
- 接管安全：空帧只保留隐藏 Layer，不隐藏 Canvas；只有首批轨道节点已挂载且全部连接后才接管 Canvas。节点脱离会在隐藏 Canvas 前抛错，由入口失败路径立即销毁 Renderer 并恢复 Canvas。
- 恢复边界：禁用设置、Renderer 异常、心跳超时、Worker stop/destroy、实例清空、路由重置、Canvas 脱离、Canvas 自身全屏和页面销毁继续统一调用同步 `shutdown()`；恢复原始内联 visibility、移除接管标记、取消操作请求并删除 Layer/轨道节点。
- 节点复用：每条轨道只创建一个 DOM 状态并登记在 `rendererNodes`；后续帧直接消费已有节点引用，不查询全页或重建富内容。消息文本被隔离世界恢复后通过 Renderer 窄接口刷新全部 metadata 与 aria-label。
- 测试：新增 `dom-renderer.spec.ts` 8 项测试，覆盖读写阶段分离、首节点连接后接管、空帧不接管、节点复用与位移提交、富内容和元数据刷新、异常/心跳/销毁恢复、禁用帧同步关闭，以及入口协调器源码边界。
- 自动验证：定向 Vitest 8 项、`npm run type-check`、`npm run lint:check`、`npm run build` 已通过；旧 Node 回归首次发现 3 项源码结构断言仍读取入口内已迁出的 Layer/hover/本人标记实现，已改为分别验证 DOM Renderer 模块和入口回调，相关 31 项回归随后通过。最终 `npm run check` 通过（88 个 Vitest 文件、436 项单元测试、135 项回归测试），严格类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实直播间；真实 Canvas 首帧接管、富表情渲染、全屏挂载、心跳恢复、切房和长时间节点复用保留到阶段 DP/F 门禁。
- 遗留问题：操作胶囊的尺寸规则、激活流程、单条悬停和雷达覆盖释放仍由页面入口回调装配；下一未完成项为 DP-11，将提取页面胶囊与单条悬停控制。

### 2026-09-05 — DP-09

- 状态：完成
- 变更：新增严格类型化且无 DOM 依赖的 `page/channel-scheduler.ts`，统一拥有频道数量同步、pending 入队与优先级分配、多行频道占位、前序碰撞间距、保留期限、过期释放和状态清空；页面入口只保留 Canvas 可用性检查、计时器、诊断事件与 DOM 节点清理。
- 队列语义：pending 上限、空队列立即调度和 300ms 后续重试保持不变；只有成功入队后才消费本人消息意图，避免满队列丢弃消息时误消耗后续本人弹幕匹配。
- 尺寸变化：调度器根据当前 Canvas/config 同步频道数量；缩小时会完整解除落在被删除频道内的多行轨道占位并重新排队，入口删除旧 DOM 节点后按同一轨道模型重新创建，避免频道截断后留下未托管轨道。
- 兼容边界：根目录 `track-model.ts` 改为运动模型与频道辅助函数的兼容重导出，不再保留第二份调度实现；旧 Node 回归夹具仍通过该 facade 验证既有几何与频道行为。
- 测试：新增 `channel-scheduler.spec.ts` 6 项测试，覆盖突发弹幕分配、频道满载时保留/丢弃、长短弹幕安全间距、Canvas 高度缩小时重新排队、过期释放，以及调度器无 DOM 依赖的源码边界。
- 自动验证：定向 Vitest 12 项、`npm run lint:check`、`npm run build` 已通过；`npm run test:regression` 首次发现一项源码结构断言仍要求旧的对象字面量位置，已更新为验证成功入队后的等价本人消息赋值，随后相关 31 项 Node 回归通过。最终 `npm run check` 通过（87 个 Vitest 文件、428 项单元测试、135 项回归测试），严格类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实直播间；真实突发弹幕、Canvas 尺寸切换、全屏、切房和高密度频道行为保留到阶段 DP/F 门禁。
- 遗留问题：DOM Layer/轨道节点创建、Canvas 安全接管及帧内样式同步仍位于页面入口；下一未完成项为 DP-10，将提取 DOM Renderer。

### 2026-09-04 — DP-08

- 状态：完成
- 变更：新增严格类型化且无 DOM 依赖的 `page/track-motion.ts`，迁出轨道初始状态、位置、速度、尺寸、暂停、恢复、过期、RAF 帧间隔和前序安全间距推进；`track-model.ts` 暂只保留等待 DP-09 迁移的频道范围、优先级和保留期限，并兼容重导出纯运动 API。
- 时间基准：Renderer 动画循环改用 `requestAnimationFrame` 回调的单调时间戳，`lastFrameAt` 改为显式 `AnimationFrameMilliseconds`；消息观察、官方 `startTime` 和调度期限继续使用 Unix 时间，但不再参与 RAF 位移差值。`trackNeedsReserve()` 也改为显式接收同一次调度的 `now`，内部不再调用 `Date.now()`。
- 悬停语义：轨道新增独立 `RendererTrackMotionState`。悬停时冻结模型距离而非只冻结 DOM，连续悬停幂等；松开后从冻结距离按原速度继续，不补算悬停期间经过的时间，也不再使用 `resumeOffset` 或后台幽灵轨迹追赶。
- 防抖保护：安全间距约束只允许轨道继续前进或原地等待；当尺寸变化或前序轨道位置异常使约束距离落在当前距离之后时，禁止把轨道倒推，从模型层消除可见的前后抽搐来源。
- 纯边界：位置、速度、暂停/恢复、过期和间距推进函数不访问 `document`、样式、RAF 或墙上时钟，可以在 jsdom 之外直接运行；DOM 同步只消费计算后的矩形和暂停状态。
- 测试：新增 `track-motion.spec.ts` 6 项固定时间序列测试，覆盖速度/几何、正常移动、连续暂停与无追赶恢复、安全间距且不后退、单调帧时间和过期、纯模块源码边界；更新既有轨道模型回归 fixture 使用新的 motion 状态。
- 最终验证：`npm run check` 通过（86 个 Vitest 文件、422 项单元测试、135 项回归测试），严格类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实直播间；真实悬停、连续悬停、操作按钮释放、后台切换、缩放和高密度安全间距行为保留到阶段 DP/F 门禁。
- 遗留问题：频道创建、pending 分配、碰撞占位、保留期限和频道释放仍位于页面入口及 `track-model.ts`；下一未完成项为 DP-09，将提取频道调度器。

### 2026-09-04 — DP-07

- 状态：完成
- 变更：新增严格类型化的 `page/renderer-instance-registry.ts`，统一拥有 Renderer 实例 Map、Canvas 所有权、默认配置、实例创建/替换、配置更新、重置、移除、批量销毁、孤立消息缓存、定时恢复和过期回收；对外提供 `get/create/recover/remove/reset/resetAll/destroyAll/values` 等窄接口。
- Canvas 所有权：注册表为每个 Canvas 记录唯一实例所有者；其他实例重复认领同一 Canvas 会被拒绝并记录 `canvas-claim-rejected`，同一实例更换 Canvas 时会先完整清理旧实例并释放旧所有权。
- 晚注入恢复：未找到映射 Canvas 的 create/add/config 命令进入有界孤立缓存；发现未认领弹幕 Canvas 后以 `recovering` 状态重建实例并重放缓存弹幕。首次创建但 Canvas 尚未挂载时保留 8 秒宽限，已经挂载过的 Canvas 脱离后转为孤立配置，允许新 Canvas 重新关联。
- 清理边界：Worker `clear`、SPA 路由切换、Canvas 脱离和 Worker `destroy` 分别通过注册表的 reset、resetAll、sweepDetached 和 remove 处理；入口不再直接 `set/delete` 实例 Map，也不再拥有 orphan Map 或恢复计时器。
- 安全门：恢复实例继续设置 `rendererSafeSync=false` 和基于官方持续时间的接管等待；Worker clean-clear 继续要求下一条干净同步边界，避免启用 DOM Renderer 时过早隐藏官方 Canvas。
- 诊断：注册表输出实例数、孤立数、Canvas 认领数和恢复定时器状态；创建、恢复、替换、拒绝认领、脱离、过期和销毁统一进入页面诊断事件。
- 测试：新增 `renderer-instance-registry.spec.ts` 6 项测试，覆盖正常创建、完整默认状态、重复 Canvas 认领、晚注入恢复、首次挂载宽限、脱离后重新挂载、Worker/路由重置、移除/批量销毁和入口源码所有权边界；Canvas Hook 与 Worker Hook 相关测试继续通过。
- 最终验证：`npm run check` 通过（85 个 Vitest 文件、416 项单元测试、135 项回归测试），严格类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实直播间；真实 OffscreenCanvas 映射、晚注入、SPA 切房、Canvas 重建和网页全屏重挂载保留到阶段 DP/F 门禁。
- 遗留问题：轨道位置、速度、暂停恢复、过期和安全间距仍混合在页面循环及 `track-model.ts` 中；下一未完成项为 DP-08，将提取并收紧纯轨道运动模型。

### 2026-09-04 — DP-06

- 状态：完成
- 变更：新增严格类型化的 `page/content-measurer.ts`，迁出 Canvas 2D 测量上下文、文字测量、图片宽高比、盒模型边距、嵌套 inline/block 合并、继承文字样式和最终内容描述；`douyin-page-hook.ts` 只创建一个测量器，并在弹幕准备阶段读取已经测量完成的结果。
- 像素约束：测量结果统一为 CSS 像素，不读取 `devicePixelRatio`，设备像素换算继续由既有轨道模型负责；Canvas 2D 不可用时保持按 Unicode 字符数和字号估算的确定性回退。
- 缓存：文字宽度缓存键明确为“CSS font shorthand + 规范化正文 + 当前字体可用状态”，字号、字重、字体或字体加载状态变化会自然换键；提供 `invalidate()` 处理键无法感知的外部字体度量变化，采用最大 512 项的有界先进先出淘汰。图片比例按调用参数实时读取，不进入文字缓存。
- 数据一致性：解析器把同一份已序列化、有界的富内容传给测量器，避免再次遍历未经约束的页面对象；连续图片、图文混排和 Renderer 最终绘制继续共享同一份内容顺序。
- 诊断：页面调试快照新增 `contentMeasurer`，可查看测量上下文可用性、缓存大小、命中、未命中、淘汰和显式失效次数。
- 测试：新增 `content-measurer.spec.ts` 6 项测试，覆盖文字与盒模型、Emoji 图片比例、嵌套 inline/block、字号缩放且不依赖 DPR、缓存键与失效、入口源码边界；DP-05 内容解析测试继续通过。
- 最终验证：`npm run check` 通过（84 个 Vitest 文件、410 项单元测试、135 项回归测试），严格类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实直播间；真实字体加载、不同 DPR、图片表情比例、网页缩放和全屏尺寸回归保留到阶段 DP/F 门禁。
- 遗留问题：Renderer 实例创建、孤立消息恢复、Canvas 重新关联和销毁仍由页面入口直接管理；下一未完成项为 DP-07，将只提取 Renderer 实例注册表。

### 2026-09-04 — DP-05

- 状态：完成
- 变更：新增 `page/barrage-content.ts`，以严格类型化的 `prepareDouyinBarrage()` 将官方 Renderer options/content 转换为 `PreparedBarrage`；页面入口只负责调用解析器并通过 `registerPreparedBarrage()` 登记实例状态，不再在 `prepareBarrage` 中混合内容解析、雷达采集和实例写入。
- 内容边界：统一提取有界富内容、交互正文、全部图片资源与表情 token、消息 ID、发送者、首段文字样式、颜色/字体、频道范围、优先级、开始时间、持续时间和保留时间；连续图片表情与图文混排保持原始顺序。
- 共享描述：Renderer 轨道和轻量雷达消费同一份 `PreparedBarrage`；礼物、福袋等活动消息只记录 `repeatReminderExclusion` 并跳过雷达统计，不会阻止官方消息进入 DOM Renderer。
- 兼容处理：解析器接受现有 `describeBarrage()` 的布局前测量草稿，并补齐 `contentWidth`、`contentHeight`、`actionWidth` 和 `rendererPadding` 默认值，避免拆分后因布局字段尚未生成而产生运行时异常；表情目录更新后的待处理消息也通过同一解析器重建。
- 测试：新增 `barrage-content.spec.ts` 6 项测试，覆盖普通文字与样式/轨道信息、连续表情、图文混排、礼物/福袋仅排除雷达、未知结构安全拒绝、解析/实例注册源码边界；同步更新内容媒体安全和表情回退回归断言，使其验证新模块所有权。
- 最终验证：`npm run check` 通过（83 个 Vitest 文件、404 项单元测试、135 项回归测试），严格类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实直播间；真实 Renderer options 变体、连续表情、图文混排、礼物/福袋显示与雷达排除保留到阶段 DP/F 门禁。
- 遗留问题：文本与图片测量、图片比例缓存和继承样式测量仍位于页面入口；下一未完成项为 DP-06，将只提取内容测量器。

### 2026-09-04 — DP-04

- 状态：完成
- 变更：新增 `createDouyinWorkerHook()` 和 `parseDouyinRendererCommand()`，迁出 Worker/MessagePort `postMessage` 旁路观察、原型补丁安装/释放、原始消息校验以及 `create-instance / add-barrage / update-config / clear / destroy / stop / start` 判别联合命令转换；页面入口只消费类型化 Renderer 命令。
- 投递保证：wrapper 延续原有“先旁路观察、再调用官方方法”的顺序；原始 `this`、消息对象、第二参数中的 transfer list/序列化选项引用和返回值均不改写，原方法每次只调用一次。观察或业务回调抛错会被隔离并记录，不会吞掉官方消息。
- 补丁所有权：Worker 与 MessagePort 原型分别使用页面级共享补丁记录；同一 Hook 重复安装幂等，多个 Hook 共享单层 wrapper，最后一个所有者销毁后恢复各自原始方法，且不会覆盖后续由其他代码替换的方法。
- 流量边界：只观察明确传入的 Worker 和 MessagePort 原型，不读取或补丁 WebSocket；未知方法、无实例 ID 及其他私有消息只透传，不输出 Renderer 命令。
- 诊断：Hook 独立记录安装状态、已补丁目标、复用补丁数量、识别命令数、忽略消息数和最后命令时间；页面调试快照新增 `workerHook` 段，既有 `workerMessages` 计数现在明确表示成功转换的 Renderer 命令数。
- 保持不变的行为：Canvas Hook、实例创建/恢复决策、孤儿消息、配置合并、轨道准备、Renderer 显隐和悬停算法未修改。
- 测试：新增 `worker-hook.spec.ts`，覆盖 create/add/config/clear 命令转换、非法与无关流量、观察/投递顺序、消息和 transfer list 引用、原方法调用次数与返回值、观察异常隔离、共享 wrapper、幂等安装、最终原型恢复和入口源码边界。
- 最终验证：`npm run check` 通过（82 个 Vitest 文件、398 项单元测试、135 项回归测试），严格类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过；`git diff --check` 通过。
- 手工验证：本步骤未连接真实直播间；真实 Worker/MessagePort 消息形态、transfer list、Canvas 绑定和长期运行旁路开销保留到阶段 DP/F 门禁。
- 遗留问题：官方 barrage options 的内容提取与描述生成仍内联在页面入口；下一未完成项为 DP-05，将只提取弹幕内容解析器。

### 2026-09-04 — DP-03

- 状态：完成
- 变更：新增 `createDouyinCanvasHook()`，迁出弹幕 Canvas 结构识别、稳定 ID 分配、未认领 Canvas 查找、OffscreenCanvas → 原 Canvas 映射和 `transferControlToOffscreen` 原型观察；`douyin-page-hook.ts` 不再直接读取或修改 Canvas 原型。
- 补丁所有权：通过 `Symbol.for` 保存页面级共享补丁记录和原始原型方法；同一 Hook 重复安装幂等，多个 Hook 实例共享一层 wrapper，最后一个所有者销毁时才恢复原始方法，且不会覆盖安装后由其他代码替换的方法。
- 过滤与兼容：原生 `transferControlToOffscreen` 对所有 Canvas 保持原调用顺序和返回值；只有七层祖先范围内带 `danmaku / danmu / barrage / bullet` 结构标记的 Canvas 才会被编号、映射和上报，普通 Canvas 不进入页面运行时状态。
- 诊断：Hook 独立记录安装状态、是否复用已有补丁、有效/忽略 transfer 次数和最后一次有效 transfer 时间；页面调试快照新增 `canvasHook` 诊断段，原有 `canvasTransfers` 计数与事件名称保持不变。
- 保持不变的行为：Worker/MessagePort 观察、实例创建和恢复、Renderer Canvas 显隐接管、轨道调度、悬停与胶囊行为未修改。
- 测试：新增 `canvas-hook.spec.ts`，覆盖普通 Canvas 透传、弹幕 Canvas 映射与稳定 ID、未认领查找、重复安装、多个所有者、最终原型恢复及入口源码边界。
- 最终验证：`npm run check` 通过（81 个 Vitest 文件、391 项单元测试、135 项回归测试），严格类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过；`git diff --check` 通过。
- 手工验证：本步骤未连接真实直播间；真实抖音 Canvas 祖先标记、OffscreenCanvas 转移时机、SPA 切房和网页全屏回归保留到阶段 DP/F 门禁。
- 遗留问题：Worker 与 MessagePort 的 `postMessage` 原型观察仍内联在页面入口；下一未完成项为 DP-04，将只提取该旁路观察和内部命令转换。

### 2026-09-04 — DP-02

- 状态：完成
- 变更：新增严格类型化的 `createDouyinPageBridge()`，统一拥有 MAIN world 的 `window.message` 注册/释放、协议来源与 payload 校验、判别联合分发和所有 page → content 消息封装；`douyin-page-hook.ts` 已删除散落的 `window.postMessage` 与消息判断。
- 请求关联：Renderer `+1`、收藏和复制请求统一由 bridge 按“响应类型 + requestId”登记和超时结算；因此不同操作可以安全复用相同数字 ID，重复响应、取消后的响应及超时后的迟到响应不会重复触发业务回调。
- 生命周期：bridge 的 `start()` 与 `destroy()` 均幂等；销毁时移除唯一的 `window.message` 监听器并清理全部待响应计时器。实例关闭时仍通过已类型化的 `cancelResponse()` 主动取消所属操作请求。
- 保持不变的行为：ready/debug/settings 回执字段、本人消息消费通知、雷达只读消息、Renderer 操作 payload、按钮反馈时长和 8 秒操作超时保持原值；Canvas、轨道、频道、悬停和 DOM Renderer 算法未修改。
- 测试：新增 `page-bridge.spec.ts`，覆盖非法事件来源、可信来源的非法 payload、幂等启动/销毁、协议封装、相同 requestId 的跨操作隔离、重复响应、响应超时及迟到响应；源码边界测试确保页面入口不再直接注册消息监听或调用 `window.postMessage`。
- 最终验证：`npm run check` 通过（80 个 Vitest 文件、386 项单元测试、135 项回归测试），严格类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过；`git diff --check` 通过。
- 手工验证：本步骤未连接真实直播间；跨 world 的真实消息往返、操作回执和 SPA 注入恢复保留到阶段 DP/F 门禁。
- 遗留问题：Canvas 识别与接管 Hook 仍内联在页面入口；下一未完成项为 DP-03，将只提取该 Hook，不迁移 Worker 消息观察或 Renderer 算法。

### 2026-09-04 — DP-01

- 状态：完成
- 变更：新增抖音 MAIN world 页面运行时核心类型，覆盖 Renderer 配置、实例、待调度弹幕、轨道、频道、DOM 渲染状态、帧缓存、孤儿实例、本人消息与操作请求；页面 Hook 的核心集合、请求队列、Canvas 映射、测量上下文和计时器已补充泛型。
- 单位与所有权：新增毫秒时间、毫秒时间戳、CSS 像素、设备像素、缩放比例、计时器和 RAF 标识类型；`RendererInstance` 明确拥有 Canvas、轨道表、待调度队列、频道、DOM Layer/节点表和生命周期，`RendererTrack` 明确反向归属实例及其 DOM 状态。
- 生命周期：定义 `recovering / observing / active / suspended / blocked / destroyed` 六种状态和有界失败原因；创建、Canvas 接管、恢复、失败、Worker clear/start/destroy 等现有路径同步记录状态，但不参与控制流判断，不改变渲染与调度算法。
- 全局声明：为 `globalThis.__danmakuEchoDouyinDebug` 增加精确声明，并保留已有 page hook 加载标志声明；调试计数、事件和值结构均有类型边界。
- 类型安全：`track-model.ts` 复用页面运行时的配置和轨道结构，避免维护第二套松散接口；核心类型模块未使用 `any`、`@ts-ignore` 或 `@ts-expect-error`。
- 测试：新增 `runtime-types.spec.ts`，锁定生命周期、失败原因、实例/轨道/请求泛型、单位字段和禁用类型逃逸约束。
- 最终验证：`npm run check` 通过（79 个 Vitest 文件、381 项单元测试、135 项回归测试），严格类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过；`git diff --check` 通过。
- 手工验证：本步骤只增加类型和不参与控制流的生命周期记录，未连接真实直播间；Canvas 接管、悬停、操作胶囊和网页全屏回归保留到阶段 DP/F 门禁。
- 遗留问题：`douyin-page-hook.ts` 仍保留 `@ts-nocheck` 和内联协议桥；下一未完成项为 DP-02，将只提取 MAIN world 协议桥。

### 2026-09-04 — DC-14

- 状态：完成
- 变更：将抖音隔离世界的依赖装配迁入严格类型化的 `createDouyinContentApp()` 工厂；`douyin-content.ts` 缩减为 13 行，只保留共享 API/平台/重复加载检查、运行时创建和 `runtime.start()`，并删除 `@ts-nocheck`。
- 新增或移动的文件：新增 `src/platforms/douyin/content/content-app.ts` 作为运行时装配工厂；`src/entries/douyin-content.ts` 成为最小入口；已有控制器源码边界测试改为检查装配工厂，另新增入口行数、禁用类型逃逸、无计时器/监听器/业务控制器构造断言；同步更新 `docs/ENTRY_RUNTIME_ARCHITECTURE.md`。
- 类型收紧：为聊天解析过滤、富文本输入、DOM/Renderer 操作、回复候选、原生发送观察、调试级别、事件目标、全屏兼容字段和 Renderer 回执原因补齐精确类型；未新增 `any`、`@ts-ignore` 或 `@ts-expect-error`。
- 保持不变的行为：运行时仍使用 DC-13 固定的 bridge → settings → features/controllers → observers 启动顺序；发送、回复、收藏、雷达、本人消息、表情目录和悬停控制器实例及参数保持不变。
- 测试：抖音 content 模块专项 14 个文件、79 项测试通过；源码回归改为跟随装配职责的新位置，并继续验证雷达热路径、虚拟列表发送者、富表情发送和页面桥边界。
- 最终验证：`npm run check` 通过（78 个 Vitest 文件、378 项单元测试、135 项回归测试），严格类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过；`git diff --check` 通过。
- 手工验证：本步骤未连接真实直播间；抖音直接进房、SPA 进房/切房、普通模式和网页全屏回归保留到阶段 F 的统一门禁。
- 遗留问题：抖音隔离世界 DC 阶段已完成；下一未完成项为 DP-01，将只定义抖音 MAIN world 页面运行时核心类型，不改动现有页面行为。

### 2026-09-04 — DC-13

- 状态：完成
- 变更：新增 `DouyinContentRuntime`，统一拥有设置加载/变更订阅、运行时诊断消息、SPA 路由轮询、页面可见性、`pagehide`、心跳、交互事件绑定，以及功能、控制器和观察器的启动/暂停/销毁；启动顺序固定为 page bridge → settings → feature collectors/controllers → DOM observers，最终销毁按相反层级执行。
- 新增或移动的文件：新增 `src/platforms/douyin/content/content-runtime.ts`、`src/platforms/douyin/content/content-diagnostics.ts`、`src/platforms/douyin/content/__tests__/content-runtime.spec.ts` 和 `src/platforms/douyin/content/__tests__/content-diagnostics.spec.ts`；`douyin-content.ts` 删除 storage、debug marker、route poll、visibility、pagehide 和 runtime message 的内联实现，仅组装依赖并调用 `runtime.start()`；`runtime-state.ts` 删除已由 runtime/diagnostics 私有持有的 route、heartbeat 和 debug marker 计时器。
- 生命周期保证：重复 `start()` 不会重复创建收藏/雷达 UI、控制器、观察器或监听器；页面隐藏时只逆序暂停观察器和控制器，恢复时复用原功能实例；SPA 进入直播、切房、离开直播和重新进入只重置页面桥接并触发恢复，不重建雷达；`pagehide` 才完成一次性总销毁。
- 诊断收口：调试事件裁剪、快照生成、隐藏 JSON marker 的调度与清理由独立诊断控制器负责；扩展诊断请求的监听和解绑由 `DouyinContentRuntime` 统一管理。
- 测试：新增启动顺序、重复启动、隐藏/恢复、直播路由进入/切换/离开/重新进入、监听器所有权、逆序销毁、重复销毁和诊断 marker 清理测试。
- 最终验证：`npm run check` 通过（78 个 Vitest 文件、377 项单元测试、135 项回归测试），类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过；`git diff --check` 通过。
- 手工验证：本步骤未连接真实直播间；首次静态进房、SPA 进房/切房、标签页隐藏恢复、普通页面/网页全屏和扩展更新后的资源释放留到阶段 DC/F 门禁。
- 遗留问题：隔离世界入口仍保留业务依赖组装和 `@ts-nocheck`；下一项 DC-14 将只瘦身入口并完成严格类型化，不改动页面行为。

### 2026-09-04 — DC-12

- 状态：完成
- 变更：新增类型化抖音雷达采集器，将侧聊描述、Page Renderer 消息接入、文本/富文本转换、礼物/福袋/系统/图片表情过滤、3 秒双源去重和房间级 suppression 从入口迁出；`RepeatReminderRuntime` 新增可注入的 source collector 接口，由运行时统一连接 `ingest` 与 `suppressText`。
- 新增或移动的文件：新增 `src/platforms/douyin/content/radar-collector.ts` 和 `src/platforms/douyin/content/__tests__/radar-collector.spec.ts`；`douyin-content.ts` 只创建并向 repeat reminder runtime 注入 `radarCollector`，bridge 的 Renderer 事件直接转交采集器；`runtime-state.ts` 删除 suppression map；通用 `runtime.ts` 负责 collector 的连接和销毁。
- 双源规则：侧聊与直播流使用规范化文本、发送者和来源建立有界指纹；3 秒内一对 chat/video 镜像只放行先到的一条，同一来源的合法重复继续逐条计数，3 秒外再次出现可以重新计数。
- 过滤与房间生命周期：只有纯文本聊天进入统计；礼物、福袋/模拟活动、系统提示、纯图片表情和图文图片表情全部排除。Renderer 识别到福袋等活动时会抑制同文本侧聊，suppression 保留 30 分钟，但切换直播间立即清空，避免跨房间污染。
- 协议修复：Page Renderer 对无排除原因的普通弹幕统一发送空字符串，不再把 `null` 交给只接受字符串的桥接校验，从而避免正常直播流雷达消息被协议层丢弃。
- 测试：新增普通同源重复计数、3 秒双源去重与窗口外重计、礼物/福袋/系统/图片表情过滤、Renderer 图片表情仅做显示文本回传、当前房间 suppression 与切房清理、入口源码边界测试；旧性能与表情回归断言迁移到新采集器/发送控制器。
- 最终验证：`npm run check` 通过（76 个 Vitest 文件、373 项单元测试、135 项回归测试），类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过；`git diff --check` 通过。
- 手工验证：本步骤未连接真实直播间；抖音普通页面与网页全屏中的侧聊/直播流镜像计数、福袋/礼物/图片表情过滤和切房状态重置留到阶段 DC/F 门禁。
- 遗留问题：设置、诊断、SPA 路由与可见性生命周期仍由入口组合；下一项 DC-13 将只提取设置、诊断和 SPA 生命周期。

### 2026-09-03 — DC-11

- 状态：完成
- 变更：新增类型化本人消息控制器，将插件发送意图、手动输入快照、手动图片表情点击、侧聊匹配、虚拟列表观察、本人消息框选定位和清理从抖音入口迁出；发送控制器、手动发送和侧聊框选现统一经过同一意图队列。
- 新增或移动的文件：新增 `src/platforms/douyin/content/own-message-controller.ts` 和 `src/platforms/douyin/content/__tests__/own-message-controller.spec.ts`；`douyin-content.ts` 仅组合控制器并转发 bridge、解析器、编辑器、发送者索引和诊断回调；`runtime-state.ts` 删除 manual intent、pending emoji、own chat frame/observer、输入快照和扫描计时器状态。
- 意图一致性：每次发送只生成一个 intent ID 和一个 payload signature；同一协议载荷将 ID、signature、文本、纯文本和资源标识同步给 page runtime，侧聊匹配使用同一意图对象，直播流与侧聊不再分别推断本人消息身份。
- 匹配与框选：建立发送前最近 120 行签名基线，避免相同旧消息被误认；新侧聊行按正文和资源身份匹配，命中后创建独立透明边框；虚拟列表复用、移除、尺寸变化、功能关闭、页面隐藏和销毁均会清理观察器、动画帧、标记与队列。
- 手动发送：输入事件保存 4 秒编辑器快照，以覆盖站点先清空输入框再派发点击/回车的时序；可信表情面板点击先建立图片意图，最终发送时合并资源并取消临时意图，避免单次发送产生两个本人标记。
- 测试：新增手动文字快照、手动图片表情、插件 +1、发送失败取消、重复内容基线、12 秒超时、共享 ID/signature、边框与销毁状态测试；旧回归断言迁移到新控制器，继续验证观察器只挂载聊天根、手动发送识别、Renderer 竞态协调和移除节点发送者保留。
- 最终验证：`npm run check` 通过（75 个 Vitest 文件、367 项单元测试、135 项回归测试），类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过；`git diff --check` 通过。
- 手工验证：本步骤未连接真实直播间；抖音普通页面和网页全屏中的手动文字、图片表情、插件 +1、侧聊与直播流本人框选留到阶段 DC/F 门禁。
- 遗留问题：雷达双源采集仍由入口与 page runtime 分别接入；下一项 DC-12 将只提取雷达采集器。

### 2026-09-03 — DC-10

- 状态：完成
- 变更：新增类型化抖音发送控制器，将发送保护、富文本规范化、官方括号表情文本恢复、输入写入、发送按钮评分、按钮/回车三级后备、输入消费确认、DOM 提示与原生网络结果合并、平台限流冷却和成功/失败反馈统一为 `send()` 管线；入口中的 `repeatMessage`、按钮发现和保护结算实现已删除。
- 新增或移动的文件：新增 `src/platforms/douyin/content/send-controller.ts` 和 `src/platforms/douyin/content/__tests__/send-controller.spec.ts`；`douyin-content.ts` 的胶囊、Alt+单击、收藏夹和雷达 +1 均调用同一发送控制器；`send-coordinator.ts` 的平台类型扩展到四平台并新增返回完整阻断原因的 `beginResult()`；`tests/contracts/emoji-fallback.test.mjs` 的发送源码断言迁移到新控制器。
- 统一结果：所有路径返回公共 `SendResult`；除误触、冷却、重复和进行中外，补充 `editor-not-found`、`emoji-text-unavailable`、`input-not-consumed`，同时保留 `platform-feedback`、`unconfirmed` 和网络摘要。
- 表情规则：普通文字使用 `text` 方法；连续 `[表情]`、重复 `[表情]` 和图文混排统一使用 `native-emoji` 方法并向官方输入框写入完整文本。只要完整括号文本可信，图片 URL、图片下载和原生表情面板均不是发送前置条件。
- 保护与反馈：本地重复/误触保护在写入前执行；平台返回限流、重复或拒绝时通过现有 `SendCoordinator` 单次结算，将经过清理的请求方法、接口、HTTP 状态和业务码合并到弹窗，并更新统一冷却状态。
- 测试：新增普通文本、连续表情、重复与图文混排表情、缺少图片 URL/token、重复发送、误触、平台限流、请求摘要、输入未消费、intent 取消和入口源码边界测试。
- 最终验证：`npm run check` 通过（74 个 Vitest 文件、360 项单元测试、135 项回归测试），类型检查、Oxlint、ESLint、全部构建和 Manifest/架构/CI/发布配置校验均通过；`git diff --check` 通过。
- 手工验证：本步骤未连接真实直播间；抖音普通页面和网页全屏中的文本/连续表情/混排表情发送、官方限流反馈与焦点释放保留到阶段 DC/F 门禁。
- 遗留问题：插件发送 intent、手动输入/表情快照和侧聊本人消息框选仍由入口维护；下一项 DC-11 将只提取本人消息控制器。

### 2026-09-03 — DC-09

- 状态：完成
- 变更：新增类型化抖音编辑器控制器，将输入框发现与场景评分、原生输入框和 `contenteditable` 值写入、`beforeinput/input/change` 事件、Selection/Range、光标恢复、输入框重建后的重新聚焦、发送消费等待和焦点释放从入口迁出；回复流程只向输入框写入 `@发送者` 草稿并聚焦，不触发点击或回车发送。
- 新增或移动的文件：新增 `src/platforms/douyin/content/editor-controller.ts` 和 `src/platforms/douyin/content/__tests__/editor-controller.spec.ts`；`douyin-content.ts` 改为通过控制器完成全部输入面操作，并把控制器纳入文档隐藏/恢复生命周期；`tests/contracts/emoji-fallback.test.mjs` 的源码边界断言迁移到新控制器。
- 保持不变的行为：普通页面优先侧聊输入框、网页全屏优先播放器内输入框；原生 value setter 和可组合输入事件继续驱动受控编辑器；连续或图文混排的抖音 `[表情]` 仍按完整官方文本写入，不依赖图片面板；发送按钮选择和平台结果判定留在 DC-10。
- 生命周期：延迟光标恢复只跟随内容仍匹配的原输入框或重建后的当前输入框；`releaseFocus()` 与 `destroy()` 会取消待执行的动画帧和计时器，页面恢复可见后由 `start()` 重新启用。
- 测试：新增输入框评分、原生输入框、`contenteditable`、连续括号表情、回复不发送、输入框重建、发送后清空、焦点释放、销毁后不重新聚焦和入口源码边界测试。
- 门禁修正：首次完整检查的 73 个 Vitest 文件、352 项单元测试全部通过，但 2 项旧回归断言仍要求入口包含已迁出的 `setInputValue`/Range 源码；已将断言更新为“入口委托控制器、Selection/Range 仅存在于控制器”的新边界。
- 最终验证：`npm run check` 通过（73 个 Vitest 文件、352 项单元测试、135 项回归测试），类型检查、Lint、全部构建和 Manifest/架构/CI/发布配置校验均通过；`git diff --check` 通过。
- 手工验证：本步骤未连接真实直播间；抖音普通页面、网页全屏、受控编辑器重建和真实发送后的焦点行为保留到阶段 DC/F 门禁。
- 遗留问题：发送保护、发送按钮发现、回车后备和平台反馈仍由入口组合；下一项 DC-10 将只提取抖音发送控制器。

### 2026-09-03 — DC-08

- 状态：完成
- 变更：新增类型化抖音操作分发器，将 DOM 胶囊与页面 Renderer 胶囊的 `plusOne`、`reply`、`favorite`、`copy` 统一为语义 action；入口只负责把 UI 事件转换为 action、展示结果和发送跨世界响应，富文本恢复、复制、收藏、回复和发送调用均由分发器按统一规则编排。
- 新增或移动的文件：新增 `src/platforms/douyin/content/action-dispatcher.ts` 和 `src/platforms/douyin/content/__tests__/action-dispatcher.spec.ts`；`douyin-content.ts` 删除四套 DOM 动作处理器、Renderer 动作处理器、可信点击临时状态和 activation request 集合；`runtime-state.ts` 删除相应状态；协议增加 `renderer-copy`/`renderer-copy-result`，`douyin-page-hook.ts` 的复制按钮改为只发送语义请求，不再直接操作剪贴板。
- 安全边界：Renderer action 必须同时匹配近期可信点击的 action、instance ID、track ID 和规范化完整文本，并校验协议消息类型与语义 action 的固定映射；可信记录单次消费，过期、伪造、禁用、无效消息和重复 request ID 均在业务调用前拒绝。
- 生命周期：分发器的 `start()` 幂等安装唯一可信点击监听；已处理请求采用带 action 前缀的 10 秒去重键；`destroy()` 对称移除监听、清除可信记录、请求键和全部清理计时器，文档恢复可见时可重新启动。
- 测试：新增 DOM 四动作统一分发、可信点击、点击过期、文本/轨道/实例/action 伪造、协议 action 伪造、操作禁用、请求去重、复制跨世界协议、入口源码边界和生命周期销毁测试；同步扩展协议及页面桥接穷尽性测试。
- 门禁修正：首次完整检查发现旧回归测试仍断言文本规范化位于 `douyin-content.ts`；该断言已迁移到新的 action dispatcher 边界并重新执行完整门禁。
- 最终验证：`npm run check` 通过（72 个 Vitest 文件、345 项单元测试、135 项回归测试），类型检查、Lint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实直播间；抖音 DOM/Canvas 胶囊四动作、普通页面和网页全屏的完整手工回归保留到阶段 DC/F 门禁。
- 遗留问题：输入框评分、值写入、光标、焦点和回复草稿仍在入口；下一项 DC-09 将只提取编辑器控制器。

### 2026-09-03 — DC-07

- 状态：完成
- 变更：新增类型化抖音 DOM 悬停控制器，将直播画面 DOM 弹幕候选命中、单一活动选择、胶囊创建与定位、正文到胶囊间隙保护、锁定期、延迟隐藏、悬停续期、指针 RAF 合并及全局指针监听从入口集中迁出；入口仅通过控制器读取当前候选并执行复制、收藏、回复和 +1 业务。
- 新增或移动的文件：新增 `src/platforms/douyin/content/dom-hover-controller.ts` 和 `src/platforms/douyin/content/__tests__/dom-hover-controller.spec.ts`；`douyin-content.ts` 删除直接的 card lock/sticky/hide 状态与定位/命中实现；`runtime-state.ts` 删除候选、胶囊、锁、隐藏计时器和指针帧状态；`douyin-overlay.ts` 增加对称 `destroy()`，统一释放 Vue 实例、Portal、Toast 计时器和动画帧。
- 交互边界：侧聊列继续不生成直播画面胶囊；雷达图标和 +1 提示通过事件路径及坐标命中双重阻断底层弹幕；正文、间隙和胶囊使用同一选择生命周期；活动选择存在时不切换到另一条重叠弹幕，快速移动只处理每帧最新候选。
- 生命周期：控制器的 `start()` 幂等安装监听，`destroy()` 对称移除监听并清理候选、隐藏/续期计时器、待处理指针帧、定位帧和 Overlay；文档隐藏时销毁，恢复可见时重新启动，页面卸载不残留资源。
- 测试：新增正文命中、侧聊排除、正文—胶囊间隙、胶囊区域、雷达覆盖、快速移动合并、重叠候选单选、入口状态边界和完整销毁测试；完整 `npm run check` 通过（71 个 Vitest 文件、331 项单元测试、135 项回归测试），类型检查、Lint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实直播间；抖音普通页面、网页全屏、真实雷达覆盖以及高速弹幕下的单条悬停回归保留到阶段 DC/F 门禁。
- 遗留问题：DOM 胶囊动作和 Renderer 胶囊动作仍由入口中的不同函数接收；下一项 DC-08 将只提取统一操作分发控制器。

### 2026-09-03 — DC-06

- 状态：完成
- 变更：新增类型化抖音发送者索引，将当前侧聊行扫描、消息 ID 与文本关联、相似文本后备、有界观察序列、虚拟列表节点签名和 TTL 清理集中到单一模块；入口原有文本 Map、ID Map、历史数组及通用关联缓存已删除。
- 新增或移动的文件：新增 `src/platforms/douyin/content/sender-index.ts` 和 `src/platforms/douyin/content/__tests__/sender-index.spec.ts`；`douyin-content.ts` 改为通过发送者索引服务解析 DOM 候选、回复目标、Renderer 回复和富文本发送者，并在虚拟列表新增/更新/移除时提交 DC-04 descriptor；`runtime-state.ts` 移除发送者缓存状态与扫描计时器。
- 匹配优先级：平台消息 ID 精确匹配最高；无 ID 时，同文本多用户记录按 Renderer 的 `observedAt` 选择时间最近者，没有时间提示时选择最新可见发送者；仅在前两者均失败时启用至少 4 字符的包含关系后备，避免相同弹幕并发时回复错人。
- 虚拟列表与生命周期：节点内容未变化时通过 `WeakMap` 签名避免重复写入；复用节点的消息、ID 或发送者变化后会产生新观察；被移除节点在 chat parser 忘记前先写入索引；`prune()` 负责 TTL 和容量约束，`destroy()` 清空观察和节点签名。
- 公共契约：发送者索引对外实例只暴露 `remember()`、`resolve()`、`prune()`、`destroy()`，回复逻辑不再依赖入口中的多个缓存容器。
- 测试：新增公共 API 边界、当前聊天扫描、ID 优先、同文本用户冲突、时间窗匹配、最新发送者后备、TTL 过期、虚拟列表移除后保留、销毁清理和入口源码边界测试；完整 `npm run check` 通过（70 个 Vitest 文件、324 项单元测试、135 项回归测试），类型检查、Lint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实直播间；抖音多人同文回复、虚拟列表高速滚动、普通页面和网页全屏的完整手工回归保留到阶段 DC/F 门禁。
- 遗留问题：DOM 候选命中、悬停状态机、胶囊定位和相关监听仍留在入口；下一项 DC-07 将只提取 DOM 悬停和胶囊控制器。

### 2026-09-03 — DC-05

- 状态：完成
- 变更：新增类型化抖音富文本恢复器，将 Renderer content 解析、Canvas 文本后备、侧聊富文本关联、图片资源评分、资源元数据合并、表情目录加载及有限重试集中到单一 resolver；解析结果以 `resolved`、`fallback`、`unresolved` 状态和明确原因返回。
- 新增或移动的文件：新增 `src/platforms/douyin/content/rich-content-resolver.ts` 和 `src/platforms/douyin/content/__tests__/rich-content-resolver.spec.ts`；`douyin-content.ts` 删除富文本合并和资源评分实现，改为组装 resolver，并让复制、收藏、+1、回复及 Renderer 雷达采集消费其结果；更新旧源码位置相关的回归断言。
- 保持不变的行为：保留最近 100 条侧聊候选、资源精确匹配优先于文字后备、同数量资源按 DOM 顺序补配、表情目录首次加载和最多 6 次 50ms 重试；普通文字、冒号文字和无法确认的装饰图片继续使用既有安全后备。
- 完整文本规则：连续、重复及图文交替的括号表情保持原始顺序；Canvas 已包含完整 `[名称]` 时直接作为可发送文本，即使图片资源缺失或加载失败也不再依赖图片插入；仍无法恢复 token 的 Renderer 图片返回 `renderer-emoji-unresolved`，不猜测错误表情名。
- 统一动作结果：resolver 的 `actionFromPayload()` 和 recovery `action` 统一决定复制文本、收藏内容与 +1 发送内容；抖音可原生识别的括号表情继续转换为纯文字动作，避免保存临时图片 URL。
- 测试：新增纯图片表情、连续及重复表情、图文交替、资源匹配优先级、资源失效括号文字后备、目录重试边界、结构化失败原因和入口源码边界测试；完整 `npm run check` 通过（69 个 Vitest 文件、318 项单元测试、135 项回归测试），类型检查、Lint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实直播间；抖音连续表情复制/收藏/+1、普通页面和网页全屏的完整手工回归保留到阶段 DC/F 门禁。
- 遗留问题：侧聊扫描、消息 ID/文字时间窗关联和发送者 TTL 缓存仍由入口直接维护；下一项 DC-06 将只提取发送者索引。

### 2026-09-03 — DC-04

- 状态：完成
- 变更：新增类型化抖音侧聊解析器，将聊天正文、发送者、消息 ID、图片资源、富文本顺序和消息类别集中为不可变 `DouyinChatMessageDescriptor`；使用 `WeakMap` 和包含消息 ID、正文、图片、发送者的节点签名复用稳定结果，并在虚拟列表复用时自动识别内容变化，移除节点完成最后解析后显式忘记缓存。
- 新增或移动的文件：新增 `src/platforms/douyin/content/chat-parser.ts` 和 `src/platforms/douyin/content/__tests__/chat-parser.spec.ts`；`douyin-content.ts` 改为让雷达、renderer/收藏富文本关联、发送者缓存和本人消息匹配共同消费解析器；更新旧源码位置相关的回归断言。
- 保持不变的行为：保留图片 token/资源 key、正文优先级、发送者属性优先级（稳定 user id 仍优先于可见昵称）、消息 ID 顺序、富文本 DOM 顺序、冒号文本不拆分以及礼物/福袋既有过滤逻辑；系统类别只使用明确结构标记或无有效正文判定。
- 数据契约：descriptor、messageIds、payload、parts、assets 和 asset keys 均在返回前冻结；普通文字、纯图片表情、图文混排、礼物、福袋和系统消息分别获得明确 `kind`。
- 测试：新增普通文字、连续图片表情、图文混排、礼物、福袋、系统消息、扩展自有节点过滤、虚拟列表节点更新/移除及不可变结果测试；完整 `npm run check` 通过（68 个 Vitest 文件、312 项单元测试、135 项回归测试），类型检查、Lint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实直播间；抖音侧聊虚拟列表、普通页面、网页全屏以及雷达/收藏/本人消息识别的完整手工回归保留到阶段 DC/F 门禁。
- 遗留问题：renderer、Canvas 与侧聊之间的跨来源富文本恢复仍保留在入口；下一项 DC-05 将只提取抖音富文本恢复器。

### 2026-09-03 — DC-03

- 状态：完成
- 变更：新增类型化抖音隔离世界页面桥接客户端，统一封装协议消息创建和发送、唯一 `window.message` 监听、递增 request ID、ready/debug 待处理请求、超时与重复响应清理、初始/路由恢复探测、renderer settings/heartbeat，以及原生发送网络观测的临时订阅；入口中的协议收发全部改走桥接 API。
- 新增或移动的文件：新增 `src/platforms/douyin/content/page-bridge.ts` 和 `page-bridge.spec.ts`；`protocol.ts` 导出 content/page 两侧协议 payload 类型；`runtime-state.ts` 移除已由桥接客户端拥有的 `nextRequestId`。
- 保持不变的行为：首次加载仍立即 ping，并在未 ready 时按 1 秒、3 秒、7 秒重试；设置变化、心跳、SPA 路由变化、表情目录、本人消息意图、renderer 操作结果和调试快照继续使用原协议字段；发送网络观测仍以 nonce、平台和 8.5 秒上限匹配。
- 生命周期与恢复：桥接 `start()` 幂等安装唯一消息监听；`destroy()` 对称移除监听并结清请求、恢复计时器和临时观测；ready 后停止剩余恢复探测，路由变化可标记不可用并重新探测，新页面 Hook 仍可通过 heartbeat 重新获得当前 renderer 设置。
- 测试：新增成功 ready、请求超时、重复响应、错误事件来源、非法页面协议消息、Hook 重载恢复、原生发送观测和销毁清理测试；新增源码门禁，确保 `douyin-content.ts` 不再直接注册 `window.message` 或调用 `window.postMessage`；完整 `npm run check` 通过（67 个 Vitest 文件、307 项单元测试、135 项回归测试），类型检查、Lint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤未连接真实直播间；抖音页面 Hook 注入、普通页面、网页全屏和真实发送观测的完整手工回归保留到阶段 DC/F 门禁。
- 遗留问题：页面桥接边界已建立，`douyin-content.ts` 仍内联侧聊富文本与发送者解析；下一项 DC-04 将只提取侧边聊天解析器。

### 2026-09-03 — DC-02

- 状态：完成
- 变更：将抖音视频根、原生画面弹幕、侧聊根、侧聊消息、消息正文、用户名、输入框、文本编辑器、发送按钮和表情面板选择器统一迁入 `dom-config.ts`；将容错且去重的 `queryAll`、`matchesAny`、`closestAny` 与扩展自有节点判断迁入 `dom-query.ts`，入口改为只消费配置和查询 API。
- 新增或移动的文件：新增 `src/platforms/douyin/content/dom-config.ts`、`dom-query.ts` 和 `dom-query.spec.ts`；扩充 `tests/fixtures/live-dom/douyin.html`，加入脱敏原生画面弹幕、输入框和发送按钮样本。
- 保持不变的行为：选择器内容、选择器优先级、无效选择器容错、结果去重和 `closestAny` 的父元素遍历方式保持原样；没有改变候选解析、悬停选择、表情发送、本人消息识别或雷达规则。
- 测试：新增 fixture 查询覆盖，验证视频区、侧聊、正文、发送者、输入框、发送按钮均可发现，无效选择器不会中断查询，重复匹配会去重，扩展自有渲染节点不会被当成平台弹幕或侧聊消息；新增源码门禁，阻止大型 selector 表和查询实现回流入口；完整 `npm run check` 通过（66 个 Vitest 文件、302 项单元测试、135 项回归测试），类型检查、Lint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤没有交互或算法变化，未连接真实直播间；抖音普通页面和网页全屏完整手工回归保留到阶段 DC/F 门禁。
- 遗留问题：`douyin-content.ts` 仍直接处理页面桥接消息和请求超时；下一项 DC-03 将只提取页面桥接客户端。

### 2026-09-02 — DC-01

- 状态：完成
- 变更：新增抖音隔离世界统一运行时状态模型，定义 `DouyinContentRuntimeState`、`DouyinDomCandidate` 和 `DouyinSelection`，并将入口内散落的表情目录与请求、发送者缓存、本人消息意图、手动输入快照、回复请求、可信渲染器动作、指针采样、雷达屏蔽缓存、调试状态以及全部计时器/RAF 收拢到工厂创建的状态；同时移除入口中从未读取的旧预览和操作栏状态字段。
- 新增或移动的文件：新增 `src/platforms/douyin/content/runtime-state.ts` 及 `runtime-state.spec.ts`；`douyin-overlay.ts` 导出明确的 overlay handle 类型；`global.d.ts` 增加抖音 content 诊断全局类型；`douyin-content.ts` 改为从统一工厂取得状态。
- 保持不变的行为：抖音候选识别、悬停与选择、表情恢复、发送、本人消息框选、重复弹幕提醒和页面桥接逻辑均未改变；入口暂时继续保留 `@ts-nocheck`，本步骤只建立状态边界和类型所有权。
- 状态所有权：状态工厂负责创建服务和初始容器；现有 DOM、协议与操作逻辑仅更新对应字段；页面生命周期负责销毁时清理计时器、观察器、请求和缓存，统一生命周期控制器将在 DC-13 进一步提取。
- 测试：新增状态实例隔离、默认值、计时器初始化及候选/选择判别联合类型测试；完整 `npm run check` 通过（65 个 Vitest 文件、299 项单元测试、135 项回归测试），类型检查、Lint、全部构建和 Manifest/架构/CI/发布配置校验均通过。
- 手工验证：本步骤没有 UI 或业务行为变更，未连接真实直播间；抖音普通页面和网页全屏的完整手工回归保留到阶段 DC/F 门禁。
- 遗留问题：`douyin-content.ts` 仍保留 `@ts-nocheck` 和内联选择器/DOM 查询；下一项 DC-02 将只提取选择器与 DOM 查询，最终在 DC-14 删除类型检查逃逸。

### 2026-09-02 — C-20

- 状态：完成
- 变更：将三平台共享内容脚本拆为最小 `content.ts` 启动入口和严格类型化的 `content-app.ts` 组合模块；入口只导入并启动 `startLiveContentApp()`，平台识别、控制器依赖装配和生命周期注册集中在组合模块，页面退出销毁继续由 `LiveContentRuntime` 负责；删除原入口的 `@ts-nocheck`，并为 DOM 节点、富表情、悬停坐标、编辑器、动画快照、MutationObserver、Chrome 消息回调和发送保护补齐精确类型。
- 新增或移动的文件：新增 `src/entries/content-app.ts` 承载已拆分模块的运行时装配；`src/entries/content.ts` 缩减为无业务算法的启动入口；`live-content-runtime.ts` 明确收藏运行时在缺少扩展存储或 UI 所有权时可以为空。
- 保持不变的行为：Bilibili、虎牙、斗鱼仍使用原候选、悬停、胶囊、富表情、发送者关联、发送保护和重复弹幕提醒控制器；没有改变动画参数、表情发送策略、雷达阈值或平台选择器。深层 DOM 根缓存改为在刷新后回写时间戳，避免组合层重复执行已缓存的根发现。
- 测试：新增入口 composition-root 与禁用 TypeScript 逃逸的源码门禁，并将共享直播源码回归指向 `content-app.ts`；完整 `npm run check` 通过（64 个 Vitest 文件、297 项单元测试、135 项回归测试），构建产物与 Manifest 校验通过。
- 手工验证：本步骤未连接真实直播间；Bilibili、虎牙、斗鱼普通页面和网页全屏的最终手工回归保留到阶段 C/F 门禁，自动 DOM fixture、悬停、胶囊、发送和生命周期回归均已通过。
- 遗留问题：共享直播入口的代码拆分与严格类型化已完成；下一项从 DC-01 开始拆分和类型化抖音隔离世界入口。

### 2026-09-02 — C-19

- 状态：完成
- 变更：新增类型化 `LiveContentRuntime`，统一创建收藏与重复弹幕提醒运行时，启动发送者观察器和悬停控制器，并集中注册/移除 click、pointerdown、keydown、fullscreen、visibility、pagehide、scroll、resize、Chrome runtime message 与 storage change 监听；入口仅注入设置应用、诊断响应、平台清理和 UI 回调。
- 新增或移动的文件：`src/platforms/live/live-content-runtime.ts`、`src/platforms/live/__tests__/live-content-runtime.spec.ts`；`runtime-state.ts` 补充由生命周期管理的收藏运行时类型。
- 保持不变的行为：页面隐藏时仍只释放选择、计时器、发送者索引和平台瞬态状态，恢复显示后重新启动发送观察；全屏仍刷新平台根节点和胶囊宿主；同步设置变化仍重新读取并应用现有设置。
- 生命周期保证：重复 `start()` 不会重复安装资源或监听，重复 `destroy()` 不会重复清理；`pagehide` 对称销毁所有 UI、观察器和 Chrome 监听；`popstate`、`hashchange` 及直播 DOM 变化会检查房间 key，切房时销毁并重建收藏/提醒的房间级资源，清空旧房间瞬态 UI。
- 测试：新增启动幂等、隐藏/恢复、同步设置过滤、切房重建和销毁幂等测试；新增入口生命周期边界源码回归；完整 `npm run check` 通过（64 个 Vitest 文件、297 项单元测试、134 项回归测试）。
- 手工验证：四平台页面隐藏/恢复、网页全屏和站内切房留到阶段 C 门禁。
- 遗留问题：`content.ts` 仍保留组合所需的平台回调和 `@ts-nocheck`，将在 C-20 瘦身入口并完成严格类型化。

### 2026-09-02 — C-17

- 状态：完成
- 变更：建立统一 `LivePlatformSender` 接口和共享 `LiveTextSender`，将官方输入框写入、发送按钮/回车重试、输入消费确认及限流反馈协调从入口迁出；斗鱼 `pe` 原生表情面板匹配、表情包切换、点击后确认和插入后补发迁入 `DouyuSender`，虎牙 token 补全、图片表情名称发送迁入 `HuyaSender`；Bilibili sender 同步接入统一接口。
- 新增或移动的文件：`src/platforms/live/platform-sender.ts`、`src/platforms/live/text-sender.ts`、`src/platforms/douyu/sender.ts`、`src/platforms/huya/sender.ts`，以及对应的 `text-sender.spec.ts`、斗鱼和虎牙 sender 测试。
- 保持不变的行为：三平台继续使用官方输入框与官方发送动作；斗鱼专属图片表情仍通过原生选择器触发 `pe=3` 路径，普通/混合表情按平台可识别文本发送；虎牙继续在发送前补全图片表情 token；重复、并发、误触和平台限流反馈仍由统一协调器处理。
- 测试：新增官方编辑器文字发送、平台限流、虎牙 token 补全/无名称拒绝、斗鱼普通与专属表情、无权限和限流测试；相关源码结构回归 38 项通过；完整 `npm run check` 通过（63 个 Vitest 文件、292 项单元测试、133 项回归测试）。
- 手工验证：真实直播间的斗鱼专属表情权限、虎牙图片表情和三平台官方限流提示留到阶段 C 门禁。
- 遗留问题：设置、诊断和各控制器的统一启动/销毁生命周期将在 C-19 收口；旧的纯富表情分类辅助模块暂保留，避免在本步骤扩大行为变更范围。

### 2026-09-02 — C-16

- 状态：完成
- 变更：Bilibili 文字/富表情分流、唯一面板匹配、表情包切换、房间表情直发后备、原生 `/msg/send` 结果观察、首次发送诊断和收藏重发决策统一迁入类型化 `BilibiliSender`；入口只注入编辑器、DOM 查询和通用发送协调能力。
- 新增或移动的文件：`src/platforms/bilibili/sender.ts`、`src/platforms/bilibili/__tests__/sender.spec.ts`；`emoticon-debug.ts` 补充公开诊断类型。
- 保持不变的行为：普通 `[大笑]` 继续走官方文字识别；`official_*`/`room_*` 继续要求唯一原生身份；面板失败后仍按当前房间校验执行直发后备，成功必须由弹幕回显或平台响应确认。
- 测试：新增收藏 payload、混合图文重建、`official_*`/`room_*` 路由、面板唯一/歧义和重复 DOM 身份测试；既有错误房间、首次认证、直发请求与富表情分流测试保留；完整 `npm run check` 通过（60 个 Vitest 文件、284 项单元测试、133 项回归测试）。
- 手工验证：真实直播间首次房间表情、全屏面板与平台限流反馈留到阶段 C 门禁。
- 遗留问题：斗鱼与虎牙仍暂用入口内面板发送流程，按 C-17 继续迁移。

### 2026-09-02 — C-12

- 状态：完成
- 变更：pointer over/move/out、重叠候选抑制、雷达命中守卫、延迟隐藏和 RAF 合帧迁入 `HoverSelectionController`；入口只注入候选查找、选择提交和平台运动边界。
- 新增或移动的文件：`src/platforms/live/hover-selection-controller.ts`、`src/platforms/live/__tests__/hover-selection-controller.spec.ts`。
- 保持不变的行为：斗鱼原生 hover/运动控制仍由斗鱼边界拥有，Bilibili/虎牙冻结策略和候选排序未改变；每次只提交一条当前选择。
- 测试：正文到间隙/胶囊、雷达遮挡、重叠弹幕、快速 pointermove 合帧及 start/destroy 幂等测试通过；斗鱼/Bilibili 运动专项测试与 131 项回归测试通过。
- 手工验证：四平台真实页面与网页全屏留到阶段 C 门禁。
- 遗留问题：portal、胶囊、hover bridge 的布局和 DOM 所有权将在 C-13 迁移。

### 2026-09-02 — C-13

- 状态：完成
- 变更：Vue portal、action bar 引用、左右侧定位、可视 viewport 限制、透明 hover bridge、全屏宿主迁移和定位 RAF 由 `CapsuleController` 统一拥有；入口只提供当前 `LiveSelection` 锚点和操作回调。
- 新增或移动的文件：`src/platforms/live/capsule-controller.ts`、`src/platforms/live/__tests__/capsule-controller.spec.ts`；`content-overlay.ts` 导出既有回调类型供控制器复用。
- 保持不变的行为：胶囊保留 8px 间隔，弹幕未完整进入或右侧空间不足时位于左侧，空间足够时位于右侧；缩放仍作用于尺寸变量而非定位坐标系。
- 测试：左右侧切换、缩放后锚点稳定、间隔桥命中和普通/全屏 portal 宿主切换测试通过；131 项回归测试通过。
- 手工验证：四平台真实页面的缩放和网页全屏位置留到阶段 C 门禁。
- 遗留问题：设置/全屏/销毁监听的总生命周期将在 C-19 收口。

### 2026-09-02 — C-18

- 状态：完成
- 变更：candidate 到重复弹幕提醒描述的转换、Bilibili 福袋/抽奖排除、房间级短期抑制和清理迁入独立采集适配器；入口仅组装提醒运行时。
- 新增或移动的文件：`src/platforms/live/repeat-reminder-adapter.ts`、`src/platforms/live/__tests__/repeat-reminder-adapter.spec.ts`。
- 保持不变的行为：聊天/画面双源去重、真实重复累加、当前房间 key、队列阈值和 UI 行为继续由既有提醒运行时负责。
- 测试：Bilibili 大字号口令排除、同场抑制和非 Bilibili 正常透传测试通过；既有福袋过滤测试保留。
- 手工验证：四平台真实流量与房间切换留到阶段 C 门禁。
- 遗留问题：运行时生命周期统一将在 C-19 完成。

### 2026-09-02 — C-15

- 状态：完成
- 变更：新增结构化 `SendResult`、`SendMethod`、`SendFailureReason`，并由 `SendCoordinator` 统一冷却/重复/并发保护、页面反馈探测、原生网络观察、平台反馈冷却和未确认请求提示。
- 新增或移动的文件：`src/platforms/live/send-coordinator.ts`、`src/platforms/live/__tests__/send-coordinator.spec.ts`。
- 保持不变的行为：800ms 误触保护、同文冷却、平台限流识别及只向 UI 暴露清洗后网络摘要的规则保持不变。
- 测试：并发、重复、频率限制、结构化反馈、成功和网络未确认测试通过；既有发送保护测试全部保留。
- 手工验证：各平台官方发送反馈联调留到 C-16/C-17 与阶段门禁。
- 遗留问题：平台表情面板和直发策略将在 C-16/C-17 从入口迁出。

### 2026-09-02 — C-14

- 状态：完成
- 变更：编辑器候选评分、普通/全屏选择、Bilibili 官方表情编辑器、input/textarea/contenteditable 写入、选区光标恢复和回复草稿准备迁入 `EditorController`。
- 新增或移动的文件：`src/platforms/live/editor-controller.ts`、`src/platforms/live/__tests__/editor-controller.spec.ts`。
- 保持不变的行为：回复仅填入 `@发送者` 并聚焦编辑器，绝不自动发送；Bilibili 全屏仍优先快捷输入栏。
- 测试：textarea 选区插入、contenteditable、全屏输入面选择、发送者缺失和编辑器缺失测试通过。
- 手工验证：四平台普通页面/全屏回复留到阶段 C 门禁。
- 遗留问题：发送时的输入框消费和官方按钮协调将在 C-15 至 C-17 收口。

### 2026-09-02 — C-11

- 状态：完成
- 变更：`SenderIndex` 接管发送者缓存、消息 ID/文本相关性、节流扫描、虚拟列表移除捕获、节点复用签名、观察器和定时器销毁；入口仅将平台提取结果组成候选并调用 `resolve(candidate)`。
- 新增或移动的文件：扩展 `src/platforms/live/sender-index.ts` 与 `src/platforms/live/__tests__/sender-index.spec.ts`。
- 保持不变的行为：相同文本不同用户按消息 ID/时间选择，聊天区直接发送者优先，画面弹幕仍可反查侧聊发送者。
- 测试：消息 ID、超时、节点复用、移除节点、节流扫描和幂等销毁测试通过。
- 手工验证：四平台回复联调留到阶段 C 门禁。
- 遗留问题：编辑器与回复动作将在 C-14 迁移。

### 2026-09-02 — C-10

- 状态：完成
- 变更：斗鱼 `img[rel]`/原生表情面板名称、虎牙原生面板 token/资源 ID 和聊天区可信名称恢复迁入各自平台模块。
- 新增或移动的文件：`src/platforms/douyu/rich-emoji.ts`、`src/platforms/douyu/__tests__/rich-emoji.spec.ts`、`src/platforms/huya/rich-emoji.ts`、`src/platforms/huya/__tests__/rich-emoji.spec.ts`。
- 保持不变的行为：发送仍走官方输入框/平台 sender，缺少可信名称时仍保持原失败提示而不误发资源 URL。
- 测试：普通表情、斗鱼粉丝专属表情、虎牙面板 token、资源缺失和强 token 保留测试通过。
- 手工验证：真实专属表情发送留到 C-17 与阶段门禁。
- 遗留问题：斗鱼/虎牙发送策略将在 C-17 收口。

### 2026-09-02 — C-09

- 状态：完成
- 变更：Bilibili 官方/房间表情显示名、`official_*`/`room_*` 发送身份、聊天区可信名称反查缓存和装饰图隔离迁入 Bilibili 富表情模块。
- 新增或移动的文件：`src/platforms/bilibili/rich-emoji.ts`、`src/platforms/bilibili/__tests__/rich-emoji.spec.ts`。
- 保持不变的行为：发送身份与显示名继续分离，收藏和 +1 共用同一补全结果。
- 测试：官方表情显示名、荣耀等级勋章隔离、广告行排除和补全缓存测试通过。
- 手工验证：真实房间表情首次发送留到 C-16 与阶段门禁。
- 遗留问题：Bilibili 发送策略将在 C-16 收口。

### 2026-09-02 — C-07

- 状态：完成
- 变更：虎牙聊天、画面、正文和发送者候选选择器迁入虎牙目录，并继续通过统一候选适配器公开。
- 新增或移动的文件：`src/platforms/huya/candidate-config.ts`、`src/platforms/huya/__tests__/candidate-config.spec.ts`。
- 保持不变的行为：输入框和发送按钮配置不变，普通页面与全屏使用同一候选契约。
- 测试：文字、图片表情和画面弹幕描述测试通过。
- 手工验证：真实网页全屏留到阶段 C 门禁。
- 遗留问题：虎牙表情 token 补全和 sender 迁移分别在 C-10/C-17 完成。

### 2026-09-02 — C-06

- 状态：完成
- 变更：斗鱼正文片段、原生胶囊目标/选择器、原生悬停和运动兜底聚合到斗鱼适配器边界，通用入口不再直接导入这些模块。
- 新增或移动的文件：无；扩展 `src/platforms/douyu/adapter.ts`。
- 保持不变的行为：复用原控制器实例与选择器，不增加 style/class/animation 属性观察。
- 测试：斗鱼原生胶囊、悬停、运动兜底、正文片段及统一适配器测试通过。
- 手工验证：真实悬停无抽搐回归留到阶段 C 门禁。
- 遗留问题：斗鱼富表情发送将在 C-10/C-17 收口。

### 2026-09-02 — C-08

- 状态：完成
- 变更：新增平台无关富文本模型、DOM 顺序解析器和稳定资源键算法；通用入口不再导入抖音 `rich-data`。
- 新增或移动的文件：`src/platforms/live/rich-message.ts`、`src/platforms/live/__tests__/rich-message.spec.ts`。
- 保持不变的行为：平台专属表情命名和发送 token 尚由原逻辑负责，正文顺序及最多 8 个资源限制不变。
- 测试：文字、单图、多图、图文混排、Unicode Emoji 和签名/转码资源匹配测试通过。
- 手工验证：无视觉变化。
- 遗留问题：平台专属名称补全将在 C-09/C-10 迁移。

### 2026-09-02 — C-05

- 状态：完成
- 变更：Bilibili 快捷输入、聊天操作、广告结构和播放器区域判断迁入独立候选规则模块。
- 新增或移动的文件：`src/platforms/bilibili/candidate-rules.ts`、`src/platforms/bilibili/__tests__/candidate-rules.spec.ts`。
- 保持不变的行为：聊天区、画面弹幕、多 iframe 查询和福袋过滤策略不变。
- 测试：正常聊天/画面候选、广告卡、快捷输入和操作面专项测试通过；既有福袋过滤测试保留。
- 手工验证：真实多 iframe 回归留到阶段 C 门禁。
- 遗留问题：Bilibili 富表情和发送路径仍待 C-09/C-16 迁移。

### 2026-09-02 — C-04

- 状态：完成
- 变更：定义候选种类、描述、显式能力和稳定重叠排序输入；三个平台适配器均公开 chat/overlay/native-capsule 能力。
- 新增或移动的文件：`src/platforms/live/candidate-adapter.ts`。
- 保持不变的行为：旧 `findCandidate/describe` 接口保留兼容，新增接口逐步接管。
- 测试：三平台适配器契约和 z-index/DOM 顺序/指针距离排序测试通过。
- 手工验证：无视觉变化。
- 遗留问题：斗鱼和虎牙专属候选规则将在 C-06/C-07 收口。

### 2026-09-02 — C-03

- 状态：完成
- 变更：提取元素标志、可见性和纯 DOM 文本序列化，显式忽略按钮、装饰和扩展自有节点。
- 新增或移动的文件：`src/platforms/live/element-text.ts`。
- 保持不变的行为：保留数字、Unicode Emoji、图片 token 和原有最大长度限制。
- 测试：四平台 fixture 均验证正文不混入 `+1/回复/收藏`。
- 手工验证：无视觉变化。
- 遗留问题：平台表情可信名称由后续平台模块补齐。

### 2026-09-02 — C-02

- 状态：完成
- 变更：提取带缓存的深层根发现、普通/Shadow DOM 查询、路径命中和 composed-tree 上溯工具。
- 新增或移动的文件：`src/platforms/live/deep-dom.ts`、`src/platforms/live/__tests__/deep-dom.spec.ts`。
- 保持不变的行为：根缓存 3 秒、最多 40 个根节点和无效选择器容错保持不变。
- 测试：普通 DOM、开放 Shadow DOM、重复根和无效选择器测试通过。
- 手工验证：无视觉变化。
- 遗留问题：封闭 Shadow DOM 仍只能依靠平台公开节点。

### 2026-09-02 — C-01

- 状态：完成
- 变更：定义 `LiveContentRuntimeState`、`LiveSelection`、计时器/观察器/UI/动画快照所有权类型，并补充全局加载标志声明。
- 新增或移动的文件：`src/platforms/live/runtime-state.ts`、`src/global.d.ts`。
- 保持不变的行为：入口暂时保留 `@ts-nocheck`，运行时状态初始值和更新路径不变。
- 测试：新增类型模块通过 `vue-tsc` 严格检查。
- 手工验证：不适用。
- 遗留问题：入口 `@ts-nocheck` 在 C-20 删除。

### 2026-09-01 — P-05

- 状态：完成
- 变更：bootstrap 删除本地宽泛 `PageReadyMessage` 和重复守卫，复用公共 `ready` 守卫与 `ping` 工厂。
- 新增或移动的文件：无。
- 保持不变的行为：注入重试时间、请求编号、SPA 路由检测和可见性恢复逻辑不变。
- 测试：bootstrap 回归测试通过；完整 `npm run check` 通过。
- 手工验证：未改变页面注入时序，真实 SPA 进房验证保留到阶段 F。
- 遗留问题：bootstrap 的路由生命周期将在后续入口收口阶段统一核对销毁契约。

### 2026-09-01 — P-04

- 状态：完成
- 变更：新增两个方向的穷尽式 `switch` 分发器和完整 handler map；两个大型入口不再散落 `event.data.type` 判断，非法同源消息只累计诊断计数。
- 新增或移动的文件：无。
- 保持不变的行为：各消息处理函数、异步调用方式和回执逻辑保持原样。
- 测试：协议分发器测试覆盖全部 17 个 case；类型检查和完整 `npm run check` 通过。
- 手工验证：未改变 DOM 或 Canvas 行为。
- 遗留问题：两个大型入口本身仍带 `@ts-nocheck`，将在 DC/DP 阶段拆分后移除。

### 2026-09-01 — P-03

- 状态：完成
- 变更：精确定义 8 种 MAIN→isolated 消息，对 request ID、操作载荷、数组长度、文本长度、计数和来源执行运行时校验。
- 新增或移动的文件：`src/platforms/douyin/__tests__/protocol.spec.ts`。
- 保持不变的行为：ready、渲染操作、本人消息确认、雷达采集和诊断快照的业务处理不变。
- 测试：每种消息均有合法与缺失字段拒绝用例，并覆盖来源伪造、错误 ID、未知 type 和越界数组。
- 手工验证：未改变页面视觉行为。
- 遗留问题：富内容内部对象暂按有界记录处理，精确内容部件类型将在 DP-05 中收紧。

### 2026-09-01 — P-02

- 状态：完成
- 变更：精确定义 9 种 isolated→MAIN 消息，将所有发送点切换到公共协议工厂，并在 MAIN world 业务处理前完成校验。
- 新增或移动的文件：`src/platforms/douyin/__tests__/protocol.spec.ts`。
- 保持不变的行为：设置同步、表情目录、本人消息、+1/收藏结果和诊断请求语义不变。
- 测试：每种消息均有合法与缺失字段拒绝用例；完整 `npm run check` 通过。
- 手工验证：未改变直播页交互。
- 遗留问题：发送端函数仍位于大型入口，将在 DC/DP 协议桥步骤移动到独立模块。

### 2026-09-01 — P-01

- 状态：完成
- 变更：以方向联合类型替换通配协议接口，统一非负安全整数 request ID，新增协议 v1，并将缺少版本字段的现有消息按 legacy v0 兼容。
- 新增或移动的文件：无。
- 保持不变的行为：旧页面 Hook 与新 isolated 脚本短暂交错加载时仍可通信。
- 测试：覆盖合法消息、错误 source、未知 type、缺失字段和不支持版本；完整 `npm run check` 通过（46 个 Vitest 文件、232 项测试、131 项回归测试）。
- 手工验证：协议层无可见界面变化。
- 遗留问题：只接受 legacy 缺省版本和当前 v1；未来升级需显式扩展兼容集合。

### 2026-09-01 — R-03

- 状态：完成
- 变更：新增四个平台的脱敏最小 DOM fixture，并增加统一加载契约测试；抖音样本额外覆盖礼物、福袋和本人消息。
- 新增或移动的文件：`tests/fixtures/live-dom/*.html`、`src/platforms/live/__tests__/dom-fixtures.spec.ts`。
- 保持不变的行为：未修改任何内容脚本、选择器、发送或渲染逻辑。
- 测试：fixture 专项测试 5 项通过；完整 `npm run check` 通过（45 个 Vitest 文件、211 项测试、131 项回归测试）。
- 手工验证：本步骤只建立脱敏 fixture，不涉及真实页面行为变更。
- 遗留问题：真实平台哈希类名和浏览器动画时间线仍需阶段结束后的手工直播间回归。

### 2026-09-01 — R-02

- 状态：完成
- 变更：将候选、悬停、胶囊、发送、回复、收藏、表情、雷达、本人弹幕、Canvas 接管和构建权限映射到现有自动测试，并建立四平台固定手工回归矩阵和自动化缺口清单。
- 新增或移动的文件：`docs/ENTRY_RUNTIME_ARCHITECTURE.md`。
- 保持不变的行为：浏览器 E2E 继续仅作为本地可选测试，不加入 CI。
- 测试：完整 `npm run check` 通过。
- 手工验证：已定义固定回归项；没有运行真实直播间，因为本步骤未修改运行代码。
- 遗留问题：Bilibili 多 iframe、斗鱼真实动画时间线和抖音 Worker/OffscreenCanvas 长期性能需要真实浏览器验证。

### 2026-09-01 — R-01

- 状态：完成
- 变更：记录四个内容入口和 Service Worker 的加载范围、运行 world、输入、输出、销毁条件，以及抖音静态/SPA 注入链路和双向消息基线。
- 新增或移动的文件：`docs/ENTRY_RUNTIME_ARCHITECTURE.md`。
- 保持不变的行为：仅新增架构说明，未修改运行代码。
- 测试：对照 `public/manifest.json`、`service-worker.ts`、`douyin-bootstrap.ts`、`douyin-content.ts` 和 `douyin-page-hook.ts` 完成静态核对。
- 手工验证：不适用。
- 遗留问题：消息 payload 仍为宽泛结构，将在 P-01 至 P-04 中收紧。

模板：

```text
### YYYY-MM-DD — C-03

- 状态：完成 / 阻塞
- 变更：
- 新增或移动的文件：
- 保持不变的行为：
- 测试：
- 手工验证：
- 遗留问题：
```

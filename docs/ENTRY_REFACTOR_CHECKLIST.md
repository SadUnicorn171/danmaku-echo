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

### [ ] R-01 记录入口职责和跨入口通信

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

### [ ] R-02 建立重构前行为测试清单

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

### [ ] R-03 补充关键 DOM fixture

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

### [ ] P-01 定义协议公共基础类型

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

### [ ] P-02 类型化 content → page 消息

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

### [ ] P-03 类型化 page → content 消息

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

### [ ] P-04 建立穷尽式协议分发器

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

### [ ] P-05 让 bootstrap 复用 ready/ping 协议

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

### [ ] C-01 定义通用运行时状态类型

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

### [ ] C-02 提取深层 DOM 查询工具

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

### [ ] C-03 提取通用文本与元素序列化

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

### [ ] C-04 建立候选弹幕接口

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

### [ ] C-05 迁移 Bilibili 候选规则

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

### [ ] C-06 迁移斗鱼候选和原生胶囊边界

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

### [ ] C-07 迁移虎牙候选规则

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

### [ ] C-08 提取富文本公共模型和 DOM 解析器

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

### [ ] C-09 迁移 Bilibili 富表情补全

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

### [ ] C-10 迁移斗鱼和虎牙富表情补全

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

### [ ] C-11 提取发送者关联服务

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

### [ ] C-12 提取悬停选择控制器

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

### [ ] C-13 提取胶囊与悬停桥控制器

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

### [ ] C-14 提取编辑器与回复控制器

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

### [ ] C-15 提取通用发送协调器

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

### [ ] C-16 迁移 Bilibili 发送策略

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

### [ ] C-17 迁移斗鱼与虎牙发送策略

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

### [ ] C-18 提取雷达采集适配

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

### [ ] C-19 提取设置、诊断和生命周期

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

### [ ] C-20 瘦身入口并删除 `@ts-nocheck`

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

### [ ] DC-01 定义隔离世界运行时状态

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

### [ ] DC-02 提取抖音选择器和 DOM 查询

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

### [ ] DC-03 提取页面桥接客户端

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

### [ ] DC-04 提取侧边聊天解析器

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

### [ ] DC-05 提取抖音富文本恢复器

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

### [ ] DC-06 提取发送者索引

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

### [ ] DC-07 提取 DOM 悬停和胶囊控制器

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

### [ ] DC-08 提取操作分发控制器

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

### [ ] DC-09 提取编辑器控制器

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

### [ ] DC-10 提取抖音发送控制器

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

### [ ] DC-11 提取本人消息控制器

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

### [ ] DC-12 提取雷达采集器

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

### [ ] DC-13 提取设置、诊断和 SPA 生命周期

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

### [ ] DC-14 瘦身入口并删除 `@ts-nocheck`

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

### [ ] DP-01 定义页面运行时核心类型

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

### [ ] DP-02 提取 MAIN world 协议桥

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

### [ ] DP-03 提取 Canvas 识别与接管 Hook

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

### [ ] DP-04 提取 Worker/MessagePort 消息观察

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

### [ ] DP-05 提取弹幕内容解析器

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

### [ ] DP-06 提取内容测量器

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

### [ ] DP-07 提取 Renderer 实例注册表

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

### [ ] DP-08 提取纯轨道运动模型

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

### [ ] DP-09 提取频道调度器

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

### [ ] DP-10 提取 DOM Renderer

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

### [ ] DP-11 提取页面胶囊与单条悬停控制

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

### [ ] DP-12 提取页面本人弹幕匹配器

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

### [ ] DP-13 提取页面诊断控制器

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

### [ ] DP-14 建立 MAIN world 生命周期

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

### [ ] DP-15 瘦身入口并删除 `@ts-nocheck`

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

### [ ] F-01 增加模块依赖边界检查

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

### [ ] F-02 统一入口测试分类

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

### [ ] F-03 扩大真实覆盖率范围

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

### [ ] F-04 清理迁移遗留代码

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

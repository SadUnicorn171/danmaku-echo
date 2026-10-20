# 收藏页面与轮盘统一设计

设计先通过 Pencil MCP 构建，再映射到 Vue 与 SCSS。设计沿用设置页和雷达的回声橙，不改变收藏存储、富内容或平台发送流程。

## Pencil 稿件

当前 Pencil 工作文档：`/home/sadunicorn/.pencil/documents/9b8aa74e-5c95-47a9-9735-7f534ff6bacc/untitled.pen`。
该文件由 Pencil 管理；以下导出文件用于审阅，不替代可编辑文档。

| 画板 | 节点 | 导出 |
| --- | --- | --- |
| 桌面收藏列表 | `e47RQ` | [桌面列表](e47RQ.png) |
| 窄屏收藏列表 | `W4WIt` | [窄屏列表](W4WIt.png) |
| 轮盘默认与选中 | `P4xsc1` | [快捷轮盘](P4xsc1.png) |
| 发送收缩与结果动效 | `h8l8Wk` | [立即收缩与成功／失败反馈](h8l8Wk.png) |
| 收藏说明与提示词 | `xe32x` | [收藏说明](xe32x.png) |

## 当前发送反馈（2026-10-20）

松开发送即收缩扇区，240ms 后仅保留 bot 等待真实结果；结果返回时成功显示绿色勾，失败显示红色叉，两者均停留 900ms 后关闭。发送起不再展示上下文字框，状态文案仅供辅助技术读取。收缩动画从发送中到结果态连续运行，不在结果返回时重播。Pencil 的 `h8l8Wk` 和 `xe32x` 已同步；下方较早的验证段落保留历史行为。

## 设计提示词

统一收藏说明页、直播间收藏列表、房间详情和快捷轮盘。保留回声橙 `#FD8101`，以白色主表面、暖白 `#F7F5F2`、浅橙 `#FFF0E0`、墨色 `#241A14`、次要文字 `#75695F` 和细分隔线 `#EEE7E1` 形成同一视觉语言。使用连续分组列表、清晰字阶、18px 面板圆角与胶囊操作，不给每条收藏叠加阴影卡片。

收藏标题使用书签图标，面板标题 24px、680px 以下 21px，收藏正文 15px。收藏列表保留本房、其他直播间、全部三个范围，以及搜索、发送次数和时间排序、轮盘顺序、拖动与上移/下移、标签、置顶、移除确认、加入本房、加载更多与键盘快捷键。正文与操作分行，发送靠右；长正文展示两行，列表内部滚动，底部快捷键栏保持可达。主题色发送按钮与选中轮盘项均使用深色文字。

轮盘取消白色底盘与全屏遮罩，使用外径 360px、内径 108px 的饼状扇区和 76px bot 中心。扇区为 `#241A14CC` 半透明墨色、白字，扇区之间留 3° 透明缝隙；标签保持水平。显示本房轮盘顺序的前六条收藏及两个导航项；选中使用主题色底、墨色文字。复用现有机器人双眼，不生成替代插画。顶部快捷键提示与下方松开／取消提示始终可见；选中内容为只读两行省略预览，不增加可滚动说明区，不截断收藏数据、选项标题或辅助名称。

轮盘与上下提示作为整体，按实际可见的 `document.documentElement.clientWidth/clientHeight` 缩放；无有效值时才回退到 `innerWidth/innerHeight`。基础整体占用按 360×526px 预留，外留 12px 边距，指针位移除以相同缩放系数后再命中，中心取消区同步缩放。窗口 resize 取消正在进行的手势，随后松开快捷键不得发送。

设置页以一张白色说明面呈现收藏价值、列表和轮盘两种可切换示意、三个真实操作步骤及本地存储说明，保留数据管理工具。两种预览均明确标注“示意 / Example”，中英文同时覆盖，不伪造用户统计，不触发发送。所有动效遵循 `prefers-reduced-motion`；减少动态效果时停止入场、眨眼、表情过渡和按压/选中缩放，直接显示状态。

收藏主动作继承 `--bcp-action-start` / `--bcp-action-end`，默认回声橙；当前范围使用浅橙和 `#853F00` 深色文字。实际收藏面板的说明文字为 `#6F6259`，元数据为 `#75695F`。这些颜色限定于收藏与收藏说明，不覆盖平台弹幕胶囊配色。

## 实现对应

- `src/features/favorites/FavoritesLauncher.vue`：收藏面板、房间列表/详情、轮盘和选中说明。
- `src/features/favorites/FavoriteItemRow.vue`：条目操作与标签编辑，保持原有数据事件。
- `src/features/favorites/launcher.ts`：轮盘缩放、对应命中区域及调整窗口时的取消。
- `src/assets/styles/favorites.scss`：统一色彩、字阶、间距、响应式与减少动态效果。
- `src/components/FavoritesGuidePreview.vue`、`src/App.vue`：双模式收藏说明。

Pencil 窄屏稿仅示意两条可见收藏；实际列表内部滚动以访问所有条目，完整收藏数据不截断。轮盘长文案只读两行省略，操作说明保持可见，不参与滚动。画板里的机器人图标是占位说明，代码复用已有双眼及指针跟随表情。`xe32x` 已同步滚动条边界与长文案约定。

2026-10-20 通过 Pencil MCP 更新 `P4xsc1`、`xe32x`，新增 `h8l8Wk` 发送动效画板并导出。当前提示词：松开发送即在 240ms 内收缩扇区并保留 bot 等待；真实成功为绿色勾、失败为红色叉，900ms 后关闭。发送起不显示上下文字框，减少动态效果时直接切换。代码沿用平台 sender 的成功判定，不新增网络协议。

本轮扩展现有 [设计规范](../../DESIGN_SYSTEM.md)，没有创建新的品牌规则、根目录 `DESIGN.md` 或 `.impeccable` 配置；仓库未发现 `PRODUCT.md`。

## 饼状轮盘验证（2026-10-20）

- `npm run check` 退出码 0：114 个测试文件、669 个单测、137 个 contracts 通过，含类型检查、lint、全部构建入口和构建约束。[完整日志](../../../test-results/favorites-pie-2026-10-20/check.log)。
- 新增运行时测试覆盖：等待真实成功、重复触发保护、返回失败与异常、取消后打开列表、切房前后结果、销毁清理。绿勾不依赖收藏计数持久化的完成时间。
- Chrome / Edge `favorites-design` 最终均 attempt 1 通过：[Chrome](../../../test-results/favorites-pie-2026-10-20/chrome-confirmed/summary.json)、[Edge](../../../test-results/favorites-pie-2026-10-20/edge-confirmed/summary.json)。检查透明遮罩、8 个饼状扇区、各尺寸全部方向命中、取消、真实 fixture sender 成功后的扇区收缩与 bot 替换、减少动态效果和自动关闭。`feedback` 的四项与 `reducedFeedback` 均为 true。
- Chrome 的 [中文设置](../../../test-results/favorites-pie-2026-10-20/settings-zh/summary.json)、[英文设置](../../../test-results/favorites-pie-2026-10-20/settings-en/summary.json)、[Bilibili](../../../test-results/favorites-pie-2026-10-20/bilibili-side/summary.json)、[Douyu](../../../test-results/favorites-pie-2026-10-20/douyu-side/summary.json)、[Douyin](../../../test-results/favorites-pie-2026-10-20/douyin-side/summary.json) 均 attempt 1 通过；Huya 由 `favorites-design` 使用的模拟页面覆盖。
- 已人工查看选中、320px 窄屏、英文说明与成功反馈截图。[选中轮盘](../../../test-results/favorites-pie-2026-10-20/chrome-confirmed/chrome/favorites-favorite.png)、[发送完成](../../../test-results/favorites-pie-2026-10-20/chrome-confirmed/chrome/favorites-send-success.png)。
- 首轮 Chrome / Edge 各 attempt 1、2 均在成功画面采集阶段失败：脚本假定 bot 双眼一直存在，对已被绿勾替换的元素调用 `getComputedStyle`。已修正空元素处理，原失败产物保留在 `chrome` / `edge`，以 `*-confirmed` 为最终结果。该脚本修正后另行通过 `node --check`；未为它重复完整构建。
- 所有浏览器发送均在临时 profile 的本地模拟直播页面中完成，未验证真实直播间消息送达。重新加载 `build/extension` 并刷新直播页后可使用新界面。

## 验证（2026-10-19）

本轮环境：Linux、Node 22.23.1、Chrome 155.0.8059.79、Microsoft Edge 155.0.4283.45。结果根目录为 `test-results/favorites-unified-2026-10-19/`。

| 检查 | 结果与覆盖 | 产物 |
| --- | --- | --- |
| 最终 `npm run check` | 退出码 0；类型检查、Oxlint / ESLint、全部构建入口、构建约束、覆盖率与回归链通过；113 个测试文件、662 个单测与 137 个 contracts 全部通过 | [完整日志](../../../test-results/favorites-unified-2026-10-19/validation/final-check.log) |
| 最终收藏浏览器回归 | Chrome、Edge 均 attempt 1 通过，断言失败列表为空 | [Chrome summary](../../../test-results/favorites-unified-2026-10-19/verified-chrome/summary.json)、[Edge summary](../../../test-results/favorites-unified-2026-10-19/verified-edge/summary.json) |
| 中英文收藏说明 | 两种语言均 attempt 1 通过；1280px / 390px 下列表与轮盘可切换、示例标识可见且布局可容纳 | [中文](../../../test-results/favorites-unified-2026-10-19/settings-zh/summary.json)、[英文](../../../test-results/favorites-unified-2026-10-19/settings-en/summary.json) |
| 平台现有收藏操作 | Bilibili、Douyu、Huya、Douyin 侧聊及 Huya 全屏均 attempt 1 通过 | [Bilibili](../../../test-results/favorites-unified-2026-10-19/bilibili-side/summary.json)、[Douyu](../../../test-results/favorites-unified-2026-10-19/douyu-side/summary.json)、[Huya](../../../test-results/favorites-unified-2026-10-19/huya-side/summary.json)、[Douyin](../../../test-results/favorites-unified-2026-10-19/douyin-side/summary.json)、[Huya 全屏](../../../test-results/favorites-unified-2026-10-19/huya-fullscreen/summary.json) |

最终 `verified-chrome` / `verified-edge` 覆盖列表 1000×720、390×640、320×480、640×300 四个尺寸，检查无横向溢出、页脚可见与末项可达；在后三个尺寸逐一命中全部 8 个轮盘选项，并检查中心取消、resize 取消后不发送及减少动态效果。长文案的 `retainsContent`、`truncatedPreview`、`hintVisible`、`noScrollInteraction` 均为 `true`。截图与完整结果保留在对应浏览器子目录。

中英文设置页与五个平台场景完成于审查后的几何修正之前；它们记录本轮操作与语言覆盖，最终几何、命中和长文案结论以 `verified-*` 为准。

首轮完整检查及审查修正后的类型、lint、构建和 regression 已在执行时观察到通过；旧 `/tmp` 日志现已不可用。最终源码验证以工作区保存的 `validation/final-check.log` 为准。

### 失败与修正记录

- `design` 的 attempt 1 与自动重试 attempt 2 均因轮盘状态等待超时失败。定位到 CSS 组合选择器覆盖选项定位后修正，`design-confirmed` attempt 1 通过。
- 独立 finish review 指出两项问题：滚动条占位引起轮盘裁切、长文案说明区滚动与持键选中手势冲突。修正为按可见客户区计算几何、只读两行预览与固定操作提示；复审两项均 `resolved`，`ship` 结论仅覆盖这两项修复。
- 修正后的 `review-chrome` / `review-edge` 各自 attempt 1 与自动重试 attempt 2 均失败，产物记录 `Cannot read properties of undefined (reading 'x')` 和 `missing-scenario-result`。原因是长文案 fixture 按原始全角标点查找，而收藏文本已做 NFKC 标准化；fixture 同步标准化后，最终 `verified-chrome` / `verified-edge` 均 attempt 1 通过。旧失败产物保留，不计作最终通过结果。

浏览器 fixture 使用临时 profile 与模拟直播页面，未执行真实直播间发送验收，不能证明线上消息送达。Impeccable context 与 detector 在本会话中因 `Permission denied` 未运行；以上结果不代表 detector 通过。

### 成功状态仅保留绿勾（2026-10-20）

移除成功状态的下方文字框，保留辅助技术完成播报。Pencil 动效说明与提示词已同步。`npm run build`（含 type-check）、`npm run lint:check`、7 项发送反馈单测通过；Chrome `favorites-design` [最终回归](../../../test-results/favorites-check-only-confirmed-2026-10-20/summary.json) attempt 1 通过，`captionRemoved` 为 true，已人工查看成功截图。首轮脚本仍读取已移除提示框的尺寸而中断，修正为仅成功状态允许该元素不存在，原失败产物保留。此次未重复 Edge 和完整检查，浏览器仍使用本地模拟页面。

### 发送即收缩，成功／失败分别反馈（2026-10-20）

- `npm run build`（含 type-check）、`npm run lint:check`、7 项发送反馈单测和 `npm run test:regression`（137 项）通过；构建、lint、regression 日志保存在 `test-results/favorites-immediate-2026-10-20/validation/`。
- Chrome / Edge `favorites-design` 最终均 attempt 1 通过：[Chrome](../../../test-results/favorites-immediate-2026-10-20/chrome-confirmed/summary.json)、[Edge](../../../test-results/favorites-immediate-2026-10-20/edge-confirmed/summary.json)。本地模拟页面暂缓输入消费，确认 sender 仍 pending 时扇区已收起且 bot 仍可见；放行后绿色勾出现且收缩动画不重启。阻止消费并耗尽既有发送重试后，确认 failed、红色叉、无绿色勾和无轮盘文字框。两浏览器的 `pendingFeedback`、`feedback`、`failedFeedback` 各项均为 true；减少动态效果检查通过。
- 已查看等待、成功、失败截图；[等待状态](../../../test-results/favorites-immediate-2026-10-20/chrome-confirmed/chrome/favorites-send-pending.png)、[失败状态](../../../test-results/favorites-immediate-2026-10-20/chrome-confirmed/chrome/favorites-send-failed.png)。
- 首轮两浏览器各 attempt 1、2 在等待失败态时达到原通用 3 秒检查上限。现有发送器包含 900ms 输入重试、1800ms 反馈等待及网络观察与准备，测试仅为失败态使用 5 秒上限；产品超时未变。原失败产物保留在 `chrome` / `edge`，最终以 `*-confirmed` 为准。
- 本次未重新运行完整 `npm run check` 或真实直播间发送；沿用现有平台发送器的结果语义。

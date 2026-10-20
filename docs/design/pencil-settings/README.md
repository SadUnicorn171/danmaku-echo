# Pencil 设置页设计

参考：[Ulad Luch 的 iOS UI Kit](https://www.figma.com/community/file/922533165060687529)。
2026-10-17 访问时该社区文件显示为 “iOS 27 Builder”。采用其分组列表、圆角表面、
胶囊选择器和标题层级作为视觉参考；实现仍是项目既有 Vue 3 设置页。

设计通过 Pencil MCP 创建可编辑图层，先完成设计与截图检查，再修改项目代码。
Pencil 画布：`/home/sadunicorn/.pencil/documents/9b8aa74e-5c95-47a9-9735-7f534ff6bacc/untitled.pen`。
主图层为 `bi8Au`（桌面）、`hSYJs`（窄屏）、`MORsf`（提示词与组件规范）。

## 构建提示词

为 Danmaku Echo 浏览器扩展设计设置页面。参考指定 Figma iOS UI Kit 的 inset grouped
分组列表、清晰字阶、圆角表面和胶囊控件；保留 #FD8101 回声橙、暖白、白色和墨色。
桌面采用侧栏导航与可滚动内容区，窄屏改为横向导航。沿用全部设置、双语、日志、统计和
收藏功能。橙色仅用于主要操作与当前选择；正文高对比，无装饰性阴影。快捷操作预览随
实际开关更新。使用轻量按压与开关过渡，支持减少动态效果。

## 设计图

- [桌面设置页](bi8Au.png)
- [窄屏设置页](hSYJs.png)
- [提示词、雷达与配色规范](MORsf.png)

桌面与窄屏图展示常规设置的上半部分；发送统计和其他设置继续在原有滚动内容区中保留。
设计稿的部分说明为布局摘要，实现保留项目完整文案、实际设置状态和数据行为。
图中版本是绘制时的项目版本，不作为代码版本来源。

## 实现映射

| 设计 | 项目文件 |
| --- | --- |
| 侧栏、窄屏导航 | `src/components/SettingsSidebar.vue` |
| 顶部操作与总开关 | `src/components/SettingsTopbar.vue` |
| 动态快捷操作预览 | `src/components/SettingsActionPreview.vue` |
| 分组列表与开关 | `src/App.vue`、`src/components/SettingSwitch.vue` |
| 配色折叠组与色值输入 | `src/components/ColorPlatform.vue`、`src/components/ColorField.vue` |

动效约束写入根目录 `AGENTS.md`，详细设计决策同步至 `docs/DESIGN_SYSTEM.md`。

## 验证记录（2026-10-17）

- `npm run check` 通过：类型检查、Lint、构建与构建校验、660 项单测、覆盖率范围校验、137 项回归检查。
- 最后样式修正后重新执行 `npm run build-only`、`npm run lint:check`，均通过。
- Chrome 155.0.8059.79 的 `settings-zh` 与 `settings-en` 场景通过；覆盖 800 / 1013 / 1280px 顶栏，420px 窄屏及 200% 缩放，以及设置持久化、配色、日志、统计等既有断言。
- 开发预览额外验证了快捷操作预览随复制开关、总开关及语言切换更新，以及 390px 英文布局。
- Edge 155.0.4283.45 的中文场景未完成：调试管道连接被重置（`ECONNRESET`），运行器自动重试后仍无场景结果；不能据此认定 Edge 已通过。
- 首次英文运行曾因仅重建 popup 导致扩展其他入口产物缺失而无法加载；完整重建后，中英文最终场景均在首次尝试通过。

本次结果保存在 `test-results/pencil-settings-2026-10-17/`；完整场景报告及截图在
`test-results/browser-e2e/chrome/`。这些本地产物不提交至版本库。

## 工具栏弹窗修复（2026-10-18）

上一轮设置页回归是在普通标签页打开 `index.html`，没有覆盖浏览器 action 弹窗。
本轮通过 `chrome.action.openPopup()` 实际复现了 320×25px 的折叠窗口：弹窗根据内容
自动定尺寸，而页面用 `100dvh` 决定自身高度，窄屏规则又取消了最小高度。

现在挂载前识别 popup 视图，根元素提供 800×600px 固有尺寸，应用框架贴合浏览器实际
分配的视口，设置和导航各自滚动。外部根滚动条隐藏，避免浏览器限制尺寸后重复出现
滚动条；普通设置标签页保留响应式布局。设计和主题色没有改变。

- `npm run build`（含类型检查）、`npm run lint:check`、`npm run validate:build` 与
  `npm run test:regression`（137 项）通过。
- Chrome 的 `settings-zh`、`settings-en` 最终运行均首次通过。新增断言覆盖实际弹窗的
  首次打开、小窗口、重开、内容滚动、顶部栏可见性、无外部滚动条以及普通标签页不被
  popup 样式影响。在当前 headless 显示空间下，弹窗分别为 800×510px 和 462×510px。
- Edge 测试在启动调试管道时发生 `ECONNRESET`，自动重试后仍未进入场景，未完成验证。
- 最终报告和截图分别保存在 `test-results/settings-popup-2026-10-18/verified-zh/` 与
  `verified-en/`；修复前证据在同目录的 `before/`，Edge 失败记录在 `edge-zh/`。

当前构建已更新至 `build/extension`。本地已加载扩展需要在浏览器扩展管理页重新加载，
商店安装的扩展不会自动使用工作区构建。

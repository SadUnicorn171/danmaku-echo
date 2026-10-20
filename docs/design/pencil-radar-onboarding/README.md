# Pencil：弹幕雷达首次说明

状态（2026-10-18）：已先通过 Pencil MCP 完成设计，再完成页面实现、截图对照与
自动验证。沿用现有设计系统；原设置页的三个画板保留，新增三个雷达首次说明画板。

## 设计目标

首次启用雷达时，让用户快速看懂：雷达入口在哪里、什么内容会进入提示队列、
点击 `+1` 才会发送，以及自动发送需要主动开启。沿用已完成设置页的回声橙、
暖白背景、清晰字阶和胶囊控件；保留直播画面中的入口指向关系。

## 已执行的设计提示词

重新设计 Danmaku Echo 浏览器扩展在直播页首次出现的“认识弹幕雷达”说明弹层。
沿用同项目设置页设计：主色 #FD8101，白色主表面，暖底 #F7F5F2，标题 #241A14，
辅助文字 #75695F。使用现有雷达图标与系统中文字体，无装饰性渐变或循环动画。
不要把此界面画成独立网站或完整设置页。

制作两个可编辑画板：1280×800 的桌面直播页场景，以及 390×640 的窄窗口场景。
画面背景仅表现简洁、压暗的直播内容轮廓；重点是首次说明和被指向的雷达入口。
桌面使用靠近入口的单一白色说明面，宽度约 460px，18px 圆角，24px 内边距。
窄窗口留出至少 16px 安全边距，正文可独立滚动，底部操作栏始终可见。
给出默认关闭和选中自动 +1 的控件状态，并标注键盘焦点及减少动态效果行为。

按以下阅读顺序设计，控制段落长度与信息密度：

1. 标题“认识弹幕雷达”，结合雷达图标和指向实际入口的箭头。简洁解释观察最近
   一分钟内重复出现的文字弹幕，达到设定次数后生成 +1 提示队列。
2. 突出“默认只提醒”：默认只有用户点击 +1 才会发送。说明高频内容进入队列，
   各提示独立倒计时，可选择 +1 或暂不处理。若使用视觉示例，明确标注“示意”，
   不伪造实时数据，不提供会真实发送的演示按钮。
3. “自动 +1 雷达弹幕”开关，默认关闭，读取实际保存状态。辅助说明：主动开启后
   达到门槛的高频弹幕会直接发送，仍受发送冷却和平台限制约束。此项与普通说明
   有清晰区别，不能与“知道了”捆绑开启。
4. 七项可调设置采用渐进展开：默认只显示“可调整设置”和“7 项”，
   展开后紧凑排列雷达开关、自动或手动档位、四个平台独立触发次数、提示停留
   时间、队列上限、提示框大小、自动 +1 开关。不新增设置字段，不挤占默认说明。
5. 简短说明以后可点击雷达入口查看当前设置，也能拖动入口调整位置。
6. 底部“进入设置”为次操作，“知道了”为橙色主操作。保持足够命中区与清晰
   键盘焦点，窄屏不裁切按钮。不要为了引导强制增加多个步骤。

进入使用约 180–220ms 的轻微位移和淡入，开关与按钮提供克制的微交互，遵守
prefers-reduced-motion。不添加无必要的骨架屏、数字滚动或新的动画依赖。

## Pencil 交付与实现映射

可编辑源文件：[untitled.pen](/home/sadunicorn/.pencil/documents/9b8aa74e-5c95-47a9-9735-7f534ff6bacc/untitled.pen)。
除提示词中的桌面和窄窗口画板外，另补充展开设置与交互规范画板。

| 画板 | 尺寸 | 画板 / 说明面节点 | 导出图 |
| --- | --- | --- | --- |
| 桌面默认说明 | 1280×800 | `W0NlG` / `Lf7z3` | [桌面设计](W0NlG.png) |
| 窄窗口说明 | 390×640 | `iDzwk` / `ZsV2S` | [窄窗口设计](iDzwk.png) |
| 展开设置与交互规范 | 860×760 | `xCRte` / `QdgXK` | [展开与交互设计](xCRte.png) |

实现位于 [ui.ts](../../../src/features/repeat-reminder/ui.ts)，继续使用现有 Shadow DOM
和入口定位逻辑。主题色继承平台的 `--bcp-selection` / `--bcp-action-start`，
默认回声橙 `#FD8101`，不覆盖用户已保存的配色。

| 设计要求 | 实际实现 |
| --- | --- |
| 连续白色说明面 | 18px 圆角、无叠加阴影；桌面宽度最多 460px、水平留白 24px，窄窗口留白 18px。标题依次为 24px、480px 以下 21px、340px 以下 19px。 |
| 默认只提醒 | 先解释手动 `+1` 和提示队列；自动 `+1` 独立呈现、默认关闭、读取保存状态，确认按钮不会替用户开启。 |
| 七项设置渐进展开 | 原生 `details` / `summary` 默认折叠，保留“7 项”提示；展开或收起时重新计算说明面与入口箭头位置。 |
| 小窗口可用 | `.onboarding-scroll` 独立纵向滚动；底部操作栏不参与滚动，44px 胶囊按钮始终可达，并保留安全区。 |
| 键盘操作 | 动态查询可聚焦控件，支持 Tab / Shift+Tab 循环、Enter 展开；Escape 确认后恢复提示队列首项或入口焦点。主操作用文字下划线表达焦点。 |
| 克制动效 | 200ms 淡入和轻位移、开关滑块轻回弹、按钮按压缩至 97%；减少动态效果时取消入场、过渡与按压缩放。 |

## 保持的行为边界

- `onboarding.ts` 的 `danmakuEchoRepeatReminderOnboardingV1` 本地确认键保持兼容，
  已确认的用户不会因为视觉改版重新看到引导。
- 保留“进入设置”和“知道了”的既有行为，以及开关保存、焦点循环、确认后焦点
  恢复。显示引导期间不展示提示队列，确认后恢复既有队列与倒计时。
- 不修改检测算法、发送协调器、平台适配或设置存储结构。若增加可聚焦控件，
  相应更新焦点约束；不沿用失效的硬编码焦点列表。

## 验证结果（2026-10-18）

- `npm run check` 退出码 0：类型检查、Oxlint、ESLint、各入口构建、构建校验、覆盖率
  检查与回归全部通过；113 个测试文件、662 个单测、137 个回归测试通过。
  完整日志：[danmaku-radar-check.log](/tmp/danmaku-radar-check.log)。
- 新增和修改的浏览器测试脚本通过定向 Oxlint、ESLint 与 `node --check`。
- Chrome 155.0.8059.79 四平台和 Edge 虎牙的专用首次说明 fixture 均通过。
  下表只链接最终结果：均为 `attempt: 1`、`code: 0`、`passed: true`、
  `assertionFailures: []`。

| 浏览器 / 平台 | 最终报告 | 实际桌面截图 |
| --- | --- | --- |
| Chrome / Bilibili | [summary.json](../../../test-results/radar-onboarding-2026-10-18/passed-bilibili/summary.json) | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-bilibili/chrome/radar-desktop.png) |
| Chrome / 斗鱼 | [summary.json](../../../test-results/radar-onboarding-2026-10-18/passed-douyu/summary.json) | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-douyu/chrome/radar-desktop.png) |
| Chrome / 虎牙 | [summary.json](../../../test-results/radar-onboarding-2026-10-18/passed-huya/summary.json) | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-huya/chrome/radar-desktop.png) |
| Chrome / 抖音 | [summary.json](../../../test-results/radar-onboarding-2026-10-18/passed-douyin/summary.json) | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-douyin/chrome/radar-desktop.png) |
| Edge / 虎牙 | [summary.json](../../../test-results/radar-onboarding-2026-10-18/edge-verified-huya/summary.json) | [截图](../../../test-results/radar-onboarding-2026-10-18/edge-verified-huya/edge/radar-desktop.png) |

每个场景均检查 1280×800、390×640、640×300、320×240 四种视口的默认、展开和
滚动状态，以及无横向溢出、底部操作可达、Tab / Enter / Escape、自动 `+1` 保存到
`storage.sync`、首次确认保存到 `storage.local`、重载后不再出现、减少动态效果。
以下是 Chrome 虎牙的完整尺寸对照；其余平台同名产物位于对应报告目录。

| 视口 | 默认 | 展开设置 | 滚动后 |
| --- | --- | --- | --- |
| 1280×800 | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-huya/chrome/radar-desktop.png) | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-huya/chrome/radar-desktop-expanded.png) | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-huya/chrome/radar-desktop-scrolled.png) |
| 390×640 | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-huya/chrome/radar-compact.png) | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-huya/chrome/radar-compact-expanded.png) | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-huya/chrome/radar-compact-scrolled.png) |
| 640×300 | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-huya/chrome/radar-short.png) | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-huya/chrome/radar-short-expanded.png) | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-huya/chrome/radar-short-scrolled.png) |
| 320×240 | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-huya/chrome/radar-small.png) | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-huya/chrome/radar-small-expanded.png) | [截图](../../../test-results/radar-onboarding-2026-10-18/passed-huya/chrome/radar-small-scrolled.png) |

Pencil 与浏览器截图已人工对照，布局、层级和交互状态匹配，图标沿用项目现有资源。
Impeccable 检测器因 `permission denied` 未执行，不将人工对照记为自动检测通过。
浏览器脚本调试中的中途运行不作为通过证据；Edge 首次沙箱启动的 `ECONNRESET`
属于环境启动失败，使用临时 profile 在沙箱外重跑后通过。

上述报告、截图和检查日志为本地验证产物。此次没有向真实直播间发送弹幕，真实站点
DOM、账号状态及消息送达尚未验证；本地 fixture 通过不替代真实直播间验收。

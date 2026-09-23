---
name: danmaku-browser-regression
description: "为 Danmaku Echo 执行或准备 Chrome/Edge 浏览器回归：按改动选择现有 CDP fixture 场景，检查扩展构建、运行环境和结果产物，并区分模拟页面与真实直播间验收。适用于悬停、全屏、SPA、富表情、设置页和扩展注入验证；不替代平台根因排查或用于其他项目。"
---

# 弹幕回声浏览器回归

复用项目已有本地浏览器运行器，以本次构建和本次产物记录覆盖范围。用户当前指令优先；沿用已授权的验证范围，不因加载此 skill 增加审批步骤。

## 准备与范围

1. 在仓库根目录查看 `git status --short` 和待验证的差异，读取 [AGENTS.md](../../../AGENTS.md)、[package.json](../../../package.json) 及 [浏览器运行器](../../../tests/browser/run-browser-e2e.cjs)。先辨别用户要准备方案、执行 fixture、真实直播间验收还是完整回归。
2. 从运行器的 `scenarios`、`browserCandidates()`、结果判定和重试逻辑确认当前接口，不硬编码历史场景数。按受影响平台/共享模块选场景；共享悬停、发送、缩放和生命周期改动应覆盖相关消费平台。
3. 使用工作区当前源码生成 `build/extension`：通常先执行 `npm run build`。同一工作流刚完成 `npm run check` 或等效构建且源码未变时复用产物，避免重复构建。不能仅凭 manifest 存在或版本号一致认定产物最新。
4. 确认 Node 满足当前 `package.json` 的 engines、依赖已就绪，浏览器可执行文件存在。安装依赖或启动浏览器若触发环境权限限制，走工具规定的权限流程，不绕过。缺浏览器时说明缺失项，继续可执行的静态检查，不将其记作测试通过。

## 执行本地 fixture

所有命令在仓库根目录执行。运行器通过临时 profile、回环 fixture 服务和真实扩展产物进行隔离测试；沿用运行器，不手动把带有操作逻辑的 inspector 指向真实直播间。

常用命令（场景名称仍须与当前 `scenarios` 核对）：

```bash
npm run test:browser -- --browser=chrome --scenario=bilibili-precise-logs
npm run test:browser -- --browser=edge --scenario=douyu-fullscreen
npm run test:browser -- --browser=chrome
npm run test:browser
```

`--scenario` 为单个完整名称，不支持逗号列表、通配符或平台前缀。省略它会运行所选浏览器全部场景；省略 `--browser` 默认要求 Chrome 与 Edge 都可用。多场景可分别执行，完整回归优先单次执行整套，保留完整汇总。

| 改动范围 | 从当前运行器选择的场景示例 |
| --- | --- |
| B 站诊断/后备注入 | `bilibili-precise-logs`，并按实际富消息路径补相关表情场景 |
| 缩放 | `bilibili-auto-scale`、`douyin-auto-scale`，以及受影响的全屏场景 |
| 悬停与全屏 | 相关平台 `*-side`、`*-fullscreen`；斗鱼补原生交互路径，B 站性能场景按实际改动选择 |
| 富消息与资源身份 | 相关平台 image/standard/room/PE3 等实际场景；抖音结合 side/fullscreen fixture 内断言核对 |
| 设置页 | `settings-zh`、`settings-en` |
| 抖音 SPA/销毁恢复 | 先检查现有 fixture 是否覆盖具体生命周期事件；没有覆盖时补最小 fixture 或列为真实页面待验，不能由 `douyin-side` 通过推断 SPA 通过 |

当前浏览器自动候选主要为 Windows 安装路径；非 Windows 或自定义安装路径通过 `DANMAKU_E2E_CHROME_PATH` / `DANMAKU_E2E_EDGE_PATH` 显式配置。先在实际环境定位可执行文件，不照抄示例路径。Bash 用 `export DANMAKU_E2E_CHROME_PATH='/实际路径'`，PowerShell 用 `$env:DANMAKU_E2E_CHROME_PATH = '实际路径'`。

## 结果判定与失败处理

- 读取本次 `test-results/browser-e2e/summary.json`，核对场景、browser、`passed`、`code`、`timedOut`、`assertionFailures` 和 `attempt`；结合对应浏览器目录下的 JSON、启动报告、截图、stdout/stderr 解释结果。检查时间和本次运行范围，启动提前失败时旧 summary 不能当作本次产物。
- 每次调用会覆盖 summary；同名场景的对应产物会清理重建。多次筛选执行时，在下一次运行前保存本次结果到唯一命名的本地产物目录或记录结果，避免用最后一次 summary 概括全部执行。不要清空整个产物目录或混入旧证据。
- 当前运行器对超时、退出码 2 或无可解析结果会重试一次。检查实际 `attempt` 与首次报告；重试后通过要如实说明。普通断言失败不应靠反复运行直到通过；未改变代码或环境时不再叠加重试。即使被运行器归入启动重试，仍需检查是否已有断言失败证据。
- 区分环境启动失败（浏览器路径、端口、profile、CDP）、夹具与运行器问题、产品断言失败。只在定位后修对应问题；不为获得绿色结果放宽断言、无限延长超时或添加固定等待。
- 若用户仅要求验收，报告缺陷与证据，不自动扩大为架构修改。若已授权修复，修复后先重跑失败场景和相关场景；按改动补必要检查，不重复无关全套。
- 保持 E2E 为本地可选测试，不加入 CI；复用现有工具，不为了执行场景另装 Playwright 或修改浏览器日常 profile。运行器负责自身临时资源清理，若异常残留，只处理能确认属于本次运行的资源。

## 真实直播间验收

仅在任务涉及真实页面时读取 [真实页面回归记录](../../../docs/ENTRY_REFACTOR_REGRESSION.md) 的对应平台清单；发布验收另读 [发布清单](../../../docs/RELEASE_CHECKLIST.md)。历史结果不代表本次通过。

确认目标 Chrome/Edge 实际加载当前扩展，记录浏览器版本、进入方式、页面模式与复现步骤。Codex 内置浏览器若不能加载该扩展，不能用它证明扩展交互正常。没有可靠连接时保留待验状态；环境未变不反复附加调试器。

按改动验证普通/网页全屏/原生全屏、iframe、切房、SPA、关闭和恢复；只勾选有实际证据的条目。真实发送须有用户明确授权，已有授权无需重复询问；使用最少、低频操作，不制造限流。回复通常只验证填入与聚焦。截图、日志和报告需脱敏，不暴露凭据或无关用户信息。

fixture 模拟了站点 DOM/API，不能证明当前官方 DOM、真实账号权限或消息送达；`bilibili-precise-logs` 尤其只验证模拟失败轨迹和最终发送未调用。真实站点记录与 fixture 结果分开，缺少覆盖明确列出。

## 交付

用中文报告本次源码/构建依据、系统与浏览器版本、实际命令和场景结果、重试情况、证据路径及未覆盖部分。仅准备方案时明确未运行。需要维护项目回归记录时只增加本次事实，不改写历史结果或提前勾选未验条目。若改了文件，最后核对 `git diff`；不提交生成产物。

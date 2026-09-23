# 性能优化实施与验证记录

日期：2026-09-16。对应 [性能优化计划](PERFORMANCE_OPTIMIZATION.md)。本轮优化面向高流量雷达、DOM 采集、失败日志写入和抖音渲染中的重复工作；不改变平台发送方式、扩展权限、设置 schema 或依赖。

本文中的 CPU、DOM、存储和启动数据来自确定性本地 fixture。它们证明对应模块在该负载下的变化，不能换算为真实直播间 FPS、整页 CPU 降幅或官方发送成功率。真实站点验收仍需单独记录。

## 1. 基线与复现条件

- Linux `7.2.5-200.fc44.x86_64`，AMD Ryzen 9 7940HS，16 个逻辑处理器，约 30.5 GiB 内存；Node `v22.23.1`。
- Chrome `153.0.8010.36`，Edge `153.0.4234.32`。浏览器 fixture 使用独立临时 profile、headless 模式、关闭 GPU 和后台节流；不代表普通视频播放环境。
- HEAD：`102ce50e0b3ca219ee30428ca87de5c3cc8c01f5`，工作区有未提交修改，**不能只靠这个 commit 复现本轮产物**。
- 优化前算法、采集器、Renderer 和日志模块的冻结参照位于 [`tests/fixtures/performance/`](../tests/fixtures/performance/)。参照模块只供测试导入，不进入扩展构建。
- 本地原始记录位于 `test-results/performance/`，构建字节数与 SHA-256 见 `baseline-build.json`、`current-build.json`；源码校验表见 `source-sha256.json`，恢复后工具脚本校验表见 `source-verified-sha256.json`。恢复执行时核对源码，生产代码与原校验表一致。
- 算法、DOM 扫描、日志、Renderer 和启动均采用三轮对照，交替前后实现的执行顺序。下文以三次结果的中位数汇总；单次原始 P50/P95/max 保存在 JSON。失败附件采集是每种 DOM 规模各连续 30 次，尚非三轮交替试验。
- 期间存在并行测试和主机中断。中断的浏览器套件及未完成长测不计为通过，保留其产物。旧压力记录中的调度停顿没有被删除；尤其 300 档基线曾出现约 2 秒单次停顿，不能把最大值完全归因于算法。

## 2. 实际修改及行为约束

| 编号 | 已实施 | 正确性证据与边界 |
| --- | --- | --- |
| PERF-01 | 按文本增量维护计数、发送者引用计数、代表文本；记录、指纹、消息 ID、相似簇使用可更新的到期堆 | 两个种子各 1,200 步与冻结实现逐步比对，含乱序、未来时间、双源镜像、忘记、阈值、清空和窗口边界；不截断精确计数 |
| PERF-02 | 一次候选比较返回分数和资格；检测器实例内最多缓存 512 份文本特征 | 对照数字、URL、拉丁文本、否定词、Emoji、短文本及长文本评分；容量满时淘汰缓存，不淘汰候选 |
| PERF-03 | 直接迭代待处理 Map，每批最多 200 个且使用 4ms 软预算；Shadow Root 发现最多访问 4,000 个元素；避免整个 NodeList 转数组 | 单批只在元素之间让出，单个解析仍可能超过 4ms。扫描前后均处理末尾 240 个节点；未改变 1,000 个候选队列上限 |
| PERF-04 | 操作栏左右位置未变时不重写属性；相同 transform 不重复赋值 | 单元测试检查连续静止帧无 DOM 变更，移动仍更新；实际 Renderer fixture 包含文字和内联图片、空轨道/80 轨道、静止/移动及销毁恢复 |
| PERF-05 | 初始禁用不安装采集观察器；分离 Shadow Root 后断开观察；destroy 移除 DOMContentLoaded 待启动监听器 | 20 次节点替换、通用运行时切房、抖音 SPA/BFCache 和定时器回收测试；保留有恢复用途的路由与维护周期 |
| PERF-06 | 失败附件遍历同时计入文本/注释节点，限制实际访问工作；日志仅合并串行队列中相邻且已到达的追加请求；一次计量字节、一次最终持久化 | 保持白名单重校验、容量淘汰、重复 ID、100 个逻辑请求背压；export/clear 是顺序屏障；所有成功响应必须等待 storage.set 完成 |
| PERF-07 | 倒计时文本没变就不写 DOM | 保留 250ms 到期检查；测试相同秒无写入、跨秒更新、到期移除及销毁停表 |
| PERF-08 | 测量各入口大小和四平台冷启动时首次扩展 portal 挂载 | 证据未支持继续改写入口架构；设置页 JS 和共享脚本大小不变 |

日志合批没有新增延迟落盘定时器，也没有把唯一副本放在 Service Worker 常驻缓存中。失败的整批请求都会拒绝，后续请求可重新读取持久状态恢复。正常发送路径不因本轮优化新增 DOM 快照。

## 3. 雷达算法对照

以虚拟时间覆盖 120 秒输入；10 / 100 / 300 档分别输入 1,200 / 12,000 / 36,000 条。每条计时包含 `ingest()` 和被调用的 `triggeredSuggestion()`，不包含浏览器 DOM、页面 UI 或站点脚本。预热 200 条，与计划中的浏览器 30 秒预热不同。

| 虚拟条/秒 | 数据 | 总耗时：基线 → 优化后（ms） | 单条 P95：基线 → 优化后（ms） |
| --- | --- | --- | --- |
| 10 | 唯一文本 | 108.8 → 21.5 | 0.1453 → 0.0257 |
| 10 | 完全重复 | 55.2 → 11.7 | 0.0793 → 0.0146 |
| 10 | 同前缀数字变体 | 1,620.0 → 40.2 | 6.5628 → 0.1013 |
| 100 | 唯一文本 | 13,057.4 → 218.7 | 2.4440 → 0.0221 |
| 100 | 完全重复 | 3,933.3 → 123.4 | 0.5649 → 0.0143 |
| 100 | 同前缀数字变体 | 7,416.2 → 142.4 | 1.1055 → 0.0145 |
| 300 | 唯一文本 | 266,457.6 → 595.1 | 12.8492 → 0.0213 |
| 300 | 完全重复 | 48,283.9 → 430.7 | 2.8476 → 0.0154 |
| 300 | 同前缀数字变体 | 51,582.6 → 461.0 | 2.7107 → 0.0172 |

三轮中相同负载的建议数量前后一致，完整输出语义另由逐步对照单元测试验证。主要收益来自消除逐条全窗口重建和重复相似度计算。到期索引不要求输入时间有序；计数数据仍随 60 秒内流量增长，并非固定内存上限。

增量索引需要保留更多集合，以换取更少的重复计算和临时对象。本文没有提供前后等量数据的堆占用 A/B 对照，因此不声称总内存低于基线；长测的堆采样只用于观察当前实现是否趋于稳定及能否回收。

原始记录：`radar-10-per-second.json`、`radar-100-per-second.json`、`radar-300-per-second.json`。

## 4. DOM、渲染与存储对照

下表以恢复执行后的 `browser-verified/` 对照为准。分阶段旧数据仍保存在 `dom-perf03/`、`log-perf06/` 等目录；不混用不同轮次的基线与优化后数据。各场景只表示表内测量范围。

| 测量项 | Chrome：基线 → 优化后 | Edge：基线 → 优化后 | 范围 |
| --- | --- | --- | --- |
| 30,000 节点采集器扫描 P95 | 11.9 → 2.0ms | 15.1 → 1.8ms | 每轮 30 次 scan，前后各发出 240 个节点 |
| 1,500 节点采集器扫描 P95 | 1.4 → 0.8ms | 1.5 → 0.7ms | 同上；不是 mutation 到 UI 的端到端延迟 |
| 80 条静止轨道帧处理 P95 | 1.4 → 0.8ms | 1.9 → 1.1ms | 实际 Renderer 的读取与提交，不含完整 Worker/page-app 调度 |
| 80 条移动轨道帧处理 P95 | 1.5 → 0.9ms | 1.6 → 1.1ms | 同上，60 个 RAF 样本 |
| 静止轨道属性变更数 | 9,600 → 0 | 9,600 → 0 | 相同轨道与帧数 |
| 移动轨道属性变更数 | 14,400 → 4,960 | 14,400 → 4,960 | 保留运动所需的 transform 更新 |
| 3 条提示倒计时 4 秒内 DOM 变更 | 48 → 12 | 48 → 12 | 显示内容与到期移除仍校验 |
| 同批 100 条日志全部落盘耗时 | 6,626.9 → 61.0ms | 6,795.2 → 66.5ms | 真实 chrome.storage.local；250 条预置日志 |
| 该批日志写入次数 | 100 → 1 | 100 → 1 | 10 个模拟 tab ID 各 10 条，同一轮同步入队 |

日志场景测量的是同一存储队列中的突发请求，不是 10 个真实标签页同时跨进程通信。分散在不同事件轮次、或中间夹有 export/clear 时会拆成多个批次，不能承诺实际使用中每 100 条恰好写一次。每轮仍核对所有新增 ID 已持久化；故障、重复 ID 重入和淘汰顺序由单元测试覆盖。

倒计时的基线 48 次来自 `ui-baseline/`，该行是同一 fixture 的改前/改后独立运行，不是同页双实现交替执行。流量计 10,000 个样本的 `snapshot()` P95 在该轮两种浏览器中均约为 0.4ms，调用频率约每秒一次。因此 PERF-07 只减少倒计时无变化写入，未引入第二套复杂增量统计。

失败附件采集的遍历上限通过 10,000 个相邻文本节点测试验证。30,000 节点 DOM 上采集 P95：Chrome 9.6 → 6.8ms，Edge 11.3 → 4.8ms。采集耗时包含 selector 查询且目前未分离跨 world 传输、后台排队各段，不能声称整个失败诊断流程均低于 4ms。

## 5. 加载成本与取舍

四平台、两个浏览器、前后各三次，共 48 次本地冷启动对照完成。下表是导航开始到首次扩展 portal DOM 挂载时间的中位数，不是完整可交互时间，也不是设置页打开时间。

| 平台 | Chrome：基线 → 优化后（ms） | Edge：基线 → 优化后（ms） |
| --- | --- | --- |
| Bilibili | 93.7 → 94.0 | 116.0 → 108.2 |
| 斗鱼 | 86.2 → 84.9 | 93.0 → 91.4 |
| 虎牙 | 81.6 → 83.1 | 92.0 → 88.3 |
| 抖音 | 84.9 → 86.2 | 103.2 → 101.2 |

原始记录：`startup-comparison/results.json` 及 48 份独立 JSON。当前样本不足以把几毫秒差异认定为启动优化收益，也未发现需要为本轮性能改动重构加载顺序的证据。

| 未压缩构建文件 | 基线字节 | 优化后字节 | 差值 |
| --- | ---: | ---: | ---: |
| `src/content.js` | 713,145 | 718,346 | +5,201 |
| `src/douyin-content.js` | 623,912 | 629,113 | +5,201 |
| `src/douyin-page-hook.js` | 174,257 | 174,394 | +137 |
| `background/service-worker.js` | 98,894 | 100,423 | +1,529 |
| 设置页 `assets/index-Dt_7yChi.js` | 274,306 | 274,306 | 0 |
| `src/douyin-bootstrap.js` | 20,141 | 20,141 | 0 |
| `src/shared.js` | 19,356 | 19,356 | 0 |

本轮以少量代码和索引换取重复工作减少，并非减包优化。基准 IIFE 只写到 `test-results/performance/`，没有加入 manifest 或扩展包。

## 6. 回归与稳定性验收

- `npm run check`：当前源码执行完成，退出码 0；包含类型检查、lint、构建、构建校验、coverage 和契约回归。记录：`check-verified.log`、`check-verified.status`；覆盖率报告：`test-results/coverage/coverage-summary.json`。
- 算法逐步对照与到期堆专项测试：3 个文件、6 个测试通过，记录 `equivalence-verified.log`。完整门禁也覆盖采集器、Renderer、UI、日志与生命周期新增用例。
- 本地运行器补充 Linux 浏览器语言环境，修复 `--lang` 单独使用时中文 fixture 实际加载英文的问题；Chrome 中英文设置页在修正后均通过，见 `settings-zh-verified/`、`settings-en-verified/`。未修改产品国际化逻辑。运行器变更后的语法与 lint 检查通过。
- Chrome/Edge 完整 fixture：54 个场景完成，原始整轮 51 通过、3 失败，退出码 1，无自动重试。Chrome 中文语言环境修正后专项通过；综合当前证据为 52 个场景通过，另有两个浏览器的 `bilibili-side` 聚焦断言未通过。**不能把本轮描述为浏览器全绿。** 原始汇总见 `browser-verified/summary.json`，复验见上面的独立设置页目录。
- Chrome 30 分钟真实计时采集器稳定性测试通过，退出码 0，无重试：20 次容器替换发出 400/400 条观察；随后模拟 100 条/秒，使用 2,000 条循环文本和 300 个发送者，DOM 最多保留 1,500 行。第 10～15 分钟明确关闭采集器并暂停生成，恢复后继续采集，最终产生/发出均为 150,390 条。采集器活动时 1 个观察器，关闭阶段为 0；销毁后观察器、队列、flush 和根发现调度均归零。原始记录及本轮实际 fixture 副本见 `soak-verified/chrome/`。
- 已确认的基线失败：Chrome 和 Edge `bilibili-side` 的 `replyInputFocused` 在各自优化前构建同样失败，见 `focus-baseline/summary.json`、`focus-baseline-edge/summary.json`。回复文本、发送隔离和其它断言通过；该项不能标作本轮通过。源码中 B 站发送后仍会在 80～1,600ms 多次延迟 blur，可与随后的回复聚焦重叠；本轮未扩大修改该发送生命周期，不能据此宣称该既有问题已修复。

B 站原有悬停压力门槛通过：每种浏览器均有 1,500 条侧聊、100 次悬停、100 个有效样本、0 个调度暂停样本，因此本轮未过滤与有效样本范围相同。Chrome 同步处理 P95 5.4ms、胶囊可见 P95 15.3ms/max 23.9ms；Edge 分别为 6.4ms、25.3ms/36.2ms，均满足既有 16/50/150ms 门槛。发送者关联与重复边框断言也通过；这是当前版本回归证据，不是相对于历史版本的悬停收益对照。

长测每分钟在 CDP GC 后记录页面 isolate 的 heap，共 32 次采样（含起点与销毁后）。第 3～30 分钟 JavaScript heap 使用量为 4.83～5.09 MiB，销毁后约 2.46 MiB，起点约 2.15 MiB；数据没有显示持续线性增长。此处统计整页 isolate，不能把全部字节归属扩展。`embedderHeapUsedSize` 销毁后的即时样本约 4.03 MiB，仍高于起点约 0.86 MiB；没有进一步的 detached DOM 保留链证据，不能用 JavaScript heap 下降宣称所有原生 DOM 内存已经释放。该长测也没有用真实页面隐藏代替明确禁用操作。

本轮没有向真实账号发送弹幕，没有完成真实直播间的长时间视频、Worker、SPA 或原生全屏验证。采集器长测与 fake timer 生命周期测试只能证明各自覆盖的模块；不能据此宣称整页无泄漏。计划中的整页扩展关闭/雷达关闭/雷达开启三组 trace、真实 FPS、完整 detached DOM 保留链和设置页大量收藏负载仍属补充验收。

## 7. 本地复现命令

先在本机配置浏览器路径；以下使用本轮 Linux 路径。浏览器验证保持本地可选，不加入 CI。

```bash
export DANMAKU_E2E_CHROME_PATH=/usr/bin/google-chrome
export DANMAKU_E2E_EDGE_PATH=/usr/bin/microsoft-edge
npm run check

# 120 秒虚拟时间的算法对照：按需将 count 改为 1200 / 12000 / 36000
node scripts/benchmark-repeat-reminder.cjs --mode=compare --runs=3 --count=12000 --seconds=120 --output=test-results/performance/radar-local.json

# 全套默认场景，包含四个短性能场景，不包含 30 分钟长测和启动对照
npm run test:browser -- --artifact-root=test-results/performance/browser-local

# 单独测量，只接受一个完整场景名
npm run test:browser -- --browser=chrome --scenario=runtime-performance --artifact-root=test-results/performance/dom-local
npm run test:browser -- --browser=chrome --scenario=log-performance --artifact-root=test-results/performance/log-local
npm run test:browser -- --browser=chrome --scenario=renderer-performance --artifact-root=test-results/performance/renderer-local
npm run test:browser -- --browser=chrome --scenario=ui-performance --artifact-root=test-results/performance/ui-local
npm run test:browser -- --browser=chrome --scenario=lifecycle-soak --artifact-root=test-results/performance/soak-local

# 单次启动测量；--extension-path 可指定预先保留的基线构建
npm run test:browser -- --browser=chrome --scenario=bilibili-startup --artifact-root=test-results/performance/startup-local
```

`scripts/benchmark-startup.cjs` 可运行完整 48 次对照，但要求先保留 `test-results/performance/baseline-extension`；不要用当前构建覆盖该目录后再声称存在前后对照。更换基线时同时更新其构建 SHA-256 和来源记录。

每次复现应写入新的产物目录，保留所有 attempt、失败原因和未经筛选的统计。运行器会逐场景落盘，但主机重启留下的部分 summary 不是完整套件通过证明。

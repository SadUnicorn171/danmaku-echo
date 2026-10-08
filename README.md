# Danmaku Echo / 弹幕回声

<p align="center">
  <img src="public/assets/danmaku-echo-icon.png" width="180" alt="Danmaku Echo icon">
</p>

> 为虎牙直播、哔哩哔哩直播、抖音直播和斗鱼直播提供弹幕 `+1`、回复、复制、本地收藏，以及高频弹幕 +1 提醒。
> Danmaku echoing, replies, copying, local favorites, and frequent-message +1 reminders for Huya, Bilibili, Douyin, and Douyu Live.

[中文](#中文) · [English](#english) · [隐私权政策](PRIVACY.md)

![Version](https://img.shields.io/badge/version-2.3.3-orange)
![Manifest](https://img.shields.io/badge/Chrome-Manifest%20V3-blue)
![License](https://img.shields.io/badge/license-MIT-green)
[![CI](https://github.com/SadUnicorn171/danmaku-echo/actions/workflows/ci.yml/badge.svg)](https://github.com/SadUnicorn171/danmaku-echo/actions/workflows/ci.yml)

## 中文

### 项目简介

Danmaku Echo（弹幕回声）是一个适用于 Chrome 和 Edge 的 Manifest V3 浏览器扩展。它会为直播间右侧聊天区和视频画面上的滚动弹幕添加 `+1` 按钮，让你可以像使用斗鱼弹幕 `+1` 一样，一键复读当前弹幕。

### 支持平台

| 平台 | 右侧聊天区 | 视频弹幕 | 高频 +1 提醒 | 全屏模式 |
| --- | --- | --- | --- | --- |
| 虎牙直播 | ✅ | ✅ | ✅ | ✅ |
| 哔哩哔哩直播 | ✅ | ✅ | ✅ | ✅ |
| 抖音直播 | ✅ | ✅（DOM 接管） | ✅（Canvas 队列 + 侧聊） | ✅ |
| 斗鱼直播 | ✅ | ✅ | ✅ | ✅ |

### 弹幕收藏

收藏只保存在 `chrome.storage.local`，不会上传或跨设备同步；相同内容在全局只保留一份，但会记录它来自哪些平台和直播间。打开收藏时默认聚焦本房内容；“其他直播间”和“全部”先显示直播间列表，点击任意直播间后进入独立的弹幕选择页，再发送或加入当前房间。

所有可识别弹幕都可以收藏，包括普通文字、Unicode Emoji、平台图片表情以及文字与表情混排。富弹幕会同时保存显示文字、内容顺序和平台资源识别信息；同样显示为“图片表情”的不同资源不会被错误合并，旧版纯文字收藏会自动兼容。发送富弹幕时优先使用当前平台的官方输入框与表情面板，能否发送取决于当前平台和账号是否仍可使用对应资源；B 站房间图片表情在面板无法唯一定位时，会校验资源所属真实房间并通过当前 B 站页面的官方弹幕接口后备发送。

在直播间短按 `Alt + Q` 会打开固定收藏面板，可置顶收藏、添加可搜索标签，并按发送次数、收藏时间或“轮盘顺序”排列。选择“轮盘顺序”后，可拖动左侧手柄或使用上下按钮持久调整本房顺序；长按 `Alt + Q` 打开的快捷轮盘会读取这一顺序并展示前 6 条弹幕。数字键 `1–9` 可发送当前页弹幕；轮盘可直接指向并松开发送，“其他收藏”和“更多”会进入对应列表。原生全屏时界面会挂载到 `document.fullscreenElement` 内，因此全屏状态也可操作。

### 轻量弹幕雷达

开启后，直播页会显示雷达图标。雷达统计最近一分钟内重复出现的文字弹幕，达到设定次数后显示“暂不 / +1”提示；图片表情不参与统计。首次使用时会显示简短说明。

可按平台选择自动或手动触发次数，并设置提示时长、队列上限和提示大小。点击“暂不”或“+1”后，该弹幕会暂时停止重复提示。也可开启“自动 +1”，让达到条件的弹幕通过平台发送流程自动发送；此选项默认关闭。关闭雷达后会停止统计并隐藏图标和提示。

### 胶囊与雷达大小

在「常规设置」选择界面大小的自动或手动模式，分别保留胶囊基础大小和各平台雷达提示大小。自动大小以 **3860×2160** 为基准，用浏览器报告的屏幕宽高乘像素比估算显示分辨率，按宽、高比例中较小的一项缩放；最终范围为 50%–200%。基准屏幕上 100% 保持原大小，1920×1080、像素比为 1 时约为 50%。浏览器缩放会影响像素比，切换屏幕或窗口重新获得焦点后会重新计算。无法取得有效屏幕数据时使用基础大小。

界面自动大小、雷达自动触发和自动 +1 是三个独立开关。默认使用手动大小，升级保留原设置；自动触发不会锁定提示停留时间、队列上限或提示大小。

### 抖音直播

抖音直播间支持对侧边聊天消息和视频弹幕使用 +1、回复和收藏；首次进入直播间、站内切换直播间时无需手动刷新。

### 核心功能

- 在四个平台支持的侧边聊天消息和视频弹幕上使用 `+1`、回复、收藏和复制。
- `+1` 发送相同弹幕，并提供连续点击、并发及同内容 3 秒冷却保护；平台限流、重复发送或禁言时显示可取得的官方提示。
- 回复会填入 `@发送者 ` 并聚焦输入框；后续内容和发送由用户决定。
- 收藏支持文字、Emoji、平台图片表情及混排内容，可跨直播间查看、搜索、加标签和排序。
- 短按 `Alt + Q` 打开收藏面板，长按打开快捷轮盘；也可用数字键发送收藏。
- 弹幕雷达统计最近一分钟内重复的文字弹幕，可自定义触发次数、提示时间和队列大小，并可选择自动 +1。
- 设置中可按平台启用操作按钮、独立显示或隐藏各项操作，并切换中英文界面；弹幕操作支持网页和原生全屏。
- 抖音直播设置可分别切换送礼信息、福袋口令和屏蔽礼物特效。
- 发送统计按秒记录成功发送弹幕的平台、房间和纯文本内容，可在设置页查看、筛选和导出。

### 安装

推荐优先通过浏览器官方扩展商店安装并接收更新：Chrome 用户前往 [Chrome 网上应用店中的弹幕回声](https://chromewebstore.google.com/detail/ndhdmieaeklfmfjjkpoiklhibmnjnmkp?utm_source=item-share-cb)，Edge 用户前往 [Microsoft Edge 加载项中的弹幕回声](https://microsoftedge.microsoft.com/addons/detail/%E5%BC%B9%E5%B9%95%E5%9B%9E%E5%A3%B0-danmaku-echo/nbpefkbpbcnkeelaamjnfdeiplnghodl)。如果无法访问商店，可使用下方 GitHub Release 安装方式。

#### 从 Release 安装

1. 从 GitHub Releases 下载 ZIP，并解压到固定目录。
2. 打开 Chrome 的 `chrome://extensions`，或 Edge 的 `edge://extensions`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择解压后的目录。
5. 刷新已经打开的直播页面。

> Chrome/Edge 开发者模式不能直接加载 ZIP，请务必先解压。

#### 从源码安装

克隆仓库后先安装开发依赖并构建，再在扩展程序页面加载 `build/extension` 目录：

```powershell
npm install
npm run build
```

`build/extension` 是唯一应加载的未打包扩展目录；仓库根目录保留源代码、测试和构建配置。

### 使用方法

1. 打开支持平台的直播间，将鼠标移到侧边聊天消息或视频弹幕上。
2. 点击弹出的 `+1`、回复、收藏或复制按钮。回复会填入 `@发送者 ` 并聚焦输入框，不会自动发送；复制按钮可在设置中开启。
3. 短按 `Alt + Q` 打开收藏面板，长按打开快捷轮盘；在面板中也可用数字键 `1–9` 发送收藏。
4. 点击浏览器工具栏中的扩展图标管理总开关和平台开关；打开扩展设置可调整操作按钮、弹幕雷达及其他选项。设置页可随时切换中英文。

按住 `Alt` 单击可识别的弹幕也能快速执行 `+1`；此快捷操作默认开启，可在常规设置中关闭。

### 运行日志与故障排查

构建或打包安装后，运行日志默认启用。重现问题后，打开「常规设置 → 运行日志」导出 JSON，并在问题报告中注明发生时间、平台、浏览器版本和操作步骤。日志保存在本机，最多 500 条、约 1 MB，读写时清理超过 7 天的记录；清空日志不影响收藏和设置。

日志包含脱敏后的错误原因、堆栈、扩展版本、屏幕/窗口信息及结构化上下文。B 站表情后备发送失败可通过同一个 attemptId 关联后台与页面记录，定位失败阶段和请求结果。日志不自动上传，也不收集 npm 构建或打包的终端输出。发送失败还可附带脱敏 DOM 的 HTML 片段、请求耗时、参数结构和响应状态；不包含原始正文、参数值或凭据。记录范围、字段解释与报告步骤见[日志排查指南](docs/TROUBLESHOOTING.md)。

### 开发与验证

建议使用 Node.js 22.22.2（CI 固定版本）；项目要求 Node.js 22.22.2+，或 24.15+。

启动 Vue 设置页开发预览：

```powershell
npm run dev
```

```powershell
npm run check
```

该命令执行类型检查、代码规范检查、完整构建、Manifest 与架构边界校验、带覆盖率门槛的单元测试，以及契约回归测试。版本同步和提交检查见[发布检查清单](docs/RELEASE_CHECKLIST.md)。

浏览器 E2E 仅作为本地可选回归测试保留，可手动运行 `npm run test:browser`；普通 CI 和发布工作流均不执行浏览器 E2E。涉及直播消息采集时仍需手工验证四个平台的普通页面与网页全屏。

仅构建扩展时运行：

```powershell
npm run build
```

生成发布包：

```powershell
npm run package
```

发布 ZIP 会从 `build/extension` 生成到 `dist/danmaku-echo-v<version>.zip`。

每次推送和 Pull Request 都会通过 GitHub Actions 分别在 Windows 与 Fedora 44 中执行全量检查和打包。成功运行后可从该次 Actions 任务下载两套 ZIP 构建产物；它们保留 7 天，仅用于验证两种系统上的发布流程一致。

### 项目结构

```text
public/manifest.json          Manifest V3 清单，由 Vite publicDir 原样复制
index.html                    create-vue 标准 HTML 入口，同时作为扩展设置页
src/core/                     跨平台共享类型、文本处理和设置合并
src/entries/                  五个 Vite 构建入口及通用三平台装配根 content-app.ts
src/features/favorites/       本地收藏仓库、房间识别、排序、Vue 面板与轮盘运行时
src/features/repeat-reminder/ 轻量高频文字计数、跨来源去重和 Shadow DOM +1 提示
src/platforms/live/           三个平台共享的候选、编辑、悬停、发送和运行时控制器
src/platforms/bilibili/       Bilibili 候选、富表情、发送及运动适配
src/platforms/douyu/          斗鱼候选、原生悬停边界、富表情和发送适配
src/platforms/huya/           虎牙候选、富表情和发送适配
src/platforms/douyin/         抖音公共协议/模型，以及 content 隔离世界与 page MAIN world 实现
src/App.vue、src/main.ts      create-vue 标准 Vue 3 设置页与应用入口
src/assets/                   图标、平台 SVG 及直播间收藏 Shadow DOM 样式
src/components/               设置页组件及 components/live 直播浮层组件
src/composables/              设置读取、同步保存和页面状态
docs/ARCHITECTURE.md          当前模块边界、数据流和运行时架构
docs/PERFORMANCE_OPTIMIZATION.md 性能现状、优化优先级、基线与验收计划
docs/PERFORMANCE_RESULTS.md      性能优化实施、实测对照与验证范围
docs/ENTRY_RUNTIME_ARCHITECTURE.md 内容脚本入口、跨世界协议与生命周期说明
docs/ENTRY_REFACTOR_CHECKLIST.md   内容脚本入口拆分与类型化的分步实施清单
docs/ENTRY_REFACTOR_REGRESSION.md  入口重构的浏览器与真实直播间回归记录
tests/contracts/              Node 契约、构建产物和架构边界校验
tests/fixtures/               四个平台的脱敏 DOM 与页面测试夹具
tests/browser/                本地可选浏览器 E2E（不进入 CI）
.github/workflows/ci.yml      Windows 与 Fedora 持续集成工作流
scripts/package.cjs           跨 Windows、Linux 的确定性 Node.js 发布打包器
vite.config.ts                官方 Vite CLI 的多入口扩展构建配置
vitest.config.ts              Vitest 单元测试和分域覆盖率门禁
build/extension/              可加载、可发布的生成产物（不提交）
```

### 隐私与权限

- 申请 `storage` 权限保存扩展设置、本地弹幕收藏和脱敏运行日志；设置使用 `chrome.storage.sync`，收藏及日志使用 `chrome.storage.local` 且不会自动上传。
- 申请 `scripting` 权限用于抖音首次进房和 SPA 进房时补注入直播运行时、执行 B 站房间图片表情一次性后备发送，以及在用户主动发送时短暂观察当前平台的原生发送结果。
- 主机权限仅覆盖四个受支持直播站点。虎牙、斗鱼的雷达规模信号直接读取当前页面已经显示的贵宾数，不请求房间热度接口。一次性发送观察器最多运行 8 秒，只输出请求方法、去除查询参数后的接口路径、HTTP 状态、平台业务码和官方错误文案；不会输出请求体、Cookie、CSRF、签名或请求头。
- 完整功能脚本仅在虎牙直播、哔哩哔哩直播、抖音直播和斗鱼直播页面启用。
- 不读取密码，也不存储或传出 Cookie/登录令牌。B 站房间图片表情后备发送只在当前页面内临时读取 CSRF Cookie，并调用与官方网页相同的直播弹幕接口；其他发送仍走平台官方编辑器。
- 高频 +1 提醒仅在当前直播页内存中计数，不持久化弹幕内容，也不发送任何弹幕或分析数据；观众或贵宾规模信号只读取直播页现有公开节点。
- 不收集、出售或用于广告、画像的数据。

### 兼容性说明

直播平台会持续调整页面结构，本项目通过平台选择器、语义探测和开放 Shadow DOM 探测提高兼容性，但站点大改版后仍可能需要更新。扩展不能绕过登录、禁言、会员/粉丝限制、验证码、平台限流或官方弹幕长度限制。

### 开源协议

本项目使用 [MIT License](LICENSE) 发布。你可以自由使用、复制、修改、合并、发布、分发、再许可或销售本项目及其副本；分发时须保留版权声明和许可声明。

Copyright © 2026 sadUnicorn.

### 参与贡献

欢迎提交 Issue 和 Pull Request。请在提交前运行 `npm run check`，并在涉及平台页面结构时说明测试平台、直播模式和浏览器版本。

### 免责声明

本项目与虎牙、哔哩哔哩、抖音、斗鱼及其关联公司无关。请遵守各平台服务条款和社区规则，避免高频复读或骚扰行为。软件按“原样”提供，不附带任何保证。

---

## English

### Overview

Danmaku Echo is a Manifest V3 browser extension for Chrome and Edge. It adds quick actions to live-chat and on-video danmaku and can prompt a direct +1 when the same text message repeats frequently.

### Supported platforms

| Platform | Side chat | On-video danmaku | Frequent +1 reminder | Fullscreen |
| --- | --- | --- | --- | --- |
| Huya Live | ✅ | ✅ | ✅ | ✅ |
| Bilibili Live | ✅ | ✅ | ✅ | ✅ |
| Douyin Live | ✅ | ✅ (DOM takeover) | ✅ (Canvas queue + chat) | ✅ |
| Douyu Live | ✅ | ✅ | ✅ | ✅ |

### Favorites and quick actions

Favorites stay in `chrome.storage.local`; they are neither uploaded nor synchronized between devices. Equal normalized text is stored once globally while retaining its platform and room origins. Favorites can be pinned per room, labeled with searchable tags, and arranged in a persistent **Wheel order**. Import and export validate incoming data and retain a redundant local recovery copy. The launcher focuses the current room by default; **Other rooms** and **All** first show a room list, then open a separate message picker after a room is selected.

All recognizable messages can be favorited, including plain text, Unicode emoji, platform image emotes, and mixed text/emote content. Rich favorites preserve their display text, content order, and platform resource identity while remaining compatible with legacy plain-text data.

Short-press `Alt + Q` in a live room to open the fixed panel, where search, send-count/collection-time/**Wheel order** sorting, number keys `1–9` for the current message page, add-to-room, and delete are available. In **Wheel order**, drag the handle or use the move buttons to persistently reorder favorites. Hold `Alt + Q` to open a cursor-centered radial menu containing the first six current-room favorites in that order; releasing sends the selected favorite, while **Other favorites** and **More** open the corresponding room list. In native fullscreen the launcher mounts inside `document.fullscreenElement`.

### Lightweight danmaku radar

When enabled, the radar icon tracks repeated text messages from the last minute and shows a **Dismiss / +1** prompt when they reach the configured threshold. Image emotes are excluded. A short guide appears on first use.

Choose automatic or manual thresholds for each platform, and set the prompt duration, queue limit, and size. Dismissing a prompt or using +1 temporarily silences that message. You can also enable **Automatic +1** to send qualifying messages through the platform's send flow; this option is off by default. Turning the radar off stops counting and hides its icon and prompts.

### Capsule and radar size

General settings provides independent Automatic and Manual interface sizing. Automatic sizing uses **3860×2160** as its reference and estimates display pixels from screen dimensions multiplied by devicePixelRatio. It applies the smaller width/height ratio to the saved capsule or platform prompt percentage, rounding and clamping the result to 50%–200%. A 100% base stays unchanged on the reference screen; a 1920×1080 screen at pixel ratio 1 uses approximately 50%. Browser zoom affects the pixel ratio; resize and focus changes recalculate the size. Invalid screen metrics fall back to the saved base size.

Manual sizing is the default and preserves existing settings on upgrade. Interface sizing, automatic radar thresholds, and Automatic +1 are independent controls. Automatic thresholds leave duration, queue limit, and prompt size editable.

### Douyin live rooms

Use +1, Reply, and Favorite on supported side-chat messages and on-video danmaku. First entry and in-site room changes work without a manual refresh.

### Features

- Use +1, Reply, Favorite, and Copy on supported side-chat messages and on-video danmaku across all four platforms.
- +1 sends the same danmaku with repeated-click, concurrent-send, and three-second same-message cooldown protection. Native platform feedback is shown for rate limits, duplicates, and mutes when available.
- Reply fills in `@sender ` and focuses the official editor. The user decides what to add and when to send.
- Favorites support text, emoji, platform image emotes, and mixed content; browse them across rooms, search, tag, and sort them.
- Short-press `Alt + Q` to open the favorites panel or hold it to open the radial menu. Number keys can also send favorites.
- The danmaku radar counts repeated text from the last minute. Configure its threshold, display time, and queue size, and optionally enable automatic +1.
- Enable action buttons per platform, show or hide each action, and switch the settings interface between Chinese and English. Danmaku actions work in web and native fullscreen.
- Douyin settings include separate switches for gift messages, lucky-bag phrases, and blocking gift effects.
- Send statistics record the successful send time to the second, platform, room, and plain-text content. View, filter, and export them in Settings.

### Installation

For the recommended installation and automatic updates, install the extension from its official store listing: [Danmaku Echo on the Chrome Web Store](https://chromewebstore.google.com/detail/ndhdmieaeklfmfjjkpoiklhibmnjnmkp?utm_source=item-share-cb) or [Danmaku Echo on Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/%E5%BC%B9%E5%B9%95%E5%9B%9E%E5%A3%B0-danmaku-echo/nbpefkbpbcnkeelaamjnfdeiplnghodl). If you cannot access the stores, use the GitHub Release instructions below.

#### From a release

1. Download a ZIP from GitHub Releases and extract it to a permanent directory.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable Developer mode.
4. Choose **Load unpacked** and select the extracted directory.
5. Refresh any live-room tabs that were already open.

> Developer mode cannot load the ZIP directly. Extract it first.

#### From source

Clone the repository, install the development dependencies, build it, then load `build/extension` as an unpacked extension:

```powershell
npm install
npm run build
```

`build/extension` is the only directory intended to be loaded as an unpacked extension. The repository root contains source code, tests, and build configuration.

### Usage

1. Open a live room on a supported platform and hover a side-chat message or on-video danmaku.
2. Choose **+1**, **Reply**, **Favorite**, or **Copy** from the action buttons. Reply fills in `@sender ` and focuses the editor without sending; Copy can be enabled in Settings.
3. Short-press `Alt + Q` to open favorites, or hold it to open the radial menu. Use number keys `1–9` to send favorites from the panel.
4. Use the toolbar popup to enable the extension and individual platforms. Open Settings to configure actions, the danmaku radar, and other options; switch the settings language between Chinese and English there.

You can also hold `Alt` and click a recognized danmaku for a quick +1. This shortcut is enabled by default and can be turned off in General settings.

### Runtime logs and troubleshooting

Runtime logging is enabled in installed builds and packages. After reproducing a problem, export JSON from **General settings → Runtime logs** and include the time, platform, browser version, and reproduction steps in your issue. Local storage keeps up to 500 records and about 1 MB; reads and writes prune records older than seven days. Clearing logs preserves favorites and settings.

Logs retain sanitized error messages, stack traces, extension version, screen/window metrics, and structural context. Bilibili room-emote fallback failures include a shared attemptId, request stages, and response metadata. Logs are not uploaded automatically and do not capture npm build/package terminal output. Failed sends can also include sanitized DOM HTML fragments, request timing, parameter structure and response states, without raw content, parameter values or credentials. See the [troubleshooting guide](docs/TROUBLESHOOTING.md) for scope and diagnostic fields.

### Development and verification

Node.js 22.22.2 is recommended and pinned in CI. The project requires Node.js 22.22.2+, or 24.15+.

Start the Vue settings-page development preview with:

```powershell
npm run dev
```

```powershell
npm run check
```

This runs type and lint checks, all builds, manifest and architecture validation, unit tests with coverage gates, and contract regressions. See the [release checklist](docs/RELEASE_CHECKLIST.md) for version synchronization and submission checks.

Browser E2E remains a local optional suite (`npm run test:browser`) and is not run by regular or release CI. Live-message collection changes should still be manually regressed on normal and web-fullscreen pages for all four platforms.

To build the extension only:

```powershell
npm run build
```

Create a release archive with:

```powershell
npm run package
```

The archive is built from `build/extension` and written to `dist/danmaku-echo-v<version>.zip`.

Every push and pull request runs the complete check and packaging flow on both Windows and Fedora 44 through GitHub Actions. A successful run exposes ZIP artifacts from both environments for seven days so that cross-platform release behavior can be compared.

### Project layout

```text
public/manifest.json          Manifest V3 definition copied by Vite publicDir
index.html                    Standard create-vue HTML entry and extension settings page
src/core/                     Cross-platform types, text processing, and settings
src/entries/                  Five Vite entries plus the shared three-platform content-app composition root
src/features/favorites/       Local repository, room identity, ranking, Vue panel, and radial runtime
src/features/repeat-reminder/ Lightweight frequency counting, source deduplication, and Shadow DOM +1 prompt
src/platforms/live/           Shared candidate, editor, hover, sending, and runtime controllers
src/platforms/bilibili/       Bilibili candidates, rich emoji, sending, and motion adapters
src/platforms/douyu/          Douyu candidates, native-hover boundary, rich emoji, and sending adapters
src/platforms/huya/           Huya candidates, rich emoji, and sending adapters
src/platforms/douyin/         Shared protocol/models plus isolated-world content and MAIN-world page implementations
src/App.vue, src/main.ts      Standard create-vue Vue 3 settings app and entry
src/assets/                   Icons, platform SVGs, and live-room favorites Shadow DOM style
src/components/               Settings components and components/live overlays
src/composables/              Settings loading, sync persistence, and page state
docs/ARCHITECTURE.md          Current module boundaries, data flow, and runtime architecture
docs/PERFORMANCE_OPTIMIZATION.md Performance audit, priorities, baseline and validation plan (Chinese)
docs/PERFORMANCE_RESULTS.md      Implemented optimizations, measurements and validation scope (Chinese)
docs/ENTRY_RUNTIME_ARCHITECTURE.md Content-entry, cross-world protocol, and lifecycle guide
docs/ENTRY_REFACTOR_CHECKLIST.md   Step-by-step content-entry refactoring and typing checklist
docs/ENTRY_REFACTOR_REGRESSION.md  Browser and real-room regression record for the entry refactor
tests/contracts/              Node contracts plus build-output and architecture validators
tests/fixtures/               Sanitized DOM and page fixtures for all four platforms
tests/browser/                Optional local browser E2E, intentionally excluded from CI
.github/workflows/ci.yml      Windows and Fedora continuous-integration workflow
scripts/package.cjs           Deterministic Node.js packaging across Windows and Linux
vite.config.ts                Multi-entry extension config driven by the official Vite CLI
vitest.config.ts              Vitest unit-test and domain coverage gates
build/extension/              Loadable, releasable build output (not committed)
```

### Privacy and permissions

- Requests `storage` for synchronized settings, local favorites, and sanitized runtime logs. Favorites use `chrome.storage.local` and are never uploaded.
- Requests `scripting` to recover the Douyin runtime, run the one-shot Bilibili room-image fallback, and briefly observe a native send result after a user-initiated send.
- Host access is limited to the four supported live sites. Huya and Douyu radar scaling reads the guest count already displayed on the current page and does not call a popularity endpoint. The one-shot send observer runs for at most eight seconds and exposes only the method, endpoint without query parameters, HTTP status, platform code, and native error text. It never exposes request bodies, headers, cookies, CSRF values, or signatures.
- Activates complete feature scripts only on Huya Live, Bilibili Live, Douyin Live, and Douyu Live pages.
- Does not read passwords or store or export cookies/login tokens. The Bilibili room-image fallback temporarily reads the CSRF cookie inside the current page to call the same send endpoint as the official website.
- The frequent +1 reminder counts only in page memory, does not persist danmaku content, and sends no analysis data.
- Does not collect, sell, or use data for advertising or profiling.

### Compatibility

Live platforms regularly change their markup. The extension combines platform selectors, semantic detection, and open Shadow DOM traversal, but major site updates may still require adapter changes. It cannot bypass login, moderation, membership, CAPTCHA, rate, or official message-length restrictions.

### License

Released under the [MIT License](LICENSE). You may use, copy, modify, merge, publish, distribute, sublicense, and sell copies of the project, provided that the copyright and permission notices are included with distributed copies.

Copyright © 2026 sadUnicorn.

### Contributing

Issues and pull requests are welcome. Run `npm run check` before submitting changes. For platform adapter changes, include the tested platform, live-room mode, and browser version.

### Disclaimer

This project is not affiliated with Huya, Bilibili, Douyin, Douyu, or their respective companies. Follow each platform's terms and community rules, and avoid abusive or high-frequency echoing. The software is provided “as is”, without warranty.

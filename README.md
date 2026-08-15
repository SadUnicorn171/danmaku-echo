# Danmaku Echo / 弹幕回声

<p align="center">
  <img src="public/assets/danmaku-echo-icon.png" width="180" alt="Danmaku Echo icon">
</p>

> 为虎牙直播、哔哩哔哩直播、抖音直播和斗鱼直播提供弹幕 `+1`、回复、复制与本地收藏。
> Danmaku echoing, replies, copying, and local favorites for Huya, Bilibili, Douyin, and Douyu Live.

[中文](#中文) · [English](#english) · [隐私权政策](PRIVACY.md)

![Version](https://img.shields.io/badge/version-2.3.0-orange)
![Manifest](https://img.shields.io/badge/Chrome-Manifest%20V3-blue)
![License](https://img.shields.io/badge/license-GPL--3.0--or--later-green)
[![CI](https://github.com/SadUnicorn171/danmaku-echo/actions/workflows/ci.yml/badge.svg)](https://github.com/SadUnicorn171/danmaku-echo/actions/workflows/ci.yml)

## 中文

### 项目简介

Danmaku Echo（弹幕回声）是一个适用于 Chrome 和 Edge 的 Manifest V3 浏览器扩展。它会为直播间右侧聊天区和视频画面上的滚动弹幕添加 `+1` 按钮，让你可以像使用斗鱼弹幕 `+1` 一样，一键复读当前弹幕。

### 支持平台

| 平台 | 右侧聊天区 | 视频弹幕 | 全屏模式 |
| --- | --- | --- | --- |
| 虎牙直播 | ✅ | ✅ | ✅ |
| 哔哩哔哩直播 | ✅ | ✅ | ✅ |
| 抖音直播 | ✅ | ✅（DOM 接管） | ✅ |
| 斗鱼直播 | ✅ | ✅ | ✅ |

### 弹幕收藏

收藏只保存在 `chrome.storage.local`，不会上传或跨设备同步；相同内容在全局只保留一份，但会记录它来自哪些平台和直播间。打开收藏时默认聚焦本房内容；“其他直播间”和“全部”先显示直播间列表，点击任意直播间后进入独立的弹幕选择页，再发送或加入当前房间。

所有可识别弹幕都可以收藏，包括普通文字、Unicode Emoji、平台图片表情以及文字与表情混排。富弹幕会同时保存显示文字、内容顺序和平台资源识别信息；同样显示为“图片表情”的不同资源不会被错误合并，旧版纯文字收藏会自动兼容。发送富弹幕时优先使用当前平台的官方输入框与表情面板，能否发送取决于当前平台和账号是否仍可使用对应资源；B 站房间图片表情在面板无法唯一定位时，会校验资源所属真实房间并通过当前 B 站页面的官方弹幕接口后备发送。

在直播间短按 `Alt + Q` 会打开固定收藏面板，可置顶收藏、添加可搜索标签，并按发送次数、收藏时间或“轮盘顺序”排列。选择“轮盘顺序”后，可拖动左侧手柄或使用上下按钮持久调整本房顺序；长按 `Alt + Q` 打开的快捷轮盘会读取这一顺序并展示前 6 条弹幕。数字键 `1–9` 可发送当前页弹幕；轮盘可直接指向并松开发送，“其他收藏”和“更多”会进入对应列表。原生全屏时界面会挂载到 `document.fullscreenElement` 内，因此全屏状态也可操作。

### 抖音 DOM 接管说明

此版本为抖音视频弹幕启用独立的安全 DOM 接管。扩展旁路读取官方 Worker 已解码的 `addBarrage` 数据，保留原消息投递和原生 Worker，然后按同一弹道模型渲染可交互的真实 DOM 弹幕；不拦截 WebSocket、不解析私有协议，也不复制 Canvas 像素。

每条 DOM 弹幕拥有独立状态。鼠标进入时只冻结当前条目的可视位置；`+1` 发送成功或鼠标移出后，会从悬停位置按原速度继续移动，不再快速追赶后台轨迹，因此不会产生弹射感。操作胶囊不会覆盖弹幕正文：弹幕尚未完全进入画面或右侧空间不足时显示在左侧，只有完整进入且空间充足后才显示在右侧。

抖音主站会从普通页面通过 SPA 无刷新进入直播间，因此扩展在 `www.douyin.com/*` 仅常驻一个轻量 URL 启动器；路由进入 `/follow/live/*` 时才补注入页面钩子、设置通道和样式。直接打开 `live.douyin.com/*` 仍从 `document_start` 启动。若钩子较晚才认领到现有 Canvas，则会等待官方 `clear` 后的新弹幕或安全过期窗口，避免隐藏尚未同步的原生内容。

只有当首批 DOM 节点已经连接时，扩展才使用 `visibility: hidden` 隐藏原生 Canvas；Worker 继续在后台运行。设置关闭、心跳超时、渲染异常、Canvas 移除、切房、停止或销毁实例时会立即恢复 Canvas。抖音右侧聊天区仍使用独立的 DOM 消息适配与官方发送流程。

### 核心功能

- 鼠标悬停弹幕时显示 `+1` 按钮，点击后自动发送相同内容。
- 点击“回复”会自动填入 `@发送者 `，聚焦官方输入框并等待用户继续输入，不会自动发送。
- 点击“收藏”会把文字、Unicode Emoji、平台图片表情和混排内容完整保存到浏览器本地，不会把图片表情降级成替代文字。
- 可在设置中独立显示或隐藏 `+1`、回复、收藏和复制；复制默认关闭，其余三项默认开启，并始终至少保留一个胶囊操作。
- `+1` 发送具有冷却、重复点击和并发保护；平台返回发言频率、重复发送、禁言等限制时，会优先显示对应官方反馈，而不是统一提示“发送失败”。
- B 站房间图片表情优先点击官方表情面板；若面板无法唯一定位且弹幕带有可信的 `room_<房间>_<资源>` 标识，则在确认资源所属房间与当前直播间一致后使用直发后备路径。
- 收藏跨直播间可用且本房优先；收藏页支持拖拽设置持久化的“轮盘顺序”，快捷轮盘取本房该顺序的前 6 条，短按 `Alt + Q` 打开列表、长按呼出轮盘，全屏模式同样可用。
- 回复会按显示模式选择输入面：普通模式写入侧边聊天框，全屏模式优先写入播放器快捷回复栏。
- 四个平台的弹幕正文、间隔和操作胶囊组成连续悬停区域；鼠标穿过两者之间的空隙不会让弹幕短暂恢复移动。
- 虎牙、哔哩哔哩与斗鱼的视频弹幕悬停后暂停，完全移出连续操作区域后从原位置继续移动。
- 斗鱼播放器自带的 `+1`、回复与收藏胶囊默认关闭，可在“原生胶囊”设置页中恢复显示。
- 抖音视频弹幕由安全 DOM 层连续渲染，单条悬停暂停并从原位原速续行；胶囊根据弹幕进入状态和可用空间显示在左侧或右侧。
- 四个平台的视频弹幕胶囊使用一致的按钮和分隔线宽度，并在弹幕尚未完全进入或右侧空间不足时切换到左侧，避免遮挡正文。
- 避免相邻或重叠的后续弹幕抢占当前选择。
- 过滤清晰度、设置菜单等播放器控件，只识别真实弹幕。
- 支持文字、Emoji 和最长 1000 个 Unicode 字符的弹幕识别；实际发送长度仍受平台规则限制。
- 抖音 DOM 弹幕会根据官方数据还原文字、描边、颜色与表情，并将表情映射回官方发送文本。
- 支持抖音首次进入直播间、SPA 切房和 Worker/OffscreenCanvas 弹幕，无需二次刷新页面。
- 自动适配原生全屏，并在发送后释放官方输入框焦点。
- 提供 `Alt + 单击` 通用回退操作，应对直播站点类名调整。
- 可分别为虎牙、哔哩哔哩、抖音和斗鱼设置 `+1` 按钮、选中高亮、提示浮层及状态颜色；留空时使用内置默认值。
- 设置通过 `chrome.storage.sync` 保存，不读取账号凭据。

### 安装

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

1. 登录受支持平台并进入直播间。
2. 将鼠标移到右侧聊天消息或视频画面弹幕上。
3. 点击出现的 `+1` 按钮。
4. 扩展会写入官方输入框并触发官方发送流程。B 站房间图片表情仅在官方面板定位失败且唯一资源标识与当前真实房间一致时使用接口后备发送。

如需回复，点击同一操作条中的“回复”；扩展会填入 `@发送者 ` 并把光标放到官方输入框末尾，后续内容与发送动作由用户完成。
普通模式使用侧边聊天框；进入全屏后使用播放器内可见的快捷回复栏。

如需收藏，点击操作条中的“收藏”。短按 `Alt + Q` 打开本房收藏列表；“其他直播间”和“全部”会先显示直播间名称，点击任意直播间后进入它的弹幕选择页。列表支持搜索正文和标签、按发送次数/时间正序/时间倒序/轮盘顺序排序、置顶、编辑标签、数字键 `1–9` 快速发送、加入本房和删除。选择“轮盘顺序”后，可拖动左侧手柄重排，也可使用上移/下移按钮；新顺序会自动保存，并决定快捷轮盘展示的前 6 条。长按 `Alt + Q` 约 0.18 秒会在鼠标位置打开圆形轮盘，移动指针选择后松开即可发送，移回中心或按 `Esc` 取消。

四个平台的侧边聊天栏弹幕胶囊默认关闭，可在“聊天栏胶囊”设置页中分别启用。胶囊可包含 `+1`、回复、收藏和复制；四项可在设置中独立开关，复制默认关闭，且最少保留一项。该设置只影响侧边聊天消息，视频画面弹幕仍由全局功能开关控制。

视频弹幕胶囊会自动选择左右位置：弹幕尚未完全进入直播画面，或右侧放不下完整胶囊时，胶囊显示在弹幕左侧；只有弹幕完整进入且右侧空间充足时才显示在右侧。弹幕、两者之间的透明间隔和胶囊属于同一个连续悬停区域，移动鼠标操作按钮时不会发生短暂续行或位置跳动。

斗鱼播放器原生的 `+1`、回复和收藏胶囊也默认关闭，并有独立开关；开启后可能与扩展提供的视频弹幕快捷操作同时显示。

点击浏览器工具栏中的扩展图标，可以总开关扩展、分别启用平台以及开关 `Alt + 单击` 回退功能。

抖音调试：在直播页按 `Ctrl + Alt + D`，扩展会把启动链路、Canvas 实例、DOM 接管状态、活动节点数、回退原因和最近事件输出到开发者工具控制台。日志前缀为 `[Danmaku Echo]`。

### 开发与验证

建议使用 Node.js 22.22.2（CI 固定版本）；项目要求 Node.js 22.22.2+，或 24.15+。

启动 Vue 设置页开发预览：

```powershell
npm run dev
```

```powershell
npm run check
```

该命令会进行 TypeScript 类型检查、使用 Vite 构建 `build/extension`、验证构建产物中的 Manifest，并运行语法与单元测试。

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
public/manifest.json       Manifest V3 清单，由 Vite publicDir 原样复制
index.html                 create-vue 标准 HTML 入口，同时作为扩展设置页
src/core/                  跨平台共享类型、文本清洗和设置合并
src/entries/               后台、内容脚本和页面 Hook 的 Vite 构建入口
src/features/favorites/    本地收藏仓库、房间识别、排序、Vue 面板与轮盘运行时
src/platforms/live/        通用直播平台配置
src/platforms/bilibili/    哔哩哔哩 DOM 选择器与平台适配配置
src/platforms/douyin/      抖音协议、弹幕轨迹、富文本和消息模型
src/App.vue、src/main.ts   create-vue 标准 Vue 3 设置页与应用入口
src/assets/                图标、平台 SVG 及直播间收藏 Shadow DOM 样式
src/components/            设置页组件及 components/live 直播浮层组件
src/composables/           设置读取、同步保存和页面状态
docs/DESIGN_SYSTEM.md      当前界面的设计规范
.github/workflows/ci.yml   Windows 与 Fedora 持续集成工作流
scripts/package.cjs        跨 Windows、Linux 的确定性 Node.js 发布打包器
vite.config.ts             官方 Vite CLI 的多入口扩展构建配置
vitest.config.ts           create-vue 标准 Vitest 单元测试配置
build/extension/           可加载、可发布的生成产物（不提交）
tests/                     清单校验、单元测试和浏览器测试夹具
```

### 隐私与权限

- 申请 `storage` 权限保存扩展设置及本地弹幕收藏；设置使用 `chrome.storage.sync`，收藏使用 `chrome.storage.local` 且不会上传。
- 申请 `scripting` 权限用于抖音首次进房和 SPA 进房时补注入直播运行时，也用于在用户主动发送 B 站房间图片表情且官方面板定位失败时，在当前 B 站标签页中执行一次性后备发送函数。
- B 站主机权限仅覆盖 `live.bilibili.com/*`，用于既有弹幕识别以及官方面板定位失败后的房间图片表情一次性后备发送；抖音主机权限覆盖 `live.douyin.com/*` 与 `www.douyin.com/*`，普通抖音页面只运行不读取页面内容的轻量 URL 启动器。
- 完整功能脚本仅在虎牙直播、哔哩哔哩直播、抖音直播和斗鱼直播页面启用。
- 不读取密码，也不存储或传出 Cookie/登录令牌。B 站房间图片表情后备发送只在当前页面内临时读取 CSRF Cookie，并调用与官方网页相同的直播弹幕接口；其他发送仍走平台官方编辑器。
- 不收集、上传或出售用户数据。

### 兼容性说明

直播平台会持续调整页面结构，本项目通过平台选择器、语义探测和开放 Shadow DOM 探测提高兼容性，但站点大改版后仍可能需要更新。扩展不能绕过登录、禁言、会员/粉丝限制、验证码、平台限流或官方弹幕长度限制。

### 开源协议

本项目使用 [GNU General Public License v3.0 or later](LICENSE) 发布。

Copyright © 2026 sadUnicorn.

这是一份强著佐权许可证：如果你公开发布、分发或提供本项目的修改版、移植版或其他衍生作品，必须继续使用 GPL-3.0-or-later，并向接收者提供完整的对应源代码和许可证文本。GPL 不要求未向他人分发的私人修改必须公开。

### 参与贡献

欢迎提交 Issue 和 Pull Request。请在提交前运行 `npm run check`，并在涉及平台页面结构时说明测试平台、直播模式和浏览器版本。

### 免责声明

本项目与虎牙、哔哩哔哩、抖音、斗鱼及其关联公司无关。请遵守各平台服务条款和社区规则，避免高频复读或骚扰行为。软件按“原样”提供，不附带任何保证。

---

## English

### Overview

Danmaku Echo is a Manifest V3 browser extension for Chrome and Edge. It adds a `+1` button to live-chat messages and on-video scrolling danmaku, providing a one-click echo experience similar to Douyu's native danmaku `+1` feature.

### Supported platforms

| Platform | Side chat | On-video danmaku | Fullscreen |
| --- | --- | --- | --- |
| Huya Live | ✅ | ✅ | ✅ |
| Bilibili Live | ✅ | ✅ | ✅ |
| Douyin Live | ✅ | ✅ (DOM takeover) | ✅ |
| Douyu Live | ✅ | ✅ | ✅ |

### Favorites and quick actions

Favorites stay in `chrome.storage.local`; they are neither uploaded nor synchronized between devices. Equal normalized text is stored once globally while retaining its platform and room origins. Favorites can be pinned per room, labeled with searchable tags, and arranged in a persistent **Wheel order**. Import and export validate incoming data and retain a redundant local recovery copy. The launcher focuses the current room by default; **Other rooms** and **All** first show a room list, then open a separate message picker after a room is selected.

All recognizable messages can be favorited, including plain text, Unicode emoji, platform image emotes, and mixed text/emote content. Rich favorites preserve their display text, content order, and platform resource identity while remaining compatible with legacy plain-text data.

Short-press `Alt + Q` in a live room to open the fixed panel, where search, send-count/collection-time/**Wheel order** sorting, number keys `1–9` for the current message page, add-to-room, and delete are available. In **Wheel order**, drag the handle or use the move buttons to persistently reorder favorites. Hold `Alt + Q` to open a cursor-centered radial menu containing the first six current-room favorites in that order; releasing sends the selected favorite, while **Other favorites** and **More** open the corresponding room list. In native fullscreen the launcher mounts inside `document.fullscreenElement`.

### Douyin DOM takeover

This release introduces a dedicated safe DOM takeover for Douyin's on-video danmaku. The extension observes already-decoded `addBarrage` instructions sent to the official Worker, preserves their original delivery and the native Worker, and renders interactive DOM danmaku from the same lane model. It does not intercept WebSockets, decode private protocols, or copy Canvas pixels.

Every DOM barrage has independent interaction state. Hover freezes only that node's visible position. After a successful `+1` or pointer leave, it resumes from the held position at its original speed instead of rapidly catching up to the background trajectory, eliminating the slingshot effect. The action capsule never covers the message: it stays on the left while the barrage is entering or lacks right-side space, and moves to the right only after the message is fully visible and the complete capsule fits.

Douyin can enter a live room from an ordinary page through SPA navigation, so only a lightweight URL bootstrap stays on `www.douyin.com/*`; it injects the page hook, settings channel, and styles when the route enters `/follow/live/*`. Direct `live.douyin.com/*` loads still start at `document_start`. If a late hook recovers an existing Canvas, takeover waits for an official `clear` plus new barrages or a safe expiry window so unsynchronized native content is never hidden.

The native Canvas is hidden with `visibility: hidden` only after the first DOM nodes are connected, while the Worker keeps running in the background. Disabling settings, a heartbeat timeout, renderer failure, Canvas removal, room navigation, stop, or destroy restores the Canvas immediately. Douyin's side chat keeps its separate DOM-message adapter and official send path.

### Features

- Shows a `+1` action when a danmaku is hovered and sends the same content automatically.
- The Reply action inserts `@sender `, focuses the official editor, and waits for user input without sending automatically.
- The Favorite action stores plain text, Unicode emoji, platform image emotes, and mixed content locally.
- +1 sending includes cooldown, repeated-click, and concurrent-send protection. Official rate-limit, duplicate-message, moderation, and similar platform feedback is surfaced instead of being collapsed into a generic failure.
- Favorites work across rooms with current-room priority; the panel provides a persistent draggable **Wheel order**, and the radial menu uses its first six current-room entries. Short-press `Alt + Q` for the panel or hold it for the radial menu, including in fullscreen.
- Reply targets the side-chat editor in normal mode and the visible in-player quick editor in fullscreen mode.
- Treats the barrage, the visual gap, and its capsule as one continuous hover target on all four platforms, so crossing the gap never briefly resumes movement.
- Pauses Huya, Bilibili, and Douyu on-video danmaku on hover, then resumes it from the held position only after the pointer leaves the complete interaction region.
- Keeps Douyu's native **+1**, **Reply**, and **Favorite** capsule off by default, with an independent switch under the Native capsule settings page.
- Continuously renders Douyin danmaku in a safe DOM layer with per-item hover pause, same-speed resume from the held position, and a correctly bound left-or-right action capsule.
- Uses equal action and divider widths on every platform and moves the capsule to the left while a barrage is entering or cannot fit the complete capsule on its right, preventing message overlap.
- Keeps adjacent or overlapping danmaku from stealing the current selection.
- Rejects player controls such as quality and settings menus.
- Recognizes text, emoji, and messages up to 1,000 Unicode characters; the platform's own sending limit still applies.
- Reconstructs Douyin text, outlines, colors, and emoji from official danmaku data and maps emoji back to official send tokens.
- Supports first room entry, SPA room changes, and Worker/OffscreenCanvas danmaku on Douyin without a second refresh.
- Supports native fullscreen and releases official editor focus after sending.
- Includes an `Alt + click` fallback for future site markup changes.
- Provides independent Huya, Bilibili, Douyin, and Douyu colors for the `+1` action, selection highlight, overlays, and status feedback; blank values keep the built-in defaults.
- Stores settings with `chrome.storage.sync` and never reads account credentials.

### Installation

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

1. Sign in to a supported platform and open a live room.
2. Hover a side-chat message or an on-video danmaku.
3. Click the displayed `+1` button.
4. The extension fills the official editor and triggers the platform's official send flow.

Use the toolbar popup to enable or disable the extension, toggle individual platforms, and control the `Alt + click` fallback.

Click **Favorite** in a danmaku action bar to store it. Short-press `Alt + Q` for the current-room list; search, number-key sending, other-room browsing, add-to-room, deletion, and **Wheel order** editing are available there. Select **Wheel order**, then drag a handle or use the move buttons to persist the order; the radial menu displays its first six current-room entries. Hold `Alt + Q` for about 0.18 seconds to open the cursor-centered radial menu, point to an item, and release to send; move back to the center or press `Esc` to cancel.

The side-chat action capsule is disabled by default on all four platforms. Enable each platform independently under **Settings → Chat capsule**. The capsule can contain **+1**, **Reply**, **Favorite**, and **Copy**; each action is independently configurable, Copy defaults off, and at least one action remains enabled. These switches affect side-chat messages only, while on-video danmaku continues to follow the global action settings.

On-video capsules choose their side automatically. A capsule stays to the left while its barrage is still entering the player or when the full capsule cannot fit on the right; it moves right only after the barrage is fully visible and enough space is available. The barrage, gap, and capsule form one continuous hover region, preventing momentary resume or position jumps while moving to an action button.

For Douyin diagnostics, press `Ctrl + Alt + D` in a live room. Startup, Canvas instances, DOM-takeover state, active-node counts, fallback reasons, and recent events are written to DevTools with the `[Danmaku Echo]` prefix.

### Development and verification

Node.js 22.22.2 is recommended and pinned in CI. The project requires Node.js 22.22.2+, or 24.15+.

Start the Vue settings-page development preview with:

```powershell
npm run dev
```

```powershell
npm run check
```

This type-checks TypeScript, builds `build/extension` with Vite, validates the built manifest, and runs the syntax and unit tests.

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
public/manifest.json       Manifest V3 definition copied by Vite publicDir
index.html                 Standard create-vue HTML entry and extension settings page
src/core/                  Cross-platform types, text parsing, and settings
src/entries/               Vite entries for background, content scripts, and page hooks
src/features/favorites/    Local repository, room identity, ranking, Vue panel, and radial runtime
src/platforms/live/        Shared live-platform configuration
src/platforms/bilibili/    Bilibili DOM selectors and adapter configuration
src/platforms/douyin/      Douyin protocol, trajectory, rich-data, and message models
src/App.vue, src/main.ts   Standard create-vue Vue 3 settings app and entry
src/assets/                Icons, platform SVGs, and live-room favorites Shadow DOM style
src/components/            Settings components and components/live overlays
src/composables/           Settings loading, sync persistence, and page state
docs/DESIGN_SYSTEM.md      Current interface design specification
.github/workflows/ci.yml   Windows and Fedora continuous-integration workflow
scripts/package.cjs        Deterministic Node.js packaging across Windows and Linux
vite.config.ts             Multi-entry extension config driven by the official Vite CLI
vitest.config.ts           Standard create-vue Vitest unit-test configuration
build/extension/           Loadable, releasable build output (not committed)
tests/                     Manifest checks, unit tests, and browser fixtures
```

### Privacy and permissions

- Requests `storage` for synchronized settings and local favorites. Favorites use `chrome.storage.local` and are never uploaded.
- Requests `scripting` only to recover the Douyin live runtime on direct and SPA room entry.
- Bilibili host access is limited to `live.bilibili.com/*` for existing danmaku recognition and the one-shot room-image fallback after a failed panel lookup. Douyin host access covers `live.douyin.com/*` and `www.douyin.com/*`; ordinary Douyin pages run only a lightweight URL bootstrap.
- Activates complete feature scripts only on Huya Live, Bilibili Live, Douyin Live, and Douyu Live pages.
- Does not read cookies, passwords, or login tokens and does not call private live APIs.
- Does not collect, upload, or sell user data.

### Compatibility

Live platforms regularly change their markup. The extension combines platform selectors, semantic detection, and open Shadow DOM traversal, but major site updates may still require adapter changes. It cannot bypass login, moderation, membership, CAPTCHA, rate, or official message-length restrictions.

### License

Released under the [GNU General Public License v3.0 or later](LICENSE).

Copyright © 2026 sadUnicorn.

This is a strong copyleft license. If you publish, convey, or distribute a modified, ported, or otherwise derivative version, you must license the entire covered work under GPL-3.0-or-later and provide recipients with the complete corresponding source code and license text. Private modifications that are not conveyed to others do not have to be published under the GPL.

### Contributing

Issues and pull requests are welcome. Run `npm run check` before submitting changes. For platform adapter changes, include the tested platform, live-room mode, and browser version.

### Disclaimer

This project is not affiliated with Huya, Bilibili, Douyin, Douyu, or their respective companies. Follow each platform's terms and community rules, and avoid abusive or high-frequency echoing. The software is provided “as is”, without warranty.

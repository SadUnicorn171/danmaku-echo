# Changelog

All notable changes to Danmaku Echo are documented here.

## [Unreleased]

### Added

- Added a persistent **Wheel order** to the favorites page. Users can drag the dedicated handle to reorder danmaku, with move-up and move-down buttons retained for keyboard and precise operation.
- The quick favorites wheel now always uses the first six current-room favorites from **Wheel order**, so changes made in the favorites page are reflected the next time the wheel opens.

### Changed

- Renamed the user-facing “Fixed order”/“Custom order” terminology to **Wheel order** to make the relationship between the favorites list and quick wheel explicit.
- Replaced the wheel center text with a theme-colored animated bot that follows the pointer and reacts to favorite, other-room, and more selections.

## [2.3.0] - 2026-08-13

### Added

- Added shared send cooldown, accidental-repeat, and concurrent-send protection for +1 and favorite quick sends. Platform feedback probes now surface official rate-limit, duplicate-message, moderation, and account restriction messages instead of reducing every rejection to a generic send failure.
- Added an optional Copy action to common and Douyin DOM capsules. +1, Reply, Favorite, and Copy can be enabled independently while preserving at least one available action.
- Added room-aware favorite pinning, searchable tags, persistent wheel ordering, import/export validation, redundant local recovery, and a compact quick-send workflow.

### Changed

- Bilibili's ordinary bracket Emoji, such as `[大笑]`, now use the official editor's automatic text recognition instead of reopening the Emoji panel. Room, anchor, exclusive, unresolved, and other image Emoji retain the existing native-image send path.
- Bilibili room image Emoji now use a guarded dual path: the extension still prefers the official Emoji panel, but when no unique panel item can be located it can submit a verified `room_<room>_<resource>` identity through Bilibili's live-page request flow. The fallback requires the identity's real room to match the current room, generates a fresh WBI signature, and never stores or returns authentication material.
- Unified on-video capsule placement across Huya, Bilibili, Douyin, and Douyu. A capsule stays on the left while its barrage is entering or cannot fit completely on the right, then moves right only after the barrage is fully visible and enough space is available.
- Unified capsule geometry across platforms: every enabled action uses a 56 px segment and every divider uses 2 px. Douyu's nested native-hover capsule now resists inherited player transforms and high-specificity site flex rules without clipping inner actions.
- The barrage, the visual gap, and its action capsule now form one continuous hover target. Crossing the gap no longer briefly resumes the barrage before the pointer reaches an action button.
- Douyu video-danmaku hover now delegates pause and resume to the site's native controller while the extension supplies the selection frame and joined action surface. The native action capsule remains independently configurable and hidden by default.
- Douyin's safe DOM renderer now supports adaptive left/right capsule ordering without shifting message text or changing lane geometry.

### Fixed

- Fixed Douyu danmaku twitching, backward/forward corrections, small release offsets, duplicate hover systems, overlapping text, and transient native capsule decorations caused by competing animation ownership and incomplete native-capsule hiding.
- Fixed Douyu joined capsules becoming horizontally stretched, excessively wide, or internally clipped after being nested into transformed player elements.
- Fixed pointer transitions from a Douyu barrage into its capsule or the intervening gap resuming native motion. The complete barrage-gap-capsule subtree now remains one native hover body.
- Fixed Huya and Bilibili capsule fallback placement covering the selected message when the barrage had not fully entered or the right edge lacked space.
- Fixed official send-limit responses on Huya and Douyu being reported only as “send failed.”

### Verification

- Added Chrome and Edge browser coverage for normal and fullscreen Douyu hover motion, nested capsule width, site-level flex overrides, adaptive placement, and gap-hover continuity.
- Added cross-platform browser assertions that the gap remains hovered beyond the previous leave delay, plus unit coverage for left/right capsule placement.

## [2.2.8] - 2026-08-11

### Fixed

- Huya native image Emoji lookup now treats duplicate normal-player and fullscreen panel nodes with the same `data-id` or material id as one official resource, preventing valid items such as `[傲慢]` (`data-id="29"`) from being rejected as ambiguous.
- Huya player Emoji that expose only a generic label or an opaque renderer URL now recover their exact bracketed name from the matching recent side-chat resource before resolving and clicking the native Emoji panel item.

## [2.2.7] - 2026-08-10

### Fixed

- Fully visible and player-edge-clipped video danmaku now both show exactly one hover selection frame. Fully visible messages use the normal outside outline; clipped messages are explicitly marked and replace that outline with a single inset frame instead of drawing both styles together.

## [2.2.6] - 2026-08-10

### Fixed

- Huya, Bilibili, and Douyu video danmaku once again receive the themed selection frame automatically on hover. Player-edge clipping is now applied only when content actually crosses a player boundary, while clipped frozen messages use a matching inset frame so the selection remains visible without leaking into the side column.

## [2.2.5] - 2026-08-10

### Fixed

- Huya, Bilibili, and Douyu video-danmaku hover detection is now clipped to the visible player viewport. Invisible portions of a right-to-left danmaku DOM box can no longer be hovered from the adjacent chat or audience column; frozen snapshots are clipped at the player edge, the action capsule stays inside the video, and crossing the hard player boundary clears the overlay selection immediately.

### Performance

- The active player viewport is cached for the duration of an overlay hover and refreshed only for selection, scrolling, resizing, or fullscreen changes, avoiding repeated layout reads on every pointer event.

## [2.2.4] - 2026-08-10

### Fixed

- Douyu's detached `btnscontainerrect-*` triangle in `#comment-dzjy-container` is now hidden together with the native video-danmaku action panel. The hashed class is covered by both runtime remount detection and force-hidden CSS, preventing the black arrow from returning after Douyu rebuilds the portal.

## [2.2.3] - 2026-08-10

### Added

- Favorites can now be pinned per live room, labeled with up to eight searchable tags, and moved up or down in a persistent custom order. Existing schema-v2 favorites are upgraded in place without clearing local data.
- The danmaku capsule now has an optional Copy action that copies the complete message, including bracketed image-emoji names. +1, Reply, Favorite, and Copy can be switched independently; Copy defaults off and at least one action always remains enabled.

### Fixed

- Douyu's native video-danmaku action capsule is now removed as one complete surface: both `afterpic-*` and `afterDiv-*` tail decorations, their pseudo-elements, and every action-only wrapper between the buttons and the danmaku item are hidden and excluded from the frozen hover snapshot.
- Sender lookup now stops at the concrete chat-message row instead of walking into the whole chat list, preventing senderless messages from being incorrectly associated with the first visible user.

## [2.2.2] - 2026-08-07

### Fixed

- Huya and Douyu bracketed image Emoji such as `[开心]` can now be hovered in both side chat and the video overlay, resolve to one unique item in the platform's native Emoji panel, and are confirmed by an image echo; input clearing is no longer treated as success, so the extension neither downgrades them to literal text nor submits them twice.
- Bilibili mixed text/Emoji danmaku (e.g. `可惜可惜[dog][dog]`) now sends the full message instead of only the first Emoji. Mixed content always resolves to an ordered-text send: missing Emoji display names are recovered from the danmaku row's `data-danmaku` attribute, the matching side-chat image, or the native Emoji panel before falling back to the complete ordered text.
- Bilibili streamer-exclusive image Emoji no longer fail with "未在表情面板中找到对应Emoji": panel matching is restored to the verified unique-match behavior, and when the panel is unavailable a single bracketed-name payload falls back to sending `[表情名]`, which Bilibili's editor renders back into the image Emoji.
- Non-fullscreen Bilibili Emoji sends now behave like fullscreen: `enrichRichPayloadAssetNames` is applied to mixed content in every mode, so missing display names are resolved consistently.
- Favorited streamer-exclusive Emoji stay sendable when their panel pack is unavailable via the same bracketed-text fallback.

### Changed

- Platform enable rows in the settings page now use the same toggle switch component as the rest of the settings.
- The platform-color drawers all start closed instead of opening Bilibili by default.
- "侧边聊天栏弹幕胶囊" and "斗鱼播放器原生胶囊" are now independent settings pages with their own sidebar entries instead of subsections under platform details.
- The favorites guide preview in the settings page was updated with fresh example data.
- Favorite collection times now show only month/day for the current year and year/month/day for older favorites.
- Component styles were moved into their Vue SFCs (SCSS), with the favorites Shadow DOM styles kept as an isolated `favorites.scss`.
- `.vscode/` is now fully ignored.

## [2.2.1] - 2026-08-05

### Fixed

- Douyin replies no longer fail with "未能识别到这条弹幕的发送者": sender extraction was skipped because real chat rows share the `webcast-chatroom` class with the chat root, and virtual-list recycling could remove a row before the sender scan ever saw it. Senders are now read before the chat-root walk stops and are also extracted from removed rows.
- Douyin manual sends (typing in the fullscreen quick-send bar or side chat) are framed consistently in both the canvas renderer and side chat, including nested contenteditable editors and sends whose input is cleared before the click handler runs.
- Danmaku containing colons (e.g. scores like "13:0了") are no longer truncated to "0了" during +1, favorites, or replies: chat rows and canvas barrages now share the same pure text normalization, so sender correlation and text matching stay consistent.
- Bilibili danmaku freeze on hover now reads the position after pausing animations, so frozen clones no longer jump toward the cursor, and hover detection falls back to an immediate point lookup instead of waiting for the throttled move handler.
- Douyin favorite writes no longer reject valid senders after SPA navigation or short-link redirects; the background sender check now accepts the reported room URL and any Douyin host that the manifest already restricts content scripts to.

## [2.2.0] - 2026-08-03

### Added

- Real unpacked-extension E2E coverage for stable Chrome and Edge through the DevTools extension protocol.
- Responsive settings-page E2E coverage in Chinese and English at compact, normal, and wide widths.
- Privacy-safe, in-memory diagnostics that can be copied from the settings page.
- Chinese and English Chrome i18n catalogs for the manifest, settings, actions, feedback, and ARIA labels.
- Platform adapter contracts and ordered rich-danmaku descriptors for incremental entry-point extraction.
- Shared editor DOM helpers, inert overlay snapshots, and platform Emoji configuration modules.
- Tag validation, deterministic release archives, SHA256 checksums, and GitHub Pages privacy publishing.

### Changed

- Replaced Douyin's 50 ms route polling with event-driven routing and a visible-page-only 1 second fallback.
- Bounded and released observers, timers, sender caches, and pending route work when pages are hidden or unloaded.
- Pinned GitHub Actions to immutable commits and updated CI to Node.js 22.22.2.
- Split the settings sidebar and top bar into focused Vue components and removed unused legacy CSS.

### Fixed

- Sender lookup exceptions no longer abort reply preparation without feedback.
- Browser packaging is deterministic and works consistently on Windows and Fedora.
- Settings-page header actions no longer wrap, overlap, or squeeze into vertical text.
- Every localized message now has a complete Chinese fallback.

### Compatibility

- Favorites remain on schema v2; existing favorites are retained without destructive migration.
- Permissions remain limited to the existing `storage`, `scripting`, and current host scope.

[2.3.0]: https://github.com/SadUnicorn171/danmaku-echo/releases/tag/v2.3.0
[2.2.2]: https://github.com/SadUnicorn171/danmaku-echo/releases/tag/v2.2.2
[2.2.0]: https://github.com/SadUnicorn171/danmaku-echo/releases/tag/v2.2.0

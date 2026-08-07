# Changelog

All notable changes to Danmaku Echo are documented here.

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

[2.2.0]: https://github.com/SadUnicorn171/danmaku-echo/releases/tag/v2.2.0

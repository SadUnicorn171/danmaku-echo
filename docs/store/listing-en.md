# Store listing and privacy disclosures (2.3.0)

## Single purpose

Danmaku Echo provides consistent danmaku actions on Huya, Bilibili, Douyin, and Douyu Live: users can echo a side-chat or on-video message through the site's official editor, prepare a reply, copy a message, and keep reusable danmaku in browser-local favorites. The favorites page provides a persistent draggable **Wheel order**, and the quick wheel always shows its first six current-room entries; move buttons remain available for precise and keyboard operation. Version 2.3.0 unifies capsule sizing and adaptive left/right placement across all four platforms, keeps the barrage-to-capsule gap inside one continuous hover target, and surfaces official rate-limit, duplicate-message, and moderation feedback through send protection. If Bilibili's official panel cannot uniquely locate a room image emoji, a guarded fallback verifies its real room and submits it through the live-page danmaku endpoint.

## Permission justifications

- **Storage:** saves user-selected settings and locally favorited danmaku. Browser sync may synchronize settings; favorites remain in local extension storage. Schema v2 remains backward compatible.
- **Scripting:** restores the packaged Douyin live runtime after single-page navigation into a supported live route, and runs a one-shot Bilibili room-image fallback in the current tab only after an explicit send action and a failed unique panel lookup. It neither downloads nor executes remote code.
- **Host access:** recognizes danmaku and drives the existing official editor on supported live pages. `live.bilibili.com/*` also authorizes the one-shot room-image fallback after a failed panel lookup. The broader `www.douyin.com/*` match only detects navigation into `/follow/live/*`; non-live routes run a lightweight URL bootstrap.

## Remote code

No. All JavaScript, CSS, images, and dependencies are bundled in the submitted Manifest V3 package. There are no external scripts or modules, remote Wasm, `eval()`, `new Function()`, or downloaded executable code.

## Data use

The extension does not collect, upload, sell, or share user data. Preferences use browser-managed storage, and favorites stay in `storage.local`. The Bilibili fallback uses its CSRF credential only inside the current page and submits it back to Bilibili; it is never returned, logged, or stored. Diagnostics are privacy-filtered, generated in memory, and copied only after a user action; they are not persisted or uploaded.

## Privacy policy

https://sadunicorn171.github.io/danmaku-echo/

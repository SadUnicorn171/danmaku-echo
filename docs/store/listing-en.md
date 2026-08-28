# Store listing and privacy disclosures (2.3.1)

## Single purpose

Danmaku Echo provides consistent danmaku actions on Huya, Bilibili, Douyin, and Douyu Live. Users can echo, prepare replies, copy, and keep local favorites. A lightweight radar counts frequent text for one minute and shows a newest-first +1 queue that remains for ten seconds by default. Automatic mode adapts its trigger count from room size and recent danmaku volume; Manual mode stores independent fixed settings for all four platforms. On the first queue, a one-time guide points directly to the draggable radar icon and stays dismissed after acknowledgement. Favorites retain their draggable **Wheel order**. Capsules use consistent sizing, adaptive placement, and a continuous hover target, while send protection surfaces official rate-limit, duplicate-message, and moderation feedback with sanitized request metadata when available.

## Permission justifications

- **Storage:** saves user-selected settings, favorites, and one local Boolean acknowledging the radar introduction. Frequent-message counts remain only in current-page memory and clear on refresh or close.
- **Scripting:** restores the packaged Douyin live runtime, runs the one-shot Bilibili room-image fallback, and observes a native send result for at most eight seconds after an explicit user action. The observer exposes only the method, endpoint without query parameters, HTTP status, platform code, and native error text—not bodies, headers, cookies, CSRF values, or signatures. It neither downloads nor executes remote code.
- **Host access:** recognizes danmaku and drives official editors on supported live pages. `live.bilibili.com/*` also authorizes the room-image fallback and `www.douyin.com/*` detects live SPA navigation. Huya and Douyu radar scaling reads the guest count already displayed on the current page without calling or estimating from popularity endpoints. The extension requests no model or arbitrary cloud-analysis origins.

## Remote code

No. All JavaScript, CSS, and images are bundled in the submitted Manifest V3 package. There are no external scripts or modules, remote Wasm, `eval()`, `new Function()`, model downloads, or downloaded executable code.

## Data use

The extension does not collect, sell, profile, or share user data. Frequent-message counts stay in current-page memory and are neither persisted nor transmitted. The Bilibili fallback uses CSRF only inside the current page; diagnostics remain privacy-filtered and never upload automatically.

## Privacy policy

https://sadunicorn171.github.io/danmaku-echo/

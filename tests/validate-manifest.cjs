"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const extensionRoot = process.argv[2]
  ? path.resolve(root, process.argv[2])
  : root;
const manifestPath = path.join(extensionRoot, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

if (manifest.version !== packageJson.version) {
  throw new Error(
    `Version mismatch: package.json is ${packageJson.version}, manifest.json is ${manifest.version}. `
      + "Run npm run package to synchronize them."
  );
}
const douyinLiveMatches = [
  "*://live.douyin.com/*",
  "*://www.douyin.com/follow/live/*"
];
const douyinSpaBootstrapMatches = [
  "*://live.douyin.com/*",
  "*://www.douyin.com/*"
];

function hasAllMatches(entry, expected) {
  return expected.every((match) => (entry.matches || []).includes(match));
}

if (manifest.manifest_version !== 3) {
  throw new Error("manifest_version must be 3");
}

const referencedFiles = [
  manifest.action && manifest.action.default_popup,
  manifest.options_ui && manifest.options_ui.page,
  manifest.background && manifest.background.service_worker,
  ...Object.values(manifest.icons || {}),
  ...Object.values((manifest.action && manifest.action.default_icon) || {}),
  ...manifest.content_scripts.flatMap((entry) => [...(entry.js || []), ...(entry.css || [])])
].filter(Boolean);

for (const relativePath of referencedFiles) {
  if (!fs.existsSync(path.join(extensionRoot, relativePath))) {
    throw new Error(`Manifest references missing file: ${relativePath}`);
  }
}

const matches = manifest.content_scripts.flatMap((entry) => entry.matches);
for (const required of ["huya.com", "bilibili.com", "douyin.com", "douyu.com"]) {
  if (!matches.some((match) => match.includes(required))) {
    throw new Error(`Missing host match for ${required}`);
  }
}

const favoriteRuntimeEntries = manifest.content_scripts.filter((entry) =>
  (entry.js || []).includes("src/content.js")
  || (entry.js || []).includes("src/douyin-content.js")
);
if (favoriteRuntimeEntries.length !== 4
    || favoriteRuntimeEntries.some((entry) => (entry.css || []).includes("src/favorites.scss"))) {
  throw new Error("Favorites styles must stay encapsulated in the Shadow DOM runtime");
}

const contentCss = fs.readFileSync(path.join(extensionRoot, "src", "content.css"), "utf8");
const douyinContentCss = fs.readFileSync(
  path.join(extensionRoot, "src", "douyin-content.css"),
  "utf8"
);
for (const [label, css] of [["shared", contentCss], ["Douyin", douyinContentCss]]) {
  for (const color of ["#27ae60", "#ff4747", "#e6a000"]) {
    if (!css.includes(color)) {
      throw new Error(`${label} feedback styles are missing ${color}`);
    }
  }
  if (!/data-action[=~"']plus-one/.test(css)
      || !css.includes("font-size: 14.4px")
      || !css.includes("flex: 0 0 56px")
      || !css.includes("min-width: 56px")
      || !css.includes("width: 56px")) {
    throw new Error(`${label} actions must use equal 56px button widths`);
  }
}

const bilibiliContentScript = manifest.content_scripts.find((entry) =>
  (entry.matches || []).includes("*://live.bilibili.com/*")
  && (entry.js || []).includes("src/content.js")
);
if (!bilibiliContentScript || bilibiliContentScript.all_frames !== true) {
  throw new Error("Bilibili content script must run in embedded activity-page frames");
}

const bilibiliPageHook = manifest.content_scripts.find((entry) =>
  (entry.matches || []).includes("*://live.bilibili.com/*")
  && (entry.js || []).includes("src/bilibili-page-hook.js")
);
if (bilibiliPageHook) {
  throw new Error("Bilibili must not expose a persistent MAIN-world send bridge");
}
if (!(manifest.host_permissions || []).includes("*://live.bilibili.com/*")
    || (manifest.host_permissions || []).some((match) => match.includes("bilibili.com")
      && match !== "*://live.bilibili.com/*")) {
  throw new Error("Bilibili fallback permission must stay limited to live.bilibili.com");
}

const douyuContentScript = manifest.content_scripts.find((entry) =>
  (entry.matches || []).includes("*://*.douyu.com/*")
  && (entry.js || []).includes("src/content.js")
);
if (!douyuContentScript || douyuContentScript.run_at !== "document_idle") {
  throw new Error("Douyu must use the shared live content adapter");
}

const douyinContentScript = manifest.content_scripts.find((entry) =>
  hasAllMatches(entry, douyinLiveMatches)
  && (entry.js || []).includes("src/douyin-content.js")
);
if (!douyinContentScript || (douyinContentScript.js || []).includes("src/content.js")) {
  throw new Error("Douyin must use its dedicated content adapter");
}

const douyinPageHook = manifest.content_scripts.find((entry) =>
  hasAllMatches(entry, douyinLiveMatches)
  && (entry.js || []).includes("src/douyin-page-hook.js")
);
if (!douyinPageHook || douyinPageHook.run_at !== "document_start"
    || douyinPageHook.world !== "MAIN") {
  throw new Error("Douyin page hook must run in MAIN at document_start for every entry point");
}

const douyinBootstrap = manifest.content_scripts.find((entry) =>
  hasAllMatches(entry, douyinSpaBootstrapMatches)
  && (entry.js || []).includes("src/douyin-bootstrap.js")
);
if (!douyinBootstrap || douyinBootstrap.run_at !== "document_start") {
  throw new Error("Douyin recovery bootstrap must run at document_start");
}
if (!(manifest.permissions || []).includes("scripting")
    || manifest.background?.service_worker !== "background/service-worker.js") {
  throw new Error("Douyin recovery requires the scripting fallback service worker");
}
if (!(manifest.host_permissions || []).includes("*://live.douyin.com/*")
    || !(manifest.host_permissions || []).includes("*://www.douyin.com/*")) {
  throw new Error("Douyin recovery permissions must cover direct and SPA entry points");
}

const serviceWorkerSource = fs.readFileSync(
  path.join(extensionRoot, "background", "service-worker.js"),
  "utf8"
);
if (!serviceWorkerSource.includes("src/douyin-content.js")
    || !serviceWorkerSource.includes("src/douyin-content.css")
    || serviceWorkerSource.includes("src/favorites.scss")
    || !serviceWorkerSource.includes("chrome.tabs.onUpdated")
    || !serviceWorkerSource.includes("danmaku-echo.bilibili.direct-emoticon-send")
    || !serviceWorkerSource.includes('world: "MAIN"')) {
  throw new Error("Douyin SPA recovery must inject the complete runtime on history URL changes");
}

const popupHtml = fs.readFileSync(
  path.join(extensionRoot, manifest.action.default_popup),
  "utf8"
);
if (popupHtml.includes("\0") || !popupHtml.includes('id="app"')
    || !popupHtml.includes('type="module"')) {
  throw new Error("Popup HTML is empty or malformed");
}
const popupScriptMatch = popupHtml.match(/<script[^>]+src="([^"]+)"[^>]*>/);
if (!popupScriptMatch) {
  throw new Error("Popup HTML does not reference a JavaScript module");
}
const popupScriptPath = popupScriptMatch[1].replace(/^(?:\.\/|\/)/, "");
const popupSource = fs.readFileSync(path.join(extensionRoot, popupScriptPath), "utf8");
if (/\bprocess\.env\b/.test(popupSource)) {
  throw new Error("Popup bundle contains an unresolved Node.js process.env reference");
}

console.log(`Manifest OK (${referencedFiles.length} referenced files, ${matches.length} host matches): ${extensionRoot}`);

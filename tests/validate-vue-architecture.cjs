"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "src");
const extensionRoot = path.join(root, "build", "extension");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const sourceFiles = walk(sourceRoot);
const requiredCreateVueFiles = [
  ".editorconfig",
  ".gitattributes",
  ".oxlintrc.json",
  ".prettierrc.json",
  "env.d.ts",
  "eslint.config.ts",
  "index.html",
  "public/manifest.json",
  "src/App.vue",
  "src/main.ts",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "tsconfig.vitest.json",
  "vite.config.ts",
  "vitest.config.ts"
];
requiredCreateVueFiles.forEach((relativePath) => {
  if (!fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`Missing create-vue project file: ${relativePath}`);
  }
});
for (const legacyPath of [
  "assets",
  "design-system",
  "manifest.json",
  "scripts/build-extension.mjs",
  "src/popup",
  "src/styles",
  "src/ui"
]) {
  if (fs.existsSync(path.join(root, legacyPath))) {
    throw new Error(`Legacy pre-create-vue path remains: ${legacyPath}`);
  }
}
if (packageJson.type !== "module"
    || !packageJson.scripts?.["build:popup"]?.includes("vite build")
    || !packageJson.scripts?.["test:unit"]?.includes("vitest")
    || !packageJson.scripts?.["type-check"]?.includes("vue-tsc --build")) {
  throw new Error("package.json is not using the create-vue module, Vite, Vitest, and vue-tsc workflow");
}
const favoritesLauncherSource = fs.readFileSync(
  path.join(root, "src", "features", "favorites", "launcher.ts"),
  "utf8"
);
const favoritesComponentSource = fs.readFileSync(
  path.join(root, "src", "features", "favorites", "FavoritesLauncher.vue"),
  "utf8"
);
const favoritesCssSource = fs.readFileSync(
  path.join(root, "src", "assets", "styles", "favorites.scss"),
  "utf8"
);
const javascriptSources = sourceFiles.filter((file) => file.endsWith(".js"));
if (javascriptSources.length) {
  throw new Error(`Legacy JavaScript remains under src: ${javascriptSources.join(", ")}`);
}

const requiredVueComponents = [
  "src/App.vue",
  "src/components/ColorField.vue",
  "src/components/PlatformRow.vue",
  "src/components/SettingsSidebar.vue",
  "src/components/SettingsTopbar.vue",
  "src/features/favorites/FavoriteItemRow.vue",
  "src/features/favorites/FavoritesLauncher.vue",
  "src/components/live/ActionBar.vue",
  "src/components/live/ContentOverlay.vue",
  "src/components/live/DouyinOverlay.vue",
  "src/components/live/FeedbackToast.vue"
];
requiredVueComponents.forEach((relativePath) => {
  if (!fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`Missing Vue component: ${relativePath}`);
  }
});

if (!favoritesLauncherSource.includes("selectedRoomKey")
    || !favoritesComponentSource.includes("emit('selectRoom', group.roomKey)")
    || !favoritesComponentSource.includes("emit('backToRooms')")) {
  throw new Error("Favorites must use room-list to message-page navigation");
}
if (favoritesLauncherSource.includes("expandedRoomKeys")
    || favoritesComponentSource.includes("toggleGroup")
    || favoritesComponentSource.includes("bcp-favorites-group-items")) {
  throw new Error("Legacy inline room expansion remains in favorites UI");
}
if (favoritesComponentSource.includes("bcp-favorites-radial-item-icon")
    || !/\.bcp-favorites-radial-item\s*\{[\s\S]*?border-radius:\s*50%/.test(favoritesCssSource)) {
  throw new Error("Favorites radial choices must be circular and icon-free");
}

const popupHtml = fs.readFileSync(path.join(extensionRoot, "index.html"), "utf8");
const popupScriptMatch = popupHtml.match(/<script[^>]+src="([^"]+)"[^>]*>/);
if (!popupScriptMatch) {
  throw new Error("Built popup HTML does not reference a JavaScript module");
}
const popupScriptPath = popupScriptMatch[1].replace(/^(?:\.\/|\/)/, "");
const popupBundle = fs.readFileSync(path.join(extensionRoot, popupScriptPath), "utf8");
const contentBundle = fs.readFileSync(path.join(extensionRoot, "src", "content.js"), "utf8");
const douyinContentBundle = fs.readFileSync(
  path.join(extensionRoot, "src", "douyin-content.js"),
  "utf8"
);
const pageHookBundle = fs.readFileSync(
  path.join(extensionRoot, "src", "douyin-page-hook.js"),
  "utf8"
);
for (const [name, source] of [
  ["popup", popupBundle],
  ["content", contentBundle],
  ["douyin content", douyinContentBundle]
]) {
  if (!source.includes("createApp") || !source.includes("Vue")) {
    throw new Error(`${name} bundle does not contain the Vue runtime`);
  }
}
if (pageHookBundle.includes("function createAppContext")
    || pageHookBundle.includes("@vue/runtime")) {
  throw new Error("The document_start MAIN-world hook must not bundle the Vue runtime");
}
if (!contentBundle.includes("danmakuEchoFavoritesV1")
    || !douyinContentBundle.includes("danmakuEchoFavoritesV1")
    || !contentBundle.includes("bcp-favorites-radial")
    || !douyinContentBundle.includes("bcp-favorites-radial")) {
  throw new Error("The Huya/Bilibili and Douyin bundles must include the local favorites runtime");
}
for (const [name, source] of [
  ["Huya/Bilibili", contentBundle],
  ["Douyin", douyinContentBundle]
]) {
  if (!source.includes("attachShadow")
      || !source.includes("bcp-favorites-host")
      || !source.includes("data-bcp-favorites-runtime-owner")
      || !source.includes("FAVORITES_UI_VERSION = 3")) {
    throw new Error(`${name} favorites UI must keep its versioned Shadow DOM singleton`);
  }
  if (!source.includes("bcp-favorites-group-toggle")
      || !source.includes("time-desc")
      || !source.includes("发送次数")) {
    throw new Error(`${name} favorites UI must group rooms and expose all sort modes`);
  }
}

console.log(
  `Vue architecture OK (${sourceFiles.length} source files, ${requiredVueComponents.length} required components, ${requiredCreateVueFiles.length} create-vue files)`
);

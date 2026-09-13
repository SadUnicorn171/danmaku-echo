import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..", "..");
const buildResult = await build({
  configFile: false,
  logLevel: "silent",
  publicDir: false,
  root,
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(root, "src", "platforms", "bilibili", "dom-config.ts"),
      fileName: () => "bilibili-dom-config.js",
      formats: ["iife"],
      name: "DanmakuEchoBilibiliDomConfig"
    },
    minify: false,
    outDir: resolve(root, "build", "test-artifacts"),
    sourcemap: false,
    target: "chrome110",
    write: false
  }
});
const output = Array.isArray(buildResult) ? buildResult[0] : buildResult;
const source = output.output.find((entry) => entry.type === "chunk")?.code;
if (!source) {
  throw new Error("Could not build Bilibili DOM config test module");
}
const context = {};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "bilibili-dom-config.js" });
const config = context.DanmakuEchoBilibiliDomConfig;

test("recognizes structural Bilibili advertisement markers", () => {
  assert.equal(config.isBilibiliAdvertisementMarker("danmaku-item chat-ad-card"), true);
  assert.equal(config.isBilibiliAdvertisementMarker("data-ad-report promotion_banner"), true);
  assert.equal(config.isBilibiliAdvertisementMarker("danmaku-item badge user-name"), false);
});

test("requires an exact advertisement label instead of matching chat text", () => {
  assert.equal(config.isBilibiliAdvertisementLabel(" 广告 "), true);
  assert.equal(config.isBilibiliAdvertisementLabel("推广内容"), true);
  assert.equal(config.isBilibiliAdvertisementLabel("这个广告太长了"), false);
  assert.equal(config.isBilibiliAdvertisementLabel("推荐一个主播"), false);
});

test("discovers plaintext-only fullscreen reply editors", () => {
  assert.equal(config.BILIBILI_QUICK_INPUTS.some((selector) =>
    selector.includes("[contenteditable]:not([contenteditable='false'])")), true);
});

test("discovers current Bilibili image Emoji panels and pack containers", () => {
  assert.equal(config.BILIBILI_EMOJI_SURFACE_SELECTORS.some((selector) =>
    selector.includes("emoji-box")), true);
  assert.equal(config.BILIBILI_EMOJI_SURFACE_SELECTORS.some((selector) =>
    selector.includes("emoticon-wrap")), true);
  assert.equal(config.BILIBILI_EMOJI_SURFACE_SELECTORS.some((selector) =>
    selector.includes("face-list")), true);
});

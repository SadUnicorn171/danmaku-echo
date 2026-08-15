import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const buildResult = await build({
  configFile: false,
  logLevel: "silent",
  publicDir: false,
  root,
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(root, "src", "platforms", "douyin", "rich-data.ts"),
      fileName: () => "douyin-rich-data.js",
      formats: ["iife"],
      name: "DanmakuEchoDouyinRichData"
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
if (!source) throw new Error("Could not build Douyin rich-data test module");
const context = { URL, URLSearchParams };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "douyin-rich-data.js" });
const richData = context.DanmakuEchoDouyinRichData;

test("matches transformed signed Emoji URLs through stable path fragments", () => {
  const first = richData.normalizedAssetKeys(
    "https://p3.example.test/cache/emoji/resource_9876543210.webp?signature=old",
    "https://live.douyin.com/"
  );
  const second = richData.normalizedAssetKeys(
    "https://p9.example.test/render/resource_9876543210.png?signature=new",
    "https://live.douyin.com/"
  );
  assert.equal(first.includes("fragment:resource_9876543210"), true);
  assert.equal(second.includes("fragment:resource_9876543210"), true);
});

test("matches Douyu picker and rendered Emoji URLs through the embedded content digest", () => {
  const digest = "9c048b28f4ce42d7a0cf2f7b9b9084cb";
  const picker = richData.normalizedAssetKeys(
    `https://sta-op.douyucdn.cn/dygev/2024/07/01/${digest}.png`,
    "https://www.douyu.com/1667826"
  );
  const rendered = richData.normalizedAssetKeys(
    `https://shark2.douyucdn.cn/render/${digest}_48x48.webp?x-oss-process=image%2Fresize%2Cw_48`,
    "https://www.douyu.com/1667826"
  );

  assert.equal(picker.includes(`digest:${digest}`), true);
  assert.equal(rendered.includes(`digest:${digest}`), true);
});

test("extracts a Douyu content digest from a nested encoded resource URL", () => {
  const digest = "43fc7e023ad9ca645da729c02877812b";
  const keys = richData.normalizedAssetKeys(
    `https://img.example.test/proxy?source=${encodeURIComponent(
      `https://sta-op.douyucdn.cn/dygev/2024/03/29/${digest}.png`
    )}`,
    "https://www.douyu.com/1667826"
  );

  assert.equal(keys.includes(`digest:${digest}`), true);
});

test("matches Douyu built-in Emoji across format and bundle-hash changes", () => {
  const picker = richData.normalizedAssetKeys(
    "https://shark2.douyucdn.cn/front-publish/live-next-player-aside-master/assets/images/jiuzhe_ca93c68.png",
    "https://www.douyu.com/1667826"
  );
  const rendered = richData.normalizedAssetKeys(
    "https://shark2.douyucdn.cn/render/emotion/jiuzhe_8b7a992.webp",
    "https://www.douyu.com/1667826"
  );

  assert.equal(picker.includes("slug:jiuzhe"), true);
  assert.equal(rendered.includes("slug:jiuzhe"), true);
});

test("adds renderer IDs and names to serialized Emoji descriptors", () => {
  const assets = richData.serializedEmojiAssets([{
    type: "image",
    src: "https://signed.example.test/emoji.webp?signature=temporary",
    assetHints: ["emoji-42", "native-wave-resource"]
  }], "https://live.douyin.com/");

  assert.equal(assets.length, 1);
  assert.equal(assets[0].keys.includes("name:emoji-42"), true);
  assert.equal(assets[0].keys.includes("name:native-wave-resource"), true);
});

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { resolve } from "node:path";
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
      entry: resolve(root, "src", "platforms", "douyu", "config.ts"),
      fileName: () => "douyu-config.js",
      formats: ["iife"],
      name: "DanmakuEchoDouyuConfig"
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
if (!source) throw new Error("Could not build Douyu platform config test module");
const context = {};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "douyu-config.js" });
const config = context.DanmakuEchoDouyuConfig.DOUYU_PLATFORM_CONFIG;

test("uses current Douyu side-chat contracts", () => {
  assert.ok(config.chatRoots.includes("#js-barrage-list"));
  assert.equal(config.chatRoots.includes("[class*='Barrage-list']"), false);
  assert.ok(config.messages.some((selector) => selector.includes("Barrage-listItem")));
  assert.ok(config.messageText.includes(".Barrage-content"));
  assert.ok(config.userNames.some((selector) => selector.includes("Barrage-nickName")));
  assert.ok(config.inputs.some((selector) => selector.includes("ChatSend-txt")));
  assert.ok(config.sendButtons.includes(".ChatSend-button"));
});

test("matches dynamic Douyu player danmaku contracts", () => {
  assert.ok(config.videoRoots.includes("#js-player-main"));
  assert.ok(config.overlayMessages.includes("[class*='danmuItem-']"));
  assert.ok(config.messageText.includes("[class*='text-']"));
  assert.ok(config.userNames.includes("[class*='hostname-']"));
  assert.ok(config.inputs.some((selector) => selector.includes("inputView-")));
  assert.ok(config.sendButtons.some((selector) => selector.includes("sendDanmu-")));
});

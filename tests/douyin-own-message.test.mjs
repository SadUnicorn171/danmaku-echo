import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
      entry: resolve(root, "src", "platforms", "douyin", "own-message.ts"),
      fileName: () => "douyin-own-message.js",
      formats: ["iife"],
      name: "DanmakuEchoDouyinOwnMessage"
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
if (!source) throw new Error("Could not build Douyin own-message test module");
const context = {};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "douyin-own-message.js" });
const ownMessage = context.DanmakuEchoDouyinOwnMessage;
const douyinStyles = readFileSync(
  resolve(root, "src", "assets", "styles", "douyin-content.css"),
  "utf8"
);
const douyinOverlayComponent = readFileSync(
  resolve(root, "src", "components", "live", "DouyinOverlay.vue"),
  "utf8"
);

const asset = (...keys) => ({ src: "", token: "", keys });

test("matches a self-sent native Emoji by stable resource identity", () => {
  assert.equal(ownMessage.allAssetsMatch(
    [asset("path:/emoji/smile.png", "raw:old-signature")],
    [asset("path:/emoji/smile.png", "raw:new-signature")]
  ), true);
});

test("does not frame a different user's unrelated image Emoji", () => {
  assert.equal(ownMessage.allAssetsMatch(
    [asset("path:/emoji/smile.png")],
    [asset("path:/emoji/wave.png")]
  ), false);
  assert.equal(ownMessage.allAssetsMatch([], [asset("path:/emoji/smile.png")]), false);
});

test("requires a distinct observed asset for every expected Emoji", () => {
  assert.equal(ownMessage.allAssetsMatch(
    [asset("name:wave"), asset("name:wave")],
    [asset("name:wave")]
  ), false);
  assert.equal(ownMessage.allAssetsMatch(
    [asset("name:wave"), asset("name:wave")],
    [asset("name:wave"), asset("name:wave")]
  ), true);
});

test("matches a manually typed bracket Emoji message to Canvas text that omits images", () => {
  assert.equal(ownMessage.douyinOwnMessageTextMatches(
    "[杀马特][杀马特][杀马特]cyh[杀马特][杀马特][杀马特]cyh",
    "cyhcyh",
    true
  ), true);
  assert.equal(ownMessage.douyinOwnMessageTextMatches("[杀马特]", "表情", true), true);
  assert.equal(ownMessage.douyinOwnMessageTextMatches("[杀马特]cyh", "other", true), false);
});

test("keeps both Douyin own-message frames larger than their content", () => {
  const videoFrame = douyinStyles.match(
    /\.bcp-douyin-dom-barrage\[data-own='true'\]\s*\{[\s\S]*?\}/
  );
  const videoContent = douyinStyles.match(
    /\.bcp-douyin-dom-barrage\[data-own='true'\] \.bcp-douyin-dom-content\s*\{[\s\S]*?\}/
  );
  const sideChatFrame = douyinStyles.match(
    /\[data-bcp-douyin-own-chat-frame='true'\]\s*\{[\s\S]*?\}/
  );
  const sideChatContent = douyinStyles.match(
    /\[data-bcp-douyin-own-chat-content='true'\]\s*\{[\s\S]*?\}/
  );
  const sideChatRow = douyinStyles.match(
    /\[data-bcp-douyin-own-chat='true'\]\s*\{[\s\S]*?\}/
  );
  assert.ok(videoFrame);
  assert.ok(videoContent);
  assert.ok(sideChatFrame);
  assert.ok(sideChatContent);
  assert.ok(sideChatRow);
  assert.match(videoFrame[0], /box-shadow:\s*0 0 0 3px/);
  assert.match(videoFrame[0], /background:\s*transparent\s*!important/);
  assert.doesNotMatch(videoFrame[0], /background:\s*color-mix/);
  assert.doesNotMatch(videoFrame[0], /inset/);
  assert.match(videoContent[0], /background:\s*transparent\s*!important/);
  assert.match(videoContent[0], /box-shadow:\s*none\s*!important/);
  assert.match(videoContent[0], /outline:\s*none\s*!important/);
  assert.match(sideChatFrame[0], /border:\s*3px solid/);
  assert.match(sideChatFrame[0], /position:\s*absolute/);
  assert.match(sideChatFrame[0], /pointer-events:\s*none/);
  assert.match(sideChatContent[0], /outline:\s*none/);
  assert.doesNotMatch(sideChatContent[0], /outline-offset/);
  assert.match(sideChatRow[0], /background:\s*transparent\s*!important/);
  assert.match(sideChatRow[0], /box-shadow:\s*none\s*!important/);
});

test("keeps a single selection frame when hovering an own Douyin barrage", () => {
  for (const source of [douyinStyles, douyinOverlayComponent]) {
    const hoverFrame = source.match(
      /\.bcp-douyin-dom-track\[data-hovered='true'\][\s\S]*?\{[\s\S]*?box-shadow:\s*0 0 0 3px[\s\S]*?\}/
    );
    const ownFrame = source.match(
      /\.bcp-douyin-dom-barrage\[data-own='true'\]\s*\{[\s\S]*?\}/
    );
    const ownContent = source.match(
      /\.bcp-douyin-dom-barrage\[data-own='true'\] \.bcp-douyin-dom-content\s*\{[\s\S]*?\}/
    );
    const sideChatContent = source.match(
      /\[data-bcp-douyin-own-chat-content='true'\]\s*\{[\s\S]*?\}/
    );
    assert.ok(hoverFrame);
    assert.ok(ownFrame);
    assert.ok(ownContent);
    assert.ok(sideChatContent);
    assert.match(hoverFrame[0], /\.bcp-douyin-dom-barrage:not\(\[data-own='true'\]\)/);
    assert.match(ownFrame[0], /box-shadow:\s*0 0 0 3px/);
    assert.match(ownFrame[0], /background:\s*transparent\s*!important/);
    assert.doesNotMatch(ownFrame[0], /background:\s*color-mix/);
    assert.match(ownContent[0], /box-shadow:\s*none\s*!important/);
    assert.match(ownContent[0], /outline:\s*none\s*!important/);
    assert.match(sideChatContent[0], /background:\s*transparent\s*!important/);
    assert.match(sideChatContent[0], /outline:\s*none\s*!important/);
  }
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sharedSource = fs.readFileSync(
  path.join(__dirname, "..", "build", "extension", "src", "shared.js"),
  "utf8"
);
const sharedContext = {};
sharedContext.globalThis = sharedContext;
vm.runInNewContext(sharedSource, sharedContext, { filename: "shared.js" });
const shared = sharedContext.DanmakuEchoShared;

test("detects all supported live platforms", () => {
  assert.equal(shared.detectPlatform("www.huya.com"), "huya");
  assert.equal(shared.detectPlatform("live.bilibili.com"), "bilibili");
  assert.equal(shared.detectPlatform("www.douyu.com"), "douyu");
  assert.equal(shared.detectPlatform("m.douyu.com"), "douyu");
  assert.equal(shared.detectPlatform("live.douyin.com"), "douyin");
  assert.equal(shared.detectPlatform("www.douyin.com", "/follow/live/751561170106"), "douyin");
  assert.equal(shared.detectPlatform("www.douyin.com", "/video/751561170106"), null);
  assert.equal(shared.detectPlatform("example.com"), null);
});

test("keeps colon-containing danmaku text intact", () => {
  assert.equal(shared.parseMessageText("13:0了"), "13:0了");
  assert.equal(shared.parseMessageText("某位观众：主播晚上好"), "某位观众：主播晚上好");
  assert.equal(shared.parseMessageText("alice: nice shot"), "alice: nice shot");
  assert.equal(shared.parseMessageText("比分 3:0"), "比分 3:0");
});

test("keeps a URL instead of treating its scheme as a username", () => {
  assert.equal(shared.parseMessageText("https://example.com/live"), "https://example.com/live");
});

test("preserves complete Unicode Emoji grapheme sequences", () => {
  const family = "👨‍👩‍👧‍👦";
  const profession = "👩🏽‍💻";
  assert.equal(shared.normalizeWhitespace(`  ${family} ${profession}  `), `${family} ${profession}`);
  assert.equal(shared.parseMessageText(`${family}${profession}`, 1), family);
});

test("uses the meaningful final line from a decorated chat row", () => {
  assert.equal(shared.parseMessageText("等级 12\n用户甲\n这波漂亮"), "这波漂亮");
});

test("normalizes reply senders and builds a focused reply draft", () => {
  assert.equal(shared.normalizeSenderName("  @测试用户： "), "测试用户");
  assert.equal(shared.normalizeSenderName("点击查看个人信息"), "");
  assert.equal(shared.replyMention("主播:"), "@主播 ");
  assert.equal(shared.replyDraftValue("", "测试用户"), "@测试用户 ");
  assert.equal(shared.replyDraftValue("已有草稿", "测试用户"), "@测试用户 已有草稿");
  assert.equal(shared.replyDraftValue("@测试用户 已有草稿", "测试用户"), "@测试用户 已有草稿");
});

test("merges partial settings with safe defaults", () => {
  const settings = shared.mergeSettings({ autoSend: false, platforms: { douyin: false } });
  assert.equal(settings.enabled, true);
  assert.equal(settings.altClick, true);
  assert.deepEqual(JSON.parse(JSON.stringify(settings.actions)), {
    plusOne: true,
    reply: true,
    favorite: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.platforms)), {
    huya: true,
    bilibili: true,
    douyin: false,
    douyu: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.sideChatCapsule)), {
    huya: false,
    bilibili: false,
    douyu: false
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.nativeDanmakuCapsule)), {
    douyu: false
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.colors.huya)), Object.fromEntries(
    shared.COLOR_SETTING_KEYS.map((key) => [key, ""])
  ));
});

test("merges independent action visibility settings", () => {
  const settings = shared.mergeSettings({
    actions: { plusOne: false, reply: true, favorite: false }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.actions)), {
    plusOne: false,
    reply: true,
    favorite: false
  });
});

test("keeps shared-adapter side-chat capsules disabled by default and independent", () => {
  const settings = shared.mergeSettings({
    sideChatCapsule: { huya: true, bilibili: "invalid" }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.sideChatCapsule)), {
    huya: true,
    bilibili: false,
    douyu: false
  });
});

test("migrates the temporary side-chat plus-one setting to the full capsule", () => {
  const settings = shared.mergeSettings({
    sideChatPlusOne: { huya: false, bilibili: true }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.sideChatCapsule)), {
    huya: false,
    bilibili: true,
    douyu: false
  });
});

test("keeps the Douyu native danmaku capsule disabled by default", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(shared.mergeSettings().nativeDanmakuCapsule)),
    { douyu: false }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(shared.mergeSettings({
      nativeDanmakuCapsule: { douyu: true }
    }).nativeDanmakuCapsule)),
    { douyu: true }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(shared.mergeSettings({
      nativeDanmakuCapsule: { douyu: "invalid" }
    }).nativeDanmakuCapsule)),
    { douyu: false }
  );
});

test("keeps valid platform colors independent and ignores invalid values", () => {
  const settings = shared.mergeSettings({
    colors: {
      bilibili: { actionStart: "#12abEF", error: "red" },
      douyin: { actionStart: "#334455" }
    }
  });
  assert.equal(settings.colors.bilibili.actionStart, "#12ABEF");
  assert.equal(settings.colors.bilibili.error, "");
  assert.equal(settings.colors.douyin.actionStart, "#334455");
  assert.equal(settings.colors.huya.actionStart, "");
});

test("applies only validated platform color variables", () => {
  const values = new Map();
  const root = {
    style: {
      setProperty(name, value) {
        values.set(name, value);
      },
      removeProperty(name) {
        values.delete(name);
      }
    }
  };
  shared.applyPlatformColors(root, { actionStart: "#abcdef", error: "invalid" });
  assert.equal(values.get("--bcp-action-start"), "#ABCDEF");
  assert.equal(values.has("--bcp-error"), false);
  shared.applyPlatformColors(root, {});
  assert.equal(values.size, 0);
});

test("Douyin bootstrap requests the full runtime after an SPA live-route entry", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "build", "extension", "src", "douyin-bootstrap.js"),
    "utf8"
  );
  const sent = [];
  const timers = [];
  const intervals = [];
  const clearedIntervals = [];
  const listeners = new Map();
  const location = { href: "https://www.douyin.com/" };
  const context = {
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          sent.push(message);
          callback({ ok: true });
        }
      }
    },
    console: {
      debug() {},
      error() {},
      info() {},
      warn() {}
    },
    Date,
    document: {
      addEventListener(type, listener) {
        listeners.set(`document:${type}`, listener);
      },
      documentElement: null,
      getElementById() {
        return null;
      },
      hidden: false,
      readyState: "loading"
    },
    location,
    clearInterval(id) {
      clearedIntervals.push(id);
    },
    clearTimeout() {},
    setInterval(callback, delay) {
      intervals.push({ callback, delay });
      return intervals.length;
    },
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    window: {
      addEventListener(type, listener) {
        listeners.set(`window:${type}`, listener);
      },
      postMessage() {}
    }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "douyin-bootstrap.js" });

  assert.equal(sent.length, 0);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, 1_000);

  location.href = "https://www.douyin.com/follow/live/123456";
  intervals[0].callback();
  timers.sort((left, right) => left.delay - right.delay).forEach(({ callback }) => callback());

  assert.ok(sent.length >= 1);
  assert.equal(sent[0].type, "danmaku-echo.ensure-douyin-runtime");
  assert.equal(sent[0].href, location.href);

  context.document.hidden = true;
  listeners.get("document:visibilitychange")();
  assert.deepEqual(clearedIntervals, [1]);
});

test("rejects obvious system rows", () => {
  assert.equal(shared.isPlausibleMessage("直播已结束"), false);
  assert.equal(shared.isPlausibleMessage("真精彩"), true);
});

test("keeps reply errors contextual instead of relabeling them as +1 failures", () => {
  for (const file of ["content.js", "douyin-content.js"]) {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "build", "extension", "src", file),
      "utf8"
    );
    assert.doesNotMatch(source, /\+1失败/);
    assert.match(source, /未能识别这条弹幕的发送者/);
  }
});

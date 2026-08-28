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
  assert.equal(shared.replyDraftValue("已有草稿", "测试用户"), "已有草稿@测试用户");
  assert.equal(
    shared.replyDraftValue("1232312 3234", "sadunicorn", 10),
    "1232312 32@sadunicorn34"
  );
  assert.equal(
    shared.replyDraftValue("1232312 3234", "sadunicorn", 10, 12),
    "1232312 32@sadunicorn"
  );
  assert.equal(shared.replyDraftValue("yes @sadunicorn", "sadunicorn"), "yes @sadunicorn");
  assert.equal(shared.replyDraftValue("hello", "sadunicorn", 5), "hello@sadunicorn");
});

test("merges partial settings with safe defaults", () => {
  const settings = shared.mergeSettings({ autoSend: false, platforms: { douyin: false } });
  assert.equal(settings.enabled, true);
  assert.equal(settings.altClick, true);
  assert.deepEqual(JSON.parse(JSON.stringify(settings.actions)), {
    plusOne: true,
    reply: true,
    favorite: true,
    copy: false
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
  assert.equal(settings.repeatReminder.mode, "auto");
  assert.equal(settings.repeatReminder.promptDurationSeconds, 10);
  assert.equal(settings.repeatReminder.manual.bilibili.threshold, 6);
  assert.equal(settings.repeatReminder.manual.huya.threshold, 8);
});

test("merges independent action visibility settings", () => {
  const settings = shared.mergeSettings({
    actions: { plusOne: false, reply: true, favorite: false }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.actions)), {
    plusOne: false,
    reply: true,
    favorite: false,
    copy: false
  });
});

test("migrates the removed radar setting to the lightweight repeat reminder", () => {
  const settings = shared.mergeSettings({
    radar: { enabled: false, sensitivity: "high" }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.repeatReminder)), {
    enabled: false,
    manual: {
      bilibili: { promptDurationSeconds: 10, promptScalePercent: 100, queueLimit: 3, threshold: 3 },
      douyin: { promptDurationSeconds: 10, promptScalePercent: 100, queueLimit: 3, threshold: 3 },
      douyu: { promptDurationSeconds: 10, promptScalePercent: 100, queueLimit: 3, threshold: 5 },
      huya: { promptDurationSeconds: 10, promptScalePercent: 100, queueLimit: 3, threshold: 5 }
    },
    mode: "manual",
    promptDurationSeconds: 10,
    promptScalePercent: 100,
    queueLimit: 3,
    threshold: 3,
    thresholdVersion: 2
  });
});

test("normalizes custom radar queue, trigger, duration, and scale settings", () => {
  const settings = shared.mergeSettings({
    interfaceScale: { capsulePercent: 300 },
    repeatReminder: {
      enabled: true,
      promptDurationSeconds: 500,
      promptScalePercent: 20,
      queueLimit: 99,
      threshold: 1
    }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.repeatReminder)), {
    enabled: true,
    manual: {
      bilibili: { promptDurationSeconds: 60, promptScalePercent: 50, queueLimit: 10, threshold: 2 },
      douyin: { promptDurationSeconds: 60, promptScalePercent: 50, queueLimit: 10, threshold: 2 },
      douyu: { promptDurationSeconds: 60, promptScalePercent: 50, queueLimit: 10, threshold: 4 },
      huya: { promptDurationSeconds: 60, promptScalePercent: 50, queueLimit: 10, threshold: 4 }
    },
    mode: "manual",
    promptDurationSeconds: 60,
    promptScalePercent: 50,
    queueLimit: 10,
    threshold: 2,
    thresholdVersion: 2
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.interfaceScale)), {
    capsulePercent: 200
  });
});

test("migrates the old default threshold once while preserving later custom values", () => {
  assert.equal(shared.mergeSettings({
    repeatReminder: { threshold: 5 }
  }).repeatReminder.threshold, 6);
  assert.equal(shared.mergeSettings({
    repeatReminder: { threshold: 5, thresholdVersion: 2 }
  }).repeatReminder.threshold, 5);
});

test("keeps at least one capsule action enabled", () => {
  const settings = shared.mergeSettings({
    actions: { plusOne: false, reply: false, favorite: false, copy: false }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.actions)), {
    plusOne: true,
    reply: false,
    favorite: false,
    copy: false
  });
});

test("supports an independently enabled copy-only capsule", () => {
  const settings = shared.mergeSettings({
    actions: { plusOne: false, reply: false, favorite: false, copy: true }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(settings.actions)), {
    plusOne: false,
    reply: false,
    favorite: false,
    copy: true
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

test("scales capsule dimensions without scaling its positioned coordinate system", () => {
  const values = new Map();
  shared.applyCapsuleScale({
    style: {
      setProperty(name, value) {
        values.set(name, value);
      }
    }
  }, 125);
  assert.equal(values.get("--bcp-capsule-height"), "50px");
  assert.equal(values.get("--bcp-capsule-item-width"), "70px");
  assert.equal(values.get("--bcp-capsule-item-font-size"), "20px");
  assert.equal(values.get("--bcp-douyin-action-space"), "217.5px");
  assert.equal(values.has("--bcp-capsule-scale"), false);
});

test("snaps the capsule's horizontal rhythm to whole pixels", () => {
  const previousRatio = Object.getOwnPropertyDescriptor(sharedContext, "devicePixelRatio");
  try {
    for (const deviceScale of [1, 1.25, 1.5, 1.75, 2, 2.25]) {
      Object.defineProperty(sharedContext, "devicePixelRatio", {
        configurable: true,
        value: deviceScale
      });
      for (let percent = 50; percent <= 200; percent += 1) {
        const values = new Map();
        shared.applyCapsuleScale({
          style: {
            setProperty(name, value) {
              values.set(name, value);
            }
          }
        }, percent);
        const dividerWidth = Number.parseFloat(values.get("--bcp-capsule-divider-width"));
        const itemWidth = Number.parseFloat(values.get("--bcp-capsule-item-width"));
        assert.equal(
          Math.abs(dividerWidth * deviceScale - Math.round(dividerWidth * deviceScale)) < 1e-9,
          true,
          `divider width at ${percent}% and ${deviceScale}x DPR`
        );
        assert.equal(
          Math.abs(itemWidth * deviceScale - Math.round(itemWidth * deviceScale)) < 1e-9,
          true,
          `item width at ${percent}% and ${deviceScale}x DPR`
        );
        assert.equal(
          Math.abs((itemWidth + dividerWidth) * deviceScale
            - Math.round((itemWidth + dividerWidth) * deviceScale)) < 1e-9,
          true,
          `divider step at ${percent}% and ${deviceScale}x DPR`
        );
      }
    }
  } finally {
    if (previousRatio) {
      Object.defineProperty(sharedContext, "devicePixelRatio", previousRatio);
    } else {
      delete sharedContext.devicePixelRatio;
    }
  }
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

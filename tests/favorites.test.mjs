import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
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
      entry: resolve(root, "src", "features", "favorites", "index.ts"),
      fileName: () => "favorites-model.js",
      formats: ["iife"],
      name: "DanmakuEchoFavoritesModel"
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
if (!source) throw new Error("Could not build favorites model test module");
const context = {
  clearTimeout,
  crypto: globalThis.crypto,
  setTimeout,
  URL
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "favorites-model.js" });
const favorites = context.DanmakuEchoFavoritesModel;

function memoryStorage(initial = {}) {
  const values = JSON.parse(JSON.stringify(initial));
  return {
    get(keys, callback) {
      const requested = Array.isArray(keys) ? keys : [keys];
      callback(Object.fromEntries(requested.map((key) => [key, values[key]])));
    },
    set(update, callback) {
      Object.assign(values, JSON.parse(JSON.stringify(update)));
      callback();
    },
    snapshot() {
      return JSON.parse(JSON.stringify(values));
    },
    writeRaw(key, value) {
      values[key] = JSON.parse(JSON.stringify(value));
    }
  };
}

const roomA = {
  platform: "bilibili",
  roomId: "100",
  roomKey: "bilibili:100",
  roomName: "A主播",
  url: "https://live.bilibili.com/100"
};
const roomB = {
  platform: "bilibili",
  roomId: "200",
  roomKey: "bilibili:200",
  roomName: "B主播",
  url: "https://live.bilibili.com/200"
};

test("normalizes first-version plain text while preserving Unicode emoji", () => {
  assert.equal(favorites.normalizeFavoriteText("  前方\n高能 😀\u200B  "), "前方 高能 😀");
  assert.equal(favorites.normalizeFavoriteText("程序员 👩‍💻 一起加油"), "程序员 👩‍💻 一起加油");
  assert.equal(favorites.favoriteKey("ＡＢＣ！"), "abc!");
  assert.equal(Array.from(favorites.normalizeFavoriteText("弹".repeat(1_100))).length, 1_000);
});

test("deduplicates global content and records multiple room origins", async () => {
  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  await repository.favorite("主播太强了 😀", roomA);
  await repository.favorite("主播太强了 😀", roomB);
  assert.equal(repository.database.items.length, 1);
  assert.deepEqual(
    Array.from(repository.database.items[0].origins, (origin) => origin.roomKey).sort(),
    [roomA.roomKey, roomB.roomKey]
  );
});

test("stores image Emoji and mixed content as a resendable favorite payload", async () => {
  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  const waving = {
    keys: ["raw:https://example.com/wave.png?sign=old", "file:wave.png", "name:主播挥手"],
    src: "https://example.com/wave.png?sign=old",
    token: "[主播挥手]"
  };
  const saved = await repository.favorite("晚上好 [主播挥手]", roomA, {
    text: "晚上好 [主播挥手]",
    plainText: "晚上好",
    assets: [waving],
    parts: [
      { type: "text", text: "晚上好 " },
      { type: "emoji", asset: waving }
    ]
  });

  assert.equal(saved.item.payload.assets.length, 1);
  assert.equal(saved.item.payload.assets[0].token, "[主播挥手]");
  assert.deepEqual(
    Array.from(saved.item.payload.parts, (part) => part.type),
    ["text", "emoji"]
  );
  assert.equal(saved.item.payload.plainText, "晚上好");
  assert.equal(saved.item.text, "晚上好 [主播挥手]");
});

test("preserves Bilibili native-panel identity for streamer Emoji favorites", () => {
  const payload = favorites.normalizeFavoritePayload({
    assets: [{
      keys: ["native-panel:room-happy-42", "raw:[主播表情9]", "file:room-happy.webp"],
      src: "https://example.com/room-happy.webp",
      token: "[主播表情9]"
    }],
    parts: [{
      type: "emoji",
      asset: {
        keys: ["native-panel:room-happy-42", "raw:[主播表情9]"],
        src: "https://example.com/room-happy.webp",
        token: "[主播表情9]"
      }
    }],
    plainText: "",
    text: "[主播表情9]"
  });

  assert.equal(payload.assets[0].keys[0], "native-panel:room-happy-42");
  assert.equal(payload.parts[0].asset.keys[0], "native-panel:room-happy-42");
});

test("shows platform image names from tokens and metadata instead of generic labels", async () => {
  assert.equal(favorites.favoriteAssetDisplayName({
    keys: ["file:emoji_100.webp"],
    src: "https://example.com/emoji_100.webp",
    token: "[害羞]"
  }), "[害羞]");
  assert.equal(favorites.favoriteAssetDisplayName({
    keys: [
      "name:https://example.com/emoji.webp?sign=temporary",
      "name:害羞",
      "file:4fe19d82280f42ab.webp"
    ],
    src: "https://example.com/emoji.webp?sign=temporary",
    token: ""
  }), "[害羞]");

  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  const shy = {
    keys: ["name:害羞", "file:4fe19d82280f42ab.webp"],
    src: "https://example.com/4fe19d82280f42ab.webp",
    token: ""
  };
  const saved = await repository.favorite("表情", roomA, {
    text: "表情",
    plainText: "真的",
    assets: [shy],
    parts: [
      { type: "text", text: "真的" },
      { type: "emoji", asset: shy }
    ]
  });

  assert.equal(saved.item.text, "真的 [害羞]");
  assert.equal(saved.item.normalizedText.includes("害羞"), true);
});

test("prefers a Bilibili room Emoji name over a neighboring badge description", () => {
  assert.equal(favorites.favoriteAssetDisplayName({
    keys: [
      "native-panel:room_5236391_63398",
      "name:这是 ta 的荣耀等级勋章 (●'◡'●)ノ♥",
      "name:发财了",
      "file:393a700286ed5c33ede3901e69b7824462ebe363.png"
    ],
    src: "https://i0.hdslb.com/bfs/live/393a700286ed5c33ede3901e69b7824462ebe363.png",
    token: "[这是 TA 的荣耀等级勋章 (●'◡'●)ノ♥]"
  }), "[发财了]");
});

test("prefers a Bilibili Emoji alt name over an official resource identity", () => {
  assert.equal(favorites.favoriteAssetDisplayName({
    keys: [
      "native-panel:official_332",
      "name:冲鸭",
      "raw:official_332",
      "file:dea7fbbc1c3d3c80f4c7b27263e13460f21874e4.png"
    ],
    src: "https://i0.hdslb.com/bfs/live/dea7fbbc1c3d3c80f4c7b27263e13460f21874e4.png",
    token: "[official_332]"
  }), "[冲鸭]");
});

test("repairs a stored Bilibili official-id display name while preserving send identity", async () => {
  const asset = {
    keys: ["native-panel:official_332", "name:冲鸭", "raw:official_332"],
    src: "https://i0.hdslb.com/bfs/live/dea7fbbc1c3d3c80f4c7b27263e13460f21874e4.png",
    token: "[official_332]"
  };
  const legacy = {
    danmakuEchoFavoritesV1: {
      schemaVersion: 2,
      updatedAt: 1,
      items: [{
        id: "official-id-name",
        text: "[official_332]",
        payload: {
          text: "[official_332]",
          plainText: "",
          assets: [asset],
          parts: [{ type: "emoji", asset }]
        },
        normalizedText: "[official_332]",
        createdAt: 1,
        updatedAt: 1,
        lastSentAt: 0,
        totalSendCount: 0,
        globalPinned: false,
        origins: [],
        roomStats: {}
      }]
    }
  };
  const repository = favorites.createFavoritesRepository(memoryStorage(legacy));
  await repository.load();

  assert.equal(repository.database.items[0].text, "[冲鸭]");
  assert.equal(
    repository.database.items[0].payload.assets[0].keys.includes("native-panel:official_332"),
    true
  );
});

test("re-favoriting repairs a Bilibili room Emoji previously saved as a badge image", async () => {
  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  const identity = "native-panel:room_5236391_63397";
  const wrongAsset = {
    keys: [identity, "file:5d5e873b7b0d1894c56c4843bfba4617ff22e490.webp"],
    src: "https://i1.hdslb.com/bfs/live/5d5e873b7b0d1894c56c4843bfba4617ff22e490.webp",
    token: "[这是 TA 的荣耀等级勋章 (●'◡'●)ノ♥]"
  };
  const correctAsset = {
    keys: [identity, "file:c563e55ab43e890d310651132a0ed549d9ddc6b1.png"],
    src: "https://i0.hdslb.com/bfs/live/c563e55ab43e890d310651132a0ed549d9ddc6b1.png",
    token: "[生无可恋]"
  };

  await repository.favorite("这是 TA 的荣耀等级勋章 (●'◡'●)ノ♥", roomA, {
    assets: [wrongAsset],
    parts: [{ type: "emoji", asset: wrongAsset }],
    plainText: "",
    text: "这是 TA 的荣耀等级勋章 (●'◡'●)ノ♥"
  });
  const repaired = await repository.favorite("[生无可恋]", roomA, {
    assets: [correctAsset],
    parts: [{ type: "emoji", asset: correctAsset }],
    plainText: "",
    text: "[生无可恋]"
  });

  assert.equal(repaired.added, false);
  assert.equal(repository.database.items.length, 1);
  assert.equal(repaired.item.text, "[生无可恋]");
  assert.equal(repaired.item.payload.assets[0].keys.includes(identity), true);
});

test("distinguishes rich favorites with the same display text by resource identity", async () => {
  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  const payload = (file) => ({
    text: "图片表情",
    plainText: "",
    assets: [{ keys: [`file:${file}`], src: `https://example.com/${file}`, token: "" }]
  });

  await repository.favorite("图片表情", roomA, payload("first.png"));
  await repository.favorite("图片表情", roomA, payload("second.png"));
  await repository.favorite("图片表情", roomB, payload("first.png"));

  assert.equal(repository.database.items.length, 2);
  const shared = repository.database.items.find((item) =>
    item.payload.assets[0].keys.includes("file:first.png"));
  assert.deepEqual(
    Array.from(shared.origins, (origin) => origin.roomKey).sort(),
    [roomA.roomKey, roomB.roomKey]
  );
});

test("loads legacy text favorites into the rich-capable schema without data loss", async () => {
  const legacy = {
    danmakuEchoFavoritesV1: {
      schemaVersion: 1,
      updatedAt: 1,
      items: [{
        id: "legacy",
        text: "旧版收藏 😀",
        normalizedText: "旧版收藏 😀",
        createdAt: 1,
        updatedAt: 1,
        lastSentAt: 0,
        totalSendCount: 0,
        globalPinned: false,
        origins: [],
        roomStats: {}
      }]
    }
  };
  const repository = favorites.createFavoritesRepository(memoryStorage(legacy));
  await repository.load();

  assert.equal(repository.database.schemaVersion, 2);
  assert.equal(repository.database.items[0].text, "旧版收藏 😀");
  assert.equal(repository.database.items[0].payload.text, "旧版收藏 😀");
  assert.equal(repository.database.items[0].payload.assets.length, 0);
});

test("upgrades an existing generic rich favorite to its saved image name on load", async () => {
  const legacy = {
    danmakuEchoFavoritesV1: {
      schemaVersion: 2,
      updatedAt: 1,
      items: [{
        id: "generic-rich",
        text: "图片表情",
        payload: {
          text: "图片表情",
          plainText: "",
          assets: [{ keys: ["name:害羞"], src: "", token: "" }],
          parts: [{
            type: "emoji",
            asset: { keys: ["name:害羞"], src: "", token: "" }
          }]
        },
        normalizedText: "图片表情",
        createdAt: 1,
        updatedAt: 1,
        lastSentAt: 0,
        totalSendCount: 0,
        globalPinned: false,
        origins: [],
        roomStats: {}
      }]
    }
  };
  const repository = favorites.createFavoritesRepository(memoryStorage(legacy));
  await repository.load();

  assert.equal(repository.database.items[0].text, "[害羞]");
  assert.equal(repository.database.items[0].normalizedText.includes("害羞"), true);
});

test("re-favoriting an opaque legacy image upgrades its name without creating a duplicate", async () => {
  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  const opaque = {
    keys: ["file:4fe19d82280f42ab.webp"],
    src: "https://example.com/4fe19d82280f42ab.webp",
    token: ""
  };
  await repository.favorite("图片表情", roomA, {
    text: "图片表情",
    plainText: "",
    assets: [opaque],
    parts: [{ type: "emoji", asset: opaque }]
  });

  const named = {
    ...opaque,
    keys: [...opaque.keys, "name:哇"],
    token: "[哇]"
  };
  const upgraded = await repository.favorite("[哇]", roomA, {
    text: "[哇]",
    plainText: "",
    assets: [named],
    parts: [{ type: "emoji", asset: named }]
  });

  assert.equal(upgraded.added, false);
  assert.equal(repository.database.items.length, 1);
  assert.equal(repository.database.items[0].text, "[哇]");
  assert.equal(repository.database.items[0].payload.assets[0].token, "[哇]");
});

test("re-favoriting a Douyu pinyin image upgrades it to the official rel name", async () => {
  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  const resource = {
    keys: ["file:gougutou_0fd69bd.png", "slug:gougutou"],
    src: "https://shark2.douyucdn.cn/assets/images/gougutou_0fd69bd.png/fmtpng"
  };
  await repository.favorite("[gougutou]", roomA, {
    text: "[gougutou]",
    plainText: "",
    assets: [{ ...resource, token: "[gougutou]" }],
    parts: [{ type: "emoji", asset: { ...resource, token: "[gougutou]" } }]
  });

  const upgraded = await repository.favorite("[狗骨头]", roomA, {
    text: "[狗骨头]",
    plainText: "",
    assets: [{ ...resource, keys: [...resource.keys, "name:狗骨头"], token: "[狗骨头]" }],
    parts: [{
      type: "emoji",
      asset: { ...resource, keys: [...resource.keys, "name:狗骨头"], token: "[狗骨头]" }
    }]
  });

  assert.equal(upgraded.added, false);
  assert.equal(repository.database.items.length, 1);
  assert.equal(repository.database.items[0].text, "[狗骨头]");
  assert.equal(repository.database.items[0].payload.assets[0].token, "[狗骨头]");
});

test("sorts favorites by send count by default while preserving room filters", async () => {
  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  const fromA = await repository.favorite("A房收藏", roomA);
  const fromB = await repository.favorite("B房收藏", roomB);
  await repository.recordSent(fromB.item.id, roomA);
  const all = favorites.rankedFavorites(repository.database.items, roomA, "all");
  assert.equal(all[0].id, fromB.item.id);
  assert.equal(all.some((item) => item.id === fromB.item.id), true);
  assert.deepEqual(
    Array.from(favorites.rankedFavorites(repository.database.items, roomA, "current"), (item) => item.id),
    [fromA.item.id]
  );
  assert.deepEqual(
    Array.from(favorites.rankedFavorites(repository.database.items, roomA, "other"), (item) => item.id),
    [fromB.item.id]
  );
});

test("supports ascending and descending collection-time sorting", async () => {
  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  const older = await repository.favorite("较早收藏", roomA);
  const newer = await repository.favorite("较晚收藏", roomA);
  const currentOlder = repository.database.items.find((item) => item.id === older.item.id);
  const currentNewer = repository.database.items.find((item) => item.id === newer.item.id);
  currentOlder.createdAt = 1_000;
  currentOlder.origins[0].collectedAt = 1_000;
  currentOlder.roomStats[roomA.roomKey].addedToRoomAt = 1_000;
  currentNewer.createdAt = 2_000;
  currentNewer.origins[0].collectedAt = 2_000;
  currentNewer.roomStats[roomA.roomKey].addedToRoomAt = 2_000;
  currentOlder.totalSendCount = 5;

  assert.deepEqual(
    Array.from(favorites.rankedFavorites(
      repository.database.items, roomA, "current", "", "send-count"
    ), (item) => item.text),
    ["较早收藏", "较晚收藏"]
  );
  assert.deepEqual(
    Array.from(favorites.rankedFavorites(
      repository.database.items, roomA, "current", "", "time-desc"
    ), (item) => item.text),
    ["较晚收藏", "较早收藏"]
  );
  assert.deepEqual(
    Array.from(favorites.rankedFavorites(
      repository.database.items, roomA, "current", "", "time-asc"
    ), (item) => item.text),
    ["较早收藏", "较晚收藏"]
  );
});

test("pins favorites per room ahead of every selected sort", async () => {
  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  const first = await repository.favorite("普通收藏", roomA);
  const pinned = await repository.favorite("需要置顶", roomA);
  await repository.recordSent(first.item.id, roomA);
  await repository.setPinned(pinned.item.id, roomA.roomKey, true);

  for (const sort of ["send-count", "time-asc", "time-desc", "custom"]) {
    const ranked = favorites.rankedFavorites(
      repository.database.items, roomA, "current", "", sort
    );
    assert.equal(ranked[0].id, pinned.item.id);
    assert.equal(ranked[0].pinned, true);
  }
  assert.equal(repository.database.items.find((item) => item.id === first.item.id)
    .roomStats[roomA.roomKey].pinned, false);
});

test("stores normalized tags and finds favorites by tag", async () => {
  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  const saved = await repository.favorite("今晚加油", roomA);
  await repository.setTags(saved.item.id, ["  高能  ", "高能", "主播", "x".repeat(40)]);

  const item = repository.database.items[0];
  assert.deepEqual(Array.from(item.tags), ["高能", "主播", "x".repeat(20)]);
  assert.deepEqual(
    Array.from(favorites.rankedFavorites(
      repository.database.items, roomA, "current", "主播"
    ), (entry) => entry.id),
    [saved.item.id]
  );
});

test("supports persistent custom ordering inside each room", async () => {
  const storage = memoryStorage();
  const repository = favorites.createFavoritesRepository(storage);
  await repository.load();
  const first = await repository.favorite("第一条", roomA);
  const second = await repository.favorite("第二条", roomA);
  const third = await repository.favorite("第三条", roomA);
  await repository.favorite("第四条", roomA);

  await repository.move(second.item.id, roomA.roomKey, "up");
  assert.deepEqual(
    Array.from(favorites.rankedFavorites(
      repository.database.items, roomA, "current", "", "custom"
    ), (item) => item.text),
    ["第二条", "第一条", "第三条", "第四条"]
  );

  await repository.move(second.item.id, roomA.roomKey, "down");
  assert.deepEqual(
    Array.from(favorites.rankedFavorites(
      repository.database.items, roomA, "current", "", "custom"
    ), (item) => item.text),
    ["第一条", "第二条", "第三条", "第四条"]
  );

  await repository.reorder(first.item.id, third.item.id, roomA.roomKey, "after");
  assert.deepEqual(
    Array.from(favorites.rankedFavorites(
      repository.database.items, roomA, "current", "", "custom"
    ), (item) => item.text),
    ["第二条", "第三条", "第一条", "第四条"]
  );

  const reloaded = favorites.createFavoritesRepository(storage);
  await reloaded.load();
  assert.deepEqual(
    Array.from(favorites.rankedFavorites(
      reloaded.database.items, roomA, "current", "", "custom"
    ), (item) => item.text),
    ["第二条", "第三条", "第一条", "第四条"]
  );
});

test("loads old schema-v2 favorites with default tags and deterministic custom order", async () => {
  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  await repository.favorite("旧收藏一", roomA);
  await repository.favorite("旧收藏二", roomA);
  const stored = repository.database;
  stored.items.forEach((item) => {
    delete item.tags;
    delete item.roomStats[roomA.roomKey].customOrder;
  });
  const reloaded = favorites.createFavoritesRepository(memoryStorage({
    danmakuEchoFavoritesV1: stored
  }));
  await reloaded.load();

  assert.deepEqual(Array.from(reloaded.database.items, (item) => Array.from(item.tags)), [[], []]);
  assert.deepEqual(
    Array.from(favorites.rankedFavorites(
      reloaded.database.items, roomA, "current", "", "custom"
    ), (item) => item.customOrder),
    [1, 2]
  );
  assert.equal(reloaded.database.schemaVersion, 2);
});

test("groups other and all favorites by room before exposing messages", async () => {
  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  const onlyA = await repository.favorite("A房弹幕", roomA);
  const shared = await repository.favorite("跨房弹幕", roomA);
  await repository.favorite("跨房弹幕", roomB);
  const onlyB = await repository.favorite("B房弹幕", roomB);
  repository.database.items.find((item) => item.id === shared.item.id).totalSendCount = 4;
  repository.database.items.find((item) => item.id === onlyB.item.id).totalSendCount = 2;
  repository.database.items.find((item) => item.id === onlyA.item.id).totalSendCount = 1;

  const otherGroups = favorites.groupedFavorites(
    repository.database.items, roomA, "other"
  );
  assert.deepEqual(Array.from(otherGroups, (group) => group.roomName), ["B主播"]);
  assert.deepEqual(
    Array.from(otherGroups[0].items, (item) => item.text),
    ["跨房弹幕", "B房弹幕"]
  );

  const allGroups = favorites.groupedFavorites(
    repository.database.items, roomA, "all"
  );
  assert.equal(allGroups[0].roomKey, roomA.roomKey);
  assert.equal(allGroups[0].isCurrentRoom, true);
  assert.deepEqual(
    Array.from(allGroups, (group) => [group.roomName, group.items.length]),
    [["A主播", 2], ["B主播", 2]]
  );
});

test("can promote an other-room favorite into the current room without duplicating it", async () => {
  const repository = favorites.createFavoritesRepository(memoryStorage());
  await repository.load();
  const saved = await repository.favorite("跨房间也能发送", roomB);
  assert.equal(favorites.rankedFavorites(repository.database.items, roomA, "current").length, 0);
  await repository.addToRoom(saved.item.id, roomA);
  const current = favorites.rankedFavorites(repository.database.items, roomA, "current");
  assert.equal(current.length, 1);
  assert.equal(current[0].id, saved.item.id);
  assert.equal(current[0].belongsToCurrentRoom, true);
  assert.equal(
    current[0].origins.some((origin) => origin.roomKey === roomA.roomKey
      && origin.roomName === roomA.roomName),
    true
  );
  assert.equal(repository.database.items.length, 1);
});

test("serializes overlapping local mutations without losing favorites", async () => {
  const storage = memoryStorage();
  const repository = favorites.createFavoritesRepository(storage);
  await repository.load();
  await Promise.all([
    repository.favorite("并发收藏 A", roomA),
    repository.favorite("并发收藏 B", roomB),
    repository.favorite("并发收藏 C", roomA)
  ]);

  assert.deepEqual(
    Array.from(repository.database.items, (item) => item.text).sort(),
    ["并发收藏 A", "并发收藏 B", "并发收藏 C"]
  );
  assert.equal(repository.database.revision, 3);
  assert.ok(repository.database.writeId);
});

test("keeps a verified redundant copy and automatically repairs a damaged primary", async () => {
  const storage = memoryStorage();
  const writer = favorites.createFavoritesRepository(storage);
  await writer.load();
  await writer.favorite("需要保护的收藏", roomA);

  const saved = storage.snapshot();
  assert.deepEqual(
    saved.danmakuEchoFavoritesV1,
    saved.danmakuEchoFavoritesBackupV2
  );
  storage.writeRaw("danmakuEchoFavoritesV1", { items: "damaged", schemaVersion: 2 });

  const reader = favorites.createFavoritesRepository(storage);
  await reader.load();
  assert.equal(reader.recoveredFromBackup, true);
  assert.equal(reader.database.items[0].text, "需要保护的收藏");
  const repaired = storage.snapshot();
  assert.deepEqual(repaired.danmakuEchoFavoritesV1, repaired.danmakuEchoFavoritesBackupV2);
});

test("rejects damaged favorites when neither local copy is usable", async () => {
  const storage = memoryStorage({
    danmakuEchoFavoritesV1: { items: "damaged", schemaVersion: 2 },
    danmakuEchoFavoritesBackupV2: { items: [null], schemaVersion: 2 }
  });
  const repository = favorites.createFavoritesRepository(storage);
  await assert.rejects(repository.load(), /收藏数据损坏/);
});

test("exports a portable JSON bundle and preserves pre-import data for rollback", async () => {
  const sourceStorage = memoryStorage();
  const source = favorites.createFavoritesRepository(sourceStorage);
  await source.load();
  await source.favorite("来自备份的收藏", roomA);
  const bundle = await favorites.exportFavoritesData(sourceStorage);

  assert.equal(bundle.format, "danmaku-echo-favorites");
  assert.equal(bundle.database.items.length, 1);

  const targetStorage = memoryStorage();
  const target = favorites.createFavoritesRepository(targetStorage);
  await target.load();
  await target.favorite("导入前的收藏", roomB);
  const beforeImport = targetStorage.snapshot().danmakuEchoFavoritesV1;
  const imported = await favorites.importFavoritesData(targetStorage, JSON.stringify(bundle));
  const saved = targetStorage.snapshot();

  assert.deepEqual(Array.from(imported.items, (item) => item.text), ["来自备份的收藏"]);
  assert.deepEqual(saved.danmakuEchoFavoritesBeforeImportV2, beforeImport);
  assert.deepEqual(saved.danmakuEchoFavoritesV1, saved.danmakuEchoFavoritesBackupV2);
});

test("rejects invalid import files before overwriting local favorites", async () => {
  const storage = memoryStorage();
  const repository = favorites.createFavoritesRepository(storage);
  await repository.load();
  await repository.favorite("不能丢失的收藏", roomA);
  const before = storage.snapshot();

  await assert.rejects(
    favorites.importFavoritesData(storage, '{"format":"unknown"}'),
    /不是弹幕回声收藏备份文件/
  );
  assert.deepEqual(storage.snapshot(), before);
});

test("derives stable platform room identifiers from live URLs", () => {
  assert.equal(favorites.roomIdFromLocation("bilibili", "https://live.bilibili.com/12345?x=1"), "12345");
  assert.equal(favorites.roomIdFromLocation("douyin", "https://live.douyin.com/923572354274"), "923572354274");
  assert.equal(
    favorites.roomIdFromLocation(
      "douyin",
      "https://live.douyin.com/923572354274?anchor_id=3712416599779096"
    ),
    "923572354274"
  );
  assert.equal(favorites.roomIdFromLocation("huya", "https://www.huya.com/some-room"), "some-room");
  assert.equal(favorites.roomIdFromLocation("douyu", "https://www.douyu.com/12152200"), "12152200");
});

test("keeps only the themed outer ring on the favorites radial menu", () => {
  const styles = readFileSync(
    resolve(root, "src", "assets", "styles", "favorites.scss"),
    "utf8"
  );
  assert.doesNotMatch(styles, /\.bcp-favorites-panel::before/);
  assert.match(styles, /\.bcp-favorites-radial::before\s*\{[\s\S]*?border:\s*2px solid var\(--bcp-favorite-accent\)/);
  assert.match(styles, /\.bcp-favorites-radial-item\s*\{[\s\S]*?border:\s*0;/);
  assert.doesNotMatch(styles, /\.bcp-favorites-radial-item\.is-selected\s*\{[\s\S]*?border-color:/);
});

test("renders a theme-colored radial bot that follows the pointer direction", () => {
  const component = readFileSync(
    resolve(root, "src", "features", "favorites", "FavoritesLauncher.vue"),
    "utf8"
  );
  const launcher = readFileSync(
    resolve(root, "src", "features", "favorites", "launcher.ts"),
    "utf8"
  );
  const styles = readFileSync(
    resolve(root, "src", "assets", "styles", "favorites.scss"),
    "utf8"
  );

  assert.match(component, /class="bcp-favorites-radial-bot-eyes"/);
  assert.match(component, /class="bcp-favorites-radial-bot-expression"/);
  assert.match(component, /selectedOption \? `is-\$\{selectedOption\.kind\}` : 'is-idle'/);
  assert.match(component, /--bcp-favorites-gaze-angle/);
  assert.doesNotMatch(component, /class="bcp-favorites-radial-copy"/);
  assert.match(launcher, /function updateRadialGaze\(deltaX: number, deltaY: number\)/);
  assert.match(launcher, /state\.radialGazeAngle = angle/);
  assert.match(styles, /\.bcp-favorites-radial-center\s*\{[\s\S]*?var\(--bcp-favorite-accent-end\)/);
  assert.match(styles, /\.bcp-favorites-radial-bot-eyes\s*\{[\s\S]*?rotate\(var\(--bcp-favorites-gaze-angle\)\)/);
  assert.match(styles, /@keyframes bcp-favorites-bot-blink/);
  assert.match(styles, /@keyframes bcp-favorites-bot-react/);
  assert.match(styles, /\.bcp-favorites-radial-center\.is-favorite/);
  assert.match(styles, /\.bcp-favorites-radial-center\.is-more/);
  assert.match(styles, /\.bcp-favorites-radial-center\.is-other/);
  assert.doesNotMatch(styles, /\.bcp-favorites-radial-copy/);
  assert.match(styles, /prefers-reduced-motion:[\s\S]*?\.bcp-favorites-radial-bot-eyes/);
});

test("uses a compact text-only send button in favorite rows", () => {
  const row = readFileSync(
    resolve(root, "src", "features", "favorites", "FavoriteItemRow.vue"),
    "utf8"
  );
  const styles = readFileSync(
    resolve(root, "src", "assets", "styles", "favorites.scss"),
    "utf8"
  );

  assert.match(row, /class="bcp-favorites-send"/);
  assert.match(row, /t\(["']favoritesSend["']\)/);
  assert.doesNotMatch(row, /telegram/);
  assert.match(styles, /\.bcp-favorites-send\s*\{[\s\S]*?border-radius:\s*14px/);
});

test("offers drag reordering with a keyboard-accessible fallback", () => {
  const component = readFileSync(
    resolve(root, "src", "features", "favorites", "FavoritesLauncher.vue"),
    "utf8"
  );
  const row = readFileSync(
    resolve(root, "src", "features", "favorites", "FavoriteItemRow.vue"),
    "utf8"
  );

  assert.match(component, /emit\("reorder", source\.id, target\.id, placement\)/);
  assert.match(row, /class="bcp-favorites-drag-handle"/);
  assert.match(row, /src="\.\.\/\.\.\/\.\.\/public\/assets\/icons\/drag\.svg"/);
  assert.match(row, /draggable="true"/);
  assert.match(row, /@dragstart\.stop=/);
  assert.match(row, /favoritesDragHint/);
  assert.match(row, /favoritesMoveUpAria/);
  assert.match(row, /favoritesMoveDownAria/);
});

test("routes long-lived capsule writes through the wakeable background service", () => {
  const launcher = readFileSync(resolve(root, "src", "features", "favorites", "launcher.ts"), "utf8");
  const repository = readFileSync(resolve(root, "src", "features", "favorites", "repository.ts"), "utf8");
  const worker = readFileSync(resolve(root, "src", "entries", "service-worker.ts"), "utf8");

  assert.match(launcher, /writeFavoriteInBackground\(text, currentRoom, payload\)/);
  assert.match(launcher, /chrome\.runtime\.sendMessage/);
  assert.match(launcher, /t\(["']favoritesExtensionUpdated["']\)/);
  assert.doesNotMatch(
    launcher,
    /if \(destroyed \|\| !ownsUi\(\) \|\| !extensionContextAvailable\(extensionId\)\) return null/
  );
  assert.match(repository, /STORAGE_OPERATION_TIMEOUT/);
  assert.match(repository, /保存收藏超时，请重试/);
  assert.match(repository, /FAVORITES_BACKUP_STORAGE_KEY/);
  assert.match(repository, /收藏写入校验失败，请重试/);
  assert.match(worker, /isFavoriteWriteRequest\(message\)/);
  assert.match(worker, /favoriteWriteQueue/);
  assert.match(worker, /favoritesRepository\.favorite\([\s\S]*?request\.text \|\| ""/);
  assert.match(worker, /favoritesRepository\.addToRoom/);
  assert.match(worker, /favoritesRepository\.recordSent/);
  assert.match(worker, /favoritesRepository\.remove/);
  assert.match(worker, /favoritesRepository\.reorder/);
  assert.match(launcher, /operation: "add-to-room"/);
  assert.match(launcher, /operation: "record-sent"/);
  assert.match(launcher, /operation: "remove"/);
  assert.match(launcher, /operation: "reorder"/);
  assert.match(
    launcher,
    /rankedFavorites\([\s\S]*?"current"[\s\S]*?"custom"[\s\S]*?\)\.slice\(0, 6\)/
  );
  assert.doesNotMatch(launcher, /await repository\.recordSent/);
});

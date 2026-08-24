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
      entry: resolve(root, "src", "platforms", "live", "emoji-fallback.ts"),
      fileName: () => "emoji-fallback.js",
      formats: ["iife"],
      name: "DanmakuEchoEmojiFallback"
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
if (!source) throw new Error("Could not build Emoji fallback test module");
const context = {};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "emoji-fallback.js" });
const { orderedBracketEmojiText, unicodeEmojiFallbackText } = context.DanmakuEchoEmojiFallback;

test("uses the full message when every image asset has an exact Unicode Emoji token", () => {
  assert.equal(
    unicodeEmojiFallbackText({
      text: "晚上好 👩🏽‍💻",
      assets: [{ token: "👩🏽‍💻" }]
    }),
    "晚上好 👩🏽‍💻"
  );
  assert.equal(
    unicodeEmojiFallbackText({
      text: "👨‍👩‍👧‍👦 🇨🇳 1️⃣",
      assets: [{ token: "👨‍👩‍👧‍👦" }, { token: "🇨🇳" }, { token: "1️⃣" }]
    }),
    "👨‍👩‍👧‍👦 🇨🇳 1️⃣"
  );
});

test("does not replace platform image Emoji with a bracketed resource name", () => {
  assert.equal(
    unicodeEmojiFallbackText({
      text: "[主播挥手]",
      assets: [{ token: "[主播挥手]" }]
    }),
    ""
  );
});

test("requires a Unicode token for every image asset", () => {
  assert.equal(
    unicodeEmojiFallbackText({
      text: "你好 👋",
      assets: [{ token: "👋" }, { token: "" }]
    }),
    ""
  );
  assert.equal(unicodeEmojiFallbackText({ text: "你好 👋", assets: [] }), "");
});

test("rebuilds Bilibili bracket Emoji in the original DOM order", () => {
  assert.equal(
    orderedBracketEmojiText({
      assets: [{ token: "[大哭]" }],
      parts: [{ type: "emoji", asset: { token: "[大哭]" } }],
      text: "[大哭]"
    }),
    "[大哭]"
  );
  assert.equal(
    orderedBracketEmojiText({
      assets: [{ token: "[大哭]" }, { token: "[大哭]" }],
      parts: [
        { type: "text", text: "加油啊" },
        { type: "emoji", asset: { token: "[大哭]" } },
        { type: "emoji", asset: { token: "[大哭]" } }
      ],
      text: "加油啊 [大哭] [大哭]"
    }),
    "加油啊[大哭][大哭]"
  );
  assert.equal(
    orderedBracketEmojiText({
      assets: [{ token: "[哇]" }, { token: "[大哭]" }],
      parts: [
        { type: "emoji", asset: { token: "[哇]" } },
        { type: "text", text: "文字" },
        { type: "emoji", asset: { token: "[大哭]" } }
      ]
    }),
    "[哇]文字[大哭]"
  );
});

test("does not guess a bracket Emoji order from incomplete rich parts", () => {
  assert.equal(
    orderedBracketEmojiText({
      assets: [{ token: "[哇]" }, { token: "[大哭]" }],
      parts: [{ type: "emoji", asset: { token: "[哇]" } }]
    }),
    ""
  );
  assert.equal(
    orderedBracketEmojiText({
      assets: [{ token: "[主播开心]" }],
      parts: [{ type: "emoji", asset: { token: "" } }]
    }),
    ""
  );
});

test("all three live adapters use the shared lossless Emoji fallback", () => {
  const sharedLiveSource = readFileSync(resolve(root, "src", "entries", "content.ts"), "utf8");
  const douyinSource = readFileSync(resolve(root, "src", "entries", "douyin-content.ts"), "utf8");
  assert.match(sharedLiveSource, /const unicodeFallback = unicodeEmojiFallbackText\(payload\);?/);
  assert.match(sharedLiveSource, /repeatPlatformRichPayload\(richPayload\);?/);
  assert.doesNotMatch(douyinSource, /unicodeEmojiFallbackText/);
  assert.match(douyinSource, /douyinAutoRecognizedEmojiText\(payload\)/);
});

test("Bilibili uses its native editor and Emoji panel", () => {
  const contentSource = readFileSync(resolve(root, "src", "entries", "content.ts"), "utf8");
  const fixtureSource = readFileSync(resolve(root, "tests", "fixture-server.cjs"), "utf8");
  assert.match(contentSource, /function emojiMetadataElements\(element, image\)/);
  assert.match(contentSource, /closestMatching\(element, config\.overlayMessages\)/);
  assert.match(contentSource, /async function openMatchingBilibiliPlatformEmoji\(input, asset\)/);
  assert.match(
    contentSource,
    /enrichRichPayloadAssetNames\(payload, \{ resolveBilibiliNative: true \}\)/
  );
  assert.match(contentSource, /function refreshRichPayloadText\(payload\)/);
  assert.match(
    contentSource,
    /markBilibiliPayloadAsNativePanel\(payload, resolvedSingleBilibiliItem\)/
  );
  assert.match(contentSource, /async function repeatPlatformRichPayload\(payload\)/);
  assert.match(
    contentSource,
    /const bilibiliInlineText = bilibiliSingleImagePayload \? ['"]['"] : bilibiliInlineEmojiText\(payload\)/
  );
  assert.match(contentSource, /return repeatMessage\(bilibiliInlineText\)/);
  assert.match(contentSource, /t\(['"]toastOfficialEmojiNotUnique['"]/);
  assert.match(contentSource, /LEGACY_BILIBILI_EXCLUSIVE_ASSET_KEY_PREFIX/);
  assert.match(contentSource, /current && depth < 12/);
  assert.match(contentSource, /async function openUniqueBilibiliPlatformEmoji\(input, asset\)/);
  assert.match(contentSource, /function findBilibiliEmojiEditor\(\)/);
  const editorSource =
    contentSource.match(
      /function findBilibiliEmojiEditor\(\)[\s\S]*?\n  }\n\n  function activateBilibiliQuickInput/
    )?.[0] || "";
  assert.doesNotMatch(editorSource, /closestMatching\(element, config\.videoRoots\)/);
  assert.match(contentSource, /const includeHidden = fullscreenActive\(\)/);
  assert.match(contentSource, /findPlatformEmojiToggle\(input, includeHidden\)/);
  const bilibiliChatRecoverySource =
    contentSource.match(
      /function bilibiliChatAssetDescriptor\(asset\)[\s\S]*?\n  }\n\n  function bilibiliCompleteEmojiTokens/
    )?.[0] || "";
  assert.doesNotMatch(bilibiliChatRecoverySource, /slice\(-60\)/);
  assert.match(bilibiliChatRecoverySource, /messageElementFromCandidate\(row\)/);
  assert.match(bilibiliChatRecoverySource, /messageEmojiImages\(row, messageElement\)/);
  assert.match(contentSource, /async function repeatBilibiliFavoritePayload\(payload\)/);
  assert.match(contentSource, /t\(['"]toastOfficialEmojiNotFound['"]/);
  assert.match(contentSource, /const nonDuplicateTextParts = meaningfulParts\.filter/);
  assert.doesNotMatch(contentSource, /return repeatMessage\(token\)/);
  assert.match(
    contentSource,
    /platformId === ['"]bilibili['"]\s*\? repeatBilibiliFavoritePayload\(payload\)/
  );
  assert.match(contentSource, /setNativeValue\(input, message\)/);
  assert.match(contentSource, /item\.click\(\)/);
  assert.match(contentSource, /button\.click\(\)/);
  assert.doesNotMatch(contentSource, /repeatBilibiliPayload/);
  assert.doesNotMatch(contentSource, /requestBilibiliSend/);
  assert.match(contentSource, /editor === input && fullscreenActive\(\) && playerCoversViewport/);
  const repositorySource = readFileSync(
    resolve(root, "src", "features", "favorites", "repository.ts"),
    "utf8"
  );
  assert.match(repositorySource, /favoriteAssetDisplayName/);
  assert.match(repositorySource, /names\.length/);
  assert.match(fixtureSource, /data-fixture-raw-exclusive=["']true["']/);
  assert.doesNotMatch(
    fixtureSource.match(
      /data-fixture-raw-exclusive=[\s\S]*?fixture-exclusive-emote[\s\S]*?>/
    )?.[0] || "",
    /data-file-id|data-danmaku|data-type=/
  );
  assert.match(fixtureSource, /fixture-exclusive-emote[\s\S]*?alt=["']\[图片表情\]["']/);
  assert.match(fixtureSource, /nameonlypanel/);
  assert.match(fixtureSource, /data-fixture-resource-id=["']room-happy-42["']/);
});

test("Huya, Douyu and Bilibili use independent rich-message senders", () => {
  const contentSource = readFileSync(resolve(root, "src", "entries", "content.ts"), "utf8");
  const coordinatorSource = readFileSync(
    resolve(root, "src", "platforms", "live", "rich-message-sender.ts"),
    "utf8"
  );
  const huyaSenderSource = readFileSync(
    resolve(root, "src", "platforms", "huya", "rich-message-sender.ts"),
    "utf8"
  );
  const douyuSenderSource = readFileSync(
    resolve(root, "src", "platforms", "douyu", "rich-message-sender.ts"),
    "utf8"
  );
  const bilibiliSenderSource = readFileSync(
    resolve(root, "src", "platforms", "bilibili", "rich-message-sender.ts"),
    "utf8"
  );
  const nameMessageSource = readFileSync(
    resolve(root, "src", "platforms", "live", "native-name-message.ts"),
    "utf8"
  );
  const editorConfigSource = readFileSync(
    resolve(root, "src", "platforms", "live", "editor-config.ts"),
    "utf8"
  );
  assert.match(contentSource, /const richMessageSender = liveRichMessageSender\(platformId\)/);
  assert.match(contentSource, /return richMessageSender\(payload,/);
  assert.match(coordinatorSource, /sendHuyaRichMessage/);
  assert.match(coordinatorSource, /sendDouyuRichMessage/);
  assert.match(coordinatorSource, /sendBilibiliRichMessage/);
  assert.match(huyaSenderSource, /runtime\.prepareEmojiNames/);
  assert.match(huyaSenderSource, /runtime\.sendText\(message\)/);
  assert.match(douyuSenderSource, /runtime\.sendText\(message\)/);
  assert.match(nameMessageSource, /orderedBracketEmojiText\(payload\)/);
  assert.match(nameMessageSource, /图片表情/);
  assert.match(editorConfigSource, /['"]rel['"]/);
  assert.match(contentSource, /function douyuImageRelToken\(element\)/);
  assert.match(contentSource, /element\.getAttribute\(['"]rel['"]\)/);
  assert.match(bilibiliSenderSource, /bilibiliAutoRecognizedEmojiText/);
  assert.match(bilibiliSenderSource, /runtime\.sendText\(message\)/);
  assert.match(bilibiliSenderSource, /runtime\.sendBilibiliNative\(payload\)/);
  assert.match(bilibiliSenderSource, /NATIVE_PANEL_ASSET_KEY_PREFIX/);
  assert.match(bilibiliSenderSource, /BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX/);
  assert.match(contentSource, /BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX/);
  assert.match(contentSource, /bilibiliAutoRecognizedEmojiText\(imagePayload\)/);
  assert.match(
    contentSource,
    /resolveBilibiliNative &&\s*bilibiliAutoRecognizedEmojiText\(payload\)/
  );
  assert.match(contentSource, /async function repeatBilibiliNativeRichPayload\(payload\)/);
  assert.match(contentSource, /createBilibiliEmoticonDebugAttempt\(payload\)/);
  assert.match(contentSource, /debug\.fail\(['"]unexpected-exception['"]/);
  assert.match(contentSource, /debug\.fail\(['"]panel-item-not-found['"]/);
  assert.match(contentSource, /debug\.fail\(['"]direct-send-failed['"]/);
  assert.match(
    contentSource,
    /const directRoomEmoticonIdentity = bilibiliRoomEmoticonIdentity\(asset\)/
  );
  assert.match(
    contentSource,
    /platformId !== ['"]bilibili['"] && Date\.now\(\) - dispatchedAt >= dispatchDelay/
  );
  assert.match(
    contentSource,
    /platformId === ['"]bilibili['"] &&\s*hasNewPlatformEmojiEcho\(asset, previousCount, previousImageMessageCount\)/
  );
  assert.match(
    contentSource,
    /platformId !== ['"]bilibili['"] && countChatImageMessages\(\) > previousImageMessageCount/
  );
  assert.match(contentSource, /async function repeatBilibiliRecognizedEmojiText/);
  assert.match(contentSource, /waitForNewPlatformEmojiEcho\(asset, previousCount, 3_200\)/);
  assert.match(contentSource, /NATIVE_PANEL_ASSET_KEY_PREFIX}matched-name:/);
  assert.doesNotMatch(contentSource, /BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX}panel-name:/);
  assert.match(contentSource, /startBilibiliNativeSendObservation/);
  assert.match(contentSource, /nativeSendResult/);
  assert.match(contentSource, /sourceHints: \[asset\?\.src\]\.filter\(Boolean\)/);
  assert.match(
    contentSource,
    /countMatchingPlatformEmojiAssets\(asset\) > previousCount \|\|\s*\(platformId !== ['"]bilibili['"] && countChatImageMessages\(\) > previousImageMessageCount\)/
  );
  assert.match(
    readFileSync(resolve(root, "tests", "fixture-server.cjs"), "utf8"),
    /unrelatedemoji/
  );
  assert.match(
    contentSource,
    /if \(platformId === ['"]bilibili['"]\) \{[\s\S]*?const direct = await sendDirectFallback\(\)[\s\S]*?if \(direct\.attempted\) return direct\.success/
  );
  assert.match(contentSource, /assetAfterPanelResolution: debug\.asset\(asset\)/);
  assert.doesNotMatch(contentSource, /function douyuEmojiCategoryCandidates\(/);
  assert.doesNotMatch(contentSource, /function findUniqueHuyaPlatformEmoji\(/);
  assert.doesNotMatch(contentSource, /async function openPlatformEmojiForAsset\(/);
  assert.match(contentSource, /function richEmojiMessageForValidation\(element\)/);
  assert.match(contentSource, /richEmojiMessageForValidation\(element\)/);
  assert.match(contentSource, /function overlayRichEmojiMessageForValidation\(element\)/);
  assert.match(contentSource, /overlayRichEmojiMessageForValidation\(element\)/);
  assert.match(contentSource, /namedImageEmoji/);
});

test("common feedback toasts wrap long Bilibili errors instead of clipping them", () => {
  const contentStyles = readFileSync(
    resolve(root, "src", "assets", "styles", "content.css"),
    "utf8"
  );
  const toastRule = contentStyles.match(/\.bcp-one-toast\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(toastRule, /height:\s*auto/);
  assert.match(toastRule, /overflow-wrap:\s*anywhere/);
  assert.match(toastRule, /white-space:\s*normal/);
  assert.doesNotMatch(toastRule, /overflow:\s*hidden/);
});

test("Douyin sends native image Emoji as bracket text without using the panel", () => {
  const contentSource = readFileSync(resolve(root, "src", "entries", "douyin-content.ts"), "utf8");
  const pageHookSource = readFileSync(
    resolve(root, "src", "entries", "douyin-page-hook.ts"),
    "utf8"
  );
  assert.match(
    contentSource,
    /function richPayloadFromRendererContent\(canvasText, rendererContent\)/
  );
  assert.match(
    contentSource,
    /return mergeRendererPayloadWithChatRow\(rendererPayload, matched, canvasText\)/
  );
  assert.match(contentSource, /const nativeText = douyinAutoRecognizedEmojiText\(payload\)/);
  assert.match(contentSource, /setInputValue\(input, nativeText\)/);
  assert.doesNotMatch(contentSource, /function insertEmojiAsset\(/);
  assert.doesNotMatch(contentSource, /emoji-panel-open-request/);
  assert.doesNotMatch(contentSource, /emoji-asset-not-found/);
  assert.match(
    pageHookSource,
    /serializedBarrageText\(content\)/
  );
  assert.match(contentSource, /findDouyinMessageContent\(row, MESSAGE_TEXT_SELECTORS\)/);
  assert.match(pageHookSource, /type: ["']own-message-consumed["']/);
});

test("Douyin frames manually sent native Emoji by resource identity", () => {
  const contentSource = readFileSync(resolve(root, "src", "entries", "douyin-content.ts"), "utf8");
  const pageHookSource = readFileSync(
    resolve(root, "src", "entries", "douyin-page-hook.ts"),
    "utf8"
  );
  assert.match(contentSource, /function rememberManualEmojiClick\(event\)/);
  assert.match(
    contentSource,
    /document\.addEventListener\(["']click["'], rememberManualEmojiClick, true\)/
  );
  assert.match(
    contentSource,
    /type: ["']own-message-intent["'],[\s\S]*?plainText: payload\.plainText,[\s\S]*?assets: payload\.assets/
  );
  assert.match(pageHookSource, /allAssetsMatch\(item\.assets, observedAssets\)/);
  assert.match(pageHookSource, /douyinOwnMessageTextMatches\(/);
  assert.match(pageHookSource, /!item\.text \|\| textMatches/);
  assert.match(pageHookSource, /own: consumeOwnMessage\(description\.text, content\)/);
});

test("Douyin detects manual sends and reconciles a renderer race", () => {
  const contentSource = readFileSync(resolve(root, "src", "entries", "douyin-content.ts"), "utf8");
  const pageHookSource = readFileSync(
    resolve(root, "src", "entries", "douyin-page-hook.ts"),
    "utf8"
  );
  assert.match(contentSource, /debugEvent\(\s*["']manual-send-detected["']/);
  assert.match(contentSource, /const clickedSend = path\.find/);
  assert.match(contentSource, /matchesAny\(item, SEND_BUTTON_SELECTORS\)/);
  assert.match(pageHookSource, /function reconcileRecentOwnMessage\(item, now\)/);
  assert.match(pageHookSource, /track\.renderer\.barrage\.dataset\.own = "true"/);
  assert.match(pageHookSource, /"own-barrage-reconciled"/);
});

test("Douyin never selects the whole page while clearing a failed rich +1", () => {
  const contentSource = readFileSync(resolve(root, "src", "entries", "douyin-content.ts"), "utf8");
  assert.doesNotMatch(contentSource, /execCommand\(["']selectAll["']/);
  assert.match(contentSource, /range\.selectNodeContents\(input\)/);
  assert.match(
    contentSource,
    /selection\.removeAllRanges\(\);?[\s\S]*?selection\.addRange\(range\)/
  );
  assert.match(
    contentSource,
    /cancelOwnMessageAnnouncement\(ownIntentId\);?[\s\S]*?setInputValue\(input, ["']["']\)/
  );
});

test("preserves colon-bearing danmaku through the Douyin +1 path", () => {
  const contentSource = readFileSync(resolve(root, "src", "entries", "douyin-content.ts"), "utf8");
  // Renderer/canvas text, editor input and chat rows share the same pure
  // normalization: messages like "13:0了" must never be treated as an inline
  // "用户名：消息" prefix, or sender correlation breaks for colon messages.
  assert.match(
    contentSource,
    /shared\.parseMessageText\(canvasText, MAX_LENGTH\)[\s\S]*?plainText \|\|/
  );
  assert.match(contentSource, /const message = shared\.parseMessageText\(data\.text, MAX_LENGTH\)/);
  assert.match(contentSource, /richPayloadFromElement\(messageContentElement\(row\)\)/);
  const sharedSource = readFileSync(resolve(root, "src", "core", "shared.ts"), "utf8");
  assert.match(sharedSource, /export function parseMessageText/);
  assert.doesNotMatch(sharedSource, /export function parseChatRowText/);
});

test("extracts senders inside the concrete message boundary", () => {
  const contentSource = readFileSync(resolve(root, "src", "entries", "douyin-content.ts"), "utf8");
  // Real Douyin chat rows share the "webcast-chatroom" class with the chat
  // root container. The sender must be read BEFORE the upward walk breaks on
  // a chat-root selector, or every real row returns an empty sender and all
  // replies fail with "未能识别到这条弹幕的发送者".
  const senderFromChatRow =
    contentSource.match(/function senderFromChatRow\(row\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(
    senderFromChatRow,
    /const sender = senderFromChatContext\(current, depth === 0\)[\s\S]*?if \(sender\) return sender[\s\S]*?if \(matchesAny\(current, CHAT_ROOT_SELECTORS\)\) break/
  );
  assert.doesNotMatch(
    senderFromChatRow,
    /if \(matchesAny\(current, CHAT_ROOT_SELECTORS\)\) break[\s\S]*?senderFromChatContext/
  );
  const sharedContentSource = readFileSync(resolve(root, "src", "entries", "content.ts"), "utf8");
  const sharedSenderContext =
    sharedContentSource.match(
      /function senderFromChatContext\(candidate\) \{[\s\S]*?\n  \}/
    )?.[0] || "";
  assert.match(
    sharedSenderContext,
    /matchesAny\(boundaryCursor, config\.messages\)[\s\S]*?matchesAny\(boundaryCursor, config\.chatRoots\)/
  );
  assert.match(
    sharedSenderContext,
    /const sender = senderFromElement\(current\)[\s\S]*?if \(sender\) return sender[\s\S]*?if \(current === boundary\) break/
  );
});

test("remembers senders from recycled Douyin chat rows", () => {
  const contentSource = readFileSync(resolve(root, "src", "entries", "douyin-content.ts"), "utf8");
  // Douyin's virtual chat list can recycle a row before the scheduled sender
  // scan sees it. Senders must be extracted from mutation.removedNodes so a
  // reply resolves even after the row is gone from the live DOM.
  assert.match(contentSource, /function rememberRemovedChatSenders\(nodes\)/);
  assert.match(
    contentSource,
    /const removedSenders = mutations\.flatMap\([\s\S]*?mutation\.removedNodes/
  );
  assert.match(contentSource, /rememberRemovedChatSenders\(removedSenders\)/);
  assert.match(contentSource, /const REPLY_RESOLVE_ATTEMPTS = 36/);
});

test("favorites accepts complete rich payloads instead of rejecting image Emoji", () => {
  const launcherSource = readFileSync(
    resolve(root, "src", "features", "favorites", "launcher.ts"),
    "utf8"
  );
  assert.doesNotMatch(launcherSource, /暂不支持收藏/);
  assert.match(launcherSource, /writeFavoriteInBackground\(text, currentRoom, payload\)/);
  assert.match(launcherSource, /options\.sendFavorite\(item\.payload\)/);
});

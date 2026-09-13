import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  const sharedLiveSource = readFileSync(resolve(root, "src", "entries", "content-app.ts"), "utf8");
  const senderSources = ["bilibili", "douyu", "huya"].map((platform) =>
    readFileSync(resolve(root, "src", "platforms", platform, "sender.ts"), "utf8")
  );
  const douyinSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "send-controller.ts"),
    "utf8"
  );
  for (const senderSource of senderSources) {
    assert.match(senderSource, /const unicodeFallback = unicodeEmojiFallbackText\(payload\);?/);
  }
  assert.doesNotMatch(sharedLiveSource, /unicodeEmojiFallbackText/);
  assert.doesNotMatch(sharedLiveSource, /repeatPlatformRichPayload/);
  assert.match(sharedLiveSource, /platformSender\.sendRich\(richPayload\);?/);
  assert.doesNotMatch(douyinSource, /unicodeEmojiFallbackText/);
  assert.match(douyinSource, /douyinAutoRecognizedEmojiText\(payload\)/);
});

test("Bilibili uses its native editor and Emoji panel", () => {
  const contentSource = readFileSync(resolve(root, "src", "entries", "content-app.ts"), "utf8");
  const senderSource = readFileSync(
    resolve(root, "src", "platforms", "bilibili", "sender.ts"),
    "utf8"
  );
  const editorControllerSource = readFileSync(
    resolve(root, "src", "platforms", "live", "editor-controller.ts"),
    "utf8"
  );
  const bilibiliRichEmojiSource = readFileSync(
    resolve(root, "src", "platforms", "bilibili", "rich-emoji.ts"),
    "utf8"
  );
  const fixtureSource = readFileSync(resolve(root, "tests", "browser", "fixture-server.cjs"), "utf8");
  assert.match(contentSource, /function emojiMetadataElements\([\s\S]*?element: Element,[\s\S]*?image: HTMLImageElement \| null/);
  assert.match(contentSource, /closestMatching\(element, config\.overlayMessages\)/);
  assert.match(contentSource, /function refreshRichPayloadText\(payload: RichMessagePayload\)/);
  assert.doesNotMatch(contentSource, /async function repeatPlatformRichPayload\(payload\)/);
  assert.match(contentSource, /const bilibiliSender = new BilibiliSender\(/);
  assert.match(contentSource, /const platformSender =/);
  assert.match(contentSource, /platformSender\.sendRich\(/);
  assert.match(contentSource, /platformSender\.sendFavorite\(/);
  assert.match(
    senderSource,
    /const inlineText = resolvedSingleImagePayload[\s\S]*?bilibiliInlineEmojiText\(payload, runtime\.isGenericEmojiLabel\)/
  );
  assert.match(senderSource, /return this\.sendText\(inlineText\)/);
  assert.match(senderSource, /t\(['"]toastOfficialEmojiNotUnique['"]/);
  assert.match(senderSource, /LEGACY_BILIBILI_EXCLUSIVE_ASSET_KEY_PREFIX/);
  assert.match(senderSource, /private async openUniqueEmoji\(/);
  assert.match(senderSource, /uniqueBilibiliPanelItem\(/);
  assert.match(contentSource, /function findBilibiliEmojiEditor\(\): HTMLElement \| null/);
  assert.match(contentSource, /const input = replyController\.findEmojiEditor\(\)/);
  assert.match(editorControllerSource, /findEmojiEditor\(\): Element \| null/);
  assert.match(editorControllerSource, /!insideFullscreen &&[\s\S]*?!this\.isQuickInput\(element\)/);
  assert.match(senderSource, /const includeHidden = this\.#runtime\.fullscreenActive\(\)/);
  assert.match(senderSource, /this\.#runtime\.emojiToggles\(input, includeHidden\)/);
  assert.doesNotMatch(bilibiliRichEmojiSource, /slice\(-60\)/);
  assert.match(bilibiliRichEmojiSource, /options\.messageElement\(row\)/);
  assert.match(bilibiliRichEmojiSource, /options\.listMessageImages\(row, messageElement\)/);
  assert.match(senderSource, /async sendFavorite\(payload: RichMessagePayload\)/);
  assert.match(senderSource, /t\(['"]toastOfficialEmojiNotFound['"]/);
  assert.match(senderSource, /const nonDuplicateTextParts = meaningfulParts\.filter/);
  assert.doesNotMatch(senderSource, /return this\.#runtime\.sendText\(token\)/);
  assert.match(senderSource, /runtime\.setNativeValue\(input, message\)/);
  assert.match(senderSource, /item\.click\(\)/);
  assert.match(senderSource, /button\.click\(\)/);
  assert.doesNotMatch(contentSource, /repeatBilibiliPayload/);
  assert.doesNotMatch(contentSource, /requestBilibiliSend/);
  assert.doesNotMatch(contentSource, /BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE/);
  assert.doesNotMatch(contentSource, /BILIBILI_INSTALL_NATIVE_SEND_OBSERVER/);
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
  const contentSource = readFileSync(resolve(root, "src", "entries", "content-app.ts"), "utf8");
  const platformSenderSource = readFileSync(
    resolve(root, "src", "platforms", "live", "platform-sender.ts"),
    "utf8"
  );
  const textSenderSource = readFileSync(
    resolve(root, "src", "platforms", "live", "text-sender.ts"),
    "utf8"
  );
  const huyaSenderSource = readFileSync(
    resolve(root, "src", "platforms", "huya", "sender.ts"),
    "utf8"
  );
  const douyuSenderSource = readFileSync(
    resolve(root, "src", "platforms", "douyu", "sender.ts"),
    "utf8"
  );
  const bilibiliRichMessageSource = readFileSync(
    resolve(root, "src", "platforms", "bilibili", "rich-message-sender.ts"),
    "utf8"
  );
  const bilibiliPlatformSenderSource = readFileSync(
    resolve(root, "src", "platforms", "bilibili", "sender.ts"),
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
  const douyuRichEmojiSource = readFileSync(
    resolve(root, "src", "platforms", "douyu", "rich-emoji.ts"),
    "utf8"
  );
  const bilibiliRichEmojiSource = readFileSync(
    resolve(root, "src", "platforms", "bilibili", "rich-emoji.ts"),
    "utf8"
  );
  assert.match(platformSenderSource, /interface LivePlatformSender/);
  assert.match(platformSenderSource, /prepareFavorite\(payload: RichMessagePayload\)/);
  assert.match(textSenderSource, /class LiveTextSender/);
  assert.match(textSenderSource, /runtime\.coordinator\.settle\(/);
  assert.match(contentSource, /const bilibiliSender = new BilibiliSender\(/);
  assert.match(contentSource, /const douyuSender = new DouyuSender\(/);
  assert.match(contentSource, /const huyaSender = new HuyaSender\(/);
  assert.match(contentSource, /const platformSender =/);
  assert.match(contentSource, /platformSender\.sendRich\(/);
  assert.match(contentSource, /platformSender\.sendText\(/);
  assert.match(contentSource, /platformSender\.sendFavorite\(/);
  assert.doesNotMatch(contentSource, /liveRichMessageSender/);
  assert.doesNotMatch(contentSource, /repeatDouyuNativeRichPayload/);
  assert.doesNotMatch(contentSource, /async function repeatMessage\(/);
  assert.match(huyaSenderSource, /this\.#runtime\.completeEmojiTokens\(payload\)/);
  assert.match(huyaSenderSource, /nativeEmojiNameMessage\(payload\)/);
  assert.match(huyaSenderSource, /this\.#runtime\.textSender\.send\(message\)/);
  assert.match(douyuSenderSource, /isDouyuNativeImagePayload\(payload\)/);
  assert.match(douyuSenderSource, /this\.openMatchingEmoji\(input, asset\)/);
  assert.match(douyuSenderSource, /runtime\.waitForEmojiResult\(/);
  assert.match(douyuSenderSource, /runtime\.coordinator\.settle\(/);
  assert.match(douyuSenderSource, /this\.#runtime\.textSender\.send\(message\)/);
  assert.match(nameMessageSource, /orderedBracketEmojiText\(payload\)/);
  assert.match(nameMessageSource, /图片表情/);
  assert.match(editorConfigSource, /['"]rel['"]/);
  assert.match(contentSource, /douyuEmojiToken\(element/);
  assert.match(douyuRichEmojiSource, /image\.getAttribute\(['"]rel['"]\)/);
  assert.match(bilibiliRichMessageSource, /bilibiliAutoRecognizedEmojiText/);
  assert.match(bilibiliRichMessageSource, /runtime\.sendText\(message\)/);
  assert.match(bilibiliRichMessageSource, /runtime\.sendBilibiliNative\(payload\)/);
  assert.match(bilibiliRichMessageSource, /NATIVE_PANEL_ASSET_KEY_PREFIX/);
  assert.match(bilibiliRichMessageSource, /BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX/);
  assert.match(bilibiliRichEmojiSource, /BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX/);
  assert.match(bilibiliPlatformSenderSource, /bilibiliAutoRecognizedEmojiText\(imagePayload\)/);
  assert.match(
    bilibiliPlatformSenderSource,
    /if \(bilibiliAutoRecognizedEmojiText\(payload\)\)/
  );
  assert.match(bilibiliPlatformSenderSource, /async sendRich\(payload: RichMessagePayload\)/);
  assert.match(bilibiliPlatformSenderSource, /createBilibiliEmoticonDebugAttempt\(payload\)/);
  assert.match(bilibiliPlatformSenderSource, /debug\.fail\(['"]unexpected-exception['"]/);
  assert.match(bilibiliPlatformSenderSource, /debug\.fail\(['"]panel-item-not-found['"]/);
  assert.match(bilibiliPlatformSenderSource, /debug\.fail\(['"]direct-send-failed['"]/);
  assert.match(
    bilibiliPlatformSenderSource,
    /const identity = bilibiliRoomEmoticonIdentity\(asset\)/
  );
  assert.match(
    contentSource,
    /platformId !== ['"]bilibili['"] && Date\.now\(\) - dispatchedAt >= dispatchDelay/
  );
  assert.match(
    bilibiliPlatformSenderSource,
    /runtime\.countMatchingAssets\(asset\) > previousCount/
  );
  assert.match(
    contentSource,
    /platformId !== ['"]bilibili['"] && countChatImageMessages\(\) > previousImageMessageCount/
  );
  assert.match(bilibiliPlatformSenderSource, /async sendRecognizedText\(/);
  assert.match(bilibiliPlatformSenderSource, /runtime\.waitForNewEcho\(asset, previousCount, 3_200\)/);
  assert.match(bilibiliPlatformSenderSource, /NATIVE_PANEL_ASSET_KEY_PREFIX}matched-name:/);
  assert.doesNotMatch(bilibiliPlatformSenderSource, /BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX}panel-name:/);
  assert.match(bilibiliPlatformSenderSource, /startNativeSendObservation/);
  assert.match(bilibiliPlatformSenderSource, /nativeResult/);
  assert.match(bilibiliPlatformSenderSource, /sourceHints: \[asset\.src\]\.filter\(Boolean\)/);
  assert.match(
    contentSource,
    /countMatchingPlatformEmojiAssets\(asset\) > previousCount \|\|\s*\(platformId !== ['"]bilibili['"] && countChatImageMessages\(\) > previousImageMessageCount\)/
  );
  assert.match(
    readFileSync(resolve(root, "tests", "browser", "fixture-server.cjs"), "utf8"),
    /unrelatedemoji/
  );
  assert.match(
    bilibiliPlatformSenderSource,
    /const direct = await sendDirectFallback\(['"]panel-send-unconfirmed['"]\)[\s\S]*?if \(direct\.attempted\)/
  );
  assert.match(bilibiliPlatformSenderSource, /assetAfterPanelResolution: debug\.asset\(asset\)/);
  assert.doesNotMatch(contentSource, /function douyuEmojiCategoryCandidates\(/);
  assert.doesNotMatch(contentSource, /function findUniqueHuyaPlatformEmoji\(/);
  assert.doesNotMatch(contentSource, /async function openPlatformEmojiForAsset\(/);
  assert.match(contentSource, /function richEmojiMessageForValidation\(element: Element\)/);
  assert.match(contentSource, /richEmojiMessageForValidation\(node\)/);
  assert.match(contentSource, /function overlayRichEmojiMessageForValidation\(element: Element\)/);
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
  const editorSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "editor-controller.ts"),
    "utf8"
  );
  const sendControllerSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "send-controller.ts"),
    "utf8"
  );
  const chatParserSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "chat-parser.ts"),
    "utf8"
  );
  const resolverSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "rich-content-resolver.ts"),
    "utf8"
  );
  const pageAppSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "page", "page-app.ts"),
    "utf8"
  );
  const pageBarrageContentSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "page", "barrage-content.ts"),
    "utf8"
  );
  assert.match(
    resolverSource,
    /function fromRenderer\(/
  );
  assert.match(
    resolverSource,
    /const payload = mergeRendererPayloadWithChat\(rendererPayload, matched, canvasText\)/
  );
  assert.match(sendControllerSource, /const nativeText = douyinAutoRecognizedEmojiText\(payload\)/);
  assert.match(sendControllerSource, /options\.editor\.setValue\(editor, nativeText\)/);
  assert.match(editorSource, /setter\.call\(editor, value\)/);
  assert.doesNotMatch(contentSource, /function insertEmojiAsset\(/);
  assert.doesNotMatch(contentSource, /emoji-panel-open-request/);
  assert.doesNotMatch(contentSource, /emoji-asset-not-found/);
  assert.match(
    pageBarrageContentSource,
    /serializedBarrageText\(content\)/
  );
  assert.match(pageAppSource, /prepareDouyinBarrage/);
  assert.match(chatParserSource, /findDouyinMessageContent\(row, MESSAGE_TEXT_SELECTORS\)/);
  assert.match(pageAppSource, /type: ["']own-message-consumed["']/);
});

test("Douyin frames manually sent native Emoji by resource identity", () => {
  const ownMessageControllerSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "own-message-controller.ts"),
    "utf8"
  );
  const pageAppSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "page", "page-app.ts"),
    "utf8"
  );
  const ownMessageMatcherSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "page", "own-message-matcher.ts"),
    "utf8"
  );
  assert.match(ownMessageControllerSource, /function rememberManualEmojiClick\(/);
  assert.match(
    ownMessageControllerSource,
    /document\.addEventListener\(["']click["'], onClick, true\)/
  );
  assert.match(
    ownMessageControllerSource,
    /options\.sendToPage\(\{[\s\S]*?assets: payload\.assets,[\s\S]*?intentId,[\s\S]*?plainText: payload\.plainText,[\s\S]*?type: ["']own-message-intent["']/
  );
  assert.match(ownMessageMatcherSource, /allAssetsMatch\(intent\.assets, observed\.assets\)/);
  assert.match(ownMessageMatcherSource, /douyinOwnMessageTextMatches\(/);
  assert.match(ownMessageMatcherSource, /!intent\.text \|\| textMatches/);
  assert.match(pageAppSource, /ownMessageMatcher\.match\(track\)/);
});

test("Douyin detects manual sends and reconciles a renderer race", () => {
  const ownMessageControllerSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "own-message-controller.ts"),
    "utf8"
  );
  const pageAppSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "page", "page-app.ts"),
    "utf8"
  );
  const ownMessageMatcherSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "page", "own-message-matcher.ts"),
    "utf8"
  );
  assert.match(ownMessageControllerSource, /["']manual-send-detected["']/);
  assert.match(ownMessageControllerSource, /const clickedSend = path\.find/);
  assert.match(ownMessageControllerSource, /matchesAny\(item, SEND_BUTTON_SELECTORS\)/);
  assert.match(ownMessageMatcherSource, /const reconcileRecent = \(/);
  assert.match(ownMessageMatcherSource, /intent\.source\.startsWith\(['"]manual-['"]\)/);
  assert.match(pageAppSource, /createRendererOwnMessageMatcher\(/);
  assert.match(pageAppSource, /domRenderer\.markTrackOwn\(event\.track\)/);
  assert.match(pageAppSource, /["']own-barrage-reconciled["']/);
});

test("Douyin never selects the whole page while clearing a failed rich +1", () => {
  const contentSource = readFileSync(resolve(root, "src", "entries", "douyin-content.ts"), "utf8");
  const editorSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "editor-controller.ts"),
    "utf8"
  );
  const sendControllerSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "send-controller.ts"),
    "utf8"
  );
  assert.doesNotMatch(contentSource, /execCommand\(["']selectAll["']/);
  assert.doesNotMatch(editorSource, /execCommand\(["']selectAll["']/);
  assert.match(editorSource, /range\.selectNodeContents\(editor\)/);
  assert.match(
    editorSource,
    /selection\.removeAllRanges\(\);?[\s\S]*?selection\.addRange\(range\)/
  );
  assert.match(
    sendControllerSource,
    /cancelOwnMessageAnnouncement\(ownIntentId\);?[\s\S]*?options\.editor\.setValue\(editor, ["']["']\)/
  );
});

test("preserves colon-bearing danmaku through the Douyin +1 path", () => {
  const chatParserSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "chat-parser.ts"),
    "utf8"
  );
  const resolverSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "rich-content-resolver.ts"),
    "utf8"
  );
  const actionDispatcherSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "action-dispatcher.ts"),
    "utf8"
  );
  // Renderer/canvas text, editor input and chat rows share the same pure
  // normalization: messages like "13:0了" must never be treated as an inline
  // "用户名：消息" prefix, or sender correlation breaks for colon messages.
  assert.match(
    resolverSource,
    /const canvasText = parseMessageText\(canvasTextValue, maxLength\)[\s\S]*?const text = canvasText \|\| plainText \|\|/
  );
  assert.match(
    actionDispatcherSource,
    /function normalizeMessage\(value: unknown\)[\s\S]*?options\.parseMessage\(value, maxLength\)/
  );
  assert.match(actionDispatcherSource, /const text = normalizeMessage\(message\.text\)/);
  assert.match(chatParserSource, /const rawPayload = payloadFromElement\(content\)/);
  assert.match(chatParserSource, /parseMessageText\(plainClone\.textContent, maxLength\)/);
  const sharedSource = readFileSync(resolve(root, "src", "core", "shared.ts"), "utf8");
  assert.match(sharedSource, /export function parseMessageText/);
  assert.doesNotMatch(sharedSource, /export function parseChatRowText/);
});

test("extracts senders inside the concrete message boundary", () => {
  const chatParserSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "chat-parser.ts"),
    "utf8"
  );
  // Real Douyin chat rows share the "webcast-chatroom" class with the chat
  // root container. The sender must be read BEFORE the upward walk breaks on
  // a chat-root selector, or every real row returns an empty sender and all
  // replies fail with "未能识别到这条弹幕的发送者".
  const senderFromChatRow =
    chatParserSource.match(
      /function senderFromChatRow\(row: Element\): string \{[\s\S]*?\n  \}/
    )?.[0] || "";
  assert.match(
    senderFromChatRow,
    /const sender = senderFromChatContext\(current, depth === 0\)[\s\S]*?if \(sender\) return sender[\s\S]*?if \(matchesAny\(current, CHAT_ROOT_SELECTORS\)\) break/
  );
  assert.doesNotMatch(
    senderFromChatRow,
    /if \(matchesAny\(current, CHAT_ROOT_SELECTORS\)\) break[\s\S]*?senderFromChatContext/
  );
  const sharedContentSource = readFileSync(resolve(root, "src", "entries", "content-app.ts"), "utf8");
  const sharedSenderContext =
    sharedContentSource.match(
      /function senderFromChatContext\(candidate: Element\): string \{[\s\S]*?\n  \}/
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
  const contentSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "content-app.ts"),
    "utf8"
  );
  const ownMessageControllerSource = readFileSync(
    resolve(root, "src", "platforms", "douyin", "content", "own-message-controller.ts"),
    "utf8"
  );
  // Douyin's virtual chat list can recycle a row before the scheduled sender
  // scan sees it. Senders must be extracted from mutation.removedNodes so a
  // reply resolves even after the row is gone from the live DOM.
  assert.match(ownMessageControllerSource, /function rememberRemovedRows\(nodes:/);
  assert.match(
    ownMessageControllerSource,
    /function handleMutations\(mutations:[\s\S]*?removedNodes\.push\(\.\.\.mutation\.removedNodes/
  );
  assert.match(
    ownMessageControllerSource,
    /if \(removedNodes\.length\) rememberRemovedRows\(removedNodes\)/
  );
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

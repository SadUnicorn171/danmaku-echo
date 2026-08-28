import type { DouyinRuntimeRequest, PlatformId } from "../core/types";
import {
  isBilibiliDirectEmoticonSendRequest,
  sendBilibiliRoomEmoticonInPage,
  type BilibiliDirectEmoticonSendResponse
} from "../platforms/bilibili/direct-emoticon-send";
import {
  installBilibiliNativeSendObserverInPage,
  isBilibiliInstallNativeSendObserverRequest
} from "../platforms/bilibili/native-send-observer";
import {
  installNativeSendObserverInPage,
  isInstallNativeSendObserverRequest
} from "../platforms/live/native-send-observer";
import { createFavoritesRepository } from "../features/favorites/repository";
import {
  FAVORITE_WRITE_MESSAGE,
  type FavoriteWriteRequest,
  type FavoriteWriteResponse
} from "../features/favorites/types";
import {
  LIVE_AUDIENCE_FRAME_STALE_MS,
  isLiveAudienceFrameReadRequest,
  isLiveAudienceFrameReportRequest,
  type LiveAudienceFrameResponse,
} from "../features/repeat-reminder/audience-api";
import type { LiveAudienceMetric } from "../features/repeat-reminder/live-audience";
import {
  DOUYIN_EMOJI_CATALOG_ENDPOINT,
  douyinEmojiCatalogEntries,
  douyinEmojiCatalogVersion,
  isDouyinEmojiCatalogRequest,
  type DouyinEmojiCatalogEntry,
  type DouyinEmojiCatalogResponse,
} from "../platforms/douyin/emoji-catalog";

const DOUYIN_LIVE_PATTERN = /^https:\/\/(?:live\.douyin\.com\/|www\.douyin\.com\/follow\/live(?:\/|[?#]|$))/i;
const recentRouteInjections = new Map<number, { at: number; url: string }>();
const pendingDouyinRuntimeEnsures = new Map<string, Promise<{ contentInjected: boolean }>>();
const favoritesRepository = createFavoritesRepository(chrome.storage.local);
let favoriteWriteQueue: Promise<void> = Promise.resolve();
const frameAudienceCache = new Map<number, { expiresAt: number; metric: LiveAudienceMetric }>();
const DOUYIN_EMOJI_CATALOG_CACHE_KEY = "danmakuEchoDouyinEmojiCatalogV1";
const DOUYIN_EMOJI_CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
let pendingDouyinEmojiCatalog: Promise<DouyinEmojiCatalogResponse> | null = null;

interface DouyinEmojiCatalogCache {
  entries: DouyinEmojiCatalogEntry[];
  updatedAt: number;
  version: string;
}

function validDouyinEmojiCatalogCache(value: unknown): value is DouyinEmojiCatalogCache {
  if (!value || typeof value !== "object") return false;
  const cache = value as Partial<DouyinEmojiCatalogCache>;
  return Number.isFinite(cache.updatedAt)
    && typeof cache.version === "string"
    && Array.isArray(cache.entries)
    && cache.entries.length > 0
    && cache.entries.length <= 2_000;
}

async function readDouyinEmojiCatalogCache(): Promise<DouyinEmojiCatalogCache | null> {
  const stored = await chrome.storage.local.get(DOUYIN_EMOJI_CATALOG_CACHE_KEY);
  const cache = stored[DOUYIN_EMOJI_CATALOG_CACHE_KEY];
  return validDouyinEmojiCatalogCache(cache) ? cache : null;
}

async function fetchDouyinEmojiCatalog(): Promise<DouyinEmojiCatalogResponse> {
  const cached = await readDouyinEmojiCatalogCache();
  if (cached && Date.now() - cached.updatedAt < DOUYIN_EMOJI_CATALOG_MAX_AGE_MS) {
    return { entries: cached.entries, ok: true, version: cached.version };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(DOUYIN_EMOJI_CATALOG_ENDPOINT, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`emoji-catalog-http-${response.status}`);
    const payload: unknown = await response.json();
    const entries = douyinEmojiCatalogEntries(payload);
    if (entries.length < 20) throw new Error("emoji-catalog-empty");
    const catalog: DouyinEmojiCatalogCache = {
      entries,
      updatedAt: Date.now(),
      version: douyinEmojiCatalogVersion(payload),
    };
    await chrome.storage.local.set({ [DOUYIN_EMOJI_CATALOG_CACHE_KEY]: catalog });
    return { entries, ok: true, version: catalog.version };
  } catch (error: unknown) {
    if (cached) return { entries: cached.entries, ok: true, version: cached.version };
    return {
      error: String(error instanceof Error ? error.message : error).slice(0, 160),
      ok: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function loadDouyinEmojiCatalog(): Promise<DouyinEmojiCatalogResponse> {
  if (pendingDouyinEmojiCatalog) return pendingDouyinEmojiCatalog;
  const request = fetchDouyinEmojiCatalog().finally(() => {
    if (pendingDouyinEmojiCatalog === request) pendingDouyinEmojiCatalog = null;
  });
  pendingDouyinEmojiCatalog = request;
  return request;
}

function isDouyinLiveUrl(value: unknown): boolean {
  return DOUYIN_LIVE_PATTERN.test(String(value || ""));
}

function isFavoriteWriteRequest(value: unknown): value is FavoriteWriteRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<FavoriteWriteRequest>;
  const operation = request.operation || "favorite";
  const room = request.room;
  return request.type === FAVORITE_WRITE_MESSAGE
    && (operation === "favorite" || operation === "add-to-room" || operation === "move"
      || operation === "record-sent" || operation === "remove"
      || operation === "reorder" || operation === "set-pinned" || operation === "set-tags")
    && (operation === "favorite"
      ? typeof request.text === "string"
        && Array.from(request.text).length > 0
        && Array.from(request.text).length <= 1_000
      : typeof request.id === "string" && request.id.length > 0 && request.id.length <= 200)
    && (operation !== "reorder" || (typeof request.targetId === "string"
      && request.targetId.length > 0 && request.targetId.length <= 200
      && (request.placement === "after" || request.placement === "before")))
    && Boolean(room && typeof room === "object"
      && (room.platform === "bilibili" || room.platform === "douyin"
        || room.platform === "douyu" || room.platform === "huya")
      && typeof room.roomId === "string" && room.roomId.length > 0 && room.roomId.length <= 300
      && typeof room.roomKey === "string" && room.roomKey.length <= 320
      && typeof room.roomName === "string" && room.roomName.length > 0 && room.roomName.length <= 500
      && typeof room.url === "string" && room.url.length > 0 && room.url.length <= 4_096
      && room.roomKey === `${room.platform}:${room.roomId}`);
}

function senderMatchesPlatform(senderUrl: unknown, platform: PlatformId): boolean {
  try {
    const url = new URL(String(senderUrl || ""));
    const host = url.hostname.toLowerCase();
    if (platform === "bilibili") return host === "live.bilibili.com";
    if (platform === "huya") return host === "huya.com" || host.endsWith(".huya.com");
    if (platform === "douyu") return host === "douyu.com" || host.endsWith(".douyu.com");
    return host === "live.douyin.com" || host === "www.douyin.com" || host.endsWith(".douyin.com");
  } catch {
    return false;
  }
}

function writeFavorite(request: FavoriteWriteRequest): Promise<{ added: boolean }> {
  const operation = favoriteWriteQueue.then(async () => {
    const kind = request.operation || "favorite";
    if (kind === "add-to-room") {
      await favoritesRepository.addToRoom(request.id || "", request.room);
      return { added: false };
    }
    if (kind === "record-sent") {
      await favoritesRepository.recordSent(request.id || "", request.room);
      return { added: false };
    }
    if (kind === "remove") {
      await favoritesRepository.remove(request.id || "");
      return { added: false };
    }
    if (kind === "set-pinned") {
      await favoritesRepository.setPinned(
        request.id || "",
        String(request.targetRoomKey || request.room.roomKey).slice(0, 320),
        request.pinned === true
      );
      return { added: false };
    }
    if (kind === "set-tags") {
      await favoritesRepository.setTags(request.id || "", request.tags);
      return { added: false };
    }
    if (kind === "move") {
      await favoritesRepository.move(
        request.id || "",
        String(request.targetRoomKey || request.room.roomKey).slice(0, 320),
        request.direction === "up" ? "up" : "down"
      );
      return { added: false };
    }
    if (kind === "reorder") {
      await favoritesRepository.reorder(
        request.id || "",
        request.targetId || "",
        String(request.targetRoomKey || request.room.roomKey).slice(0, 320),
        request.placement === "after" ? "after" : "before"
      );
      return { added: false };
    }
    const result = await favoritesRepository.favorite(
      request.text || "",
      request.room,
      request.payload
    );
    return { added: result.added };
  });
  favoriteWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function ensureDouyinContentRuntime(tabId: number, frameId: number): Promise<boolean> {
  const target: chrome.scripting.InjectionTarget = { tabId, frameIds: [frameId] };
  const [probe] = await chrome.scripting.executeScript({
    target,
    func: () => Boolean((globalThis as typeof globalThis & {
      __danmakuEchoDouyinLoaded?: boolean;
    }).__danmakuEchoDouyinLoaded)
  });
  if (probe?.result) {
    return false;
  }

  await Promise.all([
    chrome.scripting.insertCSS({
      target,
      files: ["src/douyin-content.css"],
      origin: "AUTHOR"
    }),
    chrome.scripting.executeScript({
      target,
      files: ["src/shared.js", "src/douyin-content.js"],
      injectImmediately: true
    })
  ]);
  return true;
}

async function runDouyinRuntimeEnsure(options: {
  attempt?: number;
  frameId: number;
  reason: string;
  tabId: number;
}): Promise<{ contentInjected: boolean }> {
  const { attempt, frameId, reason, tabId } = options;
  const target: chrome.scripting.InjectionTarget = { tabId, frameIds: [frameId] };
  const [pageResult, contentInjected] = await Promise.all([
    chrome.scripting.executeScript({
      target,
      files: ["src/douyin-page-hook.js"],
      world: "MAIN",
      injectImmediately: true
    }),
    ensureDouyinContentRuntime(tabId, frameId)
  ]);

  console.info("[Danmaku Echo][background] ensured Douyin runtime", {
    tabId,
    frameId,
    attempt: Number(attempt) || 0,
    reason,
    contentInjected,
    pageResultCount: pageResult.length
  });
  return { contentInjected };
}

function ensureDouyinRuntime(options: {
  attempt?: number;
  frameId: number;
  reason: string;
  tabId: number;
}): Promise<{ contentInjected: boolean }> {
  const key = `${options.tabId}:${options.frameId}`;
  const pending = pendingDouyinRuntimeEnsures.get(key);
  if (pending) return pending;

  const request = runDouyinRuntimeEnsure(options).finally(() => {
    if (pendingDouyinRuntimeEnsures.get(key) === request) {
      pendingDouyinRuntimeEnsures.delete(key);
    }
  });
  pendingDouyinRuntimeEnsures.set(key, request);
  return request;
}

function isDouyinRuntimeRequest(value: unknown): value is DouyinRuntimeRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === "danmaku-echo.ensure-douyin-runtime"
    || type === "danmaku-echo.ensure-douyin-page-hook";
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isDouyinEmojiCatalogRequest(message)) {
    const senderUrl = sender.url || sender.tab?.url;
    if (!senderMatchesPlatform(senderUrl, "douyin")) {
      sendResponse({ error: "invalid-douyin-sender", ok: false } satisfies DouyinEmojiCatalogResponse);
      return false;
    }
    loadDouyinEmojiCatalog().then(sendResponse).catch((error: unknown) => {
      sendResponse({
        error: String(error instanceof Error ? error.message : error).slice(0, 160),
        ok: false,
      } satisfies DouyinEmojiCatalogResponse);
    });
    return true;
  }
  if (isLiveAudienceFrameReportRequest(message)) {
    const tabId = sender.tab?.id;
    const senderUrl = sender.url || sender.tab?.url;
    if (typeof tabId !== "number" || !Number.isInteger(tabId)
      || !senderMatchesPlatform(senderUrl, "bilibili")) {
      sendResponse({ ok: false } satisfies LiveAudienceFrameResponse);
      return false;
    }
    const sampledAt = Date.now();
    frameAudienceCache.set(tabId, {
      expiresAt: sampledAt + LIVE_AUDIENCE_FRAME_STALE_MS,
      metric: { ...message.metric, sampledAt, source: "frame" }
    });
    sendResponse({ ok: true } satisfies LiveAudienceFrameResponse);
    return false;
  }
  if (isLiveAudienceFrameReadRequest(message)) {
    const tabId = sender.tab?.id;
    const senderUrl = sender.url || sender.tab?.url;
    if (typeof tabId !== "number" || !Number.isInteger(tabId)
      || !senderMatchesPlatform(senderUrl, "bilibili")) {
      sendResponse({ ok: false } satisfies LiveAudienceFrameResponse);
      return false;
    }
    const cached = frameAudienceCache.get(tabId);
    if (!cached || cached.expiresAt <= Date.now()) {
      frameAudienceCache.delete(tabId);
      sendResponse({ ok: true } satisfies LiveAudienceFrameResponse);
      return false;
    }
    sendResponse({ metric: cached.metric, ok: true } satisfies LiveAudienceFrameResponse);
    return false;
  }
  if (isFavoriteWriteRequest(message)) {
    const senderUrl = sender.url || sender.tab?.url;
    const roomUrl = message.room.url;
    if (!senderMatchesPlatform(senderUrl, message.room.platform)
      && !senderMatchesPlatform(roomUrl, message.room.platform)) {
      sendResponse({ ok: false, error: "invalid-favorite-sender" } satisfies FavoriteWriteResponse);
      return false;
    }
    writeFavorite(message).then(({ added }) => {
      sendResponse({ ok: true, added } satisfies FavoriteWriteResponse);
    }).catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: String(error instanceof Error ? error.message : error)
      } satisfies FavoriteWriteResponse);
    });
    return true;
  }
  if (isBilibiliInstallNativeSendObserverRequest(message)) {
    const tabId = sender.tab?.id;
    const frameId = typeof sender.frameId === "number" ? sender.frameId : 0;
    const senderUrl = sender.url;
    const tabUrl = sender.tab?.url;
    if (typeof tabId !== "number" || !Number.isInteger(tabId)
      || !senderMatchesPlatform(senderUrl, "bilibili")
      || !senderMatchesPlatform(tabUrl, "bilibili")) {
      sendResponse({ error: "invalid-bilibili-sender", ok: false });
      return false;
    }
    chrome.scripting.executeScript({
      args: [{ nonce: message.nonce }],
      func: installBilibiliNativeSendObserverInPage,
      target: { tabId, frameIds: [frameId] },
      world: "MAIN"
    }).then(([execution]) => {
      sendResponse(execution?.result || { error: "empty-result", ok: false });
    }).catch((error: unknown) => {
      sendResponse({
        error: String(error instanceof Error ? error.message : error),
        ok: false
      });
    });
    return true;
  }
  if (isInstallNativeSendObserverRequest(message)) {
    const tabId = sender.tab?.id;
    const frameId = typeof sender.frameId === "number" ? sender.frameId : 0;
    const senderUrl = sender.url;
    const tabUrl = sender.tab?.url;
    if (typeof tabId !== "number" || !Number.isInteger(tabId)
      || !senderMatchesPlatform(senderUrl, message.platform)
      || !senderMatchesPlatform(tabUrl, message.platform)) {
      sendResponse({ error: "invalid-platform-sender", ok: false });
      return false;
    }
    chrome.scripting.executeScript({
      args: [{ nonce: message.nonce, platform: message.platform }],
      func: installNativeSendObserverInPage,
      target: { tabId, frameIds: [frameId] },
      world: "MAIN"
    }).then(([execution]) => {
      sendResponse(execution?.result || { error: "empty-result", ok: false });
    }).catch((error: unknown) => {
      sendResponse({
        error: String(error instanceof Error ? error.message : error),
        ok: false
      });
    });
    return true;
  }
  if (isBilibiliDirectEmoticonSendRequest(message)) {
    const tabId = sender.tab?.id;
    const senderUrl = sender.url;
    const tabUrl = sender.tab?.url;
    if (typeof tabId !== "number" || !Number.isInteger(tabId)
      || !senderMatchesPlatform(senderUrl, "bilibili")
      || !senderMatchesPlatform(tabUrl, "bilibili")) {
      console.error("[Danmaku Echo][background][Bilibili room Emoji +1] failed", {
        hasIntegerTabId: typeof tabId === "number" && Number.isInteger(tabId),
        senderPlatformValid: senderMatchesPlatform(senderUrl, "bilibili"),
        stage: "validate-sender",
        tabPlatformValid: senderMatchesPlatform(tabUrl, "bilibili")
      });
      sendResponse({
        error: "invalid-bilibili-sender",
        ok: false,
        stage: "validate-sender"
      } satisfies BilibiliDirectEmoticonSendResponse);
      return false;
    }
    chrome.scripting.executeScript({
      args: [{
        href: String(tabUrl),
        identity: message.identity,
        sourceHints: message.sourceHints,
        token: message.token,
      }],
      func: sendBilibiliRoomEmoticonInPage,
      target: { tabId, frameIds: [0] },
      world: "MAIN"
    }).then(([execution]) => {
      const result = execution?.result || {
        error: "empty-result",
        ok: false,
        stage: "execute-main-world"
      } satisfies BilibiliDirectEmoticonSendResponse;
      if (!result.ok) {
        console.error("[Danmaku Echo][background][Bilibili room Emoji +1] failed", {
          code: result.code,
          error: result.error,
          message: result.message,
          stage: result.stage
        });
      }
      sendResponse(result);
    }).catch((error: unknown) => {
      console.error("[Danmaku Echo][background][Bilibili room Emoji +1] failed", {
        error: String(error instanceof Error ? error.message : error),
        stage: "execute-main-world"
      });
      sendResponse({
        error: String(error instanceof Error ? error.message : error),
        ok: false,
        stage: "execute-main-world"
      } satisfies BilibiliDirectEmoticonSendResponse);
    });
    return true;
  }
  if (!isDouyinRuntimeRequest(message)) {
    return false;
  }
  const tabId = sender.tab?.id;
  const frameId = typeof sender.frameId === "number" && Number.isInteger(sender.frameId)
    ? sender.frameId
    : 0;
  const requestedUrl = String(message.href || sender.tab?.url || sender.url || "");
  if (typeof tabId !== "number" || !Number.isInteger(tabId) || !isDouyinLiveUrl(requestedUrl)) {
    sendResponse({ ok: false, error: "invalid-douyin-sender" });
    return false;
  }

  ensureDouyinRuntime({
    tabId,
    frameId,
    attempt: message.attempt,
    reason: "bootstrap-request"
  }).then(({ contentInjected }) => {
    sendResponse({ ok: true, tabId, frameId, contentInjected });
  }).catch((error: unknown) => {
    const text = String(error instanceof Error ? error.message : error);
    console.error("[Danmaku Echo][background] Douyin runtime injection failed", {
      tabId,
      frameId,
      error: text
    });
    sendResponse({ ok: false, error: text });
  });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) frameAudienceCache.delete(tabId);
  const url = String(changeInfo.url || tab.url || "");
  if (!changeInfo.url || !isDouyinLiveUrl(url)) {
    return;
  }
  const now = Date.now();
  const recent = recentRouteInjections.get(tabId);
  if (recent && recent.url === url && now - recent.at < 500) {
    return;
  }
  recentRouteInjections.set(tabId, { url, at: now });
  ensureDouyinRuntime({
    tabId,
    frameId: 0,
    attempt: 0,
    reason: "tab-url-updated"
  }).catch((error: unknown) => {
    console.warn("[Danmaku Echo][background] SPA route injection failed", {
      tabId,
      url,
      error: String(error instanceof Error ? error.message : error)
    });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  recentRouteInjections.delete(tabId);
  frameAudienceCache.delete(tabId);
  for (const key of pendingDouyinRuntimeEnsures.keys()) {
    if (key.startsWith(`${tabId}:`)) pendingDouyinRuntimeEnsures.delete(key);
  }
});

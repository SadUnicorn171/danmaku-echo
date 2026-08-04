import type { DouyinRuntimeRequest, PlatformId } from "../core/types";
import { createFavoritesRepository } from "../features/favorites/repository";
import {
  FAVORITE_WRITE_MESSAGE,
  type FavoriteWriteRequest,
  type FavoriteWriteResponse
} from "../features/favorites/types";

const DOUYIN_LIVE_PATTERN = /^https:\/\/(?:live\.douyin\.com\/|www\.douyin\.com\/follow\/live(?:\/|[?#]|$))/i;
const recentRouteInjections = new Map<number, { at: number; url: string }>();
const favoritesRepository = createFavoritesRepository(chrome.storage.local);
let favoriteWriteQueue: Promise<void> = Promise.resolve();

function isDouyinLiveUrl(value: unknown): boolean {
  return DOUYIN_LIVE_PATTERN.test(String(value || ""));
}

function isFavoriteWriteRequest(value: unknown): value is FavoriteWriteRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<FavoriteWriteRequest>;
  const operation = request.operation || "favorite";
  const room = request.room;
  return request.type === FAVORITE_WRITE_MESSAGE
    && (operation === "favorite" || operation === "add-to-room"
      || operation === "record-sent" || operation === "remove")
    && (operation === "favorite"
      ? typeof request.text === "string"
        && Array.from(request.text).length > 0
        && Array.from(request.text).length <= 1_000
      : typeof request.id === "string" && request.id.length > 0 && request.id.length <= 200)
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

async function ensureDouyinRuntime(options: {
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

function isDouyinRuntimeRequest(value: unknown): value is DouyinRuntimeRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === "danmaku-echo.ensure-douyin-runtime"
    || type === "danmaku-echo.ensure-douyin-page-hook";
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
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
});

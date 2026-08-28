// @ts-nocheck -- performance-sensitive page hook; typed modules cover its stable boundaries.
import {
  barrageInteractionText,
  boxEdges,
  normalizeText,
  numberOr,
  plausibleText,
  rendererBox,
  rendererPaint,
  serializeBarrage,
  serializedBarrageText
} from "../platforms/douyin/barrage-model";
import {
  douyinEmojiMessageText,
  registerDouyinEmojiCatalog
} from "../platforms/douyin/emoji-token";
import { douyinRepeatReminderExclusionReason } from "../platforms/douyin/repeat-reminder-filter";
import {
  DOUYIN_CONTENT_SOURCE,
  DOUYIN_PAGE_SOURCE,
  isDouyinProtocolMessage
} from "../platforms/douyin/protocol";
import { serializedEmojiAssets } from "../platforms/douyin/rich-data";
import {
  allAssetsMatch,
  douyinOwnMessageTextMatches
} from "../platforms/douyin/own-message";
import { overlayCapsulePlacement } from "../platforms/live/capsule-position";
import {
  canvasPixelSize,
  channelInfo,
  modelDpr,
  realChannelRange,
  trackDuration,
  trackInternalHeight,
  trackIsExpired,
  trackNeedsReserve,
  trackPriority,
  trackRect,
  trackRightEdgeVisible,
  trackRightPosition,
  trackSpeed
} from "../platforms/douyin/track-model";
import { extractSenderFromRecord } from "../core/reply";
import { pointTouchesRepeatReminder } from "../features/repeat-reminder/pointer-guard";

(function installDanmakuEchoDouyinTracker() {
  "use strict";

  if (globalThis.__bulletPlusOneDouyinCanvasHook) {
    return;
  }
  globalThis.__bulletPlusOneDouyinCanvasHook = true;

  const DEBUG_VERSION = "douyin-dom-renderer-v14-gated-repeat-collector";
  const DOM_ACTION_HEIGHT = 40;
  const DOM_ACTION_ITEM_WIDTHS = Object.freeze({
    plusOne: 56,
    reply: 56,
    favorite: 56,
    copy: 56
  });
  const DOM_ACTION_DIVIDER_WIDTH = 2;
  const DOM_ACTION_GAP = 8;
  const DOM_ACTION_TRAILING_SPACE = 12;
  const DOM_BARRAGE_PADDING = 8;
  const DOM_BARRAGE_PADDING_MAX = 12;
  const DOM_NODE_LIMIT = 160;
  const RENDERER_HEARTBEAT_TIMEOUT = 15_000;
  const RENDERER_RESULT_TIMEOUT = 8_000;
  const FROZEN_TRACK_TIMEOUT = 20_000;
  const HOVER_LEAVE_GRACE = 220;
  const CANVAS_MOUNT_GRACE = 8_000;
  const CANVAS_MOUNT_RETRY = 100;
  const OWN_MESSAGE_TTL = 12_000;
  const OWN_MESSAGE_LIMIT = 24;
  const instances = new Map();
  const offscreenSources = new WeakMap();
  const canvasIds = new WeakMap();
  const orphanMessages = new Map();
  let nextCanvasId = 1;
  let nextTrackId = 1;
  let measurementContext = null;
  let debugMarkerTimer = 0;
  let nextActivationRequestId = 1;
  let nextFavoriteRequestId = 1;
  let nextReplyRequestId = 1;
  let rendererEnabled = false;
  let rendererHeartbeatAt = 0;
  let rendererActions = { copy: false, plusOne: true, reply: true, favorite: true };
  let rendererCapsuleScale = 1;
  let rendererRepeatReminderEnabled = false;
  let repeatReminderPointerFrame = 0;
  let repeatReminderPointerX = 0;
  let repeatReminderPointerY = 0;

  function normalizeRendererActions(value) {
    const actions = value && typeof value === "object" ? value : {};
    return {
      plusOne: typeof actions.plusOne === "boolean" ? actions.plusOne : true,
      reply: typeof actions.reply === "boolean" ? actions.reply : true,
      favorite: typeof actions.favorite === "boolean" ? actions.favorite : true,
      copy: typeof actions.copy === "boolean" ? actions.copy : false
    };
  }

  function enabledRendererActions() {
    return ["plusOne", "reply", "favorite", "copy"].filter((key) => rendererActions[key]);
  }

  function normalizeCapsuleScale(value) {
    const percent = Number(value);
    if (!Number.isFinite(percent)) return 1;
    return Math.min(200, Math.max(50, Math.round(percent))) / 100;
  }

  function rendererSnapToDevicePixel(pixels) {
    const ratio = Number(globalThis.devicePixelRatio);
    const deviceScale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    return Math.max(1 / deviceScale,
      Math.round(pixels * rendererCapsuleScale * deviceScale) / deviceScale);
  }

  function rendererActionWidth() {
    const actions = enabledRendererActions();
    const itemWidth = (key) => rendererSnapToDevicePixel(DOM_ACTION_ITEM_WIDTHS[key]);
    const dividerWidth = rendererSnapToDevicePixel(DOM_ACTION_DIVIDER_WIDTH);
    return actions.reduce((width, key) => width + itemWidth(key), 0)
      + Math.max(0, actions.length - 1) * dividerWidth;
  }

  function rendererActionHeight() {
    return DOM_ACTION_HEIGHT * rendererCapsuleScale;
  }
  function rendererRouteKey(value) {
    try {
      const url = new URL(value, location.href);
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      return `${url.origin}${pathname}`;
    } catch {
      return String(value || "").split(/[?#]/, 1)[0];
    }
  }

  let rendererLocationHref = location.href;
  let rendererLocationRouteKey = rendererRouteKey(location.href);
  const activationRequests = new Map();
  const favoriteRequests = new Map();
  const ownMessages = [];

  const debugState = {
    version: DEBUG_VERSION,
    installedAt: new Date().toISOString(),
    installedAtMs: Date.now(),
    href: location.href,
    readyState: document.readyState,
    counters: {
      canvasTransfers: 0,
      workerMessages: 0,
      instancesCreated: 0,
      instancesRecovered: 0,
      barragesObserved: 0,
      barragesStarted: 0,
      rendererTakeovers: 0,
      rendererRestores: 0,
      rendererNodesCreated: 0,
      rendererActivations: 0,
      rendererResults: 0,
      ownMessagesQueued: 0,
      ownBarragesMatched: 0,
      ownBarragesReconciled: 0,
      skippedBarrages: 0
    },
    lastError: "",
    events: []
  };
  globalThis.__danmakuEchoDouyinDebug = debugState;

  function conciseDebugValue(value, depth) {
    if (depth > 3) {
      return "[depth-limit]";
    }
    if (value == null || typeof value === "boolean" || typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      return value.slice(0, 240);
    }
    if (Array.isArray(value)) {
      return value.slice(0, 12).map((item) => conciseDebugValue(item, depth + 1));
    }
    if (typeof value === "object") {
      const result = {};
      Object.keys(value).slice(0, 20).forEach((key) => {
        result[key] = conciseDebugValue(value[key], depth + 1);
      });
      return result;
    }
    return String(value).slice(0, 120);
  }

  function instanceDebugSummary(instance) {
    const rect = instance.canvas instanceof HTMLCanvasElement
      ? instance.canvas.getBoundingClientRect()
      : null;
    return {
      id: instance.id,
      canvasId: instance.canvasId,
      recovered: Boolean(instance.recovered),
      active: Boolean(instance.active),
      connected: Boolean(instance.canvas && instance.canvas.isConnected),
      canvasRect: rect ? [rect.left, rect.top, rect.width, rect.height] : null,
      config: {
        width: numberOr(instance.config.width, 0),
        height: numberOr(instance.config.height, 0),
        devicePixelRatio: numberOr(instance.config.devicePixelRatio, 1),
        fontSize: numberOr(instance.config.fontSize, 20),
        channelHeight: numberOr(instance.config.channelHeight, 40),
        duration: numberOr(instance.config.duration, 15_000),
        gap: numberOr(instance.config.gap, 100)
      },
      pendingCount: instance.pending ? instance.pending.length : 0,
      trackCount: instance.tracks.size,
      channelCount: instance.channels ? instance.channels.length : 0,
      renderer: {
        safe: Boolean(instance.rendererSafeSync)
          || Date.now() >= numberOr(instance.rendererSafeAfter, Infinity),
        blocked: Boolean(instance.rendererBlocked),
        takeover: Boolean(instance.rendererTakeover),
        nodeCount: instance.rendererNodes ? instance.rendererNodes.size : 0,
        layerConnected: Boolean(instance.rendererLayer && instance.rendererLayer.isConnected)
      }
    };
  }

  function debugSnapshot() {
    return {
      version: debugState.version,
      installedAt: debugState.installedAt,
      installedAtMs: debugState.installedAtMs,
      href: location.href,
      readyState: document.readyState,
      counters: Object.assign({}, debugState.counters),
      lastError: debugState.lastError,
      instanceCount: instances.size,
      orphanCount: orphanMessages.size,
      renderer: {
        enabled: rendererEnabled,
        heartbeatAge: rendererHeartbeatAt ? Date.now() - rendererHeartbeatAt : null,
        activationRequestCount: activationRequests.size
      },
      instances: Array.from(instances.values()).map(instanceDebugSummary),
      events: debugState.events.slice(-80)
    };
  }

  function syncDebugMarker() {
    debugMarkerTimer = 0;
    const root = document.documentElement;
    if (!root) {
      return;
    }
    let marker = document.getElementById("bcp-douyin-page-debug");
    if (!marker) {
      marker = document.createElement("script");
      marker.id = "bcp-douyin-page-debug";
      marker.type = "application/json";
      marker.hidden = true;
      root.appendChild(marker);
    }
    const snapshot = debugSnapshot();
    marker.dataset.version = DEBUG_VERSION;
    marker.dataset.instanceCount = String(snapshot.instanceCount);
    marker.dataset.orphanCount = String(snapshot.orphanCount);
    marker.textContent = JSON.stringify(snapshot);
  }

  function scheduleDebugMarker() {
    if (!debugMarkerTimer) {
      debugMarkerTimer = setTimeout(syncDebugMarker, 80);
    }
  }

  function debugEvent(type, details, level) {
    const entry = {
      at: Date.now(),
      sinceInstall: Date.now() - debugState.installedAtMs,
      type,
      details: conciseDebugValue(details || {}, 0)
    };
    debugState.events.push(entry);
    if (debugState.events.length > 240) {
      debugState.events.splice(0, debugState.events.length - 240);
    }
    if (level === "error") {
      debugState.lastError = String(details && (details.message || details.error) || type).slice(0, 500);
      console.error("[Danmaku Echo][Douyin page]", type, entry.details);
    } else if (level === "info") {
      console.info("[Danmaku Echo][Douyin page]", type, entry.details);
    } else if (level === "warn") {
      console.warn("[Danmaku Echo][Douyin page]", type, entry.details);
    } else {
      console.debug("[Danmaku Echo][Douyin page]", type, entry.details);
    }
    scheduleDebugMarker();
  }

  function ensureMeasurementContext() {
    if (measurementContext) {
      return measurementContext;
    }
    try {
      measurementContext = document.createElement("canvas").getContext("2d");
    } catch {
      measurementContext = null;
    }
    return measurementContext;
  }

  function measureTextItem(item, style) {
    const text = normalizeText(item.text);
    const fontSize = Math.max(8, numberOr(style.fontSize, 20));
    const fontWeight = style.fontWeight || 400;
    const fontFamily = style.fontFamily || "Arial";
    const context = ensureMeasurementContext();
    let width = Array.from(text).length * fontSize;
    if (context) {
      try {
        context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        width = context.measureText(text).width;
      } catch {
        // The character estimate remains usable when a site font is unavailable.
      }
    }
    const margin = boxEdges(item.margin);
    const padding = boxEdges(item.padding);
    const border = Math.max(0, numberOr(item.borderWidth, 0));
    return {
      width: width + margin.left + margin.right + padding.left + padding.right + border * 2,
      height: fontSize + margin.top + margin.bottom + padding.top + padding.bottom + border * 2,
      text,
      imageCount: 0,
      firstText: {
        fontSize,
        fontWeight,
        fontFamily,
        color: style.color,
        strokeColor: style.strokeColor,
        strokeWidth: numberOr(style.strokeWidth, 1)
      }
    };
  }

  function measureImageItem(item, style, imageRatios) {
    const fontSize = Math.max(8, numberOr(style.fontSize, 20));
    const height = Math.max(1, numberOr(item.height, fontSize));
    const ratio = imageRatios && typeof item.src === "string"
      ? imageRatios.get(item.src)
      : null;
    const width = Math.max(1, Number.isFinite(ratio) && ratio > 0
      ? height * ratio
      : numberOr(item.width, numberOr(item.height, fontSize)));
    const margin = boxEdges(item.margin);
    const padding = boxEdges(item.padding);
    const border = Math.max(0, numberOr(item.borderWidth, 0));
    return {
      width: width + margin.left + margin.right + padding.left + padding.right + border * 2,
      height: height + margin.top + margin.bottom + padding.top + padding.bottom + border * 2,
      text: "",
      imageCount: 1,
      firstText: null
    };
  }

  function mergeMeasurement(target, child, inline) {
    target.text += child.text;
    target.imageCount += child.imageCount;
    target.firstText = target.firstText || child.firstText;
    if (inline) {
      target.width += child.width;
      target.height = Math.max(target.height, child.height);
    } else {
      target.width = Math.max(target.width, child.width);
      target.height += child.height;
    }
  }

  function inheritableTextStyle(style) {
    return {
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontFamily: style.fontFamily,
      color: style.color,
      strokeColor: style.strokeColor,
      strokeWidth: style.strokeWidth
    };
  }

  function measureContent(item, inherited, imageRatios) {
    if (!item || typeof item !== "object") {
      return { width: 0, height: 0, text: "", imageCount: 0, firstText: null };
    }
    const style = Object.assign({}, inherited, item);
    if (item.type === "text") {
      return measureTextItem(item, style);
    }
    if (item.type === "image") {
      return measureImageItem(item, style, imageRatios);
    }

    const result = { width: 0, height: 0, text: "", imageCount: 0, firstText: null };
    const content = Array.isArray(item.content) ? item.content : [];
    const childStyle = inheritableTextStyle(style);
    content.forEach((child) => {
      const childResult = measureContent(child, childStyle, imageRatios);
      const isBlock = !child.type || child.type === "block";
      mergeMeasurement(result, childResult, !isBlock || Boolean(child.isInline));
    });
    const margin = boxEdges(item.margin);
    const padding = boxEdges(item.padding);
    const border = Math.max(0, numberOr(item.borderWidth, 0));
    result.width += margin.left + margin.right + padding.left + padding.right + border * 2;
    result.height += margin.top + margin.bottom + padding.top + padding.bottom + border * 2;
    return result;
  }

  function describeBarrage(options, config, imageRatios) {
    const result = measureContent(options, {
      fontSize: numberOr(config.fontSize, 20),
      fontWeight: 400,
      fontFamily: "Arial",
      color: "#ffffff",
      strokeColor: "rgba(0, 0, 0, 0.8)",
      strokeWidth: 1
    }, imageRatios);
    result.width = Math.max(4, result.width);
    result.height = Math.max(8, result.height || numberOr(config.fontSize, 20));
    result.text = normalizeText(result.text);
    return result;
  }

  function pruneOwnMessages(now) {
    const cutoff = now - OWN_MESSAGE_TTL;
    while (ownMessages.length && ownMessages[0].at < cutoff) {
      ownMessages.shift();
    }
  }

  function rememberOwnMessage(data) {
    const assets = Array.isArray(data && data.assets)
      ? data.assets.filter((asset) => asset && Array.isArray(asset.keys) && asset.keys.length)
        .slice(0, 8)
      : [];
    const text = normalizeText(data && data.text)
      || normalizeText(data && data.plainText);
    if (!plausibleText(text) && !assets.length) {
      return;
    }
    const now = Date.now();
    pruneOwnMessages(now);
    const item = {
      id: String(data.intentId || "").slice(0, 80),
      text,
      assets,
      at: now,
      source: String(data.sourceType || "unknown").slice(0, 40)
    };
    if (reconcileRecentOwnMessage(item, now)) {
      return;
    }
    ownMessages.push(item);
    if (ownMessages.length > OWN_MESSAGE_LIMIT) {
      ownMessages.splice(0, ownMessages.length - OWN_MESSAGE_LIMIT);
    }
    debugState.counters.ownMessagesQueued += 1;
    debugEvent("own-message-queued", {
      text,
      assetCount: assets.length,
      source: String(data.sourceType || "unknown").slice(0, 40),
      queueLength: ownMessages.length
    });
  }

  function ownMessageMatches(item, text, content) {
    const normalized = normalizeText(text);
    const observedAssets = serializedEmojiAssets(content, location.href);
    const textMatches = douyinOwnMessageTextMatches(
      item.text,
      normalized,
      observedAssets.length > 0
    );
    if (item.assets && item.assets.length) {
      return allAssetsMatch(item.assets, observedAssets)
        && (!item.text || textMatches);
    }
    return Boolean(item.text && textMatches);
  }

  function completeOwnMessageMatch(item, track, mode) {
    track.own = true;
    if (track.renderer && track.renderer.barrage) {
      track.renderer.barrage.dataset.own = "true";
    }
    const observedAssets = serializedEmojiAssets(track.content, location.href);
    debugState.counters.ownBarragesMatched += 1;
    if (mode === "recent-track") {
      debugState.counters.ownBarragesReconciled += 1;
    }
    debugEvent(mode === "recent-track" ? "own-barrage-reconciled" : "own-barrage-matched", {
      intentId: item.id,
      trackId: track.id,
      text: normalizeText(track.description && track.description.text),
      assetCount: observedAssets.length,
      source: item.source,
      age: Date.now() - item.at
    });
    window.postMessage({
      source: DOUYIN_PAGE_SOURCE,
      type: "own-message-consumed",
      intentId: item.id
    }, "*");
    return true;
  }

  function reconcileRecentOwnMessage(item, now) {
    if (!String(item.source || "").startsWith("manual-")) {
      return false;
    }
    let best = null;
    let bestAge = Infinity;
    for (const instance of instances.values()) {
      for (const track of instance.tracks.values()) {
        const age = now - Number(track.observedAt || 0);
        if (track.own || age < 0 || age > 2500
            || !ownMessageMatches(item, track.description && track.description.text, track.content)) {
          continue;
        }
        if (age < bestAge) {
          best = track;
          bestAge = age;
        }
      }
    }
    return best ? completeOwnMessageMatch(item, best, "recent-track") : false;
  }

  function cancelOwnMessage(data) {
    const id = String(data && data.intentId || "").slice(0, 80);
    if (!id) {
      return;
    }
    const index = ownMessages.findIndex((item) => item.id === id);
    if (index >= 0) {
      ownMessages.splice(index, 1);
      debugEvent("own-message-cancelled", { intentId: id });
    }
  }

  function consumeOwnMessage(text, content) {
    const normalized = normalizeText(text);
    const observedAssets = serializedEmojiAssets(content, location.href);
    if (!normalized && !observedAssets.length) {
      return false;
    }
    pruneOwnMessages(Date.now());
    const index = ownMessages.findIndex((item) => ownMessageMatches(item, normalized, content));
    if (index < 0) {
      return false;
    }
    const matched = ownMessages.splice(index, 1)[0];
    return completeOwnMessageMatch(matched, {
      content,
      description: { text: normalized },
      id: "pending",
      own: false,
      renderer: null
    }, "queued-intent");
  }

  function elementMarker(element) {
    if (!(element instanceof Element)) {
      return "";
    }
    const className = typeof element.className === "string" ? element.className : "";
    return [element.id, className, element.getAttribute("data-e2e")].filter(Boolean).join(" ");
  }

  function isDanmakuCanvas(canvas) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      return false;
    }
    let current = canvas;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      if (/(danmaku|danmu|barrage|bullet)/i.test(elementMarker(current))) {
        return true;
      }
    }
    return false;
  }

  function canvasId(canvas) {
    if (!canvasIds.has(canvas)) {
      canvasIds.set(canvas, nextCanvasId);
      nextCanvasId += 1;
    }
    return canvasIds.get(canvas);
  }

  function observeCanvasTransfers() {
    const prototype = globalThis.HTMLCanvasElement && globalThis.HTMLCanvasElement.prototype;
    const original = prototype && prototype.transferControlToOffscreen;
    if (typeof original !== "function" || original.__danmakuEchoObserved) {
      return;
    }
    function danmakuEchoTransferControlToOffscreen(...args) {
      const offscreen = Reflect.apply(original, this, args);
      if (offscreen && typeof offscreen === "object") {
        offscreenSources.set(offscreen, this);
        debugState.counters.canvasTransfers += 1;
        debugEvent("canvas-transferred", {
          canvasId: canvasId(this),
          connected: this.isConnected,
          marker: elementMarker(this.parentElement),
          width: this.width,
          height: this.height
        });
      }
      return offscreen;
    }
    danmakuEchoTransferControlToOffscreen.__danmakuEchoObserved = true;
    Object.defineProperty(prototype, "transferControlToOffscreen", {
      configurable: true,
      writable: true,
      value: danmakuEchoTransferControlToOffscreen
    });
  }

  function findUnclaimedCanvas() {
    const claimed = new Set(Array.from(instances.values()).map((instance) => instance.canvas));
    return Array.from(document.querySelectorAll("canvas")).reverse()
      .find((canvas) => isDanmakuCanvas(canvas) && !claimed.has(canvas)) || null;
  }

  function ensureChannels(instance, count) {
    while (instance.channels.length < count) {
      instance.channels.push([]);
    }
    if (instance.channels.length > count) {
      instance.channels.length = count;
    }
  }

  function rendererInstanceSafe(instance) {
    return Boolean(instance.rendererSafeSync)
      || Date.now() >= numberOr(instance.rendererSafeAfter, Infinity);
  }

  function rendererMount(instance) {
    const fullscreen = document.fullscreenElement;
    if (fullscreen instanceof Element && fullscreen !== instance.canvas
        && fullscreen.contains(instance.canvas)) {
      return fullscreen;
    }
    return document.documentElement || document.body;
  }

  function applyRendererContentStyle(element, item) {
    if (!element || !item || typeof item !== "object") {
      return;
    }
    if (Number.isFinite(Number(item.fontSize))) {
      element.style.fontSize = `${Math.max(8, Math.min(96, Number(item.fontSize)))}px`;
    }
    if (item.type !== "image" && Number.isFinite(Number(item.width))) {
      element.style.width = `${Math.max(0, Math.min(1000, Number(item.width)))}px`;
    }
    if (item.type !== "image" && Number.isFinite(Number(item.height))) {
      element.style.height = `${Math.max(0, Math.min(500, Number(item.height)))}px`;
    }
    if (item.fontWeight != null) {
      element.style.fontWeight = String(item.fontWeight).slice(0, 100);
    }
    if (item.fontFamily != null) {
      element.style.fontFamily = String(item.fontFamily).slice(0, 100);
    }
    const color = rendererPaint(item.color, false);
    if (color) {
      element.style.color = color;
    }
    const background = rendererPaint(item.backgroundColor, true);
    if (background) {
      if (/gradient\(/i.test(background)) {
        element.style.backgroundImage = background;
      } else {
        element.style.backgroundColor = background;
      }
    }
    const stroke = rendererPaint(item.strokeColor, false);
    const strokeWidth = Math.max(0, Math.min(8, numberOr(item.strokeWidth, 0)));
    if (stroke && strokeWidth) {
      element.style.webkitTextStroke = `${strokeWidth}px ${stroke}`;
      element.style.paintOrder = "stroke fill";
    }
    const borderColor = rendererPaint(item.borderColor, false);
    const borderWidth = Math.max(0, Math.min(12, numberOr(item.borderWidth, 0)));
    if (borderColor && borderWidth) {
      element.style.border = `${borderWidth}px solid ${borderColor}`;
    }
    if (item.margin != null) {
      element.style.margin = rendererBox(item.margin);
    }
    if (item.padding != null) {
      element.style.padding = rendererBox(item.padding);
    }
    if (Number.isFinite(Number(item.borderRadius))) {
      element.style.borderRadius = `${Math.max(0, Math.min(100, Number(item.borderRadius)))}px`;
    }
    if (Number.isFinite(Number(item.opacity))) {
      element.style.opacity = String(Math.max(0, Math.min(1, Number(item.opacity))));
    }
  }

  function createRendererContent(item, depth) {
    if (!item || typeof item !== "object" || depth > 6) {
      return null;
    }
    let element;
    if (item.type === "image" && typeof item.src === "string") {
      element = document.createElement("img");
      element.src = item.src;
      element.alt = "";
      element.draggable = false;
      element.style.display = "inline-block";
      element.style.objectFit = "contain";
      const fallbackSize = Math.max(8, Math.min(96, numberOr(item.fontSize, 20)));
      const width = numberOr(item.width, numberOr(item.height, fallbackSize));
      const height = numberOr(item.height, numberOr(item.width, fallbackSize));
      element.style.width = `${Math.max(1, Math.min(500, width))}px`;
      element.style.height = `${Math.max(1, Math.min(200, height))}px`;
    } else {
      element = document.createElement("span");
      if (item.type === "text") {
        element.textContent = String(item.text == null ? "" : item.text).slice(0, 1000);
        element.style.display = "inline-block";
      } else {
        element.style.display = item.isInline ? "inline-flex" : "flex";
        element.style.alignItems = "center";
        const children = Array.isArray(item.content) ? item.content : [];
        children.forEach((child) => {
          const childElement = createRendererContent(child, depth + 1);
          if (childElement) {
            element.appendChild(childElement);
          }
        });
      }
    }
    element.style.boxSizing = "border-box";
    element.style.flexShrink = "0";
    applyRendererContentStyle(element, item);
    return element;
  }

  function setRendererMetadata(element, track) {
    const message = track.description.text;
    const messageId = String(track.options.id == null ? track.id : track.options.id);
    element.dataset.track = String(track.id);
    element.dataset.trackId = String(track.id);
    element.dataset.instance = String(track.instance.id);
    element.dataset.instanceId = String(track.instance.id);
    element.dataset.message = message;
    element.dataset.messageId = messageId;
    if (track.sender) {
      element.dataset.sender = track.sender;
    }
  }

  function applyResolvedRendererMessage(data) {
    const instance = instances.get(String(data.instanceId || ""))
      || instances.get(Number(data.instanceId));
    const track = instance && instance.tracks.get(Number(data.trackId));
    const text = normalizeText(data.text);
    if (!track || !plausibleText(text)) return;
    const expectedMessageId = String(track.options.id == null ? track.id : track.options.id);
    if (data.messageId != null && String(data.messageId) !== expectedMessageId) return;
    if (track.description.text === text) return;
    track.description.text = text;
    const state = track.renderer;
    if (state) {
      [
        state.node,
        state.barrage,
        state.actionBar,
        state.button,
        state.replyButton,
        state.favoriteButton,
        state.copyButton
      ].forEach((element) => setRendererMetadata(element, track));
      state.button.setAttribute("aria-label", `发送相同弹幕：${text}`);
      state.replyButton.setAttribute("aria-label", `回复弹幕：${text}`);
      state.favoriteButton.setAttribute("aria-label", `收藏弹幕：${text}`);
      state.copyButton.setAttribute("aria-label", `复制弹幕：${text}`);
    }
    debugEvent("renderer-message-resolved", {
      instanceId: track.instance.id,
      trackId: track.id,
      text
    }, "info");
  }

  function nativeBarrageMessageText(options, content) {
    const serializedMessageText = serializedBarrageText(content);
    const fallbackMessageText = douyinEmojiMessageText(options);
    const serializedEmojiCount = (serializedMessageText.match(/\[[^\]\r\n]{1,40}\]/gu) || []).length;
    const fallbackEmojiCount = (fallbackMessageText.match(/\[[^\]\r\n]{1,40}\]/gu) || []).length;
    return fallbackEmojiCount > serializedEmojiCount
      ? fallbackMessageText
      : serializedMessageText || fallbackMessageText;
  }

  function applyDouyinEmojiCatalog(data) {
    const registered = registerDouyinEmojiCatalog(data.entries);
    if (!registered) return;
    let resolved = 0;
    for (const instance of instances.values()) {
      for (const track of instance.tracks.values()) {
        const content = serializeBarrage(track.options);
        const nativeMessageText = nativeBarrageMessageText(track.options, content);
        const interactionText = barrageInteractionText(
          nativeMessageText || track.description.text,
          track.description.imageCount
        );
        track.content = content;
        if (!plausibleText(interactionText) || interactionText === track.description.text) continue;
        applyResolvedRendererMessage({
          instanceId: instance.id,
          messageId: String(track.options.id == null ? track.id : track.options.id),
          text: interactionText,
          trackId: track.id
        });
        resolved += 1;
      }
    }
    debugEvent("emoji-catalog-applied", { registered, resolved }, "info");
  }

  function ensureRendererLayer(instance, canvasRect) {
    let layer = instance.rendererLayer;
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "bcp-douyin-dom-layer";
      layer.dataset.instance = String(instance.id);
      layer.dataset.instanceId = String(instance.id);
      layer.dataset.canvas = String(instance.canvasId);
      layer.dataset.canvasId = String(instance.canvasId);
      layer.dataset.bcpDouyinOwned = "true";
      layer.style.position = "fixed";
      layer.style.margin = "0";
      layer.style.padding = "0";
      // Match the native Canvas viewport. Tracks begin at its right edge and
      // must be revealed progressively instead of painting over adjacent UI.
      layer.style.overflow = "hidden";
      layer.style.pointerEvents = "none";
      layer.style.contain = "layout style";
      layer.style.isolation = "isolate";
      layer.style.zIndex = "2147483646";
      layer.style.visibility = "hidden";
      layer.hidden = true;
      instance.rendererLayer = layer;
      instance.rendererGeometryKey = "";
      instance.rendererBorderRadius = null;
    }
    const mount = rendererMount(instance);
    if (!(mount instanceof Element)) {
      throw new Error("renderer mount is unavailable");
    }
    if (layer.parentElement !== mount) {
      mount.appendChild(layer);
      instance.rendererGeometryKey = "";
    }
    if (instance.rendererBorderRadius == null) {
      try {
        instance.rendererBorderRadius = getComputedStyle(instance.canvas).borderRadius || "";
      } catch {
        instance.rendererBorderRadius = "";
      }
      layer.style.borderRadius = instance.rendererBorderRadius;
    }
    const geometryKey = [canvasRect.left, canvasRect.top, canvasRect.width, canvasRect.height]
      .map((value) => Math.round(numberOr(value, 0) * 100) / 100)
      .join("|");
    if (geometryKey !== instance.rendererGeometryKey) {
      layer.style.left = `${canvasRect.left}px`;
      layer.style.top = `${canvasRect.top}px`;
      layer.style.width = `${canvasRect.width}px`;
      layer.style.height = `${canvasRect.height}px`;
      instance.rendererGeometryKey = geometryKey;
    }
    return layer;
  }

  function restoreRendererCanvas(instance, reason) {
    const canvas = instance.canvas;
    if (instance.rendererOwnsCanvasVisibility && canvas instanceof HTMLCanvasElement) {
      canvas.style.visibility = instance.rendererCanvasVisibility || "";
      delete canvas.dataset.bcpDouyinDomTakeover;
      instance.rendererOwnsCanvasVisibility = false;
      debugState.counters.rendererRestores += 1;
      debugEvent("renderer-canvas-restored", { instanceId: instance.id, reason });
    }
    instance.rendererTakeover = false;
    if (instance.rendererLayer) {
      instance.rendererLayer.style.visibility = "hidden";
      instance.rendererLayer.hidden = true;
    }
  }

  function takeOverRendererCanvas(instance) {
    if (instance.rendererTakeover) {
      return;
    }
    const canvas = instance.canvas;
    const layer = instance.rendererLayer;
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected
        || !layer || !layer.isConnected || !instance.rendererNodes.size) {
      return;
    }
    instance.rendererCanvasVisibility = canvas.style.visibility;
    instance.rendererOwnsCanvasVisibility = true;
    layer.hidden = false;
    layer.style.visibility = "visible";
    canvas.style.visibility = "hidden";
    canvas.dataset.bcpDouyinDomTakeover = "true";
    instance.rendererTakeover = true;
    debugState.counters.rendererTakeovers += 1;
    debugEvent("renderer-takeover", {
      instanceId: instance.id,
      canvasId: instance.canvasId,
      nodeCount: instance.rendererNodes.size
    }, "info");
  }

  function removeRendererTrack(track) {
    const state = track && track.renderer;
    if (!state) {
      return;
    }
    if (state.hoverTimer) {
      clearTimeout(state.hoverTimer);
    }
    if (state.releaseTimer) {
      clearTimeout(state.releaseTimer);
    }
    if (state.node && state.node.isConnected) {
      state.node.remove();
    }
    if (track.instance.rendererNodes) {
      track.instance.rendererNodes.delete(track.id);
    }
    track.renderer = null;
  }

  function clearActivationRequests(instance) {
    for (const requests of [activationRequests, favoriteRequests]) {
      for (const [requestId, request] of requests) {
        if (request.track.instance !== instance) {
          continue;
        }
        clearTimeout(request.timer);
        requests.delete(requestId);
      }
    }
  }

  function shutdownInstanceRenderer(instance, reason) {
    clearActivationRequests(instance);
    Array.from(instance.tracks.values()).forEach(removeRendererTrack);
    if (instance.rendererNodes) {
      instance.rendererNodes.clear();
    }
    restoreRendererCanvas(instance, reason);
    if (instance.rendererLayer) {
      instance.rendererLayer.remove();
      instance.rendererLayer = null;
    }
    instance.rendererGeometryKey = "";
    instance.rendererBorderRadius = null;
  }

  function failInstanceRenderer(instance, reason, error) {
    instance.rendererBlocked = true;
    shutdownInstanceRenderer(instance, reason);
    debugEvent("renderer-failed", {
      instanceId: instance.id,
      reason,
      message: error ? String(error && error.message || error) : ""
    }, "error");
  }

  function releaseRendererTrack(track) {
    const state = track.renderer;
    if (!state) {
      return;
    }
    if (state.hoverTimer) {
      clearTimeout(state.hoverTimer);
      state.hoverTimer = 0;
    }
    if (state.releaseTimer) {
      clearTimeout(state.releaseTimer);
      state.releaseTimer = 0;
    }
    if (state.hovered && Number.isFinite(state.visualLeft) && Number.isFinite(state.targetLeft)) {
      // Preserve the distance accumulated while the ghost trajectory kept
      // moving. A constant offset means this DOM node now travels at exactly
      // the same speed as before the hold instead of springing back to ghost.
      state.resumeOffset = state.visualLeft - state.targetLeft;
    }
    state.hovered = false;
    delete state.node.dataset.hovered;
    if (Math.abs(numberOr(state.resumeOffset, 0)) > 0.1) {
      state.node.dataset.resuming = "true";
    } else {
      delete state.node.dataset.resuming;
    }
  }

  function holdRendererTrack(track) {
    const state = track.renderer;
    if (!state) {
      return;
    }
    state.hovered = true;
    state.node.dataset.hovered = "true";
    delete state.node.dataset.resuming;
    if (state.releaseTimer) {
      clearTimeout(state.releaseTimer);
      state.releaseTimer = 0;
    }
    if (state.hoverTimer) {
      clearTimeout(state.hoverTimer);
    }
    state.hoverTimer = setTimeout(() => {
      if (track.renderer === state && state.hovered) {
        releaseRendererTrack(track);
      }
    }, FROZEN_TRACK_TIMEOUT);
  }

  function scheduleRendererTrackRelease(track) {
    const state = track.renderer;
    if (!state) {
      return;
    }
    if (state.releaseTimer) {
      clearTimeout(state.releaseTimer);
    }
    state.releaseTimer = setTimeout(() => {
      state.releaseTimer = 0;
      if (track.renderer === state) {
        releaseRendererTrack(track);
      }
    }, HOVER_LEAVE_GRACE);
  }

  function rendererPointerTouchesRepeatReminder(event) {
    return pointTouchesRepeatReminder(document, Number(event.clientX), Number(event.clientY));
  }

  function hasHoveredRendererTrack() {
    for (const instance of instances.values()) {
      for (const track of instance.tracks.values()) {
        if (track.renderer && track.renderer.hovered) return true;
      }
    }
    return false;
  }

  function releaseRendererTracksCoveredByRepeatReminder(event) {
    if (!rendererEnabled || !hasHoveredRendererTrack()) return;
    repeatReminderPointerX = Number(event.clientX);
    repeatReminderPointerY = Number(event.clientY);
    if (repeatReminderPointerFrame) return;
    repeatReminderPointerFrame = requestAnimationFrame(() => {
      repeatReminderPointerFrame = 0;
      if (!pointTouchesRepeatReminder(
        document,
        repeatReminderPointerX,
        repeatReminderPointerY
      )) return;
      for (const instance of instances.values()) {
        for (const track of instance.tracks.values()) {
          if (track.renderer && track.renderer.hovered) {
            releaseRendererTrack(track);
          }
        }
      }
    });
  }

  function settleRendererActivation(requestId, ok, reason) {
    const request = activationRequests.get(requestId);
    if (!request) {
      return;
    }
    activationRequests.delete(requestId);
    clearTimeout(request.timer);
    const state = request.track.renderer;
    if (!state || state.button !== request.button) {
      return;
    }
    state.sending = false;
    delete state.node.dataset.sending;
    state.button.disabled = false;
    state.button.textContent = "+1";
    delete state.button.dataset.result;
    delete state.node.dataset.sendOk;
    if (ok) {
      releaseRendererTrack(request.track);
    }
    state.button.title = ok ? "已发送 +1" : `发送失败${reason ? `：${reason}` : ""}`;
    debugState.counters.rendererResults += 1;
    setTimeout(() => {
      if (request.track.renderer === state) {
        state.button.title = "发送相同弹幕（+1）";
      }
    }, ok ? 900 : 1200);
  }

  function activateRendererTrack(track, event) {
    const state = track.renderer;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!state || state.sending || !rendererEnabled || !rendererActions.plusOne) {
      return;
    }
    const button = state.button;
    if (button.dataset.track !== String(track.id)
        || button.dataset.instance !== String(track.instance.id)
        || button.dataset.message !== track.description.text) {
      failInstanceRenderer(track.instance, "activation-metadata-mismatch");
      return;
    }
    const requestId = nextActivationRequestId;
    nextActivationRequestId += 1;
    state.sending = true;
    state.node.dataset.sending = "true";
    button.disabled = true;
    button.textContent = "…";
    const timer = setTimeout(() => {
      settleRendererActivation(requestId, false, "timeout");
    }, RENDERER_RESULT_TIMEOUT);
    activationRequests.set(requestId, { track, button, timer });
    debugState.counters.rendererActivations += 1;
    window.postMessage({
      source: DOUYIN_PAGE_SOURCE,
      type: "renderer-activate",
      requestId,
      trackId: track.id,
      instanceId: track.instance.id,
      messageId: String(track.options.id == null ? track.id : track.options.id),
      text: track.description.text,
      content: track.content
    }, "*");
  }

  function activateRendererReply(track, event) {
    const state = track.renderer;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!state || !rendererEnabled || !rendererActions.reply) {
      return;
    }
    const button = state.replyButton;
    if (button.dataset.track !== String(track.id)
        || button.dataset.instance !== String(track.instance.id)
        || button.dataset.message !== track.description.text) {
      failInstanceRenderer(track.instance, "reply-metadata-mismatch");
      return;
    }
    const requestId = nextReplyRequestId;
    nextReplyRequestId += 1;
    window.postMessage({
      source: DOUYIN_PAGE_SOURCE,
      type: "renderer-reply",
      requestId,
      trackId: track.id,
      instanceId: track.instance.id,
      messageId: String(track.options.id == null ? track.id : track.options.id),
      text: track.description.text,
      sender: track.sender,
      observedAt: track.observedAt,
      content: track.content
    }, "*");
  }

  function settleRendererFavorite(requestId, ok) {
    const request = favoriteRequests.get(requestId);
    if (!request) return;
    favoriteRequests.delete(requestId);
    clearTimeout(request.timer);
    const state = request.track.renderer;
    if (!state || state.favoriteButton !== request.button) return;
    request.button.disabled = false;
    request.button.textContent = ok ? "已收藏" : "收藏";
    request.button.title = ok ? "已收藏到本房" : "收藏失败或暂不支持该内容";
    setTimeout(() => {
      if (request.track.renderer === state) {
        request.button.textContent = "收藏";
        request.button.title = "收藏弹幕";
      }
    }, ok ? 1000 : 1500);
  }

  function activateRendererFavorite(track, event) {
    const state = track.renderer;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!state || !rendererEnabled || !rendererActions.favorite || state.favoriteButton.disabled) {
      return;
    }
    const button = state.favoriteButton;
    if (button.dataset.track !== String(track.id)
        || button.dataset.instance !== String(track.instance.id)
        || button.dataset.message !== track.description.text) {
      failInstanceRenderer(track.instance, "favorite-metadata-mismatch");
      return;
    }
    const requestId = nextFavoriteRequestId++;
    button.disabled = true;
    button.textContent = "…";
    const timer = setTimeout(() => settleRendererFavorite(requestId, false), RENDERER_RESULT_TIMEOUT);
    favoriteRequests.set(requestId, { track, button, timer });
    window.postMessage({
      source: DOUYIN_PAGE_SOURCE,
      type: "renderer-favorite",
      requestId,
      trackId: track.id,
      instanceId: track.instance.id,
      messageId: String(track.options.id == null ? track.id : track.options.id),
      text: track.description.text,
      content: track.content
    }, "*");
  }

  async function activateRendererCopy(track, event) {
    const state = track.renderer;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!state || !rendererEnabled || !rendererActions.copy || !track.description.text) return;
    let copied = false;
    try {
      if (typeof navigator.clipboard?.writeText === "function") {
        await navigator.clipboard.writeText(track.description.text);
        copied = true;
      }
    } catch {
      // Fall through to the selection-based copy path.
    }
    if (!copied) {
      const input = document.createElement("textarea");
      input.value = track.description.text;
      input.readOnly = true;
      input.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
      document.body.appendChild(input);
      try {
        input.focus({ preventScroll: true });
        input.select();
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      } finally {
        input.remove();
      }
    }
    state.copyButton.textContent = copied ? "已复制" : "复制失败";
    state.copyButton.title = copied ? "弹幕内容已复制" : "复制失败，请重试";
    setTimeout(() => {
      if (track.renderer === state) {
        state.copyButton.textContent = "复制";
        state.copyButton.title = "复制弹幕内容";
      }
    }, copied ? 900 : 1400);
  }

  function createRendererActionItem(label, action) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "bcp-douyin-dom-action-item";
    item.textContent = label;
    item.dataset.action = action;
    item.dataset.bcpDouyinOwned = "true";
    return item;
  }

  function ignoreRendererPlaceholderAction(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function renderRendererActionBar(state) {
    const visible = [
      ["plusOne", state.button],
      ["reply", state.replyButton],
      ["favorite", state.favoriteButton],
      ["copy", state.copyButton]
    ].filter(([key]) => rendererActions[key]);
    const fragment = document.createDocumentFragment();
    visible.forEach(([, item], index) => {
      if (index > 0) {
        const divider = document.createElement("span");
        divider.className = "bcp-douyin-dom-action-divider";
        divider.setAttribute("aria-hidden", "true");
        fragment.appendChild(divider);
      }
      fragment.appendChild(item);
    });
    state.actionBar.replaceChildren(fragment);
    const width = rendererActionWidth();
    state.actionBar.hidden = visible.length === 0;
    state.actionBar.style.flex = `0 0 ${width}px`;
    state.actionBar.style.width = `${width}px`;
    state.actionBar.style.minWidth = `${width}px`;
    state.actionBar.style.maxWidth = `${width}px`;
    state.node.style.setProperty("--bcp-douyin-action-space", `${width}px`);
  }

  function createRendererTrack(track, layer) {
    const instance = track.instance;
    if (instance.rendererNodes.size >= DOM_NODE_LIMIT) {
      throw new Error(`renderer node limit exceeded (${DOM_NODE_LIMIT})`);
    }
    const node = document.createElement("div");
    node.className = "bcp-douyin-dom-track";
    node.dataset.bcpDouyinOwned = "true";
    setRendererMetadata(node, track);

    const barrage = document.createElement("div");
    barrage.className = "bcp-douyin-dom-barrage";
    barrage.dataset.bcpDouyinOwned = "true";
    if (track.own) {
      barrage.dataset.own = "true";
    }
    setRendererMetadata(barrage, track);
    node.style.position = "absolute";
    node.style.left = "0";
    node.style.top = "0";
    node.style.display = "flex";
    node.style.alignItems = "center";
    node.style.boxSizing = "border-box";
    node.style.whiteSpace = "nowrap";
    node.style.columnGap = `${DOM_ACTION_GAP}px`;
    node.style.paddingRight = `${DOM_ACTION_TRAILING_SPACE}px`;
    node.style.pointerEvents = "auto";
    node.style.userSelect = "none";
    node.style.webkitUserSelect = "none";
    node.style.willChange = "transform";
    node.style.contain = "layout style";
    node.style.overflow = "visible";

    barrage.style.display = "flex";
    barrage.style.alignItems = "center";
    barrage.style.flex = "1 0 auto";
    barrage.style.flexShrink = "0";
    barrage.style.minWidth = "0";
    barrage.style.height = "100%";
    barrage.style.boxSizing = "border-box";
    barrage.style.pointerEvents = "none";
    barrage.style.padding = rendererBox(track.description.rendererPadding);

    const content = document.createElement("span");
    content.className = "bcp-douyin-dom-content";
    content.style.display = "flex";
    content.style.alignItems = "center";
    content.style.flex = "1 1 auto";
    content.style.minWidth = "0";
    content.style.height = "100%";
    content.style.overflow = "visible";
    content.style.pointerEvents = "auto";
    const fragment = document.createDocumentFragment();
    track.content.forEach((item) => {
      const child = createRendererContent(item, 0);
      if (child) {
        fragment.appendChild(child);
      }
    });
    if (!fragment.childNodes.length) {
      content.textContent = track.description.text;
    } else {
      content.appendChild(fragment);
    }
    const firstText = track.description.firstText || {};
    applyRendererContentStyle(content, firstText);

    const actionBar = document.createElement("div");
    actionBar.className = "bcp-douyin-dom-action";
    actionBar.dataset.bcpDouyinOwned = "true";
    actionBar.setAttribute("role", "toolbar");
    actionBar.setAttribute("aria-label", "弹幕快捷操作");
    setRendererMetadata(actionBar, track);

    const button = createRendererActionItem("+1", "plus-one");
    button.classList.add("bcp-douyin-dom-plus-one");
    button.title = "发送相同弹幕（+1）";
    button.setAttribute("aria-label", `发送相同弹幕：${track.description.text}`);
    setRendererMetadata(button, track);

    const replyButton = createRendererActionItem("回复", "reply");
    replyButton.setAttribute("aria-label", `回复弹幕：${track.description.text}`);
    setRendererMetadata(replyButton, track);
    const favoriteButton = createRendererActionItem("收藏", "favorite");
    favoriteButton.setAttribute("aria-label", `收藏弹幕：${track.description.text}`);
    setRendererMetadata(favoriteButton, track);
    const copyButton = createRendererActionItem("复制", "copy");
    copyButton.setAttribute("aria-label", `复制弹幕：${track.description.text}`);
    copyButton.title = "复制弹幕内容";
    setRendererMetadata(copyButton, track);

    barrage.appendChild(content);
    node.append(barrage, actionBar);
    const state = {
      node,
      barrage,
      content,
      actionBar,
      button,
      replyButton,
      favoriteButton,
      copyButton,
      hovered: false,
      sending: false,
      visualLeft: null,
      targetLeft: null,
      resumeOffset: 0,
      visualWidth: 0,
      visualHeight: 0,
      actionSide: null,
      hoverTimer: 0,
      releaseTimer: 0
    };
    track.renderer = state;
    renderRendererActionBar(state);
    instance.rendererNodes.set(track.id, node);
    node.addEventListener("pointerenter", (event) => {
      if (rendererPointerTouchesRepeatReminder(event)) {
        releaseRendererTrack(track);
        return;
      }
      holdRendererTrack(track);
    });
    node.addEventListener("pointerleave", () => scheduleRendererTrackRelease(track));
    node.addEventListener("click", (event) => event.stopPropagation());
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => activateRendererTrack(track, event));
    replyButton.addEventListener("pointerdown", ignoreRendererPlaceholderAction);
    replyButton.addEventListener("click", (event) => activateRendererReply(track, event));
    favoriteButton.addEventListener("pointerdown", ignoreRendererPlaceholderAction);
    favoriteButton.addEventListener("click", (event) => activateRendererFavorite(track, event));
    copyButton.addEventListener("pointerdown", ignoreRendererPlaceholderAction);
    copyButton.addEventListener("click", (event) => void activateRendererCopy(track, event));
    layer.appendChild(node);
    debugState.counters.rendererNodesCreated += 1;
    return state;
  }

  function syncRendererTrack(track, barrageRect, canvasRect) {
    const state = track.renderer;
    if (!state) {
      return;
    }
    const nativeLeft = barrageRect.left - canvasRect.left;
    const targetTop = barrageRect.top - canvasRect.top;
    const actionWidth = Math.max(0,
      numberOr(track.description.actionWidth, rendererActionWidth()));
    // `barrageRect` is already in CSS viewport pixels while the description
    // may still be in the Canvas renderer's logical coordinate system. Derive
    // the visible text box from the rendered track width so resized/fullscreen
    // players use the correct edge for side selection.
    const contentWidth = Math.max(
      1,
      barrageRect.width - actionWidth - DOM_ACTION_GAP - DOM_ACTION_TRAILING_SPACE
    );
    const placement = overlayCapsulePlacement({
      anchorLeft: nativeLeft,
      anchorRight: nativeLeft + contentWidth,
      capsuleWidth: actionWidth,
      viewportLeft: 0,
      viewportRight: canvasRect.width,
      gap: DOM_ACTION_GAP
    });
    // Lock the side while hovered. The hidden toolbar may switch sides during
    // normal movement, but moving it under an active pointer would break the
    // combined barrage/capsule hover target.
    const actionSide = state.hovered && state.actionSide
      ? state.actionSide
      : placement.side;
    state.actionSide = actionSide;
    state.node.dataset.bcpOverlaySide = actionSide;
    state.actionBar.dataset.bcpOverlaySide = actionSide;
    state.actionBar.style.order = actionSide === "left" ? "-1" : "1";
    state.barrage.style.order = "0";
    // Reordering puts the action before the barrage. Shift the track left by
    // the same reserved width so the barrage text itself never jumps.
    const targetLeft = nativeLeft
      - (actionSide === "left" ? actionWidth + DOM_ACTION_GAP : 0);
    state.targetLeft = targetLeft;
    if (!Number.isFinite(state.visualLeft)) {
      state.visualLeft = targetLeft;
    } else if (!state.hovered) {
      state.visualLeft = targetLeft + numberOr(state.resumeOffset, 0);
    }
    if (!state.hovered) {
      const width = Math.max(
        actionWidth + DOM_ACTION_GAP + DOM_ACTION_TRAILING_SPACE + 1,
        barrageRect.width
      );
      const height = Math.max(rendererActionHeight(), barrageRect.height);
      if (Math.abs(width - state.visualWidth) > 0.1) {
        state.node.style.width = `${width}px`;
        state.visualWidth = width;
      }
      if (Math.abs(height - state.visualHeight) > 0.1) {
        state.node.style.height = `${height}px`;
        state.visualHeight = height;
      }
    }
    state.node.style.transform = `translate3d(${state.visualLeft}px, ${targetTop}px, 0)`;
  }

  function updateRendererFrame(instance, canvasRect) {
    if (document.fullscreenElement === instance.canvas) {
      if (instance.rendererLayer || instance.rendererTakeover) {
        shutdownInstanceRenderer(instance, "canvas-is-fullscreen-element");
      }
      return;
    }
    if (!rendererEnabled || !instance.active || instance.rendererBlocked
        || !rendererInstanceSafe(instance)) {
      if (instance.rendererLayer || instance.rendererTakeover) {
        shutdownInstanceRenderer(instance, !rendererEnabled ? "disabled" : "unsafe-instance");
      }
      return;
    }
    if (instance.rendererPreparing > 0) {
      if (instance.rendererTakeover) {
        restoreRendererCanvas(instance, "barrage-preparing");
      }
      return;
    }
    const layer = ensureRendererLayer(instance, canvasRect);
    for (const track of instance.tracks.values()) {
      if (!track.bookedChannel) {
        continue;
      }
      const barrageRect = trackRect(track, canvasRect);
      if (!barrageRect) {
        continue;
      }
      const state = track.renderer || createRendererTrack(track, layer);
      if (!state.node.isConnected) {
        throw new Error("renderer barrage detached before takeover");
      }
      syncRendererTrack(track, barrageRect, canvasRect);
    }
    if (instance.rendererNodes.size) {
      takeOverRendererCanvas(instance);
    }
  }

  function stopAnimation(instance) {
    if (instance.animationFrame) {
      cancelAnimationFrame(instance.animationFrame);
      instance.animationFrame = 0;
    }
  }

  function channelsEmpty(instance) {
    return instance.channels.every((channel) => channel.length === 0);
  }

  function removeExpiredTracks(instance, rect) {
    const expired = new Set();
    instance.channels = instance.channels.map((channel) => channel.filter((track) => {
      if (trackIsExpired(track, rect)) {
        expired.add(track.id);
        return false;
      }
      return true;
    }));
    expired.forEach((id) => {
      const track = instance.tracks.get(id);
      if (track) {
        removeRendererTrack(track);
      }
      instance.tracks.delete(id);
      if (instance.frameState) {
        instance.frameState.previousIds.delete(id);
      }
    });
  }

  function modelFrame(instance) {
    try {
      advanceModelFrame(instance);
    } catch (error) {
      instance.animationFrame = 0;
      failInstanceRenderer(instance, "animation-frame-error", error);
    }
  }

  function advanceModelFrame(instance) {
    instance.animationFrame = 0;
    if (!instance.active || !(instance.canvas instanceof HTMLCanvasElement)
        || !instance.canvas.isConnected) {
      return;
    }
    const rect = instance.canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) {
      instance.animationFrame = requestAnimationFrame(() => modelFrame(instance));
      return;
    }
    ensureChannels(instance, channelInfo(instance, rect).maxCanUse);
    const now = Date.now();
    const rawDelta = instance.lastFrameAt ? now - instance.lastFrameAt : 16;
    const deltaTime = Math.max(0, Math.min(rawDelta, 300_000));
    instance.lastFrameAt = now;
    removeExpiredTracks(instance, rect);
    if (channelsEmpty(instance)) {
      updateRendererFrame(instance, rect);
      return;
    }

    const frameState = instance.frameState;
    const speeds = frameState.speeds;
    const rightPositions = frameState.rightPositions;
    const previousIds = frameState.previousIds;
    const moved = frameState.moved;
    speeds.clear();
    rightPositions.clear();
    moved.clear();
    previousIds.forEach((items) => { items.length = 0; });
    instance.channels.forEach((channel) => {
      let channelSpeed = Infinity;
      channel.forEach((track, index) => {
        const barrageId = String(track.options.id || track.id);
        const ownSpeed = trackSpeed(track, rect);
        channelSpeed = Math.min(channelSpeed, speeds.get(barrageId) || ownSpeed, ownSpeed);
        speeds.set(barrageId, channelSpeed);
        rightPositions.set(barrageId, trackRightPosition(track, rect));
        if (!previousIds.has(track.id)) {
          previousIds.set(track.id, []);
        }
        if (index > 0) {
          previousIds.get(track.id).push(
            String(channel[index - 1].options.id || channel[index - 1].id)
          );
        }
      });
    });

    instance.channels.forEach((channel, channelIndex) => {
      channel.forEach((track) => {
        if (moved.has(track.id) || !track.bookedChannel
            || track.bookedChannel.start !== channelIndex) {
          return;
        }
        moved.add(track.id);
        const barrageId = String(track.options.id || track.id);
        const predecessors = previousIds.get(track.id) || [];
        const gap = Math.max(0, numberOr(instance.config.gap, 100)) * modelDpr(instance);
        let preRightEdge = -Infinity;
        predecessors.forEach((id) => {
          preRightEdge = Math.max(preRightEdge, numberOr(rightPositions.get(id), -Infinity));
        });
        if (Number.isFinite(preRightEdge)) {
          preRightEdge += gap;
        }
        const pixels = canvasPixelSize(instance, rect);
        const dpr = modelDpr(instance);
        const speed = numberOr(speeds.get(barrageId), trackSpeed(track, rect));
        if (deltaTime > 1000) {
          track.deltaXWithoutDpr += deltaTime * speed;
          rightPositions.set(barrageId, trackRightPosition(track, rect));
          return;
        }
        const nextLeft = pixels.width - (track.deltaXWithoutDpr + deltaTime * speed) * dpr;
        if (!Number.isFinite(preRightEdge) || nextLeft >= preRightEdge) {
          track.deltaXWithoutDpr += deltaTime * speed;
        } else {
          track.deltaXWithoutDpr = (pixels.width - preRightEdge) / dpr;
        }
        rightPositions.set(barrageId, trackRightPosition(track, rect));
      });
    });
    updateRendererFrame(instance, rect);
    instance.animationFrame = requestAnimationFrame(() => modelFrame(instance));
  }

  function startAnimation(instance) {
    if (!instance.animationFrame && instance.active) {
      instance.lastFrameAt = 0;
      instance.animationFrame = requestAnimationFrame(() => modelFrame(instance));
    }
  }

  function assignPendingTracks(instance) {
    instance.pushTimer = 0;
    if (!(instance.canvas instanceof HTMLCanvasElement)) {
      return;
    }
    if (!instance.canvas.isConnected) {
      if (!instance.canvasEverConnected && instances.get(instance.id) === instance && instance.active
          && Date.now() < instance.mountGraceUntil) {
        instance.pushTimer = setTimeout(() => assignPendingTracks(instance), CANVAS_MOUNT_RETRY);
      }
      return;
    }
    instance.canvasEverConnected = true;
    const rect = instance.canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) {
      instance.pushTimer = setTimeout(() => assignPendingTracks(instance), 300);
      return;
    }
    const wasEmpty = channelsEmpty(instance);
    const info = channelInfo(instance, rect);
    ensureChannels(instance, info.maxCanUse);
    instance.pending.sort((first, second) =>
      trackPriority(first, info.maxDisplay) - trackPriority(second, info.maxDisplay));
    const blockedPriorities = new Set();

    instance.pending.forEach((track) => {
      const priority = trackPriority(track, info.maxDisplay);
      if (track.bookedChannel
          || Array.from(blockedPriorities).some((blocked) => blocked > priority)) {
        return;
      }
      const needed = Math.max(1, Math.ceil(
        trackInternalHeight(track)
        / (Math.max(1, numberOr(instance.config.channelHeight, 40)) * modelDpr(instance))
      ));
      const range = realChannelRange(track, info.maxDisplay, info.maxCanUse);
      let consecutive = 0;
      for (let index = range.start; index < info.maxCanUse; index += 1) {
        const channel = instance.channels[index];
        const last = channel && channel[channel.length - 1];
        if (!last || trackRightEdgeVisible(last, rect)) {
          consecutive += 1;
        } else {
          consecutive = 0;
          if (index >= range.end) {
            break;
          }
        }
        if (consecutive >= needed) {
          const start = index - consecutive + 1;
          const end = index;
          track.bookedChannel = { start, end };
          track.startedAt = Date.now();
          for (let channelIndex = start; channelIndex <= end; channelIndex += 1) {
            instance.channels[channelIndex].push(track);
          }
          debugState.counters.barragesStarted += 1;
          debugEvent("barrage-started", {
            instanceId: instance.id,
            trackId: track.id,
            text: track.description.text,
            channel: [start, end],
            pendingDelay: track.startedAt - track.observedAt
          });
          return;
        }
      }
      blockedPriorities.add(priority);
    });

    const remaining = [];
    instance.pending.forEach((track) => {
      if (track.bookedChannel) {
        return;
      }
      if (trackNeedsReserve(track, info.maxDisplay)) {
        remaining.push(track);
      } else {
        removeRendererTrack(track);
        instance.tracks.delete(track.id);
        instance.frameState.previousIds.delete(track.id);
        debugEvent("barrage-dropped", {
          instanceId: instance.id,
          trackId: track.id,
          text: track.description.text,
          reason: "reserve-expired"
        });
      }
    });
    instance.pending = remaining;
    if (instance.active && wasEmpty && !channelsEmpty(instance)) {
      startAnimation(instance);
    }
    if (remaining.length) {
      instance.pushTimer = setTimeout(() => assignPendingTracks(instance), 300);
    }
    scheduleDebugMarker();
  }

  function prepareBarrage(instance, options, observedAt, rendererGeneration) {
    if (!instances.has(instance.id) || instances.get(instance.id) !== instance
        || instance.rendererGeneration !== rendererGeneration) {
      return;
    }
    // Never wait for remote image metadata before deciding whether Canvas can
    // be hidden. Douyin usually provides image dimensions; missing dimensions
    // use the same deterministic square fallback in both measurement and DOM.
    const description = describeBarrage(options, instance.config, null);
    const content = serializeBarrage(options);
    const nativeMessageText = nativeBarrageMessageText(options, content);
    const interactionText = barrageInteractionText(
      nativeMessageText || description.text,
      description.imageCount
    );
    if (!interactionText) {
      debugState.counters.skippedBarrages += 1;
      debugEvent("barrage-skipped", {
        instanceId: instance.id,
        reason: "no-interactive-text",
        barrageId: String(options.id == null ? "" : options.id),
        imageCount: description.imageCount
      });
      return false;
    }
    description.imageOnly = !plausibleText(description.text) && description.imageCount > 0;
    description.text = interactionText;
    const repeatReminderMessageId = String(
      options.id ?? options.messageId ?? options.msgId ?? options.itemId ?? ""
    ).slice(0, 180);
    const repeatReminderExclusion = douyinRepeatReminderExclusionReason({
      messageId: repeatReminderMessageId,
      record: options,
      text: interactionText
    });
    if (rendererRepeatReminderEnabled) {
      window.postMessage({
        source: DOUYIN_PAGE_SOURCE,
        type: "repeat-reminder-message",
        message: {
          content,
          excludedReason: repeatReminderExclusion,
          instanceId: instance.id,
          messageId: repeatReminderMessageId,
          observedAt,
          sender: extractSenderFromRecord(options),
          text: interactionText,
          trackId: nextTrackId
        }
      }, "*");
    }
    const sourcePadding = boxEdges(options.padding);
    const uniformPadding = Math.min(DOM_BARRAGE_PADDING_MAX, Math.max(
      DOM_BARRAGE_PADDING,
      sourcePadding.top,
      sourcePadding.right,
      sourcePadding.bottom,
      sourcePadding.left
    ));
    description.rendererPadding = [
      uniformPadding,
      uniformPadding,
      uniformPadding,
      uniformPadding
    ];
    description.width += description.rendererPadding[1] + description.rendererPadding[3]
      - sourcePadding.right - sourcePadding.left;
    description.height += description.rendererPadding[0] + description.rendererPadding[2]
      - sourcePadding.top - sourcePadding.bottom;
    description.contentWidth = description.width;
    description.contentHeight = description.height;
    description.actionWidth = rendererActionWidth();
    description.width += description.actionWidth + DOM_ACTION_GAP + DOM_ACTION_TRAILING_SPACE;
    description.height = Math.max(rendererActionHeight(), description.height);
    const maxCount = Math.max(1, numberOr(instance.config.maxCount, 200));
    if (instance.pending.length >= maxCount) {
      debugState.counters.skippedBarrages += 1;
      debugEvent("barrage-skipped", { instanceId: instance.id, reason: "pending-limit" });
      return false;
    }
    const track = {
      id: nextTrackId,
      instance,
      options,
      description,
      content,
      sender: extractSenderFromRecord(options),
      own: consumeOwnMessage(description.text, content),
      deltaXWithoutDpr: 0,
      bookedChannel: null,
      observedAt,
      startedAt: 0
    };
    const canvasRect = instance.canvas instanceof HTMLCanvasElement
      ? instance.canvas.getBoundingClientRect()
      : null;
    if (canvasRect && canvasRect.width >= 20 && canvasRect.height >= 20) {
      const optionStart = numberOr(options.startTime, 0);
      const now = Date.now();
      const credibleStart = optionStart > now - 60_000 && optionStart < now + 5_000
        ? optionStart
        : observedAt;
      const preparationDelay = Math.max(0, Math.min(trackDuration(track), now - credibleStart));
      track.deltaXWithoutDpr = preparationDelay * trackSpeed(track, canvasRect);
    }
    nextTrackId += 1;
    instance.tracks.set(track.id, track);
    const wasEmpty = instance.pending.length === 0;
    instance.pending.push(track);
    if (wasEmpty) {
      if (instance.pushTimer) {
        clearTimeout(instance.pushTimer);
        instance.pushTimer = 0;
      }
      assignPendingTracks(instance);
    } else if (!instance.pushTimer) {
      instance.pushTimer = setTimeout(() => assignPendingTracks(instance), 300);
    }
    return true;
  }

  function queueBarrage(instance, options) {
    if (!options || typeof options !== "object") {
      return;
    }
    if (instance.rendererCleanClearObserved) {
      instance.rendererSafeSync = true;
      instance.rendererCleanClearObserved = false;
      instance.rendererBlocked = false;
      debugEvent("renderer-clean-sync", { instanceId: instance.id });
    }
    debugState.counters.barragesObserved += 1;
    const observedAt = Date.now();
    const rendererGeneration = instance.rendererGeneration;
    instance.rendererPreparing += 1;
    try {
      prepareBarrage(instance, options, observedAt, rendererGeneration);
    } catch (error) {
      if (instances.get(instance.id) === instance
          && instance.rendererGeneration === rendererGeneration) {
        failInstanceRenderer(instance, "prepare-barrage-error", error);
      }
      debugEvent("prepare-barrage-error", {
        instanceId: instance.id,
        message: String(error && error.message || error)
      }, "error");
    } finally {
      if (instances.get(instance.id) === instance
          && instance.rendererGeneration === rendererGeneration) {
        instance.rendererPreparing = Math.max(0, instance.rendererPreparing - 1);
        if (instance.active && !channelsEmpty(instance)) {
          startAnimation(instance);
        }
      }
    }
  }

  function clearInstance(instance, reason) {
    if (instance.pushTimer) {
      clearTimeout(instance.pushTimer);
      instance.pushTimer = 0;
    }
    shutdownInstanceRenderer(instance, reason || "instance-cleared");
    instance.rendererGeneration += 1;
    instance.rendererPreparing = 0;
    stopAnimation(instance);
    instance.pending.length = 0;
    instance.tracks.clear();
    instance.channels = [];
    instance.frameState.speeds.clear();
    instance.frameState.rightPositions.clear();
    instance.frameState.previousIds.clear();
    instance.frameState.moved.clear();
    instance.lastFrameAt = 0;
  }

  function looksLikeDanmakuConfig(config, canvas) {
    return isDanmakuCanvas(canvas)
      || (config && numberOr(config.channelHeight, 0) > 0 && numberOr(config.duration, 0) > 0);
  }

  function defaultConfigForCanvas(canvas) {
    const rect = canvas instanceof HTMLCanvasElement
      ? canvas.getBoundingClientRect()
      : { width: 0, height: 0 };
    return {
      width: Math.max(20, rect.width || 0),
      height: Math.max(20, rect.height || 0),
      devicePixelRatio: Math.max(0.25, numberOr(globalThis.devicePixelRatio, 1)),
      fontSize: 20,
      channelHeight: 40,
      duration: 15_000,
      gap: 100,
      maxCount: 200,
      maxHeightRate: 1
    };
  }

  function createTrackedInstance(id, canvas, config, recovered) {
    const previous = instances.get(id);
    if (previous) {
      clearInstance(previous, "instance-replaced");
    }
    const mergedConfig = Object.assign(defaultConfigForCanvas(canvas), config || {});
    const instance = {
      id,
      canvas,
      canvasId: canvasId(canvas),
      config: mergedConfig,
      tracks: new Map(),
      pending: [],
      channels: [],
      frameState: {
        speeds: new Map(),
        rightPositions: new Map(),
        previousIds: new Map(),
        moved: new Set()
      },
      pushTimer: 0,
      animationFrame: 0,
      lastFrameAt: 0,
      active: true,
      recovered: Boolean(recovered),
      createdAt: Date.now(),
      mountGraceUntil: Date.now() + CANVAS_MOUNT_GRACE,
      canvasEverConnected: Boolean(canvas.isConnected),
      rendererLayer: null,
      rendererNodes: new Map(),
      rendererTakeover: false,
      rendererOwnsCanvasVisibility: false,
      rendererCanvasVisibility: "",
      rendererPreparing: 0,
      rendererGeneration: 1,
      rendererSafeSync: !recovered,
      rendererSafeAfter: recovered
        ? Date.now() + Math.max(1000, numberOr(mergedConfig.duration, 15_000)) + 1000
        : Infinity,
      rendererCleanClearObserved: false,
      rendererBlocked: false
    };
    instances.set(id, instance);
    if (recovered) {
      debugState.counters.instancesRecovered += 1;
    } else {
      debugState.counters.instancesCreated += 1;
    }
    debugEvent(recovered ? "instance-recovered" : "instance-created", {
      instanceId: id,
      canvasId: instance.canvasId,
      marker: elementMarker(canvas.parentElement),
      config: instance.config
    }, recovered ? "warn" : "info");
    return instance;
  }

  function roughBarrageText(item) {
    if (!item || typeof item !== "object") {
      return "";
    }
    if (item.type === "text") {
      return normalizeText(item.text);
    }
    return (Array.isArray(item.content) ? item.content : [])
      .map(roughBarrageText)
      .join("");
  }

  let recoveryTimer = 0;

  function scheduleRecovery() {
    if (!recoveryTimer && orphanMessages.size) {
      recoveryTimer = setTimeout(recoverOrphans, 120);
    }
  }

  function rememberOrphan(id, method, params) {
    if (!id) {
      return;
    }
    let orphan = orphanMessages.get(id);
    if (!orphan) {
      orphan = {
        id,
        createdAt: Date.now(),
        config: {},
        barrages: []
      };
      orphanMessages.set(id, orphan);
    }
    if (method === "createInstance" || method === "updateConfig") {
      const config = method === "createInstance" && params.config
        ? params.config
        : params;
      if (config && typeof config === "object") {
        Object.assign(orphan.config, config);
      }
      if (method === "createInstance" && Array.isArray(params.barrages)) {
        orphan.barrages.push(...params.barrages);
      }
    } else if (method === "addBarrage" && Array.isArray(params.content)
        && plausibleText(roughBarrageText(params))) {
      orphan.barrages.push(params);
    }
    debugEvent("orphan-observed", {
      instanceId: id,
      method,
      barrageCount: orphan.barrages.length
    }, "warn");
    scheduleRecovery();
  }

  function recoverOrphans() {
    recoveryTimer = 0;
    for (const [id, orphan] of orphanMessages) {
      if (Date.now() - orphan.createdAt > 12_000) {
        orphanMessages.delete(id);
        debugEvent("orphan-expired", { instanceId: id }, "warn");
        continue;
      }
      const canvas = findUnclaimedCanvas();
      if (!(canvas instanceof HTMLCanvasElement)) {
        continue;
      }
      const instance = createTrackedInstance(id, canvas, orphan.config, true);
      orphanMessages.delete(id);
      orphan.barrages.forEach((barrage) => queueBarrage(instance, barrage));
    }
    scheduleRecovery();
  }

  function observeWorkerMessage(message) {
    if (!message || typeof message !== "object" || !message.method) {
      return;
    }
    debugState.counters.workerMessages += 1;
    const id = String(message._uniqueId == null ? "" : message._uniqueId);
    const params = message.params && typeof message.params === "object" ? message.params : {};
    if (message.method === "createInstance") {
      const offscreen = params.offscrrenCanvas || params.offscreenCanvas;
      const mappedCanvas = offscreenSources.get(offscreen);
      const canvas = mappedCanvas || findUnclaimedCanvas();
      const config = params.config && typeof params.config === "object" ? params.config : {};
      if (!(canvas instanceof HTMLCanvasElement) || !id || !looksLikeDanmakuConfig(config, canvas)) {
        rememberOrphan(id, "createInstance", params);
        return;
      }
      // Missing transfer metadata means the hook arrived after OffscreenCanvas
      // ownership changed or matched heuristically. Treat it as recovered so a
      // guessed Canvas can never be hidden before a clean sync boundary.
      const instance = createTrackedInstance(id, canvas, config, !mappedCanvas);
      orphanMessages.delete(id);
      const barrages = Array.isArray(params.barrages) ? params.barrages : [];
      barrages.forEach((barrage) => queueBarrage(instance, barrage));
      return;
    }

    const instance = instances.get(id);
    if (!instance) {
      if (message.method === "addBarrage" || message.method === "updateConfig") {
        rememberOrphan(id, message.method, params);
      }
      return;
    }
    if (message.method === "addBarrage") {
      queueBarrage(instance, params);
    } else if (message.method === "updateConfig") {
      Object.assign(instance.config, params);
      debugEvent("config-updated", { instanceId: id, config: params });
    } else if (message.method === "clear") {
      clearInstance(instance, "worker-clear");
      instance.rendererSafeSync = false;
      instance.rendererSafeAfter = Infinity;
      instance.rendererCleanClearObserved = true;
      instance.rendererBlocked = false;
      debugEvent("instance-cleared", { instanceId: id });
    } else if (message.method === "destroy") {
      clearInstance(instance, "worker-destroy");
      instances.delete(id);
      debugEvent("instance-destroyed", { instanceId: id }, "info");
    } else if (message.method === "stop" && instance.active) {
      instance.active = false;
      if (instance.pushTimer) {
        clearTimeout(instance.pushTimer);
        instance.pushTimer = 0;
      }
      stopAnimation(instance);
      shutdownInstanceRenderer(instance, "worker-stop");
      debugEvent("instance-stopped", { instanceId: id });
    } else if (message.method === "start" && !instance.active) {
      instance.active = true;
      assignPendingTracks(instance);
      if (!channelsEmpty(instance)) {
        startAnimation(instance);
      }
      debugEvent("instance-started", { instanceId: id });
    }
  }

  function patchMessageSender(prototype) {
    const original = prototype && prototype.postMessage;
    if (typeof original !== "function" || original.__danmakuEchoObserved) {
      return;
    }
    function danmakuEchoPostMessage(...args) {
      const [message] = args;
      try {
        observeWorkerMessage(message);
      } catch (error) {
        // Reading metadata must never interfere with Douyin's own worker call.
        debugEvent("observe-message-error", {
          method: message && message.method,
          message: String(error && error.message || error)
        }, "error");
      }
      return Reflect.apply(original, this, args);
    }
    danmakuEchoPostMessage.__danmakuEchoObserved = true;
    Object.defineProperty(prototype, "postMessage", {
      configurable: true,
      writable: true,
      value: danmakuEchoPostMessage
    });
    debugEvent("message-sender-patched", {
      prototype: prototype === (globalThis.Worker && globalThis.Worker.prototype)
        ? "Worker"
        : "MessagePort"
    }, "info");
  }

  function postReady(requestId) {
    window.postMessage({
      source: DOUYIN_PAGE_SOURCE,
      type: "ready",
      requestId: requestId || 0,
      instanceCount: instances.size,
      version: DEBUG_VERSION,
      orphanCount: orphanMessages.size,
      rendererEnabled
    }, "*");
  }

  function postRendererReady(requestId) {
    window.postMessage({
      source: DOUYIN_PAGE_SOURCE,
      type: "renderer-ready",
      requestId: Number(requestId) || 0,
      enabled: rendererEnabled,
      instanceCount: instances.size,
      takeoverCount: Array.from(instances.values())
        .filter((instance) => instance.rendererTakeover).length,
      version: DEBUG_VERSION
    }, "*");
  }

  function updateRendererSettings(data) {
    const wasEnabled = rendererEnabled;
    const wasRepeatReminderEnabled = rendererRepeatReminderEnabled;
    const nextActions = normalizeRendererActions(data.actions);
    const nextCapsuleScale = normalizeCapsuleScale(data.capsuleScalePercent);
    const actionsChanged = ["plusOne", "reply", "favorite", "copy"]
      .some((key) => nextActions[key] !== rendererActions[key]);
    const scaleChanged = nextCapsuleScale !== rendererCapsuleScale;
    rendererHeartbeatAt = Date.now();
    rendererActions = nextActions;
    rendererCapsuleScale = nextCapsuleScale;
    rendererEnabled = Boolean(data.enabled);
    rendererRepeatReminderEnabled = rendererEnabled && Boolean(data.repeatReminderEnabled);
    if (actionsChanged || scaleChanged) {
      const actionWidth = rendererActionWidth();
      for (const instance of instances.values()) {
        for (const track of instance.tracks.values()) {
          const previousWidth = Math.max(0, numberOr(track.description.actionWidth, actionWidth));
          track.description.actionWidth = actionWidth;
          track.description.width += actionWidth - previousWidth;
          track.description.height = Math.max(
            numberOr(track.description.contentHeight, track.description.height),
            rendererActionHeight()
          );
          if (track.renderer) {
            renderRendererActionBar(track.renderer);
            track.renderer.visualWidth = 0;
          }
        }
      }
    }
    if (!rendererEnabled) {
      for (const instance of instances.values()) {
        shutdownInstanceRenderer(instance, "settings-disabled");
      }
    } else {
      for (const instance of instances.values()) {
        if (instance.active && !channelsEmpty(instance)) {
          startAnimation(instance);
        }
      }
    }
    if (rendererEnabled !== wasEnabled || rendererRepeatReminderEnabled !== wasRepeatReminderEnabled
        || actionsChanged || scaleChanged) {
      debugEvent("renderer-settings", {
        enabled: rendererEnabled,
        repeatReminderEnabled: rendererRepeatReminderEnabled,
        actions: rendererActions,
        capsuleScale: rendererCapsuleScale,
        instanceCount: instances.size
      }, "info");
    }
    postRendererReady(data.requestId);
  }

  observeCanvasTransfers();
  patchMessageSender(globalThis.Worker && globalThis.Worker.prototype);
  patchMessageSender(globalThis.MessagePort && globalThis.MessagePort.prototype);

  window.addEventListener("message", (event) => {
    if (event.source !== window || !isDouyinProtocolMessage(event.data, DOUYIN_CONTENT_SOURCE)) {
      return;
    }
    if (event.data.type === "ping") {
      postReady(event.data.requestId);
      return;
    }
    if (event.data.type === "debug-request") {
      window.postMessage({
        source: DOUYIN_PAGE_SOURCE,
        type: "debug-snapshot",
        requestId: Number(event.data.requestId) || 0,
        snapshot: debugSnapshot()
      }, "*");
      return;
    }
    if (event.data.type === "renderer-settings") {
      updateRendererSettings(event.data);
      return;
    }
    if (event.data.type === "emoji-catalog") {
      applyDouyinEmojiCatalog(event.data);
      return;
    }
    if (event.data.type === "renderer-message-resolved") {
      applyResolvedRendererMessage(event.data);
      return;
    }
    if (event.data.type === "own-message-intent") {
      rememberOwnMessage(event.data);
      return;
    }
    if (event.data.type === "own-message-cancel") {
      cancelOwnMessage(event.data);
      return;
    }
    if (event.data.type === "renderer-result") {
      const requestId = Number(event.data.requestId) || 0;
      const request = activationRequests.get(requestId);
      if (request && event.data.trackId != null
          && String(event.data.trackId) !== String(request.track.id)) {
        settleRendererActivation(requestId, false, "track-mismatch");
      } else {
        settleRendererActivation(requestId, event.data.ok === true,
          String(event.data.reason || "").slice(0, 120));
      }
      return;
    }
    if (event.data.type === "renderer-favorite-result") {
      settleRendererFavorite(Number(event.data.requestId) || 0, event.data.ok === true);
      return;
    }
  });

  setInterval(() => {
    const now = Date.now();
    if (rendererEnabled && !document.hidden
        && now - rendererHeartbeatAt > RENDERER_HEARTBEAT_TIMEOUT) {
      rendererEnabled = false;
      for (const instance of instances.values()) {
        shutdownInstanceRenderer(instance, "heartbeat-timeout");
      }
      debugEvent("renderer-heartbeat-timeout", {
        age: now - rendererHeartbeatAt
      }, "warn");
    }
    if (location.href !== rendererLocationHref) {
      const previousHref = rendererLocationHref;
      rendererLocationHref = location.href;
      debugState.href = location.href;
      const nextRouteKey = rendererRouteKey(location.href);
      if (nextRouteKey !== rendererLocationRouteKey) {
        const previousRouteKey = rendererLocationRouteKey;
        rendererLocationRouteKey = nextRouteKey;
        for (const instance of instances.values()) {
          shutdownInstanceRenderer(instance, "route-change");
          instance.rendererSafeSync = false;
          instance.rendererCleanClearObserved = false;
          instance.rendererSafeAfter = now
            + Math.max(1000, numberOr(instance.config.duration, 15_000)) + 1000;
        }
        debugEvent("renderer-route-reset", {
          previousHref,
          href: location.href,
          previousRouteKey,
          routeKey: nextRouteKey
        });
      }
    }
    for (const [id, instance] of instances) {
      if (!instance.canvas.isConnected) {
        if (!instance.canvasEverConnected && now < instance.mountGraceUntil) {
          if (instance.pending.length && !instance.pushTimer) {
            instance.pushTimer = setTimeout(
              () => assignPendingTracks(instance),
              CANVAS_MOUNT_RETRY
            );
          }
          continue;
        }
        clearInstance(instance, "canvas-detached");
        instances.delete(id);
        debugEvent("instance-detached", { instanceId: id }, "warn");
        continue;
      }
    }
    recoverOrphans();
    scheduleDebugMarker();
  }, 500);

  document.addEventListener("fullscreenchange", () => {
    for (const instance of instances.values()) {
      if (document.fullscreenElement === instance.canvas) {
        shutdownInstanceRenderer(instance, "canvas-is-fullscreen-element");
        continue;
      }
      if (!instance.rendererLayer || !(instance.canvas instanceof HTMLCanvasElement)
          || !instance.canvas.isConnected) {
        continue;
      }
      try {
        instance.rendererGeometryKey = "";
        instance.rendererBorderRadius = null;
        ensureRendererLayer(instance, instance.canvas.getBoundingClientRect());
      } catch (error) {
        failInstanceRenderer(instance, "fullscreen-relayout-error", error);
      }
    }
  });
  document.addEventListener("pointermove", releaseRendererTracksCoveredByRepeatReminder, true);

  debugEvent("installed", {
    href: location.href,
    readyState: document.readyState,
    workerAvailable: typeof globalThis.Worker === "function",
    messagePortAvailable: typeof globalThis.MessagePort === "function"
  }, "info");
  if (!document.documentElement) {
    document.addEventListener("readystatechange", scheduleDebugMarker, { once: true });
  }
  postReady(0);
})();

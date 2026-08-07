// @ts-nocheck -- Douyin DOM adapter; typed modules cover its stable boundaries.
import {
  DOUYIN_CONTENT_SOURCE,
  DOUYIN_PAGE_SOURCE,
  isDouyinProtocolMessage,
} from '../platforms/douyin/protocol'
import {
  comparableText,
  normalizedAssetKeys,
  serializedEmojiAssets,
} from '../platforms/douyin/rich-data'
import {
  allAssetsMatch,
  assetsMatch,
  normalizeRichPayload as normalizeOwnMessagePayload,
  payloadSignature as ownMessagePayloadSignature,
} from '../platforms/douyin/own-message'
import { appendedMutationValue } from '../platforms/douyin/input-order'
import { createFavoritesRuntime } from '../features/favorites/launcher'
import { unicodeEmojiFallbackText } from '../platforms/live/emoji-fallback'
import { SenderCorrelationCache } from '../platforms/live/sender-correlation'
import { createDouyinOverlay } from '../components/live/douyin-overlay'
import { createDiagnosticsCollector } from '../core/diagnostics'
import {
  dispatchEditorEnter as pressEnter,
  editorSelectionOffsets,
  placeEditorCaretAt as placeCaretAt,
  placeEditorCaretAtEnd as placeCaretAtEnd,
  readEditorText as inputText,
} from '../platforms/live/editor-dom'
import { t } from '../core/i18n'

;(function initDanmakuEchoDouyin() {
  'use strict'

  const shared = globalThis.DanmakuEchoShared
  if (
    !shared ||
    shared.detectPlatform(location.hostname, location.pathname) !== 'douyin' ||
    globalThis.__danmakuEchoDouyinLoaded
  ) {
    return
  }
  globalThis.__danmakuEchoDouyinLoaded = true

  const MAX_LENGTH = 1000
  const CARD_LOCK_TIME = 2500
  const CARD_STICKY_TIME = 8000
  const CARD_HIDE_DELAY = 650
  const DEBUG_VERSION = 'douyin-content-v15-scoped-editor-selection'
  const RENDERER_HEARTBEAT_INTERVAL = 5000
  const TRUSTED_ACTION_WINDOW = 1500
  const OWN_CHAT_MESSAGE_TTL = 12_000
  const MANUAL_INPUT_SNAPSHOT_TTL = 4_000
  const MANUAL_INPUT_SNAPSHOT_LIMIT = 8
  const SENDER_CACHE_TTL = 10 * 60_000
  const SENDER_CACHE_LIMIT = 320
  const SENDER_HISTORY_LIMIT = 480
  const REPLY_RESOLVE_ATTEMPTS = 36
  const REPLY_RESOLVE_INTERVAL = 70
  const REPLY_READY_WINDOW = 2_000
  const DOM_DANMAKU_SELECTORS = [
    "[data-e2e='danmaku-item']",
    "[class*='webcast-danmaku___item']",
    "[class*='danmaku-item']",
    "[class*='danmakuItem']",
    "[class*='danmu-item']",
    "[class*='bullet-item']",
  ]
  const VIDEO_ROOT_SELECTORS = [
    "[data-e2e='live-player']",
    "[data-e2e='player-container']",
    "[class*='LivePlayer']",
    "[class*='live-player']",
    "[class*='player-container']",
    "[class*='PlayerContainer']",
    "[class*='video-container']",
  ]
  const CHAT_ROOT_SELECTORS = [
    "[data-e2e='chat-message-list']",
    "[data-e2e='chat-room-message-list']",
    "[class*='webcast-chatroom___items']",
    "[class*='webcast-chatroom___list']",
    "[class*='webcast-chatroom']",
    "[class*='ChatMessageList']",
  ]
  const CHAT_MESSAGE_SELECTORS = [
    "[data-e2e='chat-message']",
    "[data-e2e='chat-room-message']",
    "[class*='webcast-chatroom___item']",
    "[class*='ChatMessage']",
    "[class*='chat-message']",
    "[class*='message-item']",
  ]
  const MESSAGE_TEXT_SELECTORS = [
    "[data-e2e='chat-message-text']",
    "[data-e2e='message-content']",
    "[class*='message-content']",
    "[class*='messageContent']",
    "[class*='content']",
  ]
  const USER_NAME_SELECTORS = [
    "[data-e2e='chat-message-user-name']",
    "[data-e2e='message-user-name']",
    "[data-e2e*='user-name']",
    "[data-e2e*='nickname']",
    "[data-e2e*='author-name']",
    "[data-e2e*='owner-name']",
    "[data-e2e*='sender-name']",
    "[data-testid*='user-name']",
    "[data-testid*='nickname']",
    "[data-testid*='author-name']",
    '[data-username]',
    '[data-user-name]',
    '[data-nickname]',
    '[data-author-name]',
    "[class*='nickname' i]",
    "[class~='name']",
    "[class*='user-name' i]",
    "[class*='userName' i]",
    "[class*='username' i]",
    "[class*='author-name' i]",
    "[class*='owner-name' i]",
    "a[href*='/user/' i]",
  ]
  const INPUT_SELECTORS = [
    "[data-e2e='chat-room-input']",
    "[data-e2e*='danmaku-input']",
    "textarea[data-e2e*='chat']",
    "textarea[placeholder*='弹幕']",
    "textarea[placeholder*='说点什么']",
    "[contenteditable='true'][data-placeholder*='弹幕']",
    "[contenteditable='true'][data-placeholder*='说点什么']",
    "[class*='webcast-chatroom___input'] [contenteditable='true']",
    "[class*='danmaku-input'] textarea",
    "[class*='danmaku-input'] input",
    "[class*='danmaku-input'] [contenteditable='true']",
    "[class*='LivePlayer'] textarea[placeholder*='弹幕']",
    "[class*='player-container'] textarea[placeholder*='弹幕']",
    "[class*='chat-input'] [contenteditable='true']",
    "[class*='ChatInput'] [contenteditable='true']",
  ]
  const TEXT_EDITOR_SELECTOR = [
    'textarea',
    'input:not([type])',
    "input[type='text']",
    "input[type='search']",
    "[contenteditable]:not([contenteditable='false'])",
    "[role='textbox']",
  ].join(',')
  const SEND_BUTTON_SELECTORS = [
    "[data-e2e='chat-room-send']",
    "[data-e2e*='send' i]",
    "[data-testid*='send' i]",
    "[aria-label*='发送']",
    "button[data-e2e*='send']",
    "[class*='webcast-chatroom___send']",
    "button[class*='send']",
    "[class*='send-button']",
    "[class*='sendButton']",
  ]
  const EMOJI_TOGGLE_SELECTORS = [
    "[data-e2e*='emoji' i]",
    "[data-testid*='emoji' i]",
    "[aria-label*='表情']",
    "[title*='表情']",
    "[class*='emoji-icon' i]",
    "[class*='emoji-btn' i]",
    "[class*='emojiBtn']",
    "[class*='emoticon-btn' i]",
    "[class*='emotion-btn' i]",
    "button[class*='emoji' i]",
    "button[class*='emoticon' i]",
    "button[class*='face' i]",
    "[role='button'][class*='emoji' i]",
    "[role='button'][class*='face' i]",
  ]
  const EMOJI_SURFACE_SELECTORS = [
    "[data-e2e*='emoji-panel' i]",
    "[data-testid*='emoji-panel' i]",
    "[class*='emoji-panel' i]",
    "[class*='emojiPanel']",
    "[class*='emoticon-panel' i]",
    "[class*='emotion-panel' i]",
    "[class*='emoji-list' i]",
  ]
  const EMOJI_ITEM_SELECTORS = [
    "img[class*='emoji' i]",
    '[data-emoji]',
    '[data-emoji-name]',
    '[data-emoticon]',
    "[class*='emoji-item' i]",
    "[class*='emojiItem']",
    "[class*='emoticon-item' i]",
  ]

  const state = {
    settings: shared.mergeSettings(),
    ui: null,
    portal: null,
    card: null,
    preview: null,
    actionBar: null,
    button: null,
    replyButton: null,
    favoriteButton: null,
    toast: null,
    candidate: null,
    hideTimer: 0,
    expiryTimer: 0,
    cardHovered: false,
    selectionId: 0,
    selectionPhase: 'idle',
    selectedAt: 0,
    lockedUntil: 0,
    pointerX: 0,
    pointerY: 0,
    nextRequestId: 1,
    pageReady: false,
    pageVersion: '',
    pageSnapshot: null,
    trustedAction: null,
    activationRequests: new Set(),
    lastActionAt: 0,
    nextOwnAnnouncementId: 1,
    ownChatIntents: [],
    confirmedOwnMessageIds: new Set(),
    pendingManualEmojiIntents: [],
    manualInputSnapshots: new Map(),
    ownChatScanTimer: 0,
    ownChatObserver: null,
    senderCache: new Map(),
    senderIdCache: new Map(),
    senderHistory: [],
    senderCorrelation: new SenderCorrelationCache(),
    senderRowSignatures: new WeakMap(),
    senderCacheTimer: 0,
    replyRequests: new Map(),
    lastUrl: location.href,
  }

  const debugState = {
    version: DEBUG_VERSION,
    loadedAt: new Date().toISOString(),
    loadedAtMs: Date.now(),
    href: location.href,
    pageReady: false,
    pageVersion: '',
    settingsEnabled: false,
    counters: {
      pings: 0,
      cardsShown: 0,
      cardsHidden: 0,
      cardPointerEnters: 0,
      rendererActivations: 0,
      rendererActivationsRejected: 0,
      sendsAttempted: 0,
      sendsSucceeded: 0,
      sendsFailed: 0,
      emojiAssetsInserted: 0,
      ownChatIntents: 0,
      ownChatMessagesMarked: 0,
    },
    lastCard: null,
    lastError: '',
    events: [],
  }
  globalThis.__danmakuEchoDouyinContentDebug = debugState
  let debugMarkerTimer = 0
  let heartbeatTimer = 0
  let routePollTimer = 0
  const diagnostics = createDiagnosticsCollector({
    platform: 'douyin',
    featureFlags: () => state.settings,
    cacheCounts: () => ({
      activationRequests: state.activationRequests.size,
      confirmedOwnMessageIds: state.confirmedOwnMessageIds.size,
      ownChatIntents: state.ownChatIntents.length,
      pendingManualEmojiIntents: state.pendingManualEmojiIntents.length,
      manualInputSnapshots: state.manualInputSnapshots.size,
      replyRequests: state.replyRequests.size,
      senderCache: state.senderCache.size,
      senderCorrelation: state.senderCorrelation.size,
      senderHistory: state.senderHistory.length,
      senderIdCache: state.senderIdCache.size,
    }),
    observerCounts: () => ({
      ownChat: state.ownChatObserver ? 1 : 0,
      timers: [state.hideTimer, state.expiryTimer, state.ownChatScanTimer, state.senderCacheTimer]
        .filter(Boolean).length,
    }),
    performance: () => ({
      cardsShown: debugState.counters.cardsShown,
      cardsHidden: debugState.counters.cardsHidden,
      sendsAttempted: debugState.counters.sendsAttempted,
      sendsFailed: debugState.counters.sendsFailed,
      sendsSucceeded: debugState.counters.sendsSucceeded,
    }),
    selectorHits: () => ({
      chatRoot: Boolean(document.querySelector(CHAT_ROOT_SELECTORS.join(','))),
      input: Boolean(findInput()),
      videoRoot: Boolean(document.querySelector(VIDEO_ROOT_SELECTORS.join(','))),
    }),
  })
  diagnostics.record({ type: 'runtime.initialized', stage: 'douyin-content' })

  function conciseDebugValue(value, depth) {
    if (depth > 3) {
      return '[depth-limit]'
    }
    if (value == null || typeof value === 'boolean' || typeof value === 'number') {
      return value
    }
    if (typeof value === 'string') {
      return value.slice(0, 240)
    }
    if (Array.isArray(value)) {
      return value.slice(0, 12).map((item) => conciseDebugValue(item, depth + 1))
    }
    if (typeof value === 'object') {
      const result = {}
      Object.keys(value)
        .slice(0, 20)
        .forEach((key) => {
          result[key] = conciseDebugValue(value[key], depth + 1)
        })
      return result
    }
    return String(value).slice(0, 120)
  }

  function contentDebugSnapshot() {
    return {
      version: debugState.version,
      loadedAt: debugState.loadedAt,
      loadedAtMs: debugState.loadedAtMs,
      href: location.href,
      pageReady: state.pageReady,
      pageVersion: state.pageVersion,
      settingsEnabled: enabled(),
      counters: Object.assign({}, debugState.counters),
      lastCard: debugState.lastCard,
      lastError: debugState.lastError,
      card: state.card
        ? {
            hidden: state.card.hidden,
            hovered: state.cardHovered,
            selectionId: state.selectionId,
            selectionPhase: state.selectionPhase,
            selectedAt: state.selectedAt,
            lockedUntil: state.lockedUntil,
            candidate: state.candidate
              ? {
                  trackId: state.candidate.trackId,
                  message: state.candidate.message,
                  kind: state.candidate.kind,
                  rect: state.candidate.rect,
                }
              : null,
          }
        : null,
      events: debugState.events.slice(-80),
      pageSnapshot: state.pageSnapshot,
    }
  }

  function syncDebugMarker() {
    debugMarkerTimer = 0
    const root = document.documentElement
    if (!root) {
      return
    }
    let marker = document.getElementById('bcp-douyin-content-debug')
    if (!marker) {
      marker = document.createElement('script')
      marker.id = 'bcp-douyin-content-debug'
      marker.type = 'application/json'
      marker.hidden = true
      root.appendChild(marker)
    }
    const snapshot = contentDebugSnapshot()
    marker.dataset.version = DEBUG_VERSION
    marker.dataset.pageReady = String(snapshot.pageReady)
    marker.dataset.cardVisible = String(Boolean(state.card && !state.card.hidden))
    marker.textContent = JSON.stringify(snapshot)
  }

  function scheduleDebugMarker() {
    if (!debugMarkerTimer) {
      debugMarkerTimer = setTimeout(syncDebugMarker, 80)
    }
  }

  function debugEvent(type, details, level) {
    const entry = {
      at: Date.now(),
      sinceLoad: Date.now() - debugState.loadedAtMs,
      type,
      details: conciseDebugValue(details || {}, 0),
    }
    debugState.events.push(entry)
    if (debugState.events.length > 240) {
      debugState.events.splice(0, debugState.events.length - 240)
    }
    if (level === 'error') {
      debugState.lastError = String((details && (details.message || details.error)) || type).slice(
        0,
        500,
      )
      console.error('[Danmaku Echo][Douyin content]', type, entry.details)
    } else if (level === 'info') {
      console.info('[Danmaku Echo][Douyin content]', type, entry.details)
    } else if (level === 'warn') {
      console.warn('[Danmaku Echo][Douyin content]', type, entry.details)
    } else {
      console.debug('[Danmaku Echo][Douyin content]', type, entry.details)
    }
    scheduleDebugMarker()
  }

  function storageGet() {
    return new Promise((resolve) => {
      if (!globalThis.chrome || !chrome.storage || !chrome.storage.sync) {
        resolve({})
        return
      }
      chrome.storage.sync.get(null, (value) => resolve(value || {}))
    })
  }

  function enabled() {
    return Boolean(
      state.settings.enabled &&
      state.settings.platforms.douyin &&
      Object.values(state.settings.actions).some(Boolean),
    )
  }

  function plusOneEnabled() {
    return Boolean(enabled() && state.settings.actions.plusOne)
  }

  function isVisible(element) {
    if (!(element instanceof Element) || !element.isConnected) {
      return false
    }
    const style = getComputedStyle(element)
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0 &&
      element.getClientRects().length > 0
    )
  }

  function queryAll(selectors, root) {
    const scope = root || document
    const results = []
    const seen = new Set()
    selectors.forEach((selector) => {
      let matches = []
      try {
        matches = scope.querySelectorAll(selector)
      } catch {
        matches = []
      }
      matches.forEach((element) => {
        if (!seen.has(element)) {
          seen.add(element)
          results.push(element)
        }
      })
    })
    return results
  }

  function matchesAny(element, selectors) {
    if (!(element instanceof Element)) {
      return false
    }
    return selectors.some((selector) => {
      try {
        return element.matches(selector)
      } catch {
        return false
      }
    })
  }

  function closestAny(element, selectors) {
    let current = element instanceof Element ? element : null
    while (current) {
      if (matchesAny(current, selectors)) {
        return current
      }
      current = current.parentElement
    }
    return null
  }

  function isOwned(node) {
    return node instanceof Element && Boolean(node.closest('[data-bcp-douyin-owned]'))
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null
  }

  function ensurePortal() {
    const host = fullscreenElement() || document.documentElement
    if (!state.ui) {
      state.ui = createDouyinOverlay({
        onCardEnter,
        onCardLeave,
        onCardMove,
        onFavorite: onFavoriteActionClick,
        onPlaceholder: onPlaceholderActionClick,
        onPlusOne: onPlusOneClick,
        onPointerDown(event) {
          event.stopPropagation()
          cancelHide()
        },
      })
      state.portal = state.ui.portal
    }
    return state.ui.ensureHost(host)
  }

  function cancelHide() {
    if (state.hideTimer) {
      clearTimeout(state.hideTimer)
      state.hideTimer = 0
    }
  }

  function clearExpiry() {
    if (state.expiryTimer) {
      clearTimeout(state.expiryTimer)
      state.expiryTimer = 0
    }
  }

  function armExpiry() {
    clearExpiry()
    const selectionId = state.selectionId
    state.expiryTimer = setTimeout(() => {
      state.expiryTimer = 0
      if (selectionId !== state.selectionId || !state.candidate) {
        return
      }
      if (state.cardHovered) {
        armExpiry()
        return
      }
      hideCard('sticky-timeout')
    }, CARD_STICKY_TIME)
  }

  function hideCard(reason) {
    cancelHide()
    clearExpiry()
    const previous = state.candidate
    state.candidate = null
    state.cardHovered = false
    state.selectionPhase = 'idle'
    state.selectedAt = 0
    state.lockedUntil = 0
    if (state.ui) state.ui.hideCard()
    if (previous) {
      debugState.counters.cardsHidden += 1
      debugEvent('card-hidden', {
        reason: reason || 'unspecified',
        trackId: previous.trackId,
        message: previous.message,
      })
    }
  }

  function scheduleHide(reason, delay) {
    if (state.hideTimer) {
      return
    }
    const selectionId = state.selectionId
    state.hideTimer = setTimeout(
      () => {
        state.hideTimer = 0
        if (selectionId !== state.selectionId || state.cardHovered) {
          return
        }
        hideCard(reason || 'scheduled-hide')
      },
      Number.isFinite(delay) ? delay : CARD_HIDE_DELAY,
    )
  }

  function onCardEnter() {
    state.cardHovered = true
    state.selectionPhase = 'engaged'
    state.ui.setSelectionPhase(state.selectionPhase)
    debugState.counters.cardPointerEnters += 1
    debugEvent(
      'card-pointer-enter',
      {
        trackId: state.candidate && state.candidate.trackId,
        message: state.candidate && state.candidate.message,
      },
      'info',
    )
    cancelHide()
    armExpiry()
  }

  function onCardMove() {
    state.cardHovered = true
    state.selectionPhase = 'engaged'
    state.ui.setSelectionPhase(state.selectionPhase)
    cancelHide()
  }

  function onCardLeave() {
    state.cardHovered = false
    state.selectionPhase = 'grace'
    state.ui.setSelectionPhase(state.selectionPhase)
    scheduleHide('card-pointerleave', CARD_HIDE_DELAY)
  }

  function onPlaceholderActionClick(event, action) {
    event.preventDefault()
    event.stopPropagation()
    cancelHide()
    if (action === 'reply') {
      prepareReply(state.candidate, 'card-reply')
    } else {
      armExpiry()
    }
  }

  function onFavoriteActionClick(event) {
    event.preventDefault()
    event.stopPropagation()
    cancelHide()
    if (!state.settings.actions.favorite || !state.candidate || !state.favoritesRuntime) {
      return
    }
    void state.favoritesRuntime.favoriteText(state.candidate.message, state.candidate.richPayload)
    armExpiry()
  }

  function renderActionBar() {
    if (state.ui) state.ui.setActions(state.settings.actions)
  }

  function showToast(message, kind) {
    ensurePortal()
    state.ui.showToast(message, kind || 'info')
  }

  function emojiTokenFromImage(image) {
    const marker = [
      typeof image.className === 'string' ? image.className : '',
      image.getAttribute('data-e2e'),
      image.getAttribute('data-testid'),
    ]
      .filter(Boolean)
      .join(' ')
    const raw = [
      image.getAttribute('alt'),
      image.getAttribute('data-text'),
      image.getAttribute('data-emoji'),
      image.getAttribute('data-emoji-name'),
      image.getAttribute('title'),
      image.getAttribute('aria-label'),
    ].find((value) => shared.normalizeWhitespace(value))
    const value = shared.normalizeWhitespace(raw)
    if (!value) {
      return ''
    }
    if (/^\[[^\]\n]{1,40}\]$/.test(value) || /\p{Extended_Pictographic}/u.test(value)) {
      return value
    }
    if (/(emoji|emote|sticker|表情)/i.test(marker) && Array.from(value).length <= 40) {
      return `[${value}]`
    }
    return ''
  }

  function assetDescriptorFromElement(element) {
    if (!(element instanceof Element)) {
      return null
    }
    const image = element instanceof HTMLImageElement ? element : element.querySelector('img')
    const metadataElements = []
    let metadataElement = element
    for (let depth = 0; metadataElement && depth < 4; depth += 1) {
      metadataElements.push(metadataElement)
      if (depth > 0 && metadataElement.matches(EMOJI_ITEM_SELECTORS.join(','))) break
      metadataElement = metadataElement.parentElement
    }
    const metadataAttributes = [
      'data-id',
      'data-key',
      'data-uri',
      'data-url',
      'data-src',
      'data-text',
      'data-emoji',
      'data-emoji-id',
      'data-emoji-name',
      'data-emoticon',
      'data-resource-id',
      'title',
      'aria-label',
    ]
    const metadataValues = metadataElements.flatMap((item) =>
      metadataAttributes.map((name) => item.getAttribute(name)).filter(Boolean),
    )
    const sources = [
      image && image.currentSrc,
      image && image.getAttribute('src'),
      image && image.getAttribute('data-src'),
      image && image.getAttribute('data-url'),
      element.getAttribute('data-src'),
      element.getAttribute('data-url'),
      ...metadataElements.flatMap((item) => [
        item.getAttribute('data-uri'),
        item.getAttribute('data-src'),
        item.getAttribute('data-url'),
      ]),
    ].filter(Boolean)
    const names = [
      image && emojiTokenFromImage(image),
      image && image.getAttribute('alt'),
      image && image.getAttribute('data-text'),
      image && image.getAttribute('data-emoji'),
      image && image.getAttribute('data-emoji-name'),
      image && image.getAttribute('data-emoticon'),
      image && image.getAttribute('data-id'),
      image && image.getAttribute('title'),
      image && image.getAttribute('aria-label'),
      element.getAttribute('data-text'),
      element.getAttribute('data-emoji'),
      element.getAttribute('data-emoji-name'),
      element.getAttribute('data-emoticon'),
      element.getAttribute('data-id'),
      element.getAttribute('title'),
      element.getAttribute('aria-label'),
      ...metadataValues,
    ].filter(Boolean)
    const keys = new Set()
    sources.concat(names).forEach((value) => {
      normalizedAssetKeys(value, location.href).forEach((key) => keys.add(key))
    })
    if (!keys.size) {
      return null
    }
    return {
      src: String(sources[0] || '').slice(0, 4096),
      token: shared.normalizeWhitespace(names[0] || '').slice(0, 120),
      keys: Array.from(keys).slice(0, 48),
    }
  }

  function messageContentElement(row) {
    if (!(row instanceof Element)) {
      return null
    }
    for (const selector of MESSAGE_TEXT_SELECTORS) {
      try {
        const element = row.matches(selector) ? row : row.querySelector(selector)
        if (element) {
          return element
        }
      } catch {
        // Ignore selector support differences.
      }
    }
    return row
  }

  function richTextFromElement(element) {
    if (!(element instanceof Element)) {
      return ''
    }
    const clone = element.cloneNode(true)
    clone.querySelectorAll('img').forEach((image) => {
      const token = emojiTokenFromImage(image)
      image.replaceWith(token ? document.createTextNode(token) : document.createTextNode(''))
    })
    ;[
      'button',
      'svg',
      "[aria-hidden='true']",
      '[data-bcp-douyin-owned]',
      ...USER_NAME_SELECTORS,
    ].forEach((selector) => {
      try {
        clone.querySelectorAll(selector).forEach((item) => item.remove())
      } catch {
        // Ignore selector support differences.
      }
    })
    return shared.parseMessageText(clone.textContent, MAX_LENGTH)
  }

  function richPartsFromElement(element) {
    const parts = []
    const appendText = (value) => {
      const text = String(value || '')
      if (!text) {
        return
      }
      const previous = parts[parts.length - 1]
      if (previous && previous.type === 'text') {
        previous.text += text
      } else {
        parts.push({ type: 'text', text })
      }
    }
    const visit = (node) => {
      if (!node || parts.length >= 40) {
        return
      }
      if (node.nodeType === 3) {
        appendText(node.nodeValue)
        return
      }
      if (!(node instanceof Element)) {
        return
      }
      if (
        node.matches("button,svg,[aria-hidden='true'],[data-bcp-douyin-owned]") ||
        matchesAny(node, USER_NAME_SELECTORS)
      ) {
        return
      }
      if (node instanceof HTMLImageElement) {
        const asset = assetDescriptorFromElement(node)
        if (asset) {
          parts.push({ type: 'emoji', asset })
        }
        return
      }
      if (node.tagName === 'BR') {
        appendText('\n')
        return
      }
      Array.from(node.childNodes).forEach(visit)
    }
    Array.from(element.childNodes).forEach(visit)
    return parts
  }

  function richPayloadFromElement(element) {
    if (!(element instanceof Element)) {
      return { text: '', plainText: '', assets: [] }
    }
    const assets = Array.from(element.querySelectorAll('img'))
      .filter(
        (image) =>
          !closestAny(image, USER_NAME_SELECTORS) &&
          !closestAny(image, ["[class*='avatar' i]", "[class*='badge' i]", "[class*='medal' i]"]),
      )
      .map(assetDescriptorFromElement)
      .filter(Boolean)
      .slice(0, 8)
    const plainClone = element.cloneNode(true)
    plainClone
      .querySelectorAll("img,button,svg,[aria-hidden='true'],[data-bcp-douyin-owned]")
      .forEach((item) => item.remove())
    USER_NAME_SELECTORS.forEach((selector) => {
      try {
        plainClone.querySelectorAll(selector).forEach((item) => item.remove())
      } catch {
        // Ignore selector support differences.
      }
    })
    const plainText = shared.parseMessageText(plainClone.textContent, MAX_LENGTH)
    let text = richTextFromElement(element)
    if (!shared.isPlausibleMessage(text, MAX_LENGTH) && assets.length) {
      text =
        assets
          .map((asset) => asset.token)
          .filter(Boolean)
          .join(' ') || '表情'
    }
    return { text, plainText, assets, parts: richPartsFromElement(element) }
  }

  const DOUYIN_SENDER_VALUE_ATTRIBUTES = [
    'data-username',
    'data-user-name',
    'data-name',
    'data-display-name',
    'data-nickname',
    'data-author-name',
    'data-sender-name',
    'data-sender',
    'data-display-id',
    'data-user-id',
    'data-sender-id',
    'data-author-id',
    'data-uid',
  ]
  const DOUYIN_SENDER_RECORD_ATTRIBUTES = [
    'data-user',
    'data-user-info',
    'data-user-data',
    'data-author',
    'data-sender',
    'data-profile',
  ]

  function senderFromRecordAttribute(element, attribute) {
    const raw = String(element.getAttribute(attribute) || '').trim()
    if (!raw) return ''
    const candidates = [raw]
    try {
      const decoded = decodeURIComponent(raw)
      if (decoded !== raw) candidates.push(decoded)
    } catch {
      // Ignore site-internal values that are not URI encoded strings.
    }
    for (const candidate of candidates) {
      try {
        const record = JSON.parse(candidate)
        const sender =
          shared.extractSenderFromRecord(record) ||
          shared.extractSenderFromRecord({ user: record })
        if (sender) return sender
      } catch {
        const sender = shared.normalizeSenderName(candidate)
        if (sender && !candidate.startsWith('{') && !candidate.startsWith('[')) return sender
      }
    }
    return ''
  }

  function senderFromChatContext(element, allowPrefix) {
    if (!(element instanceof Element)) return ''
    for (const selector of USER_NAME_SELECTORS) {
      let nameElement = null
      try {
        nameElement = element.matches(selector) ? element : element.querySelector(selector)
      } catch {
        nameElement = null
      }
      if (!nameElement) continue
      const values = [
        ...DOUYIN_SENDER_VALUE_ATTRIBUTES.map((attribute) => nameElement.getAttribute(attribute)),
        nameElement.textContent,
        nameElement.getAttribute('aria-label'),
        nameElement.getAttribute('title'),
      ]
      for (const value of values) {
        const sender = shared.normalizeSenderName(value)
        if (sender) return sender
      }
      for (const attribute of DOUYIN_SENDER_RECORD_ATTRIBUTES) {
        const sender = senderFromRecordAttribute(nameElement, attribute)
        if (sender) return sender
      }
      if (nameElement instanceof HTMLAnchorElement) {
        try {
          const parts = new URL(nameElement.href, location.href).pathname.split('/').filter(Boolean)
          const userIndex = parts.indexOf('user')
          const sender = shared.normalizeSenderName(
            userIndex >= 0 ? decodeURIComponent(parts[userIndex + 1] || '') : '',
          )
          if (sender) return sender
        } catch {
          // User links can contain site-internal, non-URL identifiers.
        }
      }
    }
    for (const attribute of DOUYIN_SENDER_VALUE_ATTRIBUTES) {
      const sender = shared.normalizeSenderName(element.getAttribute(attribute))
      if (sender) return sender
    }
    for (const attribute of DOUYIN_SENDER_RECORD_ATTRIBUTES) {
      const sender = senderFromRecordAttribute(element, attribute)
      if (sender) return sender
    }
    if (!allowPrefix) return ''
    const rowText = shared.normalizeWhitespace(element.innerText || element.textContent)
    const prefix = rowText.match(/^([^：:\n]{1,64})[：:]\s*/u)
    return shared.normalizeSenderName(prefix && prefix[1])
  }

  function senderFromChatRow(row) {
    if (!(row instanceof Element)) return ''
    let current = row
    for (let depth = 0; current && depth < 5; depth += 1) {
      // Douyin chat rows carry the same "webcast-chatroom" classes as the
      // chat root. The sender must be read from the element BEFORE stopping
      // the upward walk, or every real row short-circuits here with an empty
      // sender and replies always fail with "未能识别到这条弹幕的发送者".
      const sender = senderFromChatContext(current, depth === 0)
      if (sender) return sender
      if (matchesAny(current, CHAT_ROOT_SELECTORS)) break
      current = current.parentElement
    }
    return ''
  }

  function richPayloadFromChatRow(row) {
    return {
      // Chat rows and canvas barrages share the same pure normalization, so
      // sender correlation and text matching stay consistent for messages
      // that legitimately contain colons (e.g. scores like "13:0了").
      ...richPayloadFromElement(messageContentElement(row)),
      sender: senderFromChatRow(row),
    }
  }

  function replyMessageKeys(message) {
    const keys = new Set()
    const add = (value) => {
      const key = comparableText(value)
      if (key) keys.add(key)
    }
    add(message)
    add(shared.parseMessageText(message, MAX_LENGTH))
    return Array.from(keys)
  }

  function messageIdsFromRow(row) {
    if (!(row instanceof Element)) return []
    const ids = new Set()
    const elements = [row, messageContentElement(row)].filter(Boolean)
    const attributes = ['data-message-id', 'data-msg-id', 'data-item-id', 'data-log-id', 'data-id']
    for (const element of elements) {
      for (const attribute of attributes) {
        const value = String(element.getAttribute(attribute) || '').trim()
        if (value && value.length <= 160) ids.add(value)
      }
    }
    return Array.from(ids)
  }

  function rememberMessageSender(message, sender, at, ids, row) {
    const keys = replyMessageKeys(message)
    const normalizedSender = shared.normalizeSenderName(sender)
    const messageIds = (Array.isArray(ids) ? ids : [ids])
      .map((value) => String(value || '').trim())
      .filter((value) => value && value.length <= 160)
    if ((!keys.length && !messageIds.length) || !normalizedSender) {
      return
    }
    const observedAt = Number(at) || Date.now()
    state.senderCorrelation.remember(
      [message, shared.parseMessageText(message, MAX_LENGTH)],
      normalizedSender,
      { ids: messageIds, observedAt },
    )
    const signature = `${keys.join('|')}::${messageIds.join('|')}::${normalizedSender}`
    if (row instanceof Element && state.senderRowSignatures.get(row) === signature) {
      return
    }
    if (row instanceof Element) state.senderRowSignatures.set(row, signature)

    // Refresh insertion order so pruning removes the least recently observed
    // messages first, including rows recycled by Douyin's virtual chat list.
    for (const key of keys) {
      state.senderCache.delete(key)
      state.senderCache.set(key, { sender: normalizedSender, at: observedAt })
    }
    for (const id of messageIds) {
      state.senderIdCache.delete(id)
      state.senderIdCache.set(id, { sender: normalizedSender, at: observedAt })
    }
    state.senderHistory.push({
      keys,
      ids: messageIds,
      sender: normalizedSender,
      at: observedAt,
    })
    if (state.senderHistory.length > SENDER_HISTORY_LIMIT) {
      state.senderHistory.splice(0, state.senderHistory.length - SENDER_HISTORY_LIMIT)
    }
    while (state.senderCache.size > SENDER_CACHE_LIMIT) {
      state.senderCache.delete(state.senderCache.keys().next().value)
    }
    while (state.senderIdCache.size > SENDER_CACHE_LIMIT) {
      state.senderIdCache.delete(state.senderIdCache.keys().next().value)
    }
  }

  function pruneSenderCache(now) {
    for (const cache of [state.senderCache, state.senderIdCache]) {
      for (const [key, entry] of cache) {
        if (!entry || now - entry.at > SENDER_CACHE_TTL) {
          cache.delete(key)
        }
      }
    }
    state.senderHistory = state.senderHistory
      .filter((entry) => entry && now - entry.at <= SENDER_CACHE_TTL)
      .slice(-SENDER_HISTORY_LIMIT)
  }

  function scanSenderCache() {
    if (state.senderCacheTimer) {
      clearTimeout(state.senderCacheTimer)
    }
    state.senderCacheTimer = 0
    const now = Date.now()
    pruneSenderCache(now)
    const rows = queryAll(CHAT_MESSAGE_SELECTORS).slice(-160)
    for (const row of rows) {
      if (isOwned(row) || row.dataset.bcpDouyinOwnChat === 'true') {
        continue
      }
      const payload = richPayloadFromChatRow(row)
      const ids = messageIdsFromRow(row)
      rememberMessageSender(payload.plainText || payload.text, payload.sender, now, ids, row)
      if (payload.text && payload.text !== payload.plainText) {
        rememberMessageSender(payload.text, payload.sender, now, ids)
      }
    }
  }

  function scheduleSenderCacheScan(delay) {
    if (state.senderCacheTimer) {
      return
    }
    state.senderCacheTimer = setTimeout(scanSenderCache, Number(delay) || 0)
  }

  function senderForMessage(message, hints) {
    const expectedKeys = replyMessageKeys(message)
    const expectedIds = [hints && hints.messageId]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
    if (!expectedKeys.length && !expectedIds.length) return ''
    scanSenderCache()

    for (const id of expectedIds) {
      const cachedById = state.senderIdCache.get(id)
      if (cachedById && Date.now() - cachedById.at <= SENDER_CACHE_TTL) {
        return cachedById.sender
      }
    }
    const rows = queryAll(CHAT_MESSAGE_SELECTORS).slice(-120).reverse()
    for (const row of rows) {
      if (isOwned(row) || row.dataset.bcpDouyinOwnChat === 'true') {
        continue
      }
      const payload = richPayloadFromChatRow(row)
      const rowKeys = replyMessageKeys(payload.plainText || payload.text)
      const rowIds = messageIdsFromRow(row)
      const idMatches = expectedIds.some((id) => rowIds.includes(id))
      const textMatches = expectedKeys.some((key) => rowKeys.includes(key))
      if ((idMatches || textMatches) && payload.sender) {
        rememberMessageSender(message, payload.sender, Date.now(), rowIds, row)
        return payload.sender
      }
    }

    for (const key of expectedKeys) {
      const cached = state.senderCache.get(key)
      if (cached && Date.now() - cached.at <= SENDER_CACHE_TTL) {
        return cached.sender
      }
      if (cached) state.senderCache.delete(key)
    }

    const observedAt = Number(hints && hints.observedAt) || 0
    const correlated = state.senderCorrelation.resolve(
      [message, shared.parseMessageText(message, MAX_LENGTH)],
      { ids: expectedIds, observedAt },
    )
    if (correlated) return correlated
    let best = null
    let bestScore = -Infinity
    for (let index = state.senderHistory.length - 1; index >= 0; index -= 1) {
      const entry = state.senderHistory[index]
      let score = -Infinity
      if (expectedIds.some((id) => entry.ids.includes(id))) {
        score = 1400
      } else if (expectedKeys.some((key) => entry.keys.includes(key))) {
        score = 1000
      } else {
        for (const expected of expectedKeys) {
          for (const actual of entry.keys) {
            if (
              Math.min(expected.length, actual.length) >= 4 &&
              (expected.includes(actual) || actual.includes(expected))
            ) {
              score = Math.max(
                score,
                650 +
                  (Math.min(expected.length, actual.length) /
                    Math.max(expected.length, actual.length)) *
                    200,
              )
            }
          }
        }
      }
      if (!Number.isFinite(score)) continue
      if (observedAt) {
        const distance = Math.abs(entry.at - observedAt)
        score += Math.max(-300, 300 - distance / 10)
      } else {
        score += Math.max(0, 120 - (Date.now() - entry.at) / 100)
      }
      if (score > bestScore) {
        bestScore = score
        best = entry
      }
    }
    return best && bestScore >= 620 ? best.sender : ''
  }

  function richPayloadFromRendererContent(canvasText, rendererContent) {
    const parts = []
    const appendText = (value) => {
      const text = String(value == null ? '' : value)
      if (!text) return
      const previous = parts[parts.length - 1]
      if (previous && previous.type === 'text') {
        previous.text += text
      } else {
        parts.push({ type: 'text', text })
      }
    }
    const visit = (raw) => {
      if (!raw || typeof raw !== 'object' || parts.length >= 40) return
      if (raw.type === 'text') {
        appendText(raw.text)
      } else if (raw.type === 'image') {
        const asset = serializedEmojiAssets([raw], location.href)[0]
        if (asset) parts.push({ type: 'emoji', asset })
      }
      if (Array.isArray(raw.content)) raw.content.forEach(visit)
    }
    ;(Array.isArray(rendererContent) ? rendererContent : []).forEach(visit)
    const assets = parts.filter((part) => part.type === 'emoji').map((part) => part.asset)
    const plainText = shared.parseMessageText(
      parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(''),
      MAX_LENGTH,
    )
    const text =
      shared.parseMessageText(canvasText, MAX_LENGTH) ||
      plainText ||
      (assets.length ? '\u8868\u60c5' : '')
    return { text, plainText, assets, parts }
  }

  function mergeEmojiAsset(primary, secondary) {
    if (!secondary) return primary
    return {
      src: primary.src || secondary.src || '',
      token: secondary.token || primary.token || '',
      keys: Array.from(
        new Set([
          ...(Array.isArray(primary.keys) ? primary.keys : []),
          ...(Array.isArray(secondary.keys) ? secondary.keys : []),
        ]),
      ).slice(0, 64),
    }
  }

  function mergeRendererPayloadWithChatRow(rendererPayload, chatPayload, canvasText) {
    if (!chatPayload || !Array.isArray(chatPayload.assets) || !chatPayload.assets.length) {
      return {
        ...rendererPayload,
        sender: (chatPayload && chatPayload.sender) || senderForMessage(canvasText),
      }
    }
    const unused = new Set(chatPayload.assets.map((_asset, index) => index))
    const mergedAssets = rendererPayload.assets.map((rendererAsset, index) => {
      let matchedIndex = chatPayload.assets.findIndex(
        (asset, assetIndex) => unused.has(assetIndex) && assetsMatch(rendererAsset, asset),
      )
      if (
        matchedIndex < 0 &&
        chatPayload.assets.length === rendererPayload.assets.length &&
        unused.has(index)
      ) {
        matchedIndex = index
      }
      if (matchedIndex < 0) return rendererAsset
      unused.delete(matchedIndex)
      return mergeEmojiAsset(rendererAsset, chatPayload.assets[matchedIndex])
    })
    let assetIndex = 0
    const parts = rendererPayload.parts.map((part) => {
      if (part.type !== 'emoji') return part
      const asset = mergedAssets[assetIndex++]
      return { type: 'emoji', asset }
    })
    return {
      ...rendererPayload,
      assets: mergedAssets,
      parts,
      sender: chatPayload.sender || senderForMessage(canvasText),
    }
  }

  function resolveRichPayload(canvasText, rendererContent) {
    const key = comparableText(canvasText)
    const rendererPayload = richPayloadFromRendererContent(canvasText, rendererContent)
    const rendererAssets = rendererPayload.assets
    const matches = []
    const assetMatches = []
    const rows = queryAll(CHAT_MESSAGE_SELECTORS).slice(-100).reverse()
    for (const row of rows) {
      if (isOwned(row)) {
        continue
      }
      const payload = richPayloadFromChatRow(row)
      if (rendererAssets.length && payload.assets.length) {
        const exactAssetCount = payload.assets.filter((asset) =>
          rendererAssets.some((rendererAsset) => assetsMatch(asset, rendererAsset)),
        ).length
        if (
          exactAssetCount ||
          (key &&
            comparableText(payload.plainText || payload.text) === key &&
            payload.assets.length === rendererAssets.length)
        ) {
          assetMatches.push({ payload, exactAssetCount })
        }
      }
      const rowKey = comparableText(payload.plainText || payload.text)
      if (shared.isPlausibleMessage(payload.text, MAX_LENGTH) && key && rowKey === key) {
        matches.push(payload)
      }
    }
    if (rendererAssets.length) {
      assetMatches.sort((left, right) => right.exactAssetCount - left.exactAssetCount)
      const matched = (assetMatches[0] && assetMatches[0].payload) || matches[0] || null
      return mergeRendererPayloadWithChatRow(rendererPayload, matched, canvasText)
    }
    if (matches.length) {
      return matches[0]
    }
    return {
      text: canvasText,
      plainText: canvasText,
      // Worker images can also be badges or decorative resources. Only a
      // matching side-chat message is strong enough evidence that an image is
      // an emoji the user can resend.
      assets: [],
      sender: senderForMessage(canvasText),
    }
  }

  async function resolveRichPayloadWithRetry(canvasText, rendererContent) {
    let payload = resolveRichPayload(canvasText, rendererContent)
    if (payload.assets.length || !serializedEmojiAssets(rendererContent, location.href).length) {
      return payload
    }
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      payload = resolveRichPayload(canvasText, rendererContent)
      if (payload.assets.length) {
        break
      }
    }
    return payload
  }

  function pointInside(rect, x, y, padding) {
    const extra = padding || 0
    return Boolean(
      rect &&
      x >= rect.left - extra &&
      x <= rect.left + rect.width + extra &&
      y >= rect.top - extra &&
      y <= rect.top + rect.height + extra,
    )
  }

  function positionCard(candidate) {
    const card = state.ui.card()
    if (!card) {
      return
    }
    state.card = card
    state.button = state.ui.plusOneButton()
    const measured = card.getBoundingClientRect()
    const width = Math.max(120, measured.width)
    const height = Math.max(36, measured.height)
    const anchor = candidate.rect
    const boundsRight = innerWidth - 8
    const boundsLeft = 8
    const pointerX = Number.isFinite(candidate.pointerX)
      ? candidate.pointerX
      : anchor.left + anchor.width / 2
    const pointerY = Number.isFinite(candidate.pointerY)
      ? candidate.pointerY
      : anchor.top + anchor.height / 2
    let side = 'right'
    let left = pointerX + 8
    if (left + width > boundsRight) {
      side = 'left'
      left = pointerX - width - 8
    }
    left = Math.max(boundsLeft, Math.min(left, boundsRight - width))
    const boundsBottom = innerHeight - 8
    const boundsTop = 8
    let top = pointerY - height / 2
    top = Math.max(boundsTop, Math.min(top, boundsBottom - height))
    state.ui.positionCard(left, top, side)
  }

  function showCard(candidate) {
    if (!enabled() || !candidate || !shared.isPlausibleMessage(candidate.message, MAX_LENGTH)) {
      return
    }
    cancelHide()
    clearExpiry()
    ensurePortal()
    renderActionBar()
    state.selectionId += 1
    state.candidate = candidate
    state.cardHovered = false
    state.selectionPhase = 'armed'
    state.selectedAt = Date.now()
    state.lockedUntil = performance.now() + CARD_LOCK_TIME
    state.ui.prepareCard(candidate, {
      trackId: String(candidate.trackId || 'dom'),
      kind: candidate.kind || 'unknown',
      message: candidate.message.slice(0, 240),
      selectionId: String(state.selectionId),
      selectionPhase: state.selectionPhase,
    })
    requestAnimationFrame(() => positionCard(candidate))
    armExpiry()
    debugState.counters.cardsShown += 1
    debugState.lastCard = {
      at: Date.now(),
      selectionId: state.selectionId,
      selectionPhase: state.selectionPhase,
      trackId: candidate.trackId,
      message: candidate.message,
      kind: candidate.kind,
      rect: candidate.rect,
      pointer: [candidate.pointerX, candidate.pointerY],
    }
    debugEvent('card-shown', debugState.lastCard, 'info')
  }

  function saneRect(rect) {
    return (
      rect &&
      [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
      rect.width >= 2 &&
      rect.width <= innerWidth * 2 &&
      rect.height >= 4 &&
      rect.height <= 300
    )
  }

  function domCandidateFromElement(element, kind) {
    if (!(element instanceof Element) || isOwned(element) || !isVisible(element)) {
      return null
    }
    const rect = element.getBoundingClientRect()
    if (!saneRect(rect)) {
      return null
    }
    const richPayload =
      kind === 'chat' ? richPayloadFromChatRow(element) : richPayloadFromElement(element)
    const message = richPayload.text
    if (!shared.isPlausibleMessage(message, MAX_LENGTH)) {
      return null
    }
    return {
      trackId: `dom-${Date.now()}`,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      message,
      sender: richPayload.sender || senderForMessage(message),
      richPayload,
      content: [],
      style: {},
      kind,
    }
  }

  function findDomCandidate(event) {
    const path = event.composedPath ? event.composedPath() : [event.target]
    const elements = path.filter((item) => item instanceof Element)
    for (const element of elements) {
      const danmaku = closestAny(element, DOM_DANMAKU_SELECTORS)
      if (danmaku && closestAny(danmaku, VIDEO_ROOT_SELECTORS)) {
        const candidate = domCandidateFromElement(danmaku, 'video-dom')
        if (candidate) {
          return candidate
        }
      }
    }
    return null
  }

  function isInsideChatColumn(path) {
    return path.some(
      (item) =>
        item instanceof Element &&
        Boolean(
          closestAny(item, CHAT_ROOT_SELECTORS) ||
          (closestAny(item, CHAT_MESSAGE_SELECTORS) && !closestAny(item, VIDEO_ROOT_SELECTORS)),
        ),
    )
  }

  function onPointerMove(event) {
    if (!enabled() || event.pointerType === 'touch') {
      return
    }
    state.pointerX = event.clientX
    state.pointerY = event.clientY
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
    if (isInsideChatColumn(path)) {
      if (state.candidate) {
        hideCard('entered-chat-column')
      }
      return
    }
    if (
      path.some(
        (item) =>
          item instanceof Element &&
          item.matches('.bcp-douyin-dom-layer, .bcp-douyin-dom-track, .bcp-douyin-dom-barrage'),
      )
    ) {
      return
    }
    if (isOwned(event.target)) {
      cancelHide()
      if (!state.expiryTimer) {
        armExpiry()
      }
      return
    }
    if (state.candidate && state.card && !state.card.hidden) {
      const cardRect = state.card.getBoundingClientRect()
      if (
        performance.now() < state.lockedUntil ||
        pointInside(cardRect, event.clientX, event.clientY, 12) ||
        pointInside(state.candidate.rect, event.clientX, event.clientY, 10)
      ) {
        cancelHide()
      } else {
        scheduleHide('left-chat-card', CARD_HIDE_DELAY)
      }
      return
    }
    const domCandidate = findDomCandidate(event)
    if (domCandidate) {
      domCandidate.pointerX = event.clientX
      domCandidate.pointerY = event.clientY
      showCard(domCandidate)
    }
  }

  function richPayloadFromInput(input) {
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      const text = shared.parseMessageText(input.value, MAX_LENGTH)
      return { text, plainText: text, assets: [] }
    }
    return richPayloadFromElement(input)
  }

  function inputSurfaceScore(element, index) {
    const fullscreen = fullscreenElement()
    const insideFullscreen = Boolean(
      fullscreen && (fullscreen === element || fullscreen.contains(element)),
    )
    const insideVideo = Boolean(closestAny(element, VIDEO_ROOT_SELECTORS))
    const insideChat = Boolean(closestAny(element, CHAT_ROOT_SELECTORS))
    let score = 1000 - index
    if (fullscreen) {
      if (insideFullscreen) score += 1400
      if (insideVideo) score += 800
      if (insideChat && !insideFullscreen) score -= 1200
    } else {
      if (insideChat) score += 700
      if (!insideVideo) score += 300
      if (insideVideo) score -= 900
    }
    return score
  }

  function findInput() {
    const candidates = queryAll(INPUT_SELECTORS)
    const seen = new Set(candidates)
    const addEditors = (root) => {
      if (!(root instanceof Element || root instanceof Document || root instanceof ShadowRoot)) {
        return
      }
      let editors = []
      try {
        editors = root.querySelectorAll(TEXT_EDITOR_SELECTOR)
      } catch {
        editors = []
      }
      for (const editor of editors) {
        if (!seen.has(editor)) {
          seen.add(editor)
          candidates.push(editor)
        }
      }
    }
    const fullscreen = fullscreenElement()
    if (fullscreen) {
      addEditors(fullscreen)
    } else {
      queryAll(CHAT_ROOT_SELECTORS).forEach(addEditors)
    }
    const usable = candidates.filter((element) => {
      const disabled =
        element.matches(':disabled') ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('contenteditable') === 'false'
      return !disabled && isVisible(element)
    })
    usable.sort(
      (left, right) =>
        inputSurfaceScore(right, candidates.indexOf(right)) -
        inputSurfaceScore(left, candidates.indexOf(left)),
    )
    return usable[0] || null
  }

  function setInputValue(input, value) {
    input.focus({ preventScroll: true })
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      const prototype =
        input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')
      if (setter && setter.set) {
        setter.set.call(input, value)
      } else {
        input.value = value
      }
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          data: value,
          inputType: 'insertText',
        }),
      )
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
      placeCaretAtEnd(input)
      return
    }
    if (
      input.isContentEditable ||
      (input.hasAttribute('contenteditable') && input.getAttribute('contenteditable') !== 'false')
    ) {
      input.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          composed: true,
          data: value,
          inputType: 'insertText',
        }),
      )
      let inserted = false
      try {
        const selection = getSelection()
        if (selection) {
          const range = document.createRange()
          range.selectNodeContents(input)
          selection.removeAllRanges()
          selection.addRange(range)
        }
        inserted = document.execCommand('insertText', false, value)
      } catch {
        inserted = false
      }
      if (!inserted) {
        input.textContent = value
      }
      placeCaretAtEnd(input)
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          data: value,
          inputType: 'insertText',
        }),
      )
    }
  }

  function focusReplyInput(input, expectedValue, caretOffset) {
    const focus = () => {
      const editor = input.isConnected ? input : findInput()
      if (!editor || inputText(editor) !== expectedValue) {
        return
      }
      editor.focus({ preventScroll: true })
      if (Number.isFinite(caretOffset)) {
        placeCaretAt(editor, caretOffset)
      } else {
        placeCaretAtEnd(editor)
      }
    }
    focus()
    requestAnimationFrame(focus)
    setTimeout(focus, 50)
  }

  function replyRequestKey(candidate) {
    const requestId = String((candidate && candidate.requestId) || '').trim()
    if (requestId) return `request:${requestId}`
    return [
      String((candidate && candidate.instanceId) || 'dom'),
      String((candidate && candidate.trackId) || 'unknown'),
      comparableText(candidate && candidate.message),
    ].join(':')
  }

  function mentionFromInput(input) {
    if (!input) return ''
    const match = String(inputText(input) || '').match(/^\s*@\s*([^\s：:,，]{1,64})(?:\s|$)/u)
    return shared.normalizeSenderName(match && match[1])
  }

  function markReplyReady(candidate, sender) {
    const root = document.documentElement
    if (root) {
      root.dataset.bcpDouyinReplyReadyAt = String(Date.now())
      root.dataset.bcpDouyinReplyReadyMessage = comparableText(
        candidate && candidate.message,
      ).slice(0, 240)
      root.dataset.bcpDouyinReplyReadySender = shared.normalizeSenderName(sender).slice(0, 64)
    }
    if (state.ui && typeof state.ui.dismissToast === 'function') {
      state.ui.dismissToast()
    }
  }

  function recentReplyReady(candidate) {
    const root = document.documentElement
    const readyAt = Number(root && root.dataset.bcpDouyinReplyReadyAt) || 0
    if (!readyAt || Date.now() - readyAt > REPLY_READY_WINDOW) return false
    const readyMessage = String(root.dataset.bcpDouyinReplyReadyMessage || '')
    const message = comparableText(candidate && candidate.message)
    return !readyMessage || !message || readyMessage === message
  }

  function finishPreparedReply(candidate, input, sender, reason, requestKey, alreadyFilled) {
    const normalizedSender = shared.normalizeSenderName(sender) || mentionFromInput(input)
    const currentValue = inputText(input)
    const offsets = editorSelectionOffsets(input)
    const mention = `@${normalizedSender}`
    const insertionStart = offsets ? offsets.start : currentValue.length
    const nextValue = alreadyFilled
      ? currentValue
      : shared.replyDraftValue(currentValue, normalizedSender, offsets && offsets.start, offsets && offsets.end)
    const caretOffset =
      !alreadyFilled && nextValue !== currentValue ? insertionStart + mention.length : null
    if (!alreadyFilled) {
      setInputValue(input, nextValue)
    }
    markReplyReady(candidate, normalizedSender)
    state.replyRequests.set(requestKey, { status: 'ready', at: Date.now() })
    hideCard(reason || 'reply-ready')
    focusReplyInput(input, nextValue, caretOffset)
    debugEvent(
      alreadyFilled ? 'reply-already-ready' : 'reply-ready',
      {
        message: candidate.message,
        sender: normalizedSender,
        requestKey,
      },
      'info',
    )
    return true
  }

  async function prepareReply(candidate, reason) {
    if (!state.settings.actions.reply || !candidate) {
      return false
    }
    const requestKey = replyRequestKey(candidate)
    const previous = state.replyRequests.get(requestKey)
    if (
      previous &&
      Date.now() - previous.at <= REPLY_READY_WINDOW &&
      (previous.status === 'pending' || previous.status === 'ready')
    ) {
      return previous.status === 'ready'
    }
    state.replyRequests.set(requestKey, { status: 'pending', at: Date.now() })
    if (state.replyRequests.size > 80) {
      const staleKeys = Array.from(state.replyRequests.keys()).slice(
        0,
        state.replyRequests.size - 80,
      )
      staleKeys.forEach((key) => state.replyRequests.delete(key))
    }

    let input = null
    let sender = ''
    for (let attempt = 0; attempt < REPLY_RESOLVE_ATTEMPTS; attempt += 1) {
      input = findInput()
      const existingMention = mentionFromInput(input)
      if (existingMention) {
        return finishPreparedReply(candidate, input, existingMention, reason, requestKey, true)
      }
      if (recentReplyReady(candidate)) {
        state.replyRequests.set(requestKey, { status: 'ready', at: Date.now() })
        return true
      }
      sender = shared.normalizeSenderName(
        candidate.sender ||
          (candidate.richPayload && candidate.richPayload.sender) ||
          senderForMessage(candidate.message, {
            messageId: candidate.messageId,
            observedAt: candidate.observedAt,
          }),
      )
      if (sender) break
      if (attempt + 1 < REPLY_RESOLVE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, REPLY_RESOLVE_INTERVAL))
      }
    }

    input = input && input.isConnected ? input : findInput()
    const finalMention = mentionFromInput(input)
    if (finalMention) {
      return finishPreparedReply(candidate, input, finalMention, reason, requestKey, true)
    }
    if (!sender) {
      // Give another content-script context or Douyin's native quick-reply
      // handler one final frame to publish its successful result. A success is
      // authoritative and must never be overwritten by a late error toast.
      await new Promise((resolve) => setTimeout(resolve, REPLY_RESOLVE_INTERVAL))
      input = findInput()
      const delayedMention = mentionFromInput(input)
      if (delayedMention) {
        return finishPreparedReply(candidate, input, delayedMention, reason, requestKey, true)
      }
      if (recentReplyReady(candidate)) {
        state.replyRequests.set(requestKey, { status: 'ready', at: Date.now() })
        return true
      }
      state.replyRequests.set(requestKey, { status: 'failed', at: Date.now() })
      showToast(t('toastSenderUnknown'), 'error')
      return false
    }
    if (!input) {
      state.replyRequests.set(requestKey, { status: 'failed', at: Date.now() })
      showToast(t('toastEditorNotFound', t('platformDouyin')), 'error')
      return false
    }
    return finishPreparedReply(candidate, input, sender, reason, requestKey, false)
  }

  function buttonScore(button, input, selectorIndex, scopeBonus) {
    if (
      !isVisible(button) ||
      button.matches(':disabled') ||
      button.getAttribute('aria-disabled') === 'true' ||
      typeof button.click !== 'function'
    ) {
      return -Infinity
    }
    const text = shared.normalizeWhitespace(
      button.innerText || button.textContent || button.getAttribute('aria-label'),
    )
    const marker = [
      button.getAttribute('data-e2e'),
      button.getAttribute('data-testid'),
      button.getAttribute('aria-label'),
      typeof button.className === 'string' ? button.className : '',
    ]
      .filter(Boolean)
      .join(' ')
    let score = 100 - selectorIndex + (scopeBonus || 0)
    if (/^(发送|发 送|send)$/i.test(text)) {
      score += 200
    } else if (/(发送|send)/i.test(text)) {
      score += 80
    }
    if (/(send|发送|danmu|danmaku|comment)/i.test(marker)) {
      score += 120
    }
    const inputRect = input.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    const distance =
      Math.abs(buttonRect.left - inputRect.right) + Math.abs(buttonRect.top - inputRect.top)
    return score - Math.min(distance / 10, 100)
  }

  function findSendButton(input) {
    const candidates = []
    const seen = new Set()
    const add = (button, index, bonus) => {
      if (!seen.has(button)) {
        seen.add(button)
        candidates.push({ button, index, bonus })
      }
    }
    let parent = input.parentElement
    for (let depth = 0; parent && depth < 6; depth += 1, parent = parent.parentElement) {
      queryAll(
        [
          'button',
          "[role='button']",
          "[data-e2e*='send' i]",
          "[aria-label*='发送']",
          "[class*='send' i]",
        ],
        parent,
      ).forEach((button) => add(button, SEND_BUTTON_SELECTORS.length + 1, 360 - depth * 50))
    }
    SEND_BUTTON_SELECTORS.forEach((selector, index) => {
      queryAll([selector]).forEach((button) => add(button, index, 0))
    })
    candidates.sort(
      (first, second) =>
        buttonScore(second.button, input, second.index, second.bonus) -
        buttonScore(first.button, input, first.index, first.bonus),
    )
    const best = candidates[0]
    return best && buttonScore(best.button, input, best.index, best.bonus) > -Infinity
      ? best.button
      : null
  }

  function assetMatchScore(element, asset) {
    const descriptor = assetDescriptorFromElement(element)
    if (!descriptor || !asset || !Array.isArray(asset.keys)) {
      return 0
    }
    const expected = new Set(asset.keys)
    let score = 0
    descriptor.keys.forEach((key) => {
      if (expected.has(key)) {
        score += key.startsWith('raw:') ? 8 : key.startsWith('path:') ? 6 : 4
      }
    })
    return score
  }

  function emojiItemCandidates() {
    const results = []
    const seen = new Set()
    const add = (element) => {
      const insideEmojiSurface =
        element instanceof Element && Boolean(closestAny(element, EMOJI_SURFACE_SELECTORS))
      if (
        !(element instanceof Element) ||
        seen.has(element) ||
        (!isVisible(element) && !insideEmojiSurface) ||
        closestAny(element, CHAT_MESSAGE_SELECTORS) ||
        isOwned(element)
      ) {
        return
      }
      seen.add(element)
      results.push(element)
    }
    queryAll(EMOJI_ITEM_SELECTORS).forEach(add)
    queryAll(EMOJI_SURFACE_SELECTORS).forEach((surface) => {
      if (closestAny(surface, CHAT_MESSAGE_SELECTORS)) {
        return
      }
      surface
        .querySelectorAll("img,[data-emoji],[data-emoticon],[role='button'],button")
        .forEach(add)
    })
    queryAll(['img'])
      .slice(0, 1000)
      .forEach((image) => {
        if (!closestAny(image, VIDEO_ROOT_SELECTORS)) {
          add(image)
        }
      })
    return results.slice(0, 500)
  }

  function findMatchingEmojiItem(asset) {
    let best = null
    let bestScore = 0
    emojiItemCandidates().forEach((element) => {
      const score = assetMatchScore(element, asset)
      if (score > bestScore) {
        best = element
        bestScore = score
      }
    })
    if (!best || bestScore < 4) {
      return null
    }
    return (
      best.closest(
        [
          'button',
          "[role='button']",
          '[data-emoji]',
          '[data-emoticon]',
          "[class*='emoji-item' i]",
          "[class*='emoticon-item' i]",
        ].join(','),
      ) || best
    )
  }

  function findEmojiToggle(input) {
    const inputRect = input.getBoundingClientRect()
    const candidates = queryAll(EMOJI_TOGGLE_SELECTORS).filter(
      (element) =>
        isVisible(element) && !closestAny(element, CHAT_MESSAGE_SELECTORS) && !isOwned(element),
    )
    candidates.sort((first, second) => {
      const score = (element) => {
        const marker = [
          typeof element.className === 'string' ? element.className : '',
          element.getAttribute('data-e2e'),
          element.getAttribute('data-testid'),
          element.getAttribute('aria-label'),
          element.getAttribute('title'),
        ]
          .filter(Boolean)
          .join(' ')
        const rect = element.getBoundingClientRect()
        const distance = Math.abs(rect.left - inputRect.right) + Math.abs(rect.top - inputRect.top)
        return (
          (/(emoji|emoticon|emotion|face|表情)/i.test(marker) ? 500 : 0) -
          Math.min(300, distance / 5)
        )
      }
      return score(second) - score(first)
    })
    return candidates[0] || null
  }

  async function waitForEmojiItem(asset, timeout) {
    const deadline = Date.now() + timeout
    let item = findMatchingEmojiItem(asset)
    while (!item && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      item = findMatchingEmojiItem(asset)
    }
    return item
  }

  function richInputFingerprint(input) {
    if (!input || !input.isConnected) {
      return ''
    }
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      return input.value
    }
    return `${input.textContent || ''}|${input.innerHTML || ''}`.slice(0, 4096)
  }

  function inputIsEmpty(input) {
    if (!input || !input.isConnected) {
      return true
    }
    if (shared.normalizeWhitespace(inputText(input))) {
      return false
    }
    return !(input instanceof Element) || !input.querySelector('img,[data-emoji],[data-emoticon]')
  }

  async function restoreRichInputCaret(input) {
    if (!input || !input.isConnected) {
      return false
    }
    input.focus({ preventScroll: true })
    placeCaretAtEnd(input)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    if (!input.isConnected) {
      return false
    }
    input.focus({ preventScroll: true })
    placeCaretAtEnd(input)
    return true
  }

  async function waitForRichInputStability(input, timeout) {
    const deadline = Date.now() + timeout
    let previous = richInputFingerprint(input)
    let stableSamples = 0
    while (Date.now() < deadline && stableSamples < 2) {
      await new Promise((resolve) => setTimeout(resolve, 30))
      const current = richInputFingerprint(input)
      if (current === previous) {
        stableSamples += 1
      } else {
        previous = current
        stableSamples = 0
      }
    }
  }

  async function insertEmojiAsset(input, asset) {
    await restoreRichInputCaret(input)
    let item = findMatchingEmojiItem(asset)
    if (!item) {
      const toggle = findEmojiToggle(input)
      if (toggle && typeof toggle.click === 'function') {
        debugEvent(
          'emoji-panel-open-request',
          {
            toggleClass: typeof toggle.className === 'string' ? toggle.className.slice(0, 160) : '',
            assetKeys: Array.isArray(asset && asset.keys) ? asset.keys.slice(0, 8) : [],
          },
          'info',
        )
        toggle.click()
        item = await waitForEmojiItem(asset, 800)
      }
    }
    if (!item || typeof item.click !== 'function') {
      const visibleSurfaces = queryAll(EMOJI_SURFACE_SELECTORS).filter(isVisible).length
      debugEvent(
        'emoji-asset-not-found',
        {
          src: String((asset && asset.src) || '').slice(0, 500),
          token: String((asset && asset.token) || '').slice(0, 120),
          assetKeys: Array.isArray(asset && asset.keys) ? asset.keys.slice(0, 12) : [],
          visibleSurfaces,
          candidateCount: emojiItemCandidates().length,
        },
        'error',
      )
      return { ok: false, reason: 'emoji-not-found' }
    }
    if (!(await restoreRichInputCaret(input))) {
      return { ok: false, reason: 'input-detached' }
    }
    const before = richInputFingerprint(input)
    item.click()
    const deadline = Date.now() + 600
    while (Date.now() < deadline && richInputFingerprint(input) === before) {
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    if (richInputFingerprint(input) === before) {
      return { ok: false, reason: 'emoji-not-inserted' }
    }
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      const orderedValue = appendedMutationValue(before, input.value)
      if (orderedValue && orderedValue !== input.value) {
        setInputValue(input, orderedValue)
        debugEvent(
          'emoji-input-order-repaired',
          {
            insertedLength: orderedValue.length - before.length,
          },
          'info',
        )
      }
    }
    await waitForRichInputStability(input, 180)
    await restoreRichInputCaret(input)
    debugState.counters.emojiAssetsInserted += 1
    return { ok: true, reason: 'inserted' }
  }

  function appendInputText(input, value) {
    const text = String(value || '')
    if (!text) {
      return
    }
    input.focus({ preventScroll: true })
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      const prototype =
        input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')
      const nextValue = `${input.value || ''}${text}`
      if (setter && setter.set) {
        setter.set.call(input, nextValue)
      } else {
        input.value = nextValue
      }
      if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(nextValue.length, nextValue.length)
      }
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          data: text,
          inputType: 'insertText',
        }),
      )
      return
    }
    const selection = getSelection()
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(input)
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    let inserted = false
    try {
      inserted = document.execCommand('insertText', false, text)
    } catch {
      inserted = false
    }
    if (!inserted) {
      input.appendChild(document.createTextNode(text))
    }
    input.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: text,
        inputType: 'insertText',
      }),
    )
  }

  async function prepareRichInput(input, payload) {
    const unicodeFallback = unicodeEmojiFallbackText(payload)
    if (unicodeFallback) {
      setInputValue(input, unicodeFallback)
      return { ok: true, reason: 'unicode-emoji-fallback' }
    }
    const parts = Array.isArray(payload.parts) ? payload.parts : []
    const orderedEmojiParts = parts.filter((part) => part.type === 'emoji')
    if (!orderedEmojiParts.length) {
      setInputValue(input, payload.text)
      return { ok: true, reason: 'text-only' }
    }
    setInputValue(input, '')
    for (const part of parts) {
      if (part.type === 'text') {
        appendInputText(input, part.text)
        await waitForRichInputStability(input, 180)
        if (!(await restoreRichInputCaret(input))) {
          return { ok: false, reason: 'input-detached' }
        }
      } else if (part.type === 'emoji') {
        const inserted = await insertEmojiAsset(input, part.asset)
        if (!inserted.ok) {
          return inserted
        }
      }
    }
    return { ok: true, reason: 'rich-input-ready' }
  }

  function inputContains(input, message) {
    return Boolean(
      input &&
      input.isConnected &&
      shared.normalizeWhitespace(inputText(input)) === shared.normalizeWhitespace(message),
    )
  }

  function normalizeRichPayload(value) {
    return normalizeOwnMessagePayload(
      value,
      (text) => shared.parseMessageText(text, MAX_LENGTH),
      MAX_LENGTH,
    )
  }

  function payloadSignature(payload) {
    return ownMessagePayloadSignature(normalizeRichPayload(payload), comparableText)
  }

  function payloadMatchesIntent(payload, intent) {
    const rowText = comparableText(payload.plainText || payload.text)
    const intentText = comparableText(intent.payload.plainText || intent.payload.text)
    const rowRaw = shared.normalizeWhitespace(payload.text)
    const intentRaw = shared.normalizeWhitespace(intent.payload.text)
    const textMatches =
      rowText || intentText ? rowText === intentText : Boolean(rowRaw && rowRaw === intentRaw)
    if (intent.payload.assets.length) {
      const expectedPlainText = comparableText(intent.payload.plainText)
      const actualPlainText = comparableText(payload.plainText)
      return (
        allAssetsMatch(intent.payload.assets, payload.assets) &&
        (!expectedPlainText || expectedPlainText === actualPlainText)
      )
    }
    return textMatches && Boolean(intentText || intentRaw)
  }

  function clearStaleOwnChatMarks() {
    document.querySelectorAll("[data-bcp-douyin-own-chat='true']").forEach((row) => {
      const signature = payloadSignature(richPayloadFromChatRow(row))
      if (signature === row.dataset.bcpDouyinOwnChatSignature) {
        return
      }
      delete row.dataset.bcpDouyinOwnChat
      delete row.dataset.bcpDouyinOwnChatSignature
      row.querySelectorAll("[data-bcp-douyin-own-chat-content='true']").forEach((content) => {
        delete content.dataset.bcpDouyinOwnChatContent
      })
    })
  }

  function scanOwnChatMessages() {
    state.ownChatScanTimer = 0
    const now = Date.now()
    state.ownChatIntents = state.ownChatIntents.filter(
      (intent) => now - intent.at <= OWN_CHAT_MESSAGE_TTL,
    )
    clearStaleOwnChatMarks()
    if (!state.ownChatIntents.length) {
      return
    }
    const rows = queryAll(CHAT_MESSAGE_SELECTORS).slice(-120).reverse()
    for (let intentIndex = 0; intentIndex < state.ownChatIntents.length; intentIndex += 1) {
      const intent = state.ownChatIntents[intentIndex]
      const row = rows.find((candidate) => {
        if (isOwned(candidate) || candidate.dataset.bcpDouyinOwnChat === 'true') {
          return false
        }
        const payload = richPayloadFromChatRow(candidate)
        const signature = payloadSignature(payload)
        if (intent.baseline.get(candidate) === signature) {
          return false
        }
        return payloadMatchesIntent(payload, intent)
      })
      if (!row) {
        continue
      }
      const payload = richPayloadFromChatRow(row)
      const content = messageContentElement(row)
      row.dataset.bcpDouyinOwnChat = 'true'
      row.dataset.bcpDouyinOwnChatSignature = payloadSignature(payload)
      if (content) {
        content.dataset.bcpDouyinOwnChatContent = 'true'
      }
      state.ownChatIntents.splice(intentIndex, 1)
      forgetPendingManualEmojiIntent(intent.id)
      intentIndex -= 1
      debugState.counters.ownChatMessagesMarked += 1
      debugEvent(
        'own-chat-message-marked',
        {
          intentId: intent.id,
          text: payload.text,
          assetCount: payload.assets.length,
        },
        'info',
      )
    }
    if (state.ownChatIntents.length) {
      state.ownChatScanTimer = setTimeout(scanOwnChatMessages, 120)
    }
  }

  function scheduleOwnChatScan(delay) {
    if (state.ownChatScanTimer) {
      return
    }
    state.ownChatScanTimer = setTimeout(scanOwnChatMessages, Number(delay) || 0)
  }

  function queueOwnChatIntent(intentId, payload, sourceType) {
    const rows = queryAll(CHAT_MESSAGE_SELECTORS).slice(-120)
    state.ownChatIntents.push({
      id: intentId,
      payload,
      source: String(sourceType || 'unknown').slice(0, 40),
      at: Date.now(),
      baseline: new Map(rows.map((row) => [row, payloadSignature(richPayloadFromChatRow(row))])),
    })
    if (state.ownChatIntents.length > 24) {
      state.ownChatIntents.splice(0, state.ownChatIntents.length - 24)
    }
    debugState.counters.ownChatIntents += 1
    scheduleOwnChatScan(0)
  }

  function announceOwnMessage(message, sourceType) {
    const payload = normalizeRichPayload(message)
    const text = payload.text
    if (!shared.isPlausibleMessage(text, MAX_LENGTH)) {
      return ''
    }
    const intentId = `${Date.now()}-${state.nextOwnAnnouncementId}`
    state.nextOwnAnnouncementId += 1
    window.postMessage(
      {
        source: DOUYIN_CONTENT_SOURCE,
        type: 'own-message-intent',
        intentId,
        sourceType: String(sourceType || 'unknown').slice(0, 40),
        text: payload.plainText || text,
        plainText: payload.plainText,
        assets: payload.assets,
      },
      '*',
    )
    queueOwnChatIntent(intentId, payload, sourceType)
    debugEvent('own-message-announced', {
      text,
      sourceType: sourceType || 'unknown',
      assetCount: payload.assets.length,
    })
    return intentId
  }

  function cancelOwnMessageAnnouncement(intentId) {
    if (!intentId) {
      return
    }
    window.postMessage(
      {
        source: DOUYIN_CONTENT_SOURCE,
        type: 'own-message-cancel',
        intentId,
      },
      '*',
    )
    state.confirmedOwnMessageIds.delete(intentId)
    forgetPendingManualEmojiIntent(intentId)
    state.ownChatIntents = state.ownChatIntents.filter((intent) => intent.id !== intentId)
  }

  function forgetPendingManualEmojiIntent(intentId) {
    state.pendingManualEmojiIntents = state.pendingManualEmojiIntents.filter(
      (entry) => entry.intentId !== intentId,
    )
  }

  function recentManualEmojiIntents() {
    const cutoff = Date.now() - OWN_CHAT_MESSAGE_TTL
    state.pendingManualEmojiIntents = state.pendingManualEmojiIntents.filter(
      (entry) => entry.at >= cutoff,
    )
    return state.pendingManualEmojiIntents.slice()
  }

  function emojiAssetFromTrustedClick(event) {
    if (!event.isTrusted) return null
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
    const elements = path.filter((item) => item instanceof Element)
    const surface = elements.find((element) => matchesAny(element, EMOJI_SURFACE_SELECTORS))
    if (!surface) return null
    const item = elements.find(
      (element) =>
        element !== surface &&
        surface.contains(element) &&
        (element instanceof HTMLImageElement || matchesAny(element, EMOJI_ITEM_SELECTORS)),
    )
    return item ? assetDescriptorFromElement(item) : null
  }

  function rememberManualEmojiClick(event) {
    if (!enabled()) return
    const asset = emojiAssetFromTrustedClick(event)
    if (!asset) return
    const payload = {
      text: '表情',
      plainText: '',
      assets: [asset],
      parts: [{ type: 'emoji', asset }],
    }
    const intentId = announceOwnMessage(payload, 'manual-emoji')
    if (!intentId) return
    state.pendingManualEmojiIntents.push({ intentId, payload, at: Date.now() })
    if (state.pendingManualEmojiIntents.length > 12) {
      state.pendingManualEmojiIntents.splice(0, state.pendingManualEmojiIntents.length - 12)
    }
    debugEvent(
      'manual-emoji-intent',
      {
        intentId,
        assetKeys: asset.keys.slice(0, 4),
      },
      'info',
    )
  }

  const EDITABLE_ELEMENT_SELECTOR = [
    'textarea',
    'input:not([type="hidden"])',
    "[contenteditable='true']",
    "[contenteditable='plaintext-only']",
    "[role='textbox']",
  ].join(',')

  function editableElementFrom(node) {
    if (!(node instanceof Element)) {
      return null
    }
    if (node.matches(EDITABLE_ELEMENT_SELECTOR)) {
      return node
    }
    return node.closest(EDITABLE_ELEMENT_SELECTOR)
  }

  function rememberManualInputValue(input) {
    // Input events on nested contenteditable editors can target an inner
    // element while findInput() returns the outer editor. Normalize the
    // snapshot key to the editable ancestor so the fallback always matches.
    const editor = editableElementFrom(input)
    if (!editor || !editor.isConnected) {
      return
    }
    const text = shared.parseMessageText(richPayloadFromInput(editor).text || '', MAX_LENGTH)
    if (!text) {
      return
    }
    const now = Date.now()
    state.manualInputSnapshots.forEach((snapshot, element) => {
      if (now - snapshot.at > MANUAL_INPUT_SNAPSHOT_TTL || !element.isConnected) {
        state.manualInputSnapshots.delete(element)
      }
    })
    state.manualInputSnapshots.set(editor, { text, at: now })
    if (state.manualInputSnapshots.size > MANUAL_INPUT_SNAPSHOT_LIMIT) {
      let oldest = null
      for (const [element, snapshot] of state.manualInputSnapshots) {
        if (!oldest || snapshot.at < oldest.at) {
          oldest = { element, at: snapshot.at }
        }
      }
      if (oldest) {
        state.manualInputSnapshots.delete(oldest.element)
      }
    }
  }

  function snapshotManualInputText(input) {
    const snapshot = state.manualInputSnapshots.get(input)
    if (snapshot && Date.now() - snapshot.at <= MANUAL_INPUT_SNAPSHOT_TTL) {
      return snapshot.text
    }
    return ''
  }

  function announceManualInput(input, sourceType) {
    const editor = editableElementFrom(input) || input
    let base = normalizeRichPayload(richPayloadFromInput(editor))
    if (!base.text && !base.assets.length) {
      const snapshotText = snapshotManualInputText(editor)
      if (snapshotText) {
        base = normalizeRichPayload({ text: snapshotText, plainText: snapshotText })
      }
    }
    const pending = recentManualEmojiIntents()
    if (!pending.length) {
      const intentId = announceOwnMessage(base, sourceType)
      debugEvent(
        'manual-send-detected',
        {
          sourceType,
          intentId,
          text: base.text,
          assetCount: base.assets.length,
        },
        'info',
      )
      return intentId
    }
    const assets = base.assets.slice()
    const parts = base.parts.slice()
    pending.forEach((entry) => {
      entry.payload.assets.forEach((asset) => {
        if (!assets.some((existing) => assetsMatch(existing, asset))) {
          assets.push(asset)
          parts.push({ type: 'emoji', asset })
        }
      })
      cancelOwnMessageAnnouncement(entry.intentId)
    })
    state.pendingManualEmojiIntents = []
    const intentId = announceOwnMessage(
      {
        text: base.text || (assets.length ? '表情' : ''),
        plainText: base.plainText,
        assets,
        parts,
      },
      sourceType,
    )
    debugEvent(
      'manual-send-detected',
      {
        sourceType,
        intentId,
        text: base.text,
        assetCount: assets.length,
      },
      'info',
    )
    return intentId
  }

  async function waitForOwnMessageConfirmation(intentId, timeout) {
    if (!intentId) return false
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (
        state.confirmedOwnMessageIds.has(intentId) ||
        !state.ownChatIntents.some((intent) => intent.id === intentId)
      ) {
        state.confirmedOwnMessageIds.delete(intentId)
        return true
      }
      scheduleOwnChatScan(0)
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    return false
  }

  async function waitForConsumption(input, message, timeout) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (!inputContains(input, message)) {
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return !inputContains(input, message)
  }

  async function waitForInputClear(input, timeout) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (inputIsEmpty(input)) {
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return inputIsEmpty(input)
  }

  async function repeatMessage(message, richValue) {
    const now = Date.now()
    if (now - state.lastActionAt < 700) {
      showToast(t('toastActionTooFast'), 'warning')
      return false
    }
    state.lastActionAt = now
    debugState.counters.sendsAttempted += 1
    const richPayload = normalizeRichPayload(richValue || message)
    const emojiAssets = richPayload.assets
    const inputTextValue = emojiAssets.length ? richPayload.plainText : message
    debugEvent(
      'send-attempt',
      {
        message,
        plainText: inputTextValue,
        emojiCount: emojiAssets.length,
      },
      'info',
    )
    const input = findInput()
    if (!input) {
      debugState.counters.sendsFailed += 1
      debugEvent('send-failed', { message, reason: 'input-not-found' }, 'error')
      showToast(t('toastEditorNotFound', t('platformDouyin')), 'error')
      return false
    }
    const ownIntentId = announceOwnMessage(richPayload, 'plus-one')
    const prepared = await prepareRichInput(input, richPayload)
    await new Promise((resolve) => setTimeout(resolve, 80))
    if (!prepared.ok) {
      const directSent =
        prepared.reason === 'emoji-not-inserted' &&
        (await waitForOwnMessageConfirmation(ownIntentId, 3200))
      if (directSent) {
        debugState.counters.sendsSucceeded += 1
        debugEvent('send-succeeded', { message, mode: 'emoji-direct' }, 'info')
        showToast(t('toastRichPlusOneSent'), 'success')
        return true
      }
      cancelOwnMessageAnnouncement(ownIntentId)
      setInputValue(input, '')
      debugState.counters.sendsFailed += 1
      debugEvent('send-failed', { message, reason: prepared.reason }, 'error')
      showToast(t('toastDouyinEmojiInsertFailed'), 'error')
      return false
    }
    let button = findSendButton(input)
    if (button) {
      button.click()
    } else {
      pressEnter(input)
    }
    let consumed = emojiAssets.length
      ? await waitForInputClear(input, 420)
      : await waitForConsumption(input, message, 320)
    if (!consumed) {
      pressEnter(input)
      consumed = emojiAssets.length
        ? await waitForInputClear(input, 320)
        : await waitForConsumption(input, message, 260)
    }
    if (!consumed) {
      button = findSendButton(input)
      if (button) {
        button.click()
        consumed = emojiAssets.length
          ? await waitForInputClear(input, 420)
          : await waitForConsumption(input, message, 320)
      }
    }
    if (!consumed) {
      cancelOwnMessageAnnouncement(ownIntentId)
      debugState.counters.sendsFailed += 1
      debugEvent('send-failed', { message, reason: 'input-not-consumed' }, 'error')
      showToast(t('toastAutomaticSendFailed'), 'error')
      return false
    }
    try {
      input.blur()
    } catch {
      // The controlled editor may be replaced during the send cycle.
    }
    debugState.counters.sendsSucceeded += 1
    debugEvent('send-succeeded', { message, emojiCount: emojiAssets.length }, 'info')
    showToast(emojiAssets.length ? t('toastRichPlusOneSent') : t('toastPlusOneSent'), 'success')
    return true
  }

  async function onPlusOneClick(event) {
    event.preventDefault()
    event.stopPropagation()
    const clickedButton =
      event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : state.button
    if (!plusOneEnabled() || !state.candidate || (clickedButton && clickedButton.disabled)) {
      return
    }
    state.ui.setSending(true)
    const richPayload = await resolveRichPayloadWithRetry(
      state.candidate.message,
      state.candidate.content,
    )
    const success = await repeatMessage(richPayload.text, richPayload)
    if (success) {
      hideCard('send-succeeded')
    } else if (state.ui) {
      state.ui.setSending(false)
    }
  }

  function onAltClick(event) {
    if (
      !plusOneEnabled() ||
      !state.settings.altClick ||
      !event.altKey ||
      !event.isTrusted ||
      actionFromEvent(event)
    ) {
      return
    }
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
    const barrage = path.find(
      (item) => item instanceof Element && item.matches('.bcp-douyin-dom-barrage'),
    )
    const message = barrage
      ? shared.parseMessageText(barrage.dataset.message || '', MAX_LENGTH)
      : ''
    if (!shared.isPlausibleMessage(message, MAX_LENGTH)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const payload = resolveRichPayload(message, [])
    repeatMessage(payload.text, payload)
  }

  function postRendererSettings(reason, overrideEnabled) {
    const rendererEnabled = typeof overrideEnabled === 'boolean' ? overrideEnabled : enabled()
    window.postMessage(
      {
        source: DOUYIN_CONTENT_SOURCE,
        type: 'renderer-settings',
        enabled: rendererEnabled,
        actions: state.settings.actions,
        reason: String(reason || 'sync').slice(0, 80),
        version: DEBUG_VERSION,
        sentAt: Date.now(),
      },
      '*',
    )
    debugEvent('renderer-settings-sent', {
      enabled: rendererEnabled,
      reason: reason || 'sync',
    })
  }

  function postRendererResult(data, ok, reason) {
    window.postMessage(
      {
        source: DOUYIN_CONTENT_SOURCE,
        type: 'renderer-result',
        requestId: data.requestId,
        instanceId: String(data.instanceId || ''),
        trackId: String(data.trackId || ''),
        ok: Boolean(ok),
        reason: String(reason || (ok ? 'sent' : 'failed')).slice(0, 120),
      },
      '*',
    )
  }

  function actionFromEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
    return (
      path.find((item) => item instanceof Element && item.matches('.bcp-douyin-dom-action')) || null
    )
  }

  function actionItemFromEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
    return (
      path.find((item) => item instanceof Element && item.matches('.bcp-douyin-dom-action-item')) ||
      null
    )
  }

  function rememberTrustedRendererAction(event) {
    const action = actionFromEvent(event)
    const item = actionItemFromEvent(event)
    if (!action || !item || !event.isTrusted) {
      return
    }
    state.trustedAction = {
      action: String(item.dataset.action || ''),
      at: performance.now(),
      instanceId: String(action.dataset.instanceId || ''),
      trackId: String(action.dataset.trackId || ''),
      message: shared.parseMessageText(action.dataset.message || '', MAX_LENGTH),
    }
    debugEvent('renderer-action-trusted', {
      action: state.trustedAction.action,
      instanceId: state.trustedAction.instanceId,
      trackId: state.trustedAction.trackId,
      message: state.trustedAction.message,
    })
  }

  function matchesTrustedAction(data, message, action) {
    const trusted = state.trustedAction
    state.trustedAction = null
    return Boolean(
      trusted &&
      performance.now() - trusted.at <= TRUSTED_ACTION_WINDOW &&
      trusted.action === action &&
      trusted.instanceId === String(data.instanceId || '') &&
      trusted.trackId === String(data.trackId || '') &&
      trusted.message === message,
    )
  }

  async function handleRendererActivation(data) {
    const requestId = String(data.requestId == null ? '' : data.requestId)
    const message = shared.parseMessageText(data.text, MAX_LENGTH)
    if (
      !requestId ||
      state.activationRequests.has(requestId) ||
      !enabled() ||
      !shared.isPlausibleMessage(message, MAX_LENGTH)
    ) {
      debugState.counters.rendererActivationsRejected += 1
      debugEvent(
        'renderer-activation-rejected',
        {
          requestId,
          instanceId: data.instanceId,
          trackId: data.trackId,
          reason: 'invalid-or-duplicate',
        },
        'warn',
      )
      postRendererResult(data, false, 'invalid-or-duplicate')
      return
    }
    if (!matchesTrustedAction(data, message, 'plus-one')) {
      debugState.counters.rendererActivationsRejected += 1
      debugEvent(
        'renderer-activation-rejected',
        {
          requestId,
          instanceId: data.instanceId,
          trackId: data.trackId,
          reason: 'missing-trusted-click',
        },
        'warn',
      )
      postRendererResult(data, false, 'missing-trusted-click')
      return
    }

    state.activationRequests.add(requestId)
    debugState.counters.rendererActivations += 1
    const richPayload = await resolveRichPayloadWithRetry(message, data.content)
    const richMessage = richPayload.text
    debugEvent(
      'renderer-activation',
      {
        requestId,
        instanceId: data.instanceId,
        trackId: data.trackId,
        message: richMessage,
      },
      'info',
    )
    try {
      const success = await repeatMessage(richMessage, richPayload)
      postRendererResult(data, success, success ? 'sent' : 'send-failed')
    } catch (error) {
      debugEvent(
        'renderer-activation-error',
        {
          requestId,
          error: String((error && error.message) || error),
        },
        'error',
      )
      postRendererResult(data, false, 'send-error')
    } finally {
      setTimeout(() => state.activationRequests.delete(requestId), 10_000)
    }
  }

  function handleRendererReply(data) {
    const message = shared.parseMessageText(data.text, MAX_LENGTH)
    if (
      !enabled() ||
      !state.settings.actions.reply ||
      !shared.isPlausibleMessage(message, MAX_LENGTH)
    ) {
      debugEvent(
        'renderer-reply-rejected',
        {
          instanceId: data.instanceId,
          trackId: data.trackId,
          reason: 'invalid-or-disabled',
        },
        'warn',
      )
      return
    }
    if (!matchesTrustedAction(data, message, 'reply')) {
      debugEvent(
        'renderer-reply-rejected',
        {
          instanceId: data.instanceId,
          trackId: data.trackId,
          reason: 'missing-trusted-click',
        },
        'warn',
      )
      return
    }
    const richPayload = resolveRichPayload(message, data.content)
    const candidate = {
      requestId: String(data.requestId || ''),
      trackId: String(data.trackId || 'renderer'),
      instanceId: String(data.instanceId || ''),
      messageId: String(data.messageId || ''),
      observedAt: Number(data.observedAt) || 0,
      message: richPayload.text || message,
      sender:
        shared.normalizeSenderName(data.sender) ||
        richPayload.sender ||
        senderForMessage(message, {
          messageId: data.messageId,
          observedAt: data.observedAt,
        }),
      richPayload,
      content: Array.isArray(data.content) ? data.content : [],
      kind: 'renderer',
    }
    prepareReply(candidate, 'renderer-reply')
  }

  async function handleRendererFavorite(data) {
    const message = shared.parseMessageText(data.text, MAX_LENGTH)
    if (
      !enabled() ||
      !state.settings.actions.favorite ||
      !state.favoritesRuntime ||
      !shared.isPlausibleMessage(message, MAX_LENGTH) ||
      !matchesTrustedAction(data, message, 'favorite')
    ) {
      window.postMessage(
        {
          source: DOUYIN_CONTENT_SOURCE,
          type: 'renderer-favorite-result',
          requestId: data.requestId,
          ok: false,
        },
        '*',
      )
      return
    }
    const richPayload = await resolveRichPayloadWithRetry(message, data.content)
    const ok = await state.favoritesRuntime.favoriteText(richPayload.text, richPayload)
    if (ok === null) return
    window.postMessage(
      {
        source: DOUYIN_CONTENT_SOURCE,
        type: 'renderer-favorite-result',
        requestId: data.requestId,
        ok,
      },
      '*',
    )
  }

  function applySettings(saved) {
    state.settings = shared.mergeSettings(saved)
    shared.applyPlatformColors(document.documentElement, state.settings.colors.douyin)
    renderActionBar()
    debugState.settingsEnabled = enabled()
    debugEvent('settings-applied', {
      enabled: state.settings.enabled,
      douyin: state.settings.platforms.douyin,
      altClick: state.settings.altClick,
    })
    if (!enabled()) {
      hideCard('disabled-by-settings')
      state.ownChatIntents = []
      state.confirmedOwnMessageIds.clear()
      state.pendingManualEmojiIntents = []
      state.manualInputSnapshots.clear()
      document.querySelectorAll("[data-bcp-douyin-own-chat='true']").forEach((row) => {
        delete row.dataset.bcpDouyinOwnChat
        delete row.dataset.bcpDouyinOwnChatSignature
        row.querySelectorAll("[data-bcp-douyin-own-chat-content='true']").forEach((content) => {
          delete content.dataset.bcpDouyinOwnChatContent
        })
      })
    }
    postRendererSettings('settings-applied')
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !isDouyinProtocolMessage(event.data, DOUYIN_PAGE_SOURCE)) {
      return
    }
    if (event.data.type === 'renderer-activate') {
      handleRendererActivation(event.data)
      return
    }
    if (event.data.type === 'renderer-reply') {
      handleRendererReply(event.data)
      return
    }
    if (event.data.type === 'renderer-favorite') {
      void handleRendererFavorite(event.data)
      return
    }
    if (event.data.type === 'own-message-consumed') {
      const intentId = String(event.data.intentId || '').slice(0, 80)
      if (intentId) {
        state.confirmedOwnMessageIds.add(intentId)
        forgetPendingManualEmojiIntent(intentId)
        setTimeout(() => state.confirmedOwnMessageIds.delete(intentId), 10_000)
        debugEvent('own-message-confirmed', { intentId }, 'info')
      }
      return
    }
    if (event.data.type === 'ready') {
      state.pageReady = true
      state.pageVersion = String(event.data.version || 'legacy')
      debugState.pageReady = true
      debugState.pageVersion = state.pageVersion
      debugEvent(
        'page-ready',
        {
          version: state.pageVersion,
          instanceCount: Number(event.data.instanceCount) || 0,
          orphanCount: Number(event.data.orphanCount) || 0,
        },
        'info',
      )
      postRendererSettings('page-ready')
      return
    }
    if (event.data.type === 'debug-snapshot') {
      state.pageSnapshot = event.data.snapshot || null
      debugEvent(
        'page-debug-snapshot',
        {
          requestId: Number(event.data.requestId) || 0,
          instanceCount: state.pageSnapshot && state.pageSnapshot.instanceCount,
          orphanCount: state.pageSnapshot && state.pageSnapshot.orphanCount,
        },
        'info',
      )
      console.info('[Danmaku Echo][Douyin diagnostics]', contentDebugSnapshot())
      return
    }
  })

  storageGet().then(applySettings)
  state.favoritesRuntime = createFavoritesRuntime({
    enabled: () => enabled() && state.settings.actions.favorite,
    platform: 'douyin',
    sendFavorite: (payload) => repeatMessage(payload.text, payload),
    showToast,
  })
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (state.candidate && !isOwned(event.target) && performance.now() >= state.lockedUntil) {
        hideCard('outside-pointerdown')
      }
    },
    true,
  )
  document.addEventListener('click', rememberTrustedRendererAction, true)
  document.addEventListener('click', rememberManualEmojiClick, true)
  document.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted || !enabled()) {
        return
      }
      const input = findInput()
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
      const clickedSend = path.find(
        (item) =>
          item instanceof Element &&
          (matchesAny(item, SEND_BUTTON_SELECTORS) ||
            /^(发送|发 送|send)$/i.test(
              shared.normalizeWhitespace(item.innerText || item.textContent || ''),
            )),
      )
      let sharesInputContainer = false
      for (
        let scope = input && input.parentElement, depth = 0;
        scope && depth < 7;
        scope = scope.parentElement, depth += 1
      ) {
        if (clickedSend && scope.contains(clickedSend)) {
          sharesInputContainer = true
          break
        }
      }
      if (input && clickedSend && sharesInputContainer) {
        announceManualInput(input, 'manual-button')
      }
    },
    true,
  )
  document.addEventListener('click', onAltClick, true)
  document.addEventListener(
    'input',
    (event) => {
      if (!event.isTrusted || !enabled()) {
        return
      }
      rememberManualInputValue(event.target)
    },
    true,
  )
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        hideCard('escape')
      }
      if (event.isTrusted && event.key === 'Enter' && !event.shiftKey && enabled()) {
        const input = findInput()
        const ownsTarget = input && (event.target === input || input.contains(event.target))
        // A nested contenteditable editor can retarget keydown to an inner
        // element. When findInput() finds no editor at all, fall back to the
        // editable ancestor of the event target so manual sends inside shadow
        // roots or unusual wrappers are still announced.
        const targetEditor = editableElementFrom(event.target)
        const activeInput = ownsTarget ? input : input ? null : targetEditor
        if (activeInput) {
          announceManualInput(activeInput, 'manual-enter')
        }
      }
      if (event.ctrlKey && event.altKey && String(event.key).toLowerCase() === 'd') {
        event.preventDefault()
        const requestId = state.nextRequestId++
        debugEvent('diagnostics-requested', { requestId }, 'info')
        window.postMessage(
          {
            source: DOUYIN_CONTENT_SOURCE,
            type: 'debug-request',
            requestId,
          },
          '*',
        )
        showToast(t('toastDiagnosticsConsole'), 'info')
      }
    },
    true,
  )
  window.addEventListener('blur', () => scheduleHide('window-blur', 120))
  // Douyin auto-scrolls its virtual chat list whenever messages arrive. A captured
  // scroll listener would clear a valid DOM selection even while the pointer is
  // already over the card, so scrolling is deliberately not a dismissal signal.
  window.addEventListener('resize', () => hideCard('resize'), { passive: true })
  document.addEventListener(
    'fullscreenchange',
    () => {
      scheduleSenderCacheScan(0)
      hideCard('fullscreen-change')
      ensurePortal()
    },
    true,
  )
  document.addEventListener(
    'webkitfullscreenchange',
    () => {
      scheduleSenderCacheScan(0)
      hideCard('webkit-fullscreen-change')
      ensurePortal()
    },
    true,
  )
  function stopLifecycleTimers() {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (routePollTimer) clearInterval(routePollTimer)
    heartbeatTimer = 0
    routePollTimer = 0
  }

  function checkSpaRoute() {
    if (state.lastUrl === location.href) return
    state.lastUrl = location.href
    debugEvent('spa-url-changed', { href: location.href }, 'info')
    diagnostics.record({ type: 'route.changed', stage: 'fallback' })
    hideCard('spa-url-change')
    state.pageReady = false
    debugState.pageReady = false
    ping()
    postRendererSettings('spa-url-change')
  }

  function startLifecycleTimers() {
    if (document.hidden) return
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(
        () => postRendererSettings('heartbeat'),
        RENDERER_HEARTBEAT_INTERVAL,
      )
    }
    if (!routePollTimer) routePollTimer = setInterval(checkSpaRoute, 1_000)
  }

  function releaseTransientResources() {
    hideCard('document-hidden')
    stopLifecycleTimers()
    if (state.hideTimer) clearTimeout(state.hideTimer)
    if (state.expiryTimer) clearTimeout(state.expiryTimer)
    if (state.ownChatScanTimer) clearTimeout(state.ownChatScanTimer)
    if (state.senderCacheTimer) clearTimeout(state.senderCacheTimer)
    state.hideTimer = 0
    state.expiryTimer = 0
    state.ownChatScanTimer = 0
    state.senderCacheTimer = 0
    state.ownChatObserver?.disconnect()
    state.ownChatObserver = null
    state.activationRequests.clear()
    state.replyRequests.clear()
    state.senderCache.clear()
    state.senderIdCache.clear()
    state.senderHistory = []
    state.senderCorrelation.clear()
    state.ownChatIntents = []
    state.pendingManualEmojiIntents = []
    state.manualInputSnapshots.clear()
  }

  function onVisibilityChange() {
    if (document.hidden) {
      releaseTransientResources()
      return
    }
    startOwnChatObserver()
    startLifecycleTimers()
    checkSpaRoute()
    postRendererSettings('document-visible')
  }

  function onPageHide() {
    postRendererSettings('pagehide', false)
    releaseTransientResources()
  }

  function onDiagnosticsMessage(message, _sender, sendResponse) {
    if (!message || message.type !== 'danmaku-echo.diagnostics.snapshot') return false
    sendResponse({ ok: true, snapshot: diagnostics.snapshot() })
    return false
  }

  function onStorageChanged(_changes, areaName) {
    if (areaName === 'sync') storageGet().then(applySettings)
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onPageHide, { once: true })
  chrome.runtime.onMessage.addListener(onDiagnosticsMessage)

  function rememberRemovedChatSenders(nodes) {
    // Douyin's virtual chat list recycles rows: a row can be removed before
    // the scheduled sender scan ever sees it in the live DOM. Extract the
    // sender from removed rows immediately so replies still resolve after the
    // row is gone.
    for (const node of nodes) {
      if (!(node instanceof Element)) continue
      const rows = matchesAny(node, CHAT_MESSAGE_SELECTORS)
        ? [node]
        : Array.from(node.querySelectorAll(CHAT_MESSAGE_SELECTORS.join(',')))
      for (const row of rows) {
        if (isOwned(row) || row.dataset.bcpDouyinOwnChat === 'true') continue
        const payload = richPayloadFromChatRow(row)
        const ids = messageIdsFromRow(row)
        rememberMessageSender(
          payload.plainText || payload.text,
          payload.sender,
          Date.now(),
          ids,
          row,
        )
      }
    }
  }

  function startOwnChatObserver() {
    if (state.ownChatObserver || !document.documentElement) {
      return
    }
    state.ownChatObserver = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => {
        const target =
          mutation.target instanceof Element
            ? mutation.target
            : mutation.target && mutation.target.parentElement
        if (
          target &&
          (closestAny(target, CHAT_ROOT_SELECTORS) || closestAny(target, CHAT_MESSAGE_SELECTORS))
        ) {
          return true
        }
        return Array.from(mutation.addedNodes || []).some(
          (node) =>
            node instanceof Element &&
            (matchesAny(node, CHAT_ROOT_SELECTORS) ||
              matchesAny(node, CHAT_MESSAGE_SELECTORS) ||
              Boolean(node.querySelector(CHAT_MESSAGE_SELECTORS.join(',')))),
        )
      })
      const removedSenders = mutations.flatMap(
        (mutation) => Array.from(mutation.removedNodes || []),
      )
      if (removedSenders.length) {
        rememberRemovedChatSenders(removedSenders)
      }
      if (relevant) {
        scheduleSenderCacheScan(40)
        if (
          state.ownChatIntents.length ||
          document.querySelector("[data-bcp-douyin-own-chat='true']")
        ) {
          scheduleOwnChatScan(40)
        }
      }
    })
    state.ownChatObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    scheduleSenderCacheScan(0)
  }
  if (document.documentElement) {
    startOwnChatObserver()
  } else {
    document.addEventListener('DOMContentLoaded', startOwnChatObserver, { once: true })
  }

  if (globalThis.chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(onStorageChanged)
  }

  const ping = () => {
    const requestId = state.nextRequestId++
    debugState.counters.pings += 1
    debugEvent('page-ping', { requestId, href: location.href })
    window.postMessage(
      {
        source: DOUYIN_CONTENT_SOURCE,
        type: 'ping',
        requestId,
      },
      '*',
    )
  }
  ping()
  ;[1000, 3000, 7000].forEach((delay) =>
    setTimeout(() => {
      if (!state.pageReady) {
        ping()
      }
    }, delay),
  )
  startLifecycleTimers()
  debugEvent(
    'content-loaded',
    {
      href: location.href,
      readyState: document.readyState,
      version: DEBUG_VERSION,
    },
    'info',
  )
  syncDebugMarker()
})()

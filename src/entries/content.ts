// @ts-nocheck -- platform DOM adapter; typed modules cover its stable boundaries.
import { LIVE_PLATFORM_CONFIG, isSupportedContentPlatform } from '../platforms/live/config'
import {
  shouldHideNativeDanmakuCapsule,
  visibleActionsForSurface,
} from '../platforms/live/action-visibility'
import { unicodeEmojiFallbackText } from '../platforms/live/emoji-fallback'
import { SenderCorrelationCache } from '../platforms/live/sender-correlation'
import { uniqueHighestScoringItem } from '../platforms/live/native-emoji'
import {
  clampBoxStart,
  clipInsetsWithinRect,
  intersectRectBounds,
  pointInsideRect,
} from '../platforms/live/overlay-viewport'
import { overlayCapsulePlacement } from '../platforms/live/capsule-position'
import {
  DOUYU_NATIVE_DANMAKU_ACTION_MARKER,
  DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS,
  DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTORS,
  DOUYU_NATIVE_DANMAKU_CAPSULE_DECORATION_SELECTORS,
  DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS,
  DouyuNativeCapsuleVisibilityController,
  findDouyuNativeDanmakuCapsuleTargets,
} from '../platforms/douyu/native-capsule'
import { DouyuNativeHoverController } from '../platforms/douyu/native-hover'
import { DouyuNativeMotionFallback } from '../platforms/douyu/native-motion-fallback'
import { douyuOverlayTextElements } from '../platforms/douyu/message-content'
import {
  BILIBILI_CHAT_ACTION_SURFACES,
  BILIBILI_CHAT_ACTION_TEXT,
  BILIBILI_CHAT_AD_LABEL_SELECTORS,
  BILIBILI_CHAT_AD_SELECTORS,
  BILIBILI_CHAT_STRONG_ACTION_TEXT,
  BILIBILI_EMOJI_SURFACE_SELECTORS,
  BILIBILI_EMOJI_TOGGLE_SELECTORS,
  BILIBILI_QUICK_BAR_SELECTORS,
  BILIBILI_QUICK_INPUTS,
  isBilibiliAdvertisementLabel,
  isBilibiliAdvertisementMarker,
} from '../platforms/bilibili/dom-config'
import { BilibiliOverlayMotionController } from '../platforms/bilibili/overlay-motion'
import { bilibiliRepeatReminderExclusionReason } from '../platforms/bilibili/repeat-reminder-filter'
import { bilibiliAutoRecognizedEmojiText } from '../platforms/bilibili/rich-message-sender'
import {
  bilibiliNativeEmoticonDisplayToken,
  isBilibiliDecorativeImageDescription,
  isBilibiliEmoticonFallbackLabel,
} from '../platforms/bilibili/emoticon-metadata'
import {
  BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE,
  bilibiliRoomEmoticonIdentity,
} from '../platforms/bilibili/direct-emoticon-send'
import { createBilibiliEmoticonDebugAttempt } from '../platforms/bilibili/emoticon-debug'
import {
  BILIBILI_INSTALL_NATIVE_SEND_OBSERVER,
  isBilibiliNativeSendObservation,
} from '../platforms/bilibili/native-send-observer'
import { normalizedAssetKeys as normalizedRichAssetKeys } from '../platforms/douyin/rich-data'
import { createFavoritesRuntime } from '../features/favorites/launcher'
import { currentRoomContext } from '../features/favorites/room-context'
import { createRepeatReminderRuntime } from '../features/repeat-reminder/runtime'
import {
  eventTouchesRepeatReminder,
  pointTouchesRepeatReminder,
} from '../features/repeat-reminder/pointer-guard'
import { createContentOverlay } from '../components/live/content-overlay'
import { copyTextToClipboard } from '../core/clipboard'
import { createDiagnosticsCollector } from '../core/diagnostics'
import { createLivePlatformAdapter } from '../platforms/live/adapters'
import { liveRichMessageSender } from '../platforms/live/rich-message-sender'
import {
  classifyPlatformSendFeedback,
  classifyPlatformSendResponse,
  createPlatformFeedbackProbe,
  createSendProtection,
  formatPlatformSendFeedback,
  formatPlatformSendRequestSummary,
} from '../platforms/live/send-protection'
import {
  INSTALL_NATIVE_SEND_OBSERVER,
  isNativeSendObservation,
} from '../platforms/live/native-send-observer'
import {
  BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES,
  BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX,
  EDITABLE_CONTROL_SELECTOR,
  EMOJI_DISPLAY_ATTRIBUTES,
  EMOJI_METADATA_ATTRIBUTES,
  LEGACY_BILIBILI_EXCLUSIVE_ASSET_KEY_PREFIX,
  NATIVE_PANEL_ASSET_KEY_PREFIX,
  PLATFORM_EMOJI_CATEGORY_SELECTORS,
  PLATFORM_EMOJI_ITEM_SELECTORS,
  TEXT_EDITOR_SELECTOR,
} from '../platforms/live/editor-config'
import {
  dispatchEditorEnter as pressEnter,
  editorSelectionOffsets,
  placeEditorCaretAt as placeCaretAt,
  placeEditorCaretAtEnd as placeCaretAtEnd,
  readEditorText as inputText,
} from '../platforms/live/editor-dom'
import {
  ACTIVE_MEDIA_SELECTOR,
  containsActiveMediaDeep,
  createInertOverlaySnapshot,
  inertSnapshotSkipSelector,
} from '../platforms/live/inert-snapshot'
import { t } from '../core/i18n'

;(function initDanmakuEchoLive() {
  'use strict'

  const shared = globalThis.DanmakuEchoShared
  const platformId = shared && shared.detectPlatform(location.hostname)

  if (!shared || !isSupportedContentPlatform(platformId) || globalThis.__bulletPlusOneLoaded) {
    return
  }

  globalThis.__bulletPlusOneLoaded = true

  const config = LIVE_PLATFORM_CONFIG[platformId]
  const platformName = t(
    platformId === 'bilibili'
      ? 'platformBilibili'
      : platformId === 'douyu'
        ? 'platformDouyu'
        : 'platformHuya',
  )
  const platformAdapter = createLivePlatformAdapter(platformId)
  const richMessageSender = liveRichMessageSender(platformId)
  const INERT_SNAPSHOT_SKIP_SELECTOR = inertSnapshotSkipSelector([
    `[${DOUYU_NATIVE_DANMAKU_ACTION_MARKER}]`,
    ...DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS,
    ...(platformId === 'douyu' ? DOUYU_NATIVE_DANMAKU_CAPSULE_DECORATION_SELECTORS : []),
  ])
  const DOUYU_NATIVE_DANMAKU_ACTION_SELECTOR = DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS.join(',')
  const DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTOR =
    DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTORS.join(',')
  const DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTOR =
    DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS.join(',')
  const OVERLAY_HOVER_PADDING = 14
  const OVERLAY_LEAVE_DELAY = 160
  const OVERLAY_HYDRATION_DELAY = 24
  const OVERLAY_MESSAGE_CACHE_TTL = 240
  const OVERLAY_SNAPSHOT_NODE_LIMIT = 48
  const BILIBILI_OVERLAY_ROW_SELECTOR = '.bili-danmaku-x-dm'
  const BILIBILI_OVERLAY_CACHE_TTL = 180
  const BILIBILI_OVERLAY_CACHE_LIMIT = 240
  const SENDER_SCAN_MIN_INTERVAL = 240
  const REPLY_RESOLVE_ATTEMPTS = 7
  const REPLY_RESOLVE_INTERVAL = 70
  const PLATFORM_FAILURE_FEEDBACK_WAIT_MS = 1_800
  const PLATFORM_SUCCESS_FEEDBACK_WAIT_MS = 500
  const BILIBILI_REPEAT_REMINDER_SUPPRESSION_TTL = 90_000
  const bilibiliRepeatReminderSuppressions = new Map()
  const state = {
    settings: shared.mergeSettings(),
    candidate: null,
    candidateKind: null,
    message: '',
    sender: '',
    selectedAt: 0,
    senderCorrelation: new SenderCorrelationCache(),
    douyuNativeCapsuleVisibility: new DouyuNativeCapsuleVisibilityController(),
    douyuNativeCapsuleMutationRoots: new Set(),
    senderObserver: null,
    senderScanTimer: 0,
    senderLastScanAt: 0,
    richPayload: null,
    overlayHydratedId: -1,
    overlayHydrationId: 0,
    overlayHydrationTimer: 0,
    hideTimer: 0,
    cooldownTimer: 0,
    sendProtection: createSendProtection(),
    roots: [document],
    rootsCachedAt: 0,
    ui: null,
    portal: null,
    actionBar: null,
    button: null,
    replyButton: null,
    favoriteButton: null,
    toast: null,
    frozenClone: null,
    hoverBridge: null,
    originalVisibility: null,
    pausedAnimations: [],
    overlayViewport: null,
    pointerFrame: 0,
    pointerX: 0,
    pointerY: 0,
    bilibiliOverlayCandidates: [],
    bilibiliOverlayCandidatesCachedAt: 0,
    hiddenBilibiliQuickBars: new Map(),
    bilibiliDismissToken: 0,
    emojiPanelOpenedByPlugin: false,
    repeatReminderRuntime: null,
  }
  const diagnostics = createDiagnosticsCollector({
    platform: platformId,
    featureFlags: () => state.settings,
    cacheCounts: () => ({
      senderCorrelation: state.senderCorrelation.size,
      roots: state.roots.length,
      bilibiliOverlayCandidates: state.bilibiliOverlayCandidates.length,
      hiddenBilibiliQuickBars: state.hiddenBilibiliQuickBars.size,
    }),
    observerCounts: () => ({
      sender: state.senderObserver ? 1 : 0,
      timers:
        Number(Boolean(state.hideTimer)) +
        Number(Boolean(state.senderScanTimer)) +
        Number(Boolean(state.overlayHydrationTimer)),
    }),
    selectorHits: () => ({
      chatRoot: queryAllDeep(config.chatRoots).length > 0,
      input: queryAllDeep(config.inputs).length > 0,
      videoRoot: queryAllDeep(config.videoRoots).length > 0,
    }),
  })
  const douyuNativeHover = platformId === 'douyu' ? new DouyuNativeHoverController() : null
  const douyuNativeMotionFallback =
    platformId === 'douyu' ? new DouyuNativeMotionFallback() : null
  const bilibiliOverlayMotion =
    platformId === 'bilibili' ? new BilibiliOverlayMotionController() : null
  const overlayMessageCache = new WeakMap()
  diagnostics.record({ type: 'runtime.initialized', stage: 'content' })

  function storageGet() {
    return new Promise((resolve) => {
      if (!globalThis.chrome || !chrome.storage || !chrome.storage.sync) {
        resolve({})
        return
      }

      chrome.storage.sync.get(null, (value) => resolve(value || {}))
    })
  }

  function isEnabled() {
    return Boolean(
      state.settings.enabled &&
      state.settings.platforms[platformId] &&
      Object.values(state.settings.actions).some(Boolean),
    )
  }

  function isOwned(node) {
    return node instanceof Element && Boolean(node.closest('[data-bcp-one-owned]'))
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

  function refreshRoots() {
    const now = Date.now()
    if (now - state.rootsCachedAt < 3000) {
      return state.roots
    }

    const roots = [document]
    const queue = [document]
    const visited = new Set(queue)

    while (queue.length && roots.length < 40) {
      const root = queue.shift()
      let elements = []

      try {
        elements = root.querySelectorAll('*')
      } catch {
        continue
      }

      for (const element of elements) {
        if (element.shadowRoot && !visited.has(element.shadowRoot)) {
          visited.add(element.shadowRoot)
          roots.push(element.shadowRoot)
          queue.push(element.shadowRoot)
        }
      }
    }

    state.roots = roots
    state.rootsCachedAt = now
    return roots
  }

  function queryAllDeep(selectors) {
    const results = []
    const seen = new Set()

    for (const root of refreshRoots()) {
      for (const selector of selectors) {
        let matches = []

        try {
          matches = root.querySelectorAll(selector)
        } catch {
          continue
        }

        for (const match of matches) {
          if (!seen.has(match)) {
            seen.add(match)
            results.push(match)
          }
        }
      }
    }

    return results
  }

  function queryDocumentElements(selectors) {
    const results = []
    const seen = new Set()
    let matches = []
    try {
      matches = document.querySelectorAll(selectors.join(','))
    } catch {
      for (const selector of selectors) {
        try {
          document.querySelectorAll(selector).forEach((match) => {
            if (!seen.has(match)) {
              seen.add(match)
              results.push(match)
            }
          })
        } catch {
          // Ignore selectors unsupported by an older Chromium build.
        }
      }
      return results
    }
    matches.forEach((match) => {
      if (!seen.has(match)) {
        seen.add(match)
        results.push(match)
      }
    })
    return results
  }

  function messageRows() {
    if (platformId !== 'bilibili') {
      return queryAllDeep(config.messages)
    }
    return queryDocumentElements(config.messages).filter(
      (element) => !isInsideBilibiliVideoOverlay(element),
    )
  }

  function overlayMessageCandidates() {
    if (platformId !== 'bilibili') {
      return queryAllDeep(config.overlayMessages)
    }

    const now = Date.now()
    if (now - state.bilibiliOverlayCandidatesCachedAt < BILIBILI_OVERLAY_CACHE_TTL) {
      return state.bilibiliOverlayCandidates
    }
    const seen = new Set()
    state.bilibiliOverlayCandidates = queryDocumentElements(config.overlayMessages)
      .map(normalizeOverlayCandidate)
      .filter((element) => {
        if (!element.isConnected || isOwned(element) || seen.has(element)) return false
        seen.add(element)
        return true
      })
      .slice(-BILIBILI_OVERLAY_CACHE_LIMIT)
    state.bilibiliOverlayCandidatesCachedAt = now
    return state.bilibiliOverlayCandidates
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

  function serializedTextFromElement(root, options) {
    const removals = options && Array.isArray(options.removals) ? options.removals : []
    const imageTokens = Boolean(options && options.imageTokens)
    const rejectRoot = Boolean(options && options.rejectRoot)
    const pieces = []

    const visit = (node, isRoot) => {
      if (node.nodeType === Node.TEXT_NODE) {
        pieces.push(node.textContent || '')
        return
      }
      if (!(node instanceof Element)) {
        return
      }
      if ((!isRoot || rejectRoot) && matchesAny(node, removals)) {
        return
      }
      if (node instanceof HTMLImageElement) {
        if (imageTokens) {
          const token = emojiTokenFromImage(node)
          if (token) pieces.push(` ${token} `)
        }
        return
      }
      if (node.tagName === 'BR') {
        pieces.push(' ')
        return
      }
      for (const child of node.childNodes) {
        visit(child, false)
      }
    }

    visit(root, true)
    return shared.parseMessageText(pieces.join(''), config.maxLength)
  }

  function closestFromPath(path, selectors) {
    return path.find((item) => matchesAny(item, selectors)) || null
  }

  function closestMatching(element, selectors) {
    let current = element instanceof Element ? element : null

    while (current) {
      if (matchesAny(current, selectors)) {
        return current
      }
      current = current.parentElement
    }

    return null
  }

  function elementMarker(element) {
    if (!(element instanceof Element)) {
      return ''
    }
    return [
      element.tagName,
      element.id,
      typeof element.className === 'string' ? element.className : '',
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('placeholder'),
      element.getAttribute('data-placeholder'),
      element.getAttribute('role'),
    ]
      .filter(Boolean)
      .join(' ')
  }

  function isBilibiliSideChatEditor(element) {
    if (platformId !== 'bilibili' || !(element instanceof Element)) return false
    return Boolean(
      element.matches(
        "textarea.chat-input,.chat-input-ctnr textarea,.chat-input-ctnr input,.chat-input[contenteditable]:not([contenteditable='false'])",
      ) || element.closest('.chat-input-ctnr'),
    )
  }

  function isBilibiliQuickInputRegion(element) {
    if (isBilibiliSideChatEditor(element)) {
      return false
    }
    if (platformId !== 'bilibili' || !(element instanceof Element)) {
      return false
    }

    if (closestMatching(element, BILIBILI_QUICK_BAR_SELECTORS)) {
      return true
    }

    const insidePlayer = Boolean(closestMatching(element, config.videoRoots))
    if (!insidePlayer) {
      return false
    }

    if (element.matches(EDITABLE_CONTROL_SELECTOR)) {
      return true
    }

    const nestedEditor = element.querySelector(EDITABLE_CONTROL_SELECTOR)
    if (nestedEditor && !matchesAny(element, config.videoRoots)) {
      const rect = element.getBoundingClientRect()
      if (rect.height > 0 && rect.height <= 160 && rect.width <= Math.max(900, innerWidth * 0.95)) {
        return true
      }
    }

    return /(?:danmaku|danmu|dm)[-_ ]?(?:input|send)|(?:input|send)[-_ ]?(?:danmaku|danmu|dm)|快捷(?:输入|发送)|发送弹幕/i.test(
      elementMarker(element),
    )
  }

  function pathTouchesBilibiliQuickInput(path) {
    return (
      platformId === 'bilibili' &&
      path.some((item) => item instanceof Element && isBilibiliQuickInputRegion(item))
    )
  }

  function pathTouchesBilibiliChatActions(path) {
    if (platformId !== 'bilibili') {
      return false
    }

    for (const item of path) {
      if (!(item instanceof Element)) {
        continue
      }
      if (closestMatching(item, config.userNames)) {
        return true
      }
      const actionSurface = closestMatching(item, BILIBILI_CHAT_ACTION_SURFACES)
      if (actionSurface) {
        const role = actionSurface.getAttribute('role') || ''
        const text = shared
          .normalizeWhitespace(actionSurface.innerText || actionSurface.textContent)
          .slice(0, 500)
        if (/^(?:dialog|menu|listbox)$/i.test(role) || BILIBILI_CHAT_ACTION_TEXT.test(text)) {
          return true
        }
      }
      const control = closestMatching(item, ['button', 'a', "[role='button']", "[role='menuitem']"])
      if (
        control &&
        BILIBILI_CHAT_ACTION_TEXT.test(
          shared.normalizeWhitespace(control.innerText || control.textContent),
        )
      ) {
        return true
      }
      const itemText = shared.normalizeWhitespace(item.innerText || item.textContent).slice(0, 500)
      if (BILIBILI_CHAT_STRONG_ACTION_TEXT.test(itemText)) {
        const position = getComputedStyle(item).position
        if (position === 'fixed' || position === 'absolute') {
          return true
        }
      }
    }
    return false
  }

  function isBilibiliChatAdvertisement(element) {
    if (platformId !== 'bilibili' || !(element instanceof Element)) {
      return false
    }

    const chatRoot = closestMatching(element, config.chatRoots)
    if (!chatRoot) {
      return false
    }

    const card = closestMatching(element, config.messages) || element
    if (card === chatRoot) {
      return false
    }

    let current = card
    while (current && current !== chatRoot) {
      if (matchesAny(current, BILIBILI_CHAT_AD_SELECTORS)) {
        return true
      }

      const metadata = [
        elementMarker(current),
        current.getAttribute('data-type'),
        current.getAttribute('data-module'),
        current.getAttribute('data-report'),
        current.getAttribute('data-testid'),
        current.getAttribute('data-e2e'),
      ]
        .filter(Boolean)
        .join(' ')
      if (isBilibiliAdvertisementMarker(metadata)) {
        return true
      }
      current = current.parentElement
    }

    let labels = []
    try {
      labels = Array.from(card.querySelectorAll(BILIBILI_CHAT_AD_LABEL_SELECTORS.join(',')))
    } catch {
      labels = []
    }

    const hasAdvertisementLabel = labels.some((label) =>
      isBilibiliAdvertisementLabel(
        shared.normalizeWhitespace(label.innerText || label.textContent),
      ),
    )
    if (!hasAdvertisementLabel) {
      return false
    }

    // A user may legitimately mention the word "广告". Only treat label text
    // as an ad when the row also has the structure of an interactive card.
    return Boolean(
      card.querySelector(
        "a[href], button, [role='button'], [data-url], [data-href], [class*='banner' i], [class*='card' i]",
      ),
    )
  }

  function pathTouchesBilibiliChatAdvertisement(path) {
    return (
      platformId === 'bilibili' &&
      path.some((item) => item instanceof Element && isBilibiliChatAdvertisement(item))
    )
  }

  function isInsideBilibiliVideoOverlay(element) {
    return (
      platformId === 'bilibili' &&
      element instanceof Element &&
      Boolean(closestMatching(element, config.overlayMessages))
    )
  }

  function isInsideBilibiliPlayerOutsideChat(element) {
    if (platformId !== 'bilibili' || !(element instanceof Element)) {
      return false
    }
    if (isInsideBilibiliVideoOverlay(element)) {
      return true
    }
    return (
      Boolean(closestMatching(element, config.videoRoots)) &&
      !closestMatching(element, config.chatRoots)
    )
  }

  function findChatRoot(path) {
    const inPath = closestFromPath(path, config.chatRoots)
    if (inPath) {
      return inPath
    }

    for (const node of path) {
      if (!(node instanceof Element)) {
        continue
      }

      for (const root of queryAllDeep(config.chatRoots)) {
        if (root.contains(node)) {
          return root
        }
      }
    }

    return null
  }

  function findCandidate(path) {
    const overlayMatch = closestFromPath(path, config.overlayMessages)
    if (overlayMatch) {
      const overlay = normalizeOverlayCandidate(overlayMatch)
      if (overlay && isOverlayMessageElement(overlay)) {
        return { element: overlay, kind: 'overlay' }
      }
    }

    if (
      pathTouchesBilibiliQuickInput(path) ||
      pathTouchesBilibiliChatActions(path) ||
      pathTouchesBilibiliChatAdvertisement(path)
    ) {
      return null
    }

    const known = closestFromPath(path, config.messages)
    if (known && !isBilibiliChatAdvertisement(known)) {
      return { element: known, kind: 'chat' }
    }

    const chatRoot = findChatRoot(path)
    if (!chatRoot) {
      return null
    }

    for (const node of path) {
      if (!(node instanceof Element) || node === chatRoot || !chatRoot.contains(node)) {
        continue
      }

      if (node.matches("button, input, textarea, a, [contenteditable='true']")) {
        continue
      }

      if (isBilibiliChatAdvertisement(node)) {
        continue
      }

      const rect = node.getBoundingClientRect()
      const text = shared.normalizeWhitespace(node.innerText || node.textContent)
      const namedImageEmoji =
        !(node instanceof HTMLImageElement) && richEmojiMessageForValidation(node)
      if (
        rect.height >= 12 &&
        rect.height <= 180 &&
        ((text.length >= 1 && text.length <= 260) || namedImageEmoji)
      ) {
        return { element: node, kind: 'chat' }
      }
    }

    return null
  }

  function composedParentElement(element) {
    if (element.parentElement) return element.parentElement
    const root = typeof element.getRootNode === 'function' ? element.getRootNode() : null
    return root instanceof ShadowRoot ? root.host : null
  }

  function overlayViewportRect(candidate) {
    if (!(candidate instanceof Element)) return null

    const rootRects = []
    let current = candidate
    while (current) {
      if (matchesAny(current, config.videoRoots)) {
        const rect = current.getBoundingClientRect()
        if (rect.width > 8 && rect.height > 8) {
          // Use the nearest visual player root. Huya's page-theater/fullscreen
          // mode lets #player-wrap escape an older .room-player-wrap ancestor;
          // intersecting both rectangles incorrectly rejects every barrage in
          // the expanded portion of the real player.
          rootRects.push(rect)
          break
        }
      }
      current = composedParentElement(current)
    }

    // Some live sites portal the danmaku layer beside the player instead of
    // nesting it. In that case choose the smallest visible video root that
    // actually intersects the candidate; never fall back to the whole page.
    if (!rootRects.length) {
      const candidateRect = candidate.getBoundingClientRect()
      const intersectingRoots = queryAllDeep(config.videoRoots)
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(
          ({ element, rect }) =>
            !isOwned(element) &&
            rect.width > 8 &&
            rect.height > 8 &&
            intersectRectBounds([candidateRect, rect]),
        )
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)
      if (intersectingRoots[0]) rootRects.push(intersectingRoots[0].rect)
    }

    if (!rootRects.length) return null
    return intersectRectBounds([
      { bottom: innerHeight, left: 0, right: innerWidth, top: 0 },
      ...rootRects,
    ])
  }

  function pointInsideOverlayViewport(candidate, x, y) {
    const viewport =
      candidate === state.candidate && state.overlayViewport
        ? state.overlayViewport
        : overlayViewportRect(candidate)
    return pointInsideRect(viewport, x, y)
  }

  function richEmojiMessageForValidation(element) {
    if (!(element instanceof Element) || !element.querySelector('img')) return ''
    const payload = richPayloadFromCandidate(element)
    const hasNamedEmoji = payload.assets.some((asset) => {
      const token = shared.normalizeWhitespace(asset && asset.token)
      return /^\[[^\]\n]{1,40}\]$/.test(token) || /\p{Extended_Pictographic}/u.test(token)
    })
    return hasNamedEmoji && shared.isPlausibleMessage(payload.text, config.maxLength)
      ? payload.text
      : ''
  }

  function overlayRichEmojiMessageForValidation(element) {
    if (!(element instanceof Element) || !element.querySelector('img')) return ''
    const payload = richPayloadFromCandidate(element)
    const hasImageIdentity = payload.assets.some(
      (asset) => asset && Array.isArray(asset.keys) && asset.keys.length > 0,
    )
    return hasImageIdentity && shared.isPlausibleMessage(payload.text, config.maxLength)
      ? payload.text
      : ''
  }

  function overlayMessageSignature(element) {
    if (!(element instanceof Element)) return ''
    const images = element.getElementsByTagName('img')
    const imageIdentity = []
    for (let index = 0; index < Math.min(images.length, 4); index += 1) {
      const image = images[index]
      imageIdentity.push(
        [
          image.currentSrc || image.getAttribute('src'),
          image.getAttribute('data-src'),
          image.getAttribute('alt'),
          image.getAttribute('rel'),
          image.getAttribute('title'),
        ]
          .filter(Boolean)
          .join('|'),
      )
    }
    return [
      element.childElementCount,
      element.getAttribute('data-danmaku') || '',
      String(element.textContent || '').slice(0, config.maxLength + 80),
      imageIdentity.join(';'),
    ].join('\u0000')
  }

  function overlayMessageForValidation(element) {
    if (!(element instanceof Element)) return ''
    const signature = overlayMessageSignature(element)
    const now = performance.now()
    const cached = overlayMessageCache.get(element)
    if (
      cached &&
      cached.signature === signature &&
      now - cached.cachedAt <= OVERLAY_MESSAGE_CACHE_TTL
    ) {
      return cached.message
    }

    if (platformId === 'bilibili' && element.matches(BILIBILI_OVERLAY_ROW_SELECTOR)) {
      const content = element.querySelector('.bili-danmaku-x-dm-content') || element
      const rowMessage = shared.parseMessageText(
        element.getAttribute('data-danmaku') ||
          content.getAttribute('data-danmaku') ||
          content.textContent,
        config.maxLength,
      )
      if (shared.isPlausibleMessage(rowMessage, config.maxLength)) {
        overlayMessageCache.set(element, { cachedAt: now, message: rowMessage, signature })
        return rowMessage
      }
    }

    const plainText = textFromCandidate(element)
    if (shared.isPlausibleMessage(plainText, config.maxLength)) {
      overlayMessageCache.set(element, { cachedAt: now, message: plainText, signature })
      return plainText
    }

    // Player danmaku rows are already constrained by the platform overlay
    // selectors and viewport checks. Their image Emoji often expose only a
    // resource URL (or a generic "图片表情" label), so accept a parsed asset
    // identity here. Side-chat fallback keeps the stricter named-Emoji check
    // above to avoid treating advertisements and decorative images as messages.
    const richMessage = overlayRichEmojiMessageForValidation(element)
    overlayMessageCache.set(element, { cachedAt: now, message: richMessage, signature })
    return richMessage
  }

  function normalizeOverlayCandidate(element) {
    if (platformId !== 'bilibili' || !(element instanceof Element)) {
      return element
    }
    const row = element.matches(BILIBILI_OVERLAY_ROW_SELECTOR)
      ? element
      : element.closest(BILIBILI_OVERLAY_ROW_SELECTOR)
    return row || element
  }

  function isOverlayMessageElement(element) {
    if (!(element instanceof Element) || isOwned(element) || !element.isConnected) {
      return false
    }

    // Douyu reuses danmuItem-like class names in some side-chat revisions.
    // A node mounted in the chat column must never inherit overlay behavior,
    // otherwise it bypasses the independently disabled side-chat capsule.
    if (platformId === 'douyu' && closestMatching(element, config.chatRoots)) {
      return false
    }

    const bilibiliOverlayRow =
      platformId === 'bilibili' && element.matches(BILIBILI_OVERLAY_ROW_SELECTOR)
    if (bilibiliOverlayRow) {
      const rect = element.getBoundingClientRect()
      return rect.height >= 8 && rect.height <= Math.min(120, innerHeight * 0.22) && rect.width >= 4
    }

    if (!isVisible(element)) {
      return false
    }

    if (
      isBilibiliQuickInputRegion(element) ||
      matchesAny(element, config.videoRoots) ||
      element.matches(ACTIVE_MEDIA_SELECTOR) ||
      element.matches(
        "video, canvas, button, input, textarea, [role='button'], [contenteditable='true']",
      )
    ) {
      return false
    }

    if (element.querySelector(EDITABLE_CONTROL_SELECTOR) || containsActiveMediaDeep(element)) {
      return false
    }

    const rect = element.getBoundingClientRect()
    const exactOverlay = matchesAny(element, config.overlayMessages)
    const maximumWidth = exactOverlay ? Number.POSITIVE_INFINITY : Math.min(900, innerWidth * 0.85)
    if (
      rect.height < 8 ||
      rect.height > Math.min(120, innerHeight * 0.22) ||
      rect.width < 4 ||
      rect.width > maximumWidth
    ) {
      return false
    }

    for (const selector of config.overlayMessages) {
      try {
        if (element.querySelector(selector)) {
          if (bilibiliOverlayRow && selector === '.bili-danmaku-x-dm-content') {
            continue
          }
          return false
        }
      } catch {
        // Ignore selectors unsupported by an older Chromium build.
      }
    }

    return Boolean(overlayMessageForValidation(element))
  }

  function isGenericOverlayElement(element) {
    if (!(element instanceof Element) || isOwned(element)) {
      return false
    }

    if (
      isBilibiliQuickInputRegion(element) ||
      element.matches("button, input, textarea, video, canvas, a, [contenteditable='true']") ||
      element.querySelector(EDITABLE_CONTROL_SELECTOR)
    ) {
      return false
    }

    const videoRoot = closestMatching(element, config.videoRoots)
    if (!videoRoot) {
      return false
    }

    const rect = element.getBoundingClientRect()
    const text = overlayMessageForValidation(element)
    const style = getComputedStyle(element)
    const className = typeof element.className === 'string' ? element.className : ''
    const marker = [
      element.id,
      className,
      element.getAttribute('data-e2e'),
      element.getAttribute('data-testid'),
      element.getAttribute('aria-label'),
    ]
      .filter(Boolean)
      .join(' ')
    const hasDanmakuMarker = /(danmaku|danmu|bullet|barrage|弹幕)/i.test(marker)
    const isControl =
      /(setting|control|quality|definition|resolution|menu|button|清晰度|设置)/i.test(marker)
    const looksLikeMessage =
      style.animationName !== 'none' ||
      style.transform !== 'none' ||
      /(item|text|message|content|\bdm\b)/i.test(marker)

    return (
      isOverlayMessageElement(element) &&
      hasDanmakuMarker &&
      !isControl &&
      looksLikeMessage &&
      rect.height >= 10 &&
      rect.height <= 100 &&
      rect.width >= 4 &&
      rect.width <= Math.min(900, innerWidth * 0.9) &&
      Boolean(text)
    )
  }

  function isInsideFrozenHoverZone(x, y) {
    const frozenTarget = state.frozenClone?.isConnected
      ? state.frozenClone
      : platformId === 'douyu' && state.candidate?.isConnected
        ? state.candidate
        : null
    return (
      state.candidateKind === 'overlay' &&
      frozenTarget &&
      pointInsideOverlayViewport(state.candidate, x, y) &&
      pointInsideRect(frozenTarget.getBoundingClientRect(), x, y, OVERLAY_HOVER_PADDING)
    )
  }

  function isInsideSelectedHoverBody(target) {
    if (!(target instanceof Node)) return false
    return Boolean(
      state.candidate?.contains(target) ||
      state.actionBar?.contains(target) ||
      state.hoverBridge?.contains(target),
    )
  }

  function douyuOverlayCandidateFromTarget(target) {
    if (platformId !== 'douyu' || !(target instanceof Element)) return null
    const candidate = closestMatching(target, config.overlayMessages)
    return candidate instanceof HTMLElement && !isOwned(candidate) ? candidate : null
  }

  function douyuOverlayCandidateFromPath(path) {
    if (platformId !== 'douyu') return null
    const candidate = closestFromPath(path, config.overlayMessages)
    return candidate instanceof HTMLElement && !isOwned(candidate) ? candidate : null
  }

  function findOverlayAtPoint(x, y) {
    if (pointTouchesRepeatReminder(document, x, y)) return null
    const pointElements =
      typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : []

    // The side chat can be visually adjacent to a danmaku whose un-clipped DOM
    // box extends beyond the player. A chat hit always wins over that invisible
    // part of the moving overlay.
    if (pointElements.some((element) => closestMatching(element, config.chatRoots))) {
      return null
    }

    if (isInsideFrozenHoverZone(x, y)) {
      return state.candidate
    }

    for (const element of pointElements) {
      const exact = normalizeOverlayCandidate(closestMatching(element, config.overlayMessages))
      if (exact && isOverlayMessageElement(exact) && pointInsideOverlayViewport(exact, x, y)) {
        return exact
      }
      if (isGenericOverlayElement(element) && pointInsideOverlayViewport(element, x, y)) {
        return element
      }
    }

    const exactCandidates = overlayMessageCandidates()
    const exactHits = []

    exactCandidates.forEach((candidate, index) => {
      if (!isOverlayMessageElement(candidate)) {
        return
      }

      const rect = candidate.getBoundingClientRect()
      if (pointInsideRect(rect, x, y) && pointInsideOverlayViewport(candidate, x, y)) {
        const normalizedX = (x - (rect.left + rect.width / 2)) / Math.max(rect.width, 1)
        const normalizedY = (y - (rect.top + rect.height / 2)) / Math.max(rect.height, 1)
        const centerDistance = Math.hypot(normalizedX, normalizedY)
        const areaPenalty = Math.min((rect.width * rect.height) / 1_000_000, 0.25)
        exactHits.push({ candidate, score: centerDistance + areaPenalty, index })
      }
    })

    if (exactHits.length) {
      exactHits.sort((a, b) => a.score - b.score || b.index - a.index)
      return exactHits[0].candidate
    }

    return null
  }

  function textFromSpecificElement(candidate) {
    if (platformId === 'douyu' && candidate instanceof Element) {
      const segments = douyuOverlayTextElements(candidate)
      if (segments.length > 1) {
        const text = shared.parseMessageText(
          segments.map((element) => element.innerText || element.textContent || '').join(''),
          config.maxLength,
        )
        if (shared.isPlausibleMessage(text, config.maxLength)) return text
      }
    }

    for (const selector of config.messageText) {
      let element = null

      try {
        element = candidate.matches(selector) ? candidate : candidate.querySelector(selector)
      } catch {
        element = null
      }

      if (element) {
        const text = shared.parseMessageText(
          element.innerText || element.textContent,
          config.maxLength,
        )
        if (shared.isPlausibleMessage(text, config.maxLength)) {
          return text
        }
      }
    }

    return ''
  }

  function emojiMetadataElements(element, image) {
    const elements = []
    const seen = new Set()
    const append = (candidate) => {
      if (!(candidate instanceof Element) || seen.has(candidate)) return
      seen.add(candidate)
      elements.push(candidate)
    }
    append(image)
    append(element)

    let current = (image || element).parentElement
    for (let depth = 0; current && depth < 12; depth += 1) {
      const marker = elementMarker(current)
      if (
        /(?:emoji|emote|emoticon|emotion|face|sticker|表情)/i.test(marker) ||
        EMOJI_METADATA_ATTRIBUTES.some((attribute) => current.hasAttribute(attribute)) ||
        (platformId === 'bilibili' && current.getAttribute('data-type') === '1')
      ) {
        append(current)
      }
      const isMessageBoundary =
        closestMatching(current, config.messages) === current ||
        closestMatching(current, config.overlayMessages) === current
      const hasBilibiliImageIdentity =
        platformId === 'bilibili' &&
        (current.getAttribute('data-type') === '1' ||
          BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES.some((attribute) =>
            current.hasAttribute(attribute),
          ))
      if (isMessageBoundary && (platformId !== 'bilibili' || hasBilibiliImageIdentity)) {
        break
      }
      current = current.parentElement
    }
    return elements
  }

  function isGenericEmojiLabel(value) {
    const normalized = shared.normalizeWhitespace(value).replace(/^\[|\]$/g, '')
    return /^(?:图片|图片表情|表情|表情包|emoji|emote|emoticon|image|sticker)$/i.test(normalized)
  }

  function normalizedEmojiToken(value, marker) {
    const normalized = shared.normalizeWhitespace(value)
    if (!normalized || isGenericEmojiLabel(normalized)) return ''
    if (platformId === 'bilibili' && isBilibiliDecorativeImageDescription(normalized)) return ''
    if (/^\[[^\]\n]{1,40}\]$/.test(normalized)) return normalized
    if (/\p{Extended_Pictographic}/u.test(normalized)) return normalized
    if (
      /^(?:data|blob|https?):/i.test(normalized) ||
      /[\\/]/.test(normalized) ||
      Array.from(normalized).length > 40
    ) {
      return ''
    }
    if (
      /(?:emoji|emote|emoticon|emotion|face|sticker|表情)/i.test(marker) &&
      !/^(?:\d{6,}|[a-f\d]{16,})$/i.test(normalized)
    ) {
      return `[${normalized}]`
    }
    return ''
  }

  function emojiTokenFromElement(element) {
    if (!(element instanceof Element)) return ''
    const image = element instanceof HTMLImageElement ? element : element.querySelector('img')
    const douyuRelToken = douyuImageRelToken(image)
    if (douyuRelToken) return douyuRelToken
    for (const metadataElement of emojiMetadataElements(element, image)) {
      const marker = elementMarker(metadataElement)
      for (const attribute of EMOJI_METADATA_ATTRIBUTES) {
        const raw = shared.normalizeWhitespace(metadataElement.getAttribute(attribute))
        if (
          raw &&
          !EMOJI_DISPLAY_ATTRIBUTES.has(attribute) &&
          !/^\[[^\]\n]{1,40}\]$/.test(raw) &&
          !/\p{Extended_Pictographic}/u.test(raw)
        ) {
          continue
        }
        const token = normalizedEmojiToken(raw, `${marker} ${attribute}`)
        if (token) return token
      }
    }
    return ''
  }

  function emojiTokenFromImage(image) {
    return emojiTokenFromElement(image)
  }

  function douyuImageRelToken(element) {
    if (platformId !== 'douyu' || !(element instanceof HTMLImageElement)) return ''
    if (!/(?:^|\s)EmotImage(?:Pe3?)?(?:-|\s|$)/i.test(elementMarker(element))) return ''
    return normalizedEmojiToken(element.getAttribute('rel'), 'douyu emoji')
  }

  function douyuEmojiPanelToken(element) {
    if (platformId !== 'douyu' || !(element instanceof Element)) return ''
    const item = element.matches('.EmotionList-item')
      ? element
      : element.closest('.EmotionList-item')
    const title = item && item.querySelector('.EmotionList-item-title')
    if (!(title instanceof Element)) return ''
    return normalizedEmojiToken(title.textContent, elementMarker(title))
  }

  function huyaEmojiPanelToken(element) {
    if (platformId !== 'huya' || !(element instanceof Element)) return ''
    const item = element.matches("[class*='emot--']")
      ? element
      : element.closest("[class*='emot--']")
    if (!(item instanceof Element)) return ''
    const values = [
      item.querySelector("img[class*='emot-icon--'][alt]")?.getAttribute('alt'),
      item.querySelector("[class*='emot-preview--'] span")?.textContent,
      item.querySelector("[class*='emot-preview--'] img[alt]")?.getAttribute('alt'),
    ]
    for (const value of values) {
      const token = normalizedEmojiToken(value, 'huya emoticon')
      if (token) return token
    }
    return ''
  }

  function assetDescriptorFromElement(element) {
    if (!(element instanceof Element)) {
      return null
    }
    const image = element instanceof HTMLImageElement ? element : element.querySelector('img')
    const metadataElements = emojiMetadataElements(element, image)
    const sources = []
    const displayMetadata = []
    const identityMetadata = []
    metadataElements.forEach((metadataElement) => {
      const sourceValues = [
        metadataElement instanceof HTMLImageElement && metadataElement.currentSrc,
        metadataElement.getAttribute('src'),
        metadataElement.getAttribute('data-src'),
        metadataElement.getAttribute('data-url'),
        metadataElement.getAttribute('data-image'),
        metadataElement.getAttribute('data-image-url'),
      ]
      sourceValues.filter(Boolean).forEach((value) => sources.push(value))
      EMOJI_METADATA_ATTRIBUTES.forEach((attribute) => {
        const value = metadataElement.getAttribute(attribute)
        if (!value) return
        if (
          EMOJI_DISPLAY_ATTRIBUTES.has(attribute) ||
          /^\[[^\]\n]{1,40}\]$/.test(shared.normalizeWhitespace(value)) ||
          /\p{Extended_Pictographic}/u.test(value)
        ) {
          displayMetadata.push(value)
        } else {
          identityMetadata.push(value)
        }
      })
    })
    const authoritativeBilibiliToken =
      platformId === 'bilibili'
        ? bilibiliNativeEmoticonDisplayToken([
            // The rendered message body is authoritative for display. This
            // keeps img alt="冲鸭" ahead of opaque send ids such as
            // data-danmaku="official_332".
            ...displayMetadata,
            ...metadataElements
              .filter(
                (metadataElement) =>
                  metadataElement.getAttribute('data-type') === '1' ||
                  BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES.some((attribute) =>
                    metadataElement.hasAttribute(attribute),
                  ),
              )
              .map((metadataElement) => metadataElement.getAttribute('data-danmaku')),
          ])
        : ''
    const token =
      authoritativeBilibiliToken ||
      huyaEmojiPanelToken(element) ||
      douyuEmojiPanelToken(element) ||
      emojiTokenFromElement(element)
    const keys = new Set()
    if (platformId === 'huya') {
      metadataElements.forEach((metadataElement) => {
        const marker = elementMarker(metadataElement)
        const id = shared.normalizeWhitespace(metadataElement.getAttribute('data-id'))
        if (id && /(?:^|\s)emot(?:--|-icon--|-preview--)/i.test(marker)) {
          keys.add(`huya-emoticon-id:${id.toLowerCase().slice(0, 120)}`)
        }
      })
      sources.forEach((source) => {
        const matches = String(source).matchAll(
          /(?:web_base_material_|material[_/-])([0-9]{8,})(?:_pic)?/gi,
        )
        for (const match of matches) {
          keys.add(`huya-material:${match[1]}`)
        }
      })
    }
    if (platformId === 'bilibili') {
      let nativePanelIdentity = ''
      let isNativePanelAsset = false
      metadataElements.forEach((metadataElement) => {
        const standardEmoticonId = shared.normalizeWhitespace(
          metadataElement.getAttribute('data-emoticon-id'),
        )
        if (standardEmoticonId) {
          // Bilibili's ordinary built-in Emoji are recognized from their
          // bracket names by the official editor. Keep a positive identity so
          // other bracketed image resources never enter that text-only path.
          keys.add(
            `${BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX}${standardEmoticonId
              .toLowerCase()
              .slice(0, 180)}`,
          )
        }
        if (metadataElement.getAttribute('data-type') === '1') {
          isNativePanelAsset = true
        }
        BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES.forEach((attribute) => {
          const value = shared.normalizeWhitespace(metadataElement.getAttribute(attribute))
          if (!value) return
          isNativePanelAsset = true
          if (!nativePanelIdentity) nativePanelIdentity = value
        })
      })
      if (isNativePanelAsset) {
        keys.add(
          `${NATIVE_PANEL_ASSET_KEY_PREFIX}${String(nativePanelIdentity || sources[0] || 'type-1')
            .trim()
            .toLowerCase()
            .slice(0, 220)}`,
        )
      }
    }
    sources
      .concat(displayMetadata)
      .concat(token || [])
      .forEach((value) => {
        normalizedRichAssetKeys(value, location.href).forEach((key) => keys.add(key))
      })
    identityMetadata.forEach((value) => {
      normalizedRichAssetKeys(value, location.href)
        .filter((key) => !key.startsWith('name:'))
        .forEach((key) => keys.add(key))
    })
    if (!keys.size) {
      return null
    }
    return {
      src: String(sources[0] || '').slice(0, 4096),
      token: shared.normalizeWhitespace(token).slice(0, 120),
      keys: Array.from(keys).slice(0, 48),
    }
  }

  function messageEmojiImages(candidate, messageElement) {
    const messageContainsImage =
      messageElement instanceof HTMLImageElement || Boolean(messageElement.querySelector('img'))
    const roots =
      candidate === messageElement || (platformId === 'bilibili' && messageContainsImage)
        ? [messageElement]
        : [messageElement, candidate]
    const images = []
    const seen = new Set()
    roots.forEach((root) => {
      if (root instanceof HTMLImageElement && !seen.has(root)) {
        seen.add(root)
        images.push(root)
      }
      root.querySelectorAll('img').forEach((image) => {
        if (!seen.has(image)) {
          seen.add(image)
          images.push(image)
        }
      })
    })
    return images.filter((image) => {
      if (closestMatching(image, config.userNames)) return false
      let marker = ''
      let current = image
      for (let depth = 0; current && depth < 4 && current !== candidate; depth += 1) {
        marker += ` ${elementMarker(current)}`
        current = current.parentElement
      }
      const source = [image.currentSrc, image.getAttribute('src'), image.getAttribute('data-src')]
        .filter(Boolean)
        .join(' ')
      const token = emojiTokenFromImage(image)
      const positive =
        Boolean(token) ||
        /(?:emoji|emote|emoticon|sticker|emotion|face|表情)/i.test(`${marker} ${source}`)
      const decorative =
        /(?:avatar|badge|medal|level|grade|rank|fansclub|fan-club|guard|noble)/i.test(marker) ||
        (platformId === 'bilibili' && isBilibiliDecorativeImageDescription(marker))
      return !decorative && (messageElement.contains(image) || positive)
    })
  }

  function messageElementFromCandidate(candidate) {
    if (!(candidate instanceof Element)) {
      return null
    }
    for (const selector of config.messageText) {
      try {
        const element = candidate.matches(selector) ? candidate : candidate.querySelector(selector)
        if (element) {
          return element
        }
      } catch {
        // Ignore selectors unsupported by an older Chromium build.
      }
    }
    return candidate
  }

  function richPayloadFromCandidate(candidate) {
    if (
      platformId === 'bilibili' &&
      candidate instanceof Element &&
      candidate.matches(BILIBILI_OVERLAY_ROW_SELECTOR) &&
      !candidate.querySelector('img')
    ) {
      const content = candidate.querySelector('.bili-danmaku-x-dm-content') || candidate
      const text = shared.parseMessageText(
        candidate.getAttribute('data-danmaku') ||
          content.getAttribute('data-danmaku') ||
          content.textContent,
        config.maxLength,
      )
      if (shared.isPlausibleMessage(text, config.maxLength)) {
        return { text, plainText: text, assets: [], parts: [{ type: 'text', text }] }
      }
    }

    if (platformId === 'douyu' && candidate instanceof Element) {
      const segments = douyuOverlayTextElements(candidate)
      if (segments.length > 1) {
        const parts = []
        segments.forEach((segment) => {
          richPartsFromElement(segment).forEach((part) => {
            const previous = parts[parts.length - 1]
            if (part.type === 'text' && previous?.type === 'text') previous.text += part.text
            else parts.push(part)
          })
        })
        const assets = parts
          .filter((part) => part?.type === 'emoji' && part.asset)
          .map((part) => part.asset)
          .slice(0, 8)
        const plainText = shared.parseMessageText(
          segments
            .map((segment) =>
              serializedTextFromElement(segment, {
                imageTokens: false,
                rejectRoot: false,
                removals: ['img', 'button', 'svg', "[aria-hidden='true']", '[data-bcp-one-owned]'],
              }),
            )
            .join(''),
          config.maxLength,
        )
        let text = shared.parseMessageText(
          parts
            .map((part) => (part.type === 'text' ? part.text : part.asset?.token || ''))
            .join(''),
          config.maxLength,
        )
        if (!shared.isPlausibleMessage(text, config.maxLength) && assets.length) {
          text =
            assets
              .map((asset) => asset.token)
              .filter(Boolean)
              .join(' ') || '图片表情'
        }
        return { text, plainText, assets, parts }
      }
    }

    const element = messageElementFromCandidate(candidate)
    if (!element) {
      return { text: '', plainText: '', assets: [], parts: [] }
    }
    const assets = messageEmojiImages(candidate, element)
      .map(assetDescriptorFromElement)
      .filter(Boolean)
      .slice(0, 8)
    const plainText = serializedTextFromElement(element, {
      imageTokens: false,
      rejectRoot: false,
      removals: ['img', 'button', 'svg', "[aria-hidden='true']", '[data-bcp-one-owned]'],
    })
    let text = richTextFromElement(element)
    if (!shared.isPlausibleMessage(text, config.maxLength) && assets.length) {
      text =
        assets
          .map((asset) => asset.token)
          .filter(Boolean)
          .join(' ') || '图片表情'
    }
    // Bilibili danmaku rows carry the full message (including bracketed Emoji
    // names) in their data-danmaku attribute even when the rendered images
    // expose no nameable token. Prefer that authoritative text whenever the
    // DOM-derived text lost every Emoji name or picked up a neighboring badge
    // description, so mixed sends stay lossless.
    // This lookup is intentionally cheap (attribute reads only): the heavier
    // side-chat asset recovery runs once at send time, not on every hover.
    const bilibiliTextHasReliableEmojiName =
      /\[[^\]\n]{1,40}\]/.test(text) && !isBilibiliDecorativeImageDescription(text)
    if (platformId === 'bilibili' && assets.length && !bilibiliTextHasReliableEmojiName) {
      const row = candidate.matches('[data-danmaku]')
        ? candidate
        : candidate.closest('[data-danmaku]')
      const content = element.querySelector('.bili-danmaku-x-dm-content') || element
      const rowText = shared.parseMessageText(
        (row && row.getAttribute('data-danmaku')) || content.getAttribute('data-danmaku') || '',
        config.maxLength,
      )
      if (rowText && shared.isPlausibleMessage(rowText, config.maxLength)) {
        text = rowText
      }
    }
    return { text, plainText, assets, parts: richPartsFromElement(element) }
  }

  const bilibiliChatAssetCache = new Map()
  const BILIBILI_CHAT_ASSET_CACHE_TTL = 2_000
  const huyaChatAssetCache = new Map()
  const HUYA_CHAT_ASSET_CACHE_TTL = 2_000

  function bilibiliChatAssetDescriptor(asset) {
    if (platformId !== 'bilibili' || !asset || !Array.isArray(asset.keys)) return null
    const cacheKey = Array.from(asset.keys).slice(0, 8).sort().join('|')
    const cached = bilibiliChatAssetCache.get(cacheKey)
    if (cached) {
      if (cached.expiresAt > Date.now()) return cached.value
      bilibiliChatAssetCache.delete(cacheKey)
    }
    const rows = queryAllDeep(config.messages)
    let result = null
    for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
      const row = rows[rowIndex]
      if (isOwned(row) || isBilibiliChatAdvertisement(row)) continue
      const isNativeEmoticonRow =
        row.getAttribute('data-type') === '1' ||
        BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES.some((attribute) =>
          row.hasAttribute(attribute),
        )
      if (!isNativeEmoticonRow) continue
      const messageElement = messageElementFromCandidate(row)
      if (!(messageElement instanceof Element)) continue
      // A Bilibili chat row can contain wealth/fan-medal images before the
      // actual message. Only the message body may provide the Emoji asset.
      for (const image of messageEmojiImages(row, messageElement)) {
        const descriptor = assetDescriptorFromElement(image)
        if (!descriptor || !descriptor.token) continue
        if (assetMatchScore(image, asset) >= 4) {
          result = descriptor
          break
        }
      }
      if (result) break
    }
    bilibiliChatAssetCache.set(cacheKey, {
      expiresAt: Date.now() + BILIBILI_CHAT_ASSET_CACHE_TTL,
      value: result,
    })
    return result
  }

  function bilibiliCompleteEmojiTokens(payload) {
    if (platformId !== 'bilibili' || !payload) return
    const prepareAssetForRecovery = (asset) => {
      if (!asset) return false
      if (isBilibiliDecorativeImageDescription(asset.token)) {
        asset.token = ''
      }
      if (Array.isArray(asset.keys)) {
        asset.keys = asset.keys.filter((key) => {
          const match = /^(?:name|raw):(.*)$/i.exec(String(key || ''))
          return !match || !isBilibiliDecorativeImageDescription(match[1])
        })
      }
      return !asset.token
    }
    const emojiParts = Array.isArray(payload.parts)
      ? payload.parts.filter((part) => part && part.type === 'emoji')
      : []
    if (Array.isArray(payload.assets)) {
      payload.assets.forEach((asset) => {
        if (!prepareAssetForRecovery(asset)) return
        const chatDescriptor = bilibiliChatAssetDescriptor(asset)
        if (chatDescriptor) mergeEmojiAssetMetadata(asset, chatDescriptor)
      })
    }
    emojiParts.forEach((part) => {
      if (!prepareAssetForRecovery(part.asset)) return
      const chatDescriptor = bilibiliChatAssetDescriptor(part.asset)
      if (chatDescriptor) mergeEmojiAssetMetadata(part.asset, chatDescriptor)
    })
  }

  function huyaChatAssetDescriptor(asset) {
    if (platformId !== 'huya' || !asset || !Array.isArray(asset.keys)) return null
    const cacheKey = Array.from(asset.keys).slice(0, 8).sort().join('|')
    const cached = huyaChatAssetCache.get(cacheKey)
    if (cached) {
      if (cached.expiresAt > Date.now()) return cached.value
      huyaChatAssetCache.delete(cacheKey)
    }

    let result = null
    const rows = queryAllDeep(config.messages).slice(-100)
    for (const row of rows) {
      if (isOwned(row)) continue
      const messageElement = messageElementFromCandidate(row)
      if (!(messageElement instanceof Element)) continue
      for (const image of messageEmojiImages(row, messageElement)) {
        const descriptor = assetDescriptorFromElement(image)
        if (!descriptor || !descriptor.token || isGenericEmojiLabel(descriptor.token)) continue
        if (assetMatchScore(image, asset) >= 4) {
          result = descriptor
          break
        }
      }
      if (result) break
    }

    huyaChatAssetCache.set(cacheKey, {
      expiresAt: Date.now() + HUYA_CHAT_ASSET_CACHE_TTL,
      value: result,
    })
    return result
  }

  function huyaCompleteEmojiTokens(payload) {
    if (platformId !== 'huya' || !payload) return
    const emojiParts = Array.isArray(payload.parts)
      ? payload.parts.filter((part) => part && part.type === 'emoji')
      : []
    if (Array.isArray(payload.assets)) {
      payload.assets.forEach((asset) => {
        if (!asset || emojiTokenQuality(asset.token) >= 3) return
        const chatDescriptor = huyaChatAssetDescriptor(asset)
        if (chatDescriptor) mergeEmojiAssetMetadata(asset, chatDescriptor)
      })
    }
    emojiParts.forEach((part) => {
      if (!part.asset || emojiTokenQuality(part.asset.token) >= 3) return
      const chatDescriptor = huyaChatAssetDescriptor(part.asset)
      if (chatDescriptor) mergeEmojiAssetMetadata(part.asset, chatDescriptor)
    })
    refreshRichPayloadText(payload)
  }

  function richPartsFromElement(element) {
    const parts = []
    const appendText = (value) => {
      const text = String(value || '')
      if (!text) return
      const previous = parts[parts.length - 1]
      if (previous && previous.type === 'text') previous.text += text
      else parts.push({ type: 'text', text })
    }
    const visit = (node) => {
      if (!node || parts.length >= 40) return
      if (node.nodeType === Node.TEXT_NODE) {
        appendText(node.textContent || '')
        return
      }
      if (!(node instanceof Element)) return
      if (
        matchesAny(node, [
          'button',
          'svg',
          "[aria-hidden='true']",
          '[data-bcp-one-owned]',
          ...config.userNames,
        ])
      )
        return
      if (node instanceof HTMLImageElement) {
        const asset = assetDescriptorFromElement(node)
        if (asset) parts.push({ type: 'emoji', asset })
        return
      }
      if (node.tagName === 'BR') {
        appendText(' ')
        return
      }
      Array.from(node.childNodes).forEach(visit)
    }
    Array.from(element.childNodes).forEach(visit)
    return parts
  }

  function isBilibiliNativePanelAsset(asset) {
    return Boolean(
      asset &&
      Array.isArray(asset.keys) &&
      asset.keys.some((key) => {
        const normalized = String(key || '').toLowerCase()
        return (
          (normalized.startsWith(NATIVE_PANEL_ASSET_KEY_PREFIX) &&
            !normalized.startsWith(`${NATIVE_PANEL_ASSET_KEY_PREFIX}resolved:`)) ||
          normalized.startsWith(LEGACY_BILIBILI_EXCLUSIVE_ASSET_KEY_PREFIX)
        )
      }),
    )
  }

  function bilibiliInlineEmojiText(payload) {
    if (
      platformId !== 'bilibili' ||
      !payload ||
      !Array.isArray(payload.parts) ||
      !payload.parts.length
    ) {
      return ''
    }
    // Rebuild the message strictly from the ordered parts. The native panel
    // path can insert only one asset and drops the surrounding text plus any
    // remaining Emoji, so mixed content must always resolve to a text send.
    // Assets and parts are not required to match 1:1 here: some rendered
    // Emoji rows expose only a partial image list, and the ordered parts are
    // the authoritative DOM order.
    const pieces = []
    let emojiCount = 0
    for (const part of payload.parts) {
      if (!part || typeof part !== 'object') return ''
      if (part.type === 'text') {
        pieces.push(String(part.text || ''))
        continue
      }
      if (part.type !== 'emoji' || !part.asset || typeof part.asset !== 'object') return ''
      const raw = String(part.asset.token || '').trim()
      if (!raw) return ''
      if (/^\[[^\]\n]{1,80}\]$/.test(raw) || /\p{Extended_Pictographic}/u.test(raw)) {
        pieces.push(raw)
      } else if (
        !isGenericEmojiLabel(raw) &&
        !/^(?:data|blob|https?):/i.test(raw) &&
        !/[\\/]/.test(raw) &&
        Array.from(raw).length <= 40
      ) {
        pieces.push(`[${raw}]`)
      } else {
        return ''
      }
      emojiCount += 1
    }
    if (!emojiCount) return ''
    return pieces.join('').replace(/\s+/g, ' ').trim()
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
        score += key.startsWith('digest:')
          ? 10
          : key.startsWith('raw:')
            ? 8
            : key.startsWith('path:')
              ? 6
              : key.startsWith('slug:')
                ? 6
                : 4
      }
    })
    return score
  }

  function emojiTokenQuality(value) {
    if (platformId === 'bilibili' && isBilibiliDecorativeImageDescription(value)) return 0
    const token = normalizedEmojiToken(value, 'emoji')
    if (!token) return 0
    if (/\p{Extended_Pictographic}/u.test(token)) return 6
    const name = token.replace(/^\[|\]$/g, '')
    if (/[\u3400-\u9fff]/u.test(name)) return 5
    if (/^[a-z][a-z -]{0,24}$/i.test(name)) return 4
    if (/^(?:\d{6,}|[a-f\d]{12,}|[a-z\d_-]{24,})$/i.test(name)) return 1
    return 3
  }

  function mergeEmojiAssetMetadata(target, source) {
    if (!target || !source) return target
    const sourceToken = normalizedEmojiToken(source.token, 'emoji')
    if (sourceToken && emojiTokenQuality(sourceToken) > emojiTokenQuality(target.token)) {
      target.token = sourceToken
    }
    if (!target.src && source.src) target.src = source.src
    target.keys = Array.from(
      new Set([...(Array.isArray(target.keys) ? target.keys : []), ...(source.keys || [])]),
    ).slice(0, 48)
    return target
  }

  function enrichRichPayloadAsset(payload, assetIndex, item) {
    const source = assetDescriptorFromElement(item)
    const asset = payload && Array.isArray(payload.assets) ? payload.assets[assetIndex] : null
    if (!source || !asset) return
    mergeEmojiAssetMetadata(asset, source)
    const emojiParts = Array.isArray(payload.parts)
      ? payload.parts.filter((part) => part && part.type === 'emoji' && part.asset)
      : []
    if (emojiParts[assetIndex]) {
      mergeEmojiAssetMetadata(emojiParts[assetIndex].asset, source)
    }
  }

  function refreshRichPayloadText(payload) {
    if (!payload || !Array.isArray(payload.assets) || !payload.assets.length) return ''
    const parts = Array.isArray(payload.parts) ? payload.parts : []
    let unresolvedEmoji = false
    const resolvedText = parts.length
      ? parts
          .map((part) => {
            if (!part || typeof part !== 'object') return ''
            if (part.type === 'text') return String(part.text || '')
            if (part.type === 'emoji' && part.asset) {
              const token = normalizedEmojiToken(part.asset.token, 'emoji')
              if (!token) unresolvedEmoji = true
              return token
            }
            return ''
          })
          .join('')
      : payload.assets
          .map((asset) => {
            const token = normalizedEmojiToken(asset && asset.token, 'emoji')
            if (!token) unresolvedEmoji = true
            return token
          })
          .join('')
    if (unresolvedEmoji) return payload.text || ''
    const normalized = shared.parseMessageText(resolvedText, config.maxLength)
    if (shared.isPlausibleMessage(normalized, config.maxLength)) {
      payload.text = normalized
    }
    return payload.text || ''
  }

  async function enrichRichPayloadAssetNames(payload, options) {
    if (!payload || !Array.isArray(payload.assets) || !payload.assets.length) return payload
    const resolveBilibiliNative = Boolean(options && options.resolveBilibiliNative)
    if (
      platformId === 'bilibili' &&
      resolveBilibiliNative &&
      bilibiliAutoRecognizedEmojiText(payload)
    ) {
      // A reliable ordinary bracket name is already lossless through
      // Bilibili's official editor. Do not open the Emoji panel or attach a
      // synthetic native-panel identity while preparing a hover/favorite.
      refreshRichPayloadText(payload)
      return payload
    }
    let resolvedSingleBilibiliItem = null
    const input = platformId === 'bilibili' ? findBilibiliEmojiEditor() || findInput() : findInput()
    for (let index = 0; index < payload.assets.length; index += 1) {
      const asset = payload.assets[index]
      const shouldResolveNative =
        platformId === 'bilibili' && resolveBilibiliNative && !isBilibiliNativePanelAsset(asset)
      if (emojiTokenQuality(asset && asset.token) >= 3 && !shouldResolveNative) continue
      let item = findUniqueBilibiliPlatformEmoji(asset, fullscreenActive())
      if (!item && input) {
        item = await openUniqueBilibiliPlatformEmoji(input, asset)
      }
      if (item) {
        enrichRichPayloadAsset(payload, index, item)
        if (platformId === 'bilibili' && payload.assets.length === 1) {
          resolvedSingleBilibiliItem = item
        }
      }
    }
    refreshRichPayloadText(payload)
    if (
      resolveBilibiliNative &&
      resolvedSingleBilibiliItem &&
      bilibiliFavoriteImagePayload(payload) &&
      !payload.assets.some(isBilibiliNativePanelAsset)
    ) {
      // Some fullscreen-rendered image Emoji and current Bilibili panel items
      // expose only an image URL plus a bracketed display name. Finding one
      // unique official item is still authoritative: force this single-image
      // payload through that item instead of submitting "[name]" as text.
      markBilibiliPayloadAsNativePanel(payload, resolvedSingleBilibiliItem)
    }
    return payload
  }

  function richTextFromElement(element) {
    const removals = [
      'button',
      'svg',
      "[aria-hidden='true']",
      '[data-bcp-one-owned]',
      ...config.userNames,
    ]
    return serializedTextFromElement(element, {
      imageTokens: true,
      rejectRoot: true,
      removals,
    })
  }

  function textFromCandidate(candidate) {
    const specific = textFromSpecificElement(candidate)
    if (specific) {
      return specific
    }

    const removals = [
      'button',
      'svg',
      'img',
      "[aria-hidden='true']",
      '[data-bcp-one-owned]',
      ...config.userNames,
    ]

    return serializedTextFromElement(candidate, {
      imageTokens: false,
      rejectRoot: false,
      removals,
    })
  }

  const SENDER_VALUE_ATTRIBUTES = [
    'data-username',
    'data-user-name',
    'data-uname',
    'data-name',
    'data-display-name',
    'data-nickname',
    'data-nick-name',
    'data-sender-name',
    'data-author-name',
    'data-display-id',
    'data-user-id',
    'data-uid',
  ]
  const SENDER_RECORD_ATTRIBUTES = [
    'data-user',
    'data-user-info',
    'data-user-data',
    'data-author',
    'data-sender',
    'data-profile',
  ]
  const MESSAGE_ID_ATTRIBUTES = [
    'data-id_str',
    'data-id-str',
    'data-message-id',
    'data-msg-id',
    'data-item-id',
    'data-chatid',
    'data-comment-uuid',
    'data-cid',
    'data-id',
  ]

  function senderFromRecordAttribute(element, attribute) {
    const raw = String(element.getAttribute(attribute) || '').trim()
    if (!raw) return ''
    const candidates = [raw]
    try {
      const decoded = decodeURIComponent(raw)
      if (decoded !== raw) candidates.push(decoded)
    } catch {
      // Some site-internal metadata deliberately contains bare percent signs.
    }
    for (const candidate of candidates) {
      try {
        const record = JSON.parse(candidate)
        const sender =
          shared.extractSenderFromRecord(record) || shared.extractSenderFromRecord({ user: record })
        if (sender) return sender
      } catch {
        const sender = shared.normalizeSenderName(candidate)
        if (sender && !candidate.startsWith('{') && !candidate.startsWith('[')) return sender
      }
    }
    return ''
  }

  function senderFromElement(element) {
    if (!(element instanceof Element)) {
      return ''
    }

    for (const selector of config.userNames) {
      let nameElement = null
      try {
        nameElement = element.matches(selector) ? element : element.querySelector(selector)
      } catch {
        nameElement = null
      }
      if (!nameElement) {
        continue
      }
      const values = [
        nameElement.textContent,
        nameElement.getAttribute('aria-label'),
        nameElement.getAttribute('title'),
        ...SENDER_VALUE_ATTRIBUTES.map((attribute) => nameElement.getAttribute(attribute)),
      ]
      for (const value of values) {
        const sender = shared.normalizeSenderName(value)
        if (sender) {
          return sender
        }
      }
      for (const attribute of SENDER_RECORD_ATTRIBUTES) {
        const sender = senderFromRecordAttribute(nameElement, attribute)
        if (sender) return sender
      }
    }

    for (const attribute of SENDER_VALUE_ATTRIBUTES) {
      const sender = shared.normalizeSenderName(element.getAttribute(attribute))
      if (sender) {
        return sender
      }
    }
    for (const attribute of SENDER_RECORD_ATTRIBUTES) {
      const sender = senderFromRecordAttribute(element, attribute)
      if (sender) return sender
    }
    const rowText = shared.normalizeWhitespace(element.innerText || element.textContent)
    const prefix = rowText.match(/^([^：:\n]{1,64})[：:]\s*/u)
    return shared.normalizeSenderName(prefix && prefix[1])
  }

  function messageIdsFromElement(element) {
    if (!(element instanceof Element)) return []
    const ids = new Set()
    const elementId = String(element.id || '').trim()
    if (elementId && elementId.length <= 160) ids.add(elementId)
    for (const current of [
      element,
      ...Array.from(
        element.querySelectorAll(
          '[data-id_str],[data-id-str],[data-message-id],[data-msg-id],[data-item-id],[data-chatid],[data-comment-uuid],[data-cid],[data-id]',
        ),
      ).slice(0, 8),
    ]) {
      const currentId = String(current.id || '').trim()
      if (currentId && currentId.length <= 160) ids.add(currentId)
      for (const attribute of MESSAGE_ID_ATTRIBUTES) {
        const value = String(current.getAttribute(attribute) || '').trim()
        if (value && value.length <= 160) ids.add(value)
      }
    }
    return Array.from(ids)
  }

  function replyMessageValues(message, richPayload) {
    return [
      message,
      richPayload && richPayload.text,
      shared.parseMessageText(message, config.maxLength),
    ].filter(Boolean)
  }

  function senderFromChatContext(candidate) {
    let current = candidate instanceof Element ? candidate : null
    let boundary = current
    let boundaryCursor = current
    for (let depth = 0; boundaryCursor && depth < 5; depth += 1) {
      // Some platforms put a message id on the content span and also match the
      // surrounding row. Use the outermost matching message node, stopping
      // before the whole chat list, so row-local usernames remain available.
      if (matchesAny(boundaryCursor, config.messages)) boundary = boundaryCursor
      if (matchesAny(boundaryCursor, config.chatRoots)) break
      boundaryCursor = boundaryCursor.parentElement
    }
    for (let depth = 0; current && depth < 5; depth += 1) {
      // Read the sender from the current element before stopping the upward
      // walk: rows can match a chat-root selector (e.g. a broad class match)
      // and would otherwise short-circuit without ever extracting a sender.
      const sender = senderFromElement(current)
      if (sender) return sender
      // Never walk from a senderless message row into the whole chat list: a
      // descendant query on that container would return an unrelated user's
      // name. Broad platform selectors can make the row itself a chat root,
      // so the concrete message row remains the authoritative boundary.
      if (current === boundary) break
      current = current.parentElement
    }
    return ''
  }

  function scanSenderCache() {
    if (state.senderScanTimer) {
      clearTimeout(state.senderScanTimer)
      state.senderScanTimer = 0
    }
    const now = Date.now()
    state.senderLastScanAt = now
    const rows = messageRows().slice(-160)
    rows.forEach((row, index) => {
      if (isOwned(row) || isBilibiliChatAdvertisement(row)) return
      const richPayload = richPayloadFromCandidate(row)
      const message = (richPayload && richPayload.text) || textFromCandidate(row)
      const sender = senderFromChatContext(row)
      if (!sender || !shared.isPlausibleMessage(message, config.maxLength)) return
      state.senderCorrelation.remember(replyMessageValues(message, richPayload), sender, {
        ids: messageIdsFromElement(row),
        observedAt: now - (rows.length - index) * 8,
        now,
      })
    })
    markDouyuOwnMessages()
  }

  function currentDouyuUserName() {
    if (platformId !== 'douyu') return ''
    const candidates = queryAllDeep([
      '.FansMedalEnter-enterName',
      '.ChatSpeak .FansMedalPanel-enter',
      "[class*='FansMedalEnter-enterName']",
    ])
    for (const candidate of candidates) {
      const name = shared.normalizeSenderName(
        candidate.textContent || candidate.getAttribute('title'),
      )
      if (name) return name
    }
    return ''
  }

  function douyuNativeCapsuleBoundary(element) {
    let boundary = element
    for (let depth = 0; depth < 6; depth += 1) {
      const parent = boundary.parentElement
      if (!parent || parent === document.body || parent === document.documentElement) {
        break
      }
      boundary = parent
      if (boundary.matches("[class*='danmuItem-']")) break
    }
    return boundary
  }

  function scanDouyuNativeDanmakuCapsules() {
    if (platformId !== 'douyu') return

    if (!shouldHideNativeDanmakuCapsule(state.settings, platformId)) {
      state.douyuNativeCapsuleVisibility.showAll()
      state.douyuNativeCapsuleMutationRoots.clear()
      return
    }

    state.douyuNativeCapsuleVisibility.releaseDisconnected()
    state.douyuNativeCapsuleVisibility.reinforce()
    const actionElements = queryAllDeep(DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS).filter(
      (element) => !isOwned(element),
    )
    const roots = new Set(
      queryAllDeep(config.overlayMessages)
        .slice(-160)
        .map((element) => element.closest("[class*='danmuItem-']") || element)
        .filter((element) => !isOwned(element)),
    )
    actionElements.forEach((action) => {
      roots.add(douyuNativeCapsuleBoundary(action))
    })
    state.douyuNativeCapsuleMutationRoots.forEach((root) => {
      if (root.isConnected && !isOwned(root)) roots.add(root)
    })
    state.douyuNativeCapsuleMutationRoots.clear()

    const activeTargets = new Set()
    actionElements.forEach((target) => activeTargets.add(target))
    queryAllDeep(DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTORS)
      .filter((element) => !isOwned(element))
      .forEach((target) => activeTargets.add(target))
    queryAllDeep(DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS)
      .filter((element) => !isOwned(element))
      .forEach((target) => activeTargets.add(target))
    roots.forEach((root) => {
      findDouyuNativeDanmakuCapsuleTargets(root).forEach((target) => {
        if (!isOwned(target)) activeTargets.add(target)
      })
    })
    state.douyuNativeCapsuleVisibility.hide(activeTargets)
  }

  function mutationContainsDouyuNativeDanmakuCapsule(mutation) {
    if (platformId !== 'douyu') return false

    if (mutation.type === 'attributes') {
      const element = mutation.target instanceof Element ? mutation.target : null
      if (!element || isOwned(element) || element.closest("[class*='danmuItem-']")) return false

      // The moving danmaku rows update their style continuously. Looking
      // through every mutated row for action descendants turned each animation
      // frame into a full native-capsule scan. Attribute changes only matter
      // when they occur on the detached capsule itself; child-list mutations
      // below still discover newly mounted capsule trees.
      try {
        const detachedDecoration = element.matches(
          DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTOR,
        )
        const action = element.matches(DOUYU_NATIVE_DANMAKU_ACTION_SELECTOR)
        const container = element.matches(DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTOR)
        if (!detachedDecoration && !action && !container) return false
        state.douyuNativeCapsuleMutationRoots.add(
          detachedDecoration
            ? element.parentElement || element
            : container
              ? element
              : douyuNativeCapsuleBoundary(element),
        )
        return true
      } catch {
        return false
      }
    }

    const elements = []
    if (mutation.target instanceof Element) elements.push(mutation.target)
    Array.from(mutation.addedNodes || []).forEach((node) => {
      if (node instanceof Element) elements.push(node)
    })

    let found = false
    elements.forEach((element) => {
      if (isOwned(element)) return
      try {
        const detachedDecoration = element.matches(
          DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTOR,
        )
          ? element
          : element.querySelector(DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTOR)
        if (detachedDecoration) {
          state.douyuNativeCapsuleMutationRoots.add(
            detachedDecoration.parentElement || detachedDecoration,
          )
          found = true
          return
        }
        const action = element.matches(DOUYU_NATIVE_DANMAKU_ACTION_SELECTOR)
          ? element
          : element.querySelector(DOUYU_NATIVE_DANMAKU_ACTION_SELECTOR)
        const container = element.matches(DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTOR)
          ? element
          : element.querySelector(DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTOR)
        if (action || container) {
          state.douyuNativeCapsuleMutationRoots.add(container || douyuNativeCapsuleBoundary(action))
          found = true
          return
        }
      } catch {
        // Fall through to the text-label detector for future Douyu variants.
      }

      const text = String(element.textContent || '').replace(/\s+/gu, '')
      if (
        text &&
        text.length <= 120 &&
        ['+1', '回复', '收藏'].filter((label) => text.includes(label)).length >= 2
      ) {
        state.douyuNativeCapsuleMutationRoots.add(douyuNativeCapsuleBoundary(element))
        found = true
      }
    })
    return found
  }

  function markDouyuOwnMessages() {
    if (platformId !== 'douyu') return
    const ownName = currentDouyuUserName()
    if (!ownName) return

    queryAllDeep(config.messages)
      .slice(-240)
      .forEach((row) => {
        if (isOwned(row)) return
        const own = senderFromChatContext(row) === ownName
        if (own) row.setAttribute('data-bcp-douyu-own-chat', 'true')
        else row.removeAttribute('data-bcp-douyu-own-chat')
        const content = messageElementFromCandidate(row)
        if (content && own) content.setAttribute('data-bcp-douyu-own-chat-content', 'true')
        else if (content) content.removeAttribute('data-bcp-douyu-own-chat-content')
      })

    queryAllDeep(config.overlayMessages)
      .slice(-120)
      .forEach((message) => {
        if (isOwned(message)) return
        if (senderFromElement(message) === ownName) {
          message.setAttribute('data-bcp-douyu-own-overlay', 'true')
        } else {
          message.removeAttribute('data-bcp-douyu-own-overlay')
        }
      })
  }

  function scheduleSenderCacheScan(delay) {
    if (state.senderScanTimer) return
    const requestedDelay = Math.max(0, Number(delay) || 0)
    const elapsed = Date.now() - state.senderLastScanAt
    const throttledDelay = Math.max(requestedDelay, SENDER_SCAN_MIN_INTERVAL - elapsed)
    state.senderScanTimer = setTimeout(scanSenderCache, throttledDelay)
  }

  function senderFromMatchingChatRow(message, observedAt) {
    const rows = messageRows().slice(-160)
    const expectedValues = replyMessageValues(message, null)
    rows.forEach((row, index) => {
      if (isOwned(row) || isBilibiliChatAdvertisement(row)) {
        return
      }
      const richPayload = richPayloadFromCandidate(row)
      const rowMessage = (richPayload && richPayload.text) || textFromCandidate(row)
      const sender = senderFromChatContext(row)
      if (!sender) return
      state.senderCorrelation.remember(replyMessageValues(rowMessage, richPayload), sender, {
        ids: messageIdsFromElement(row),
        observedAt: Date.now() - (rows.length - index) * 8,
      })
    })
    return state.senderCorrelation.resolve(expectedValues, { observedAt })
  }

  function senderFromCandidate(candidate, message, kind, observedAt, options) {
    const scanDom = !options || options.scanDom !== false
    const direct = kind === 'chat' ? senderFromChatContext(candidate) : senderFromElement(candidate)
    const values = replyMessageValues(message, state.richPayload)
    const ids = messageIdsFromElement(candidate)
    if (direct) {
      state.senderCorrelation.remember(values, direct, {
        ids,
        observedAt: observedAt || Date.now(),
      })
      return direct
    }
    if (kind === 'overlay' && scanDom) {
      const matching = senderFromMatchingChatRow(message, observedAt)
      if (matching) return matching
    } else if (kind !== 'overlay' && scanDom) {
      scanSenderCache()
    }
    return state.senderCorrelation.resolve(values, { ids, observedAt })
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null
  }

  function fullscreenActive() {
    if (fullscreenElement()) {
      return true
    }
    try {
      const topDocument = window.top && window.top.document
      return Boolean(
        topDocument && (topDocument.fullscreenElement || topDocument.webkitFullscreenElement),
      )
    } catch {
      // Cross-origin player frames cannot inspect their parent document. A
      // viewport-sized player root is the safest remaining fullscreen signal.
    }
    return queryAllDeep(config.videoRoots).some((root) => {
      if (!isVisible(root)) return false
      const rect = root.getBoundingClientRect()
      return rect.width >= innerWidth * 0.9 && rect.height >= innerHeight * 0.85
    })
  }

  function ensurePortal() {
    const host = fullscreenElement() || document.documentElement
    if (!state.ui) {
      state.ui = createContentOverlay({
        onCopy: onCopyActionClick,
        onFavorite: onFavoriteActionClick,
        onPlaceholder: onPlaceholderActionClick,
        onPlusOne: onPlusOneClick,
        onPointerEnter: cancelHide,
        onPointerLeave: scheduleHide,
      })
      state.portal = state.ui.portal
    }
    return state.ui.ensureHost(host)
  }

  function ensureButton() {
    ensurePortal()
    renderActionBar()
    state.actionBar = state.ui.actionBar()
    state.button = state.ui.plusOneButton()
    return state.button
  }

  function onPlaceholderActionClick(event, action) {
    event.preventDefault()
    event.stopPropagation()
    cancelHide()
    if (action === 'reply') {
      void prepareReply().catch((error) => {
        console.warn('[Danmaku Echo] reply preparation failed', {
          platform: platformId,
          reason: error instanceof Error ? error.message : String(error),
        })
        showToast(t('toastSenderUnknown'), 'error')
      })
    }
  }

  async function onCopyActionClick(event) {
    event.preventDefault()
    event.stopPropagation()
    cancelHide()
    const candidate = state.candidate
    if (
      !visibleActionsForSurface(state.settings, platformId, state.candidateKind).copy ||
      !state.message
    ) {
      return
    }
    ensureSelectedOverlayHydrated()
    if (candidate !== state.candidate) return
    const copied = await copyTextToClipboard(state.message)
    showToast(
      t(copied ? 'toastDanmakuCopied' : 'toastDanmakuCopyFailed'),
      copied ? 'success' : 'error',
    )
  }

  async function onFavoriteActionClick(event) {
    event.preventDefault()
    event.stopPropagation()
    cancelHide()
    const candidate = state.candidate
    if (
      !visibleActionsForSurface(state.settings, platformId, state.candidateKind).favorite ||
      !state.message ||
      !state.favoritesRuntime
    ) {
      return
    }
    ensureSelectedOverlayHydrated()
    if (candidate !== state.candidate) return
    let message = state.message
    const payload = state.richPayload
    if (payload && payload.assets && payload.assets.length) {
      if (platformId === 'bilibili') {
        bilibiliCompleteEmojiTokens(payload)
      }
      await enrichRichPayloadAssetNames(payload, { resolveBilibiliNative: true })
      const favoritePayload =
        platformId === 'bilibili' ? bilibiliFavoriteImagePayload(payload) || payload : payload
      if (shared.isPlausibleMessage(favoritePayload.text, config.maxLength)) {
        message = favoritePayload.text
        if (payload === state.richPayload) {
          state.message = message
        }
      }
      await state.favoritesRuntime.favoriteText(message, favoritePayload)
      return
    }
    await state.favoritesRuntime.favoriteText(message, payload)
  }

  function renderActionBar() {
    if (state.ui) {
      state.ui.setActions(visibleActionsForSurface(state.settings, platformId, state.candidateKind))
    }
  }

  function cancelOverlayHydration() {
    if (state.overlayHydrationTimer) {
      clearTimeout(state.overlayHydrationTimer)
      state.overlayHydrationTimer = 0
    }
    state.overlayHydrationId += 1
    state.overlayHydratedId = -1
  }

  function hydrateSelectedOverlay(selectionId) {
    if (
      state.candidateKind !== 'overlay' ||
      !(state.candidate instanceof Element) ||
      selectionId !== state.overlayHydrationId
    ) {
      return false
    }
    if (state.overlayHydratedId === selectionId) return true

    const candidate = state.candidate
    const selectedAt = state.selectedAt
    const hydrationStartedAt = performance.now()
    const richPayload = richPayloadFromCandidate(candidate)
    const message = (richPayload && richPayload.text) || overlayMessageForValidation(candidate)
    if (
      selectionId !== state.overlayHydrationId ||
      candidate !== state.candidate ||
      state.candidateKind !== 'overlay'
    ) {
      return false
    }

    state.richPayload = richPayload
    if (shared.isPlausibleMessage(message, config.maxLength)) {
      state.message = message
    }
    state.sender = senderFromCandidate(candidate, state.message, 'overlay', selectedAt, {
      scanDom: false,
    })
    state.overlayHydratedId = selectionId
    if (state.ui) {
      state.ui.showActionBar(state.message, state.sender)
      state.ui.setCooldown(state.sendProtection.remainingMs(state.message))
      requestAnimationFrame(updateButtonPosition)
    }
    diagnostics.record({
      type: 'candidate.hydrated',
      stage: 'overlay',
      durationMs: performance.now() - hydrationStartedAt,
      outcome: 'success',
    })
    return true
  }

  function scheduleOverlayHydration(selectionId) {
    state.overlayHydrationTimer = setTimeout(() => {
      state.overlayHydrationTimer = 0
      hydrateSelectedOverlay(selectionId)
    }, OVERLAY_HYDRATION_DELAY)
  }

  function ensureSelectedOverlayHydrated() {
    if (state.candidateKind !== 'overlay') return true
    if (state.overlayHydrationTimer) {
      clearTimeout(state.overlayHydrationTimer)
      state.overlayHydrationTimer = 0
    }
    return hydrateSelectedOverlay(state.overlayHydrationId)
  }

  function restoreInlineStyleProperty(element, property, saved) {
    if (!(element instanceof HTMLElement) || !saved) return
    if (saved.value) {
      element.style.setProperty(property, saved.value, saved.priority)
    } else {
      element.style.removeProperty(property)
    }
  }

  function resumeOverlayAnimations(pausedAnimations) {
    for (const item of pausedAnimations || []) {
      if (!item.shouldResume) continue
      try {
        item.animation.play()
      } catch {
        // Ignore animations removed by the site's danmaku renderer.
      }
    }
  }

  function freezeOverlayCandidate(candidate) {
    if (platformId === 'douyu' && candidate instanceof HTMLElement) {
      // Native entry does not always pause before the moving row leaves the
      // pointer. Stop the current row immediately, but never resume it here;
      // Douyu's native leave chain remains the only resume owner.
      douyuNativeMotionFallback?.pause(candidate)
      state.pausedAnimations = []
      return
    }

    if (platformId === 'bilibili' && candidate instanceof HTMLElement) {
      // Bilibili's current `roll` animation is not reliably returned by
      // getAnimations({ subtree: true }). Pausing that incomplete list leaves
      // the hidden original moving behind the fixed snapshot, so revealing it
      // later looks like a jump or a backward/forward twitch. A CSS pause
      // marker covers the renderer-owned animation without rewriting its
      // currentTime, startTime, transform or inline animation declaration.
      bilibiliOverlayMotion?.pause(candidate)
      state.pausedAnimations = []
    } else {
      state.pausedAnimations =
        typeof candidate.getAnimations === 'function'
          ? candidate.getAnimations({ subtree: true }).map((animation) => ({
              animation,
              shouldResume: animation.playState === 'running',
            }))
          : []
    }

    for (const item of state.pausedAnimations) {
      try {
        item.animation.pause()
      } catch {
        // The site may discard an animation between discovery and pausing.
      }
    }

    const rect = candidate.getBoundingClientRect()
    // Never deep-clone live-site DOM here. Huya advertisements can contain
    // custom elements or clonable shadow roots that initialize a new media
    // pipeline during a deep DOM clone, before media descendants can be removed.
    const snapshot = createInertOverlaySnapshot(candidate, {
      nodeLimit: OVERLAY_SNAPSHOT_NODE_LIMIT,
      skipSelector: INERT_SNAPSHOT_SKIP_SELECTOR,
    })
    snapshot.classList.add('bcp-one-frozen', 'bcp-one-target')
    snapshot.dataset.bcpOneOwned = 'true'

    snapshot.style.setProperty('position', 'fixed', 'important')
    snapshot.style.setProperty('box-sizing', 'border-box', 'important')
    snapshot.style.setProperty('left', `${rect.left}px`, 'important')
    snapshot.style.setProperty('top', `${rect.top}px`, 'important')
    snapshot.style.setProperty('right', 'auto', 'important')
    snapshot.style.setProperty('bottom', 'auto', 'important')
    snapshot.style.setProperty('width', `${rect.width}px`, 'important')
    snapshot.style.setProperty('height', `${rect.height}px`, 'important')
    snapshot.style.setProperty('margin', '0', 'important')
    snapshot.style.setProperty('transform', 'none', 'important')
    snapshot.style.setProperty('animation', 'none', 'important')
    snapshot.style.setProperty('transition', 'none', 'important')
    snapshot.style.setProperty('visibility', 'visible', 'important')
    snapshot.style.setProperty('pointer-events', 'none', 'important')
    snapshot.style.setProperty('z-index', '2147483646', 'important')

    const overlayViewport = state.overlayViewport || overlayViewportRect(candidate)
    if (overlayViewport) {
      const clip = clipInsetsWithinRect(rect, overlayViewport)
      // clip-path also clips outlines painted outside the element. Apply it
      // only when the danmaku content really crosses a player edge; ordinary
      // in-player hovers must retain the normal selection outline.
      if (Object.values(clip).some((value) => value > 0)) {
        snapshot.dataset.bcpOneEdgeClipped = 'true'
        snapshot.style.setProperty(
          'clip-path',
          `inset(${clip.top}px ${clip.right}px ${clip.bottom}px ${clip.left}px)`,
          'important',
        )
      }
    }

    state.originalVisibility = {
      value: candidate.style.getPropertyValue('visibility'),
      priority: candidate.style.getPropertyPriority('visibility'),
    }

    candidate.style.setProperty('visibility', 'hidden', 'important')
    ensurePortal().appendChild(snapshot)
    state.frozenClone = snapshot
  }

  function unfreezeOverlayCandidate() {
    const frozenClone = state.frozenClone
    const candidate = state.candidate
    const originalVisibility = state.originalVisibility
    const pausedAnimations = state.pausedAnimations
    state.frozenClone = null
    state.originalVisibility = null
    state.pausedAnimations = []

    if (!frozenClone) {
      resumeOverlayAnimations(pausedAnimations)
      bilibiliOverlayMotion?.release(candidate instanceof HTMLElement ? candidate : null)
      return
    }

    if (candidate?.isConnected && originalVisibility) {
      restoreInlineStyleProperty(candidate, 'visibility', originalVisibility)
    }

    frozenClone.remove()
    resumeOverlayAnimations(pausedAnimations)
    // Reveal the paused original at the same viewport coordinate as the
    // snapshot, then let Bilibili continue its own timeline from that point.
    bilibiliOverlayMotion?.release(candidate instanceof HTMLElement ? candidate : null)
  }

  function removeOverlayHoverBridge() {
    state.hoverBridge?.remove()
    state.hoverBridge = null
  }

  function ensureOverlayHoverBridge(parent, position) {
    if (!(parent instanceof HTMLElement)) return null
    let bridge = state.hoverBridge
    if (
      !(bridge instanceof HTMLElement) ||
      !bridge.isConnected ||
      bridge.parentElement !== parent
    ) {
      removeOverlayHoverBridge()
      bridge = document.createElement('div')
      bridge.className = 'bcp-one-hover-bridge'
      bridge.dataset.bcpOneOwned = 'true'
      bridge.setAttribute('aria-hidden', 'true')
      bridge.addEventListener('pointerenter', cancelHide)
      bridge.addEventListener('pointerleave', scheduleHide)
      parent.appendChild(bridge)
      state.hoverBridge = bridge
    }
    bridge.style.setProperty('position', position, 'important')
    return bridge
  }

  function setOverlayHoverBridgeRect(bridge, left, top, width, height) {
    if (!(bridge instanceof HTMLElement)) return
    bridge.style.setProperty('left', `${left}px`, 'important')
    bridge.style.setProperty('top', `${top}px`, 'important')
    bridge.style.setProperty('width', `${Math.max(1, width)}px`, 'important')
    bridge.style.setProperty('height', `${Math.max(1, height)}px`, 'important')
  }

  function showSelectedActionBar(candidate, message, sender) {
    if (state.candidate !== candidate) return false
    ensureButton()
    state.ui.showActionBar(message, sender)
    state.ui.setCooldown(state.sendProtection.remainingMs(message))
    requestAnimationFrame(() => {
      if (state.candidate === candidate) updateButtonPosition()
    })
    return true
  }

  function updateButtonPosition() {
    const positionTarget = state.frozenClone || state.candidate
    if (
      !positionTarget ||
      !state.actionBar ||
      state.actionBar.hidden ||
      !positionTarget.isConnected
    ) {
      return
    }

    const rect = positionTarget.getBoundingClientRect()
    const buttonRect = state.actionBar.getBoundingClientRect()
    const browserViewport = {
      bottom: innerHeight,
      height: innerHeight,
      left: 0,
      right: innerWidth,
      top: 0,
      width: innerWidth,
    }
    const actionViewport =
      state.candidateKind === 'overlay' && state.candidate
        ? state.overlayViewport || overlayViewportRect(state.candidate) || browserViewport
        : browserViewport

    const placement = overlayCapsulePlacement({
      anchorLeft: rect.left,
      anchorRight: rect.right,
      capsuleWidth: buttonRect.width,
      viewportLeft: actionViewport.left,
      viewportRight: actionViewport.right,
    })
    const top = rect.top + (rect.height - buttonRect.height) / 2

    state.actionBar.dataset.bcpOverlaySide = placement.side
    const actionTop = clampBoxStart(
      top,
      buttonRect.height,
      actionViewport.top,
      actionViewport.bottom,
      8,
    )
    state.actionBar.style.left = `${placement.left}px`
    state.actionBar.style.top = `${actionTop}px`
    if (state.candidateKind === 'overlay' && state.portal instanceof HTMLElement) {
      const bridgeLeft = placement.side === 'right' ? rect.right : placement.left + buttonRect.width
      const bridgeRight = placement.side === 'right' ? placement.left : rect.left
      const bridgeTop = Math.min(rect.top, actionTop)
      const bridgeBottom = Math.max(rect.bottom, actionTop + buttonRect.height)
      // Mount beside the Vue portal rather than inside its managed children;
      // later action-label/cooldown renders must not discard the hit bridge.
      const bridgeHost = state.portal.parentElement || document.documentElement
      const bridge = ensureOverlayHoverBridge(bridgeHost, 'fixed')
      setOverlayHoverBridgeRect(
        bridge,
        bridgeLeft,
        bridgeTop,
        bridgeRight - bridgeLeft,
        bridgeBottom - bridgeTop,
      )
    }
  }

  function selectCandidate(candidate, kind, allowNoVisibleActions, pointer, nativeTarget = null) {
    const selectionStartedAt = performance.now()
    // Overlay candidates have already passed the platform-specific validation
    // in findCandidate/findOverlayAtPoint. Repeating it here forced another
    // visibility check, media scan, layout read and message parse in the same
    // pointer frame.
    if (
      kind === 'overlay' &&
      (!(candidate instanceof Element) || isOwned(candidate) || !candidate.isConnected)
    ) {
      return false
    }
    if (
      platformId === 'douyu' &&
      kind === 'overlay' &&
      (!(nativeTarget instanceof Node) ||
        !candidate.contains(nativeTarget) ||
        isOwned(nativeTarget))
    ) {
      // Douyu moves danmaku by writing transform every frame. A geometric hit
      // without a real event target inside the native row cannot activate the
      // site's pause state and must not create a travelling capsule.
      return false
    }
    const selectedOverlayViewport = kind === 'overlay' ? overlayViewportRect(candidate) : null
    if (
      kind === 'overlay' &&
      pointer &&
      !pointInsideRect(selectedOverlayViewport, pointer.x, pointer.y)
    ) {
      return false
    }
    if (kind !== 'overlay' && isBilibiliChatAdvertisement(candidate)) {
      return false
    }
    const candidateKind = kind || 'chat'
    const candidateActions = visibleActionsForSurface(state.settings, platformId, candidateKind)
    if (!allowNoVisibleActions && !Object.values(candidateActions).some(Boolean)) {
      return false
    }

    const richPayload = candidateKind === 'overlay' ? null : richPayloadFromCandidate(candidate)
    const message =
      candidateKind === 'overlay'
        ? overlayMessageForValidation(candidate)
        : (richPayload && richPayload.text) || textFromCandidate(candidate)
    if (!shared.isPlausibleMessage(message, config.maxLength)) {
      return false
    }
    cancelHide()
    clearSelection()
    state.candidate = candidate
    state.candidateKind = candidateKind
    if (platformId === 'douyu' && candidateKind === 'overlay' && candidate instanceof HTMLElement) {
      douyuNativeHover?.select(candidate, nativeTarget)
    } else {
      douyuNativeHover?.reset()
    }
    state.overlayViewport = selectedOverlayViewport
    if (pointer) {
      state.pointerX = pointer.x
      state.pointerY = pointer.y
    }
    state.message = message
    state.richPayload = richPayload
    state.selectedAt = Date.now()
    state.sender = ''
    const selectionId = state.overlayHydrationId
    candidate.classList.add('bcp-one-target')
    if (state.candidateKind === 'overlay') {
      freezeOverlayCandidate(candidate)
    }
    // Direct sender metadata and the correlation cache are bounded lookups.
    // Resolve them only after the moving danmaku is frozen so the reply target
    // is accurate from the first painted action bar without delaying the stop.
    state.sender = senderFromCandidate(candidate, message, state.candidateKind, state.selectedAt, {
      scanDom: false,
    })

    showSelectedActionBar(candidate, message, state.sender)
    if (state.candidateKind === 'overlay') {
      scheduleOverlayHydration(selectionId)
    }
    diagnostics.record({
      type: 'candidate.selected',
      stage: candidateKind,
      durationMs: performance.now() - selectionStartedAt,
      outcome: 'success',
    })
    return true
  }

  function clearSelection() {
    const douyuCandidate =
      platformId === 'douyu' &&
      state.candidateKind === 'overlay' &&
      state.candidate instanceof HTMLElement
        ? state.candidate
        : null
    cancelOverlayHydration()
    if (state.candidate && state.candidate.isConnected) {
      state.candidate.classList.remove('bcp-one-target')
    }

    unfreezeOverlayCandidate()
    removeOverlayHoverBridge()
    if (state.ui) state.ui.hideActionBar()
    if (douyuCandidate) {
      const released = douyuNativeHover?.release(douyuCandidate.parentElement, {
        x: state.pointerX,
        y: state.pointerY,
      })
      if (!released) douyuNativeHover?.reset()
    } else {
      douyuNativeHover?.reset()
    }
    douyuNativeMotionFallback?.release(douyuCandidate)
    state.candidate = null
    state.candidateKind = null
    state.overlayViewport = null
    state.message = ''
    state.sender = ''
    state.selectedAt = 0
    state.richPayload = null
  }

  function cancelHide() {
    if (state.hideTimer) {
      clearTimeout(state.hideTimer)
      state.hideTimer = 0
    }
  }

  function scheduleHide(delay) {
    if (state.hideTimer) {
      return
    }
    const timeout = Number.isFinite(delay)
      ? delay
      : state.candidateKind === 'overlay'
        ? OVERLAY_LEAVE_DELAY
        : 180
    state.hideTimer = setTimeout(() => {
      state.hideTimer = 0
      clearSelection()
    }, timeout)
  }

  function showToast(message, kind) {
    ensurePortal()
    state.ui.showToast(message, kind || 'info')
  }

  function updateCooldownUi(message) {
    if (!state.ui) return
    const remainingMs = state.sendProtection.remainingMs(message)
    state.ui.setCooldown(remainingMs)
    if (remainingMs > 0 && !state.cooldownTimer) {
      state.cooldownTimer = setInterval(() => {
        const currentMessage = state.message || message
        const currentRemaining = state.sendProtection.remainingMs(currentMessage)
        if (state.ui) state.ui.setCooldown(currentRemaining)
        if (currentRemaining <= 0) {
          clearInterval(state.cooldownTimer)
          state.cooldownTimer = 0
        }
      }, 250)
    }
  }

  function showSendBlock(block, message) {
    const seconds = Math.max(1, Math.ceil(block.remainingMs / 1_000))
    if (block.reason === 'duplicate') {
      showToast(t('toastDuplicateCooldown', String(seconds)), 'warning')
    } else if (block.reason === 'in-flight') {
      showToast(t('toastSendInProgress'), 'warning')
    } else if (block.reason === 'cooldown') {
      showToast(t('toastSendCooldown', String(seconds)), 'warning')
    } else {
      showToast(t('toastAccidentalSendBlocked'), 'warning')
    }
    updateCooldownUi(message)
  }

  function beginProtectedSend(message) {
    const block = state.sendProtection.begin(message)
    if (!block.allowed) showSendBlock(block, message)
    return block.allowed
  }

  async function finishProtectedSend(message, success, feedbackProbe, networkObserver) {
    let feedback = await feedbackProbe.wait(
      success ? PLATFORM_SUCCESS_FEEDBACK_WAIT_MS : PLATFORM_FAILURE_FEEDBACK_WAIT_MS,
    )
    const networkResult = networkObserver ? await networkObserver.read(feedback ? 220 : 160) : null
    networkObserver?.cancel()
    const networkFeedback = networkResult && !networkResult.requestOnly
      ? classifyPlatformSendResponse(networkResult)
      : null
    if (feedback && networkResult) {
      feedback = {
        ...feedback,
        code: networkResult.code,
        endpoint: networkResult.endpoint,
        httpStatus: networkResult.httpStatus,
        method: networkResult.method,
        source: 'network',
        transport: networkResult.transport,
      }
    } else if (!feedback && networkFeedback) {
      feedback = networkFeedback
    }
    if (feedback) {
      state.sendProtection.applyPlatformFeedback(feedback, message)
      const seconds = Math.max(1, Math.ceil(feedback.cooldownMs / 1_000))
      showToast(
        feedback.cooldownMs > 0
          ? t('toastPlatformCooldown', [
              platformName,
              formatPlatformSendFeedback(feedback),
              String(seconds),
            ])
          : t('toastPlatformRejected', [platformName, formatPlatformSendFeedback(feedback)]),
        feedback.kind === 'rejected' ? 'error' : 'warning',
      )
      updateCooldownUi(message)
      return 'feedback'
    }
    const networkSummary = networkResult
      ? formatPlatformSendRequestSummary(networkResult)
      : ''
    if (!success && networkSummary) {
      state.sendProtection.finish(message, false)
      updateCooldownUi(message)
      showToast(t('toastPlatformSendUnconfirmed', [platformName, networkSummary]), 'error')
      return 'feedback'
    }
    state.sendProtection.finish(message, success)
    updateCooldownUi(message)
    return success
  }

  async function startPlatformSendObservation() {
    const randomBytes = new Uint32Array(4)
    crypto.getRandomValues(randomBytes)
    const nonce = `${Date.now().toString(36)}-${Array.from(randomBytes)
      .map((value) => value.toString(36))
      .join('-')}`
    let settled = false
    let resolveResult
    const result = new Promise((resolve) => {
      resolveResult = resolve
    })
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolveResult(value)
    }
    const onMessage = (event) => {
      if (event.source !== window || !isNativeSendObservation(event.data, nonce, platformId)) return
      finish(event.data)
    }
    const timer = window.setTimeout(() => finish(null), 8_500)
    window.addEventListener('message', onMessage)
    try {
      const installed = await chrome.runtime.sendMessage({
        nonce,
        platform: platformId,
        type: INSTALL_NATIVE_SEND_OBSERVER,
      })
      if (!installed?.ok) finish(null)
    } catch {
      finish(null)
    }
    return {
      cancel: () => finish(null),
      read: (timeout = 160) => Promise.race([
        result,
        new Promise((resolve) => setTimeout(() => resolve(null), Math.max(0, timeout))),
      ]),
    }
  }

  function inputSurfaceScore(element, index) {
    const fullscreen = fullscreenElement()
    const isFullscreen = fullscreenActive()
    const insideFullscreen = Boolean(
      fullscreen && (fullscreen === element || fullscreen.contains(element)),
    )
    const insideVideo = Boolean(closestMatching(element, config.videoRoots))
    const insideChat = Boolean(closestMatching(element, config.chatRoots))
    const quickInput = platformId === 'bilibili' && isBilibiliQuickInputRegion(element)
    let score = 1000 - index
    if (isFullscreen) {
      if (insideFullscreen) score += 1400
      if (insideVideo) score += 800
      if (quickInput) score += 900
      if (insideChat && !insideFullscreen) score -= 1200
    } else {
      if (insideChat) score += 700
      if (!insideVideo) score += 300
      if (insideVideo || quickInput) score -= 900
    }
    return score
  }

  function findInput(options) {
    const reply = Boolean(options && options.reply)
    const candidates = queryAllDeep(config.inputs)
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
    if (fullscreenActive()) {
      if (fullscreen) addEditors(fullscreen)
      queryAllDeep(config.videoRoots).forEach(addEditors)
    } else {
      queryAllDeep(config.chatRoots).forEach(addEditors)
    }
    const usable = candidates.filter((element) => {
      const disabled =
        element.matches(':disabled') ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('contenteditable') === 'false'
      return !disabled && element.isConnected && element.matches(TEXT_EDITOR_SELECTOR)
    })
    const visible = usable
      .filter((element) => isVisible(element))
      .map((element) => ({ element, index: candidates.indexOf(element) }))
      .sort(
        (left, right) =>
          inputSurfaceScore(right.element, right.index) -
          inputSurfaceScore(left.element, left.index),
      )
    if (reply && platformId === 'bilibili' && fullscreenActive()) {
      const fullscreenReplyInput = visible.find(
        ({ element }) =>
          isBilibiliQuickInputRegion(element) ||
          Boolean(closestMatching(element, config.videoRoots)) ||
          Boolean(fullscreen && (fullscreen === element || fullscreen.contains(element))),
      )
      return fullscreenReplyInput ? fullscreenReplyInput.element : null
    }
    if (visible.length) {
      return visible[0].element
    }

    // Native fullscreen only renders descendants of the fullscreen player.
    // Bilibili keeps its real chat input outside that subtree, but its event
    // handlers remain usable programmatically.
    if (!reply && platformId === 'bilibili' && fullscreenActive()) {
      return usable[0] || null
    }
    return null
  }

  function findBilibiliEmojiEditor() {
    if (platformId !== 'bilibili') return null
    const fullscreen = fullscreenElement()
    const candidates = queryAllDeep(config.inputs).filter((element) => {
      const disabled =
        element.matches(':disabled') ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('contenteditable') === 'false'
      const insideFullscreen = Boolean(
        fullscreen && (fullscreen === element || fullscreen.contains(element)),
      )
      return (
        !disabled &&
        element.isConnected &&
        element.matches(TEXT_EDITOR_SELECTOR) &&
        !insideFullscreen &&
        !isBilibiliQuickInputRegion(element)
      )
    })
    candidates.sort((first, second) => {
      const score = (element) =>
        (element.matches('textarea.chat-input,.chat-input-ctnr textarea,.chat-input') ? 1200 : 0) +
        (closestMatching(element, config.chatRoots) ? 600 : 0) +
        (isVisible(element) ? 120 : 0)
      return score(second) - score(first)
    })
    return candidates[0] || null
  }

  function activateBilibiliQuickInput() {
    if (platformId !== 'bilibili' || !fullscreenActive()) {
      return false
    }
    restoreBilibiliQuickBars(null, true)
    state.rootsCachedAt = 0
    const selectors = [
      ...BILIBILI_QUICK_BAR_SELECTORS,
      "[aria-expanded='false'][aria-label*='弹幕']",
      "[title*='弹幕输入']",
      "[data-testid*='danmaku'][role='button']",
      "[data-e2e*='danmaku'][role='button']",
    ]
    const candidates = queryAllDeep(selectors)
      .filter(
        (element) =>
          isVisible(element) &&
          Boolean(
            closestMatching(element, config.videoRoots) || fullscreenElement()?.contains(element),
          ),
      )
      .sort((left, right) => {
        const leftExpanded = left.getAttribute('aria-expanded') === 'false' ? 1 : 0
        const rightExpanded = right.getAttribute('aria-expanded') === 'false' ? 1 : 0
        return rightExpanded - leftExpanded
      })

    for (const candidate of candidates) {
      const nestedEditors = Array.from(candidate.querySelectorAll(TEXT_EDITOR_SELECTOR))
      if (
        candidate.matches(TEXT_EDITOR_SELECTOR) ||
        nestedEditors.some((editor) => isVisible(editor))
      ) {
        continue
      }
      const nestedActivator = Array.from(
        candidate.querySelectorAll("[aria-expanded='false'], button, [role='button']"),
      ).find((element) => isVisible(element))
      const clickTarget = nestedActivator || candidate
      const marker = shared.normalizeWhitespace(
        clickTarget.innerText || clickTarget.textContent || clickTarget.getAttribute('aria-label'),
      )
      if (clickTarget.matches("button, [role='button']") && /^(?:发送|send)$/i.test(marker)) {
        continue
      }
      if (typeof clickTarget.click === 'function') {
        clickTarget.click()
        return true
      }
    }
    return false
  }

  async function findReplyInput() {
    let input = findInput({ reply: true })
    if (input || platformId !== 'bilibili' || !fullscreenActive()) {
      return input
    }
    activateBilibiliQuickInput()
    for (const delay of [0, 40, 80, 140, 220, 360]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      state.rootsCachedAt = 0
      input = findInput({ reply: true })
      if (input) return input
    }
    return null
  }

  function setNativeValue(input, value) {
    const hiddenBilibiliFullscreen =
      platformId === 'bilibili' && fullscreenActive() && !isVisible(input)
    if (!hiddenBilibiliFullscreen) {
      input.focus({ preventScroll: true })
    }

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
      return
    }

    if (
      input.isContentEditable ||
      (input.hasAttribute('contenteditable') && input.getAttribute('contenteditable') !== 'false')
    ) {
      if (hiddenBilibiliFullscreen) {
        input.textContent = value
        input.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            composed: true,
            data: value,
            inputType: 'insertText',
          }),
        )
        return
      }

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
        document.execCommand('selectAll', false, null)
        inserted = document.execCommand('insertText', false, value)
      } catch {
        inserted = false
      }

      if (!inserted) {
        input.textContent = value
      }

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
      const editor = input.isConnected ? input : findInput({ reply: true })
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

  async function prepareReply() {
    if (
      !visibleActionsForSurface(state.settings, platformId, state.candidateKind).reply ||
      !state.candidate
    ) {
      return
    }
    const candidate = state.candidate
    ensureSelectedOverlayHydrated()
    if (candidate !== state.candidate) return
    const message = state.message
    const kind = state.candidateKind
    const observedAt = state.selectedAt
    let sender = state.sender
    for (let attempt = 0; !sender && attempt < REPLY_RESOLVE_ATTEMPTS; attempt += 1) {
      try {
        sender = senderFromCandidate(candidate, message, kind, observedAt, {
          scanDom: attempt === 0,
        })
      } catch (error) {
        console.warn('[Danmaku Echo] sender resolution failed', {
          attempt: attempt + 1,
          platform: platformId,
          reason: error instanceof Error ? error.message : String(error),
        })
        sender = ''
      }
      if (!sender && attempt + 1 < REPLY_RESOLVE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, REPLY_RESOLVE_INTERVAL))
      }
    }
    if (!sender) {
      showToast(t('toastSenderUnknown'), 'error')
      return
    }
    const input = await findReplyInput()
    if (!input) {
      showToast(t('toastEditorNotFound', platformName), 'error')
      return
    }
    const currentValue = inputText(input)
    const offsets = editorSelectionOffsets(input)
    const mention = `@${sender}`
    const insertionStart = offsets ? offsets.start : currentValue.length
    const nextValue = shared.replyDraftValue(
      currentValue,
      sender,
      offsets && offsets.start,
      offsets && offsets.end,
    )
    const caretOffset = nextValue !== currentValue ? insertionStart + mention.length : null
    setNativeValue(input, nextValue)
    clearSelection()
    focusReplyInput(input, nextValue, caretOffset)
  }

  function buttonScore(button, input, selectorIndex, scopeBonus) {
    const visible = isVisible(button)
    const allowHidden = platformId === 'bilibili' && fullscreenActive()
    if (
      (!visible && !allowHidden) ||
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

    if (!visible) {
      score -= 80
    }

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

    const addCandidate = (button, selectorIndex, scopeBonus) => {
      if (!seen.has(button)) {
        seen.add(button)
        candidates.push({ button, selectorIndex, scopeBonus })
      }
    }

    let parent = input.parentElement
    for (let depth = 0; parent && depth < 6; depth += 1, parent = parent.parentElement) {
      const nearby = parent.querySelectorAll(
        [
          'button',
          "[role='button']",
          "[data-e2e*='send' i]",
          "[data-testid*='send' i]",
          "[aria-label*='发送']",
          "[class*='send' i]",
        ].join(','),
      )
      for (const button of nearby) {
        addCandidate(button, config.sendButtons.length + 1, 360 - depth * 50)
      }
    }

    config.sendButtons.forEach((selector, selectorIndex) => {
      for (const button of queryAllDeep([selector])) {
        addCandidate(button, selectorIndex, 0)
      }
    })

    candidates.sort(
      (a, b) =>
        buttonScore(b.button, input, b.selectorIndex, b.scopeBonus) -
        buttonScore(a.button, input, a.selectorIndex, a.scopeBonus),
    )
    return candidates.length &&
      buttonScore(
        candidates[0].button,
        input,
        candidates[0].selectorIndex,
        candidates[0].scopeBonus,
      ) > -Infinity
      ? candidates[0].button
      : null
  }

  function inputStillContainsMessage(input, message) {
    if (!input || !input.isConnected) {
      return false
    }
    return shared.normalizeWhitespace(inputText(input)) === shared.normalizeWhitespace(message)
  }

  async function waitForInputConsumption(input, message, timeout) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (!inputStillContainsMessage(input, message)) {
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return !inputStillContainsMessage(input, message)
  }

  function releaseInputFocus(input) {
    const bilibiliDismissToken = platformId === 'bilibili' ? ++state.bilibiliDismissToken : 0
    const quickBarStyleProperties = ['display', 'visibility', 'opacity', 'pointer-events']
    const restorePlaybackState = (snapshots) => {
      for (const snapshot of snapshots) {
        if (!snapshot.video.isConnected) {
          continue
        }
        if (snapshot.paused && !snapshot.video.paused) {
          snapshot.video.pause()
        } else if (!snapshot.paused && snapshot.video.paused) {
          const playResult = snapshot.video.play()
          if (playResult && typeof playResult.catch === 'function') {
            playResult.catch(() => {})
          }
        }
      }
    }

    const forceHideBilibiliQuickBars = (quickEditors) => {
      for (const editor of quickEditors) {
        const player =
          fullscreenElement() ||
          closestMatching(editor, config.videoRoots) ||
          queryAllDeep(config.videoRoots).find((element) => isVisible(element))
        let container = editor.closest(BILIBILI_QUICK_BAR_SELECTORS.join(','))
        if (!container || container === editor) {
          container = editor.parentElement || editor
          const playerRect = player && player.getBoundingClientRect()
          let current = container
          for (let depth = 0; current && current !== player && depth < 5; depth += 1) {
            const rect = current.getBoundingClientRect()
            const widthLimit =
              playerRect && playerRect.width > 0
                ? playerRect.width * 0.9
                : Math.max(800, innerWidth * 0.8)
            if (rect.height <= 0 || rect.height > 120 || rect.width > widthLimit) {
              break
            }
            container = current
            current = current.parentElement
          }
        }
        if (state.hiddenBilibiliQuickBars.has(container)) {
          state.hiddenBilibiliQuickBars.get(container).hiddenAt = Date.now()
          container.style.setProperty('display', 'none', 'important')
          container.style.setProperty('visibility', 'hidden', 'important')
          container.style.setProperty('opacity', '0', 'important')
          container.style.setProperty('pointer-events', 'none', 'important')
          continue
        }
        state.hiddenBilibiliQuickBars.set(container, {
          styles: Object.fromEntries(
            quickBarStyleProperties.map((property) => [
              property,
              {
                value: container.style.getPropertyValue(property),
                priority: container.style.getPropertyPriority(property),
              },
            ]),
          ),
          hiddenAt: Date.now(),
        })
        container.style.setProperty('display', 'none', 'important')
        container.style.setProperty('visibility', 'hidden', 'important')
        container.style.setProperty('opacity', '0', 'important')
        container.style.setProperty('pointer-events', 'none', 'important')
      }
    }

    const dismissBilibiliQuickInput = () => {
      const player =
        fullscreenElement() ||
        closestMatching(input, config.videoRoots) ||
        queryAllDeep(config.videoRoots).find((element) => isVisible(element))
      const quickEditorSet = new Set(queryAllDeep(BILIBILI_QUICK_INPUTS))
      const addIfPlayerEditor = (editor) => {
        if (!(editor instanceof HTMLElement) || !editor.isConnected || !isVisible(editor)) {
          return
        }
        if (isBilibiliSideChatEditor(editor)) {
          return
        }
        const looksEditable = editor.matches(
          "input, textarea, [contenteditable]:not([contenteditable='false']), [role='textbox']",
        )
        if (!looksEditable) {
          return
        }
        const owner = closestMatching(editor, config.videoRoots)
        const playerRect = player && player.getBoundingClientRect()
        const playerCoversViewport = Boolean(
          playerRect &&
          playerRect.width >= innerWidth * 0.85 &&
          playerRect.height >= innerHeight * 0.75,
        )
        if (
          (player && player.contains(editor)) ||
          owner ||
          (editor === input && fullscreenActive() && playerCoversViewport)
        ) {
          quickEditorSet.add(editor)
        }
      }
      addIfPlayerEditor(input)
      addIfPlayerEditor(document.activeElement)
      if (player) {
        const playerRect = player.getBoundingClientRect()
        for (const editor of player.querySelectorAll(
          "input, textarea, [contenteditable='true'], [role='textbox']",
        )) {
          if (!isVisible(editor) || isBilibiliSideChatEditor(editor)) {
            continue
          }
          const rect = editor.getBoundingClientRect()
          if (
            rect.height >= 8 &&
            rect.height <= 100 &&
            rect.bottom >= playerRect.top + playerRect.height * 0.45
          ) {
            quickEditorSet.add(editor)
          }
        }
      }
      const quickEditors = Array.from(quickEditorSet).filter(
        (editor) => editor.isConnected && isVisible(editor),
      )
      if (!quickEditors.length) {
        return
      }

      const escapeInit = {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
        composed: true,
      }
      for (const editor of quickEditors) {
        editor.dispatchEvent(new KeyboardEvent('keydown', escapeInit))
        editor.dispatchEvent(new KeyboardEvent('keyup', escapeInit))
      }

      const playerRect = player && player.getBoundingClientRect()
      let outsideTarget =
        player &&
        player.querySelector(
          [
            '.bilibili-live-player-video-danmaku',
            '.bpx-player-video-wrap',
            '.bilibili-live-player-video-area',
            'video',
          ].join(','),
        )
      if (!outsideTarget && playerRect && playerRect.width > 0 && playerRect.height > 0) {
        outsideTarget = document.elementFromPoint(
          playerRect.left + playerRect.width / 2,
          playerRect.top + playerRect.height * 0.55,
        )
      }
      outsideTarget = outsideTarget || player || document.body || document.documentElement
      if (!outsideTarget) {
        forceHideBilibiliQuickBars(quickEditors)
        return
      }
      const videos = player
        ? Array.from(player.querySelectorAll('video')).map((video) => ({
            video,
            paused: video.paused,
          }))
        : []
      const pointerInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      }
      outsideTarget.dispatchEvent(new PointerEvent('pointerdown', pointerInit))
      outsideTarget.dispatchEvent(new MouseEvent('mousedown', pointerInit))
      outsideTarget.dispatchEvent(new PointerEvent('pointerup', pointerInit))
      outsideTarget.dispatchEvent(new MouseEvent('mouseup', pointerInit))
      outsideTarget.dispatchEvent(new MouseEvent('click', pointerInit))
      restorePlaybackState(videos)
      setTimeout(() => restorePlaybackState(videos), 80)
      setTimeout(() => {
        if (bilibiliDismissToken !== state.bilibiliDismissToken) {
          return
        }
        const stillVisible = quickEditors.filter(
          (editor) => editor.isConnected && isVisible(editor),
        )
        if (stillVisible.length) {
          forceHideBilibiliQuickBars(stillVisible)
        }
      }, 60)
    }

    const release = () => {
      if (platformId === 'bilibili' && bilibiliDismissToken !== state.bilibiliDismissToken) {
        return
      }

      const editors = new Set(input ? [input] : [])
      if (platformId === 'bilibili') {
        for (const editor of queryAllDeep(config.inputs)) {
          editors.add(editor)
        }
      }

      for (const editor of editors) {
        if (!editor || typeof editor.blur !== 'function') {
          continue
        }
        try {
          editor.blur()
        } catch {
          // Bilibili may replace its fullscreen editor during the send cycle.
        }
      }

      if (platformId === 'bilibili') {
        const active = document.activeElement
        const fullPlayer = fullscreenElement()
        if (
          active instanceof HTMLElement &&
          fullPlayer &&
          fullPlayer.contains(active) &&
          active.matches(
            "input, textarea, [contenteditable]:not([contenteditable='false']), [role='textbox']",
          )
        ) {
          active.blur()
        }
        dismissBilibiliQuickInput()
      }
    }

    release()
    if (platformId === 'bilibili') {
      // The fullscreen player focuses its quick editor again after its send
      // handler returns. Recheck across that short asynchronous focus cycle.
      ;[80, 200, 400, 700, 1100, 1600].forEach((delay) => setTimeout(release, delay))
    }
  }

  function platformEmojiItemCandidates(includeHidden = false) {
    const results = []
    const seen = new Set()
    const add = (element) => {
      if (
        !(element instanceof Element) ||
        seen.has(element) ||
        (!includeHidden && !isVisible(element)) ||
        closestMatching(element, config.messages) ||
        closestMatching(element, config.overlayMessages) ||
        isOwned(element)
      ) {
        return
      }
      seen.add(element)
      results.push(element)
    }
    queryAllDeep(PLATFORM_EMOJI_ITEM_SELECTORS).forEach(add)
    queryAllDeep(BILIBILI_EMOJI_SURFACE_SELECTORS).forEach((surface) => {
      if (
        (!includeHidden && !isVisible(surface)) ||
        closestMatching(surface, config.messages) ||
        closestMatching(surface, config.overlayMessages)
      ) {
        return
      }
      surface
        .querySelectorAll(
          [
            'img',
            '[data-emoji]',
            '[data-emoji-name]',
            '[data-emoji-text]',
            '[data-emoticon]',
            '[data-emoticon-name]',
            '[data-emoticon-text]',
            '[data-emoticon-unique]',
            '[data-file-id]',
            "[role='button']",
            'button',
            'li',
          ].join(','),
        )
        .forEach(add)
    })
    return results.slice(0, 1200)
  }

  function platformEmojiInteractiveItem(element) {
    const interactive = element.closest("button,[role='button'],li")
    if (interactive) return interactive
    const parentItem =
      element.parentElement &&
      element.parentElement.closest(PLATFORM_EMOJI_ITEM_SELECTORS.join(','))
    return parentItem || element.closest(PLATFORM_EMOJI_ITEM_SELECTORS.join(',')) || element
  }

  function findMatchingBilibiliPlatformEmoji(asset, includeHidden = false) {
    return uniqueHighestScoringItem(
      platformEmojiItemCandidates(includeHidden),
      platformEmojiInteractiveItem,
      (element) => assetMatchScore(element, asset),
    )
  }

  function findUniqueBilibiliPlatformEmoji(asset, includeHidden = false) {
    if (platformId !== 'bilibili') return null
    const matches = new Map()
    const expectedToken = normalizedEmojiToken(asset && asset.token, 'emoji')
    platformEmojiItemCandidates(includeHidden).forEach((element) => {
      let score = assetMatchScore(element, asset)
      if (
        score < 4 &&
        expectedToken &&
        normalizedEmojiToken(assetDescriptorFromElement(element)?.token, 'emoji') === expectedToken
      ) {
        // Some Bilibili builds expose only a display name on the native panel
        // and only an image URL on the rendered danmaku. An exact bracketed
        // token is safe only when it resolves to one native interactive item.
        score = 3
      }
      if (score < 3) return
      const item = platformEmojiInteractiveItem(element)
      const descriptor = assetDescriptorFromElement(element)
      const resourceIdentity = descriptor?.keys?.find((key) => {
        const normalized = String(key || '').toLowerCase()
        return (
          normalized.startsWith(NATIVE_PANEL_ASSET_KEY_PREFIX) ||
          normalized.startsWith(LEGACY_BILIBILI_EXCLUSIVE_ASSET_KEY_PREFIX)
        )
      })
      const matchKey = resourceIdentity || item
      const previous = matches.get(matchKey)
      if (
        !previous ||
        score > previous.score ||
        (score === previous.score && isVisible(item) && !isVisible(previous.item))
      ) {
        matches.set(matchKey, { item, score })
      }
    })
    const ranked = Array.from(matches.values()).sort((first, second) => second.score - first.score)
    if (!ranked.length) return null
    const bestScore = ranked[0].score
    const best = ranked.filter((match) => match.score === bestScore)
    return best.length === 1 ? best[0].item : null
  }

  function platformEmojiCategoryCandidates(includeHidden = false) {
    const results = []
    const seen = new Set()
    const add = (element) => {
      if (
        !(element instanceof Element) ||
        seen.has(element) ||
        (!includeHidden && !isVisible(element)) ||
        isOwned(element) ||
        element.getAttribute('aria-selected') === 'true' ||
        element.classList.contains('is-active')
      ) {
        return
      }
      seen.add(element)
      results.push(element)
    }
    queryAllDeep(BILIBILI_EMOJI_SURFACE_SELECTORS).forEach((surface) => {
      if (
        (!includeHidden && !isVisible(surface)) ||
        closestMatching(surface, config.messages) ||
        closestMatching(surface, config.overlayMessages)
      )
        return
      surface.querySelectorAll(PLATFORM_EMOJI_CATEGORY_SELECTORS.join(',')).forEach(add)
    })
    if (platformId === 'douyu') {
      // Current Douyu mounts EmotionTab beside EmotionList instead of inside
      // the list surface, so a surface-descendant query alone misses every
      // paid/fan pack tab.
      queryAllDeep(['.EmotionTab-item', "[class*='EmotionTab-item']"]).forEach(add)
    }
    // Douyu exposes many independent packs (including paid/fan-exclusive
    // groups), so sixteen tabs is not a safe upper bound there.
    return results.slice(0, platformId === 'douyu' ? 40 : 16)
  }

  function platformEmojiToggleCandidates(input, includeHidden = false) {
    const inputRect = input && input.getBoundingClientRect()
    const candidates = queryAllDeep(BILIBILI_EMOJI_TOGGLE_SELECTORS).filter(
      (element) =>
        element.isConnected &&
        (includeHidden || isVisible(element)) &&
        !closestMatching(element, config.messages) &&
        !isOwned(element),
    )
    candidates.sort((first, second) => {
      const score = (element) => {
        const marker = elementMarker(element)
        const rect = element.getBoundingClientRect()
        const visible = isVisible(element)
        const distance =
          inputRect && visible
            ? Math.abs(rect.left - inputRect.right) + Math.abs(rect.top - inputRect.top)
            : 0
        let scopeBonus = 0
        let parent = input && input.parentElement
        for (let depth = 0; parent && depth < 6; depth += 1, parent = parent.parentElement) {
          if (parent.contains(element)) {
            scopeBonus = 1200 - depth * 160
            break
          }
        }
        return (
          scopeBonus +
          (/(emoji|emot|emotion|face|smile|表情)/i.test(marker) ? 500 : 0) -
          (visible ? 0 : 180) -
          Math.min(300, distance / 5)
        )
      }
      return score(second) - score(first)
    })
    return candidates
  }

  function findPlatformEmojiToggle(input, includeHidden = false) {
    return platformEmojiToggleCandidates(input, includeHidden)[0] || null
  }

  async function waitForUniqueBilibiliPlatformEmoji(asset, timeout, includeHidden = false) {
    const deadline = Date.now() + timeout
    let match = findUniqueBilibiliPlatformEmoji(asset, includeHidden)
    while (!match && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      match = findUniqueBilibiliPlatformEmoji(asset, includeHidden)
    }
    return match
  }

  async function waitForMatchingBilibiliPlatformEmoji(asset, timeout, includeHidden = false) {
    const deadline = Date.now() + timeout
    let match = findMatchingBilibiliPlatformEmoji(asset, includeHidden)
    while (!match && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      match = findMatchingBilibiliPlatformEmoji(asset, includeHidden)
    }
    return match
  }

  async function waitForDouyuCategoryEmoji(
    asset,
    previousItems,
    timeout,
    includeHidden = false,
  ) {
    const deadline = Date.now() + timeout
    let replacementObservedAt = 0
    let sawEmptyList = false
    while (Date.now() < deadline) {
      const match = findMatchingBilibiliPlatformEmoji(asset, includeHidden)
      if (match) return match
      const items = new Set(
        platformEmojiItemCandidates(includeHidden).map(platformEmojiInteractiveItem),
      )
      if (!items.size) sawEmptyList = true
      const replaced =
        (sawEmptyList && items.size > 0) ||
        items.size !== previousItems.size ||
        Array.from(items).some((item) => !previousItems.has(item))
      if (replaced && !replacementObservedAt) replacementObservedAt = Date.now()
      // Wrong Douyu packs usually render within one frame. Once a replacement
      // list has settled without a resource match, move to the next pack;
      // slow packs still get the complete timeout while their list is empty.
      if (items.size && replacementObservedAt && Date.now() - replacementObservedAt >= 80) {
        return null
      }
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    return findMatchingBilibiliPlatformEmoji(asset, includeHidden)
  }

  async function openUniqueBilibiliPlatformEmoji(input, asset) {
    const includeHidden = fullscreenActive()
    let item =
      findUniqueBilibiliPlatformEmoji(asset) ||
      (includeHidden ? findUniqueBilibiliPlatformEmoji(asset, true) : null)
    if (item) return item
    const toggle = findPlatformEmojiToggle(input, includeHidden)
    if (toggle && typeof toggle.click === 'function') {
      toggle.click()
      state.emojiPanelOpenedByPlugin = true
      item = await waitForUniqueBilibiliPlatformEmoji(asset, 900, includeHidden)
      if (item) return item
    }
    for (const category of platformEmojiCategoryCandidates(includeHidden)) {
      if (!category.isConnected || typeof category.click !== 'function') continue
      category.click()
      item = await waitForUniqueBilibiliPlatformEmoji(asset, 320, includeHidden)
      if (item) return item
    }
    return findUniqueBilibiliPlatformEmoji(asset, true)
  }

  async function openMatchingBilibiliPlatformEmoji(input, asset) {
    const includeHidden = fullscreenActive()
    let item =
      findMatchingBilibiliPlatformEmoji(asset) ||
      (includeHidden ? findMatchingBilibiliPlatformEmoji(asset, true) : null)
    if (item) return item
    const toggle = findPlatformEmojiToggle(input, includeHidden)
    if (toggle && typeof toggle.click === 'function') {
      toggle.click()
      state.emojiPanelOpenedByPlugin = true
      item = await waitForMatchingBilibiliPlatformEmoji(asset, 900, includeHidden)
      if (item) return item
    }
    for (const category of platformEmojiCategoryCandidates(includeHidden)) {
      if (!category.isConnected || typeof category.click !== 'function') continue
      const previousItems = new Set(
        platformEmojiItemCandidates(includeHidden).map(platformEmojiInteractiveItem),
      )
      category.click()
      item =
        platformId === 'douyu'
          ? await waitForDouyuCategoryEmoji(asset, previousItems, 750, includeHidden)
          : await waitForMatchingBilibiliPlatformEmoji(asset, 320, includeHidden)
      if (item) return item
    }
    return findMatchingBilibiliPlatformEmoji(asset, true)
  }

  function countMatchingPlatformEmojiAssets(asset) {
    let count = 0
    const rows = messageRows().slice(-120)
    if (platformId === 'bilibili') {
      rows.push(...overlayMessageCandidates().slice(-120))
    }
    const seenImages = new Set()
    rows.forEach((row) => {
      if (!(row instanceof Element) || isOwned(row)) return
      row.querySelectorAll('img').forEach((image) => {
        if (!seenImages.has(image) && assetMatchScore(image, asset) >= 4) {
          seenImages.add(image)
          count += 1
        }
      })
    })
    return count
  }

  function countChatImageMessages() {
    let count = 0
    messageRows()
      .slice(-160)
      .forEach((row) => {
        if (isOwned(row) || isBilibiliChatAdvertisement(row)) return
        const messageElement = messageElementFromCandidate(row)
        if (messageElement && messageEmojiImages(row, messageElement).length) {
          count += 1
        }
      })
    return count
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

  function richInputIsEmpty(input) {
    if (!input || !input.isConnected) {
      return true
    }
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      return !shared.normalizeWhitespace(input.value)
    }
    if (shared.normalizeWhitespace(input.textContent)) {
      return false
    }
    try {
      return !input.querySelector(
        [
          'img',
          '[data-emoji]',
          '[data-emoji-id]',
          '[data-emoticon]',
          '[data-emoticon-id]',
          '[data-emoticon-unique]',
          "[class*='emoji' i]",
          "[class*='emoticon' i]",
        ].join(','),
      )
    } catch {
      return !richInputFingerprint(input)
    }
  }

  function hasNewPlatformEmojiEcho(asset, previousCount, previousImageMessageCount) {
    return (
      countMatchingPlatformEmojiAssets(asset) > previousCount ||
      (platformId !== 'bilibili' && countChatImageMessages() > previousImageMessageCount)
    )
  }

  async function waitForNewPlatformEmojiEcho(asset, previousCount, timeout) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (countMatchingPlatformEmojiAssets(asset) > previousCount) return true
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    return countMatchingPlatformEmojiAssets(asset) > previousCount
  }

  async function startBilibiliNativeSendObservation() {
    if (platformId !== 'bilibili') return null
    const randomBytes = new Uint32Array(4)
    crypto.getRandomValues(randomBytes)
    const nonce = `${Date.now().toString(36)}-${Array.from(randomBytes)
      .map((value) => value.toString(36))
      .join('-')}`
    let settled = false
    let resolveResult
    const result = new Promise((resolve) => {
      resolveResult = resolve
    })
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolveResult(value)
    }
    const onMessage = (event) => {
      if (event.source !== window || !isBilibiliNativeSendObservation(event.data, nonce)) return
      finish(event.data)
    }
    const timer = window.setTimeout(() => finish(null), 10_500)
    window.addEventListener('message', onMessage)
    try {
      const installed = await chrome.runtime.sendMessage({
        nonce,
        type: BILIBILI_INSTALL_NATIVE_SEND_OBSERVER,
      })
      if (!installed?.ok) finish(null)
    } catch {
      finish(null)
    }
    return {
      cancel: () => finish(null),
      read: (timeout = 160) =>
        Promise.race([result, new Promise((resolve) => setTimeout(() => resolve(null), timeout))]),
    }
  }

  async function waitForPlatformEmojiResult(
    input,
    asset,
    previousCount,
    previousImageMessageCount,
    previousInput,
    clickedItem,
    clickedItemWasVisible,
    timeout,
  ) {
    const deadline = Date.now() + timeout
    let dispatchedAt = 0
    while (Date.now() < deadline) {
      if (hasNewPlatformEmojiEcho(asset, previousCount, previousImageMessageCount)) {
        // Huya and Douyu can render a successfully sent native Emoji through
        // an unrelated CDN URL with no surviving name/id. A newly appended
        // image-message row immediately after the native action is therefore
        // valid secondary confirmation when exact resource matching is lost.
        return 'sent'
      }
      if (richInputFingerprint(input) !== previousInput && !richInputIsEmpty(input)) {
        return 'inserted'
      }
      const nativeDirectDispatch =
        platformId === 'huya' ||
        ((platformId === 'bilibili' || platformId === 'douyu') &&
          clickedItem &&
          (!clickedItem.isConnected || !isVisible(clickedItem)))
      if (nativeDirectDispatch && clickedItemWasVisible && clickedItem) {
        if (!dispatchedAt) dispatchedAt = Date.now()
        // Bilibili/Douyu can close the panel after a direct native dispatch,
        // while Huya may dispatch directly even when its panel stays open.
        // Keep observing exact echoes/editor changes first, then accept that
        // intentional native dispatch without producing a false error.
        const dispatchDelay = platformId === 'huya' ? 900 : 500
        if (platformId !== 'bilibili' && Date.now() - dispatchedAt >= dispatchDelay) {
          return 'dispatched'
        }
        // On Bilibili the first room-Emoji interaction can unmount the panel
        // item immediately. Keep the full confirmation window open before an
        // independent API fallback; disappearance alone is neither success
        // nor sufficient proof that it is safe to send the Emoji again.
      }
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    return dispatchedAt ? 'dispatched' : 'none'
  }

  async function waitForPlatformEmojiSubmission(
    input,
    asset,
    previousCount,
    previousImageMessageCount,
    timeout,
  ) {
    const deadline = Date.now() + timeout
    let activeInput = input
    let consumedAt = 0
    while (Date.now() < deadline) {
      if (countMatchingPlatformEmojiAssets(asset) > previousCount) {
        return { input: activeInput, sent: true, consumed: true }
      }
      if (platformId !== 'bilibili' && countChatImageMessages() > previousImageMessageCount) {
        return { input: activeInput, sent: true, consumed: true }
      }
      if (!activeInput || !activeInput.isConnected) {
        activeInput = findInput()
      }
      if (activeInput && richInputIsEmpty(activeInput)) {
        if (!consumedAt) consumedAt = Date.now()
        if (platformId !== 'bilibili' && Date.now() - consumedAt >= 240) {
          // This function is entered only after a native rich Emoji was
          // inserted and the plugin invoked the platform's own send control.
          // Huya/Douyu clearing that non-empty rich editor is authoritative UI
          // acceptance even when their eventual echo loses every asset key.
          return { input: activeInput, sent: true, consumed: true, nativeAccepted: true }
        }
      } else {
        consumedAt = 0
      }
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    return {
      input: activeInput,
      sent:
        countMatchingPlatformEmojiAssets(asset) > previousCount ||
        (platformId !== 'bilibili' &&
          (countChatImageMessages() > previousImageMessageCount ||
            Boolean(activeInput && richInputIsEmpty(activeInput) && consumedAt))),
      consumed: Boolean(activeInput && richInputIsEmpty(activeInput)),
    }
  }

  async function waitForPlatformSendButton(input, timeout) {
    const deadline = Date.now() + timeout
    let activeInput = input
    while (Date.now() < deadline) {
      if (!activeInput || !activeInput.isConnected) {
        activeInput = findInput()
      }
      if (activeInput) {
        const button = findSendButton(activeInput)
        if (button) {
          return { button, input: activeInput }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return { button: null, input: activeInput }
  }

  async function submitInsertedPlatformEmoji(
    input,
    asset,
    previousCount,
    previousImageMessageCount,
  ) {
    let activeInput = input
    let sendControl = await waitForPlatformSendButton(
      activeInput,
      platformId === 'bilibili' ? 900 : 300,
    )
    activeInput = sendControl.input || activeInput
    if (sendControl.button) {
      sendControl.button.click()
    } else if (activeInput) {
      pressEnter(activeInput)
    }

    let submission = await waitForPlatformEmojiSubmission(
      activeInput,
      asset,
      previousCount,
      previousImageMessageCount,
      platformId === 'bilibili' ? 1200 : 600,
    )
    if (submission.sent) {
      return submission
    }

    // Never submit the same native Emoji a second time after the editor was
    // consumed. Successful native acceptance is already returned above; this
    // branch only prevents a duplicate when a future platform state cannot be
    // classified confidently.
    if (submission.consumed) {
      return submission
    }

    activeInput = submission.input || activeInput
    if (activeInput) {
      pressEnter(activeInput)
      submission = await waitForPlatformEmojiSubmission(
        activeInput,
        asset,
        previousCount,
        previousImageMessageCount,
        700,
      )
      if (submission.sent) {
        return submission
      }
      if (submission.consumed) {
        return submission
      }
    }

    activeInput = submission.input || activeInput
    sendControl = await waitForPlatformSendButton(activeInput, 500)
    activeInput = sendControl.input || activeInput
    if (sendControl.button) {
      sendControl.button.click()
      submission = await waitForPlatformEmojiSubmission(
        activeInput,
        asset,
        previousCount,
        previousImageMessageCount,
        900,
      )
    }
    return submission
  }

  async function repeatBilibiliRecognizedEmojiText(message, payload, debug) {
    const asset = payload && Array.isArray(payload.assets) ? payload.assets[0] : null
    if (!asset || !beginProtectedSend(message)) return false
    const input = findInput()
    if (!input) {
      debug.fail('auto-text-editor-missing', { asset: debug.asset(asset) })
      state.sendProtection.finish(message, false)
      showToast(t('toastEditorNotFound', platformName), 'error')
      return false
    }

    const previousCount = countMatchingPlatformEmojiAssets(asset)
    setNativeValue(input, message)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const networkObserver = await startPlatformSendObservation()
    const feedbackProbe = createPlatformFeedbackProbe(document)
    let button = findSendButton(input)
    if (button) button.click()
    else pressEnter(input)

    let consumed = await waitForInputConsumption(input, message, 420)
    if (!consumed) {
      pressEnter(input)
      consumed = await waitForInputConsumption(input, message, 320)
    }
    if (!consumed) {
      button = findSendButton(input)
      if (button) {
        button.click()
        consumed = await waitForInputConsumption(input, message, 420)
      }
    }
    if (!consumed) {
      const settled = await finishProtectedSend(message, false, feedbackProbe, networkObserver)
      if (settled !== 'feedback') {
        debug.fail('auto-text-not-consumed', { asset: debug.asset(asset), message })
        showToast(t('toastAutomaticSendFailed'), 'error')
      }
      return false
    }

    const echoed = await waitForNewPlatformEmojiEcho(asset, previousCount, 3_200)
    const settled = await finishProtectedSend(message, echoed, feedbackProbe, networkObserver)
    if (settled === 'feedback') {
      debug.fail('auto-text-platform-feedback', { asset: debug.asset(asset), message })
      return false
    }
    if (!echoed) {
      debug.fail('auto-text-send-unconfirmed', {
        asset: debug.asset(asset),
        matchingAssetCountAfter: countMatchingPlatformEmojiAssets(asset),
        previousCount,
      })
      showToast(t('toastImageUnconfirmed', platformName), 'error')
      return false
    }
    releaseInputFocus(input)
    showToast(t('toastImageEmojiSent'), 'success')
    return true
  }

  async function repeatDouyuNativeRichPayload(payload) {
    if (platformId !== 'douyu') return false
    const asset = payload && Array.isArray(payload.assets) ? payload.assets[0] : null
    const protectedMessage = String(payload?.text || asset?.token || '图片表情')
    if (!asset || !beginProtectedSend(protectedMessage)) return false

    const input = findInput()
    if (!input) {
      state.sendProtection.finish(protectedMessage, false)
      showToast(t('toastEditorNotFound', platformName), 'error')
      return false
    }
    const item = await openMatchingBilibiliPlatformEmoji(input, asset)
    if (!item || typeof item.click !== 'function') {
      state.sendProtection.finish(protectedMessage, false)
      showToast(t('toastEmojiPanelNoMatch', platformName), 'error')
      return false
    }

    const previousCount = countMatchingPlatformEmojiAssets(asset)
    const previousImageMessageCount = countChatImageMessages()
    const beforeInput = richInputFingerprint(input)
    const itemWasVisible = isVisible(item)
    const networkObserver = await startPlatformSendObservation()
    const feedbackProbe = createPlatformFeedbackProbe(document)
    item.click()
    let result = await waitForPlatformEmojiResult(
      input,
      asset,
      previousCount,
      previousImageMessageCount,
      beforeInput,
      item,
      itemWasVisible,
      2_400,
    )
    if (result === 'dispatched') result = 'sent'
    if (result === 'inserted' && richInputFingerprint(input) !== beforeInput) {
      const submission = await submitInsertedPlatformEmoji(
        input,
        asset,
        previousCount,
        previousImageMessageCount,
      )
      result = submission.sent ? 'sent' : 'none'
    }
    if (result !== 'sent') {
      const settled = await finishProtectedSend(
        protectedMessage,
        false,
        feedbackProbe,
        networkObserver,
      )
      if (settled !== 'feedback') {
        showToast(t('toastImageUnconfirmed', platformName), 'error')
      }
      return false
    }
    if ((await finishProtectedSend(
      protectedMessage,
      true,
      feedbackProbe,
      networkObserver,
    )) !== true) {
      return false
    }
    releaseInputFocus(input)
    showToast(t('toastImageEmojiSent'), 'success')
    return true
  }

  async function repeatBilibiliNativeRichPayload(payload) {
    const debug = createBilibiliEmoticonDebugAttempt(payload)
    try {
      return await repeatBilibiliNativeRichPayloadWithDebug(payload, debug)
    } catch (error) {
      debug.fail('unexpected-exception', { error })
      throw error
    }
  }

  async function repeatBilibiliNativeRichPayloadWithDebug(payload, debug) {
    const shouldResolveBilibiliSingleImage = Boolean(bilibiliFavoriteImagePayload(payload))
    const hasBilibiliEmojiParts = Boolean(
      platformId === 'bilibili' &&
      payload &&
      Array.isArray(payload.parts) &&
      payload.parts.some((part) => part && part.type === 'emoji' && part.asset),
    )
    if (
      platformId === 'bilibili' &&
      payload &&
      Array.isArray(payload.assets) &&
      payload.assets.length &&
      (fullscreenActive() || shouldResolveBilibiliSingleImage || hasBilibiliEmojiParts)
    ) {
      // Player-rendered image danmaku frequently exposes only its image URL.
      // Resolve it against Bilibili's own (hidden while fullscreen) Emoji
      // panel before deciding whether a lossless native-image send is possible.
      // Mixed text/Emoji content needs the same resolution: rendered Emoji
      // often carry only an opaque identity hash, and without a display name
      // the ordered-text path cannot rebuild the full message.
      await enrichRichPayloadAssetNames(payload, { resolveBilibiliNative: true })
    }
    // Side-chat rows carry richer Emoji metadata than the video danmaku row.
    // Recover missing display names here, once per send, instead of on every
    // hover (the hover path stays cheap).
    if (platformId === 'bilibili') {
      bilibiliCompleteEmojiTokens(payload)
    }
    const resolvedBilibiliAutoText =
      platformId === 'bilibili' ? bilibiliAutoRecognizedEmojiText(payload) : ''
    if (resolvedBilibiliAutoText) {
      return repeatBilibiliRecognizedEmojiText(resolvedBilibiliAutoText, payload, debug)
    }
    const bilibiliSingleImagePayload = bilibiliFavoriteImagePayload(payload)
    const bilibiliInlineText = bilibiliSingleImagePayload ? '' : bilibiliInlineEmojiText(payload)
    if (bilibiliInlineText) {
      return repeatMessage(bilibiliInlineText)
    }
    // Mixed text/Emoji content that failed inline rebuild (e.g. an Emoji
    // without any nameable token) must still send the full message instead of
    // falling into the panel path, which inserts only the first asset and
    // drops the surrounding text. payload.text carries the DOM-ordered
    // message with any recognizable tokens already in place.
    if (
      platformId === 'bilibili' &&
      !bilibiliSingleImagePayload &&
      payload &&
      Array.isArray(payload.parts) &&
      payload.parts.some((part) => part && part.type === 'text' && String(part.text || '').trim())
    ) {
      const fallbackText = String(payload.text || '').trim()
      if (fallbackText) {
        return repeatMessage(fallbackText)
      }
    }
    const asset = payload && Array.isArray(payload.assets) ? payload.assets[0] : null
    const nativeBilibiliAsset = platformId === 'bilibili' && isBilibiliNativePanelAsset(asset)
    if (bilibiliSingleImagePayload && !nativeBilibiliAsset) {
      debug.fail('identity-not-unique', {
        asset: debug.asset(asset),
        panelOpenedByPlugin: state.emojiPanelOpenedByPlugin,
      })
      showToast(t('toastOfficialEmojiNotUnique', bilibiliSingleImagePayload.text), 'error')
      return false
    }
    const protectedMessage = String(payload.text || '')
    if (!beginProtectedSend(protectedMessage)) {
      debug.fail('send-protection-blocked', {
        remainingMs: state.sendProtection.remainingMs(protectedMessage),
      })
      return false
    }
    const input = nativeBilibiliAsset ? findBilibiliEmojiEditor() || findInput() : findInput()
    if (!asset) {
      debug.fail('asset-missing', {
        nativeBilibiliAsset,
      })
      state.sendProtection.finish(protectedMessage, false)
      showToast(t('toastImageResourceNotFound', platformName), 'error')
      return false
    }
    const sendDirectFallback = async () => {
      // Resolve this at the moment the fallback runs. The original video/chat
      // asset commonly has only an image URL; opening Bilibili's native panel
      // below enriches that same object with room_xxx_xxx afterwards.
      const directRoomEmoticonIdentity = bilibiliRoomEmoticonIdentity(asset)
      const directRoomEmoticonToken = normalizedEmojiToken(asset?.token, 'emoji')
      if (!directRoomEmoticonIdentity && !directRoomEmoticonToken) {
        return { attempted: false, reason: 'identity-unavailable', success: false }
      }
      const feedbackProbe = createPlatformFeedbackProbe(document)
      const previousDirectCount = countMatchingPlatformEmojiAssets(asset)
      let result
      try {
        result = await chrome.runtime.sendMessage({
          identity: directRoomEmoticonIdentity || undefined,
          sourceHints: [asset?.src].filter(Boolean),
          token: directRoomEmoticonToken || undefined,
          type: BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE,
        })
      } catch (error) {
        result = {
          error: 'runtime-unavailable',
          exception: error instanceof Error ? { message: error.message, name: error.name } : error,
          ok: false,
        }
      }
      if (result?.ok) {
        if (result.identity && !directRoomEmoticonIdentity) {
          asset.keys = Array.from(
            new Set([
              `${NATIVE_PANEL_ASSET_KEY_PREFIX}${result.identity}`,
              ...(Array.isArray(asset.keys) ? asset.keys : []),
            ]),
          ).slice(0, 48)
        }
        const echoed = await waitForNewPlatformEmojiEcho(asset, previousDirectCount, 3_200)
        const settled = await finishProtectedSend(protectedMessage, echoed, feedbackProbe)
        if (settled === 'feedback') {
          debug.fail('direct-send-success-feedback-rejected', {
            echoed,
            identity: result.identity || directRoomEmoticonIdentity,
            result,
          })
          return { attempted: true, success: false }
        }
        if (!echoed) {
          debug.fail('direct-send-unconfirmed', {
            identity: result.identity || directRoomEmoticonIdentity,
            matchingAssetCountAfter: countMatchingPlatformEmojiAssets(asset),
            previousDirectCount,
            result,
          })
          showToast(t('toastImageUnconfirmed', platformName), 'error')
          return { attempted: true, success: false }
        }
        releaseInputFocus(input)
        showToast(t('toastImageEmojiSent'), 'success')
        return { attempted: true, success: true }
      }
      feedbackProbe.stop()
      const feedback = classifyPlatformSendResponse(result || {})
        || classifyPlatformSendFeedback(result?.message)
      if (feedback) {
        debug.fail('direct-send-platform-rejected', {
          feedback,
          identity: result.identity || directRoomEmoticonIdentity,
          result,
        })
        state.sendProtection.applyPlatformFeedback(feedback, protectedMessage)
        const seconds = Math.max(1, Math.ceil(feedback.cooldownMs / 1_000))
        showToast(
          feedback.cooldownMs > 0
            ? t('toastPlatformCooldown', [
                platformName,
                formatPlatformSendFeedback(feedback),
                String(seconds),
              ])
            : t('toastPlatformRejected', [platformName, formatPlatformSendFeedback(feedback)]),
          feedback.kind === 'rejected' ? 'error' : 'warning',
        )
        updateCooldownUi(protectedMessage)
        return { attempted: true, success: false }
      }
      state.sendProtection.finish(protectedMessage, false)
      updateCooldownUi(protectedMessage)
      debug.fail('direct-send-failed', {
        identity: result.identity || directRoomEmoticonIdentity,
        result,
      })
      showToast(
        t(
          result?.error === 'room-mismatch'
            ? 'toastBilibiliRoomEmojiMismatch'
            : 'toastBilibiliDirectEmojiFailed',
        ),
        'error',
      )
      return { attempted: true, success: false }
    }
    if (!input) {
      const direct = await sendDirectFallback()
      if (direct.attempted) return direct.success
      debug.fail('editor-and-direct-identity-unavailable', {
        asset: debug.asset(asset),
        directReason: direct.reason,
        nativeBilibiliAsset,
        panelOpenedByPlugin: state.emojiPanelOpenedByPlugin,
      })
      state.sendProtection.finish(protectedMessage, false)
      showToast(t('toastImageResourceNotFound', platformName), 'error')
      return false
    }
    const item = nativeBilibiliAsset
      ? await openUniqueBilibiliPlatformEmoji(input, asset)
      : await openMatchingBilibiliPlatformEmoji(input, asset)
    if (!item || typeof item.click !== 'function') {
      const direct = await sendDirectFallback()
      if (direct.attempted) return direct.success
      debug.fail('panel-item-not-found', {
        asset: debug.asset(asset),
        categoryCandidateCount: platformEmojiCategoryCandidates(fullscreenActive()).length,
        directReason: direct.reason,
        emojiItemCandidateCount: platformEmojiItemCandidates(fullscreenActive()).length,
        fullscreen: fullscreenActive(),
        nativeBilibiliAsset,
        panelOpenedByPlugin: state.emojiPanelOpenedByPlugin,
        toggleCandidateCount: platformEmojiToggleCandidates(input, fullscreenActive()).length,
      })
      state.sendProtection.finish(protectedMessage, false)
      // A bracketed Emoji name is only display text. Programmatically writing
      // it into Bilibili's editor does not reliably attach the native Emoji
      // metadata, so never downgrade an image payload to a literal "[name]".
      showToast(t('toastEmojiPanelNoMatch', platformName), 'error')
      return false
    }
    enrichRichPayloadAsset(payload, 0, item)
    const previousCount = countMatchingPlatformEmojiAssets(asset)
    const previousImageMessageCount = countChatImageMessages()
    const beforeInput = richInputFingerprint(input)
    const itemWasVisible = isVisible(item)
    const feedbackProbe = createPlatformFeedbackProbe(document)
    const nativeSendObserver = await startBilibiliNativeSendObservation()
    item.click()
    const resultTimeout = 2400
    let result = await waitForPlatformEmojiResult(
      input,
      asset,
      previousCount,
      previousImageMessageCount,
      beforeInput,
      item,
      itemWasVisible,
      resultTimeout,
    )
    if (result === 'dispatched' && (platformId === 'huya' || platformId === 'douyu')) {
      result = 'sent'
    }
    if (result === 'inserted' && richInputFingerprint(input) !== beforeInput) {
      const submission = await submitInsertedPlatformEmoji(
        input,
        asset,
        previousCount,
        previousImageMessageCount,
      )
      result = submission.sent ? 'sent' : 'none'
    }
    const nativeSendResult = nativeSendObserver ? await nativeSendObserver.read() : null
    if (nativeSendResult?.identity && !bilibiliRoomEmoticonIdentity(asset)) {
      asset.keys = Array.from(
        new Set([
          `${NATIVE_PANEL_ASSET_KEY_PREFIX}${nativeSendResult.identity}`,
          ...(Array.isArray(asset.keys) ? asset.keys : []),
        ]),
      ).slice(0, 48)
    }
    const nativeSendRejected = Boolean(
      nativeSendResult &&
      ((Number.isFinite(nativeSendResult.code) && nativeSendResult.code !== 0) ||
        (Number.isFinite(nativeSendResult.httpStatus) && nativeSendResult.httpStatus >= 400)),
    )
    if (nativeSendRejected) {
      nativeSendObserver?.cancel()
      feedbackProbe.stop()
      const message = shared.normalizeWhitespace(
        nativeSendResult.message || `HTTP ${nativeSendResult.httpStatus || nativeSendResult.code}`,
      )
      const feedback = classifyPlatformSendResponse({
        ...nativeSendResult,
        message,
      }) || classifyPlatformSendFeedback(message)
      state.sendProtection.finish(protectedMessage, false)
      if (feedback) state.sendProtection.applyPlatformFeedback(feedback, protectedMessage)
      updateCooldownUi(protectedMessage)
      debug.fail('native-send-platform-rejected', {
        nativeSendResult,
      })
      showToast(
        feedback?.cooldownMs > 0
          ? t('toastPlatformCooldown', [
              platformName,
              formatPlatformSendFeedback(feedback),
              String(Math.max(1, Math.ceil(feedback.cooldownMs / 1_000))),
            ])
          : t('toastPlatformRejected', [
              platformName,
              feedback
                ? formatPlatformSendFeedback(feedback)
                : message || String(nativeSendResult.code),
            ]),
        feedback && feedback.kind !== 'rejected' ? 'warning' : 'error',
      )
      return false
    }
    if (result !== 'sent') {
      const settled = await finishProtectedSend(protectedMessage, false, feedbackProbe)
      if (settled === 'feedback') {
        debug.fail('panel-send-platform-feedback', {
          inputChanged: richInputFingerprint(input) !== beforeInput,
          inputEmpty: richInputIsEmpty(input),
          itemConnected: item.isConnected,
          itemWasVisible,
          result,
        })
        return false
      }
      if (
        platformId === 'bilibili' &&
        hasNewPlatformEmojiEcho(asset, previousCount, previousImageMessageCount)
      ) {
        // A cold Bilibili renderer can miss even the primary 2.4 s window.
        // finishProtectedSend() has just spent the feedback grace period
        // proving that the platform did not reject the action; accept a late
        // echo observed during that wait instead of reporting a false failure.
        state.sendProtection.finish(protectedMessage, true)
        updateCooldownUi(protectedMessage)
        releaseInputFocus(input)
        showToast(t('toastImageEmojiSent'), 'success')
        return true
      }
      if (platformId === 'bilibili') {
        // A visible native item can close/unmount its panel while Bilibili
        // silently drops the first programmatic action. This is a real failed
        // dispatch (no editor mutation, echo or rejection), not a slow echo.
        // Complete the promised dual path with the exact identity learned
        // from the native panel instead of reporting an unconfirmed failure.
        const direct = await sendDirectFallback()
        if (direct.attempted) {
          nativeSendObserver?.cancel()
          return direct.success
        }
      }
      debug.fail('panel-send-unconfirmed', {
        assetAfterPanelResolution: debug.asset(asset),
        directReason: bilibiliRoomEmoticonIdentity(asset)
          ? 'not-attempted'
          : 'identity-unavailable',
        inputChanged: richInputFingerprint(input) !== beforeInput,
        inputEmpty: richInputIsEmpty(input),
        imageMessageCountAfter: countChatImageMessages(),
        itemConnected: item.isConnected,
        itemWasVisible,
        matchingAssetCountAfter: countMatchingPlatformEmojiAssets(asset),
        previousCount,
        previousImageMessageCount,
        result,
        resultTimeout,
        nativeSendResult,
      })
      nativeSendObserver?.cancel()
      showToast(t('toastImageUnconfirmed', platformName), 'error')
      return false
    }
    if ((await finishProtectedSend(protectedMessage, true, feedbackProbe)) !== true) {
      nativeSendObserver?.cancel()
      debug.fail('panel-send-success-feedback-rejected', {
        itemConnected: item.isConnected,
        result,
      })
      return false
    }
    nativeSendObserver?.cancel()
    releaseInputFocus(input)
    showToast(t('toastImageEmojiSent'), 'success')
    return true
  }

  async function repeatPlatformRichPayload(payload) {
    const unicodeFallback = unicodeEmojiFallbackText(payload)
    if (unicodeFallback) {
      return repeatMessage(unicodeFallback)
    }
    const bilibiliAutoText =
      platformId === 'bilibili' ? bilibiliAutoRecognizedEmojiText(payload) : ''
    if (bilibiliAutoText) {
      return repeatBilibiliRecognizedEmojiText(
        bilibiliAutoText,
        payload,
        createBilibiliEmoticonDebugAttempt(payload),
      )
    }
    return richMessageSender(payload, {
      prepareEmojiNames:
        platformId === 'huya' ? (richPayload) => huyaCompleteEmojiTokens(richPayload) : undefined,
      reportEmojiNameUnavailable: () =>
        showToast(t('toastEmojiNameUnavailable', platformName), 'error'),
      sendBilibiliNative: repeatBilibiliNativeRichPayload,
      sendDouyuNative: repeatDouyuNativeRichPayload,
      sendText: repeatMessage,
    })
  }

  function bilibiliFavoriteImagePayload(payload) {
    if (platformId !== 'bilibili' || !payload) return null
    const assets = Array.isArray(payload.assets) ? payload.assets : []
    if (assets.length > 1) return null
    const asset = assets[0] || null
    const token = shared.normalizeWhitespace((asset && asset.token) || payload.text)
    if (!/^\[[^\]\n]{1,40}\]$/.test(token)) return null

    if (Array.isArray(payload.parts) && payload.parts.length) {
      const meaningfulParts = payload.parts.filter((part) => {
        if (!part || typeof part !== 'object') return false
        if (part.type === 'emoji') return true
        return part.type === 'text' && Boolean(shared.normalizeWhitespace(part.text))
      })
      const emojiParts = meaningfulParts.filter((part) => part.type === 'emoji')
      // Some Bilibili renderers keep a hidden accessibility/fallback label
      // beside the image, producing parts such as image + "[卖萌]". That text
      // is not mixed danmaku content; it is a duplicate representation of the
      // same Emoji and must stay on the native-panel image-send path.
      const nonDuplicateTextParts = meaningfulParts.filter(
        (part) =>
          part.type === 'text' &&
          !isBilibiliEmoticonFallbackLabel(part.text, token),
      )
      const isSingleEmojiPart =
        (assets.length === 1 && emojiParts.length === 1 && nonDuplicateTextParts.length === 0) ||
        (assets.length === 0 &&
          meaningfulParts.length === 1 &&
          meaningfulParts[0].type === 'text' &&
          shared.normalizeWhitespace(meaningfulParts[0].text) === token)
      if (!isSingleEmojiPart) return null
    }

    const runtimeAsset = asset || {
      keys: normalizedRichAssetKeys(token, location.href),
      src: '',
      token,
    }
    return {
      ...payload,
      assets: [runtimeAsset],
      parts: [{ asset: runtimeAsset, type: 'emoji' }],
      plainText: '',
      text: token,
    }
  }

  function markBilibiliPayloadAsNativePanel(payload, item) {
    enrichRichPayloadAsset(payload, 0, item)
    const asset = payload && Array.isArray(payload.assets) ? payload.assets[0] : null
    if (!asset) return
    const itemDescriptor = assetDescriptorFromElement(item)
    const itemHasNativeIdentity = isBilibiliNativePanelAsset(itemDescriptor)
    const token = normalizedEmojiToken(itemDescriptor?.token || asset.token, 'emoji')
    const marker = itemHasNativeIdentity
      ? ''
      : token
        ? // Room/anchor Emoji can expose only a bracketed display name in the
          // isolated-world DOM. The native Bilibili click still carries its
          // hidden emoticonOptions/room_xxx_xxx state, so keep this item on the
          // native panel path instead of submitting the visible name as text.
          `${NATIVE_PANEL_ASSET_KEY_PREFIX}matched-name:${token.toLowerCase().slice(0, 120)}`
        : `${NATIVE_PANEL_ASSET_KEY_PREFIX}resolved:${shared
            .normalizeWhitespace(asset.src || 'resolved')
            .toLowerCase()
            .slice(0, 180)}`
    if (marker) {
      asset.keys = Array.from(
        new Set([marker, ...(Array.isArray(asset.keys) ? asset.keys : [])]),
      ).slice(0, 48)
    }
    const emojiPart = Array.isArray(payload.parts)
      ? payload.parts.find((part) => part && part.type === 'emoji' && part.asset)
      : null
    if (marker && emojiPart && emojiPart.asset !== asset) {
      emojiPart.asset.keys = Array.from(
        new Set([marker, ...(Array.isArray(emojiPart.asset.keys) ? emojiPart.asset.keys : [])]),
      ).slice(0, 48)
    }
  }

  async function repeatBilibiliFavoritePayload(payload) {
    const imagePayload = bilibiliFavoriteImagePayload(payload)
    if (!imagePayload) {
      return payload.assets.length
        ? repeatPlatformRichPayload(payload)
        : repeatMessage(payload.text)
    }
    if (imagePayload.assets.some(isBilibiliNativePanelAsset)) {
      return repeatPlatformRichPayload(imagePayload)
    }
    if (bilibiliAutoRecognizedEmojiText(imagePayload)) {
      return repeatPlatformRichPayload(imagePayload)
    }

    const input = findBilibiliEmojiEditor() || findInput()
    if (!input) {
      showToast(t('toastEditorNotFound', platformName), 'error')
      return false
    }
    const item = await openUniqueBilibiliPlatformEmoji(input, imagePayload.assets[0])
    if (!item) {
      showToast(t('toastOfficialEmojiNotFound', imagePayload.text), 'error')
      return false
    }
    markBilibiliPayloadAsNativePanel(imagePayload, item)
    return repeatPlatformRichPayload(imagePayload)
  }

  async function repeatMessage(message) {
    if (!beginProtectedSend(message)) return false

    const input = findInput()
    if (!input) {
      state.sendProtection.finish(message, false)
      showToast(t('toastEditorNotFound', platformName), 'error')
      return false
    }

    setNativeValue(input, message)
    await new Promise((resolve) => setTimeout(resolve, 80))
    let button = findSendButton(input)
    const networkObserver = await startPlatformSendObservation()
    const feedbackProbe = createPlatformFeedbackProbe(document)

    if (button) {
      button.click()
    } else {
      pressEnter(input)
    }

    // Live sites occasionally replace or temporarily disable their send
    // control after the editor updates. Do not report success merely because a
    // stale button accepted click(); a successful send consumes the editor.
    let consumed = await waitForInputConsumption(input, message, 320)
    if (!consumed) {
      pressEnter(input)
      consumed = await waitForInputConsumption(input, message, 260)
    }

    // Re-query after the framework has processed the input event. Bilibili in
    // particular may mount an enabled send control only after that update.
    if (!consumed) {
      button = findSendButton(input)
      if (button) {
        button.click()
        consumed = await waitForInputConsumption(input, message, 320)
      }
    }

    if (!consumed) {
      const settled = await finishProtectedSend(message, false, feedbackProbe, networkObserver)
      if (settled === 'feedback') return false
      showToast(t('toastAutomaticSendFailed'), 'error')
      return false
    }

    if ((await finishProtectedSend(message, true, feedbackProbe, networkObserver)) !== true) {
      return false
    }
    releaseInputFocus(input)
    showToast(t('toastPlusOneSent'), 'success')
    return true
  }

  async function onPlusOneClick(event) {
    event.preventDefault()
    event.stopPropagation()
    if (!visibleActionsForSurface(state.settings, platformId, state.candidateKind).plusOne) {
      return
    }
    const candidate = state.candidate
    ensureSelectedOverlayHydrated()
    if (candidate !== state.candidate) return
    const message = state.message
    const richPayload = state.richPayload
    const releaseDouyuHoverAfterAction = platformId === 'douyu' && state.candidateKind === 'overlay'
    diagnostics.record({ type: 'action.plus-one', stage: state.candidateKind || 'unknown' })
    if (!message) return
    state.ui.setSending(true)
    if (releaseDouyuHoverAfterAction) {
      // The click completes this hover interaction. Release the joined native
      // hover body before Douyu's async send/feedback wait, otherwise image
      // danmaku can remain visibly paused for the entire request or forever.
      clearSelection()
    }
    try {
      if (richPayload && richPayload.assets.length) {
        await repeatPlatformRichPayload(richPayload)
      } else {
        await repeatMessage(message)
      }
    } finally {
      if (state.ui) state.ui.setSending(false)
      if (!releaseDouyuHoverAfterAction && state.candidate === candidate) {
        scheduleHide()
      }
    }
  }

  function pointerCoordinates(event) {
    const x = Number(event.clientX)
    const y = Number(event.clientY)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    // Synthetic platform/test events often omit coordinates and therefore
    // report (0, 0). They do not describe a real pointer position and must not
    // be allowed to invalidate an otherwise valid DOM-targeted interaction.
    if (!event.isTrusted && x === 0 && y === 0) return null
    return { x, y }
  }

  function onPointerOver(event) {
    if (!isEnabled()) {
      return
    }

    const pointer = pointerCoordinates(event)
    if (
      eventTouchesRepeatReminder(event) ||
      (pointer && pointTouchesRepeatReminder(document, pointer.x, pointer.y))
    ) {
      if (state.pointerFrame) {
        cancelAnimationFrame(state.pointerFrame)
        state.pointerFrame = 0
      }
      if (state.candidate) clearSelection()
      return
    }
    if (
      pointer &&
      state.candidateKind === 'overlay' &&
      state.candidate &&
      !pointInsideOverlayViewport(state.candidate, pointer.x, pointer.y)
    ) {
      clearSelection()
    }

    const path = event.composedPath ? event.composedPath() : [event.target]
    if (isOwned(event.target)) {
      return
    }

    if (pointer && isInsideFrozenHoverZone(pointer.x, pointer.y)) {
      const enteringCandidate = douyuOverlayCandidateFromPath(path)
      if (
        state.candidateKind === 'overlay' &&
        enteringCandidate &&
        enteringCandidate !== state.candidate
      ) {
        // An overlapping row can become the browser hit target while the
        // pointer is still inside the already selected row. Do not let its
        // native hover handler pause a second danmaku.
        event.stopImmediatePropagation()
      }
      cancelHide()
      return
    }

    const found = findCandidate(path)
    if (found && found.element !== state.candidate) {
      if (selectCandidate(found.element, found.kind, false, pointer, event.target)) {
        douyuNativeHover?.remember(event.target)
      }
    } else if (found && found.element === state.candidate) {
      douyuNativeHover?.remember(event.target)
      if (platformId === 'douyu' && state.candidate instanceof HTMLElement) {
        douyuNativeMotionFallback?.hold(state.candidate)
      }
    } else if (!found && platformId === 'bilibili') {
      if (pathTouchesBilibiliChatActions(path) || pathTouchesBilibiliChatAdvertisement(path)) {
        if (state.candidate) clearSelection()
        return
      }
      const elements = pointer ? document.elementsFromPoint(pointer.x, pointer.y) : []
      const pointFound = findCandidate(elements)
      if (pointFound && pointFound.element !== state.candidate) {
        selectCandidate(pointFound.element, pointFound.kind, false, pointer)
      }
    }
  }

  function restoreBilibiliQuickBars(event, force) {
    if (platformId !== 'bilibili') {
      return
    }
    if (event && !event.isTrusted) {
      return
    }

    const path = event ? (event.composedPath ? event.composedPath() : [event.target]) : []
    const elements = path.filter((item) => item instanceof Element).slice(0, 8)
    const marker = elements.map(elementMarker).join(' ')
    const targetsQuickInput = elements.some((element) => isBilibiliQuickInputRegion(element))
    const keyboardOpensQuickInput = Boolean(
      event && event.type === 'keydown' && event.key === 'Enter' && fullscreenActive(),
    )
    const markerRequestsQuickInput =
      /(?:danmaku|danmu|dm)[-_ ]?(?:input|send)|(?:input|send)[-_ ]?(?:danmaku|danmu|dm)|弹幕|快捷(?:输入|发送)|发送|send|input/i.test(
        marker,
      )
    const requestsQuickInput =
      targetsQuickInput || keyboardOpensQuickInput || markerRequestsQuickInput

    if (event && !requestsQuickInput) {
      return
    }
    if (event) {
      // A real user interaction takes ownership of the native editor. Cancel
      // all delayed blur/hide callbacks left by the previous +1 operation.
      state.bilibiliDismissToken += 1
    }
    if (!state.hiddenBilibiliQuickBars.size) {
      return
    }

    const now = Date.now()
    for (const [container, saved] of state.hiddenBilibiliQuickBars) {
      if (!event && !force && now - saved.hiddenAt < 500) {
        continue
      }
      if (container.isConnected) {
        for (const property of ['display', 'visibility', 'opacity', 'pointer-events']) {
          const style = saved.styles && saved.styles[property]
          if (style && style.value) {
            container.style.setProperty(property, style.value, style.priority)
          } else {
            container.style.removeProperty(property)
          }
        }
      }
      state.hiddenBilibiliQuickBars.delete(container)
    }
  }

  function onPointerMove(event) {
    if (!isEnabled()) {
      return
    }

    const pointer = pointerCoordinates(event)
    if (
      eventTouchesRepeatReminder(event) ||
      (pointer && pointTouchesRepeatReminder(document, pointer.x, pointer.y))
    ) {
      if (pointer) {
        state.pointerX = pointer.x
        state.pointerY = pointer.y
      }
      if (state.pointerFrame) {
        cancelAnimationFrame(state.pointerFrame)
        state.pointerFrame = 0
      }
      if (state.candidate) clearSelection()
      return
    }
    if (
      pointer &&
      state.candidateKind === 'overlay' &&
      state.candidate &&
      !pointInsideOverlayViewport(state.candidate, pointer.x, pointer.y)
    ) {
      clearSelection()
      return
    }

    douyuNativeHover?.remember(event.target)
    if (
      platformId === 'douyu' &&
      state.candidateKind === 'overlay' &&
      state.candidate instanceof HTMLElement
    ) {
      douyuNativeMotionFallback?.hold(state.candidate)
    }
    if (isOwned(event.target)) {
      cancelHide()
      return
    }

    if (pointer) {
      state.pointerX = pointer.x
      state.pointerY = pointer.y
    }

    if (state.candidateKind === 'overlay' && state.frozenClone && state.frozenClone.isConnected) {
      const insideHoverZone = isInsideFrozenHoverZone(state.pointerX, state.pointerY)
      if (insideHoverZone) {
        cancelHide()
      } else {
        scheduleHide()
      }
      return
    }

    if (state.candidateKind === 'chat') {
      const path = event.composedPath ? event.composedPath() : [event.target]
      if (pathTouchesBilibiliChatActions(path)) {
        clearSelection()
        return
      }
    }

    if (state.pointerFrame) {
      return
    }

    state.pointerFrame = requestAnimationFrame(() => {
      state.pointerFrame = 0
      const candidate = findOverlayAtPoint(state.pointerX, state.pointerY)
      if (candidate) {
        cancelHide()
        if (candidate !== state.candidate) {
          selectCandidate(
            candidate,
            'overlay',
            false,
            {
              x: state.pointerX,
              y: state.pointerY,
            },
            event.target,
          )
        }
      } else if (state.candidateKind === 'overlay') {
        scheduleHide()
      }
    })
  }

  function onPointerOut(event) {
    if (douyuNativeHover?.isReleasing) {
      return
    }
    if (!state.candidate) {
      return
    }

    const next = event.relatedTarget
    if (next && isInsideSelectedHoverBody(next)) {
      if (
        platformId === 'douyu' &&
        state.candidateKind === 'overlay' &&
        (event.target === state.candidate || state.candidate.contains(event.target))
      ) {
        douyuNativeHover?.hold(event.target)
        douyuNativeMotionFallback?.hold(state.candidate)
        // The danmaku, transparent gap bridge and portal toolbar form one
        // logical hover body. Do not let Douyu resume its native animation at
        // either internal boundary.
        event.stopImmediatePropagation()
        cancelHide()
      }
      return
    }

    const nextDouyuCandidate = douyuOverlayCandidateFromTarget(next)
    if (
      state.candidateKind === 'overlay' &&
      nextDouyuCandidate &&
      nextDouyuCandidate !== state.candidate &&
      (event.target === state.candidate || state.candidate.contains(event.target))
    ) {
      // This is a real handoff between overlapping sibling danmaku, not a move
      // into the joined gap/capsule. Release the old row before the new native
      // entry so at most one row can own hover at any moment.
      douyuNativeHover?.nativeExitWillProceed()
      clearSelection()
      return
    }

    const pointer = pointerCoordinates(event)
    const path = event.composedPath ? event.composedPath() : [event.target]
    const leavesDouyuCandidate =
      platformId === 'douyu' && state.candidateKind === 'overlay' && path.includes(state.candidate)
    if (
      pointer &&
      state.candidateKind === 'overlay' &&
      state.candidate &&
      !pointInsideOverlayViewport(state.candidate, pointer.x, pointer.y)
    ) {
      if (leavesDouyuCandidate) douyuNativeHover?.nativeExitWillProceed()
      clearSelection()
      return
    }

    if (pointer && isInsideFrozenHoverZone(pointer.x, pointer.y)) {
      if (leavesDouyuCandidate) {
        // A platform decoration can briefly win hit-testing in the visual gap
        // even though the pointer is still inside our combined hover zone.
        // Keep that transient leave from resuming Douyu before the bridge or
        // joined toolbar receives the next entry.
        douyuNativeHover?.hold(event.target)
        douyuNativeMotionFallback?.hold(state.candidate)
        event.stopImmediatePropagation()
      }
      cancelHide()
      return
    }

    if (path.includes(state.candidate)) {
      douyuNativeHover?.nativeExitWillProceed()
      scheduleHide()
    }
  }

  function onMouseOver(event) {
    if (eventTouchesRepeatReminder(event)) {
      if (state.candidate) clearSelection()
      return
    }
    if (
      platformId !== 'douyu' ||
      state.candidateKind !== 'overlay' ||
      !(state.candidate instanceof HTMLElement)
    ) {
      return
    }

    const pointer = pointerCoordinates(event)
    if (!pointer || !isInsideFrozenHoverZone(pointer.x, pointer.y)) return
    const enteringCandidate = douyuOverlayCandidateFromPath(
      event.composedPath ? event.composedPath() : [event.target],
    )
    if (enteringCandidate && enteringCandidate !== state.candidate) {
      // pointerover and mouseover are separate native event streams. Suppress
      // both so Douyu cannot pause the covered sibling behind the lock owner.
      event.stopImmediatePropagation()
    }
  }

  function onMouseOut(event) {
    if (douyuNativeHover?.isReleasing) {
      return
    }
    if (
      platformId !== 'douyu' ||
      state.candidateKind !== 'overlay' ||
      !(state.candidate instanceof HTMLElement)
    ) {
      douyuNativeHover?.remember(event.target)
      return
    }

    const next = event.relatedTarget
    const nextDouyuCandidate = douyuOverlayCandidateFromTarget(next)
    if (
      nextDouyuCandidate &&
      nextDouyuCandidate !== state.candidate &&
      (event.target === state.candidate || state.candidate.contains(event.target))
    ) {
      douyuNativeHover?.nativeExitWillProceed()
      clearSelection()
      return
    }
    if (
      isInsideSelectedHoverBody(next) &&
      (event.target === state.candidate || state.candidate.contains(event.target))
    ) {
      douyuNativeHover?.hold(event.target)
      douyuNativeMotionFallback?.hold(state.candidate)
      event.stopImmediatePropagation()
      cancelHide()
    } else if (event.composedPath().includes(state.candidate)) {
      const pointer = pointerCoordinates(event)
      if (pointer && isInsideFrozenHoverZone(pointer.x, pointer.y)) {
        douyuNativeHover?.hold(event.target)
        douyuNativeMotionFallback?.hold(state.candidate)
        event.stopImmediatePropagation()
        cancelHide()
      } else {
        douyuNativeHover?.nativeExitWillProceed()
      }
    }
  }

  function onAltClick(event) {
    if (
      !isEnabled() ||
      !state.settings.actions.plusOne ||
      !state.settings.altClick ||
      !event.altKey ||
      isOwned(event.target)
    ) {
      return
    }

    const path = event.composedPath ? event.composedPath() : [event.target]
    if (pathTouchesBilibiliChatActions(path)) {
      return
    }
    const pointer = pointerCoordinates(event)
    let found = findCandidate(path)
    if (!found && pointer) {
      const overlay = findOverlayAtPoint(pointer.x, pointer.y)
      found = overlay ? { element: overlay, kind: 'overlay' } : null
    }
    if (!found || !selectCandidate(found.element, found.kind, true, pointer, event.target)) {
      return
    }
    douyuNativeHover?.remember(event.target)

    event.preventDefault()
    event.stopPropagation()
    const candidate = state.candidate
    ensureSelectedOverlayHydrated()
    if (candidate !== state.candidate) return
    if (state.richPayload && state.richPayload.assets.length) {
      repeatPlatformRichPayload(state.richPayload)
    } else {
      repeatMessage(state.message)
    }
    scheduleHide()
  }

  function onViewportChange() {
    if (state.candidateKind === 'overlay' && state.candidate) {
      state.overlayViewport = overlayViewportRect(state.candidate)
      if (!pointInsideRect(state.overlayViewport, state.pointerX, state.pointerY)) {
        clearSelection()
        return
      }
    }
    requestAnimationFrame(updateButtonPosition)
  }

  function onDiagnosticsMessage(message, _sender, sendResponse) {
    if (!message || message.type !== 'danmaku-echo.diagnostics.snapshot') return false
    sendResponse({ ok: true, snapshot: diagnostics.snapshot() })
    return false
  }

  function onStorageChanged(_changes, areaName) {
    if (areaName === 'sync') {
      storageGet().then(applySettings)
    }
  }

  function releaseTransientResources() {
    clearSelection()
    if (state.hideTimer) clearTimeout(state.hideTimer)
    if (state.senderScanTimer) clearTimeout(state.senderScanTimer)
    if (state.pointerFrame) cancelAnimationFrame(state.pointerFrame)
    if (state.cooldownTimer) clearInterval(state.cooldownTimer)
    state.hideTimer = 0
    state.senderScanTimer = 0
    state.pointerFrame = 0
    state.cooldownTimer = 0
    state.senderObserver?.disconnect()
    state.senderObserver = null
    state.senderCorrelation.clear()
    state.roots = [document]
    state.rootsCachedAt = 0
    state.bilibiliOverlayCandidates = []
    state.bilibiliOverlayCandidatesCachedAt = 0
    state.overlayViewport = null
    state.douyuNativeCapsuleVisibility.showAll()
    state.douyuNativeCapsuleMutationRoots.clear()
    platformAdapter.cleanup()
  }

  function onVisibilityChange() {
    if (document.hidden) {
      releaseTransientResources()
    } else {
      startSenderObserver()
    }
  }

  function destroyRuntime() {
    releaseTransientResources()
    state.favoritesRuntime?.destroy()
    state.repeatReminderRuntime?.destroy()
    state.ui?.destroy()
    document.removeEventListener('pointerover', onPointerOver, true)
    document.removeEventListener('mouseover', onMouseOver, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerout', onPointerOut, true)
    document.removeEventListener('mouseout', onMouseOut, true)
    document.removeEventListener('click', onAltClick, true)
    document.removeEventListener('pointerdown', restoreBilibiliQuickBars, true)
    document.removeEventListener('keydown', restoreBilibiliQuickBars, true)
    document.removeEventListener('fullscreenchange', onFullscreenChange, true)
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange, true)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    removeEventListener('scroll', onViewportChange, true)
    removeEventListener('resize', onViewportChange)
    chrome.runtime.onMessage.removeListener(onDiagnosticsMessage)
    chrome.storage.onChanged.removeListener(onStorageChanged)
    globalThis.__bulletPlusOneLoaded = false
  }

  function onFullscreenChange() {
    restoreBilibiliQuickBars(null)
    // Huya can replace the player/danmaku subtree while entering fullscreen.
    // Drop all DOM-root caches before resolving the new fullscreen host so a
    // freshly mounted barrage layer is discoverable immediately.
    if (platformId === 'huya' || platformId === 'douyu') {
      clearSelection()
      state.roots = [document]
      state.rootsCachedAt = 0
      state.overlayViewport = null
    }
    ensurePortal()
    onViewportChange()
  }

  function syncDouyuNativeCapsuleRootAttribute() {
    const hideDouyuNativeCapsule = shouldHideNativeDanmakuCapsule(state.settings, platformId)
    if (hideDouyuNativeCapsule) {
      document.documentElement.setAttribute('data-bcp-douyu-native-capsule-hidden', 'true')
    } else {
      document.documentElement.removeAttribute('data-bcp-douyu-native-capsule-hidden')
    }
  }

  function applySettings(saved) {
    state.settings = shared.mergeSettings(saved)
    state.repeatReminderRuntime?.applySettings(state.settings)
    shared.applyCapsuleScale(document.documentElement, state.settings.interfaceScale.capsulePercent)
    syncDouyuNativeCapsuleRootAttribute()
    scanDouyuNativeDanmakuCapsules()
    shared.applyPlatformColors(document.documentElement, state.settings.colors[platformId])
    renderActionBar()
    if (!isEnabled()) {
      clearSelection()
    }
  }

  function bilibiliRepeatReminderSuppressionKey(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\s+/gu, '')
      .toLocaleLowerCase()
      .slice(0, config.maxLength)
  }

  function pruneBilibiliRepeatReminderSuppressions(now = Date.now()) {
    for (const [key, entry] of bilibiliRepeatReminderSuppressions) {
      if (!entry || entry.expiresAt <= now) bilibiliRepeatReminderSuppressions.delete(key)
    }
  }

  function rememberBilibiliRepeatReminderSuppression(text) {
    const key = bilibiliRepeatReminderSuppressionKey(text)
    if (!key) return
    const now = Date.now()
    pruneBilibiliRepeatReminderSuppressions(now)
    bilibiliRepeatReminderSuppressions.set(key, {
      expiresAt: now + BILIBILI_REPEAT_REMINDER_SUPPRESSION_TTL,
      roomKey: currentRoomContext('bilibili').roomKey,
    })
    state.repeatReminderRuntime?.suppressText(text)
  }

  function isBilibiliRepeatReminderSuppressed(text) {
    const key = bilibiliRepeatReminderSuppressionKey(text)
    if (!key) return false
    pruneBilibiliRepeatReminderSuppressions()
    const entry = bilibiliRepeatReminderSuppressions.get(key)
    return Boolean(entry && entry.roomKey === currentRoomContext('bilibili').roomKey)
  }

  function describeRepeatReminderCandidate(element, source) {
    const descriptor = platformAdapter.describe(element, source)
    if (!descriptor || platformId !== 'bilibili') return descriptor
    if (isBilibiliRepeatReminderSuppressed(descriptor.text)) return null
    const excluded = bilibiliRepeatReminderExclusionReason({
      element,
      source,
      text: descriptor.text,
    })
    if (!excluded) return descriptor
    rememberBilibiliRepeatReminderSuppression(descriptor.text)
    return null
  }

  function startSenderObserver() {
    if (state.senderObserver || !document.documentElement) return
    state.senderObserver = new MutationObserver((mutations) => {
      let nativeCapsuleRelevant = false
      if (platformId === 'douyu') {
        mutations.forEach((mutation) => {
          if (mutationContainsDouyuNativeDanmakuCapsule(mutation)) {
            nativeCapsuleRelevant = true
          }
        })
      }
      // Virtualized chat lists can recycle a row before the scheduled scan
      // ever sees it in the live DOM. Extract senders from removed rows so
      // replies still resolve after the row is gone.
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.removedNodes || [])) {
          if (!(node instanceof Element) || isInsideBilibiliPlayerOutsideChat(node)) {
            continue
          }
          const rows = matchesAny(node, config.messages)
            ? [node]
            : Array.from(node.querySelectorAll(config.messages.join(',')))
          for (const row of rows) {
            if (isOwned(row) || isBilibiliChatAdvertisement(row)) continue
            const richPayload = richPayloadFromCandidate(row)
            const message = (richPayload && richPayload.text) || textFromCandidate(row)
            const sender = senderFromChatContext(row)
            if (!sender || !shared.isPlausibleMessage(message, config.maxLength)) continue
            state.senderCorrelation.remember(replyMessageValues(message, richPayload), sender, {
              ids: messageIdsFromElement(row),
              now: Date.now(),
            })
          }
        }
      }
      const relevant = mutations.some((mutation) => {
        // Douyu's moving rows can mutate class/style every frame. Sender text
        // correlation only needs structural or text mutations; treating motion
        // attributes as chat changes schedules repeated whole-list scans and
        // stalls otherwise untouched danmaku.
        if (platformId === 'douyu' && mutation.type === 'attributes') return false
        const target =
          mutation.target instanceof Element
            ? mutation.target
            : mutation.target && mutation.target.parentElement
        if (target && isInsideBilibiliPlayerOutsideChat(target)) {
          return false
        }
        if (
          target &&
          (closestMatching(target, config.chatRoots) ||
            closestMatching(target, config.messages) ||
            closestMatching(target, config.overlayMessages))
        ) {
          return true
        }
        return Array.from(mutation.addedNodes || []).some((node) => {
          if (!(node instanceof Element)) return false
          if (isInsideBilibiliPlayerOutsideChat(node)) return false
          if (
            matchesAny(node, config.chatRoots) ||
            matchesAny(node, config.messages) ||
            matchesAny(node, config.overlayMessages)
          )
            return true
          try {
            return Boolean(
              node.querySelector(
                [...config.chatRoots, ...config.messages, ...config.overlayMessages].join(','),
              ),
            )
          } catch {
            return false
          }
        })
      })
      if (relevant) {
        scheduleSenderCacheScan(40)
      }
      if (relevant || nativeCapsuleRelevant) {
        scanDouyuNativeDanmakuCapsules()
      }
    })
    const observerOptions = {
      childList: true,
      subtree: true,
      characterData: true,
    }
    if (platformId === 'douyu') {
      observerOptions.attributes = true
      observerOptions.attributeFilter = [
        'aria-hidden',
        'aria-label',
        'class',
        'data-action',
        'hidden',
        'style',
        'title',
      ]
    }
    state.senderObserver.observe(document.documentElement, observerOptions)
    scheduleSenderCacheScan(0)
    scanDouyuNativeDanmakuCapsules()
  }

  state.repeatReminderRuntime = createRepeatReminderRuntime({
    describe: describeRepeatReminderCandidate,
    initialSettings: state.settings,
    messageSelectors: config.messages,
    overlaySelectors: config.overlayMessages,
    platform: platformId,
    plusOne: (message) => repeatMessage(message),
    roomKey: () => currentRoomContext(platformId).roomKey,
  })
  syncDouyuNativeCapsuleRootAttribute()
  storageGet().then(applySettings)
  ensureButton()
  startSenderObserver()
  state.favoritesRuntime = createFavoritesRuntime({
    enabled: () => isEnabled() && state.settings.actions.favorite,
    platform: platformId,
    sendFavorite: (payload) =>
      platformId === 'bilibili'
        ? repeatBilibiliFavoritePayload(payload)
        : payload.assets.length
          ? repeatPlatformRichPayload(payload)
          : repeatMessage(payload.text),
    showToast,
  })
  document.addEventListener('pointerover', onPointerOver, true)
  document.addEventListener('mouseover', onMouseOver, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerout', onPointerOut, true)
  document.addEventListener('mouseout', onMouseOut, true)
  document.addEventListener('click', onAltClick, true)
  document.addEventListener('pointerdown', restoreBilibiliQuickBars, true)
  document.addEventListener('keydown', restoreBilibiliQuickBars, true)
  document.addEventListener('fullscreenchange', onFullscreenChange, true)
  document.addEventListener('webkitfullscreenchange', onFullscreenChange, true)
  document.addEventListener('visibilitychange', onVisibilityChange)
  addEventListener('pagehide', destroyRuntime, { once: true })
  addEventListener('scroll', onViewportChange, true)
  addEventListener('resize', onViewportChange, { passive: true })
  chrome.runtime.onMessage.addListener(onDiagnosticsMessage)

  if (globalThis.chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(onStorageChanged)
  }
})()

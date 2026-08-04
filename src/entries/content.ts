// @ts-nocheck -- platform DOM adapter; typed modules cover its stable boundaries.
import { LIVE_PLATFORM_CONFIG, isSupportedContentPlatform } from '../platforms/live/config'
import {
  shouldHideNativeDanmakuCapsule,
  visibleActionsForSurface,
} from '../platforms/live/action-visibility'
import {
  orderedBracketEmojiText,
  unicodeEmojiFallbackText,
} from '../platforms/live/emoji-fallback'
import { SenderCorrelationCache } from '../platforms/live/sender-correlation'
import {
  DOUYU_NATIVE_DANMAKU_ACTION_MARKER,
  DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS,
  DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTORS,
  DouyuNativeCapsuleVisibilityController,
  findDouyuNativeDanmakuCapsuleTargets,
} from '../platforms/douyu/native-capsule'
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
import { normalizedAssetKeys as normalizedRichAssetKeys } from '../platforms/douyin/rich-data'
import { createFavoritesRuntime } from '../features/favorites/launcher'
import { createContentOverlay } from '../components/live/content-overlay'
import { createDiagnosticsCollector } from '../core/diagnostics'
import { createLivePlatformAdapter } from '../platforms/live/adapters'
import {
  BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES,
  DOUYU_EMOJI_SURFACE_SELECTORS,
  DOUYU_EMOJI_TOGGLE_SELECTORS,
  EDITABLE_CONTROL_SELECTOR,
  EMOJI_DISPLAY_ATTRIBUTES,
  EMOJI_METADATA_ATTRIBUTES,
  HUYA_EMOJI_SURFACE_SELECTORS,
  HUYA_EMOJI_TOGGLE_SELECTORS,
  LEGACY_BILIBILI_EXCLUSIVE_ASSET_KEY_PREFIX,
  NATIVE_PANEL_ASSET_KEY_PREFIX,
  PLATFORM_EMOJI_CATEGORY_SELECTORS,
  PLATFORM_EMOJI_ITEM_SELECTORS,
  TEXT_EDITOR_SELECTOR,
} from '../platforms/live/editor-config'
import {
  dispatchEditorEnter as pressEnter,
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
  const platformName = t(platformId === 'bilibili'
    ? 'platformBilibili'
    : platformId === 'douyu'
      ? 'platformDouyu'
      : 'platformHuya')
  const platformAdapter = createLivePlatformAdapter(platformId)
  const INERT_SNAPSHOT_SKIP_SELECTOR = inertSnapshotSkipSelector([
    `[${DOUYU_NATIVE_DANMAKU_ACTION_MARKER}]`,
    ...DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS,
  ])
  const DOUYU_NATIVE_DANMAKU_ACTION_SELECTOR = DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS.join(',')
  const DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTOR =
    DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTORS.join(',')
  const OVERLAY_HOVER_PADDING = 14
  const OVERLAY_LEAVE_DELAY = 160
  const BILIBILI_OVERLAY_ROW_SELECTOR = '.bili-danmaku-x-dm'
  const BILIBILI_OVERLAY_CACHE_TTL = 180
  const BILIBILI_OVERLAY_CACHE_LIMIT = 240
  const SENDER_SCAN_MIN_INTERVAL = 240
  const REPLY_RESOLVE_ATTEMPTS = 7
  const REPLY_RESOLVE_INTERVAL = 70
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
    hideTimer: 0,
    lastActionAt: 0,
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
    originalVisibility: null,
    pausedAnimations: [],
    pointerFrame: 0,
    pointerX: 0,
    pointerY: 0,
    bilibiliOverlayCandidates: [],
    bilibiliOverlayCandidatesCachedAt: 0,
    hiddenBilibiliQuickBars: new Map(),
    bilibiliDismissToken: 0,
    emojiPanelOpenedByPlugin: false,
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
      timers: Number(Boolean(state.hideTimer)) + Number(Boolean(state.senderScanTimer)),
    }),
    selectorHits: () => ({
      chatRoot: queryAllDeep(config.chatRoots).length > 0,
      input: queryAllDeep(config.inputs).length > 0,
      videoRoot: queryAllDeep(config.videoRoots).length > 0,
    }),
  })
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
      return overlay && isOverlayMessageElement(overlay)
        ? { element: overlay, kind: 'overlay' }
        : null
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
      if (rect.height >= 12 && rect.height <= 180 && text.length >= 1 && text.length <= 260) {
        return { element: node, kind: 'chat' }
      }
    }

    return null
  }

  function pointInside(rect, x, y, padding) {
    const margin = Number.isFinite(padding) ? padding : 0
    return (
      x >= rect.left - margin &&
      x <= rect.right + margin &&
      y >= rect.top - margin &&
      y <= rect.bottom + margin
    )
  }

  function overlayMessageForValidation(element) {
    const plainText = textFromCandidate(element)
    if (shared.isPlausibleMessage(plainText, config.maxLength)) {
      return plainText
    }
    if (platformId !== 'bilibili') {
      return ''
    }

    // Bilibili renders image-only video emoticons without textContent. Reuse
    // the rich payload parser here so known danmaku nodes are not rejected
    // before selectCandidate() can preserve and resend their image asset.
    const payload = richPayloadFromCandidate(element)
    return payload.assets.length && shared.isPlausibleMessage(payload.text, config.maxLength)
      ? payload.text
      : ''
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

    const bilibiliOverlayRow =
      platformId === 'bilibili' && element.matches(BILIBILI_OVERLAY_ROW_SELECTOR)
    if (bilibiliOverlayRow) {
      const rect = element.getBoundingClientRect()
      return (
        rect.height >= 8 &&
        rect.height <= Math.min(120, innerHeight * 0.22) &&
        rect.width >= 4
      )
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
    const frozenTarget =
      state.frozenClone && state.frozenClone.isConnected ? state.frozenClone : null
    return (
      state.candidateKind === 'overlay' &&
      frozenTarget &&
      pointInside(frozenTarget.getBoundingClientRect(), x, y, OVERLAY_HOVER_PADDING)
    )
  }

  function findOverlayAtPoint(x, y) {
    if (isInsideFrozenHoverZone(x, y)) {
      return state.candidate
    }

    const pointElements =
      typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : []

    for (const element of pointElements) {
      const exact = normalizeOverlayCandidate(closestMatching(element, config.overlayMessages))
      if (exact) {
        return exact
      }
      if (isGenericOverlayElement(element)) {
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
      if (pointInside(rect, x, y)) {
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
        ? metadataElements
            .filter(
              (metadataElement) =>
                metadataElement.getAttribute('data-type') === '1' ||
                BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES.some((attribute) =>
                  metadataElement.hasAttribute(attribute),
                ),
            )
            .map((metadataElement) =>
              shared.normalizeWhitespace(metadataElement.getAttribute('data-danmaku')),
            )
            .find((value) => /^\[[^\]\n]{1,40}\]$/.test(value)) || ''
        : ''
    const token = authoritativeBilibiliToken || emojiTokenFromElement(element)
    const keys = new Set()
    if (platformId === 'bilibili') {
      let nativePanelIdentity = ''
      let isNativePanelAsset = false
      metadataElements.forEach((metadataElement) => {
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
    const roots = candidate === messageElement ? [messageElement] : [messageElement, candidate]
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
        /(?:avatar|badge|medal|level|grade|rank|fansclub|fan-club|guard|noble)/i.test(marker)
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
    return { text, plainText, assets, parts: richPartsFromElement(element) }
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
            normalized.startsWith(NATIVE_PANEL_ASSET_KEY_PREFIX) ||
            normalized.startsWith(LEGACY_BILIBILI_EXCLUSIVE_ASSET_KEY_PREFIX)
          )
        }),
    )
  }

  function bilibiliInlineEmojiText(payload) {
    if (
      platformId !== 'bilibili' ||
      !payload ||
      !Array.isArray(payload.assets) ||
      payload.assets.some(isBilibiliNativePanelAsset)
    ) {
      return ''
    }
    return orderedBracketEmojiText(payload)
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

  function emojiTokenQuality(value) {
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
    let resolvedSingleBilibiliItem = null
    const input =
      platformId === 'bilibili' ? findBilibiliEmojiEditor() || findInput() : findInput()
    for (let index = 0; index < payload.assets.length; index += 1) {
      const asset = payload.assets[index]
      const shouldResolveNative =
        platformId === 'bilibili' &&
        resolveBilibiliNative &&
        !isBilibiliNativePanelAsset(asset)
      if (emojiTokenQuality(asset && asset.token) >= 3 && !shouldResolveNative) continue
      let item =
        platformId === 'bilibili'
          ? findUniqueBilibiliPlatformEmoji(asset, fullscreenActive())
          : findMatchingPlatformEmoji(asset)
      if (!item && input) {
        item =
          platformId === 'bilibili'
            ? await openUniqueBilibiliPlatformEmoji(input, asset)
            : await openPlatformEmojiForAsset(input, asset)
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
    for (let depth = 0; current && depth < 5; depth += 1) {
      // Read the sender from the current element before stopping the upward
      // walk: rows can match a chat-root selector (e.g. a broad class match)
      // and would otherwise short-circuit without ever extracting a sender.
      const sender = senderFromElement(current)
      if (sender) return sender
      if (matchesAny(current, config.chatRoots)) break
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
    roots.forEach((root) => {
      findDouyuNativeDanmakuCapsuleTargets(root).forEach((target) => {
        if (!isOwned(target)) activeTargets.add(target)
      })
    })
    state.douyuNativeCapsuleVisibility.hide(activeTargets)
  }

  function mutationContainsDouyuNativeDanmakuCapsule(mutation) {
    if (platformId !== 'douyu') return false

    const elements = []
    if (mutation.target instanceof Element) elements.push(mutation.target)
    Array.from(mutation.addedNodes || []).forEach((node) => {
      if (node instanceof Element) elements.push(node)
    })

    let found = false
    elements.forEach((element) => {
      if (isOwned(element)) return
      try {
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

  async function onFavoriteActionClick(event) {
    event.preventDefault()
    event.stopPropagation()
    cancelHide()
    if (
      !visibleActionsForSurface(state.settings, platformId, state.candidateKind).favorite ||
      !state.message ||
      !state.favoritesRuntime
    ) {
      return
    }
    let message = state.message
    const payload = state.richPayload
    if (payload && payload.assets && payload.assets.length) {
      await enrichRichPayloadAssetNames(payload, { resolveBilibiliNative: true })
      if (shared.isPlausibleMessage(payload.text, config.maxLength)) {
        message = payload.text
        if (payload === state.richPayload) {
          state.message = message
        }
      }
    }
    await state.favoritesRuntime.favoriteText(message, payload)
  }

  function renderActionBar() {
    if (state.ui) {
      state.ui.setActions(visibleActionsForSurface(state.settings, platformId, state.candidateKind))
    }
  }

  function freezeOverlayCandidate(candidate) {
    state.pausedAnimations =
      typeof candidate.getAnimations === 'function'
        ? candidate.getAnimations({ subtree: true }).map((animation) => ({
            animation,
            shouldResume: animation.playState === 'running',
          }))
        : []

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
    if (frozenClone) {
      frozenClone.remove()
      state.frozenClone = null
    }

    if (state.candidate && state.candidate.isConnected && state.originalVisibility) {
      if (state.originalVisibility.value) {
        state.candidate.style.setProperty(
          'visibility',
          state.originalVisibility.value,
          state.originalVisibility.priority,
        )
      } else {
        state.candidate.style.removeProperty('visibility')
      }
    }

    for (const item of state.pausedAnimations) {
      if (item.shouldResume) {
        try {
          item.animation.play()
        } catch {
          // Ignore animations removed by the site's danmaku renderer.
        }
      }
    }

    state.originalVisibility = null
    state.pausedAnimations = []
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
    const preferredLeft = rect.right + 8
    const fallbackLeft = rect.right - buttonRect.width - 4
    const left = preferredLeft + buttonRect.width <= innerWidth - 8 ? preferredLeft : fallbackLeft
    const top = rect.top + (rect.height - buttonRect.height) / 2

    state.actionBar.style.left = `${Math.max(8, Math.min(left, innerWidth - buttonRect.width - 8))}px`
    state.actionBar.style.top = `${Math.max(8, Math.min(top, innerHeight - buttonRect.height - 8))}px`
  }

  function selectCandidate(candidate, kind, allowNoVisibleActions) {
    const selectionStartedAt = performance.now()
    if (kind === 'overlay' && !isOverlayMessageElement(candidate)) {
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

    const richPayload = richPayloadFromCandidate(candidate)
    const message = (richPayload && richPayload.text) || textFromCandidate(candidate)
    if (!shared.isPlausibleMessage(message, config.maxLength)) {
      return false
    }
    cancelHide()
    clearSelection()
    state.candidate = candidate
    state.candidateKind = candidateKind
    state.message = message
    state.richPayload = richPayload
    state.selectedAt = Date.now()
    state.sender = ''
    candidate.classList.add('bcp-one-target')
    if (state.candidateKind === 'overlay') {
      freezeOverlayCandidate(candidate)
    }
    state.sender = senderFromCandidate(
      candidate,
      message,
      state.candidateKind,
      state.selectedAt,
      { scanDom: false },
    )

    ensureButton()
    state.ui.showActionBar(message, state.sender)
    requestAnimationFrame(updateButtonPosition)
    diagnostics.record({
      type: 'candidate.selected',
      stage: candidateKind,
      durationMs: performance.now() - selectionStartedAt,
      outcome: 'success',
    })
    return true
  }

  function clearSelection() {
    if (state.candidate && state.candidate.isConnected) {
      state.candidate.classList.remove('bcp-one-target')
    }

    unfreezeOverlayCandidate()
    state.candidate = null
    state.candidateKind = null
    state.message = ''
    state.sender = ''
    state.selectedAt = 0
    state.richPayload = null
    if (state.ui) state.ui.hideActionBar()
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

  function focusReplyInput(input, expectedValue) {
    const focus = () => {
      const editor = input.isConnected ? input : findInput({ reply: true })
      if (!editor || inputText(editor) !== expectedValue) {
        return
      }
      editor.focus({ preventScroll: true })
      placeCaretAtEnd(editor)
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
    const nextValue = shared.replyDraftValue(inputText(input), sender)
    setNativeValue(input, nextValue)
    clearSelection()
    focusReplyInput(input, nextValue)
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

  function platformEmojiToggleSelectors() {
    if (platformId === 'bilibili') return BILIBILI_EMOJI_TOGGLE_SELECTORS
    if (platformId === 'douyu') return DOUYU_EMOJI_TOGGLE_SELECTORS
    return HUYA_EMOJI_TOGGLE_SELECTORS
  }

  function platformEmojiSurfaceSelectors() {
    if (platformId === 'bilibili') return BILIBILI_EMOJI_SURFACE_SELECTORS
    if (platformId === 'douyu') return DOUYU_EMOJI_SURFACE_SELECTORS
    return HUYA_EMOJI_SURFACE_SELECTORS
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
    queryAllDeep(platformEmojiSurfaceSelectors()).forEach((surface) => {
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
    return results.slice(0, platformId === 'bilibili' ? 1200 : 500)
  }

  function findMatchingPlatformEmoji(asset, includeHidden = false) {
    let best = null
    let bestScore = 0
    platformEmojiItemCandidates(includeHidden).forEach((element) => {
      const score = assetMatchScore(element, asset)
      if (score > bestScore) {
        bestScore = score
        best = element
      }
    })
    if (!best || bestScore < 4) {
      return null
    }
    return platformEmojiInteractiveItem(best)
  }

  function platformEmojiInteractiveItem(element) {
    const interactive = element.closest("button,[role='button'],li")
    if (interactive) return interactive
    const parentItem =
      element.parentElement && element.parentElement.closest(PLATFORM_EMOJI_ITEM_SELECTORS.join(','))
    return parentItem || element.closest(PLATFORM_EMOJI_ITEM_SELECTORS.join(',')) || element
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
    queryAllDeep(platformEmojiSurfaceSelectors()).forEach((surface) => {
      if (
        (!includeHidden && !isVisible(surface)) ||
        closestMatching(surface, config.messages) ||
        closestMatching(surface, config.overlayMessages)
      )
        return
      surface.querySelectorAll(PLATFORM_EMOJI_CATEGORY_SELECTORS.join(',')).forEach((element) => {
        if (
          !(element instanceof Element) ||
          seen.has(element) ||
          (!includeHidden && !isVisible(element)) ||
          isOwned(element) ||
          element.getAttribute('aria-selected') === 'true'
        ) {
          return
        }
        seen.add(element)
        results.push(element)
      })
    })
    return results.slice(0, 16)
  }

  function findPlatformEmojiToggle(input, includeHidden = false) {
    const inputRect = input && input.getBoundingClientRect()
    const candidates = queryAllDeep(platformEmojiToggleSelectors()).filter(
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
        const distance = inputRect && visible
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
          (/(emoji|emoticon|emotion|face|表情)/i.test(marker) ? 500 : 0) -
          (visible ? 0 : 180) -
          Math.min(300, distance / 5)
        )
      }
      return score(second) - score(first)
    })
    return candidates[0] || null
  }

  async function waitForPlatformEmoji(asset, timeout) {
    const deadline = Date.now() + timeout
    let match = findMatchingPlatformEmoji(asset)
    while (!match && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      match = findMatchingPlatformEmoji(asset)
    }
    return match
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

  async function findPlatformEmojiAcrossCategories(asset) {
    let match = findMatchingPlatformEmoji(asset)
    if (match || platformId !== 'bilibili') return match

    for (const category of platformEmojiCategoryCandidates()) {
      if (!category.isConnected || typeof category.click !== 'function') continue
      category.click()
      match = await waitForPlatformEmoji(asset, 320)
      if (match) return match
    }

    // Some Bilibili builds keep every pack mounted and hide inactive packs
    // without exposing semantic tab markup. A programmatic click on the exact
    // hidden native item still runs Bilibili's own event handler.
    return findMatchingPlatformEmoji(asset, true)
  }

  async function openPlatformEmojiForAsset(input, asset) {
    let item = findMatchingPlatformEmoji(asset)
    if (item) return item
    const toggle = findPlatformEmojiToggle(input)
    if (toggle && typeof toggle.click === 'function') {
      toggle.click()
      state.emojiPanelOpenedByPlugin = true
      item = await waitForPlatformEmoji(asset, 900)
    }
    return item || findPlatformEmojiAcrossCategories(asset)
  }

  function countMatchingChatAssets(asset) {
    let count = 0
    queryAllDeep(config.messages)
      .slice(-120)
      .forEach((row) => {
        row.querySelectorAll('img').forEach((image) => {
          if (assetMatchScore(image, asset) >= 4) {
            count += 1
          }
        })
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

  async function waitForPlatformEmojiResult(
    input,
    asset,
    previousCount,
    previousInput,
    clickedItem,
    clickedItemWasVisible,
    timeout,
  ) {
    const deadline = Date.now() + timeout
    let dispatchedAt = 0
    while (Date.now() < deadline) {
      if (countMatchingChatAssets(asset) > previousCount) {
        return 'sent'
      }
      if (richInputFingerprint(input) !== previousInput && !richInputIsEmpty(input)) {
        return 'inserted'
      }
      if (
        clickedItemWasVisible &&
        clickedItem &&
        (!clickedItem.isConnected || !isVisible(clickedItem))
      ) {
        if (!dispatchedAt) dispatchedAt = Date.now()
        // Bilibili closes its native Emoji panel before committing a delayed
        // insert into the editor. Keep observing that native update window.
        if (platformId !== 'bilibili' || Date.now() - dispatchedAt >= 600) {
          return 'dispatched'
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    return 'none'
  }

  async function waitForPlatformEmojiSubmission(input, asset, previousCount, timeout) {
    const deadline = Date.now() + timeout
    let activeInput = input
    while (Date.now() < deadline) {
      if (countMatchingChatAssets(asset) > previousCount) {
        return { input: activeInput, sent: true }
      }
      if (!activeInput || !activeInput.isConnected) {
        activeInput = findInput()
      }
      if (activeInput && richInputIsEmpty(activeInput)) {
        return { input: activeInput, sent: true }
      }
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    return {
      input: activeInput,
      sent:
        countMatchingChatAssets(asset) > previousCount ||
        Boolean(activeInput && richInputIsEmpty(activeInput)),
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

  async function submitInsertedPlatformEmoji(input, asset, previousCount) {
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
      platformId === 'bilibili' ? 1200 : 600,
    )
    if (submission.sent) {
      return submission
    }

    activeInput = submission.input || activeInput
    if (activeInput) {
      pressEnter(activeInput)
      submission = await waitForPlatformEmojiSubmission(activeInput, asset, previousCount, 700)
      if (submission.sent) {
        return submission
      }
    }

    activeInput = submission.input || activeInput
    sendControl = await waitForPlatformSendButton(activeInput, 500)
    activeInput = sendControl.input || activeInput
    if (sendControl.button) {
      sendControl.button.click()
      submission = await waitForPlatformEmojiSubmission(activeInput, asset, previousCount, 900)
    }
    return submission
  }

  async function repeatPlatformRichPayload(payload) {
    const unicodeFallback = unicodeEmojiFallbackText(payload)
    if (unicodeFallback) {
      return repeatMessage(unicodeFallback)
    }
    const shouldResolveBilibiliSingleImage = Boolean(bilibiliFavoriteImagePayload(payload))
    if (
      platformId === 'bilibili' &&
      payload &&
      Array.isArray(payload.assets) &&
      payload.assets.length &&
      (fullscreenActive() || shouldResolveBilibiliSingleImage)
    ) {
      // Player-rendered image danmaku frequently exposes only its image URL.
      // Resolve it against Bilibili's own (hidden while fullscreen) Emoji
      // panel before deciding whether a lossless native-image send is possible.
      await enrichRichPayloadAssetNames(payload, { resolveBilibiliNative: true })
    }
    const bilibiliSingleImagePayload = bilibiliFavoriteImagePayload(payload)
    const bilibiliInlineText = bilibiliSingleImagePayload ? '' : bilibiliInlineEmojiText(payload)
    if (bilibiliInlineText) {
      return repeatMessage(bilibiliInlineText)
    }
    const asset = payload && Array.isArray(payload.assets) ? payload.assets[0] : null
    const nativeBilibiliAsset =
      platformId === 'bilibili' && isBilibiliNativePanelAsset(asset)
    if (bilibiliSingleImagePayload && !nativeBilibiliAsset) {
      showToast(
        t('toastOfficialEmojiNotUnique', bilibiliSingleImagePayload.text),
        'error',
      )
      return false
    }
    const now = Date.now()
    if (now - state.lastActionAt < 700) {
      showToast(t('toastActionTooFast'), 'warning')
      return false
    }
    state.lastActionAt = now
    const input = nativeBilibiliAsset ? findBilibiliEmojiEditor() || findInput() : findInput()
    if (!asset || !input) {
      showToast(t('toastImageResourceNotFound', platformName), 'error')
      return false
    }
    const item =
      nativeBilibiliAsset
        ? await openUniqueBilibiliPlatformEmoji(input, asset)
        : await openPlatformEmojiForAsset(input, asset)
    if (!item || typeof item.click !== 'function') {
      showToast(t('toastEmojiPanelNoMatch', platformName), 'error')
      return false
    }
    enrichRichPayloadAsset(payload, 0, item)
    const previousCount = countMatchingChatAssets(asset)
    const beforeInput = richInputFingerprint(input)
    const itemWasVisible = isVisible(item)
    item.click()
    const resultTimeout = platformId === 'bilibili' ? 2400 : 900
    let result = await waitForPlatformEmojiResult(
      input,
      asset,
      previousCount,
      beforeInput,
      item,
      itemWasVisible,
      resultTimeout,
    )
    if (result === 'inserted' && richInputFingerprint(input) !== beforeInput) {
      const submission = await submitInsertedPlatformEmoji(input, asset, previousCount)
      result = submission.sent ? 'sent' : 'none'
    }
    if (result === 'none' && platformId !== 'bilibili') {
      const button = findSendButton(input)
      if (button) {
        button.click()
        result = await waitForPlatformEmojiResult(
          input,
          asset,
          previousCount,
          beforeInput,
          item,
          itemWasVisible,
          900,
        )
      }
    }
    if (result !== 'sent') {
      showToast(t('toastImageUnconfirmed', platformName), 'error')
      return false
    }
    releaseInputFocus(input)
    showToast(t('toastImageEmojiSent'), 'success')
    return true
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
      const isSingleEmojiPart =
        meaningfulParts.length === 1 &&
        (meaningfulParts[0].type === 'emoji' ||
          (assets.length === 0 &&
            meaningfulParts[0].type === 'text' &&
            shared.normalizeWhitespace(meaningfulParts[0].text) === token))
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
    if (!asset || isBilibiliNativePanelAsset(asset)) return
    const identity = shared
      .normalizeWhitespace(asset.token || asset.src || 'resolved')
      .toLowerCase()
      .slice(0, 180)
    const marker = `${NATIVE_PANEL_ASSET_KEY_PREFIX}resolved:${identity}`
    asset.keys = Array.from(new Set([marker, ...(Array.isArray(asset.keys) ? asset.keys : [])])).slice(
      0,
      48,
    )
    const emojiPart = Array.isArray(payload.parts)
      ? payload.parts.find((part) => part && part.type === 'emoji' && part.asset)
      : null
    if (emojiPart && emojiPart.asset !== asset) {
      emojiPart.asset.keys = Array.from(
        new Set([marker, ...(Array.isArray(emojiPart.asset.keys) ? emojiPart.asset.keys : [])]),
      ).slice(0, 48)
    }
  }

  async function repeatBilibiliFavoritePayload(payload) {
    const imagePayload = bilibiliFavoriteImagePayload(payload)
    if (!imagePayload) {
      return payload.assets.length ? repeatPlatformRichPayload(payload) : repeatMessage(payload.text)
    }
    if (imagePayload.assets.some(isBilibiliNativePanelAsset)) {
      return repeatPlatformRichPayload(imagePayload)
    }

    const input = findBilibiliEmojiEditor() || findInput()
    if (!input) {
      showToast(t('toastEditorNotFound', platformName), 'error')
      return false
    }
    const item = await openUniqueBilibiliPlatformEmoji(input, imagePayload.assets[0])
    if (!item) {
      showToast(
        t('toastOfficialEmojiNotFound', imagePayload.text),
        'error',
      )
      return false
    }
    markBilibiliPayloadAsNativePanel(imagePayload, item)
    return repeatPlatformRichPayload(imagePayload)
  }

  async function repeatMessage(message) {
    const now = Date.now()
    if (now - state.lastActionAt < 700) {
      showToast(t('toastActionTooFast'), 'warning')
      return false
    }
    state.lastActionAt = now

    const input = findInput()
    if (!input) {
      showToast(t('toastEditorNotFound', platformName), 'error')
      return false
    }

    setNativeValue(input, message)
    await new Promise((resolve) => setTimeout(resolve, 80))
    let button = findSendButton(input)

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
      showToast(t('toastAutomaticSendFailed'), 'error')
      return false
    }

    releaseInputFocus(input)
    showToast(t('toastPlusOneSent'), 'success')
    return true
  }

  function onPlusOneClick(event) {
    event.preventDefault()
    event.stopPropagation()
    if (!visibleActionsForSurface(state.settings, platformId, state.candidateKind).plusOne) {
      return
    }
    const message = state.message
    const richPayload = state.richPayload
    diagnostics.record({ type: 'action.plus-one', stage: state.candidateKind || 'unknown' })
    if (richPayload && richPayload.assets.length) {
      repeatPlatformRichPayload(richPayload)
    } else if (message) {
      repeatMessage(message)
    }
    scheduleHide()
  }

  function onPointerOver(event) {
    if (!isEnabled()) {
      return
    }

    const path = event.composedPath ? event.composedPath() : [event.target]
    if (isOwned(event.target)) {
      return
    }

    if (isInsideFrozenHoverZone(event.clientX, event.clientY)) {
      cancelHide()
      return
    }

    const found = findCandidate(path)
    if (found && found.element !== state.candidate) {
      selectCandidate(found.element, found.kind)
    } else if (!found && platformId === 'bilibili') {
      if (
        pathTouchesBilibiliChatActions(path) ||
        pathTouchesBilibiliChatAdvertisement(path)
      ) {
        if (state.candidate) clearSelection()
        return
      }
      const elements = document.elementsFromPoint(event.clientX, event.clientY)
      const pointFound = findCandidate(elements)
      if (pointFound && pointFound.element !== state.candidate) {
        selectCandidate(pointFound.element, pointFound.kind)
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

    if (isOwned(event.target)) {
      cancelHide()
      return
    }

    state.pointerX = event.clientX
    state.pointerY = event.clientY

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
          selectCandidate(candidate, 'overlay')
        }
      } else if (state.candidateKind === 'overlay') {
        scheduleHide()
      }
    })
  }

  function onPointerOut(event) {
    if (!state.candidate) {
      return
    }

    const next = event.relatedTarget
    if (next && (state.candidate.contains(next) || isOwned(next))) {
      return
    }

    if (isInsideFrozenHoverZone(event.clientX, event.clientY)) {
      cancelHide()
      return
    }

    const path = event.composedPath ? event.composedPath() : [event.target]
    if (path.includes(state.candidate)) {
      scheduleHide()
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
    let found = findCandidate(path)
    if (!found) {
      const overlay = findOverlayAtPoint(event.clientX, event.clientY)
      found = overlay ? { element: overlay, kind: 'overlay' } : null
    }
    if (!found || !selectCandidate(found.element, found.kind, true)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    repeatMessage(state.message)
    scheduleHide()
  }

  function onViewportChange() {
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
    state.hideTimer = 0
    state.senderScanTimer = 0
    state.pointerFrame = 0
    state.senderObserver?.disconnect()
    state.senderObserver = null
    state.senderCorrelation.clear()
    state.roots = [document]
    state.rootsCachedAt = 0
    state.bilibiliOverlayCandidates = []
    state.bilibiliOverlayCandidatesCachedAt = 0
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
    state.ui?.destroy()
    document.removeEventListener('pointerover', onPointerOver, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerout', onPointerOut, true)
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
    ensurePortal()
    requestAnimationFrame(updateButtonPosition)
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
    syncDouyuNativeCapsuleRootAttribute()
    scanDouyuNativeDanmakuCapsules()
    shared.applyPlatformColors(document.documentElement, state.settings.colors[platformId])
    renderActionBar()
    if (!isEnabled()) {
      clearSelection()
    }
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
      const relevant = mutations.some((mutation) => {
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
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerout', onPointerOut, true)
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

import { resolveInterfaceScalePercent, screenResolution } from '../core/interface-scale'
import { isSupportedContentPlatform } from '../platforms/live/config'
import {
  shouldHideNativeDanmakuCapsule,
  visibleActionsForSurface,
} from '../platforms/live/action-visibility'
import { SenderIndex, type SenderIndexObservation } from '../platforms/live/sender-index'
import {
  clipInsetsWithinRect,
  intersectRectBounds,
  pointInsideRect,
} from '../platforms/live/overlay-viewport'
import {
  BILIBILI_EMOJI_SURFACE_SELECTORS,
  BILIBILI_EMOJI_TOGGLE_SELECTORS,
  BILIBILI_QUICK_BAR_SELECTORS,
  BILIBILI_QUICK_INPUTS,
} from '../platforms/bilibili/dom-config'
import { createBilibiliCandidateRules } from '../platforms/bilibili/candidate-rules'
import {
  bilibiliRichAssetMetadata,
  createBilibiliEmojiRecovery,
} from '../platforms/bilibili/rich-emoji'
import {
  createHuyaEmojiRecovery,
  huyaEmojiPanelToken,
  huyaRichAssetKeys,
} from '../platforms/huya/rich-emoji'
import { douyuEmojiToken } from '../platforms/douyu/rich-emoji'
import { DouyuSender } from '../platforms/douyu/sender'
import { HuyaSender } from '../platforms/huya/sender'
import { BilibiliOverlayMotionController } from '../platforms/bilibili/overlay-motion'
import { createRepeatReminderCandidateAdapter } from '../platforms/live/repeat-reminder-adapter'
import { isBilibiliDecorativeImageDescription } from '../platforms/bilibili/emoticon-metadata'
import { BilibiliSender } from '../platforms/bilibili/sender'
import {
  normalizedAssetKeys as normalizedRichAssetKeys,
  richPartsFromElement as parseRichPartsFromElement,
  type RichEmojiAsset,
  type RichMessagePart,
  type RichMessagePayload,
} from '../platforms/live/rich-message'
import { createFavoritesRuntime } from '../features/favorites/launcher'
import { currentRoomContext } from '../features/favorites/room-context'
import { createRepeatReminderRuntime } from '../features/repeat-reminder/runtime'
import {
  eventTouchesRepeatReminder,
  pointTouchesRepeatReminder,
} from '../features/repeat-reminder/pointer-guard'
import { copyTextToClipboard } from '../core/clipboard'
import { createDiagnosticsCollector } from '../core/diagnostics'
import { createLivePlatformAdapter } from '../platforms/live/adapters'
import { LiveTextSender } from '../platforms/live/text-sender'
import { formatPlatformSendFeedback, type SendBlock } from '../platforms/live/send-protection'
import { SendCoordinator } from '../platforms/live/send-coordinator'
import {
  BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES,
  EDITABLE_CONTROL_SELECTOR,
  EMOJI_DISPLAY_ATTRIBUTES,
  EMOJI_METADATA_ATTRIBUTES,
  PLATFORM_EMOJI_CATEGORY_SELECTORS,
  PLATFORM_EMOJI_ITEM_SELECTORS,
  TEXT_EDITOR_SELECTOR,
} from '../platforms/live/editor-config'
import {
  dispatchEditorEnter as pressEnter,
  readEditorText as inputText,
} from '../platforms/live/editor-dom'
import { EditorController, type EditorFindOptions } from '../platforms/live/editor-controller'
import {
  createHoverSelectionController,
  type HoverPoint,
} from '../platforms/live/hover-selection-controller'
import { CapsuleController } from '../platforms/live/capsule-controller'
import { LiveContentRuntime } from '../platforms/live/live-content-runtime'
import {
  ACTIVE_MEDIA_SELECTOR,
  containsActiveMediaDeep,
  createInertOverlaySnapshot,
  inertSnapshotSkipSelector,
} from '../platforms/live/inert-snapshot'
import { t } from '../core/i18n'
import {
  closestFromPath,
  closestMatching,
  composedParentElement,
  matchesAny,
  queryAllDeep as queryDeepRoots,
  queryDocumentElements as queryDocumentRoot,
  refreshRoots as refreshDeepRoots,
} from '../platforms/live/deep-dom'
import {
  elementMarker,
  isElementVisible,
  type SerializeElementTextOptions,
  serializedTextFromElement as serializeElementText,
} from '../platforms/live/element-text'
import type { LiveCandidateKind } from '../platforms/live/candidate-adapter'
import type { RectBounds } from '../platforms/live/overlay-viewport'
import type {
  InlineStyleSnapshot,
  LiveContentRuntimeState,
  PausedAnimationSnapshot,
} from '../platforms/live/runtime-state'

export function startLiveContentApp(): void {
  'use strict'

  const sharedCandidate = globalThis.DanmakuEchoShared
  if (!sharedCandidate || globalThis.__bulletPlusOneLoaded) {
    return
  }
  const shared = sharedCandidate
  const detectedPlatform = shared.detectPlatform(location.hostname, location.pathname)
  if (!isSupportedContentPlatform(detectedPlatform)) return
  const platformId = detectedPlatform

  globalThis.__bulletPlusOneLoaded = true

  const platformName = t(
    platformId === 'bilibili'
      ? 'platformBilibili'
      : platformId === 'douyu'
        ? 'platformDouyu'
        : 'platformHuya',
  )
  const platformAdapter = createLivePlatformAdapter(platformId)
  const config = platformAdapter.config
  const douyuBoundary = platformAdapter.douyu || null
  const douyuOverlayTextElements = (candidate: Element): Element[] =>
    douyuBoundary?.overlayTextElements(candidate) || []
  const bilibiliCandidateRules =
    platformId === 'bilibili' ? createBilibiliCandidateRules({ config }) : null
  const INERT_SNAPSHOT_SKIP_SELECTOR = inertSnapshotSkipSelector([
    ...(douyuBoundary ? [`[${douyuBoundary.actionMarker}]`, ...douyuBoundary.actionSelectors] : []),
    ...(douyuBoundary ? douyuBoundary.capsuleDecorationSelectors : []),
  ])
  const DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS = douyuBoundary?.actionSelectors || []
  const DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTORS =
    douyuBoundary?.capsuleContainerSelectors || []
  const DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS =
    douyuBoundary?.capsuleDetachedDecorationSelectors || []
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
  const state: LiveContentRuntimeState = {
    settings: shared.mergeSettings(),
    candidate: null,
    candidateKind: null,
    message: '',
    sender: '',
    selectedAt: 0,
    senderIndex: new SenderIndex(),
    douyuNativeCapsuleMutationRoots: new Set(),
    richPayload: null,
    overlayHydratedId: -1,
    overlayHydrationId: 0,
    overlayHydrationTimer: 0,
    cooldownTimer: 0,
    sendCoordinator: new SendCoordinator({
      onBlock: showSendBlock,
      onFeedback(feedback, _message) {
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
      },
      onStateChange: updateCooldownUi,
      onUnconfirmed(summary) {
        showToast(t('toastPlatformSendUnconfirmed', [platformName, summary]), 'error')
      },
      platform: platformId,
    }),
    roots: [document],
    rootsCachedAt: 0,
    frozenClone: null,
    favoritesRuntime: null,
    originalVisibility: null,
    pausedAnimations: [],
    overlayViewport: null,
    pointerX: 0,
    pointerY: 0,
    bilibiliOverlayCandidates: [],
    bilibiliOverlayCandidatesCachedAt: 0,
    hiddenBilibiliQuickBars: new Map(),
    bilibiliDismissToken: 0,
    repeatReminderRuntime: null,
  }
  const actionSurface = (kind: LiveCandidateKind | null): 'chat' | 'overlay' | null =>
    kind === 'native-capsule' ? 'overlay' : kind
  const diagnostics = createDiagnosticsCollector({
    platform: platformId,
    featureFlags: () => state.settings,
    cacheCounts: () => ({
      senderIndex: state.senderIndex.size,
      roots: state.roots.length,
      bilibiliOverlayCandidates: state.bilibiliOverlayCandidates.length,
      hiddenBilibiliQuickBars: state.hiddenBilibiliQuickBars.size,
    }),
    observerCounts: () => ({
      sender: state.senderIndex.active ? 1 : 0,
      timers: Number(state.senderIndex.scheduled) + Number(Boolean(state.overlayHydrationTimer)),
    }),
    selectorHits: () => ({
      chatRoot: queryAllDeep(config.chatRoots).length > 0,
      input: queryAllDeep(config.inputs).length > 0,
      videoRoot: queryAllDeep(config.videoRoots).length > 0,
    }),
  })
  const douyuNativeHover = douyuBoundary?.hover || null
  const douyuNativeMotionFallback = douyuBoundary?.motionFallback || null
  const bilibiliOverlayMotion =
    platformId === 'bilibili' ? new BilibiliOverlayMotionController() : null
  const overlayMessageCache = new WeakMap<
    Element,
    { cachedAt: number; message: string; signature: string }
  >()
  const repeatReminderAdapter = createRepeatReminderCandidateAdapter({
    describe: platformAdapter.describe,
    exclusionReason: platformAdapter.repeatReminderExclusionReason,
    maxLength: config.maxLength,
    roomKey: () => currentRoomContext(platformId).roomKey,
    suppressText(text) {
      state.repeatReminderRuntime?.suppressText(text)
    },
  })
  const isVisible = isElementVisible
  const isBilibiliSideChatEditor = (element: Element) =>
    bilibiliCandidateRules?.isSideChatEditor(element) ?? false
  const isBilibiliQuickInputRegion = (element: Element) =>
    bilibiliCandidateRules?.isQuickInputRegion(element) ?? false
  const pathTouchesBilibiliQuickInput = (path: readonly EventTarget[]) =>
    bilibiliCandidateRules?.pathTouchesQuickInput(path) ?? false
  const pathTouchesBilibiliChatActions = (path: readonly EventTarget[]) =>
    bilibiliCandidateRules?.pathTouchesChatActions(path) ?? false
  const isBilibiliChatAdvertisement = (element: Element) =>
    bilibiliCandidateRules?.isChatAdvertisement(element) ?? false
  const pathTouchesBilibiliChatAdvertisement = (path: readonly EventTarget[]) =>
    bilibiliCandidateRules?.pathTouchesChatAdvertisement(path) ?? false
  const isInsideBilibiliVideoOverlay = (element: Element) =>
    bilibiliCandidateRules?.isInsideVideoOverlay(element) ?? false
  const isInsideBilibiliPlayerOutsideChat = (element: Element) =>
    bilibiliCandidateRules?.isInsidePlayerOutsideChat(element) ?? false
  const replyController = new EditorController({
    activateQuickInput: activateBilibiliQuickInput,
    clearSelection,
    closest: closestMatching,
    config,
    fullscreenActive,
    fullscreenElement,
    invalidateRoots() {
      state.rootsCachedAt = 0
    },
    isQuickInput: isBilibiliQuickInputRegion,
    isVisible,
    onFailure(reason) {
      showToast(
        reason === 'sender-unknown'
          ? t('toastSenderUnknown')
          : t('toastEditorNotFound', platformName),
        'error',
      )
    },
    platform: platformId,
    query: queryAllDeep,
    resolveSender(selection, scanDom) {
      return senderFromCandidate(
        selection.candidate,
        selection.message,
        selection.kind,
        selection.selectedAt,
        { scanDom },
      )
    },
  })
  const textSender = new LiveTextSender({
    coordinator: state.sendCoordinator,
    document,
    findInput,
    findSendButton,
    platformName,
    pressEnter,
    releaseInputFocus,
    setNativeValue,
    showToast,
    waitForInputConsumption,
  })
  const bilibiliSender = new BilibiliSender({
    assetDescriptor: assetDescriptorFromElement,
    assetMatchScore,
    completeEmojiTokens: bilibiliCompleteEmojiTokens,
    coordinator: state.sendCoordinator,
    countChatImageMessages,
    countMatchingAssets: countMatchingPlatformEmojiAssets,
    createTokenAsset: (token) => ({
      keys: normalizedRichAssetKeys(token, location.href),
      src: '',
      token,
    }),
    emojiTokenQuality,
    emojiCategories: platformEmojiCategoryCandidates,
    emojiItems: platformEmojiItemCandidates,
    emojiToggles: platformEmojiToggleCandidates,
    enrichAsset: enrichRichPayloadAsset,
    findEmojiEditor: findBilibiliEmojiEditor,
    findInput,
    findSendButton,
    fullscreenActive,
    isGenericEmojiLabel,
    inputFingerprint: richInputFingerprint,
    inputIsEmpty: richInputIsEmpty,
    interactiveEmojiItem: platformEmojiInteractiveItem,
    isVisible,
    normalizeEmojiToken: (value) => normalizedEmojiToken(value, 'emoji'),
    pressEnter,
    platformName,
    releaseInputFocus,
    refreshPayloadText: refreshRichPayloadText,
    setNativeValue,
    showToast,
    submitInsertedEmoji: submitInsertedPlatformEmoji,
    textSender,
    updateCooldown: updateCooldownUi,
    waitForEmojiResult: waitForPlatformEmojiResult,
    waitForInputConsumption,
    waitForNewEcho: waitForNewPlatformEmojiEcho,
  })
  const douyuSender = new DouyuSender({
    assetMatchScore,
    coordinator: state.sendCoordinator,
    countChatImageMessages,
    countMatchingAssets: countMatchingPlatformEmojiAssets,
    emojiCategories: platformEmojiCategoryCandidates,
    emojiItems: platformEmojiItemCandidates,
    emojiToggles: platformEmojiToggleCandidates,
    findInput,
    fullscreenActive,
    inputFingerprint: richInputFingerprint,
    interactiveEmojiItem: platformEmojiInteractiveItem,
    isVisible,
    platformName,
    refreshPayloadText: refreshRichPayloadText,
    releaseInputFocus,
    showToast,
    submitInsertedEmoji: submitInsertedPlatformEmoji,
    textSender,
    waitForEmojiResult: waitForPlatformEmojiResult,
  })
  const huyaSender = new HuyaSender({
    completeEmojiTokens: huyaCompleteEmojiTokens,
    platformName,
    refreshPayloadText: refreshRichPayloadText,
    showToast,
    textSender,
  })
  const platformSender =
    platformId === 'bilibili' ? bilibiliSender : platformId === 'douyu' ? douyuSender : huyaSender
  diagnostics.record({ type: 'runtime.initialized', stage: 'content' })

  function storageGet(): Promise<Record<string, unknown>> {
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

  function isOwned(node: unknown): boolean {
    return node instanceof Element && Boolean(node.closest('[data-bcp-one-owned]'))
  }

  function refreshRoots(): Array<Document | ShadowRoot> {
    const cache = { cachedAt: state.rootsCachedAt, roots: state.roots }
    const roots = refreshDeepRoots(document, cache)
    state.roots = roots
    state.rootsCachedAt = cache.cachedAt
    return roots
  }

  function queryAllDeep(selectors: readonly string[]): Element[] {
    return queryDeepRoots(refreshRoots(), selectors)
  }

  function queryDocumentElements(selectors: readonly string[]): Element[] {
    return queryDocumentRoot(document, selectors)
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
    const seen = new Set<Element>()
    state.bilibiliOverlayCandidates = queryDocumentElements(config.overlayMessages)
      .map(normalizeOverlayCandidate)
      .filter((element): element is Element => {
        if (!element) return false
        if (!element.isConnected || isOwned(element) || seen.has(element)) return false
        seen.add(element)
        return true
      })
      .slice(-BILIBILI_OVERLAY_CACHE_LIMIT)
    state.bilibiliOverlayCandidatesCachedAt = now
    return state.bilibiliOverlayCandidates
  }

  function serializedTextFromElement(
    root: Element,
    options?: Partial<SerializeElementTextOptions> & { imageTokens?: boolean },
  ): string {
    return serializeElementText(root, {
      imageToken: options?.imageTokens ? emojiTokenFromImage : undefined,
      maxLength: config.maxLength,
      rejectRoot: Boolean(options?.rejectRoot),
      removals: Array.isArray(options?.removals) ? options.removals : [],
    })
  }

  function findChatRoot(path: readonly EventTarget[]): Element | null {
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

  function findCandidate(
    path: readonly EventTarget[],
  ): { element: Element; kind: LiveCandidateKind } | null {
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
      const text = shared.normalizeWhitespace(
        (node instanceof HTMLElement ? node.innerText : '') || node.textContent,
      )
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

  function overlayViewportRect(candidate: Element): RectBounds | null {
    if (!(candidate instanceof Element)) return null

    const rootRects: DOMRect[] = []
    let current: Element | null = candidate
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

  function pointInsideOverlayViewport(candidate: Element | null, x: number, y: number): boolean {
    const viewport =
      candidate === state.candidate && state.overlayViewport
        ? state.overlayViewport
        : candidate
          ? overlayViewportRect(candidate)
          : null
    return pointInsideRect(viewport, x, y)
  }

  function richEmojiMessageForValidation(element: Element): string {
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

  function overlayRichEmojiMessageForValidation(element: Element): string {
    if (!(element instanceof Element) || !element.querySelector('img')) return ''
    const payload = richPayloadFromCandidate(element)
    const hasImageIdentity = payload.assets.some(
      (asset) => asset && Array.isArray(asset.keys) && asset.keys.length > 0,
    )
    return hasImageIdentity && shared.isPlausibleMessage(payload.text, config.maxLength)
      ? payload.text
      : ''
  }

  function overlayMessageSignature(element: Element): string {
    if (!(element instanceof Element)) return ''
    const images = element.getElementsByTagName('img')
    const imageIdentity: string[] = []
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

  function overlayMessageForValidation(element: Element): string {
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

  function normalizeOverlayCandidate(element: Element | null): Element | null {
    if (platformId !== 'bilibili' || !(element instanceof Element)) {
      return element
    }
    const row = element.matches(BILIBILI_OVERLAY_ROW_SELECTOR)
      ? element
      : element.closest(BILIBILI_OVERLAY_ROW_SELECTOR)
    return row || element
  }

  function isOverlayMessageElement(element: Element | null): boolean {
    if (!(element instanceof Element) || isOwned(element) || !element.isConnected) {
      return false
    }

    // Douyu reuses danmuItem-like class names in some side-chat revisions.
    // A node mounted in the chat column must never inherit overlay behavior,
    // otherwise it bypasses the independently disabled side-chat capsule.
    if (platformId === 'douyu' && closestMatching(element, config.chatRoots)) {
      return false
    }

    if (bilibiliCandidateRules && !bilibiliCandidateRules.isRenderedOverlay(element)) return false

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

  function isGenericOverlayElement(element: Element): boolean {
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

  function isInsideFrozenHoverZone(x: number, y: number): boolean {
    const frozenTarget = state.frozenClone?.isConnected
      ? state.frozenClone
      : platformId === 'douyu' && state.candidate?.isConnected
        ? state.candidate
        : null
    return Boolean(
      state.candidateKind === 'overlay' &&
      frozenTarget &&
      pointInsideOverlayViewport(state.candidate, x, y) &&
      pointInsideRect(frozenTarget.getBoundingClientRect(), x, y, OVERLAY_HOVER_PADDING),
    )
  }

  function isInsideSelectedHoverBody(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false
    return Boolean(state.candidate?.contains(target) || capsuleController.contains(target))
  }

  function douyuOverlayCandidateFromTarget(target: EventTarget | null): HTMLElement | null {
    if (platformId !== 'douyu' || !(target instanceof Element)) return null
    const candidate = closestMatching(target, config.overlayMessages)
    return candidate instanceof HTMLElement && !isOwned(candidate) ? candidate : null
  }

  function douyuOverlayCandidateFromPath(path: readonly EventTarget[]): HTMLElement | null {
    if (platformId !== 'douyu') return null
    const candidate = closestFromPath(path, config.overlayMessages)
    return candidate instanceof HTMLElement && !isOwned(candidate) ? candidate : null
  }

  function findOverlayAtPoint(x: number, y: number): Element | null {
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
    const exactHits: Array<{ candidate: Element; index: number; score: number }> = []

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

  function textFromSpecificElement(candidate: Element): string {
    if (platformId === 'douyu' && candidate instanceof Element) {
      const segments = douyuOverlayTextElements(candidate)
      if (segments.length > 1) {
        const text = shared.parseMessageText(
          segments
            .map(
              (element) =>
                (element instanceof HTMLElement ? element.innerText : '') ||
                element.textContent ||
                '',
            )
            .join(''),
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
          (element instanceof HTMLElement ? element.innerText : '') || element.textContent,
          config.maxLength,
        )
        if (shared.isPlausibleMessage(text, config.maxLength)) {
          return text
        }
      }
    }

    return ''
  }

  function emojiMetadataElements(element: Element, image: HTMLImageElement | null): Element[] {
    const elements: Element[] = []
    const seen = new Set<Element>()
    const append = (candidate: Element | null) => {
      if (!(candidate instanceof Element) || seen.has(candidate)) return
      seen.add(candidate)
      elements.push(candidate)
    }
    append(image)
    append(element)

    let current = (image || element).parentElement
    for (let depth = 0; current && depth < 12; depth += 1) {
      const currentElement = current
      const marker = elementMarker(currentElement)
      if (
        /(?:emoji|emote|emoticon|emotion|face|sticker|表情)/i.test(marker) ||
        EMOJI_METADATA_ATTRIBUTES.some((attribute) => currentElement.hasAttribute(attribute)) ||
        (platformId === 'bilibili' && currentElement.getAttribute('data-type') === '1')
      ) {
        append(currentElement)
      }
      const isMessageBoundary =
        closestMatching(currentElement, config.messages) === currentElement ||
        closestMatching(currentElement, config.overlayMessages) === currentElement
      const hasBilibiliImageIdentity =
        platformId === 'bilibili' &&
        (currentElement.getAttribute('data-type') === '1' ||
          BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES.some((attribute) =>
            currentElement.hasAttribute(attribute),
          ))
      if (isMessageBoundary && (platformId !== 'bilibili' || hasBilibiliImageIdentity)) {
        break
      }
      current = currentElement.parentElement
    }
    return elements
  }

  function isGenericEmojiLabel(value: unknown): boolean {
    const normalized = shared.normalizeWhitespace(value).replace(/^\[|\]$/g, '')
    return /^(?:图片|图片表情|表情|表情包|emoji|emote|emoticon|image|sticker)$/i.test(normalized)
  }

  function normalizedEmojiToken(value: unknown, marker: string): string {
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

  function emojiTokenFromElement(element: Element): string {
    if (!(element instanceof Element)) return ''
    const image = element instanceof HTMLImageElement ? element : element.querySelector('img')
    const douyuRelToken =
      platformId === 'douyu' && image
        ? douyuEmojiToken(image, normalizedEmojiToken, elementMarker)
        : ''
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

  function emojiTokenFromImage(image: HTMLImageElement): string {
    return emojiTokenFromElement(image)
  }

  function assetDescriptorFromElement(element: Element): RichEmojiAsset | null {
    if (!(element instanceof Element)) {
      return null
    }
    const image = element instanceof HTMLImageElement ? element : element.querySelector('img')
    const metadataElements = emojiMetadataElements(element, image)
    const sources: string[] = []
    const displayMetadata: string[] = []
    const identityMetadata: string[] = []
    metadataElements.forEach((metadataElement) => {
      const sourceValues = [
        metadataElement instanceof HTMLImageElement && metadataElement.currentSrc,
        metadataElement.getAttribute('src'),
        metadataElement.getAttribute('data-src'),
        metadataElement.getAttribute('data-url'),
        metadataElement.getAttribute('data-image'),
        metadataElement.getAttribute('data-image-url'),
      ]
      sourceValues
        .filter((value): value is string => Boolean(value))
        .forEach((value) => sources.push(value))
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
    const bilibiliMetadata =
      platformId === 'bilibili'
        ? bilibiliRichAssetMetadata({ displayMetadata, metadataElements, sources })
        : null
    const token =
      bilibiliMetadata?.token ||
      (platformId === 'huya' ? huyaEmojiPanelToken(element, normalizedEmojiToken) : '') ||
      (platformId === 'douyu'
        ? douyuEmojiToken(element, normalizedEmojiToken, elementMarker)
        : '') ||
      emojiTokenFromElement(element)
    const keys = new Set<string>()
    if (platformId === 'huya') {
      huyaRichAssetKeys(metadataElements, sources, elementMarker).forEach((key) => keys.add(key))
    }
    bilibiliMetadata?.keys.forEach((key) => keys.add(key))
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

  function messageEmojiImages(candidate: Element, messageElement: Element): HTMLImageElement[] {
    const messageContainsImage =
      messageElement instanceof HTMLImageElement || Boolean(messageElement.querySelector('img'))
    const roots =
      candidate === messageElement || (platformId === 'bilibili' && messageContainsImage)
        ? [messageElement]
        : [messageElement, candidate]
    const images: HTMLImageElement[] = []
    const seen = new Set<HTMLImageElement>()
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
      let current: Element | null = image
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

  function messageElementFromCandidate(candidate: Element): Element {
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

  function richPayloadFromCandidate(candidate: Element): RichMessagePayload {
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
        const parts: RichMessagePart[] = []
        segments.forEach((segment) => {
          richPartsFromElement(segment).forEach((part) => {
            const previous = parts[parts.length - 1]
            if (part.type === 'text' && previous?.type === 'text') previous.text += part.text
            else parts.push(part)
          })
        })
        const assets = parts
          .filter(
            (part): part is Extract<RichMessagePart, { type: 'emoji' }> => part.type === 'emoji',
          )
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
      .filter((asset): asset is RichEmojiAsset => Boolean(asset))
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

  const bilibiliEmojiRecovery = createBilibiliEmojiRecovery({
    assetDescriptor: assetDescriptorFromElement,
    assetMatchScore,
    isAdvertisement: isBilibiliChatAdvertisement,
    isOwned,
    listMessageImages: messageEmojiImages,
    listRows: () => queryAllDeep(config.messages),
    merge: mergeEmojiAssetMetadata,
    messageElement: messageElementFromCandidate,
  })
  const huyaEmojiRecovery = createHuyaEmojiRecovery({
    assetDescriptor: assetDescriptorFromElement,
    assetMatchScore,
    isGenericLabel: isGenericEmojiLabel,
    isOwned,
    listMessageImages: messageEmojiImages,
    listRows: () => queryAllDeep(config.messages),
    merge: mergeEmojiAssetMetadata,
    messageElement: messageElementFromCandidate,
    refresh: refreshRichPayloadText,
    tokenQuality: emojiTokenQuality,
  })

  function bilibiliCompleteEmojiTokens(payload: RichMessagePayload): void {
    if (platformId === 'bilibili') bilibiliEmojiRecovery.complete(payload)
  }

  function huyaCompleteEmojiTokens(payload: RichMessagePayload): void {
    if (platformId === 'huya') huyaEmojiRecovery.complete(payload)
  }

  function richPartsFromElement(element: Element): RichMessagePart[] {
    return parseRichPartsFromElement({
      assetFromImage: assetDescriptorFromElement,
      element,
      removals: [
        'button',
        'svg',
        "[aria-hidden='true']",
        '[data-bcp-one-owned]',
        ...config.userNames,
      ],
    })
  }

  function assetMatchScore(element: Element, asset: RichEmojiAsset): number {
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

  function emojiTokenQuality(value: unknown): number {
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

  function mergeEmojiAssetMetadata(target: RichEmojiAsset, source: RichEmojiAsset): RichEmojiAsset {
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

  function enrichRichPayloadAsset(
    payload: RichMessagePayload,
    assetIndex: number,
    item: Element,
  ): void {
    const source = assetDescriptorFromElement(item)
    const asset = payload && Array.isArray(payload.assets) ? payload.assets[assetIndex] : null
    if (!source || !asset) return
    mergeEmojiAssetMetadata(asset, source)
    const emojiParts = payload.parts.filter(
      (part): part is Extract<RichMessagePart, { type: 'emoji' }> => part.type === 'emoji',
    )
    if (emojiParts[assetIndex]) {
      mergeEmojiAssetMetadata(emojiParts[assetIndex].asset, source)
    }
  }

  function refreshRichPayloadText(payload: RichMessagePayload): string {
    if (!payload || !Array.isArray(payload.assets) || !payload.assets.length) return ''
    const parts = Array.isArray(payload.parts) ? payload.parts : []
    let unresolvedEmoji = false
    const resolvedText = parts.length
      ? parts
          .map((part) => {
            if (part.type === 'text') return String(part.text || '')
            if (part.type === 'emoji') {
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

  function richTextFromElement(element: Element): string {
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

  function textFromCandidate(candidate: Element): string {
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

  function senderFromRecordAttribute(element: Element, attribute: string): string {
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

  function senderFromElement(element: Element): string {
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
    const rowText = shared.normalizeWhitespace(
      (element instanceof HTMLElement ? element.innerText : '') || element.textContent,
    )
    const prefix = rowText.match(/^([^：:\n]{1,64})[：:]\s*/u)
    return shared.normalizeSenderName(prefix && prefix[1])
  }

  function messageIdsFromElement(element: Element): string[] {
    const ids = new Set<string>()
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

  function replyMessageValues(message: string, richPayload: RichMessagePayload | null): string[] {
    return [
      message,
      richPayload && richPayload.text,
      shared.parseMessageText(message, config.maxLength),
    ].filter((value): value is string => Boolean(value))
  }

  function senderFromChatContext(candidate: Element): string {
    let current: Element | null = candidate
    let boundary: Element = candidate
    let boundaryCursor: Element | null = current
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

  function senderObservationFromRow(
    row: Element,
    observedAt = Date.now(),
    now = Date.now(),
  ): SenderIndexObservation | null {
    if (!(row instanceof Element) || isOwned(row) || isBilibiliChatAdvertisement(row)) return null
    const richPayload = richPayloadFromCandidate(row)
    const message = (richPayload && richPayload.text) || textFromCandidate(row)
    const sender = senderFromChatContext(row)
    if (!sender || !shared.isPlausibleMessage(message, config.maxLength)) return null
    return {
      ids: messageIdsFromElement(row),
      messages: replyMessageValues(message, richPayload),
      node: row,
      now,
      observedAt,
      sender,
    }
  }

  function senderObservations(): SenderIndexObservation[] {
    const now = Date.now()
    const rows = messageRows().slice(-160)
    const observations = rows
      .map((row, index) => senderObservationFromRow(row, now - (rows.length - index) * 8, now))
      .filter((observation): observation is SenderIndexObservation => Boolean(observation))
    markDouyuOwnMessages()
    return observations
  }

  function senderObservationsFromRemovedNode(node: Node): SenderIndexObservation[] {
    if (!(node instanceof Element) || isInsideBilibiliPlayerOutsideChat(node)) return []
    let rows: Element[] = []
    try {
      rows = matchesAny(node, config.messages)
        ? [node]
        : Array.from(node.querySelectorAll(config.messages.join(',')))
    } catch {
      return []
    }
    const now = Date.now()
    return rows
      .map((row) => senderObservationFromRow(row, now, now))
      .filter((observation): observation is SenderIndexObservation => Boolean(observation))
  }

  function currentDouyuUserName(): string {
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

  function douyuNativeCapsuleBoundary(element: Element): Element {
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
      douyuBoundary?.capsuleVisibility.showAll()
      state.douyuNativeCapsuleMutationRoots.clear()
      return
    }

    douyuBoundary?.capsuleVisibility.releaseDisconnected()
    douyuBoundary?.capsuleVisibility.reinforce()
    const actionElements = queryAllDeep(DOUYU_NATIVE_DANMAKU_ACTION_SELECTORS).filter(
      (element) => !isOwned(element),
    )
    const roots = new Set<Element>(
      queryAllDeep(config.overlayMessages)
        .slice(-160)
        .map((element) => element.closest("[class*='danmuItem-']") || element)
        .filter((element) => !isOwned(element)),
    )
    actionElements.forEach((action) => {
      roots.add(douyuNativeCapsuleBoundary(action))
    })
    state.douyuNativeCapsuleMutationRoots.forEach((root) => {
      if (root instanceof Element && root.isConnected && !isOwned(root)) roots.add(root)
    })
    state.douyuNativeCapsuleMutationRoots.clear()

    const activeTargets = new Set<Element>()
    actionElements.forEach((target) => activeTargets.add(target))
    queryAllDeep(DOUYU_NATIVE_DANMAKU_CAPSULE_CONTAINER_SELECTORS)
      .filter((element) => !isOwned(element))
      .forEach((target) => activeTargets.add(target))
    queryAllDeep(DOUYU_NATIVE_DANMAKU_CAPSULE_DETACHED_DECORATION_SELECTORS)
      .filter((element) => !isOwned(element))
      .forEach((target) => activeTargets.add(target))
    roots.forEach((root) => {
      douyuBoundary?.capsuleTargets(root).forEach((target) => {
        if (!isOwned(target)) activeTargets.add(target)
      })
    })
    douyuBoundary?.capsuleVisibility.hide(activeTargets)
  }

  function mutationContainsDouyuNativeDanmakuCapsule(mutation: MutationRecord): boolean {
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

    const elements: Element[] = []
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
          state.douyuNativeCapsuleMutationRoots.add(
            container || douyuNativeCapsuleBoundary(action as Element),
          )
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

  function markDouyuOwnMessages(): void {
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

  function senderFromCandidate(
    candidate: Element,
    message: string,
    kind: LiveCandidateKind,
    observedAt: number,
    options?: { scanDom?: boolean },
  ): string {
    const scanDom = !options || options.scanDom !== false
    const direct = kind === 'chat' ? senderFromChatContext(candidate) : senderFromElement(candidate)
    const values = replyMessageValues(message, state.richPayload)
    const ids = messageIdsFromElement(candidate)
    return state.senderIndex.resolve({
      directSender: direct,
      ids,
      messages: values,
      observedAt: observedAt || Date.now(),
      refresh: scanDom && !direct,
    })
  }

  type WebkitFullscreenDocument = Document & { webkitFullscreenElement?: Element | null }

  function fullscreenElement(): Element | null {
    return (
      document.fullscreenElement ||
      (document as WebkitFullscreenDocument).webkitFullscreenElement ||
      null
    )
  }

  function fullscreenActive(): boolean {
    if (fullscreenElement()) {
      return true
    }
    try {
      const topDocument = window.top && window.top.document
      return Boolean(
        topDocument &&
        (topDocument.fullscreenElement ||
          (topDocument as WebkitFullscreenDocument).webkitFullscreenElement),
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

  const capsuleController = new CapsuleController({
    anchor: () =>
      state.candidate && state.candidateKind
        ? {
            candidate: state.candidate,
            kind: state.candidateKind,
            overlayViewport: state.overlayViewport,
            positionTarget: state.frozenClone || state.candidate,
          }
        : null,
    callbacks: {
      onCopy: onCopyActionClick,
      onFavorite: onFavoriteActionClick,
      onPlaceholder: onPlaceholderActionClick,
      onPlusOne: onPlusOneClick,
      onPointerEnter: cancelHide,
      onPointerLeave: () => scheduleHide(),
    },
    document,
    fullscreenHost: fullscreenElement,
    viewport: () => ({
      bottom: innerHeight,
      height: innerHeight,
      left: 0,
      right: innerWidth,
      top: 0,
      width: innerWidth,
    }),
  })

  function ensurePortal(): HTMLElement {
    return capsuleController.ensure()
  }

  function ensureButton(): HTMLElement {
    renderActionBar()
    return capsuleController.ensure()
  }

  function onPlaceholderActionClick(event: MouseEvent, action: 'reply'): void {
    event.preventDefault()
    event.stopPropagation()
    cancelHide()
    if (action === 'reply') {
      if (
        !state.candidateKind ||
        !visibleActionsForSurface(state.settings, platformId, actionSurface(state.candidateKind))
          .reply
      )
        return
      if (!state.candidate || !state.candidateKind) return
      const candidate = state.candidate
      ensureSelectedOverlayHydrated()
      if (candidate !== state.candidate) return
      const selection = {
        candidate: state.candidate,
        kind: state.candidateKind,
        message: state.message,
        richPayload: state.richPayload,
        selectedAt: state.selectedAt,
        sender: state.sender,
      }
      void replyController.prepare(selection).catch((error) => {
        console.warn('[Danmaku Echo] reply preparation failed', {
          platform: platformId,
          reason: error instanceof Error ? error.message : String(error),
        })
        showToast(t('toastSenderUnknown'), 'error')
      })
    }
  }

  async function onCopyActionClick(event: MouseEvent): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    cancelHide()
    const candidate = state.candidate
    if (
      !state.candidateKind ||
      !visibleActionsForSurface(state.settings, platformId, actionSurface(state.candidateKind))
        .copy ||
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

  async function onFavoriteActionClick(event: MouseEvent): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    cancelHide()
    const candidate = state.candidate
    if (
      !state.candidateKind ||
      !visibleActionsForSurface(state.settings, platformId, actionSurface(state.candidateKind))
        .favorite ||
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
      const favoritePayload = await platformSender.prepareFavorite(payload)
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

  function renderActionBar(): void {
    capsuleController.setActions(
      state.candidateKind
        ? visibleActionsForSurface(state.settings, platformId, actionSurface(state.candidateKind))
        : { copy: false, favorite: false, plusOne: false, reply: false },
    )
  }

  function cancelOverlayHydration(): void {
    if (state.overlayHydrationTimer) {
      clearTimeout(state.overlayHydrationTimer)
      state.overlayHydrationTimer = 0
    }
    state.overlayHydrationId += 1
    state.overlayHydratedId = -1
  }

  function hydrateSelectedOverlay(selectionId: number): boolean {
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
    capsuleController.show(state.message, state.sender)
    capsuleController.setCooldown(state.sendCoordinator.remainingMs(state.message))
    diagnostics.record({
      type: 'candidate.hydrated',
      stage: 'overlay',
      durationMs: performance.now() - hydrationStartedAt,
      outcome: 'success',
    })
    return true
  }

  function scheduleOverlayHydration(selectionId: number): void {
    state.overlayHydrationTimer = setTimeout(() => {
      state.overlayHydrationTimer = 0
      hydrateSelectedOverlay(selectionId)
    }, OVERLAY_HYDRATION_DELAY)
  }

  function ensureSelectedOverlayHydrated(): boolean {
    if (state.candidateKind !== 'overlay') return true
    if (state.overlayHydrationTimer) {
      clearTimeout(state.overlayHydrationTimer)
      state.overlayHydrationTimer = 0
    }
    return hydrateSelectedOverlay(state.overlayHydrationId)
  }

  function restoreInlineStyleProperty(
    element: Element,
    property: string,
    saved: InlineStyleSnapshot | null,
  ): void {
    if (!(element instanceof HTMLElement) || !saved) return
    if (saved.value) {
      element.style.setProperty(property, saved.value, saved.priority)
    } else {
      element.style.removeProperty(property)
    }
  }

  function resumeOverlayAnimations(pausedAnimations: readonly PausedAnimationSnapshot[]): void {
    for (const item of pausedAnimations || []) {
      if (!item.shouldResume) continue
      try {
        item.animation.play()
      } catch {
        // Ignore animations removed by the site's danmaku renderer.
      }
    }
  }

  function freezeOverlayCandidate(candidate: Element): void {
    if (!(candidate instanceof HTMLElement)) return
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
          ? candidate.getAnimations({ subtree: true }).map((animation: Animation) => ({
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

  function unfreezeOverlayCandidate(): void {
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

  function showSelectedActionBar(candidate: Element, message: string, sender: string): boolean {
    if (state.candidate !== candidate) return false
    ensureButton()
    capsuleController.show(message, sender)
    capsuleController.setCooldown(state.sendCoordinator.remainingMs(message))
    return true
  }

  function selectCandidate(
    candidate: Element,
    kind: LiveCandidateKind,
    allowNoVisibleActions: boolean,
    pointer: HoverPoint | null,
    nativeTarget: EventTarget | null = null,
  ): boolean {
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
    const candidateKind = kind
    const candidateActions = visibleActionsForSurface(
      state.settings,
      platformId,
      actionSurface(candidateKind),
    )
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
    state.sender = senderFromCandidate(candidate, message, candidateKind, state.selectedAt, {
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

  function clearSelection(): void {
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
    capsuleController.hide()
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

  function cancelHide(): void {
    hoverSelectionController.cancelHide()
  }

  function scheduleHide(delay?: number): void {
    hoverSelectionController.scheduleHide(delay)
  }

  function showToast(
    message: string,
    kind: 'error' | 'info' | 'success' | 'warning' = 'info',
  ): void {
    capsuleController.showToast(message, kind)
  }

  function updateCooldownUi(message: string): void {
    const remainingMs = state.sendCoordinator.remainingMs(message)
    capsuleController.setCooldown(remainingMs)
    if (remainingMs > 0 && !state.cooldownTimer) {
      state.cooldownTimer = setInterval(() => {
        const currentMessage = state.message || message
        const currentRemaining = state.sendCoordinator.remainingMs(currentMessage)
        capsuleController.setCooldown(currentRemaining)
        if (currentRemaining <= 0) {
          clearInterval(state.cooldownTimer)
          state.cooldownTimer = 0
        }
      }, 250)
    }
  }

  function showSendBlock(block: SendBlock, message: string): void {
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

  function findInput(options?: EditorFindOptions): HTMLElement | null {
    const input = replyController.find(options)
    return input instanceof HTMLElement ? input : null
  }

  function findBilibiliEmojiEditor(): HTMLElement | null {
    const input = replyController.findEmojiEditor()
    return input instanceof HTMLElement ? input : null
  }

  function activateBilibiliQuickInput(): boolean {
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
      if (!(clickTarget instanceof HTMLElement)) continue
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

  function setNativeValue(input: HTMLElement, value: string): void {
    replyController.setValue(input, value)
  }

  function buttonScore(
    button: HTMLElement,
    input: HTMLElement,
    selectorIndex: number,
    scopeBonus: number,
  ): number {
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

  function findSendButton(input: HTMLElement): HTMLElement | null {
    const candidates: Array<{
      button: HTMLElement
      scopeBonus: number
      selectorIndex: number
    }> = []
    const seen = new Set<HTMLElement>()

    const addCandidate = (button: Element, selectorIndex: number, scopeBonus: number): void => {
      if (!(button instanceof HTMLElement)) return
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

  function inputStillContainsMessage(input: HTMLElement | null, message: string): boolean {
    if (!input || !input.isConnected) {
      return false
    }
    return shared.normalizeWhitespace(inputText(input)) === shared.normalizeWhitespace(message)
  }

  async function waitForInputConsumption(
    input: HTMLElement,
    message: string,
    timeout: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (!inputStillContainsMessage(input, message)) {
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return !inputStillContainsMessage(input, message)
  }

  function releaseInputFocus(input: HTMLElement): void {
    const bilibiliDismissToken = platformId === 'bilibili' ? ++state.bilibiliDismissToken : 0
    const quickBarStyleProperties = ['display', 'visibility', 'opacity', 'pointer-events']
    const restorePlaybackState = (
      snapshots: ReadonlyArray<{ paused: boolean; video: HTMLVideoElement }>,
    ): void => {
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

    const forceHideBilibiliQuickBars = (quickEditors: readonly HTMLElement[]): void => {
      for (const editor of quickEditors) {
        const player =
          fullscreenElement() ||
          closestMatching(editor, config.videoRoots) ||
          queryAllDeep(config.videoRoots).find((element) => isVisible(element))
        let container = editor.closest<HTMLElement>(BILIBILI_QUICK_BAR_SELECTORS.join(','))
        if (!container || container === editor) {
          container = editor.parentElement || editor
          const playerRect = player && player.getBoundingClientRect()
          let current: HTMLElement | null = container
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
        const existing = state.hiddenBilibiliQuickBars.get(container)
        if (existing) {
          existing.hiddenAt = Date.now()
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
      const addIfPlayerEditor = (editor: Element | null): void => {
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
        (editor): editor is HTMLElement =>
          editor instanceof HTMLElement && editor.isConnected && isVisible(editor),
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

      const editors = new Set<HTMLElement>(input ? [input] : [])
      if (platformId === 'bilibili') {
        for (const editor of queryAllDeep(config.inputs)) {
          if (editor instanceof HTMLElement) editors.add(editor)
        }
      }

      for (const editor of editors) {
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

  function platformEmojiItemCandidates(includeHidden = false): Element[] {
    const results: Element[] = []
    const seen = new Set<Element>()
    const add = (element: Element): void => {
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

  function platformEmojiInteractiveItem(element: Element): HTMLElement {
    const interactive = element.closest<HTMLElement>("button,[role='button'],li")
    if (interactive) return interactive
    const parentItem =
      element.parentElement &&
      element.parentElement.closest<HTMLElement>(PLATFORM_EMOJI_ITEM_SELECTORS.join(','))
    const ownItem = element.closest<HTMLElement>(PLATFORM_EMOJI_ITEM_SELECTORS.join(','))
    if (parentItem) return parentItem
    if (ownItem) return ownItem
    if (element instanceof HTMLElement) return element
    return element.parentElement || document.body
  }

  function platformEmojiCategoryCandidates(includeHidden = false): HTMLElement[] {
    const results: HTMLElement[] = []
    const seen = new Set<HTMLElement>()
    const add = (element: Element): void => {
      if (
        !(element instanceof HTMLElement) ||
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

  function platformEmojiToggleCandidates(input: HTMLElement, includeHidden = false): HTMLElement[] {
    const inputRect = input.getBoundingClientRect()
    const candidates = queryAllDeep(BILIBILI_EMOJI_TOGGLE_SELECTORS).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.isConnected &&
        (includeHidden || isVisible(element)) &&
        !closestMatching(element, config.messages) &&
        !isOwned(element),
    )
    candidates.sort((first, second) => {
      const score = (element: HTMLElement): number => {
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

  function countMatchingPlatformEmojiAssets(asset: RichEmojiAsset): number {
    let count = 0
    const rows = messageRows().slice(-120)
    if (platformId === 'bilibili') {
      rows.push(...overlayMessageCandidates().slice(-120))
    }
    const seenImages = new Set<HTMLImageElement>()
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

  function countChatImageMessages(): number {
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

  function richInputFingerprint(input: HTMLElement | null): string {
    if (!input || !input.isConnected) {
      return ''
    }
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      return input.value
    }
    return `${input.textContent || ''}|${input.innerHTML || ''}`.slice(0, 4096)
  }

  function richInputIsEmpty(input: HTMLElement | null): boolean {
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

  function hasNewPlatformEmojiEcho(
    asset: RichEmojiAsset,
    previousCount: number,
    previousImageMessageCount: number,
  ): boolean {
    return (
      countMatchingPlatformEmojiAssets(asset) > previousCount ||
      (platformId !== 'bilibili' && countChatImageMessages() > previousImageMessageCount)
    )
  }

  async function waitForNewPlatformEmojiEcho(
    asset: RichEmojiAsset,
    previousCount: number,
    timeout: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (countMatchingPlatformEmojiAssets(asset) > previousCount) return true
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    return countMatchingPlatformEmojiAssets(asset) > previousCount
  }

  async function waitForPlatformEmojiResult(
    input: HTMLElement,
    asset: RichEmojiAsset,
    previousCount: number,
    previousImageMessageCount: number,
    previousInput: string,
    clickedItem: HTMLElement,
    clickedItemWasVisible: boolean,
    timeout: number,
  ): Promise<'dispatched' | 'inserted' | 'none' | 'sent'> {
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
    input: HTMLElement | null,
    asset: RichEmojiAsset,
    previousCount: number,
    previousImageMessageCount: number,
    timeout: number,
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

  async function waitForPlatformSendButton(
    input: HTMLElement | null,
    timeout: number,
  ): Promise<{ button: HTMLElement | null; input: HTMLElement | null }> {
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
    input: HTMLElement,
    asset: RichEmojiAsset,
    previousCount: number,
    previousImageMessageCount: number,
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

  async function onPlusOneClick(event: MouseEvent): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    if (
      !state.candidateKind ||
      !visibleActionsForSurface(state.settings, platformId, actionSurface(state.candidateKind))
        .plusOne
    ) {
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
    capsuleController.setSending(true)
    if (releaseDouyuHoverAfterAction) {
      // The click completes this hover interaction. Release the joined native
      // hover body before Douyu's async send/feedback wait, otherwise image
      // danmaku can remain visibly paused for the entire request or forever.
      clearSelection()
    }
    try {
      if (richPayload && richPayload.assets.length) {
        await platformSender.sendRich(richPayload)
      } else {
        await platformSender.sendText(message)
      }
    } finally {
      capsuleController.setSending(false)
      if (!releaseDouyuHoverAfterAction && state.candidate === candidate) {
        scheduleHide()
      }
    }
  }

  function pointerCoordinates(event: MouseEvent): HoverPoint | null {
    const x = Number(event.clientX)
    const y = Number(event.clientY)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    // Synthetic platform/test events often omit coordinates and therefore
    // report (0, 0). They do not describe a real pointer position and must not
    // be allowed to invalidate an otherwise valid DOM-targeted interaction.
    if (!event.isTrusted && x === 0 && y === 0) return null
    return { x, y }
  }

  const hoverSelectionController = createHoverSelectionController({
    document,
    fallbackPointOnOver: platformId === 'bilibili',
    nativeHoverBoundary: platformId === 'douyu',
    overlayLeaveDelay: OVERLAY_LEAVE_DELAY,
    operations: {
      clear: clearSelection,
      current: () =>
        state.candidate && state.candidateKind
          ? {
              element: state.candidate,
              frozen: Boolean(state.frozenClone?.isConnected),
              kind: state.candidateKind,
            }
          : null,
      enabled: isEnabled,
      findAtPoint: (point) => {
        const element = findOverlayAtPoint(point.x, point.y)
        return element ? { element, kind: 'overlay' } : null
      },
      findFromPath: (path) => findCandidate(path),
      guard: (event, point) =>
        eventTouchesRepeatReminder(event) ||
        Boolean(point && pointTouchesRepeatReminder(document, point.x, point.y)),
      holdCurrent: (target) => {
        if (
          platformId !== 'douyu' ||
          state.candidateKind !== 'overlay' ||
          !(state.candidate instanceof HTMLElement)
        ) {
          return
        }
        douyuNativeHover?.hold(target)
        douyuNativeMotionFallback?.hold(state.candidate)
      },
      insideCurrentBody: isInsideSelectedHoverBody,
      insideCurrentFrozenZone: (point) => isInsideFrozenHoverZone(point.x, point.y),
      insideCurrentViewport: (point) =>
        !state.candidate || pointInsideOverlayViewport(state.candidate, point.x, point.y),
      isOwned,
      nativeCandidateFromPath: douyuOverlayCandidateFromPath,
      nativeCandidateFromTarget: douyuOverlayCandidateFromTarget,
      nativeExitWillProceed: () => douyuNativeHover?.nativeExitWillProceed(),
      nativeIsReleasing: () => Boolean(douyuNativeHover?.isReleasing),
      pathBlocksSelection: (path) =>
        platformId === 'bilibili' &&
        (pathTouchesBilibiliChatActions(path) || pathTouchesBilibiliChatAdvertisement(path)),
      rememberNativeTarget: (target) => douyuNativeHover?.remember(target),
      select: (candidate, point, nativeTarget) =>
        selectCandidate(candidate.element, candidate.kind, false, point, nativeTarget),
      updatePointer: (point) => {
        state.pointerX = point.x
        state.pointerY = point.y
      },
    },
  })

  function restoreBilibiliQuickBars(
    event: KeyboardEvent | PointerEvent | null,
    force = false,
  ): void {
    if (platformId !== 'bilibili') {
      return
    }
    if (event && !event.isTrusted) {
      return
    }

    const path = event ? (event.composedPath ? event.composedPath() : [event.target]) : []
    const elements = path.filter((item): item is Element => item instanceof Element).slice(0, 8)
    const marker = elements.map(elementMarker).join(' ')
    const targetsQuickInput = elements.some((element) => isBilibiliQuickInputRegion(element))
    const keyboardOpensQuickInput = Boolean(
      event instanceof KeyboardEvent && event.key === 'Enter' && fullscreenActive(),
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

  function onAltClick(event: MouseEvent): void {
    if (
      !isEnabled() ||
      !state.settings.actions.plusOne ||
      !state.settings.altClick ||
      !event.altKey ||
      isOwned(event.target)
    ) {
      return
    }

    const path: readonly EventTarget[] = event.composedPath
      ? event.composedPath()
      : event.target
        ? [event.target]
        : []
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
      platformSender.sendRich(state.richPayload)
    } else {
      platformSender.sendText(state.message)
    }
    scheduleHide()
  }

  let appliedCapsuleScalePercent = 0
  function syncCapsuleScale(): void {
    const percent = resolveInterfaceScalePercent(
      state.settings.interfaceScale.capsulePercent,
      state.settings.interfaceScale,
      screenResolution(window),
    )
    if (percent === appliedCapsuleScalePercent) return
    appliedCapsuleScalePercent = percent
    clearSelection()
    shared.applyCapsuleScale(document.documentElement, percent)
  }

  function onViewportChange(): void {
    syncCapsuleScale()
    if (state.candidateKind === 'overlay' && state.candidate) {
      state.overlayViewport = overlayViewportRect(state.candidate)
      if (!pointInsideRect(state.overlayViewport, state.pointerX, state.pointerY)) {
        clearSelection()
        return
      }
    }
    capsuleController.schedulePosition()
  }

  function onDiagnosticsMessage(
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== 'danmaku-echo.diagnostics.snapshot'
    )
      return false
    sendResponse({ ok: true, snapshot: diagnostics.snapshot() })
    return false
  }

  function releaseTransientResources(): void {
    clearSelection()
    hoverSelectionController.reset()
    if (state.cooldownTimer) clearInterval(state.cooldownTimer)
    state.cooldownTimer = 0
    state.senderIndex.destroy()
    state.roots = [document]
    state.rootsCachedAt = 0
    state.bilibiliOverlayCandidates = []
    state.bilibiliOverlayCandidatesCachedAt = 0
    state.overlayViewport = null
    douyuBoundary?.capsuleVisibility.showAll()
    state.douyuNativeCapsuleMutationRoots.clear()
    platformAdapter.cleanup()
  }

  function onFullscreenChange(): void {
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

  function syncDouyuNativeCapsuleRootAttribute(): void {
    const hideDouyuNativeCapsule = shouldHideNativeDanmakuCapsule(state.settings, platformId)
    if (hideDouyuNativeCapsule) {
      document.documentElement.setAttribute('data-bcp-douyu-native-capsule-hidden', 'true')
    } else {
      document.documentElement.removeAttribute('data-bcp-douyu-native-capsule-hidden')
    }
  }

  function applySettings(saved: unknown): void {
    state.settings = shared.mergeSettings(saved)
    state.repeatReminderRuntime?.applySettings(state.settings)
    syncCapsuleScale()
    syncDouyuNativeCapsuleRootAttribute()
    scanDouyuNativeDanmakuCapsules()
    shared.applyPlatformColors(document.documentElement, state.settings.colors[platformId])
    renderActionBar()
    if (!isEnabled()) {
      clearSelection()
    }
  }

  function isSenderMutationRelevant(mutation: MutationRecord): boolean {
    // Douyu's moving rows mutate class/style every frame. Sender correlation
    // only consumes structural and text changes, never motion attributes.
    if (platformId === 'douyu' && mutation.type === 'attributes') return false
    const target =
      mutation.target instanceof Element
        ? mutation.target
        : mutation.target && mutation.target.parentElement
    if (target && isInsideBilibiliPlayerOutsideChat(target)) return false
    if (
      target &&
      (closestMatching(target, config.chatRoots) ||
        closestMatching(target, config.messages) ||
        closestMatching(target, config.overlayMessages))
    ) {
      return true
    }
    return Array.from(mutation.addedNodes || []).some((node) => {
      if (!(node instanceof Element) || isInsideBilibiliPlayerOutsideChat(node)) return false
      if (
        matchesAny(node, config.chatRoots) ||
        matchesAny(node, config.messages) ||
        matchesAny(node, config.overlayMessages)
      ) {
        return true
      }
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
  }

  function startSenderObserver(): void {
    if (state.senderIndex.active || !document.documentElement) return
    const observerOptions: MutationObserverInit = {
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
    state.senderIndex.start({
      isRelevant: isSenderMutationRelevant,
      observations: senderObservations,
      observationsFromRemovedNode: senderObservationsFromRemovedNode,
      observerInit: observerOptions,
      onMutations(mutations, relevant) {
        liveRuntime.checkRoom()
        const nativeCapsuleRelevant =
          platformId === 'douyu' &&
          mutations.some((mutation) => mutationContainsDouyuNativeDanmakuCapsule(mutation))
        if (relevant || nativeCapsuleRelevant) scanDouyuNativeDanmakuCapsules()
      },
      root: document.documentElement,
    })
    scanDouyuNativeDanmakuCapsules()
  }

  const liveRuntime = new LiveContentRuntime({
    document,
    events: {
      onAltClick,
      onDiagnosticsMessage,
      onFullscreenChange,
      onQuickInputKeyDown: restoreBilibiliQuickBars,
      onQuickInputPointerDown: restoreBilibiliQuickBars,
      onViewportChange,
    },
    initialize() {
      syncDouyuNativeCapsuleRootAttribute()
      ensureButton()
    },
    loadSettings: () => storageGet().then(applySettings),
    onDestroyed() {
      globalThis.__bulletPlusOneLoaded = false
    },
    onResourcesChanged(favoritesRuntime, repeatReminderRuntime) {
      state.favoritesRuntime = favoritesRuntime
      state.repeatReminderRuntime = repeatReminderRuntime
    },
    resources: {
      capsule: capsuleController,
      clearRepeatReminderAdapter: () => repeatReminderAdapter.clear(),
      createFavorites: () =>
        createFavoritesRuntime({
          enabled: () => isEnabled() && state.settings.actions.favorite,
          platform: platformId,
          sendFavorite: (payload) => platformSender.sendFavorite(payload),
          showToast,
        }),
      createRepeatReminder: () =>
        createRepeatReminderRuntime({
          describe: repeatReminderAdapter.describe,
          initialSettings: state.settings,
          messageSelectors: config.messages,
          overlaySelectors: config.overlayMessages,
          platform: platformId,
          plusOne: (message) => platformSender.sendText(message),
          roomKey: () => currentRoomContext(platformId).roomKey,
        }),
      hoverSelection: hoverSelectionController,
      releaseTransient: releaseTransientResources,
      startSenderObserver,
    },
    roomKey: () => currentRoomContext(platformId).roomKey,
    runtimeMessages: globalThis.chrome?.runtime?.onMessage,
    storageChanges: globalThis.chrome?.storage?.onChanged,
    window,
  })
  liveRuntime.start()
}

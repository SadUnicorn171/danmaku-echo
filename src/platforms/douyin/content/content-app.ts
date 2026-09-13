import { resolveInterfaceScalePercent, screenResolution } from '../../../core/interface-scale'
import { comparableText } from '../rich-data'
import { registerDouyinEmojiCatalog } from '../emoji-token'
import { DOUYIN_EMOJI_CATALOG_REQUEST } from '../emoji-catalog'
import {
  normalizeRichPayload as normalizeOwnMessagePayload,
  type RichPayload,
} from '../own-message'
import { createFavoritesRuntime } from '../../../features/favorites/launcher'
import { currentRoomContext } from '../../../features/favorites/room-context'
import { createRepeatReminderRuntime } from '../../../features/repeat-reminder/runtime'
import {
  createDouyinContentRuntimeState,
  type DouyinContentDebugState,
} from './runtime-state'
import { createDouyinDomHoverController } from './dom-hover-controller'
import { createDouyinEditorController } from './editor-controller'
import { createDouyinSendController } from './send-controller'
import { createDouyinOwnMessageController } from './own-message-controller'
import { createDouyinRadarCollector } from './radar-collector'
import {
  createDouyinContentDiagnostics,
  type DouyinContentDebugLevel,
} from './content-diagnostics'
import {
  createChromeDouyinRuntimeBindings,
  createDouyinContentRuntime,
  type DouyinContentRuntime,
} from './content-runtime'
import {
  createDouyinActionDispatcher,
  type DouyinActionCandidate,
  type DouyinActionDispatchResult,
  type DouyinActionKind,
  type DouyinRendererActionMessage,
} from './action-dispatcher'
import {
  CHAT_MESSAGE_SELECTORS,
  CHAT_ROOT_SELECTORS,
  VIDEO_ROOT_SELECTORS,
} from './dom-config'
import {
  closestAny,
  queryAll,
} from './dom-query'
import { createDouyinPageBridge } from './page-bridge'
import {
  createDouyinChatParser,
  type DouyinChatMessageDescriptor,
} from './chat-parser'
import { createDouyinRichContentResolver } from './rich-content-resolver'
import { createDouyinSenderIndex } from './sender-index'
import { copyTextToClipboard } from '../../../core/clipboard'
import { createDiagnosticsCollector } from '../../../core/diagnostics'
import {
  INSTALL_NATIVE_SEND_OBSERVER,
  isNativeSendObservation,
  type NativeSendObservation,
} from '../../live/native-send-observer'
import { t } from '../../../core/i18n'
import type { ExtensionSettings, SharedExtensionApi } from '../../../core/types'
import type { DouyinRendererResultReason } from '../protocol'
import type { SendNetworkObserver } from '../../live/send-coordinator'

export function createDouyinContentApp(shared: SharedExtensionApi): DouyinContentRuntime {

  const MAX_LENGTH = 1000
  const DEBUG_VERSION = 'douyin-content-v16-scoped-repeat-collector'
  const REPLY_RESOLVE_ATTEMPTS = 36
  const REPLY_RESOLVE_INTERVAL = 70
  const REPLY_READY_WINDOW = 2_000
  const state = createDouyinContentRuntimeState(shared.mergeSettings())
  const chatParser = createDouyinChatParser({
    baseUrl: () => location.href,
    maxLength: MAX_LENGTH,
  })
  const senderIndex = createDouyinSenderIndex({
    chatMessages: () =>
      queryAll(CHAT_MESSAGE_SELECTORS)
        .slice(-160)
        .map((row) => chatParser.parse(row))
        .filter((item): item is DouyinChatMessageDescriptor => Boolean(item)),
    maxLength: MAX_LENGTH,
  })
  const richContentResolver = createDouyinRichContentResolver({
    baseUrl: () => location.href,
    chatMessages: () =>
      queryAll(CHAT_MESSAGE_SELECTORS)
        .slice(-100)
        .reverse()
        .map((row) => chatParser.parse(row))
        .filter((item): item is DouyinChatMessageDescriptor => Boolean(item)),
    ensureEmojiCatalog: () => ensureDouyinEmojiCatalog(),
    maxLength: MAX_LENGTH,
    senderForMessage: (message) => senderIndex.resolve(message),
  })
  const radarCollector = createDouyinRadarCollector({
    enabled: repeatReminderEnabled,
    maxLength: MAX_LENGTH,
    parser: chatParser,
    resolveRendererPayload: (text, content) => richContentResolver.fromRenderer(text, content),
    roomKey: () => currentRoomContext('douyin').roomKey,
    sendResolvedMessage: (message) => {
      if (!shared.isPlausibleMessage(message.text, MAX_LENGTH)) return
      bridge.send({ type: 'renderer-message-resolved', ...message })
    },
  })
  const editorController = createDouyinEditorController({
    closest: closestAny,
    fullscreenElement,
    isVisible,
    normalizeWhitespace: shared.normalizeWhitespace,
    query: queryAll,
  })
  const ownMessageController = createDouyinOwnMessageController({
    document,
    editor: editorController,
    enabled,
    maxLength: MAX_LENGTH,
    normalizePayload: normalizeRichPayload,
    normalizeWhitespace: shared.normalizeWhitespace,
    onDebug: debugEvent,
    onDescriptor: (descriptor, observedAt) => senderIndex.remember(descriptor, { observedAt }),
    onIntentQueued() {
      debugState.counters.ownChatIntents += 1
    },
    onMessageMarked() {
      debugState.counters.ownChatMessagesMarked += 1
    },
    parser: chatParser,
    query: queryAll,
    readInputPayload: richPayloadFromInput,
    sendToPage: (payload) => bridge.send(payload),
  })
  const sendController = createDouyinSendController({
    announceOwnMessage: ownMessageController.announce,
    cancelOwnMessageAnnouncement: ownMessageController.cancel,
    document,
    editor: editorController,
    isVisible,
    normalizePayload: normalizeRichPayload,
    normalizeWhitespace: shared.normalizeWhitespace,
    observeNetwork: startPlatformSendObservation,
    onAttempt() {
      debugState.counters.sendsAttempted += 1
    },
    onCooldownChange: updateCooldownUi,
    onDebug: debugEvent,
    onFailure() {
      debugState.counters.sendsFailed += 1
    },
    onSuccess() {
      debugState.counters.sendsSucceeded += 1
    },
    platformName: t('platformDouyin'),
    protection: state.sendProtection,
    query: queryAll,
    showToast,
  })

  const debugState: DouyinContentDebugState = {
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
      protocolMessagesRejected: 0,
    },
    lastCard: null,
    lastError: '',
    events: [],
  }
  globalThis.__danmakuEchoDouyinContentDebug = debugState
  const actionDispatcher = createDouyinActionDispatcher({
    actions: () => state.settings.actions,
    copy: copyTextToClipboard,
    enabled,
    favorite: (text, payload) =>
      state.favoritesRuntime?.favoriteText(text, payload) ?? Promise.resolve(null),
    isPlausibleMessage: (message, maxLength) =>
      shared.isPlausibleMessage(message, maxLength),
    maxLength: MAX_LENGTH,
    parseMessage: (value, maxLength) => shared.parseMessageText(value, maxLength),
    prepareReply,
    repeatMessage: async (text, payload) => (await sendController.send(text, payload)).success,
    resolver: richContentResolver,
    senderForMessage: (message, hint) =>
      senderIndex.resolve(message, {
        messageId: hint?.messageId,
        observedAt: typeof hint?.observedAt === 'number' ? hint.observedAt : undefined,
      }),
  })
  const hoverController = createDouyinDomHoverController({
    actions: () => state.settings.actions,
    cooldownForMessage: (message) => state.sendProtection.remainingMs(message),
    enabled,
    host: () => fullscreenElement() || document.documentElement,
    isPlausibleMessage: (message, maxLength) =>
      shared.isPlausibleMessage(message, maxLength),
    maxLength: MAX_LENGTH,
    onCardPointerEnter(candidate) {
      debugState.counters.cardPointerEnters += 1
      debugEvent(
        'card-pointer-enter',
        { message: candidate?.message, trackId: candidate?.trackId },
        'info',
      )
    },
    onCopy: (event) => void dispatchDomAction(event, 'copy'),
    onFavorite: (event) => void dispatchDomAction(event, 'favorite'),
    onHidden(candidate, reason) {
      debugState.counters.cardsHidden += 1
      debugEvent('card-hidden', {
        message: candidate.message,
        reason,
        trackId: candidate.trackId,
      })
    },
    onPlaceholder: (event) => void dispatchDomAction(event, 'reply'),
    onPlusOne: (event) => void dispatchDomAction(event, 'plusOne'),
    onShown(selection) {
      const activeCandidate = selection.candidate
      debugState.counters.cardsShown += 1
      debugState.lastCard = {
        at: Date.now(),
        kind: activeCandidate.kind,
        message: activeCandidate.message,
        pointer: [activeCandidate.pointerX, activeCandidate.pointerY],
        rect: activeCandidate.rect,
        selectionId: selection.id,
        selectionPhase: selection.phase,
        trackId: activeCandidate.trackId,
      }
      debugEvent('card-shown', debugState.lastCard, 'info')
    },
    payloadFromChatRow: richPayloadFromChatRow,
    payloadFromElement: (element) => richPayloadFromElement(element),
    senderForMessage: (message) => senderIndex.resolve(message),
  })
  const diagnostics = createDiagnosticsCollector({
    platform: 'douyin',
    featureFlags: () => state.settings,
    cacheCounts: () => {
      const ownMessages = ownMessageController.snapshot()
      return {
        actionRequests: actionDispatcher.pendingCount(),
        confirmedOwnMessageIds: ownMessages.confirmedIntentCount,
        manualInputSnapshots: ownMessages.manualInputSnapshotCount,
        ownChatIntents: ownMessages.pendingIntentCount,
        pendingManualEmojiIntents: ownMessages.pendingManualEmojiCount,
        replyRequests: state.replyRequests.size,
      }
    },
    observerCounts: () => {
      const ownMessages = ownMessageController.snapshot()
      return {
        ownChat: ownMessages.observerCount,
        timers: hoverController.snapshot().timers + ownMessages.timerCount,
      }
    },
    performance: () => ({
      cardsShown: debugState.counters.cardsShown,
      cardsHidden: debugState.counters.cardsHidden,
      sendsAttempted: debugState.counters.sendsAttempted,
      sendsFailed: debugState.counters.sendsFailed,
      sendsSucceeded: debugState.counters.sendsSucceeded,
    }),
    selectorHits: () => ({
      chatRoot: Boolean(document.querySelector(CHAT_ROOT_SELECTORS.join(','))),
      input: Boolean(editorController.find()),
      videoRoot: Boolean(document.querySelector(VIDEO_ROOT_SELECTORS.join(','))),
    }),
  })
  diagnostics.record({ type: 'runtime.initialized', stage: 'douyin-content' })
  const contentDiagnostics = createDouyinContentDiagnostics({
    debugState,
    document,
    enabled,
    href: () => location.href,
    hover: () => hoverController.snapshot(),
    pageReady: () => state.pageReady,
    pageSnapshot: () => state.pageSnapshot,
    pageVersion: () => state.pageVersion,
    version: DEBUG_VERSION,
  })

  function debugEvent(
    type: string,
    details: unknown = {},
    level: DouyinContentDebugLevel | 'warning' = 'debug',
  ): void {
    contentDiagnostics.event(type, details, level === 'warning' ? 'warn' : level)
  }

  function enabled(): boolean {
    return Boolean(
      state.settings.enabled &&
      state.settings.platforms.douyin &&
      Object.values(state.settings.actions).some(Boolean),
    )
  }

  function plusOneEnabled(): boolean {
    return Boolean(enabled() && state.settings.actions.plusOne)
  }

  function repeatReminderEnabled(): boolean {
    return Boolean(
      (plusOneEnabled() || state.settings.repeatReminder.autoPlusOne) &&
      state.settings.repeatReminder.enabled,
    )
  }

  function isVisible(element: Element): boolean {
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

  function fullscreenElement(): Element | null {
    return document.fullscreenElement || (document as Document & {
      webkitFullscreenElement?: Element | null
    }).webkitFullscreenElement || null
  }

  async function dispatchDomAction(event: MouseEvent, action: DouyinActionKind): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    hoverController.keepAlive()
    const candidate = hoverController.current()
    if (action === 'plusOne' && candidate) hoverController.setSending(true)
    const dispatchResult = await actionDispatcher.dispatchDom(action, candidate)
    if (action === 'plusOne') {
      if (dispatchResult.ok) hoverController.hide('send-succeeded')
      else hoverController.setSending(false)
    } else if (action === 'copy' && dispatchResult.accepted) {
      showToast(
        t(dispatchResult.ok ? 'toastDanmakuCopied' : 'toastDanmakuCopyFailed'),
        dispatchResult.ok ? 'success' : 'error',
      )
    }
    if (action !== 'reply' && !(action === 'plusOne' && dispatchResult.ok)) {
      hoverController.keepAlive()
    }
  }

  function renderActionBar(): void {
    hoverController.setActions(state.settings.actions)
  }

  function showToast(
    message: string,
    kind: 'error' | 'info' | 'success' | 'warning' = 'info',
  ): void {
    hoverController.showToast(message, kind || 'info')
  }

  function updateCooldownUi(message: string): void {
    const remainingMs = state.sendProtection.remainingMs(message)
    hoverController.setCooldown(remainingMs)
    if (remainingMs > 0 && !state.cooldownTimer) {
      state.cooldownTimer = setInterval(() => {
        const currentMessage = hoverController.current()?.message || message
        const currentRemaining = state.sendProtection.remainingMs(currentMessage)
        hoverController.setCooldown(currentRemaining)
        if (currentRemaining <= 0) {
          clearInterval(state.cooldownTimer)
          state.cooldownTimer = 0
        }
      }, 250)
    }
  }

  async function startPlatformSendObservation(): Promise<SendNetworkObserver> {
    const randomBytes = new Uint32Array(4)
    crypto.getRandomValues(randomBytes)
    const nonce = `${Date.now().toString(36)}-${Array.from(randomBytes)
      .map((value) => value.toString(36))
      .join('-')}`
    const observation = bridge.observeWindowMessage(
      (event) => (isNativeSendObservation(event.data, nonce, 'douyin') ? event.data : null),
      8_500,
    )
    try {
      const installed = await chrome.runtime.sendMessage({
        nonce,
        platform: 'douyin',
        type: INSTALL_NATIVE_SEND_OBSERVER,
      })
      if (!installed?.ok) observation.cancel()
    } catch {
      observation.cancel()
    }
    return {
      cancel: observation.cancel,
      read: (timeout = 160): Promise<NativeSendObservation | null> =>
        Promise.race<NativeSendObservation | null>([
          observation.result,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(0, timeout))),
        ]),
    }
  }

  const richPayloadFromElement = chatParser.payloadFromElement

  function richPayloadFromChatRow(row: Element): RichPayload {
    return (
      chatParser.parse(row)?.payload || { text: '', plainText: '', assets: [], parts: [], sender: '' }
    )
  }

  function postDouyinEmojiCatalog(): void {
    if (!state.douyinEmojiCatalog.length) return
    bridge.send({
      type: 'emoji-catalog',
      entries: state.douyinEmojiCatalog,
    })
  }

  function ensureDouyinEmojiCatalog(): Promise<number> {
    if (state.douyinEmojiCatalog.length) return Promise.resolve(state.douyinEmojiCatalog.length)
    if (state.douyinEmojiCatalogRequest) return state.douyinEmojiCatalogRequest
    const request = chrome.runtime
      .sendMessage({ type: DOUYIN_EMOJI_CATALOG_REQUEST })
      .then((response) => {
        if (!response?.ok || !Array.isArray(response.entries)) return 0
        const count = registerDouyinEmojiCatalog(response.entries)
        if (count) {
          state.douyinEmojiCatalog = response.entries.slice(0, 2_000)
          postDouyinEmojiCatalog()
        }
        return count
      })
      .catch(() => 0)
      .finally(() => {
        if (state.douyinEmojiCatalogRequest === request) state.douyinEmojiCatalogRequest = null
      })
    state.douyinEmojiCatalogRequest = request
    return request
  }

  function richPayloadFromInput(input: HTMLElement): RichPayload {
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      const text = shared.parseMessageText(input.value, MAX_LENGTH)
      return { text, plainText: text, assets: [], parts: text ? [{ type: 'text', text }] : [] }
    }
    return richPayloadFromElement(input)
  }

  function replyRequestKey(candidate: DouyinActionCandidate): string {
    const requestId = String((candidate && candidate.requestId) || '').trim()
    if (requestId) return `request:${requestId}`
    return [
      String((candidate && candidate.instanceId) || 'dom'),
      String((candidate && candidate.trackId) || 'unknown'),
      comparableText(candidate && candidate.message),
    ].join(':')
  }

  function markReplyReady(candidate: DouyinActionCandidate, sender: string): void {
    const root = document.documentElement
    if (root) {
      root.dataset.bcpDouyinReplyReadyAt = String(Date.now())
      root.dataset.bcpDouyinReplyReadyMessage = comparableText(
        candidate && candidate.message,
      ).slice(0, 240)
      root.dataset.bcpDouyinReplyReadySender = shared.normalizeSenderName(sender).slice(0, 64)
    }
    hoverController.dismissToast()
  }

  function recentReplyReady(candidate: DouyinActionCandidate): boolean {
    const root = document.documentElement
    const readyAt = Number(root && root.dataset.bcpDouyinReplyReadyAt) || 0
    if (!readyAt || Date.now() - readyAt > REPLY_READY_WINDOW) return false
    const readyMessage = String(root.dataset.bcpDouyinReplyReadyMessage || '')
    const message = comparableText(candidate && candidate.message)
    return !readyMessage || !message || readyMessage === message
  }

  function finishPreparedReply(
    candidate: DouyinActionCandidate,
    input: HTMLElement,
    sender: string,
    reason: string,
    requestKey: string,
    alreadyFilled: boolean,
  ): boolean {
    const draft = editorController.prepareReply(input, sender, alreadyFilled)
    markReplyReady(candidate, draft.sender)
    state.replyRequests.set(requestKey, { status: 'ready', at: Date.now() })
    hoverController.hide(reason || 'reply-ready')
    debugEvent(
      alreadyFilled ? 'reply-already-ready' : 'reply-ready',
      {
        message: candidate.message,
        sender: draft.sender,
        requestKey,
      },
      'info',
    )
    return true
  }

  async function prepareReply(candidate: DouyinActionCandidate, reason: string): Promise<boolean> {
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

    let input: HTMLElement | null = null
    let sender = ''
    for (let attempt = 0; attempt < REPLY_RESOLVE_ATTEMPTS; attempt += 1) {
      input = editorController.find()
      const existingMention = editorController.mention(input)
      if (existingMention && input) {
        return finishPreparedReply(candidate, input, existingMention, reason, requestKey, true)
      }
      if (recentReplyReady(candidate)) {
        state.replyRequests.set(requestKey, { status: 'ready', at: Date.now() })
        return true
      }
      sender = shared.normalizeSenderName(
        candidate.sender ||
          (candidate.richPayload && candidate.richPayload.sender) ||
          senderIndex.resolve(candidate.message, {
            messageId: candidate.messageId,
            observedAt: candidate.observedAt,
          }),
      )
      if (sender) break
      if (attempt + 1 < REPLY_RESOLVE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, REPLY_RESOLVE_INTERVAL))
      }
    }

    input = input && input.isConnected ? input : editorController.find()
    const finalMention = editorController.mention(input)
    if (finalMention && input) {
      return finishPreparedReply(candidate, input, finalMention, reason, requestKey, true)
    }
    if (!sender) {
      // Give another content-script context or Douyin's native quick-reply
      // handler one final frame to publish its successful result. A success is
      // authoritative and must never be overwritten by a late error toast.
      await new Promise((resolve) => setTimeout(resolve, REPLY_RESOLVE_INTERVAL))
      input = editorController.find()
      const delayedMention = editorController.mention(input)
      if (delayedMention && input) {
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

  function normalizeRichPayload(value: RichPayload | string): RichPayload {
    return normalizeOwnMessagePayload(
      value,
      (text) => shared.parseMessageText(text, MAX_LENGTH),
      MAX_LENGTH,
    )
  }

  function onAltClick(event: Event): void {
    if (!(event instanceof MouseEvent)) return
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
      (item): item is HTMLElement =>
        item instanceof HTMLElement && item.matches('.bcp-douyin-dom-barrage'),
    )
    const message = barrage
      ? shared.parseMessageText(barrage.dataset.message || '', MAX_LENGTH)
      : ''
    if (!shared.isPlausibleMessage(message, MAX_LENGTH)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const payload = richContentResolver.resolve(message, []).payload
    void sendController.send(payload.text, payload)
  }

  const runtimeRef: { current: DouyinContentRuntime | null } = { current: null }

  function postRendererResult(
    data: DouyinRendererActionMessage,
    ok: boolean,
    reason: DouyinRendererResultReason,
  ): void {
    bridge.send({
      type: 'renderer-result',
      requestId: data.requestId,
      instanceId: String(data.instanceId || ''),
      trackId: String(data.trackId || ''),
      ok: Boolean(ok),
      reason: reason || (ok ? 'sent' : 'failed'),
    })
  }

  function actionFromEvent(event: Event): Element | null {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target]
    return (
      path.find(
        (item): item is Element =>
          item instanceof Element && item.matches('.bcp-douyin-dom-action'),
      ) || null
    )
  }

  function rendererResultReason(
    dispatchResult: DouyinActionDispatchResult,
  ): DouyinRendererResultReason {
    if (dispatchResult.ok) return 'sent'
    if (dispatchResult.reason === 'untrusted') return 'missing-trusted-click'
    if (dispatchResult.reason === 'operation-error') return 'send-error'
    if (dispatchResult.accepted) return 'send-failed'
    return 'invalid-or-duplicate'
  }

  async function dispatchRendererAction(
    action: DouyinActionKind,
    data: DouyinRendererActionMessage,
  ): Promise<void> {
    const dispatchResult = await actionDispatcher.dispatchRenderer(action, data)
    const details = {
      action,
      instanceId: data.instanceId,
      ok: dispatchResult.ok,
      reason: dispatchResult.reason || dispatchResult.outcome,
      requestId: data.requestId,
      trackId: data.trackId,
    }
    if (action === 'plusOne') {
      if (dispatchResult.accepted) debugState.counters.rendererActivations += 1
      else debugState.counters.rendererActivationsRejected += 1
      postRendererResult(data, dispatchResult.ok, rendererResultReason(dispatchResult))
    } else if (action === 'favorite') {
      bridge.send({
        type: 'renderer-favorite-result',
        requestId: data.requestId,
        ok: dispatchResult.ok,
      })
    } else if (action === 'copy') {
      bridge.send({
        type: 'renderer-copy-result',
        requestId: data.requestId,
        ok: dispatchResult.ok,
      })
    }
    debugEvent(
      dispatchResult.accepted ? 'renderer-action-dispatched' : 'renderer-action-rejected',
      details,
      dispatchResult.accepted ? 'info' : 'warn',
    )
  }

  const bridge = createDouyinPageBridge({
    target: window,
    onInvalidPageMessage: () => {
      debugState.counters.protocolMessagesRejected += 1
    },
    onProbe: (requestId) => {
      debugState.counters.pings += 1
      debugEvent('page-ping', { requestId, href: location.href })
    },
    handlers: {
      'debug-snapshot': (message) => {
        state.pageSnapshot = message.snapshot
        debugEvent(
          'page-debug-snapshot',
          {
            requestId: message.requestId,
            instanceCount: state.pageSnapshot && state.pageSnapshot.instanceCount,
            orphanCount: state.pageSnapshot && state.pageSnapshot.orphanCount,
          },
          'info',
        )
        console.info('[Danmaku Echo][Douyin diagnostics]', contentDiagnostics.snapshot())
      },
      'own-message-consumed': (message) => {
        ownMessageController.confirm(message.intentId)
      },
      ready: (message) => {
        state.pageReady = true
        state.pageVersion = message.version
        debugState.pageReady = true
        debugState.pageVersion = state.pageVersion
        debugEvent(
          'page-ready',
          {
            version: state.pageVersion,
            instanceCount: message.instanceCount,
            orphanCount: message.orphanCount,
          },
          'info',
        )
        runtimeRef.current?.handlePageReady(state.pageVersion)
        postDouyinEmojiCatalog()
      },
      'renderer-activate': (message) => {
        void dispatchRendererAction('plusOne', message)
      },
      'renderer-copy': (message) => {
        void dispatchRendererAction('copy', message)
      },
      'renderer-favorite': (message) => {
        void dispatchRendererAction('favorite', message)
      },
      'renderer-ready': () => {},
      'renderer-reply': (message) => {
        void dispatchRendererAction('reply', message)
      },
      'repeat-reminder-message': (message) => radarCollector.ingestRenderer(message.message),
    },
  })
  const featureRuntimes = {
    applySettings(settings: ExtensionSettings): void {
      state.repeatReminderRuntime?.applySettings(settings)
    },
    destroy(): void {
      state.repeatReminderRuntime?.destroy()
      state.repeatReminderRuntime = null
      state.favoritesRuntime?.destroy()
      state.favoritesRuntime = null
    },
    start(): void {
      if (!state.favoritesRuntime) {
        state.favoritesRuntime = createFavoritesRuntime({
          enabled: () => enabled() && state.settings.actions.favorite,
          platform: 'douyin',
          sendFavorite: async (payload) => (await sendController.send(payload.text, payload)).success,
          showToast,
        })
      }
      if (!state.repeatReminderRuntime) {
        state.repeatReminderRuntime = createRepeatReminderRuntime({
          collector: radarCollector,
          initialSettings: state.settings,
          messageSelectors: CHAT_MESSAGE_SELECTORS,
          overlaySelectors: [],
          platform: 'douyin',
          plusOne: async (message) => (await sendController.send(message)).success,
          rootSelectors: CHAT_ROOT_SELECTORS,
          roomKey: () => currentRoomContext('douyin').roomKey,
        })
      }
    },
  }
  const onRuntimeKeydown = (event: Event): void => {
      if (!(event instanceof KeyboardEvent)) return
      if (event.key === 'Escape') {
        hoverController.hide('escape')
      }
      if (event.ctrlKey && event.altKey && String(event.key).toLowerCase() === 'd') {
        event.preventDefault()
        const request = bridge.requestDebugSnapshot()
        debugEvent('diagnostics-requested', { requestId: request.requestId }, 'info')
        void request.response
        showToast(t('toastDiagnosticsConsole'), 'info')
      }
  }
  const onRuntimeBlur = () => hoverController.scheduleHide('window-blur', 120)
  let appliedCapsuleScalePercent = 0
  const effectiveCapsuleScale = () => resolveInterfaceScalePercent(
    state.settings.interfaceScale.capsulePercent,
    state.settings.interfaceScale,
    screenResolution(window),
  )
  const onRuntimeResize = () => {
    hoverController.hide('resize')
    const percent = effectiveCapsuleScale()
    if (percent === appliedCapsuleScalePercent) return
    appliedCapsuleScalePercent = percent
    shared.applyCapsuleScale(document.documentElement, percent)
    runtimeRef.current?.postRendererSettings('screen-scale')
  }
  const onRuntimeFullscreenChange = () => {
    senderIndex.remember()
    hoverController.hide('fullscreen-change')
    hoverController.ensureHost()
  }
  const onRuntimeWebkitFullscreenChange = () => {
    senderIndex.remember()
    hoverController.hide('webkit-fullscreen-change')
    hoverController.ensureHost()
  }
  // Douyin auto-scrolls its virtual chat list whenever messages arrive. A captured
  // scroll listener would clear a valid DOM selection even while the pointer is
  // already over the card, so scrolling is deliberately not a dismissal signal.
  const runtime = createDouyinContentRuntime({
    bindings: createChromeDouyinRuntimeBindings(),
    bridge,
    controllers: [actionDispatcher, editorController],
    debug: contentDiagnostics,
    diagnostics,
    document,
    ensureEmojiCatalog: () => ensureDouyinEmojiCatalog(),
    eventBindings: [
      { target: document, type: 'click', listener: onAltClick, options: true },
      { target: document, type: 'keydown', listener: onRuntimeKeydown, options: true },
      { target: window, type: 'blur', listener: onRuntimeBlur },
      { target: window, type: 'resize', listener: onRuntimeResize, options: { passive: true } },
      { target: window, type: 'focus', listener: onRuntimeResize },
      { target: document, type: 'fullscreenchange', listener: onRuntimeFullscreenChange, options: true },
      {
        target: document,
        type: 'webkitfullscreenchange',
        listener: onRuntimeWebkitFullscreenChange,
        options: true,
      },
    ],
    features: featureRuntimes,
    href: () => location.href,
    observers: [ownMessageController, hoverController],
    onDeactivate() {
      if (state.cooldownTimer) clearInterval(state.cooldownTimer)
      state.cooldownTimer = 0
      state.replyRequests.clear()
      senderIndex.destroy()
    },
    onRouteChanged() {
      state.pageReady = false
      debugState.pageReady = false
    },
    rendererSettings: () => {
      const rendererEnabled = enabled()
      return {
        enabled: rendererEnabled,
        actions: state.settings.actions,
        capsuleScalePercent: effectiveCapsuleScale(),
        repeatReminderEnabled: rendererEnabled && repeatReminderEnabled(),
        version: DEBUG_VERSION,
      }
    },
    rendererVersion: DEBUG_VERSION,
    settings: {
      applyDocument(settings) {
        appliedCapsuleScalePercent = effectiveCapsuleScale()
        shared.applyCapsuleScale(document.documentElement, appliedCapsuleScalePercent)
        shared.applyPlatformColors(document.documentElement, settings.colors.douyin)
      },
      current: () => state.settings,
      disableInteractions() {
        hoverController.hide('disabled-by-settings')
        ownMessageController.clear()
      },
      enabled,
      merge: (saved) => shared.mergeSettings(saved),
      refreshObservers: () => ownMessageController.refresh(),
      renderActions: renderActionBar,
      replace(settings) {
        state.settings = settings
        debugState.settingsEnabled = enabled()
      },
    },
    window,
  })
  runtimeRef.current = runtime
  return runtime
}

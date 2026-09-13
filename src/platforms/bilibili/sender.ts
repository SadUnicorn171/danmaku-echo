import { t } from '../../core/i18n'
import { normalizeWhitespace } from '../../core/shared'
import {
  LEGACY_BILIBILI_EXCLUSIVE_ASSET_KEY_PREFIX,
  NATIVE_PANEL_ASSET_KEY_PREFIX,
} from '../live/editor-config'
import type { RichEmojiAsset, RichMessagePayload } from '../live/rich-message'
import { unicodeEmojiFallbackText } from '../live/emoji-fallback'
import type { SendCoordinator } from '../live/send-coordinator'
import type { LivePlatformSender } from '../live/platform-sender'
import type { LiveTextSender } from '../live/text-sender'
import {
  classifyPlatformSendFeedback,
  classifyPlatformSendResponse,
} from '../live/send-protection'
import {
  BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE,
  type BilibiliSendDiagnostics,
  bilibiliRoomEmoticonIdentity,
} from './direct-emoticon-send'
import {
  createBilibiliEmoticonDebugAttempt,
  type BilibiliEmoticonDebugAttempt,
} from './emoticon-debug'
import { isBilibiliEmoticonFallbackLabel } from './emoticon-metadata'
import {
  BILIBILI_INSTALL_NATIVE_SEND_OBSERVER,
  isBilibiliNativeSendObservation,
  type BilibiliNativeSendObservation,
} from './native-send-observer'
import { bilibiliAutoRecognizedEmojiText } from './rich-message-sender'

type EmojiResult = 'dispatched' | 'inserted' | 'none' | 'sent'

interface EmojiSubmission {
  consumed: boolean
  sent: boolean
}

interface DirectSendResponse {
  diagnostics?: BilibiliSendDiagnostics
  code?: number | string
  error?: string
  httpStatus?: number
  identity?: string
  message?: string
  ok?: boolean
}

interface NativeSendObserver {
  cancel(): void
  read(timeout?: number): Promise<BilibiliNativeSendObservation | null>
}

export interface BilibiliSenderRuntime {
  assetDescriptor(element: Element): RichEmojiAsset | null
  assetMatchScore(element: Element, asset: RichEmojiAsset): number
  completeEmojiTokens(payload: RichMessagePayload): void
  coordinator: SendCoordinator
  countChatImageMessages(): number
  countMatchingAssets(asset: RichEmojiAsset): number
  createTokenAsset(token: string): RichEmojiAsset
  emojiTokenQuality(value: unknown): number
  emojiCategories(includeHidden: boolean): HTMLElement[]
  emojiItems(includeHidden: boolean): Element[]
  emojiToggles(input: HTMLElement, includeHidden: boolean): HTMLElement[]
  enrichAsset(payload: RichMessagePayload, index: number, element: Element): void
  findEmojiEditor(): HTMLElement | null
  findInput(): HTMLElement | null
  findSendButton(input: HTMLElement): HTMLElement | null
  fullscreenActive(): boolean
  isGenericEmojiLabel(value: unknown): boolean
  interactiveEmojiItem(element: Element): HTMLElement
  isVisible(element: Element): boolean
  normalizeEmojiToken(value: unknown): string
  pressEnter(input: HTMLElement): void
  platformName: string
  releaseInputFocus(input: HTMLElement): void
  refreshPayloadText(payload: RichMessagePayload): string
  setNativeValue(input: HTMLElement, value: string): void
  showToast(message: string, tone: 'error' | 'info' | 'success' | 'warning'): void
  submitInsertedEmoji(
    input: HTMLElement,
    asset: RichEmojiAsset,
    previousCount: number,
    previousImageMessageCount: number,
  ): Promise<EmojiSubmission>
  textSender: LiveTextSender
  updateCooldown(message: string): void
  waitForEmojiResult(
    input: HTMLElement,
    asset: RichEmojiAsset,
    previousCount: number,
    previousImageMessageCount: number,
    previousInput: string,
    clickedItem: HTMLElement,
    clickedItemWasVisible: boolean,
    timeout: number,
  ): Promise<EmojiResult>
  waitForInputConsumption(input: HTMLElement, message: string, timeout: number): Promise<boolean>
  waitForNewEcho(asset: RichEmojiAsset, previousCount: number, timeout: number): Promise<boolean>
  inputFingerprint(input: HTMLElement): string
  inputIsEmpty(input: HTMLElement): boolean
}

function isNativePanelAsset(asset: RichEmojiAsset | null | undefined): boolean {
  return Boolean(
    asset?.keys.some((key) => {
      const normalized = String(key || '').toLowerCase()
      return (
        (normalized.startsWith(NATIVE_PANEL_ASSET_KEY_PREFIX) &&
          !normalized.startsWith(`${NATIVE_PANEL_ASSET_KEY_PREFIX}resolved:`)) ||
        normalized.startsWith(LEGACY_BILIBILI_EXCLUSIVE_ASSET_KEY_PREFIX)
      )
    }),
  )
}

export interface BilibiliPanelMatcher {
  assetDescriptor(element: Element): RichEmojiAsset | null
  assetMatchScore(element: Element, asset: RichEmojiAsset): number
  interactiveEmojiItem(element: Element): HTMLElement
  isVisible(element: Element): boolean
  normalizeEmojiToken(value: unknown): string
}

export function uniqueBilibiliPanelItem(
  elements: Element[],
  asset: RichEmojiAsset,
  matcher: BilibiliPanelMatcher,
): HTMLElement | null {
  const matches = new Map<Element | string, { item: HTMLElement; score: number }>()
  const expectedToken = matcher.normalizeEmojiToken(asset.token)
  elements.forEach((element) => {
    let score = matcher.assetMatchScore(element, asset)
    if (
      score < 4 &&
      expectedToken &&
      matcher.normalizeEmojiToken(matcher.assetDescriptor(element)?.token) === expectedToken
    ) {
      score = 3
    }
    if (score < 3) return
    const item = matcher.interactiveEmojiItem(element)
    const descriptor = matcher.assetDescriptor(element)
    const resourceIdentity = descriptor?.keys.find((key) => {
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
      (score === previous.score && matcher.isVisible(item) && !matcher.isVisible(previous.item))
    ) {
      matches.set(matchKey, { item, score })
    }
  })
  const ranked = Array.from(matches.values()).sort((first, second) => second.score - first.score)
  if (!ranked.length) return null
  const best = ranked.filter((match) => match.score === ranked[0].score)
  return best.length === 1 ? best[0].item : null
}

export function bilibiliFavoriteImagePayload(
  payload: RichMessagePayload | null | undefined,
  createTokenAsset: (token: string) => RichEmojiAsset,
): RichMessagePayload | null {
  if (!payload) return null
  const assets = Array.isArray(payload.assets) ? payload.assets : []
  if (assets.length > 1) return null
  const asset = assets[0] || null
  const token = normalizeWhitespace(asset?.token || payload.text)
  if (!/^\[[^\]\n]{1,40}\]$/.test(token)) return null

  if (Array.isArray(payload.parts) && payload.parts.length) {
    const meaningfulParts = payload.parts.filter((part) => {
      if (!part || typeof part !== 'object') return false
      if (part.type === 'emoji') return true
      return part.type === 'text' && Boolean(normalizeWhitespace(part.text))
    })
    const emojiParts = meaningfulParts.filter((part) => part.type === 'emoji')
    const nonDuplicateTextParts = meaningfulParts.filter(
      (part) => part.type === 'text' && !isBilibiliEmoticonFallbackLabel(part.text, token),
    )
    const isSingleEmojiPart =
      (assets.length === 1 && emojiParts.length === 1 && nonDuplicateTextParts.length === 0) ||
      (assets.length === 0 &&
        meaningfulParts.length === 1 &&
        meaningfulParts[0].type === 'text' &&
        normalizeWhitespace(meaningfulParts[0].text) === token)
    if (!isSingleEmojiPart) return null
  }

  const runtimeAsset = asset || createTokenAsset(token)
  return {
    ...payload,
    assets: [runtimeAsset],
    parts: [{ asset: runtimeAsset, type: 'emoji' }],
    plainText: '',
    text: token,
  }
}

export function bilibiliInlineEmojiText(
  payload: RichMessagePayload | null | undefined,
  isGenericEmojiLabel: (value: unknown) => boolean,
): string {
  if (!payload?.parts?.length) return ''
  const pieces: string[] = []
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

async function startNativeSendObservation(): Promise<NativeSendObserver | null> {
  const randomBytes = new Uint32Array(4)
  crypto.getRandomValues(randomBytes)
  const nonce = `${Date.now().toString(36)}-${Array.from(randomBytes)
    .map((value) => value.toString(36))
    .join('-')}`
  let settled = false
  let resolveResult: (value: BilibiliNativeSendObservation | null) => void = () => undefined
  const result = new Promise<BilibiliNativeSendObservation | null>((resolve) => {
    resolveResult = resolve
  })
  const finish = (value: BilibiliNativeSendObservation | null): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    window.removeEventListener('message', onMessage)
    resolveResult(value)
  }
  const onMessage = (event: MessageEvent): void => {
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
      Promise.race([
        result,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout)),
      ]),
  }
}

export class BilibiliSender implements LivePlatformSender {
  readonly #runtime: BilibiliSenderRuntime
  #panelOpenedByPlugin = false

  constructor(runtime: BilibiliSenderRuntime) {
    this.#runtime = runtime
  }

  favoriteImagePayload(payload: RichMessagePayload | null | undefined): RichMessagePayload | null {
    return bilibiliFavoriteImagePayload(payload, this.#runtime.createTokenAsset)
  }

  enrichForFavorite(payload: RichMessagePayload): Promise<RichMessagePayload> {
    return this.enrichAssetNames(payload)
  }

  async prepareFavorite(payload: RichMessagePayload): Promise<RichMessagePayload> {
    this.#runtime.completeEmojiTokens(payload)
    await this.enrichForFavorite(payload)
    return this.favoriteImagePayload(payload) || payload
  }

  async sendFavorite(payload: RichMessagePayload): Promise<boolean> {
    const imagePayload = this.favoriteImagePayload(payload)
    if (!imagePayload) {
      return payload.assets.length ? this.sendRich(payload) : this.sendText(payload.text)
    }
    if (
      imagePayload.assets.some(isNativePanelAsset) ||
      bilibiliAutoRecognizedEmojiText(imagePayload)
    ) {
      return this.sendRich(imagePayload)
    }

    const input = this.#runtime.findEmojiEditor() || this.#runtime.findInput()
    if (!input) {
      this.#runtime.showToast(t('toastEditorNotFound', this.#runtime.platformName), 'error')
      return false
    }
    const item = await this.openUniqueEmoji(input, imagePayload.assets[0])
    if (!item) {
      this.#runtime.showToast(t('toastOfficialEmojiNotFound', imagePayload.text), 'error')
      return false
    }
    this.markPayloadAsNativePanel(imagePayload, item)
    return this.sendRich(imagePayload)
  }

  async sendText(message: string): Promise<boolean> {
    return this.#runtime.textSender.send(message)
  }

  async sendRich(payload: RichMessagePayload): Promise<boolean> {
    const unicodeFallback = unicodeEmojiFallbackText(payload)
    if (unicodeFallback) return this.sendText(unicodeFallback)
    const debug = createBilibiliEmoticonDebugAttempt(payload)
    try {
      return await this.sendRichWithDebug(payload, debug)
    } catch (error) {
      debug.fail('unexpected-exception', { error })
      throw error
    }
  }

  async sendRecognizedText(
    message: string,
    payload: RichMessagePayload,
    debug: BilibiliEmoticonDebugAttempt = createBilibiliEmoticonDebugAttempt(payload),
  ): Promise<boolean> {
    const asset = payload.assets[0]
    const runtime = this.#runtime
    if (!asset || !runtime.coordinator.begin(message)) return false
    const input = runtime.findInput()
    if (!input) {
      debug.fail('auto-text-editor-missing', { asset: debug.asset(asset) })
      runtime.coordinator.finish(message, false)
      runtime.showToast(t('toastEditorNotFound', runtime.platformName), 'error')
      return false
    }

    const previousCount = runtime.countMatchingAssets(asset)
    runtime.setNativeValue(input, message)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const networkObserver = await runtime.coordinator.observeNetwork()
    const feedbackProbe = runtime.coordinator.feedbackProbe(document)
    let button = runtime.findSendButton(input)
    if (button) button.click()
    else runtime.pressEnter(input)

    let consumed = await runtime.waitForInputConsumption(input, message, 420)
    if (!consumed) {
      runtime.pressEnter(input)
      consumed = await runtime.waitForInputConsumption(input, message, 320)
    }
    if (!consumed) {
      button = runtime.findSendButton(input)
      if (button) {
        button.click()
        consumed = await runtime.waitForInputConsumption(input, message, 420)
      }
    }
    if (!consumed) {
      const settled = await runtime.coordinator.settle({
        feedbackProbe,
        message,
        method: 'text',
        networkObserver,
        success: false,
      })
      if (settled.failureReason !== 'platform-feedback' && settled.failureReason !== 'unconfirmed') {
        debug.fail('auto-text-not-consumed', { asset: debug.asset(asset), message })
        runtime.showToast(t('toastAutomaticSendFailed'), 'error')
      }
      return false
    }

    const echoed = await runtime.waitForNewEcho(asset, previousCount, 3_200)
    const settled = await runtime.coordinator.settle({
      feedbackProbe,
      message,
      method: 'text',
      networkObserver,
      success: echoed,
    })
    if (settled.failureReason === 'platform-feedback') {
      debug.fail('auto-text-platform-feedback', { asset: debug.asset(asset), message })
      return false
    }
    if (!echoed) {
      debug.fail('auto-text-send-unconfirmed', {
        asset: debug.asset(asset),
        matchingAssetCountAfter: runtime.countMatchingAssets(asset),
        previousCount,
      })
      runtime.showToast(t('toastImageUnconfirmed', runtime.platformName), 'error')
      return false
    }
    runtime.releaseInputFocus(input)
    runtime.showToast(t('toastImageEmojiSent'), 'success')
    return true
  }

  private findUniqueEmoji(asset: RichEmojiAsset, includeHidden = false): HTMLElement | null {
    return uniqueBilibiliPanelItem(this.#runtime.emojiItems(includeHidden), asset, this.#runtime)
  }

  private async openUniqueEmoji(
    input: HTMLElement,
    asset: RichEmojiAsset,
  ): Promise<HTMLElement | null> {
    const includeHidden = this.#runtime.fullscreenActive()
    let item =
      this.findUniqueEmoji(asset) || (includeHidden ? this.findUniqueEmoji(asset, true) : null)
    if (item) return item
    const toggle = this.#runtime.emojiToggles(input, includeHidden)[0]
    if (toggle) {
      toggle.click()
      this.#panelOpenedByPlugin = true
      item = await this.waitForUniqueEmoji(asset, 900, includeHidden)
      if (item) return item
    }
    for (const category of this.#runtime.emojiCategories(includeHidden)) {
      if (!category.isConnected) continue
      category.click()
      item = await this.waitForUniqueEmoji(asset, 320, includeHidden)
      if (item) return item
    }
    return this.findUniqueEmoji(asset, true)
  }

  private async waitForUniqueEmoji(
    asset: RichEmojiAsset,
    timeout: number,
    includeHidden: boolean,
  ): Promise<HTMLElement | null> {
    const deadline = Date.now() + timeout
    let match = this.findUniqueEmoji(asset, includeHidden)
    while (!match && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      match = this.findUniqueEmoji(asset, includeHidden)
    }
    return match
  }

  private markPayloadAsNativePanel(payload: RichMessagePayload, item: Element): void {
    this.#runtime.enrichAsset(payload, 0, item)
    const asset = payload.assets[0]
    if (!asset) return
    const itemDescriptor = this.#runtime.assetDescriptor(item)
    const itemHasNativeIdentity = isNativePanelAsset(itemDescriptor)
    const token = this.#runtime.normalizeEmojiToken(itemDescriptor?.token || asset.token)
    const marker = itemHasNativeIdentity
      ? ''
      : token
        ? `${NATIVE_PANEL_ASSET_KEY_PREFIX}matched-name:${token.toLowerCase().slice(0, 120)}`
        : `${NATIVE_PANEL_ASSET_KEY_PREFIX}resolved:${normalizeWhitespace(asset.src || 'resolved')
            .toLowerCase()
            .slice(0, 180)}`
    if (marker) asset.keys = Array.from(new Set([marker, ...asset.keys])).slice(0, 48)
    const emojiPart = payload.parts.find((part) => part.type === 'emoji')
    if (marker && emojiPart?.type === 'emoji' && emojiPart.asset !== asset) {
      emojiPart.asset.keys = Array.from(new Set([marker, ...emojiPart.asset.keys])).slice(0, 48)
    }
  }

  private async sendRichWithDebug(
    payload: RichMessagePayload,
    debug: BilibiliEmoticonDebugAttempt,
  ): Promise<boolean> {
    const runtime = this.#runtime
    const singleImagePayload = this.favoriteImagePayload(payload)
    const hasEmojiParts = payload.parts.some((part) => part.type === 'emoji')
    if (
      payload.assets.length &&
      (runtime.fullscreenActive() || Boolean(singleImagePayload) || hasEmojiParts)
    ) {
      await this.enrichAssetNames(payload)
    }
    runtime.completeEmojiTokens(payload)
    const autoText = bilibiliAutoRecognizedEmojiText(payload)
    if (autoText) return this.sendRecognizedText(autoText, payload, debug)

    const resolvedSingleImagePayload = this.favoriteImagePayload(payload)
    const inlineText = resolvedSingleImagePayload
      ? ''
      : bilibiliInlineEmojiText(payload, runtime.isGenericEmojiLabel)
    if (inlineText) return this.sendText(inlineText)
    if (
      !resolvedSingleImagePayload &&
      payload.parts.some((part) => part.type === 'text' && String(part.text || '').trim())
    ) {
      const fallbackText = String(payload.text || '').trim()
      if (fallbackText) return this.sendText(fallbackText)
    }

    const asset = payload.assets[0]
    const nativeAsset = isNativePanelAsset(asset)
    if (resolvedSingleImagePayload && !nativeAsset) {
      debug.fail('identity-not-unique', {
        asset: debug.asset(asset),
        panelOpenedByPlugin: this.#panelOpenedByPlugin,
      })
      runtime.showToast(t('toastOfficialEmojiNotUnique', resolvedSingleImagePayload.text), 'error')
      return false
    }
    const protectedMessage = payload.text
    if (!runtime.coordinator.begin(protectedMessage)) {
      debug.fail('send-protection-blocked', {
        remainingMs: runtime.coordinator.remainingMs(protectedMessage),
      })
      return false
    }
    const input = nativeAsset ? runtime.findEmojiEditor() || runtime.findInput() : runtime.findInput()
    if (!asset) {
      debug.fail('asset-missing', { nativeBilibiliAsset: nativeAsset })
      runtime.coordinator.finish(protectedMessage, false)
      runtime.showToast(t('toastImageResourceNotFound', runtime.platformName), 'error')
      return false
    }

    const sendDirectFallback = async (fallbackReason: string): Promise<{
      attempted: boolean
      reason?: string
      success: boolean
    }> => {
      const identity = bilibiliRoomEmoticonIdentity(asset)
      const token = runtime.normalizeEmojiToken(asset.token)
      if (!identity && !token) {
        return { attempted: false, reason: 'identity-unavailable', success: false }
      }
      const feedbackProbe = runtime.coordinator.feedbackProbe(document)
      const previousCount = runtime.countMatchingAssets(asset)
      let result: DirectSendResponse
      try {
        result = await chrome.runtime.sendMessage({
          attemptId: debug.attemptId,
          identity: identity || undefined,
          sourceHints: [asset.src].filter(Boolean),
          token: token || undefined,
          type: BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE,
        })
      } catch (error) {
        result = {
          error: 'runtime-unavailable',
          message: error instanceof Error ? error.message : String(error),
          ok: false,
        }
      }
      if (result?.ok) {
        if (result.identity && !identity) {
          asset.keys = Array.from(
            new Set([`${NATIVE_PANEL_ASSET_KEY_PREFIX}${result.identity}`, ...asset.keys]),
          ).slice(0, 48)
        }
        const echoed = await runtime.waitForNewEcho(asset, previousCount, 3_200)
        const settled = await runtime.coordinator.settle({
          feedbackProbe,
          message: protectedMessage,
          method: 'direct-emoji',
          success: echoed,
        })
        if (settled.failureReason === 'platform-feedback') {
          debug.fail('direct-send-success-feedback-rejected', {
            echoed,
            identity: result.identity || identity,
            result,
          })
          return { attempted: true, success: false }
        }
        if (!echoed) {
          debug.fail('direct-send-unconfirmed', {
            identity: result.identity || identity,
            matchingAssetCountAfter: runtime.countMatchingAssets(asset),
            previousDirectCount: previousCount,
            result,
          })
          runtime.showToast(t('toastImageUnconfirmed', runtime.platformName), 'error')
          return { attempted: true, success: false }
        }
        if (input) runtime.releaseInputFocus(input)
        runtime.showToast(t('toastImageEmojiSent'), 'success')
        return { attempted: true, success: true }
      }
      feedbackProbe.stop()
      const feedback =
        classifyPlatformSendResponse(result || {}) || classifyPlatformSendFeedback(result?.message)
      if (feedback) {
        debug.fail('direct-send-platform-rejected', {
          feedback,
          identity: result.identity || identity,
          result,
        })
        runtime.coordinator.applyFeedback(feedback, protectedMessage)
        return { attempted: true, success: false }
      }
      runtime.coordinator.finish(protectedMessage, false)
      runtime.updateCooldown(protectedMessage)
      debug.fail('direct-send-failed', { fallbackReason, identity: result.identity || identity, result })
      runtime.showToast(
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
      const direct = await sendDirectFallback('editor-unavailable')
      if (direct.attempted) return direct.success
      debug.fail('editor-and-direct-identity-unavailable', {
        asset: debug.asset(asset),
        directReason: direct.reason,
        nativeBilibiliAsset: nativeAsset,
        panelOpenedByPlugin: this.#panelOpenedByPlugin,
      })
      runtime.coordinator.finish(protectedMessage, false)
      runtime.showToast(t('toastImageResourceNotFound', runtime.platformName), 'error')
      return false
    }

    const item = nativeAsset ? await this.openUniqueEmoji(input, asset) : null
    if (!item) {
      const direct = await sendDirectFallback('panel-item-unavailable')
      if (direct.attempted) return direct.success
      debug.fail('panel-item-not-found', {
        asset: debug.asset(asset),
        categoryCandidateCount: runtime.emojiCategories(runtime.fullscreenActive()).length,
        directReason: direct.reason,
        emojiItemCandidateCount: runtime.emojiItems(runtime.fullscreenActive()).length,
        fullscreen: runtime.fullscreenActive(),
        nativeBilibiliAsset: nativeAsset,
        panelOpenedByPlugin: this.#panelOpenedByPlugin,
        toggleCandidateCount: runtime.emojiToggles(input, runtime.fullscreenActive()).length,
      })
      runtime.coordinator.finish(protectedMessage, false)
      runtime.showToast(t('toastEmojiPanelNoMatch', runtime.platformName), 'error')
      return false
    }

    runtime.enrichAsset(payload, 0, item)
    const previousCount = runtime.countMatchingAssets(asset)
    const previousImageMessageCount = runtime.countChatImageMessages()
    const beforeInput = runtime.inputFingerprint(input)
    const itemWasVisible = runtime.isVisible(item)
    const feedbackProbe = runtime.coordinator.feedbackProbe(document)
    const nativeSendObserver = await startNativeSendObservation()
    item.click()
    const resultTimeout = 2_400
    let result = await runtime.waitForEmojiResult(
      input,
      asset,
      previousCount,
      previousImageMessageCount,
      beforeInput,
      item,
      itemWasVisible,
      resultTimeout,
    )
    if (result === 'inserted' && runtime.inputFingerprint(input) !== beforeInput) {
      const submission = await runtime.submitInsertedEmoji(
        input,
        asset,
        previousCount,
        previousImageMessageCount,
      )
      result = submission.sent ? 'sent' : 'none'
    }
    const nativeResult = nativeSendObserver ? await nativeSendObserver.read() : null
    if (nativeResult?.identity && !bilibiliRoomEmoticonIdentity(asset)) {
      asset.keys = Array.from(
        new Set([`${NATIVE_PANEL_ASSET_KEY_PREFIX}${nativeResult.identity}`, ...asset.keys]),
      ).slice(0, 48)
    }
    const nativeRejected = Boolean(
      nativeResult &&
        ((Number.isFinite(nativeResult.code) && nativeResult.code !== 0) ||
          (Number.isFinite(nativeResult.httpStatus) && Number(nativeResult.httpStatus) >= 400)),
    )
    if (nativeRejected && nativeResult) {
      nativeSendObserver?.cancel()
      feedbackProbe.stop()
      const message = normalizeWhitespace(
        nativeResult.message || `HTTP ${nativeResult.httpStatus || nativeResult.code}`,
      )
      const feedback =
        classifyPlatformSendResponse({ ...nativeResult, message }) ||
        classifyPlatformSendFeedback(message)
      runtime.coordinator.finish(protectedMessage, false)
      if (feedback) runtime.coordinator.applyFeedback(feedback, protectedMessage)
      debug.fail('native-send-platform-rejected', { nativeSendResult: nativeResult })
      if (!feedback) {
        runtime.showToast(
          t('toastPlatformRejected', [runtime.platformName, message || String(nativeResult.code)]),
          'error',
        )
      }
      return false
    }

    if (result !== 'sent') {
      const settled = await runtime.coordinator.settle({
        feedbackProbe,
        message: protectedMessage,
        method: 'panel-emoji',
        success: false,
      })
      if (settled.failureReason === 'platform-feedback') {
        debug.fail('panel-send-platform-feedback', {
          inputChanged: runtime.inputFingerprint(input) !== beforeInput,
          inputEmpty: runtime.inputIsEmpty(input),
          itemConnected: item.isConnected,
          itemWasVisible,
          result,
        })
        return false
      }
      if (runtime.countMatchingAssets(asset) > previousCount) {
        runtime.coordinator.finish(protectedMessage, true)
        runtime.updateCooldown(protectedMessage)
        runtime.releaseInputFocus(input)
        runtime.showToast(t('toastImageEmojiSent'), 'success')
        return true
      }
      const direct = await sendDirectFallback('panel-send-unconfirmed')
      if (direct.attempted) {
        nativeSendObserver?.cancel()
        return direct.success
      }
      debug.fail('panel-send-unconfirmed', {
        assetAfterPanelResolution: debug.asset(asset),
        directReason: bilibiliRoomEmoticonIdentity(asset)
          ? 'not-attempted'
          : 'identity-unavailable',
        inputChanged: runtime.inputFingerprint(input) !== beforeInput,
        inputEmpty: runtime.inputIsEmpty(input),
        imageMessageCountAfter: runtime.countChatImageMessages(),
        itemConnected: item.isConnected,
        itemWasVisible,
        matchingAssetCountAfter: runtime.countMatchingAssets(asset),
        nativeSendResult: nativeResult,
        previousCount,
        previousImageMessageCount,
        result,
        resultTimeout,
      })
      nativeSendObserver?.cancel()
      runtime.showToast(t('toastImageUnconfirmed', runtime.platformName), 'error')
      return false
    }

    const settled = await runtime.coordinator.settle({
      feedbackProbe,
      message: protectedMessage,
      method: 'panel-emoji',
      success: true,
    })
    if (!settled.success) {
      nativeSendObserver?.cancel()
      debug.fail('panel-send-success-feedback-rejected', {
        itemConnected: item.isConnected,
        result,
      })
      return false
    }
    nativeSendObserver?.cancel()
    runtime.releaseInputFocus(input)
    runtime.showToast(t('toastImageEmojiSent'), 'success')
    return true
  }

  private async enrichAssetNames(payload: RichMessagePayload): Promise<RichMessagePayload> {
    const runtime = this.#runtime
    if (!payload.assets.length) return payload
    if (bilibiliAutoRecognizedEmojiText(payload)) {
      runtime.refreshPayloadText(payload)
      return payload
    }
    let resolvedSingleItem: HTMLElement | null = null
    const input = runtime.findEmojiEditor() || runtime.findInput()
    for (let index = 0; index < payload.assets.length; index += 1) {
      const asset = payload.assets[index]
      const shouldResolveNative = !isNativePanelAsset(asset)
      if (runtime.emojiTokenQuality(asset.token) >= 3 && !shouldResolveNative) continue
      let item = this.findUniqueEmoji(asset, runtime.fullscreenActive())
      if (!item && input) item = await this.openUniqueEmoji(input, asset)
      if (!item) continue
      runtime.enrichAsset(payload, index, item)
      if (payload.assets.length === 1) resolvedSingleItem = item
    }
    runtime.refreshPayloadText(payload)
    if (
      resolvedSingleItem &&
      this.favoriteImagePayload(payload) &&
      !payload.assets.some(isNativePanelAsset)
    ) {
      this.markPayloadAsNativePanel(payload, resolvedSingleItem)
    }
    return payload
  }
}

export { isNativePanelAsset as isBilibiliNativePanelAsset }

import { t } from '../../core/i18n'
import { unicodeEmojiFallbackText } from '../live/emoji-fallback'
import { uniqueHighestScoringItem } from '../live/native-emoji'
import { nativeEmojiNameMessage } from '../live/native-name-message'
import type { LivePlatformSender } from '../live/platform-sender'
import type { RichEmojiAsset, RichMessagePayload } from '../live/rich-message'
import type { SendCoordinator } from '../live/send-coordinator'
import type { LiveTextSender } from '../live/text-sender'
import { isDouyuNativeImagePayload } from './rich-message-sender'

type EmojiResult = 'dispatched' | 'inserted' | 'none' | 'sent'

interface EmojiSubmission {
  consumed: boolean
  sent: boolean
}

export interface DouyuSenderRuntime {
  assetMatchScore(element: Element, asset: RichEmojiAsset): number
  coordinator: SendCoordinator
  countChatImageMessages(): number
  countMatchingAssets(asset: RichEmojiAsset): number
  emojiCategories(includeHidden: boolean): HTMLElement[]
  emojiItems(includeHidden: boolean): Element[]
  emojiToggles(input: HTMLElement, includeHidden: boolean): HTMLElement[]
  findInput(): HTMLElement | null
  fullscreenActive(): boolean
  inputFingerprint(input: HTMLElement): string
  interactiveEmojiItem(element: Element): HTMLElement
  isVisible(element: Element): boolean
  platformName: string
  refreshPayloadText(payload: RichMessagePayload): string
  releaseInputFocus(input: HTMLElement): void
  showToast(message: string, tone: 'error' | 'info' | 'success' | 'warning'): void
  submitInsertedEmoji(
    input: HTMLElement,
    asset: RichEmojiAsset,
    previousCount: number,
    previousImageMessageCount: number,
  ): Promise<EmojiSubmission>
  textSender: LiveTextSender
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
}

export class DouyuSender implements LivePlatformSender {
  readonly #runtime: DouyuSenderRuntime

  constructor(runtime: DouyuSenderRuntime) {
    this.#runtime = runtime
  }

  async prepareFavorite(payload: RichMessagePayload): Promise<RichMessagePayload> {
    this.#runtime.refreshPayloadText(payload)
    return payload
  }

  sendFavorite(payload: RichMessagePayload): Promise<boolean> {
    return payload.assets.length ? this.sendRich(payload) : this.sendText(payload.text)
  }

  async sendRich(payload: RichMessagePayload): Promise<boolean> {
    const unicodeFallback = unicodeEmojiFallbackText(payload)
    if (unicodeFallback) return this.sendText(unicodeFallback)
    if (isDouyuNativeImagePayload(payload)) return this.sendNative(payload)
    const message = nativeEmojiNameMessage(payload)
    if (!message) {
      this.#runtime.showToast(t('toastEmojiNameUnavailable', this.#runtime.platformName), 'error')
      return false
    }
    return this.sendText(message)
  }

  sendText(message: string): Promise<boolean> {
    return this.#runtime.textSender.send(message)
  }

  private findMatchingEmoji(
    asset: RichEmojiAsset,
    includeHidden = false,
  ): HTMLElement | null {
    return uniqueHighestScoringItem(
      this.#runtime.emojiItems(includeHidden),
      this.#runtime.interactiveEmojiItem,
      (element) => this.#runtime.assetMatchScore(element, asset),
    )
  }

  private async waitForMatchingEmoji(
    asset: RichEmojiAsset,
    timeout: number,
    includeHidden: boolean,
  ): Promise<HTMLElement | null> {
    const deadline = Date.now() + timeout
    let match = this.findMatchingEmoji(asset, includeHidden)
    while (!match && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      match = this.findMatchingEmoji(asset, includeHidden)
    }
    return match
  }

  private async waitForCategoryEmoji(
    asset: RichEmojiAsset,
    previousItems: Set<HTMLElement>,
    timeout: number,
    includeHidden: boolean,
  ): Promise<HTMLElement | null> {
    const deadline = Date.now() + timeout
    let replacementObservedAt = 0
    let sawEmptyList = false
    while (Date.now() < deadline) {
      const match = this.findMatchingEmoji(asset, includeHidden)
      if (match) return match
      const items = new Set(
        this.#runtime.emojiItems(includeHidden).map(this.#runtime.interactiveEmojiItem),
      )
      if (!items.size) sawEmptyList = true
      const replaced =
        (sawEmptyList && items.size > 0) ||
        items.size !== previousItems.size ||
        Array.from(items).some((item) => !previousItems.has(item))
      if (replaced && !replacementObservedAt) replacementObservedAt = Date.now()
      if (items.size && replacementObservedAt && Date.now() - replacementObservedAt >= 80) {
        return null
      }
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    return this.findMatchingEmoji(asset, includeHidden)
  }

  private async openMatchingEmoji(
    input: HTMLElement,
    asset: RichEmojiAsset,
  ): Promise<HTMLElement | null> {
    const includeHidden = this.#runtime.fullscreenActive()
    let item =
      this.findMatchingEmoji(asset) ||
      (includeHidden ? this.findMatchingEmoji(asset, true) : null)
    if (item) return item
    const toggle = this.#runtime.emojiToggles(input, includeHidden)[0]
    if (toggle) {
      toggle.click()
      item = await this.waitForMatchingEmoji(asset, 900, includeHidden)
      if (item) return item
    }
    for (const category of this.#runtime.emojiCategories(includeHidden)) {
      if (!category.isConnected) continue
      const previousItems = new Set(
        this.#runtime.emojiItems(includeHidden).map(this.#runtime.interactiveEmojiItem),
      )
      category.click()
      item = await this.waitForCategoryEmoji(asset, previousItems, 750, includeHidden)
      if (item) return item
    }
    return this.findMatchingEmoji(asset, true)
  }

  private async sendNative(payload: RichMessagePayload): Promise<boolean> {
    const runtime = this.#runtime
    const asset = payload.assets[0]
    const protectedMessage = String(payload.text || asset?.token || '图片表情')
    if (!asset || !runtime.coordinator.begin(protectedMessage)) return false

    const input = runtime.findInput()
    if (!input) {
      runtime.coordinator.finish(protectedMessage, false)
      runtime.showToast(t('toastEditorNotFound', runtime.platformName), 'error')
      return false
    }
    const item = await this.openMatchingEmoji(input, asset)
    if (!item) {
      runtime.coordinator.finish(protectedMessage, false)
      runtime.showToast(t('toastEmojiPanelNoMatch', runtime.platformName), 'error')
      return false
    }

    const previousCount = runtime.countMatchingAssets(asset)
    const previousImageMessageCount = runtime.countChatImageMessages()
    const beforeInput = runtime.inputFingerprint(input)
    const itemWasVisible = runtime.isVisible(item)
    const networkObserver = await runtime.coordinator.observeNetwork()
    const feedbackProbe = runtime.coordinator.feedbackProbe(document)
    item.click()
    let result = await runtime.waitForEmojiResult(
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
    if (result === 'inserted' && runtime.inputFingerprint(input) !== beforeInput) {
      const submission = await runtime.submitInsertedEmoji(
        input,
        asset,
        previousCount,
        previousImageMessageCount,
      )
      result = submission.sent ? 'sent' : 'none'
    }
    if (result !== 'sent') {
      const settled = await runtime.coordinator.settle({
        feedbackProbe,
        message: protectedMessage,
        method: 'panel-emoji',
        networkObserver,
        success: false,
      })
      if (settled.failureReason !== 'platform-feedback' && settled.failureReason !== 'unconfirmed') {
        runtime.showToast(t('toastImageUnconfirmed', runtime.platformName), 'error')
      }
      return false
    }
    const settled = await runtime.coordinator.settle({
      feedbackProbe,
      message: protectedMessage,
      method: 'panel-emoji',
      networkObserver,
      success: true,
    })
    if (!settled.success) return false
    runtime.releaseInputFocus(input)
    runtime.showToast(t('toastImageEmojiSent'), 'success')
    return true
  }
}

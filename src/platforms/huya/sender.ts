import { t } from '../../core/i18n'
import { unicodeEmojiFallbackText } from '../live/emoji-fallback'
import type { LivePlatformSender } from '../live/platform-sender'
import type { RichMessagePayload } from '../live/rich-message'
import { nativeEmojiNameMessage } from '../live/native-name-message'
import type { LiveTextSender } from '../live/text-sender'

export interface HuyaSenderRuntime {
  completeEmojiTokens(payload: RichMessagePayload): void
  platformName: string
  refreshPayloadText(payload: RichMessagePayload): string
  showToast(message: string, tone: 'error' | 'info' | 'success' | 'warning'): void
  textSender: LiveTextSender
}

export class HuyaSender implements LivePlatformSender {
  readonly #runtime: HuyaSenderRuntime

  constructor(runtime: HuyaSenderRuntime) {
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
    this.#runtime.completeEmojiTokens(payload)
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
}

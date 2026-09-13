import type { RichPayloadLike } from './emoji-fallback'

export type LiveRichMessagePayload = RichPayloadLike

export interface LiveRichMessageSenderRuntime {
  prepareEmojiNames?(payload: LiveRichMessagePayload): void | Promise<void>
  reportEmojiNameUnavailable(): void
  sendBilibiliNative(payload: LiveRichMessagePayload): Promise<boolean>
  sendDouyuNative(payload: LiveRichMessagePayload): Promise<boolean>
  sendText(message: string): Promise<boolean>
}

export type LiveRichMessageSender = (
  payload: LiveRichMessagePayload,
  runtime: LiveRichMessageSenderRuntime,
) => Promise<boolean>

import type { SupportedContentPlatform } from './config'
import type { RichPayloadLike } from './emoji-fallback'
import { sendBilibiliRichMessage } from '../bilibili/rich-message-sender'
import { sendDouyuRichMessage } from '../douyu/rich-message-sender'
import { sendHuyaRichMessage } from '../huya/rich-message-sender'

export type LiveRichMessagePayload = RichPayloadLike

export interface LiveRichMessageSenderRuntime {
  prepareEmojiNames?(payload: LiveRichMessagePayload): void | Promise<void>
  reportEmojiNameUnavailable(): void
  sendBilibiliNative(payload: LiveRichMessagePayload): Promise<boolean>
  sendText(message: string): Promise<boolean>
}

export type LiveRichMessageSender = (
  payload: LiveRichMessagePayload,
  runtime: LiveRichMessageSenderRuntime,
) => Promise<boolean>

export function liveRichMessageSender(platform: SupportedContentPlatform): LiveRichMessageSender {
  if (platform === 'bilibili') return sendBilibiliRichMessage
  if (platform === 'douyu') return sendDouyuRichMessage
  return sendHuyaRichMessage
}

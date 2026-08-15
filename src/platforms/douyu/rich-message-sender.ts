import { nativeEmojiNameMessage } from '../live/native-name-message'
import type {
  LiveRichMessagePayload,
  LiveRichMessageSenderRuntime,
} from '../live/rich-message-sender'

export async function sendDouyuRichMessage(
  payload: LiveRichMessagePayload,
  runtime: LiveRichMessageSenderRuntime,
): Promise<boolean> {
  const message = nativeEmojiNameMessage(payload)
  if (!message) {
    runtime.reportEmojiNameUnavailable()
    return false
  }
  return runtime.sendText(message)
}

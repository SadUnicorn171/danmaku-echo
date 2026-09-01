import { nativeEmojiNameMessage } from '../live/native-name-message'
import type {
  LiveRichMessagePayload,
  LiveRichMessageSenderRuntime,
} from '../live/rich-message-sender'

function normalizePartText(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/**
 * A single Douyu image Emoji must be dispatched through the native picker so
 * the page emits pe=3. Writing the same bracketed name into the editor emits
 * pe=0 and is only a plain text message.
 */
export function isDouyuNativeImagePayload(payload: LiveRichMessagePayload): boolean {
  if (!Array.isArray(payload.assets) || payload.assets.length !== 1) return false
  if (!Array.isArray(payload.parts) || !payload.parts.length) return true

  const token = normalizePartText(payload.assets[0]?.token)
  const plainToken = token.replace(/^\[|\]$/g, '')
  let imageParts = 0
  for (const part of payload.parts) {
    if (!part || typeof part !== 'object') return false
    if (part.type === 'emoji') {
      imageParts += 1
      continue
    }
    if (part.type !== 'text') return false
    const text = normalizePartText(part.text)
    if (text && text !== token && text !== plainToken) return false
  }
  return imageParts === 1
}

export async function sendDouyuRichMessage(
  payload: LiveRichMessagePayload,
  runtime: LiveRichMessageSenderRuntime,
): Promise<boolean> {
  if (isDouyuNativeImagePayload(payload)) {
    return runtime.sendDouyuNative(payload)
  }
  const message = nativeEmojiNameMessage(payload)
  if (!message) {
    runtime.reportEmojiNameUnavailable()
    return false
  }
  return runtime.sendText(message)
}

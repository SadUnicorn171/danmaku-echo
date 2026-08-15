import {
  BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX,
  LEGACY_BILIBILI_EXCLUSIVE_ASSET_KEY_PREFIX,
  NATIVE_PANEL_ASSET_KEY_PREFIX,
} from '../live/editor-config'
import { nativeEmojiNameMessage } from '../live/native-name-message'
import type {
  LiveRichMessagePayload,
  LiveRichMessageSenderRuntime,
} from '../live/rich-message-sender'

function hasNativeImageIdentity(asset: unknown): boolean {
  if (!asset || typeof asset !== 'object') return false
  const keys = (asset as { keys?: unknown }).keys
  return Array.isArray(keys) && keys.some((key) => {
    const normalized = String(key || '').toLowerCase()
    return (normalized.startsWith(NATIVE_PANEL_ASSET_KEY_PREFIX)
      && !normalized.startsWith(`${NATIVE_PANEL_ASSET_KEY_PREFIX}resolved:`))
      || normalized.startsWith(LEGACY_BILIBILI_EXCLUSIVE_ASSET_KEY_PREFIX)
  })
}

function hasAutoTextIdentity(asset: unknown): boolean {
  if (!asset || typeof asset !== 'object') return false
  const keys = (asset as { keys?: unknown }).keys
  return Array.isArray(keys) && keys.some((key) => {
    const normalized = String(key || '').toLowerCase()
    return normalized.startsWith(BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX)
      // v2.3.0 briefly inferred this key from a panel item's bracketed
      // display name. That is not authoritative: room Emoji such as [抱小皮]
      // may expose only a name while requiring dm_type=1. Ignore persisted
      // copies of the bad marker so old favorites are repaired on next send.
      && !normalized.startsWith(`${BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX}panel-name:`)
  })
}

/**
 * Bilibili's ordinary bracket Emoji (for example `[大笑]`) are recognized by
 * the official editor when submitted as text only when the rendered/picker
 * metadata explicitly identifies that ordinary Emoji. A bracketed name by
 * itself is not enough: room Emoji may expose only that display name while
 * their room_xxx_xxx identity stays in Bilibili's internal panel state.
 */
export function bilibiliAutoRecognizedEmojiText(payload: LiveRichMessagePayload): string {
  if (!Array.isArray(payload.assets) || !payload.assets.length) return ''
  const partAssets = Array.isArray(payload.parts)
    ? payload.parts.flatMap((part) => {
        if (!part || typeof part !== 'object' || part.type !== 'emoji') return []
        return [part.asset]
      })
    : []
  const allAssets = [...payload.assets, ...partAssets]
  if (allAssets.some(hasNativeImageIdentity)) return ''
  if (!allAssets.length || allAssets.some((asset) => !hasAutoTextIdentity(asset))) return ''
  if (payload.assets.length === 1) {
    const asset = payload.assets[0]
    const token = String((asset as { token?: unknown })?.token || '').trim()
    const text = String(payload.text || '').trim()
    const duplicateAccessibilityLabel =
      token && (text === `${token}${token}` || text === `${token} ${token}`)
    if (token && (text === token || duplicateAccessibilityLabel)) {
      // Some Bilibili rows render one image plus an identical hidden
      // accessibility label. The ordered DOM parts then look duplicated even
      // though the authoritative message text contains one Emoji.
      return nativeEmojiNameMessage({
        assets: [asset],
        parts: [{ asset, type: 'emoji' }],
        text,
      })
    }
  }
  return nativeEmojiNameMessage(payload)
}

export function sendBilibiliRichMessage(
  payload: LiveRichMessagePayload,
  runtime: LiveRichMessageSenderRuntime,
): Promise<boolean> {
  const message = bilibiliAutoRecognizedEmojiText(payload)
  if (message) return runtime.sendText(message)
  return runtime.sendBilibiliNative(payload)
}

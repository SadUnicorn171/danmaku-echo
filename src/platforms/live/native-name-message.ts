import { orderedBracketEmojiText, type RichPayloadLike } from './emoji-fallback'

const BRACKET_EMOJI_TOKEN = /^\[[^\]\n]{1,80}\]$/
const GENERIC_EMOJI_NAMES = new Set([
  'emoji',
  'emote',
  'image',
  'sticker',
  '图片',
  '图片emoji',
  '图片表情',
  '表情',
])

function normalizedBracketToken(value: unknown): string {
  const token = String(value || '').trim()
  if (!BRACKET_EMOJI_TOKEN.test(token)) return ''
  const name = token.slice(1, -1).trim()
  if (!name || GENERIC_EMOJI_NAMES.has(name.toLowerCase())) return ''
  return `[${name}]`
}

/**
 * Rebuild bracketed Emoji text only when every image has an exact, non-generic
 * name and the original DOM order is known. Platform senders still decide
 * whether a particular asset type supports editor-side name recognition.
 */
export function nativeEmojiNameMessage(payload: RichPayloadLike | null | undefined): string {
  const ordered = orderedBracketEmojiText(payload)
  if (ordered) {
    const tokens = ordered.match(/\[[^\]\n]{1,80}\]/g) || []
    if (tokens.length && tokens.every((token) => Boolean(normalizedBracketToken(token)))) {
      return ordered
    }
  }

  if (!payload || !Array.isArray(payload.assets) || !payload.assets.length) return ''
  const tokens = payload.assets.map((asset) => {
    if (!asset || typeof asset !== 'object') return ''
    return normalizedBracketToken((asset as { token?: unknown }).token)
  })
  if (tokens.some((token) => !token)) return ''

  const text = String(payload.text || '').trim()
  if (!text) return ''
  const remaining = [...tokens]
  for (const token of text.match(/\[[^\]\n]{1,80}\]/g) || []) {
    const index = remaining.indexOf(normalizedBracketToken(token))
    if (index >= 0) remaining.splice(index, 1)
  }
  return remaining.length === 0 ? text : ''
}

import type { RichPayload } from './own-message'

const BRACKET_EMOJI_PATTERN = /^\[[^\]\r\n]{1,40}\]$/u
const BRACKET_EMOJI_GLOBAL_PATTERN = /\[[^\]\r\n]{1,40}\]/gu

function normalizedText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function bracketToken(value: unknown): string {
  const token = normalizedText(value)
  return BRACKET_EMOJI_PATTERN.test(token) ? token : ''
}

/**
 * Douyin resolves `[name]` in the official editor when the message is sent.
 * The +1 path therefore always produces one plain-text value and never needs
 * to locate, open, or click the native Emoji panel.
 */
export function douyinAutoRecognizedEmojiText(payload: RichPayload): string {
  if (!Array.isArray(payload.parts) || !payload.parts.length) return ''
  const emojiPartCount = payload.parts.filter((part) => part.type === 'emoji').length
  const displayedText = normalizedText(payload.text)
  const displayedBracketTokens = displayedText.match(BRACKET_EMOJI_GLOBAL_PATTERN) || []
  // The complete interaction text is authoritative when it already contains
  // native bracket tokens. Do not compare image counts: renderer versions may
  // batch repeated images into fewer content nodes.
  if (emojiPartCount > 0 && displayedBracketTokens.length > 0) {
    return displayedText
  }

  let emojiCount = 0
  let rebuilt = ''
  for (const part of payload.parts) {
    if (part.type === 'text') {
      rebuilt += part.text
      continue
    }
    const token = bracketToken(part.asset?.token)
    if (!token) return ''
    rebuilt += token
    emojiCount += 1
  }
  if (!emojiCount || !rebuilt || Array.from(rebuilt).length > 1_000) return ''
  const plainText = normalizedText(payload.plainText)
  const exactDisplayedText = normalizedText(rebuilt) === displayedText
  // Older Canvas payloads omitted image names from description.text. Ordered
  // parts enriched from renderer metadata or the matching side-chat row still
  // provide a lossless text representation for those payloads.
  const rendererOmittedEmojiNames = displayedText === plainText
    || (!plainText && displayedText === '表情')
  if (!exactDisplayedText && !rendererOmittedEmojiNames) return ''
  return rebuilt
}

const GENERIC_EMOTICON_LABEL = /^(?:图片|图片表情|表情|表情包|emoji|emote|emoticon|image|sticker)$/i

function normalizeLabel(value: unknown): string {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Bilibili places accessibility descriptions for user badges beside live
 * messages. They describe an image, but they are not the name of an Emoji.
 */
export function isBilibiliDecorativeImageDescription(value: unknown): boolean {
  const normalized = normalizeLabel(value).replace(/^\[|\]$/g, '')
  return /(?:这是\s*(?:ta|他|她)\s*的[^\n]{0,32}(?:勋章|徽章)|(?:荣耀|荣誉|粉丝|用户|主播|舰长|守护|贵族)等级(?:勋章|徽章))/i.test(
    normalized,
  )
}

/**
 * Room Emoji use a native `room_<room>_<id>` identity for sending, while the
 * side-chat row exposes their user-facing name as plain `data-danmaku` text.
 * Normalize that authoritative label to the token shape used by favorites.
 */
export function bilibiliNativeEmoticonToken(value: unknown): string {
  const normalized = normalizeLabel(value)
  if (!normalized || isBilibiliDecorativeImageDescription(normalized)) return ''

  const bracketed = /^\[([^\]\n]{1,40})\]$/.exec(normalized)
  const name = normalizeLabel(bracketed ? bracketed[1] : normalized)
  if (
    !name ||
    GENERIC_EMOTICON_LABEL.test(name) ||
    /^(?:data|blob|https?):/i.test(name) ||
    /[\\/]/.test(name) ||
    Array.from(name).length > 40 ||
    /^room_\d+_\d+$/i.test(name) ||
    /^(?:\d{6,}|[a-f\d]{16,}|[a-z\d_-]{24,})$/i.test(name)
  ) {
    return ''
  }
  return `[${name}]`
}

/** Returns true for Bilibili's hidden text copy beside one rendered Emoji. */
export function isBilibiliEmoticonFallbackLabel(value: unknown, tokenValue: unknown): boolean {
  const valueText = normalizeLabel(value)
  const token = normalizeLabel(tokenValue)
  const bracketed = /^\[([^\]\n]{1,40})\]$/.exec(token)
  return Boolean(valueText && bracketed && [token, normalizeLabel(bracketed[1])].includes(valueText))
}

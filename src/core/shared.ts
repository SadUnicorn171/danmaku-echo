import type {
  ColorSettingKey,
  ColorSettings,
  ExtensionSettings,
  PlatformId,
  SharedExtensionApi,
} from './types'
import {
  extractSenderFromRecord,
  normalizeSenderName,
  replyDraftValue,
  replyMention,
} from './reply'

export {
  extractSenderFromRecord,
  normalizeSenderName,
  replyDraftValue,
  replyMention,
} from './reply'

export const COLOR_SETTING_KEYS: readonly ColorSettingKey[] = Object.freeze([
  'actionStart',
  'actionEnd',
  'actionText',
  'focusRing',
  'selection',
  'panelBackground',
  'panelText',
  'success',
  'warning',
  'error',
])

const COLOR_CSS_VARIABLES: Record<ColorSettingKey, string> = Object.freeze({
  actionStart: '--bcp-action-start',
  actionEnd: '--bcp-action-end',
  actionText: '--bcp-action-text',
  focusRing: '--bcp-focus-ring',
  selection: '--bcp-selection',
  panelBackground: '--bcp-panel-background',
  panelText: '--bcp-panel-text',
  success: '--bcp-success',
  warning: '--bcp-warning',
  error: '--bcp-error',
})

function emptyColorSettings(): ColorSettings {
  return Object.fromEntries(COLOR_SETTING_KEYS.map((key) => [key, ''])) as ColorSettings
}

export const DEFAULT_SETTINGS: ExtensionSettings = Object.freeze({
  enabled: true,
  altClick: true,
  actions: Object.freeze({
    plusOne: true,
    reply: true,
    favorite: true,
  }),
  platforms: Object.freeze({
    huya: true,
    bilibili: true,
    douyin: true,
    douyu: true,
  }),
  sideChatCapsule: Object.freeze({
    huya: false,
    bilibili: false,
    douyu: false,
  }),
  nativeDanmakuCapsule: Object.freeze({
    douyu: false,
  }),
  colors: Object.freeze({
    huya: Object.freeze(emptyColorSettings()),
    bilibili: Object.freeze(emptyColorSettings()),
    douyin: Object.freeze(emptyColorSettings()),
    douyu: Object.freeze(emptyColorSettings()),
  }),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

export function normalizeHexColor(value: unknown): string {
  const color = String(value == null ? '' : value).trim()
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : ''
}

function mergeColorSettings(saved: unknown): ColorSettings {
  const value = isRecord(saved) ? saved : {}
  return Object.fromEntries(
    COLOR_SETTING_KEYS.map((key) => [key, normalizeHexColor(value[key])]),
  ) as ColorSettings
}

export function applyPlatformColors(root: unknown, colors: unknown): void {
  if (!isRecord(root) || !isRecord(root.style)) {
    return
  }
  const style = root.style as {
    removeProperty?: (property: string) => void
    setProperty?: (property: string, value: string) => void
  }
  if (typeof style.setProperty !== 'function' || typeof style.removeProperty !== 'function') {
    return
  }
  const values = mergeColorSettings(colors)
  COLOR_SETTING_KEYS.forEach((key) => {
    const property = COLOR_CSS_VARIABLES[key]
    if (values[key]) {
      style.setProperty!(property, values[key])
    } else {
      style.removeProperty!(property)
    }
  })
}

export function detectPlatform(hostname: unknown, pathname?: unknown): PlatformId | null {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/:\d+$/, '')
  const path = String(pathname || '')
  if (/(^|\.)huya\.com$/.test(host)) {
    return 'huya'
  }
  if (host === 'live.bilibili.com' || host.endsWith('.live.bilibili.com')) {
    return 'bilibili'
  }
  if (host === 'douyu.com' || host.endsWith('.douyu.com')) {
    return 'douyu'
  }
  if (host === 'live.douyin.com' || host.endsWith('.live.douyin.com')) {
    return 'douyin'
  }
  if (host === 'www.douyin.com' && /^\/follow\/live(?:\/|$)/.test(path)) {
    return 'douyin'
  }
  return null
}

export function normalizeWhitespace(value: unknown): string {
  return (
    String(value == null ? '' : value)
      // U+200D is the zero-width joiner used by family, profession and many
      // gendered Emoji sequences. Removing it changes the message being echoed.
      .replace(/[\u200B\u200C\u2060\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim()
  )
}

function sliceGraphemes(value: string, limit: number): string {
  if (limit <= 0) return ''
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)
    const result: string[] = []
    for (const item of segments) {
      if (result.length >= limit) break
      result.push(item.segment)
    }
    return result.join('')
  }
  return Array.from(value).slice(0, limit).join('')
}

export function parseMessageText(value: unknown, maxLength?: number): string {
  const limit = Number.isFinite(maxLength) ? Number(maxLength) : 200
  const normalized = normalizeWhitespace(value)
  if (!normalized) {
    return ''
  }
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(举报|屏蔽|回复|复制|更多|关注)$/.test(line))
  const text = lines.length > 1 ? lines.at(-1) || '' : lines[0] || ''
  return sliceGraphemes(text, limit)
}

export function isPlausibleMessage(value: unknown, maxLength?: number): boolean {
  const text = normalizeWhitespace(value)
  const limit = Number.isFinite(maxLength) ? Number(maxLength) : 200
  const length = Array.from(text).length
  if (length < 1 || length > limit) {
    return false
  }
  return !/^(欢迎来到直播间|系统消息|直播已结束|主播暂时离开|登录后即可发言)$/.test(text)
}

export function mergeSettings(saved?: unknown): ExtensionSettings {
  const value = isRecord(saved) ? saved : {}
  const savedPlatforms = isRecord(value.platforms) ? value.platforms : {}
  const savedActions = isRecord(value.actions) ? value.actions : {}
  const savedSideChatCapsule = isRecord(value.sideChatCapsule)
    ? value.sideChatCapsule
    : isRecord(value.sideChatPlusOne)
      ? value.sideChatPlusOne
      : {}
  const savedNativeDanmakuCapsule = isRecord(value.nativeDanmakuCapsule)
    ? value.nativeDanmakuCapsule
    : {}
  const savedColors = isRecord(value.colors) ? value.colors : {}
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_SETTINGS.enabled,
    altClick: typeof value.altClick === 'boolean' ? value.altClick : DEFAULT_SETTINGS.altClick,
    actions: {
      plusOne: typeof savedActions.plusOne === 'boolean' ? savedActions.plusOne : true,
      reply: typeof savedActions.reply === 'boolean' ? savedActions.reply : true,
      favorite: typeof savedActions.favorite === 'boolean' ? savedActions.favorite : true,
    },
    platforms: {
      huya: typeof savedPlatforms.huya === 'boolean' ? savedPlatforms.huya : true,
      bilibili: typeof savedPlatforms.bilibili === 'boolean' ? savedPlatforms.bilibili : true,
      douyin: typeof savedPlatforms.douyin === 'boolean' ? savedPlatforms.douyin : true,
      douyu: typeof savedPlatforms.douyu === 'boolean' ? savedPlatforms.douyu : true,
    },
    sideChatCapsule: {
      huya:
        typeof savedSideChatCapsule.huya === 'boolean'
          ? savedSideChatCapsule.huya
          : DEFAULT_SETTINGS.sideChatCapsule.huya,
      bilibili:
        typeof savedSideChatCapsule.bilibili === 'boolean'
          ? savedSideChatCapsule.bilibili
          : DEFAULT_SETTINGS.sideChatCapsule.bilibili,
      douyu:
        typeof savedSideChatCapsule.douyu === 'boolean'
          ? savedSideChatCapsule.douyu
          : DEFAULT_SETTINGS.sideChatCapsule.douyu,
    },
    nativeDanmakuCapsule: {
      douyu:
        typeof savedNativeDanmakuCapsule.douyu === 'boolean'
          ? savedNativeDanmakuCapsule.douyu
          : DEFAULT_SETTINGS.nativeDanmakuCapsule.douyu,
    },
    colors: {
      huya: mergeColorSettings(savedColors.huya),
      bilibili: mergeColorSettings(savedColors.bilibili),
      douyin: mergeColorSettings(savedColors.douyin),
      douyu: mergeColorSettings(savedColors.douyu),
    },
  }
}

const shared: SharedExtensionApi = Object.freeze({
  COLOR_SETTING_KEYS,
  DEFAULT_SETTINGS,
  applyPlatformColors,
  detectPlatform,
  isPlausibleMessage,
  mergeSettings,
  normalizeHexColor,
  extractSenderFromRecord,
  normalizeSenderName,
  normalizeWhitespace,
  parseMessageText,
  replyDraftValue,
  replyMention,
})

globalThis.DanmakuEchoShared = shared

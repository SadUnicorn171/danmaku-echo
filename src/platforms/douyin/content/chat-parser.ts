import { isPlausibleMessage, normalizeWhitespace, parseMessageText } from '../../../core/shared'
import { extractSenderFromRecord, normalizeSenderName } from '../../../core/reply'
import { findDouyinMessageContent } from '../chat-message'
import { douyinEmojiTokenFromResource } from '../emoji-token'
import { douyinRepeatReminderExclusionReason } from '../repeat-reminder-filter'
import { normalizedAssetKeys, type EmojiAssetDescriptor } from '../rich-data'
import type { RichPayload } from '../own-message'
import {
  CHAT_MESSAGE_SELECTORS,
  CHAT_ROOT_SELECTORS,
  EMOJI_ITEM_SELECTORS,
  MESSAGE_TEXT_SELECTORS,
  USER_NAME_SELECTORS,
} from './dom-config'
import { isDouyinOwnedNode, matchesAny, queryAll } from './dom-query'

export type DouyinChatMessageKind =
  | 'gift'
  | 'image-emoji'
  | 'lottery'
  | 'mixed'
  | 'system'
  | 'text'

export interface DouyinChatMessageDescriptor {
  readonly contentElement: Element
  readonly element: Element
  readonly kind: DouyinChatMessageKind
  readonly messageId: string
  readonly messageIds: readonly string[]
  /** Deep-frozen normalized payload shared by radar, favorites and own-message matching. */
  readonly payload: RichPayload & { sender: string }
  readonly sender: string
  readonly text: string
}

export interface DouyinChatParser {
  assetFromElement(element: unknown): EmojiAssetDescriptor | null
  contentElement(row: unknown): Element | null
  forget(row: Element): void
  parse(row: unknown): DouyinChatMessageDescriptor | null
  payloadFromElement(element: unknown): RichPayload
  rowsFromNode(node: unknown): Element[]
}

export interface DouyinChatParserOptions {
  baseUrl?: () => string
  maxLength?: number
}

interface CachedDescriptor {
  descriptor: DouyinChatMessageDescriptor
  signature: string
}

const SENDER_VALUE_ATTRIBUTES = [
  'data-username',
  'data-user-name',
  'data-name',
  'data-display-name',
  'data-nickname',
  'data-author-name',
  'data-sender-name',
  'data-sender',
  'data-display-id',
  'data-user-id',
  'data-sender-id',
  'data-author-id',
  'data-uid',
] as const

const SENDER_RECORD_ATTRIBUTES = [
  'data-user',
  'data-user-info',
  'data-user-data',
  'data-author',
  'data-sender',
  'data-profile',
] as const

const MESSAGE_ID_ATTRIBUTES = [
  'data-message-id',
  'data-msg-id',
  'data-item-id',
  'data-log-id',
  'data-id',
] as const

const ASSET_METADATA_ATTRIBUTES = [
  'data-id',
  'data-key',
  'data-uri',
  'data-url',
  'data-src',
  'data-text',
  'data-emoji',
  'data-emoji-id',
  'data-emoji-name',
  'data-emoticon',
  'data-resource-id',
  'title',
  'aria-label',
] as const

const SYSTEM_ROW_SELECTOR = [
  '[data-message-kind="system"]',
  '[data-message-type="system"]',
  '[data-message-kind="notice"]',
  '[data-message-type="notice"]',
  "[class*='system-message' i]",
  "[class*='systemMessage']",
  "[class*='notice-message' i]",
  "[class*='noticeMessage']",
].join(',')

function deepFreezePayload(payload: RichPayload, sender: string): RichPayload & { sender: string } {
  const freezeAsset = (asset: EmojiAssetDescriptor): EmojiAssetDescriptor =>
    Object.freeze({
      ...asset,
      keys: Object.freeze(asset.keys.slice()),
    }) as unknown as EmojiAssetDescriptor
  const assets = payload.assets.map(freezeAsset)
  const parts = payload.parts.map((part) => {
    if (part.type === 'text') return Object.freeze({ type: 'text' as const, text: part.text })
    return Object.freeze({ type: 'emoji' as const, asset: freezeAsset(part.asset) })
  })
  return Object.freeze({
    assets: Object.freeze(assets),
    parts: Object.freeze(parts),
    plainText: payload.plainText,
    sender,
    text: payload.text,
  }) as unknown as RichPayload & { sender: string }
}

export function createDouyinChatParser(
  options: DouyinChatParserOptions = {},
): DouyinChatParser {
  const maxLength = options.maxLength ?? 1_000
  const baseUrl = options.baseUrl ?? (() => location.href)
  const cache = new WeakMap<Element, CachedDescriptor>()

  function emojiTokenFromImage(image: HTMLImageElement): string {
    const marker = [
      typeof image.className === 'string' ? image.className : '',
      image.getAttribute('data-e2e'),
      image.getAttribute('data-testid'),
    ]
      .filter(Boolean)
      .join(' ')
    const raw = [
      image.getAttribute('alt'),
      image.getAttribute('data-text'),
      image.getAttribute('data-emoji'),
      image.getAttribute('data-emoji-name'),
      image.getAttribute('title'),
      image.getAttribute('aria-label'),
    ].find((value) => normalizeWhitespace(value))
    const value = normalizeWhitespace(raw)
    const resourceToken = (): string =>
      [image.currentSrc, image.getAttribute('src'), image.getAttribute('data-src')]
        .map(douyinEmojiTokenFromResource)
        .find(Boolean) || ''
    if (!value) return resourceToken()
    if (
      (/^\[[^\]\n]{1,40}\]$/u.test(value) || /\p{Extended_Pictographic}/u.test(value)) &&
      !/^\[(?:表情|图片表情|表情包|emoji|emote|emoticon|image|sticker)\]$/iu.test(value)
    ) {
      return value
    }
    if (
      /(emoji|emote|sticker|表情)/iu.test(marker) &&
      Array.from(value).length <= 40 &&
      !/^(?:表情|图片表情|表情包|emoji|emote|emoticon|image|sticker)$/iu.test(value)
    ) {
      return `[${value}]`
    }
    return resourceToken()
  }

  function assetFromElement(element: unknown): EmojiAssetDescriptor | null {
    if (!(element instanceof Element)) return null
    const image = element instanceof HTMLImageElement ? element : element.querySelector('img')
    const metadataElements: Element[] = []
    let metadataElement: Element | null = element
    for (let depth = 0; metadataElement && depth < 4; depth += 1) {
      metadataElements.push(metadataElement)
      if (depth > 0 && metadataElement.matches(EMOJI_ITEM_SELECTORS.join(','))) break
      metadataElement = metadataElement.parentElement
    }
    const metadataValues = metadataElements.flatMap((item) =>
      ASSET_METADATA_ATTRIBUTES.map((name) => item.getAttribute(name)).filter(
        (value): value is string => Boolean(value),
      ),
    )
    const sources = [
      image?.currentSrc,
      image?.getAttribute('src'),
      image?.getAttribute('data-src'),
      image?.getAttribute('data-url'),
      element.getAttribute('data-src'),
      element.getAttribute('data-url'),
      ...metadataElements.flatMap((item) => [
        item.getAttribute('data-uri'),
        item.getAttribute('data-src'),
        item.getAttribute('data-url'),
      ]),
    ].filter((value): value is string => Boolean(value))
    const names = [
      image && emojiTokenFromImage(image),
      image?.getAttribute('alt'),
      image?.getAttribute('data-text'),
      image?.getAttribute('data-emoji'),
      image?.getAttribute('data-emoji-name'),
      image?.getAttribute('data-emoticon'),
      image?.getAttribute('data-id'),
      image?.getAttribute('title'),
      image?.getAttribute('aria-label'),
      element.getAttribute('data-text'),
      element.getAttribute('data-emoji'),
      element.getAttribute('data-emoji-name'),
      element.getAttribute('data-emoticon'),
      element.getAttribute('data-id'),
      element.getAttribute('title'),
      element.getAttribute('aria-label'),
      ...metadataValues,
    ].filter((value): value is string => Boolean(value))
    const keys = new Set<string>()
    for (const value of [...sources, ...names]) {
      for (const key of normalizedAssetKeys(value, baseUrl())) keys.add(key)
    }
    if (!keys.size) return null
    return {
      src: String(sources[0] || '').slice(0, 4_096),
      token: normalizeWhitespace(names[0] || '').slice(0, 120),
      keys: [...keys].slice(0, 48),
    }
  }

  function contentElement(row: unknown): Element | null {
    return row instanceof Element ? findDouyinMessageContent(row, MESSAGE_TEXT_SELECTORS) : null
  }

  function richTextFromElement(element: Element): string {
    const clone = element.cloneNode(true) as Element
    for (const image of clone.querySelectorAll('img')) {
      const token = emojiTokenFromImage(image)
      image.replaceWith(document.createTextNode(token))
    }
    for (const selector of [
      'button',
      'svg',
      "[aria-hidden='true']",
      '[data-bcp-douyin-owned]',
      ...USER_NAME_SELECTORS,
    ]) {
      try {
        clone.querySelectorAll(selector).forEach((item) => item.remove())
      } catch {
        // Ignore selector support differences.
      }
    }
    return parseMessageText(clone.textContent, maxLength)
  }

  function richPartsFromElement(element: Element): RichPayload['parts'] {
    const parts: RichPayload['parts'] = []
    const appendText = (value: unknown): void => {
      const text = String(value || '')
      if (!text) return
      const previous = parts.at(-1)
      if (previous?.type === 'text') previous.text += text
      else parts.push({ type: 'text', text })
    }
    const visit = (node: Node): void => {
      if (parts.length >= 40) return
      if (node.nodeType === Node.TEXT_NODE) {
        appendText(node.nodeValue)
        return
      }
      if (!(node instanceof Element)) return
      if (
        node.matches("button,svg,[aria-hidden='true'],[data-bcp-douyin-owned]") ||
        matchesAny(node, USER_NAME_SELECTORS)
      ) {
        return
      }
      if (node instanceof HTMLImageElement) {
        const asset = assetFromElement(node)
        if (asset) parts.push({ type: 'emoji', asset })
        return
      }
      if (node.tagName === 'BR') {
        appendText('\n')
        return
      }
      Array.from(node.childNodes).forEach(visit)
    }
    Array.from(element.childNodes).forEach(visit)
    return parts
  }

  function payloadFromElement(element: unknown): RichPayload {
    if (!(element instanceof Element)) return { text: '', plainText: '', assets: [], parts: [] }
    const assets = Array.from(element.querySelectorAll('img'))
      .filter(
        (image) =>
          !image.closest(USER_NAME_SELECTORS.join(',')) &&
          !image.closest("[class*='avatar' i],[class*='badge' i],[class*='medal' i]"),
      )
      .map(assetFromElement)
      .filter((asset): asset is EmojiAssetDescriptor => Boolean(asset))
      .slice(0, 8)
    const plainClone = element.cloneNode(true) as Element
    plainClone
      .querySelectorAll("img,button,svg,[aria-hidden='true'],[data-bcp-douyin-owned]")
      .forEach((item) => item.remove())
    for (const selector of USER_NAME_SELECTORS) {
      try {
        plainClone.querySelectorAll(selector).forEach((item) => item.remove())
      } catch {
        // Ignore selector support differences.
      }
    }
    const plainText = parseMessageText(plainClone.textContent, maxLength)
    let text = richTextFromElement(element)
    if (!isPlausibleMessage(text, maxLength) && assets.length) {
      text = assets.map((asset) => asset.token).filter(Boolean).join(' ') || '表情'
    }
    return { text, plainText, assets, parts: richPartsFromElement(element) }
  }

  function senderFromRecordAttribute(element: Element, attribute: string): string {
    const raw = String(element.getAttribute(attribute) || '').trim()
    if (!raw) return ''
    const candidates = [raw]
    try {
      const decoded = decodeURIComponent(raw)
      if (decoded !== raw) candidates.push(decoded)
    } catch {
      // Ignore site-internal values that are not URI encoded strings.
    }
    for (const candidate of candidates) {
      try {
        const record: unknown = JSON.parse(candidate)
        const sender = extractSenderFromRecord(record) || extractSenderFromRecord({ user: record })
        if (sender) return sender
      } catch {
        const sender = normalizeSenderName(candidate)
        if (sender && !candidate.startsWith('{') && !candidate.startsWith('[')) return sender
      }
    }
    return ''
  }

  function senderFromChatContext(element: Element, allowPrefix: boolean): string {
    for (const selector of USER_NAME_SELECTORS) {
      let nameElement: Element | null = null
      try {
        nameElement = element.matches(selector) ? element : element.querySelector(selector)
      } catch {
        // Ignore selector support differences.
      }
      if (!nameElement) continue
      const values = [
        ...SENDER_VALUE_ATTRIBUTES.map((attribute) => nameElement.getAttribute(attribute)),
        nameElement.textContent,
        nameElement.getAttribute('aria-label'),
        nameElement.getAttribute('title'),
      ]
      for (const value of values) {
        const sender = normalizeSenderName(value)
        if (sender) return sender
      }
      for (const attribute of SENDER_RECORD_ATTRIBUTES) {
        const sender = senderFromRecordAttribute(nameElement, attribute)
        if (sender) return sender
      }
      if (nameElement instanceof HTMLAnchorElement) {
        try {
          const parts = new URL(nameElement.href, baseUrl()).pathname.split('/').filter(Boolean)
          const userIndex = parts.indexOf('user')
          const sender = normalizeSenderName(
            userIndex >= 0 ? decodeURIComponent(parts[userIndex + 1] || '') : '',
          )
          if (sender) return sender
        } catch {
          // User links can contain site-internal, non-URL identifiers.
        }
      }
    }
    for (const attribute of SENDER_VALUE_ATTRIBUTES) {
      const sender = normalizeSenderName(element.getAttribute(attribute))
      if (sender) return sender
    }
    for (const attribute of SENDER_RECORD_ATTRIBUTES) {
      const sender = senderFromRecordAttribute(element, attribute)
      if (sender) return sender
    }
    if (!allowPrefix) return ''
    const rowText = normalizeWhitespace(
      element instanceof HTMLElement ? element.innerText || element.textContent : element.textContent,
    )
    return normalizeSenderName(rowText.match(/^([^：:\n]{1,64})[：:]\s*/u)?.[1])
  }

  function senderFromChatRow(row: Element): string {
    let current: Element | null = row
    for (let depth = 0; current && depth < 5; depth += 1) {
      const sender = senderFromChatContext(current, depth === 0)
      if (sender) return sender
      if (matchesAny(current, CHAT_ROOT_SELECTORS)) break
      current = current.parentElement
    }
    return ''
  }

  function messageIdsFromRow(row: Element, content: Element): string[] {
    const ids = new Set<string>()
    for (const element of new Set([row, content])) {
      for (const attribute of MESSAGE_ID_ATTRIBUTES) {
        const value = String(element.getAttribute(attribute) || '').trim()
        if (value && value.length <= 160) ids.add(value)
      }
    }
    return [...ids]
  }

  function signatureFor(row: Element, content: Element): string {
    const attributes = [
      ...MESSAGE_ID_ATTRIBUTES,
      'data-message-kind',
      'data-message-type',
      'class',
    ].map((name) => row.getAttribute(name) || '')
    const images = Array.from(content.querySelectorAll('img')).flatMap((image) => [
      image.currentSrc,
      image.getAttribute('src') || '',
      image.getAttribute('alt') || '',
      image.getAttribute('data-emoji') || '',
      image.getAttribute('data-emoji-name') || '',
    ])
    const senders = queryAll(USER_NAME_SELECTORS, row).flatMap((element) => [
      element.textContent || '',
      ...SENDER_VALUE_ATTRIBUTES.map((name) => element.getAttribute(name) || ''),
      ...SENDER_RECORD_ATTRIBUTES.map((name) => element.getAttribute(name) || ''),
    ])
    return JSON.stringify([attributes, content.textContent || '', images, senders])
  }

  function classify(
    row: Element,
    payload: RichPayload,
    messageId: string,
  ): DouyinChatMessageKind {
    const excludedReason = douyinRepeatReminderExclusionReason({
      element: row,
      messageId,
      text: payload.text || payload.plainText,
    })
    if (excludedReason === 'gift') return 'gift'
    if (excludedReason === 'synthetic-activity') return 'lottery'
    try {
      if (row.matches(SYSTEM_ROW_SELECTOR) || row.querySelector(SYSTEM_ROW_SELECTOR)) return 'system'
    } catch {
      // Keep unknown structures as ordinary chat.
    }
    if (payload.assets.length && payload.plainText) return 'mixed'
    if (payload.assets.length) return 'image-emoji'
    return isPlausibleMessage(payload.text || payload.plainText, maxLength) ? 'text' : 'system'
  }

  function parse(row: unknown): DouyinChatMessageDescriptor | null {
    if (!(row instanceof Element) || isDouyinOwnedNode(row)) return null
    const content = contentElement(row)
    if (!content) return null
    const signature = signatureFor(row, content)
    const cached = cache.get(row)
    if (cached?.signature === signature) return cached.descriptor
    const rawPayload = payloadFromElement(content)
    const sender = senderFromChatRow(row)
    const messageIds = messageIdsFromRow(row, content)
    const payload = deepFreezePayload(rawPayload, sender)
    const descriptor = Object.freeze({
      contentElement: content,
      element: row,
      kind: classify(row, payload, messageIds[0] || ''),
      messageId: messageIds[0] || '',
      messageIds: Object.freeze(messageIds),
      payload,
      sender,
      text: payload.text || payload.plainText,
    }) satisfies DouyinChatMessageDescriptor
    cache.set(row, { descriptor, signature })
    return descriptor
  }

  function rowsFromNode(node: unknown): Element[] {
    if (!(node instanceof Element)) return []
    const rows = matchesAny(node, CHAT_MESSAGE_SELECTORS) ? [node] : []
    for (const row of queryAll(CHAT_MESSAGE_SELECTORS, node)) {
      if (!rows.includes(row)) rows.push(row)
    }
    return rows.filter((row) => !isDouyinOwnedNode(row))
  }

  return {
    assetFromElement,
    contentElement,
    forget: (row) => cache.delete(row),
    parse,
    payloadFromElement,
    rowsFromNode,
  }
}

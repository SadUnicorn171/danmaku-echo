import type { DanmakuDescriptor, DanmakuRichTextPart, PlatformId } from '../../core/types'
import { normalizeSenderName, normalizeWhitespace, parseMessageText } from '../../core/shared'
import { douyuOverlayTextElements } from '../douyu/message-content'
import type { LivePlatformConfig } from './config'

function firstMatch(root: Element, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    try {
      if (root.matches(selector)) return root
      const match = root.querySelector(selector)
      if (match) return match
    } catch {
      // Platform selectors are defensive and may use newer selector syntax.
    }
  }
  return null
}

function orderedParts(
  roots: Element | readonly Element[],
  platform: PlatformId,
): DanmakuRichTextPart[] {
  const parts: DanmakuRichTextPart[] = []
  let pendingBilibiliImageLabel = ''
  const appendText = (value: string | null): void => {
    let text = String(value || '')
    if (!text) return
    if (platform === 'bilibili' && pendingBilibiliImageLabel) {
      const trimmed = text.trim()
      if (trimmed === pendingBilibiliImageLabel) text = ''
      pendingBilibiliImageLabel = ''
      if (!text) return
    }
    const previous = parts.at(-1)
    if (previous?.type === 'text') previous.text = `${previous.text || ''}${text}`
    else parts.push({ text, type: 'text' })
  }
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent)
      return
    }
    if (!(node instanceof Element)) return
    if (node.matches('button,script,style,[aria-hidden="true"],[data-bcp-one-owned]')) return
    if (node instanceof HTMLImageElement) {
      const resourceId = [
        'data-file-id',
        'data-emoticon-unique',
        'data-emoticon-id',
        'data-emoji-id',
        'data-emoticon',
        'data-emoji',
      ]
        .map((attribute) => node.getAttribute(attribute))
        .find(Boolean)
      const label = node.alt || node.getAttribute('data-emoji-name') || undefined
      parts.push({
        resourceId: resourceId || undefined,
        resourceUrl: node.currentSrc || node.src || undefined,
        text: label,
        type: 'image',
      })
      pendingBilibiliImageLabel = platform === 'bilibili' ? String(label || '') : ''
      return
    }
    node.childNodes.forEach(visit)
  }
  for (const root of Array.isArray(roots) ? roots : [roots]) root.childNodes.forEach(visit)
  return parts.slice(0, 40)
}

export function describeDanmaku(
  platform: PlatformId,
  config: LivePlatformConfig,
  candidate: Element,
  source: DanmakuDescriptor['source'],
): DanmakuDescriptor | null {
  const messageElement = firstMatch(candidate, config.messageText) || candidate
  const douyuTextElements = platform === 'douyu' ? douyuOverlayTextElements(candidate) : []
  const messageElements = douyuTextElements.length > 1 ? douyuTextElements : [messageElement]
  const parts = orderedParts(messageElements, platform)
  const text = parseMessageText(
    parts.map((part) => part.text || '').join('') ||
      messageElements.map((element) => element.textContent || '').join(''),
    config.maxLength,
  )
  if (!text && !parts.some((part) => part.type !== 'text')) return null
  const senderElement = firstMatch(candidate, config.userNames)
  const senderName = normalizeSenderName(
    senderElement?.getAttribute('data-username') ||
      senderElement?.getAttribute('title') ||
      senderElement?.textContent,
  )
  const messageId = [
    'data-id_str',
    'data-id-str',
    'data-message-id',
    'data-chatid',
    'data-comment-uuid',
  ]
    .map((attribute) => candidate.getAttribute(attribute))
    .find(Boolean)
  const senderId = ['data-uid', 'data-user-id', 'data-mid']
    .map((attribute) => senderElement?.getAttribute(attribute) || candidate.getAttribute(attribute))
    .find(Boolean)
  return {
    messageId: messageId || undefined,
    parts,
    platform,
    resourceIds: Array.from(
      new Set(parts.map((part) => normalizeWhitespace(part.resourceId)).filter(Boolean)),
    ),
    senderId: senderId || undefined,
    senderName: senderName || undefined,
    source,
    text,
  }
}

import { isPlausibleMessage, parseMessageText } from '../../../core/shared'
import { douyinEmojiTokenFromResource } from '../emoji-token'
import type { RichPayload } from '../own-message'
import { assetsMatch, normalizeRichPayload } from '../own-message'
import type { DouyinRendererContentPart } from '../protocol'
import {
  comparableText,
  normalizedAssetKeys,
  serializedEmojiAssets,
  type EmojiAssetDescriptor,
} from '../rich-data'
import { douyinAutoRecognizedEmojiText } from '../rich-message-sender'
import type { DouyinChatMessageDescriptor } from './chat-parser'

export type DouyinRichRecoveryReason =
  | 'canvas-bracket-text'
  | 'canvas-text'
  | 'chat-asset-match'
  | 'chat-text-match'
  | 'empty-content'
  | 'renderer-content'
  | 'renderer-emoji-unresolved'

export type DouyinRichRecoveryStatus = 'fallback' | 'resolved' | 'unresolved'

export interface DouyinRecoveredRichPayload extends RichPayload {
  sender?: string
}

export interface DouyinRichAction {
  /** Complete text shared by copy, favorite and +1. */
  readonly text: string
  /** Null when Douyin can restore every image Emoji from bracket text alone. */
  readonly richPayload: RichPayload | null
}

export interface DouyinRichRecoveryResult {
  readonly action: DouyinRichAction
  readonly payload: DouyinRecoveredRichPayload
  readonly reason: DouyinRichRecoveryReason
  readonly status: DouyinRichRecoveryStatus
}

export interface DouyinRichContentResolver {
  actionFromPayload(value: unknown, fallbackText?: unknown): DouyinRichAction
  fromRenderer(
    canvasText: unknown,
    rendererContent: readonly DouyinRendererContentPart[] | unknown,
  ): DouyinRecoveredRichPayload
  resolve(
    canvasText: unknown,
    rendererContent: readonly DouyinRendererContentPart[] | unknown,
  ): DouyinRichRecoveryResult
  resolveWithRetry(
    canvasText: unknown,
    rendererContent: readonly DouyinRendererContentPart[] | unknown,
  ): Promise<DouyinRichRecoveryResult>
}

export interface DouyinRichContentResolverOptions {
  baseUrl?: () => string
  chatMessages: () => readonly DouyinChatMessageDescriptor[]
  delay?: (milliseconds: number) => Promise<void>
  ensureEmojiCatalog?: () => Promise<unknown>
  maxLength?: number
  senderForMessage?: (message: string) => string
}

const BRACKET_EMOJI_PATTERN = /\[[^\]\r\n]{1,40}\]/u

function freezeAsset(asset: EmojiAssetDescriptor): EmojiAssetDescriptor {
  return Object.freeze({
    ...asset,
    keys: Object.freeze(asset.keys.slice()),
  }) as EmojiAssetDescriptor
}

function freezePayload(payload: DouyinRecoveredRichPayload): DouyinRecoveredRichPayload {
  const assets = payload.assets.map(freezeAsset)
  const parts = payload.parts.map((part) =>
    part.type === 'text'
      ? Object.freeze({ text: part.text, type: 'text' as const })
      : Object.freeze({ asset: freezeAsset(part.asset), type: 'emoji' as const }),
  )
  return Object.freeze({
    assets: Object.freeze(assets),
    parts: Object.freeze(parts),
    plainText: payload.plainText,
    sender: payload.sender,
    text: payload.text,
  }) as DouyinRecoveredRichPayload
}

function rendererHasSerializableImage(
  rendererContent: readonly DouyinRendererContentPart[] | unknown,
  baseUrl: string,
): boolean {
  return serializedEmojiAssets(rendererContent, baseUrl).length > 0
}

export function createDouyinRichContentResolver(
  options: DouyinRichContentResolverOptions,
): DouyinRichContentResolver {
  const baseUrl = options.baseUrl ?? (() => globalThis.location?.href ?? 'https://live.douyin.com/')
  const delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const ensureEmojiCatalog = options.ensureEmojiCatalog ?? (() => Promise.resolve())
  const maxLength = options.maxLength ?? 1_000
  const senderForMessage = options.senderForMessage ?? (() => '')

  function actionFromPayload(value: unknown, fallbackText: unknown = ''): DouyinRichAction {
    const fallback = parseMessageText(fallbackText, maxLength)
    const payload = normalizeRichPayload(
      value || fallback,
      (text) => parseMessageText(text, maxLength),
      maxLength,
    )
    const emojiText = douyinAutoRecognizedEmojiText(payload)
    if (emojiText) {
      return Object.freeze({ richPayload: null, text: emojiText })
    }
    return Object.freeze({
      richPayload: payload,
      text: payload.text || fallback,
    })
  }

  function fromRenderer(
    canvasTextValue: unknown,
    rendererContent: readonly DouyinRendererContentPart[] | unknown,
  ): DouyinRecoveredRichPayload {
    const parts: RichPayload['parts'] = []
    const appendText = (value: unknown): void => {
      const text = String(value ?? '')
      if (!text) return
      const previous = parts.at(-1)
      if (previous?.type === 'text') previous.text += text
      else parts.push({ text, type: 'text' })
    }
    const visit = (raw: unknown): void => {
      if (!raw || typeof raw !== 'object' || parts.length >= 40) return
      const record = raw as Record<string, unknown>
      if (record.type === 'text') {
        appendText(record.text)
      } else if (record.type === 'image') {
        const asset = serializedEmojiAssets([record], baseUrl())[0]
        if (asset) {
          const token = asset.token || douyinEmojiTokenFromResource(asset.src)
          if (token) {
            asset.token = token
            normalizedAssetKeys(token, baseUrl()).forEach((key) => {
              if (!asset.keys.includes(key) && asset.keys.length < 64) asset.keys.push(key)
            })
          }
          parts.push({ asset, type: 'emoji' })
        }
      }
      if (Array.isArray(record.content)) record.content.forEach(visit)
    }
    ;(Array.isArray(rendererContent) ? rendererContent : []).forEach(visit)
    const assets = parts.flatMap((part) => (part.type === 'emoji' ? [part.asset] : []))
    const plainText = parseMessageText(
      parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(''),
      maxLength,
    )
    const canvasText = parseMessageText(canvasTextValue, maxLength)
    const text = canvasText || plainText || (assets.length ? '表情' : '')
    return freezePayload({ assets, parts, plainText, text })
  }

  function mergeEmojiAsset(
    primary: EmojiAssetDescriptor,
    secondary: EmojiAssetDescriptor | undefined,
  ): EmojiAssetDescriptor {
    if (!secondary) return primary
    return {
      keys: Array.from(new Set([...primary.keys, ...secondary.keys])).slice(0, 64),
      src: primary.src || secondary.src || '',
      token: secondary.token || primary.token || '',
    }
  }

  function mergeRendererPayloadWithChat(
    rendererPayload: DouyinRecoveredRichPayload,
    chatPayload: DouyinRecoveredRichPayload | null,
    canvasText: string,
  ): DouyinRecoveredRichPayload {
    if (!chatPayload?.assets.length) {
      return freezePayload({
        ...rendererPayload,
        sender: chatPayload?.sender || senderForMessage(canvasText),
      })
    }
    const unused = new Set(chatPayload.assets.map((_asset, index) => index))
    const mergedAssets = rendererPayload.assets.map((rendererAsset, index) => {
      let matchedIndex = chatPayload.assets.findIndex(
        (asset, assetIndex) => unused.has(assetIndex) && assetsMatch(rendererAsset, asset),
      )
      if (
        matchedIndex < 0 &&
        chatPayload.assets.length === rendererPayload.assets.length &&
        unused.has(index)
      ) {
        matchedIndex = index
      }
      if (matchedIndex < 0) return rendererAsset
      unused.delete(matchedIndex)
      return mergeEmojiAsset(rendererAsset, chatPayload.assets[matchedIndex])
    })
    let assetIndex = 0
    const parts = rendererPayload.parts.map((part) => {
      if (part.type === 'text') return part
      return { asset: mergedAssets[assetIndex++] ?? part.asset, type: 'emoji' as const }
    })
    return freezePayload({
      ...rendererPayload,
      assets: mergedAssets,
      parts,
      plainText: chatPayload.plainText || rendererPayload.plainText,
      sender: chatPayload.sender || senderForMessage(canvasText),
      text: chatPayload.text || rendererPayload.text,
    })
  }

  function result(
    payload: DouyinRecoveredRichPayload,
    reason: DouyinRichRecoveryReason,
    status: DouyinRichRecoveryStatus,
  ): DouyinRichRecoveryResult {
    return Object.freeze({
      action: actionFromPayload(payload, payload.text),
      payload,
      reason,
      status,
    })
  }

  function resolve(
    canvasTextValue: unknown,
    rendererContent: readonly DouyinRendererContentPart[] | unknown,
  ): DouyinRichRecoveryResult {
    const canvasText = parseMessageText(canvasTextValue, maxLength)
    const key = comparableText(canvasText)
    const rendererPayload = fromRenderer(canvasText, rendererContent)
    const rendererAssets = rendererPayload.assets
    const textMatches: DouyinRecoveredRichPayload[] = []
    const assetMatches: Array<{
      exactAssetCount: number
      payload: DouyinRecoveredRichPayload
    }> = []

    for (const descriptor of options.chatMessages().slice(0, 100)) {
      const payload = descriptor.payload
      if (rendererAssets.length && payload.assets.length) {
        const exactAssetCount = payload.assets.filter((asset) =>
          rendererAssets.some((rendererAsset) => assetsMatch(asset, rendererAsset)),
        ).length
        if (
          exactAssetCount ||
          (key &&
            comparableText(payload.plainText || payload.text) === key &&
            payload.assets.length === rendererAssets.length)
        ) {
          assetMatches.push({ exactAssetCount, payload })
        }
      }
      const rowKey = comparableText(payload.plainText || payload.text)
      if (isPlausibleMessage(payload.text, maxLength) && key && rowKey === key) {
        textMatches.push(payload)
      }
    }

    if (rendererAssets.length) {
      assetMatches.sort((left, right) => right.exactAssetCount - left.exactAssetCount)
      const matched = assetMatches[0]?.payload || textMatches[0] || null
      const payload = mergeRendererPayloadWithChat(rendererPayload, matched, canvasText)
      const action = actionFromPayload(payload, canvasText)
      return result(
        payload,
        matched ? 'chat-asset-match' : action.richPayload ? 'renderer-emoji-unresolved' : 'renderer-content',
        matched || !action.richPayload ? 'resolved' : 'unresolved',
      )
    }
    if (textMatches.length) {
      return result(textMatches[0], 'chat-text-match', 'resolved')
    }
    const payload = freezePayload({
      assets: [],
      parts: canvasText ? [{ text: canvasText, type: 'text' }] : [],
      plainText: canvasText,
      sender: senderForMessage(canvasText),
      text: canvasText,
    })
    if (!canvasText) return result(payload, 'empty-content', 'unresolved')
    return result(
      payload,
      BRACKET_EMOJI_PATTERN.test(canvasText) ? 'canvas-bracket-text' : 'canvas-text',
      'fallback',
    )
  }

  async function resolveWithRetry(
    canvasText: unknown,
    rendererContent: readonly DouyinRendererContentPart[] | unknown,
  ): Promise<DouyinRichRecoveryResult> {
    let resolved = resolve(canvasText, rendererContent)
    if (
      resolved.status !== 'unresolved' ||
      !rendererHasSerializableImage(rendererContent, baseUrl())
    ) {
      return resolved
    }
    await ensureEmojiCatalog()
    resolved = resolve(canvasText, rendererContent)
    if (resolved.status !== 'unresolved') return resolved
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await delay(50)
      resolved = resolve(canvasText, rendererContent)
      if (resolved.status !== 'unresolved') break
    }
    return resolved
  }

  return Object.freeze({ actionFromPayload, fromRenderer, resolve, resolveWithRetry })
}

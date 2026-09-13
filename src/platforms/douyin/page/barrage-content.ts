import { extractSenderFromRecord } from '../../../core/reply'
import {
  barrageInteractionText,
  normalizeText,
  plausibleText,
  serializeBarrage,
  serializedBarrageText,
  type SafePaint,
  type SerializedBarrageItem,
} from '../barrage-model'
import { douyinEmojiMessageText } from '../emoji-token'
import {
  douyinRepeatReminderExclusionReason,
  type DouyinRepeatReminderExclusionReason,
} from '../repeat-reminder-filter'
import type {
  Milliseconds,
  RendererBarrageDescription,
  RendererBarrageOptions,
  RendererChannelRange,
  RendererTextStyle,
  TimestampMilliseconds,
} from './runtime-types'
import type { MeasuredBarrageContent } from './content-measurer'

export interface PreparedBarrageImage {
  assetHints: string[]
  emojiToken: string
  src: string
}

export interface PreparedBarrageTrackMetadata {
  channelRange: RendererChannelRange | null
  duration: Milliseconds | null
  priority: number
  reserveDuration: Milliseconds
  startTime: TimestampMilliseconds | null
}

export interface PreparedBarrage {
  content: SerializedBarrageItem[]
  description: RendererBarrageDescription
  images: PreparedBarrageImage[]
  messageId: string
  options: RendererBarrageOptions
  repeatReminderExclusion: DouyinRepeatReminderExclusionReason | null
  sender: string
  textStyle: RendererTextStyle | null
  track: PreparedBarrageTrackMetadata
}

export type PrepareBarrageResult =
  | {
      imageCount: number
      messageId: string
      ok: false
      reason: 'invalid-options' | 'no-interactive-text'
    }
  | {
      barrage: PreparedBarrage
      ok: true
    }

export interface PrepareBarrageDependencies {
  describe(
    options: RendererBarrageOptions,
    content: readonly SerializedBarrageItem[],
  ): MeasuredBarrageContent
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function messageIdFromOptions(options: RendererBarrageOptions): string {
  return String(
    options.id ?? options.messageId ?? options.msgId ?? options.itemId ?? '',
  ).slice(0, 180)
}

function channelRangeFromOptions(options: RendererBarrageOptions): RendererChannelRange | null {
  if (!isRecord(options.channelRange)) return null
  const result: RendererChannelRange = {}
  const startIndex = finiteNumber(options.channelRange.startIndex)
  const length = finiteNumber(options.channelRange.len)
  const additionalPriority = finiteNumber(options.channelRange.additionalPriority)
  const additionalReserveDuration = finiteNumber(
    options.channelRange.additionalReserveDuration,
  )
  if (startIndex !== null) result.startIndex = startIndex
  if (length !== null) result.len = length
  if (additionalPriority !== null) result.additionalPriority = additionalPriority
  if (additionalReserveDuration !== null) {
    result.additionalReserveDuration = additionalReserveDuration
  }
  return Object.keys(result).length ? result : null
}

function imageItems(content: readonly SerializedBarrageItem[]): PreparedBarrageImage[] {
  const result: PreparedBarrageImage[] = []
  const visit = (item: SerializedBarrageItem): void => {
    if (item.type === 'image') {
      result.push({
        assetHints: Array.isArray(item.assetHints) ? [...item.assetHints] : [],
        emojiToken: String(item.emojiToken || ''),
        src: String(item.src || ''),
      })
    }
    item.content?.forEach(visit)
  }
  content.forEach(visit)
  return result
}

function safePaint(value: SafePaint | undefined): SafePaint | undefined {
  if (typeof value === 'string') return value
  if (!value) return undefined
  return {
    gradientPieces: value.gradientPieces.map(([offset, color]) => [offset, color]),
    type: value.type,
  }
}

function firstTextStyle(
  content: readonly SerializedBarrageItem[],
  inherited: RendererTextStyle = {},
): RendererTextStyle | null {
  for (const item of content) {
    const style: RendererTextStyle = {
      color: safePaint(item.color) ?? inherited.color,
      fontFamily: item.fontFamily ?? inherited.fontFamily,
      fontSize: item.fontSize ?? inherited.fontSize,
      fontWeight: item.fontWeight ?? inherited.fontWeight,
      strokeColor: safePaint(item.strokeColor) ?? inherited.strokeColor,
      strokeWidth: item.strokeWidth ?? inherited.strokeWidth,
    }
    if (item.type === 'text') return style
    const nested = firstTextStyle(item.content || [], style)
    if (nested) return nested
  }
  return null
}

function cloneTextStyle(
  style: RendererTextStyle | null | undefined,
): RendererTextStyle | null {
  if (!style) return null
  return {
    color: safePaint(style.color),
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    strokeColor: safePaint(style.strokeColor),
    strokeWidth: style.strokeWidth,
  }
}

function nativeMessageText(
  options: RendererBarrageOptions,
  content: readonly SerializedBarrageItem[],
): string {
  const serializedMessageText = serializedBarrageText(content)
  const fallbackMessageText = douyinEmojiMessageText(options)
  const serializedEmojiCount = (serializedMessageText.match(/\[[^\]\r\n]{1,40}\]/gu) || [])
    .length
  const fallbackEmojiCount = (fallbackMessageText.match(/\[[^\]\r\n]{1,40}\]/gu) || [])
    .length
  return fallbackEmojiCount > serializedEmojiCount
    ? fallbackMessageText
    : serializedMessageText || fallbackMessageText
}

export function prepareDouyinBarrage(
  value: unknown,
  dependencies: PrepareBarrageDependencies,
): PrepareBarrageResult {
  if (!isRecord(value)) {
    return {
      imageCount: 0,
      messageId: '',
      ok: false,
      reason: 'invalid-options',
    }
  }

  const options = value as RendererBarrageOptions
  const content = serializeBarrage(options)
  const images = imageItems(content)
  const description = dependencies.describe(options, content)
  const measuredImageCount = finiteNumber(description.imageCount) ?? 0
  const imageCount = Math.max(measuredImageCount, images.length)
  const measuredText = normalizeText(description.text)
  const interactionText = barrageInteractionText(
    nativeMessageText(options, content) || measuredText,
    imageCount,
  )
  const messageId = messageIdFromOptions(options)
  if (!interactionText) {
    return {
      imageCount,
      messageId,
      ok: false,
      reason: 'no-interactive-text',
    }
  }

  const duration = finiteNumber(options.duration)
  const priority = finiteNumber(options.prior)
  const reserveDuration = finiteNumber(options.reserveDuration)
  const startTime = finiteNumber(options.startTime)
  const textStyle = firstTextStyle(content) || cloneTextStyle(description.firstText)
  const width = Math.max(0, finiteNumber(description.width) ?? 0)
  const height = Math.max(0, finiteNumber(description.height) ?? 0)
  const preparedDescription: RendererBarrageDescription = {
    actionWidth: 0,
    contentHeight: height,
    contentWidth: width,
    firstText: cloneTextStyle(description.firstText),
    height,
    imageCount,
    imageOnly: !plausibleText(measuredText) && imageCount > 0,
    rendererPadding: [0, 0, 0, 0],
    text: interactionText,
    width,
  }

  return {
    barrage: {
      content,
      description: preparedDescription,
      images,
      messageId,
      options,
      repeatReminderExclusion: douyinRepeatReminderExclusionReason({
        messageId,
        record: options,
        text: interactionText,
      }),
      sender: extractSenderFromRecord(options),
      textStyle,
      track: {
        channelRange: channelRangeFromOptions(options),
        duration: duration === null ? null : Math.max(0, duration),
        priority: priority ?? 0,
        reserveDuration: Math.max(0, reserveDuration ?? 0),
        startTime: startTime === null ? null : startTime,
      },
    },
    ok: true,
  }
}

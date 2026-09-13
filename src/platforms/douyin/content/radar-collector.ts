import type { DanmakuDescriptor, DanmakuRichTextPart } from '../../../core/types'
import type {
  RepeatReminderObservation,
  RepeatReminderSource,
} from '../../../features/repeat-reminder/types'
import type {
  RepeatReminderSourceCollector,
  RepeatReminderSourceSink,
} from '../../../features/repeat-reminder/runtime'
import { douyinRepeatReminderExclusionReason } from '../repeat-reminder-filter'
import type { DouyinRepeatReminderMessage } from '../protocol'
import { comparableText } from '../rich-data'
import type { RichPayload } from '../own-message'
import { douyinAutoRecognizedEmojiText } from '../rich-message-sender'
import type { DouyinChatParser } from './chat-parser'

interface FingerprintRecord {
  at: number
  matched: boolean
  sender: string
  source: RepeatReminderSource
}

interface SuppressionRecord {
  expiresAt: number
}

export interface DouyinRadarCollectorOptions {
  enabled(): boolean
  maxLength?: number
  now?: () => number
  parser: DouyinChatParser
  resolveRendererPayload(text: unknown, content: unknown): RichPayload & { sender?: string }
  roomKey(): string
  sendResolvedMessage?(message: {
    instanceId: string | number
    messageId: string | number
    text: string
    trackId: string | number
  }): void
}

export interface DouyinRadarCollectorSnapshot {
  fingerprintCount: number
  roomKey: string
  suppressionCount: number
}

export interface DouyinRadarCollector extends RepeatReminderSourceCollector {
  ingestRenderer(message: DouyinRepeatReminderMessage): void
  snapshot(): DouyinRadarCollectorSnapshot
}

const CROSS_SOURCE_WINDOW_MS = 3_000
const SYNTHETIC_TEXT_TTL_MS = 30 * 60_000
const MAX_FINGERPRINT_KEYS = 500

function partsFromPayload(payload: RichPayload, maxLength: number): DanmakuRichTextPart[] {
  const parts: DanmakuRichTextPart[] = []
  for (const part of payload.parts.slice(0, 40)) {
    if (part.type === 'text' && part.text) {
      parts.push({ text: String(part.text).slice(0, maxLength), type: 'text' })
      continue
    }
    if (part.type !== 'emoji') continue
    const asset = part.asset
    parts.push({
      resourceId: String(asset.keys[0] || asset.token || '').slice(0, 500),
      resourceUrl: String(asset.src || '').slice(0, 4_096),
      text: String(asset.token || '').slice(0, 120),
      type: 'image',
    })
  }
  if (!parts.length && payload.text) {
    parts.push({ text: String(payload.text).slice(0, maxLength), type: 'text' })
  }
  return parts
}

function resourceIdsFromParts(parts: readonly DanmakuRichTextPart[]): string[] {
  return parts
    .filter((part) => part.type !== 'text')
    .map((part) => String(part.resourceId || ''))
    .filter(Boolean)
}

function senderKey(value: unknown): string {
  return comparableText(value)
}

function sendersCompatible(first: string, second: string): boolean {
  return !first || !second || first === second
}

export function createDouyinRadarCollector(
  options: DouyinRadarCollectorOptions,
): DouyinRadarCollector {
  const maxLength = options.maxLength ?? 1_000
  const now = options.now ?? Date.now
  const fingerprints = new Map<string, FingerprintRecord[]>()
  const suppressions = new Map<string, SuppressionRecord>()
  let activeRoomKey = options.roomKey()
  let sink: RepeatReminderSourceSink | null = null

  function syncRoom(): string {
    const nextRoomKey = options.roomKey()
    if (nextRoomKey === activeRoomKey) return nextRoomKey
    activeRoomKey = nextRoomKey
    fingerprints.clear()
    suppressions.clear()
    return nextRoomKey
  }

  function prune(currentTime = now()): void {
    for (const [key, records] of fingerprints) {
      const recent = records.filter((record) => currentTime - record.at <= CROSS_SOURCE_WINDOW_MS)
      if (recent.length) fingerprints.set(key, recent)
      else fingerprints.delete(key)
    }
    for (const [key, record] of suppressions) {
      if (record.expiresAt <= currentTime) suppressions.delete(key)
    }
  }

  function suppressionKey(value: unknown): string {
    return comparableText(value)
  }

  function suppress(text: string): void {
    syncRoom()
    const key = suppressionKey(text)
    if (!key) return
    const currentTime = now()
    prune(currentTime)
    suppressions.set(key, { expiresAt: currentTime + SYNTHETIC_TEXT_TTL_MS })
    sink?.suppressText(text)
  }

  function isSuppressed(text: string): boolean {
    syncRoom()
    const key = suppressionKey(text)
    if (!key) return false
    prune()
    return suppressions.has(key)
  }

  function acceptsCrossSource(
    text: string,
    sender: unknown,
    source: RepeatReminderSource,
    observedAt: number,
  ): boolean {
    syncRoom()
    const key = comparableText(text)
    if (!key) return false
    prune(observedAt)
    const senderValue = senderKey(sender)
    const records = fingerprints.get(key) || []
    const mirrored = records.find(
      (record) =>
        !record.matched &&
        record.source !== source &&
        Math.abs(observedAt - record.at) <= CROSS_SOURCE_WINDOW_MS &&
        sendersCompatible(record.sender, senderValue),
    )
    if (mirrored) {
      mirrored.matched = true
      fingerprints.set(key, records)
      return false
    }
    records.push({ at: observedAt, matched: false, sender: senderValue, source })
    fingerprints.set(key, records)
    if (fingerprints.size > MAX_FINGERPRINT_KEYS) {
      const oldest = fingerprints.keys().next().value
      if (typeof oldest === 'string') fingerprints.delete(oldest)
    }
    return true
  }

  function describe(element: Element, source: DanmakuDescriptor['source']): DanmakuDescriptor | null {
    if (!options.enabled() || source !== 'chat') return null
    syncRoom()
    const descriptor = options.parser.parse(element)
    if (!descriptor || descriptor.kind !== 'text' || descriptor.payload.assets.length) return null
    const text = descriptor.payload.text || descriptor.payload.plainText
    if (
      !text ||
      isSuppressed(text) ||
      douyinRepeatReminderExclusionReason({
        element,
        messageId: descriptor.messageId,
        text,
      })
    ) {
      return null
    }
    const observedAt = now()
    if (!acceptsCrossSource(text, descriptor.sender, 'chat', observedAt)) return null
    const parts = partsFromPayload(descriptor.payload, maxLength)
    return {
      messageId: descriptor.messageId || undefined,
      parts,
      platform: 'douyin',
      resourceIds: resourceIdsFromParts(parts),
      senderName: descriptor.sender || undefined,
      source: 'chat',
      text,
    }
  }

  function ingestRenderer(message: DouyinRepeatReminderMessage): void {
    if (!options.enabled()) return
    syncRoom()
    const payload = options.resolveRendererPayload(message.text, message.content)
    const resolvedEmojiText = douyinAutoRecognizedEmojiText(payload)
    const resolvedText = resolvedEmojiText || payload.text || message.text || ''
    if (resolvedText) {
      options.sendResolvedMessage?.({
        instanceId: message.instanceId,
        messageId: message.messageId,
        text: resolvedText,
        trackId: message.trackId,
      })
    }
    const excludedReason =
      message.excludedReason ||
      douyinRepeatReminderExclusionReason({ messageId: message.messageId, text: resolvedText })
    if (excludedReason === 'synthetic-activity') {
      suppress(resolvedText)
      return
    }
    if (
      excludedReason ||
      !resolvedText ||
      isSuppressed(resolvedText) ||
      payload.assets.length ||
      !acceptsCrossSource(resolvedText, payload.sender || message.sender, 'video', message.observedAt)
    ) {
      return
    }
    const parts = partsFromPayload(payload, maxLength)
    const observation: RepeatReminderObservation = {
      messageId: String(message.messageId || '').slice(0, 180) || undefined,
      observedAt: Number(message.observedAt) || now(),
      parts,
      resourceIds: resourceIdsFromParts(parts),
      senderName: payload.sender || message.sender || undefined,
      source: 'video',
      text: resolvedText,
    }
    sink?.ingest(observation)
  }

  return {
    connect(nextSink): void {
      sink = nextSink
    },
    describe,
    destroy(): void {
      sink = null
      fingerprints.clear()
      suppressions.clear()
    },
    ingestRenderer,
    snapshot: () => ({
      fingerprintCount: fingerprints.size,
      roomKey: activeRoomKey,
      suppressionCount: suppressions.size,
    }),
  }
}

import { normalizeText, plausibleText } from '../barrage-model'
import {
  allAssetsMatch,
  douyinOwnMessageTextMatches,
  payloadSignature,
  type RichPayload,
} from '../own-message'
import {
  comparableText,
  serializedEmojiAssets,
  type EmojiAssetDescriptor,
} from '../rich-data'
import type { RendererTrack, TimestampMilliseconds } from './runtime-types'

export interface RendererOwnMessageIntentInput {
  assets: readonly EmojiAssetDescriptor[]
  intentId: unknown
  messageId?: unknown
  plainText: unknown
  signature: unknown
  sourceType: unknown
  text: unknown
}

export interface RendererOwnMessageIntent {
  assets: EmojiAssetDescriptor[]
  at: TimestampMilliseconds
  id: string
  messageId: string
  plainText: string
  signature: string
  source: string
  text: string
}

export type RendererOwnMessageMatchMode = 'queued-intent' | 'recent-track'

export type RendererOwnMessageMatcherEvent =
  | {
      intent: RendererOwnMessageIntent
      queueLength: number
      type: 'queued'
    }
  | {
      intentId: string
      type: 'cancelled'
    }
  | {
      age: number
      assetCount: number
      intent: RendererOwnMessageIntent
      mode: RendererOwnMessageMatchMode
      track: RendererTrack
      type: 'matched'
    }
  | {
      count: number
      type: 'pruned'
    }

export interface RendererOwnMessageMatcherOptions {
  baseUrl(): string
  limit?: number
  now?: () => TimestampMilliseconds
  onEvent?(event: RendererOwnMessageMatcherEvent): void
  recentTrackWindow?: number
  tracks(): Iterable<RendererTrack>
  ttl: number
}

export interface RendererOwnMessageMatcher {
  cancel(value: string | { intentId?: unknown }): boolean
  match(track: RendererTrack): boolean
  prune(now?: TimestampMilliseconds): number
  remember(value: RendererOwnMessageIntentInput): boolean
}

interface ObservedTrackMessage {
  assets: EmojiAssetDescriptor[]
  messageId: string
  signature: string
  text: string
  track: RendererTrack
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown, length: number): string {
  return String(value ?? '').slice(0, length)
}

function sanitizeAsset(value: unknown): EmojiAssetDescriptor | null {
  if (!isRecord(value) || !Array.isArray(value.keys)) return null
  const keys = value.keys
    .map((key) => boundedString(key, 520))
    .filter(Boolean)
    .slice(0, 64)
  if (!keys.length) return null
  return {
    keys,
    src: boundedString(value.src, 4_096),
    token: boundedString(value.token, 120),
  }
}

function richPayload(
  text: string,
  plainText: string,
  assets: EmojiAssetDescriptor[],
): RichPayload {
  return {
    assets,
    parts: [
      ...(plainText ? [{ text: plainText, type: 'text' as const }] : []),
      ...assets.map((asset) => ({ asset, type: 'emoji' as const })),
    ],
    plainText,
    text,
  }
}

function trackMessageId(track: RendererTrack): string {
  for (const value of [
    track.options.messageId,
    track.options.msgId,
    track.options.itemId,
    track.options.id,
  ]) {
    const id = boundedString(value, 160)
    if (id) return id
  }
  return ''
}

function intentMatchScore(
  intent: RendererOwnMessageIntent,
  observed: ObservedTrackMessage,
): number {
  if (intent.messageId && observed.messageId) {
    return intent.messageId === observed.messageId ? 400 : 0
  }
  if (intent.signature && observed.signature && intent.signature === observed.signature) return 300
  const textMatches = douyinOwnMessageTextMatches(
    intent.text || intent.plainText,
    observed.text,
    observed.assets.length > 0,
  )
  if (intent.assets.length) {
    return allAssetsMatch(intent.assets, observed.assets) && (!intent.text || textMatches)
      ? 200
      : 0
  }
  return intent.text && textMatches ? 100 : 0
}

export function createRendererOwnMessageMatcher(
  options: RendererOwnMessageMatcherOptions,
): RendererOwnMessageMatcher {
  const now = options.now ?? Date.now
  const limit = Math.max(1, options.limit ?? 24)
  const recentTrackWindow = Math.max(0, options.recentTrackWindow ?? 2_500)
  const intents: RendererOwnMessageIntent[] = []

  const observe = (track: RendererTrack): ObservedTrackMessage => {
    const text = normalizeText(track.description.text)
    const assets = serializedEmojiAssets(track.content, options.baseUrl())
    return {
      assets,
      messageId: trackMessageId(track),
      signature: payloadSignature(richPayload(text, text, assets), comparableText),
      text,
      track,
    }
  }

  const consume = (
    index: number,
    observed: ObservedTrackMessage,
    mode: RendererOwnMessageMatchMode,
    currentTime: TimestampMilliseconds,
  ): boolean => {
    const intent = intents[index]
    if (!intent) return false
    intents.splice(index, 1)
    observed.track.own = true
    options.onEvent?.({
      age: Math.max(0, currentTime - intent.at),
      assetCount: observed.assets.length,
      intent,
      mode,
      track: observed.track,
      type: 'matched',
    })
    return true
  }

  const bestIntentIndex = (observed: ObservedTrackMessage): number => {
    let bestIndex = -1
    let bestScore = 0
    for (let index = 0; index < intents.length; index += 1) {
      const score = intentMatchScore(intents[index], observed)
      if (score > bestScore) {
        bestIndex = index
        bestScore = score
      }
    }
    return bestIndex
  }

  const prune = (currentTime = now()): number => {
    let removed = 0
    for (let index = intents.length - 1; index >= 0; index -= 1) {
      if (currentTime - intents[index].at <= options.ttl) continue
      intents.splice(index, 1)
      removed += 1
    }
    if (removed) options.onEvent?.({ count: removed, type: 'pruned' })
    return removed
  }

  const match = (track: RendererTrack): boolean => {
    if (track.own) return false
    const currentTime = now()
    prune(currentTime)
    const observed = observe(track)
    if (!observed.text && !observed.assets.length) return false
    const index = bestIntentIndex(observed)
    return index >= 0 && consume(index, observed, 'queued-intent', currentTime)
  }

  const reconcileRecent = (
    intent: RendererOwnMessageIntent,
    currentTime: TimestampMilliseconds,
  ): boolean => {
    if (!intent.source.startsWith('manual-') || recentTrackWindow <= 0) return false
    let best: { age: number; observed: ObservedTrackMessage; score: number } | null = null
    for (const track of options.tracks()) {
      const age = currentTime - Number(track.observedAt || 0)
      if (track.own || age < 0 || age > recentTrackWindow) continue
      const observed = observe(track)
      const score = intentMatchScore(intent, observed)
      if (!score || (best && (score < best.score || (score === best.score && age >= best.age)))) {
        continue
      }
      best = { age, observed, score }
    }
    if (!best) return false
    const index = intents.indexOf(intent)
    return index >= 0 && consume(index, best.observed, 'recent-track', currentTime)
  }

  return {
    cancel(value) {
      const id = boundedString(typeof value === 'string' ? value : value.intentId, 80)
      if (!id) return false
      const index = intents.findIndex((intent) => intent.id === id)
      if (index < 0) return false
      intents.splice(index, 1)
      options.onEvent?.({ intentId: id, type: 'cancelled' })
      return true
    },
    match,
    prune,
    remember(value) {
      const id = boundedString(value.intentId, 80)
      if (!id || intents.some((intent) => intent.id === id)) return false
      const assets = Array.from(value.assets ?? [])
        .map(sanitizeAsset)
        .filter((asset): asset is EmojiAssetDescriptor => Boolean(asset))
        .slice(0, 8)
      const plainText = normalizeText(value.plainText)
      const text = normalizeText(value.text) || plainText
      if (!plausibleText(text) && !assets.length) return false
      const currentTime = now()
      prune(currentTime)
      const suppliedSignature = boundedString(value.signature, 1_000)
      const intent: RendererOwnMessageIntent = {
        assets,
        at: currentTime,
        id,
        messageId: boundedString(value.messageId, 160),
        plainText,
        signature:
          suppliedSignature || payloadSignature(richPayload(text, plainText, assets), comparableText),
        source: boundedString(value.sourceType || 'unknown', 40),
        text,
      }
      intents.push(intent)
      if (reconcileRecent(intent, currentTime)) return true
      if (intents.length > limit) intents.splice(0, intents.length - limit)
      options.onEvent?.({ intent, queueLength: intents.length, type: 'queued' })
      return true
    },
  }
}

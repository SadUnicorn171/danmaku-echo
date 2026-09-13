import { normalizeSenderName } from '../../../core/reply'
import { parseMessageText } from '../../../core/shared'
import { comparableText } from '../rich-data'
import type { DouyinChatMessageDescriptor } from './chat-parser'

export interface DouyinSenderResolveHints {
  messageId?: unknown
  messageIds?: readonly unknown[]
  now?: number
  observedAt?: number
}

export interface DouyinSenderRememberValue {
  ids?: readonly unknown[]
  message: unknown
  row?: Element
  sender: unknown
}

export interface DouyinSenderIndex {
  destroy(): void
  prune(now?: number): void
  remember(
    value?: DouyinChatMessageDescriptor | DouyinSenderRememberValue,
    hints?: DouyinSenderResolveHints,
  ): string
  resolve(message: unknown, hints?: DouyinSenderResolveHints): string
}

export interface DouyinSenderIndexOptions {
  chatMessages?: () => readonly DouyinChatMessageDescriptor[]
  limit?: number
  maxLength?: number
  now?: () => number
  ttl?: number
}

interface SenderObservation {
  at: number
  ids: string[]
  keys: string[]
  sender: string
}

const DEFAULT_LIMIT = 480
const DEFAULT_TTL = 10 * 60_000

function normalizedIds(values: readonly unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? '').trim())
        .filter((value) => value.length > 0 && value.length <= 160),
    ),
  )
}

function isDescriptor(
  value: DouyinChatMessageDescriptor | DouyinSenderRememberValue,
): value is DouyinChatMessageDescriptor {
  return 'payload' in value && Array.isArray(value.messageIds)
}

function chooseByTime(
  candidates: readonly SenderObservation[],
  observedAt: number,
): SenderObservation | null {
  let best: SenderObservation | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    const distance = observedAt ? Math.abs(candidate.at - observedAt) : 0
    if (!best || distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

export function createDouyinSenderIndex(
  options: DouyinSenderIndexOptions = {},
): DouyinSenderIndex {
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT))
  const maxLength = Math.max(1, Math.floor(options.maxLength ?? 1_000))
  const now = options.now ?? Date.now
  const ttl = Math.max(1, Math.floor(options.ttl ?? DEFAULT_TTL))
  let observations: SenderObservation[] = []
  let rowSignatures = new WeakMap<Element, string>()

  function messageKeys(values: readonly unknown[]): string[] {
    const keys = new Set<string>()
    for (const value of values) {
      const parsed = parseMessageText(value, maxLength)
      for (const candidate of [value, parsed]) {
        const key = comparableText(candidate)
        if (key) keys.add(key)
      }
    }
    return [...keys]
  }

  function observe(
    messages: readonly unknown[],
    senderValue: unknown,
    idsValue: readonly unknown[],
    observedAtValue: unknown,
    row?: Element,
  ): string {
    const sender = normalizeSenderName(senderValue)
    const keys = messageKeys(messages)
    const ids = normalizedIds(idsValue)
    if (!sender || (!keys.length && !ids.length)) return ''
    const observedAt = Number(observedAtValue) || now()
    const signature = `${keys.join('|')}::${ids.join('|')}::${sender}`
    if (row && rowSignatures.get(row) === signature) return sender
    if (row) rowSignatures.set(row, signature)

    observations.push({ at: observedAt, ids, keys, sender })
    if (observations.length > limit) observations.splice(0, observations.length - limit)
    return sender
  }

  function remember(
    value?: DouyinChatMessageDescriptor | DouyinSenderRememberValue,
    hints: DouyinSenderResolveHints = {},
  ): string {
    if (!value) {
      for (const descriptor of options.chatMessages?.() ?? []) remember(descriptor, hints)
      return ''
    }
    if (isDescriptor(value)) {
      if (value.element.getAttribute('data-bcp-douyin-own-chat') === 'true') return ''
      return observe(
        [value.payload.plainText || value.payload.text, value.payload.text],
        value.sender || value.payload.sender,
        value.messageIds,
        hints.observedAt ?? hints.now,
        value.element,
      )
    }
    return observe(
      [value.message],
      value.sender,
      value.ids ?? hints.messageIds ?? [hints.messageId],
      hints.observedAt ?? hints.now,
      value.row,
    )
  }

  function prune(at = now()): void {
    observations = observations.filter((entry) => at - entry.at <= ttl).slice(-limit)
  }

  function resolve(message: unknown, hints: DouyinSenderResolveHints = {}): string {
    const currentTime = Number.isFinite(hints.now) ? Number(hints.now) : now()
    remember(undefined, { now: currentTime, observedAt: currentTime })
    prune(currentTime)
    const keys = messageKeys([message])
    const ids = normalizedIds([hints.messageId, ...(hints.messageIds ?? [])])
    if (!keys.length && !ids.length) return ''
    const observedAt = Number(hints.observedAt) || 0

    // Platform message IDs are authoritative even when several viewers sent
    // exactly the same text. A timestamp hint then chooses the nearest reuse.
    const idMatch = chooseByTime(
      observations.filter((entry) => ids.some((id) => entry.ids.includes(id))),
      observedAt,
    )
    if (idMatch) return idMatch.sender

    // Without an ID, resolve equal text to the closest observed message when
    // a renderer timestamp exists; otherwise the newest visible sender wins.
    const textMatch = chooseByTime(
      observations.filter((entry) => keys.some((key) => entry.keys.includes(key))),
      observedAt,
    )
    if (textMatch) return textMatch.sender

    let best: SenderObservation | null = null
    let bestScore = -Infinity
    for (let index = observations.length - 1; index >= 0; index -= 1) {
      const entry = observations[index]
      let score = -Infinity
      for (const expected of keys) {
        for (const actual of entry.keys) {
          const shorter = Math.min(expected.length, actual.length)
          if (shorter >= 4 && (expected.includes(actual) || actual.includes(expected))) {
            score = Math.max(
              score,
              650 + (shorter / Math.max(expected.length, actual.length)) * 200,
            )
          }
        }
      }
      if (!Number.isFinite(score)) continue
      if (observedAt) {
        score += Math.max(-300, 300 - Math.abs(entry.at - observedAt) / 10)
      } else {
        score += Math.max(0, 120 - (currentTime - entry.at) / 100)
      }
      if (score > bestScore) {
        best = entry
        bestScore = score
      }
    }
    return best && bestScore >= 620 ? best.sender : ''
  }

  function destroy(): void {
    observations = []
    rowSignatures = new WeakMap()
  }

  return Object.freeze({ destroy, prune, remember, resolve })
}

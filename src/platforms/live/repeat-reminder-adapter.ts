import type { DanmakuDescriptor } from '../../core/types'

export interface RepeatReminderCandidate {
  element: Element
  source: DanmakuDescriptor['source']
  text: string
}

export type RepeatReminderExclusion = (candidate: RepeatReminderCandidate) => unknown

export interface RepeatReminderCandidateAdapter {
  clear(): void
  describe(element: Element, source: DanmakuDescriptor['source']): DanmakuDescriptor | null
}

export function createRepeatReminderCandidateAdapter(options: {
  describe(element: Element, source: DanmakuDescriptor['source']): DanmakuDescriptor | null
  exclusionReason?: RepeatReminderExclusion
  maxLength: number
  roomKey(): string
  suppressText(text: string): void
  suppressionTtlMs?: number
}): RepeatReminderCandidateAdapter {
  const suppressions = new Map<string, { expiresAt: number; roomKey: string }>()
  const ttlMs = Math.max(0, options.suppressionTtlMs ?? 90_000)
  const keyOf = (value: unknown): string =>
    String(value || '')
      .normalize('NFKC')
      .replace(/\s+/gu, '')
      .toLocaleLowerCase()
      .slice(0, options.maxLength)

  const prune = (now = Date.now()): void => {
    for (const [key, entry] of suppressions) {
      if (entry.expiresAt <= now) suppressions.delete(key)
    }
  }

  return {
    clear() {
      suppressions.clear()
    },
    describe(element, source) {
      const descriptor = options.describe(element, source)
      if (!descriptor || !options.exclusionReason) return descriptor
      const key = keyOf(descriptor.text)
      prune()
      const suppressed = suppressions.get(key)
      if (suppressed?.roomKey === options.roomKey()) return null
      const excluded = options.exclusionReason({
        element,
        source,
        text: descriptor.text,
      })
      if (!excluded) return descriptor
      if (key) {
        suppressions.set(key, { expiresAt: Date.now() + ttlMs, roomKey: options.roomKey() })
      }
      options.suppressText(descriptor.text)
      return null
    },
  }
}

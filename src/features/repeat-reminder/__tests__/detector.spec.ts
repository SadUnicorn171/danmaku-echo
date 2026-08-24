import { describe, expect, it } from 'vitest'
import { RepeatReminderDetector } from '../detector'
import type { RepeatReminderObservation, RepeatReminderSuggestion } from '../types'

const BASE_TIME = 1_800_000_000_000

function observation(options: Partial<RepeatReminderObservation> = {}): RepeatReminderObservation {
  return {
    observedAt: options.observedAt ?? BASE_TIME,
    parts: options.parts || [{ text: options.text || '主播这波太帅了', type: 'text' }],
    resourceIds: options.resourceIds || [],
    senderId: options.senderId,
    source: options.source || 'chat',
    text: options.text || '主播这波太帅了',
    ...options,
  }
}

describe('RepeatReminderDetector', () => {
  it('suggests the most repeated exact text at the selected threshold', () => {
    const detector = new RepeatReminderDetector(5)
    for (let index = 0; index < 5; index += 1) {
      detector.ingest(observation({ observedAt: BASE_TIME + index * 200, senderId: `u${index}` }), BASE_TIME + index * 200)
    }
    expect(detector.suggestion(BASE_TIME + 2_000)).toMatchObject({
      count: 5,
      senders: 5,
      text: '主播这波太帅了',
      threshold: 5,
      windowMs: 60_000,
    })
  })

  it('deduplicates the same message mirrored between chat and video', () => {
    const detector = new RepeatReminderDetector(3)
    expect(detector.ingest(observation({ source: 'chat' }), BASE_TIME)).toBe(true)
    expect(detector.ingest(observation({ observedAt: BASE_TIME + 300, source: 'video' }), BASE_TIME + 300)).toBe(false)
    expect(detector.suggestion(BASE_TIME + 500)).toBeNull()
  })

  it('keeps legitimate same-source repeats and ignores image messages', () => {
    const detector = new RepeatReminderDetector(3)
    for (let index = 0; index < 3; index += 1) {
      detector.ingest(observation({ observedAt: BASE_TIME + index * 100 }), BASE_TIME + index * 100)
    }
    detector.ingest(observation({
      observedAt: BASE_TIME + 400,
      parts: [{ resourceId: 'room-emoji', type: 'image' }],
      resourceIds: ['room-emoji'],
      text: '[图片表情]',
    }), BASE_TIME + 400)
    expect(detector.suggestion(BASE_TIME + 1_000)?.count).toBe(3)
  })

  it('expires counts outside the one-minute window', () => {
    const detector = new RepeatReminderDetector(3)
    for (let index = 0; index < 3; index += 1) {
      detector.ingest(observation({ observedAt: BASE_TIME + index * 100 }), BASE_TIME + index * 100)
    }
    expect(detector.suggestion(BASE_TIME + 61_000)).toBeNull()
  })

  it('triggers a newly qualified message even while another message has a higher count', () => {
    const detector = new RepeatReminderDetector(8)
    for (let index = 0; index < 30; index += 1) {
      const item = observation({
        observedAt: BASE_TIME + index * 100,
        senderId: `hello-${index}`,
        text: '你好',
      })
      detector.ingest(item, item.observedAt)
    }
    expect(detector.suggestion(BASE_TIME + 3_000)?.count).toBe(30)

    let newlyTriggered: RepeatReminderSuggestion | null = null
    for (let index = 0; index < 8; index += 1) {
      const item = observation({
        observedAt: BASE_TIME + 4_000 + index * 100,
        senderId: `world-${index}`,
        text: 'hello',
      })
      detector.ingest(item, item.observedAt)
      newlyTriggered = detector.triggeredSuggestion(item, item.observedAt)
    }
    expect(newlyTriggered).toMatchObject({ count: 8, text: 'hello', threshold: 8 })
    expect(detector.suggestion(BASE_TIME + 5_000)).toMatchObject({ count: 30, text: '你好' })

    const olderMessageAgain = observation({
      observedAt: BASE_TIME + 5_100,
      senderId: 'hello-30',
      text: '你好',
    })
    detector.ingest(olderMessageAgain, olderMessageAgain.observedAt)
    expect(detector.triggeredSuggestion(olderMessageAgain, olderMessageAgain.observedAt)).toBeNull()
  })

  it('uses one stable suggestion for repeated-unit variants and keeps the most frequent text', () => {
    const detector = new RepeatReminderDetector(3)
    let firstSuggestion: RepeatReminderSuggestion | null = null
    for (let index = 0; index < 4; index += 1) {
      const item = observation({
        observedAt: BASE_TIME + index * 100,
        senderId: `long-${index}`,
        text: '你老公你老公你老公',
      })
      detector.ingest(item, item.observedAt)
      const triggered = detector.triggeredSuggestion(item, item.observedAt)
      if (!firstSuggestion && triggered) firstSuggestion = triggered
    }
    let secondSuggestion: RepeatReminderSuggestion | null = null
    for (let index = 0; index < 3; index += 1) {
      const item = observation({
        observedAt: BASE_TIME + 1_000 + index * 100,
        senderId: `short-${index}`,
        text: '你老公',
      })
      detector.ingest(item, item.observedAt)
      secondSuggestion = detector.triggeredSuggestion(item, item.observedAt) || secondSuggestion
    }
    expect(firstSuggestion).toMatchObject({ count: 3, text: '你老公你老公你老公' })
    expect(secondSuggestion).toMatchObject({
      count: 4,
      id: firstSuggestion?.id,
      text: '你老公你老公你老公',
    })

    const newestWinner = observation({
      observedAt: BASE_TIME + 1_400,
      senderId: 'short-3',
      text: '你老公',
    })
    detector.ingest(newestWinner, newestWinner.observedAt)
    expect(detector.triggeredSuggestion(newestWinner, newestWinner.observedAt)).toMatchObject({
      count: 4,
      id: firstSuggestion?.id,
      text: '你老公',
    })
  })

  it('places Chinese and ASCII question-mark runs in the same suggestion cluster', () => {
    const detector = new RepeatReminderDetector(2)
    let firstId = ''
    const triggeredIds: string[] = []
    for (const [index, text] of ['？？？？？？', '？？？？？？', '?????', '?????'].entries()) {
      const item = observation({ observedAt: BASE_TIME + index * 100, senderId: `u${index}`, text })
      detector.ingest(item, item.observedAt)
      const triggered = detector.triggeredSuggestion(item, item.observedAt)
      if (triggered) {
        if (!firstId) firstId = triggered.id
        triggeredIds.push(triggered.id)
      }
    }
    expect(new Set(triggeredIds)).toEqual(new Set([firstId]))
    expect(detector.suggestion(BASE_TIME + 1_000)).toMatchObject({ count: 2, id: firstId })
  })
})

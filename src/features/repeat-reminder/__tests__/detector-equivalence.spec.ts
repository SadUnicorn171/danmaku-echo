import { describe, expect, it } from 'vitest'
import { RepeatReminderDetector as ReferenceDetector } from '../../../../tests/fixtures/performance/detector'
import { RepeatReminderDetector } from '../detector'
import type { RepeatReminderObservation } from '../types'

describe('repeat detector compatibility with the pre-optimization reference', () => {
  it.each([42, 20260916])('preserves every output through mixed traffic and lifecycle changes (seed %i)', (seed) => {
    const reference = new ReferenceDetector(3)
    const current = new RepeatReminderDetector(3)
    const texts = ['你好', '你好你好', '这波操作太帅了', '这波操作太帅啦', '不能这样', '能这样', '？？？？', '???', '价格123', '价格124', 'hello', 'HELLO', '❤️', '😀', '测试消息']
    let state = seed
    const random = (limit: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % limit }
    let now = 1_800_000_000_000
    for (let index = 0; index < 1_200; index++) {
      now += random(1500)
      if (index % 301 === 0) now += 600_001
      const text = texts[random(texts.length)]!
      const observation: RepeatReminderObservation = {
        text, observedAt: now + [0, -60_001, -60_000, -3_001, -3_000, 1_000][random(6)]!,
        parts: random(17) === 0 ? [{ type: 'image', resourceId: 'room-emoji' }] : [{ type: 'text', text }],
        resourceIds: [], source: random(2) ? 'chat' : 'video',
        senderId: random(3) ? `sender-${random(8)}` : undefined,
        messageId: random(3) ? `id-${random(100)}` : undefined,
      }
      const forgotten = index % 29 === 0 ? current.forgetText(text) : []
      const referenceForgotten = index % 29 === 0 ? reference.forgetText(text) : []
      expect(forgotten).toEqual(referenceForgotten)
      if (index % 47 === 0) {
        const threshold = 2 + random(6)
        reference.setThreshold(threshold); current.setThreshold(threshold)
      }
      if (index % 397 === 0) { reference.clear(); current.clear() }
      expect(current.ingest(observation, now), `ingest ${index}`).toBe(reference.ingest(observation, now))
      expect(current.triggeredSuggestion(observation, now), `trigger ${index}`).toEqual(reference.triggeredSuggestion(observation, now))
      expect(current.suggestion(now), `suggestion ${index}`).toEqual(reference.suggestion(now))
    }
    expect(current.suggestion(now + 600_001)).toEqual(reference.suggestion(now + 600_001))
  })

  it('keeps sender reference counts, late text casing and exact expiry boundaries', () => {
    const reference = new ReferenceDetector(2)
    const current = new RepeatReminderDetector(2)
    const start = 1_800_000_000_000
    for (const [offset, text, sender] of [[100, 'HELLO', 'a'], [0, 'hello', 'a'], [100, 'Hello', 'b'], [200, 'hello', 'b']] as const) {
      const row: RepeatReminderObservation = { text, observedAt: start + offset, senderId: sender, source: 'chat', parts: [{ type: 'text', text }], resourceIds: [] }
      current.ingest(row, start + 200); reference.ingest(row, start + 200)
    }
    for (const offset of [200, 60_000, 60_001, 60_100, 60_101, 60_200, 60_201, 600_001]) {
      expect(current.suggestion(start + offset)).toEqual(reference.suggestion(start + offset))
    }
  })
})

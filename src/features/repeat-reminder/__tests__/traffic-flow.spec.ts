import { describe, expect, it } from 'vitest'
import { DanmakuTrafficMeter } from '../traffic-flow'
import type { RepeatReminderObservation } from '../types'

const BASE_TIME = 1_800_000_000_000

function observation(
  text: string,
  options: Partial<RepeatReminderObservation> = {},
): RepeatReminderObservation {
  return {
    observedAt: options.observedAt ?? BASE_TIME,
    parts: options.parts || [{ text, type: 'text' }],
    resourceIds: options.resourceIds || [],
    senderId: options.senderId,
    source: options.source || 'chat',
    text,
    ...options,
  }
}

describe('danmaku traffic meter', () => {
  it('deduplicates mirrored sources while preserving same-source repeats', () => {
    const meter = new DanmakuTrafficMeter(BASE_TIME)
    expect(meter.ingest(observation('你好', { senderId: 'u1' }), BASE_TIME)).toBe(true)
    expect(meter.ingest(observation('你好', {
      observedAt: BASE_TIME + 100,
      source: 'video',
    }), BASE_TIME + 100)).toBe(false)
    expect(meter.ingest(observation('你好', {
      observedAt: BASE_TIME + 200,
      senderId: 'u1',
    }), BASE_TIME + 200)).toBe(true)
    expect(meter.snapshot(BASE_TIME + 1_000).messageCount).toBe(2)
  })

  it('waits for both the warmup duration and minimum sample count', () => {
    const meter = new DanmakuTrafficMeter(BASE_TIME)
    for (let index = 0; index < 15; index += 1) {
      meter.ingest(observation(`消息${index}`, { senderId: `u${index}` }), BASE_TIME + index)
    }
    expect(meter.snapshot(BASE_TIME + 19_999).ready).toBe(false)
    expect(meter.snapshot(BASE_TIME + 20_000).ready).toBe(true)
  })

  it('combines the stable minute rate with a bounded ten-second burst rate', () => {
    const meter = new DanmakuTrafficMeter(BASE_TIME)
    for (let index = 0; index < 120; index += 1) {
      const at = BASE_TIME + index * 500
      meter.ingest(observation(`消息${index}`, { senderId: `u${index}` }), at)
    }
    const snapshot = meter.snapshot(BASE_TIME + 60_000)
    expect(snapshot).toMatchObject({
      burstRate: 120,
      level: 'low',
      messageCount: 120,
      rate: 120,
      ready: true,
      stableRate: 120,
    })
  })

  it('reduces the flow impact of one identifiable sender flooding the room', () => {
    const meter = new DanmakuTrafficMeter(BASE_TIME)
    for (let index = 0; index < 60; index += 1) {
      const at = BASE_TIME + index * 1_000
      meter.ingest(observation('刷屏', { senderId: 'same-user' }), at)
    }
    const snapshot = meter.snapshot(BASE_TIME + 60_000)
    expect(snapshot.messageCount).toBe(60)
    expect(snapshot.stableRate).toBe(46)
    expect(snapshot.senderCoverage).toBe(1)
  })
})

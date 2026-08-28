import { describe, expect, it } from 'vitest'
import {
  adaptiveRepeatReminderThreshold,
  guestThresholdMultiplier,
  platformRepeatReminderBaseThreshold,
  trafficRepeatReminderThreshold,
  trafficThresholdMultiplier,
} from '../adaptive-threshold'
import type { LiveAudienceMetric } from '../live-audience'

function viewers(value: number, platform: LiveAudienceMetric['platform'] = 'douyin'): LiveAudienceMetric {
  return {
    kind: 'viewers',
    label: '实时观众',
    platform,
    rawText: String(value),
    value,
  }
}

describe('adaptive repeat-reminder threshold', () => {
  it('uses base 6 for Bilibili and Douyin and base 8 for Huya and Douyu', () => {
    expect(platformRepeatReminderBaseThreshold('bilibili', 6)).toBe(6)
    expect(platformRepeatReminderBaseThreshold('douyin', 6)).toBe(6)
    expect(platformRepeatReminderBaseThreshold('huya', 6)).toBe(8)
    expect(platformRepeatReminderBaseThreshold('douyu', 6)).toBe(8)
  })

  it('raises Bilibili and Douyin thresholds by verified viewer bands', () => {
    expect(adaptiveRepeatReminderThreshold('douyin', 6, viewers(20_000))).toBe(8)
    expect(adaptiveRepeatReminderThreshold('bilibili', 6, viewers(100_001, 'bilibili'))).toBe(13)
  })

  it('uses separate guest bands for Huya and Douyu and rejects viewer metrics there', () => {
    expect(guestThresholdMultiplier(20)).toBe(1)
    expect(guestThresholdMultiplier(100)).toBe(1)
    expect(guestThresholdMultiplier(500)).toBe(1.4)
    expect(guestThresholdMultiplier(2_000)).toBe(1.8)
    expect(guestThresholdMultiplier(2_001)).toBe(2.2)
    expect(adaptiveRepeatReminderThreshold('huya', 6, {
      kind: 'guests',
      label: '贵宾数',
      platform: 'huya',
      rawText: '501',
      value: 501,
    })).toBe(14)
    expect(adaptiveRepeatReminderThreshold('douyu', 6, {
      ...viewers(500_000, 'douyu'),
    })).toBe(8)
  })

  it('maps measured message flow to the agreed fallback threshold bands', () => {
    expect([30, 120, 300, 700, 1_500, 3_000, 3_001].map(trafficThresholdMultiplier))
      .toEqual([0.8, 1, 1.25, 1.5, 1.8, 2.2, 2.6])
    const traffic = {
      burstRate: 700,
      level: 'active' as const,
      messageCount: 400,
      rate: 500,
      ready: true,
      senderCoverage: 1,
      stableRate: 400,
    }
    expect(trafficRepeatReminderThreshold('douyin', 6, traffic)).toBe(9)
    expect(trafficRepeatReminderThreshold('huya', 6, traffic)).toBe(12)
    expect(trafficRepeatReminderThreshold('douyin', 6, { ...traffic, ready: false })).toBe(6)
  })
})

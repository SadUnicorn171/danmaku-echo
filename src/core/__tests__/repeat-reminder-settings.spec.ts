import { describe, expect, it } from 'vitest'

import { mergeSettings } from '../shared'
import { repeatReminderPlatformSettings } from '../repeat-reminder-settings'

describe('repeat reminder mode settings', () => {
  it('uses automatic defaults with a ten-second prompt', () => {
    const settings = mergeSettings()
    expect(settings.repeatReminder.mode).toBe('auto')
    expect(settings.repeatReminder.autoPlusOne).toBe(false)
    expect(repeatReminderPlatformSettings(settings.repeatReminder, 'douyin')).toEqual({
      promptDurationSeconds: 10,
      promptScalePercent: 100,
      queueLimit: 3,
      threshold: 6,
    })
  })

  it('keeps independent manual settings for all four platforms', () => {
    const settings = mergeSettings({
      repeatReminder: {
        manual: {
          bilibili: { promptDurationSeconds: 8, threshold: 4 },
          douyin: { promptDurationSeconds: 9, threshold: 5 },
          douyu: { promptDurationSeconds: 11, threshold: 12 },
          huya: { promptDurationSeconds: 13, threshold: 14 },
        },
        mode: 'manual',
      },
    })

    expect(repeatReminderPlatformSettings(settings.repeatReminder, 'bilibili').threshold).toBe(4)
    expect(repeatReminderPlatformSettings(settings.repeatReminder, 'douyin').threshold).toBe(5)
    expect(repeatReminderPlatformSettings(settings.repeatReminder, 'douyu').threshold).toBe(12)
    expect(repeatReminderPlatformSettings(settings.repeatReminder, 'huya')).toMatchObject({
      promptDurationSeconds: 13,
      threshold: 14,
    })
  })
})

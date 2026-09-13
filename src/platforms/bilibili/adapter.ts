import { createSelectorPlatformAdapter } from '../live/selector-adapter'
import { BILIBILI_PLATFORM_CONFIG } from './config'
import { bilibiliRepeatReminderExclusionReason } from './repeat-reminder-filter'

export function createBilibiliAdapter() {
  return {
    ...createSelectorPlatformAdapter({
      config: BILIBILI_PLATFORM_CONFIG,
      platform: 'bilibili',
    }),
    repeatReminderExclusionReason: bilibiliRepeatReminderExclusionReason,
  }
}

import type { LivePlatformAdapter } from '../../core/types'
import type { LiveCandidateAdapter } from './candidate-adapter'
import type { LivePlatformConfig } from './config'
import type { RepeatReminderExclusion } from './repeat-reminder-adapter'
import { createBilibiliAdapter } from '../bilibili/adapter'
import { createDouyuAdapter } from '../douyu/adapter'
import type { DouyuRuntimeBoundary } from '../douyu/adapter'
import { createHuyaAdapter } from '../huya/adapter'

export type LiveRuntimePlatformAdapter = LivePlatformAdapter & {
  candidates: LiveCandidateAdapter
  config: LivePlatformConfig
  douyu?: DouyuRuntimeBoundary
  repeatReminderExclusionReason?: RepeatReminderExclusion
}

export function createLivePlatformAdapter(
  platform: 'bilibili' | 'douyu' | 'huya',
): LiveRuntimePlatformAdapter {
  if (platform === 'bilibili') return createBilibiliAdapter()
  if (platform === 'douyu') return createDouyuAdapter()
  return createHuyaAdapter()
}

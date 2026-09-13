import { createSelectorPlatformAdapter } from '../live/selector-adapter'
import { HUYA_PLATFORM_CONFIG } from './candidate-config'

export function createHuyaAdapter() {
  return createSelectorPlatformAdapter({
    config: HUYA_PLATFORM_CONFIG,
    platform: 'huya',
  })
}

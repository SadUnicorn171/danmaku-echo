import { huyaEmojiPanelToken, huyaRichAssetKeys } from './rich-emoji'
import type { RichEmojiMetadataAdapter } from '../live/rich-emoji-metadata'
import { createSelectorPlatformAdapter } from '../live/selector-adapter'
import { HUYA_PLATFORM_CONFIG } from './candidate-config'

export function createHuyaAdapter() {
  return { ...createSelectorPlatformAdapter({
    config: HUYA_PLATFORM_CONFIG,
    platform: 'huya',
  }), richEmojiMetadata: {
    assetMetadata: ({ element, normalize, metadataElements, sources, marker }) => ({ token: huyaEmojiPanelToken(element, normalize), keys: huyaRichAssetKeys(metadataElements, sources, marker) }),
  } satisfies RichEmojiMetadataAdapter }
}

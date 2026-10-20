import { BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES } from '../live/editor-config'
import { bilibiliRichAssetMetadata } from './rich-emoji'
import { isBilibiliDecorativeImageDescription } from './emoticon-metadata'
import type { RichEmojiMetadataAdapter } from '../live/rich-emoji-metadata'
import { createSelectorPlatformAdapter } from '../live/selector-adapter'
import { BILIBILI_PLATFORM_CONFIG } from './config'
import { bilibiliRepeatReminderExclusionReason } from './repeat-reminder-filter'

export function createBilibiliAdapter() {
  return {
    ...createSelectorPlatformAdapter({
      config: BILIBILI_PLATFORM_CONFIG,
      platform: 'bilibili',
    }),
    richEmojiMetadata: {
      extraMetadataCandidate: element => element.getAttribute('data-type') === '1',
      stopAtMessageBoundary: element => element.getAttribute('data-type') === '1' || BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES.some(attribute => element.hasAttribute(attribute)),
      rejectToken: isBilibiliDecorativeImageDescription,
      assetMetadata: bilibiliRichAssetMetadata,
    } satisfies RichEmojiMetadataAdapter,
    repeatReminderExclusionReason: bilibiliRepeatReminderExclusionReason,
  }
}

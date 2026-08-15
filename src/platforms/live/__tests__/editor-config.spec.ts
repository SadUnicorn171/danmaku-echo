import { describe, expect, it } from 'vitest'
import {
  BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES,
  EMOJI_DISPLAY_ATTRIBUTES,
  EMOJI_METADATA_ATTRIBUTES,
  PLATFORM_EMOJI_ITEM_SELECTORS,
} from '../editor-config'

describe('native image Emoji editor selectors', () => {
  it('keeps Bilibili native-panel item and resource identity contracts available', () => {
    expect(PLATFORM_EMOJI_ITEM_SELECTORS).toContain('[data-emoticon-unique]')
    expect(PLATFORM_EMOJI_ITEM_SELECTORS).toContain('[data-file-id]')
    expect(BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES).toContain('data-emoticon-unique')
    expect(BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES).toContain('data-file-id')
  })

  it('treats Douyu image rel values as official display names', () => {
    expect(EMOJI_METADATA_ATTRIBUTES).toContain('rel')
    expect(EMOJI_DISPLAY_ATTRIBUTES.has('rel')).toBe(true)
  })
})

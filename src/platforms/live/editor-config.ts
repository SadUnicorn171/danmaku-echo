export const EDITABLE_CONTROL_SELECTOR = [
  'input',
  'textarea',
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
].join(',')

export const TEXT_EDITOR_SELECTOR = [
  'textarea',
  'input:not([type])',
  "input[type='text']",
  "input[type='search']",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
].join(',')

export const PLATFORM_EMOJI_ITEM_SELECTORS = [
  '.EmotionList-item',
  '.EmotionList-img',
  '.EmotionList-item-title',
  '[data-emoji]',
  '[data-emoji-name]',
  '[data-emoji-text]',
  '[data-emoji-code]',
  '[data-emoji-id]',
  '[data-emoticon]',
  '[data-emoticon-name]',
  '[data-emoticon-text]',
  '[data-emoticon-unique]',
  '[data-emoticon-id]',
  '[data-file-id]',
  "[class*='emoji-item' i]",
  "[class*='emojiItem']",
  "[class*='emote-item' i]",
  "[class*='emoteItem']",
  "[class*='emoticon-item' i]",
  "[class*='face-item' i]",
  "[class*='faceItem']",
  "[class*='emotion-item' i]",
  "[class*='EmotionList-item']",
  "[class*='emot--']",
]

export const PLATFORM_EMOJI_CATEGORY_SELECTORS = [
  '.EmotionTab-item',
  "[role='tab']",
  "[class*='tab-item' i]",
  "[class*='tabItem']",
  "[class*='category-item' i]",
  "[class*='categoryItem']",
  "[class*='pack-item' i]",
  "[class*='packItem']",
  "[class*='group-item' i]",
  "[class*='groupItem']",
]

export const EMOJI_METADATA_ATTRIBUTES = [
  'data-text',
  'data-emoji-name',
  'data-emoji-text',
  'data-emoticon-name',
  'data-emoticon-text',
  'alt',
  'title',
  'aria-label',
  // Douyu's current player danmaku keeps the official Chinese Emoji name on
  // the image itself (for example rel="狗骨头" / rel="梗就这"), while its URL
  // contains only a pinyin slug or an opaque resource id.
  'rel',
  'data-name',
  'data-emoji',
  'data-emoticon',
  'data-emoticon-unique',
  'data-emoji-unique',
  'data-room-emoticon',
  'data-room-emoji',
  'data-anchor-emoticon',
  'data-anchor-emoji',
  'data-emoji-code',
  'data-emoji-id',
  'data-emoticon-id',
  'data-file-id',
  'data-id',
]

export const BILIBILI_NATIVE_PANEL_IDENTITY_ATTRIBUTES = [
  'data-file-id',
  'data-emoticon-unique',
  'data-emoji-unique',
  'data-room-emoticon',
  'data-room-emoji',
  'data-anchor-emoticon',
  'data-anchor-emoji',
]

export const NATIVE_PANEL_ASSET_KEY_PREFIX = 'native-panel:'
export const LEGACY_BILIBILI_EXCLUSIVE_ASSET_KEY_PREFIX = 'bili-exclusive:'
export const BILIBILI_AUTO_TEXT_ASSET_KEY_PREFIX = 'bili-auto-text:'
export const EMOJI_DISPLAY_ATTRIBUTES = new Set([
  'data-text',
  'data-emoji-name',
  'data-emoji-text',
  'data-emoticon-name',
  'data-emoticon-text',
  'alt',
  'title',
  'aria-label',
  'rel',
  'data-name',
])

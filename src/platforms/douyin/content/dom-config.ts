/** Douyin page DOM contracts used by the isolated-world content runtime. */
export const DOM_DANMAKU_SELECTORS = [
  "[data-e2e='danmaku-item']",
  "[class*='webcast-danmaku___item']",
  "[class*='danmaku-item']",
  "[class*='danmakuItem']",
  "[class*='danmu-item']",
  "[class*='bullet-item']",
] as const

export const VIDEO_ROOT_SELECTORS = [
  "[data-e2e='live-player']",
  "[data-e2e='player-container']",
  "[class*='LivePlayer']",
  "[class*='live-player']",
  "[class*='player-container']",
  "[class*='PlayerContainer']",
  "[class*='video-container']",
] as const

export const CHAT_ROOT_SELECTORS = [
  "[data-e2e='chat-message-list']",
  "[data-e2e='chat-room-message-list']",
  "[class*='webcast-chatroom___items']",
  "[class*='webcast-chatroom___list']",
  "[class*='webcast-chatroom']",
  "[class*='ChatMessageList']",
] as const

export const CHAT_MESSAGE_SELECTORS = [
  "[data-e2e='chat-message']",
  "[data-e2e='chat-room-message']",
  "[class*='webcast-chatroom___item']",
  "[class*='ChatMessage']",
  "[class*='chat-message']",
  "[class*='message-item']",
] as const

export const MESSAGE_TEXT_SELECTORS = [
  "[data-e2e='chat-message-text']",
  "[data-e2e='message-content']",
  "[class*='message-content']",
  "[class*='messageContent']",
  "[class*='content']",
] as const

export const USER_NAME_SELECTORS = [
  "[data-e2e='chat-message-user-name']",
  "[data-e2e='message-user-name']",
  "[data-e2e*='user-name']",
  "[data-e2e*='nickname']",
  "[data-e2e*='author-name']",
  "[data-e2e*='owner-name']",
  "[data-e2e*='sender-name']",
  "[data-testid*='user-name']",
  "[data-testid*='nickname']",
  "[data-testid*='author-name']",
  '[data-username]',
  '[data-user-name]',
  '[data-nickname]',
  '[data-author-name]',
  "[class*='nickname' i]",
  "[class~='name']",
  "[class*='user-name' i]",
  "[class*='userName' i]",
  "[class*='username' i]",
  "[class*='author-name' i]",
  "[class*='owner-name' i]",
  "a[href*='/user/' i]",
] as const

export const INPUT_SELECTORS = [
  "[data-e2e='chat-room-input']",
  "[data-e2e*='danmaku-input']",
  "textarea[data-e2e*='chat']",
  "textarea[placeholder*='弹幕']",
  "textarea[placeholder*='说点什么']",
  "[contenteditable='true'][data-placeholder*='弹幕']",
  "[contenteditable='true'][data-placeholder*='说点什么']",
  "[class*='webcast-chatroom___input'] [contenteditable='true']",
  "[class*='danmaku-input'] textarea",
  "[class*='danmaku-input'] input",
  "[class*='danmaku-input'] [contenteditable='true']",
  "[class*='LivePlayer'] textarea[placeholder*='弹幕']",
  "[class*='player-container'] textarea[placeholder*='弹幕']",
  "[class*='chat-input'] [contenteditable='true']",
  "[class*='ChatInput'] [contenteditable='true']",
] as const

export const TEXT_EDITOR_SELECTOR = [
  'textarea',
  'input:not([type])',
  "input[type='text']",
  "input[type='search']",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
].join(',')

export const SEND_BUTTON_SELECTORS = [
  "[data-e2e='chat-room-send']",
  "[data-e2e*='send' i]",
  "[data-testid*='send' i]",
  "[aria-label*='发送']",
  "button[data-e2e*='send']",
  "[class*='webcast-chatroom___send']",
  "button[class*='send']",
  "[class*='send-button']",
  "[class*='sendButton']",
] as const

export const EMOJI_SURFACE_SELECTORS = [
  "[data-e2e*='emoji-panel' i]",
  "[data-testid*='emoji-panel' i]",
  "[class*='emoji-panel' i]",
  "[class*='emojiPanel']",
  "[class*='emoticon-panel' i]",
  "[class*='emotion-panel' i]",
  "[class*='emoji-list' i]",
] as const

export const EMOJI_ITEM_SELECTORS = [
  "img[class*='emoji' i]",
  '[data-emoji]',
  '[data-emoji-name]',
  '[data-emoticon]',
  "[class*='emoji-item' i]",
  "[class*='emojiItem']",
  "[class*='emoticon-item' i]",
] as const

export const EDITABLE_ELEMENT_SELECTOR = [
  'textarea',
  'input:not([type="hidden"])',
  "[contenteditable='true']",
  "[contenteditable='plaintext-only']",
  "[role='textbox']",
].join(',')

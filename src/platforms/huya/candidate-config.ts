import type { LivePlatformConfig } from '../live/config'

export const HUYA_CANDIDATE_CONFIG: Pick<
  LivePlatformConfig,
  'chatRoots' | 'messageText' | 'messages' | 'overlayMessages' | 'userNames' | 'videoRoots'
> = {
  chatRoots: [
    '#chat-room__list',
    '.chat-room__list',
    '.chat-room__bd',
    '.room-chat-messages',
    "[class*='chat-room'][class*='list']",
    "[class*='chatRoom'][class*='list']",
  ],
  videoRoots: [
    '#player-wrap',
    '#player-container',
    '.player-wrap',
    '.player-container',
    "[class*='player-wrap']",
    "[class*='player-container']",
  ],
  overlayMessages: [
    '.danmu-item',
    '.danmaku-item',
    '.bullet-item',
    '.player-danmu-item',
    "[class*='danmu-item']",
    "[class*='danmaku-item']",
    "[class*='danmuItem']",
    "[class*='bullet-item']",
  ],
  messages: [
    '.J_msg',
    '.msg-item',
    '.msg-normal',
    '[data-cid]',
    "[class*='message-item']",
    "[class*='messageItem']",
  ],
  messageText: [
    '.msg',
    '.txt',
    '.msg-content',
    '.message-content',
    "[class*='message-content']",
    "[class*='messageContent']",
  ],
  userNames: [
    '.name',
    '.nick',
    '.username',
    '[data-username]',
    '[data-user-name]',
    '[data-nickname]',
    '[data-author-name]',
    "[class*='user-name' i]",
    "[class*='userName' i]",
    "[class*='username' i]",
    "[class*='nickname' i]",
    "[class*='nick-name' i]",
    "[class*='author-name' i]",
    "a[href*='/user/' i]",
  ],
}

export const HUYA_PLATFORM_CONFIG: LivePlatformConfig = {
  name: '虎牙直播',
  maxLength: 1000,
  ...HUYA_CANDIDATE_CONFIG,
  inputs: [
    '#pub_msg_input',
    "textarea[placeholder*='弹幕']",
    "textarea[placeholder*='发言']",
    '.chat-room__input textarea',
    ".chat-room__input [contenteditable='true']",
    "[class*='chat-input'] [contenteditable='true']",
  ],
  sendButtons: [
    '#msg_send_bt',
    '.btn-send',
    '.chat-room__input button',
    "button[class*='send']",
    "[class*='send-btn']",
  ],
}

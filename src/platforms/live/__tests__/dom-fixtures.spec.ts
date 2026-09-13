import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

interface FixtureContract {
  chatMessage: string
  image: string
  messageId: string
  overlayMessage: string
  path: string
  sender: string
}

const FIXTURES: Record<string, FixtureContract> = {
  bilibili: {
    path: 'bilibili.html',
    chatMessage: '.chat-item.danmaku-item',
    overlayMessage: '.bili-danmaku-x-dm',
    sender: '.user-name[data-uid]',
    messageId: '[data-id_str="bili-chat-1"]',
    image: 'img[alt="冲鸭"][src*="fixture-bilibili"]',
  },
  huya: {
    path: 'huya.html',
    chatMessage: '.J_msg[data-cid="huya-chat-1"]',
    overlayMessage: '.danmu-item[data-cid="huya-overlay-1"]',
    sender: '.name[data-uid]',
    messageId: '[data-cid="huya-chat-1"]',
    image: 'img[alt="开心"][data-id="fixture-emoji-huya"]',
  },
  douyu: {
    path: 'douyu.html',
    chatMessage: '.Barrage-listItem[data-chatid="douyu-chat-1"]',
    overlayMessage: '[data-comment-uuid="douyu-overlay-1"]',
    sender: '.Barrage-nickName[data-uid]',
    messageId: '[data-chatid="douyu-chat-1"]',
    image: 'img[rel="像个小丑"][src*="fixture-douyu"]',
  },
  douyin: {
    path: 'douyin.html',
    chatMessage: '[data-e2e="chat-message"][data-message-id="douyin-chat-1"]',
    overlayMessage: '[data-message-id="douyin-overlay-1"]',
    sender: '[data-e2e="chat-message-user-name"][data-user-id]',
    messageId: '[data-message-id="douyin-chat-1"]',
    image: 'img[alt="测试表情"][src*="fixture-douyin"]',
  },
}

function fixtureSource(fileName: string): string {
  return readFileSync(resolve(process.cwd(), 'tests', 'fixtures', 'live-dom', fileName), 'utf8')
}

describe('脱敏直播 DOM fixture', () => {
  for (const [platform, fixture] of Object.entries(FIXTURES)) {
    it(`提供 ${platform} 的侧聊、画面、发送者、消息 ID 和图片表情`, () => {
      const source = fixtureSource(fixture.path)
      document.body.innerHTML = source

      expect(document.querySelector(fixture.chatMessage)).not.toBeNull()
      expect(document.querySelector(fixture.overlayMessage)).not.toBeNull()
      expect(document.querySelector(fixture.sender)).not.toBeNull()
      expect(document.querySelector(fixture.messageId)).not.toBeNull()
      expect(document.querySelector(fixture.image)).not.toBeNull()
      expect(source).not.toMatch(/(?:cookie|csrf|sessdata|authorization|127\.0\.0\.1)/iu)
    })
  }

  it('保留抖音礼物、福袋和本人消息过滤样本', () => {
    document.body.innerHTML = fixtureSource('douyin.html')

    expect(document.querySelector('[data-message-kind="gift"]')).not.toBeNull()
    expect(document.querySelector('[data-message-kind="lottery"]')).not.toBeNull()
    expect(document.querySelector('[data-is-self="true"]')).not.toBeNull()
  })
})

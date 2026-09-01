import { describe, expect, it } from 'vitest'

import { mergeSettings } from '../../../core/shared'
import { createLivePlatformAdapter } from '../adapters'
import { createSelectorPlatformAdapter } from '../selector-adapter'
import type { LivePlatformConfig } from '../config'

const TEST_CONFIG: LivePlatformConfig = {
  chatRoots: ['.chat-root'],
  inputs: [':broken(', '.editor'],
  maxLength: 1000,
  messageText: [':broken(', '.message'],
  messages: [':broken(', '.chat-row'],
  name: 'Test Live',
  overlayMessages: [':broken(', '.video-row'],
  sendButtons: ['.send'],
  userNames: [':broken(', '.sender'],
  videoRoots: ['.video-root'],
}

describe('live platform adapter contract', () => {
  it.each(['huya', 'bilibili', 'douyu'] as const)(
    'extracts an ordered descriptor for %s',
    (platform) => {
      const row = document.createElement('div')
      row.className = platform === 'huya'
        ? 'J_msg'
        : platform === 'douyu'
          ? 'Barrage-listItem'
          : 'danmaku-item'
      const sender = document.createElement('span')
      sender.className = platform === 'huya'
        ? 'name'
        : platform === 'douyu'
          ? 'Barrage-nickName js-nick'
          : 'user-name'
      sender.textContent = '测试用户：'
      const content = document.createElement('span')
      content.className = platform === 'huya'
        ? 'msg'
        : platform === 'douyu'
          ? 'Barrage-content'
          : 'danmaku-content'
      content.append('加油啊')
      const image = document.createElement('img')
      image.alt = '[大哭]'
      image.dataset.emoticonId = 'official-cry'
      content.append(image, '[大哭]')
      row.append(sender, content)
      document.body.append(row)

      const descriptor = createLivePlatformAdapter(platform).describe(row, 'chat')
      expect(descriptor).toMatchObject({
        platform,
        senderName: '测试用户',
        source: 'chat',
      })
      expect(descriptor?.parts.map((part) => part.type)).toEqual(
        platform === 'bilibili' ? ['text', 'image'] : ['text', 'image', 'text'],
      )
      expect(descriptor?.resourceIds).toEqual(['official-cry'])
      row.remove()
    },
  )

  it('uses the Douyu native capsule setting through the adapter boundary', () => {
    const settings = mergeSettings()
    const adapter = createLivePlatformAdapter('douyu')
    expect(adapter.nativeCapsuleVisible(settings)).toBe(false)
    settings.nativeDanmakuCapsule.douyu = true
    expect(adapter.nativeCapsuleVisible(settings)).toBe(true)
  })

  it('joins every sibling text segment in one Douyu overlay danmaku', () => {
    const row = document.createElement('div')
    row.className = 'danmuItem-a8616a undefined'
    row.dataset.commentUuid = '77db5a1e-9a6e-421f-bf6b-16f7eefbcf0d'
    const first = row.appendChild(document.createElement('div'))
    first.className = 'text-c3935e'
    first.textContent = '保卫鱼娘'
    const second = row.appendChild(document.createElement('div'))
    second.className = 'text-c3935e'
    second.textContent = '查看活动>'
    document.body.append(row)

    const descriptor = createLivePlatformAdapter('douyu').describe(row, 'video')

    expect(descriptor).toMatchObject({
      messageId: '77db5a1e-9a6e-421f-bf6b-16f7eefbcf0d',
      text: '保卫鱼娘查看活动>',
    })
    expect(descriptor?.parts).toEqual([{ text: '保卫鱼娘查看活动>', type: 'text' }])
    row.remove()
  })

  it('finds video and chat candidates while ignoring unsupported selectors', () => {
    const adapter = createSelectorPlatformAdapter({ config: TEST_CONFIG, platform: 'huya' })
    const video = document.createElement('div')
    video.className = 'video-row'
    const videoChild = video.appendChild(document.createElement('span'))
    const chat = document.createElement('div')
    chat.className = 'chat-row'
    const chatChild = chat.appendChild(document.createElement('span'))
    document.body.append(video, chat)

    expect(adapter.findCandidate([videoChild, video])).toEqual({ element: video, source: 'video' })
    expect(adapter.findCandidate([chatChild, chat])).toEqual({ element: chat, source: 'chat' })
    expect(adapter.findCandidate([document.createTextNode('x')])).toBeNull()
    adapter.cleanup()
  })

  it('locates only a visible connected official editor', () => {
    const adapter = createSelectorPlatformAdapter({ config: TEST_CONFIG, platform: 'huya' })
    const hidden = document.createElement('textarea')
    hidden.className = 'editor'
    hidden.style.display = 'none'
    document.body.append(hidden)
    expect(adapter.findOfficialEditor()).toBeNull()

    hidden.style.display = 'block'
    expect(adapter.findOfficialEditor()).toBe(hidden)
    hidden.style.visibility = 'hidden'
    expect(adapter.findOfficialEditor()).toBeNull()
  })

  it('resolves sender identity and applies the default native capsule policy', () => {
    const adapter = createSelectorPlatformAdapter({ config: TEST_CONFIG, platform: 'huya' })
    const settings = mergeSettings()
    expect(adapter.nativeCapsuleVisible(settings)).toBe(true)
    expect(adapter.resolveSender({
      parts: [],
      platform: 'huya',
      resourceIds: [],
      senderId: 'sender-1',
      senderName: 'Sender',
      source: 'video',
      text: 'hello',
    }, document.body)).toEqual({ id: 'sender-1', name: 'Sender' })
  })

  it('rejects empty descriptors and preserves image-only descriptors', () => {
    const adapter = createSelectorPlatformAdapter({ config: TEST_CONFIG, platform: 'bilibili' })
    const empty = document.createElement('div')
    empty.className = 'chat-row'
    empty.appendChild(document.createElement('span')).className = 'message'
    expect(adapter.describe(empty, 'chat')).toBeNull()

    const imageOnly = document.createElement('div')
    imageOnly.className = 'chat-row'
    const message = imageOnly.appendChild(document.createElement('span'))
    message.className = 'message'
    const image = message.appendChild(document.createElement('img'))
    image.dataset.emojiId = 'image-only'
    image.dataset.emojiName = '[Image only]'
    expect(adapter.describe(imageOnly, 'chat')).toMatchObject({
      resourceIds: ['image-only'],
      text: '[Image only]',
    })
  })
})

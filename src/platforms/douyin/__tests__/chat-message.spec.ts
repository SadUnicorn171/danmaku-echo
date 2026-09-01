import { describe, expect, it } from 'vitest'

import { findDouyinMessageContent } from '../chat-message'

describe('Douyin chat message content', () => {
  it('selects the shared rich-content parent instead of the first ordinary text piece', () => {
    const row = document.createElement('div')
    row.className = 'webcast-chatroom___item webcast-chatroom___item_new'
    row.innerHTML = `
      <span class="badge"><img alt="" src="badge.png"></span>
      <span class="user">sadUnicorn：</span>
      <span class="obfuscated-content">
        <div class="webcast-chatroom___content-with-emoji-emoji"><img alt="[杀马特]" src="emoji.png"></div>
        <div class="webcast-chatroom___content-with-emoji-emoji"><img alt="[杀马特]" src="emoji.png"></div>
        <span class="webcast-chatroom___content-with-emoji-text">cyh</span>
        <div class="webcast-chatroom___content-with-emoji-emoji"><img alt="[杀马特]" src="emoji.png"></div>
        <span class="webcast-chatroom___content-with-emoji-text">cyh</span>
      </span>
    `

    const content = findDouyinMessageContent(row, ["[class*='content']"])

    expect(content.className).toBe('obfuscated-content')
    expect(content.querySelectorAll("img[alt='[杀马特]']")).toHaveLength(3)
    expect(content.textContent?.replace(/\s+/gu, '')).toBe('cyhcyh')
  })

  it('uses the existing fallback selectors for plain messages', () => {
    const row = document.createElement('div')
    row.innerHTML = '<span data-e2e="message-content">普通弹幕</span>'

    expect(findDouyinMessageContent(row, ["[data-e2e='message-content']"]).textContent)
      .toBe('普通弹幕')
  })
})

import { describe, expect, it } from 'vitest'

import { createHuyaAdapter } from '../adapter'

describe('Huya candidate adapter', () => {
  it('describes chat image Emoji and fullscreen overlay messages', () => {
    document.body.innerHTML = `
      <section id="player-wrap">
        <div class="danmu-item" data-cid="overlay-1"><span class="msg-content">全屏弹幕</span></div>
      </section>
      <section id="chat-room__list">
        <article class="J_msg" data-cid="chat-1">
          <span class="name">虎牙用户</span>
          <span class="msg-content"><img alt="[开心]" data-emoji-id="emoji-1" src="/emoji.png"></span>
        </article>
      </section>
    `
    const adapter = createHuyaAdapter()
    const chat = document.querySelector('.J_msg')!
    const overlay = document.querySelector('.danmu-item')!

    expect(adapter.candidates.findFromPath([chat])?.kind).toBe('chat')
    expect(adapter.describe(chat, 'chat')).toMatchObject({
      resourceIds: ['emoji-1'],
      senderName: '虎牙用户',
    })
    expect(adapter.candidates.findFromPath([overlay])?.kind).toBe('overlay')
    expect(adapter.describe(overlay, 'video')?.text).toBe('全屏弹幕')
  })
})

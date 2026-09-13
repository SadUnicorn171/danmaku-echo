import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createBilibiliCandidateRules } from '../candidate-rules'
import { BILIBILI_PLATFORM_CONFIG } from '../config'

describe('Bilibili candidate rules', () => {
  const rules = createBilibiliCandidateRules({
    config: BILIBILI_PLATFORM_CONFIG,
    viewportWidth: () => 1_200,
  })

  beforeEach(() => {
    document.body.replaceChildren()
  })

  function overlayFixture() {
    document.body.innerHTML = `
      <section id="live-player"><div class="bili-danmaku-x-dm">
        <span class="bili-danmaku-x-dm-content">测量中的弹幕</span>
      </div></section>
    `
    const row = document.querySelector<HTMLElement>('.bili-danmaku-x-dm')!
    const content = row.firstElementChild as HTMLElement
    row.getClientRects = vi.fn<() => DOMRectList>(
      () =>
        [
          { x: 0, y: 0, left: 0, top: 0, width: 180, height: 24, right: 180, bottom: 24 },
        ] as unknown as DOMRectList,
    )
    return { row, content, player: row.parentElement! }
  }

  it.each(['visibility:hidden', 'opacity:0', 'display:none', 'content-visibility:hidden'])(
    'rejects hidden measurement rows and ancestors with %s despite their layout box',
    (style) => {
      for (const target of ['row', 'content', 'player'] as const) {
        const fixture = overlayFixture()
        fixture[target].style.cssText = style
        expect(rules.isRenderedOverlay(fixture.row)).toBe(false)
        fixture[target].style.cssText = ''
        expect(rules.isRenderedOverlay(fixture.row)).toBe(true)
      }
    },
  )

  it('retains visible pointer-transparent text and image emoji at the player origin', () => {
    const { row, content } = overlayFixture()
    row.style.pointerEvents = 'none'
    expect(rules.isRenderedOverlay(row)).toBe(true)
    content.innerHTML = '<img src="https://i0.hdslb.com/bfs/emote/example.png" alt="">'
    expect(rules.isRenderedOverlay(row)).toBe(true)
    row.remove()
    expect(rules.isRenderedOverlay(row)).toBe(false)
  })
  it('accepts normal chat and overlay regions without treating them as controls', () => {
    document.body.innerHTML = `
      <section id="live-player"><div class="bili-danmaku-x-dm">正常弹幕</div></section>
      <section id="chat-history-list"><article class="chat-item"><span>正常聊天</span></article></section>
    `
    const chat = document.querySelector('.chat-item')!
    const overlay = document.querySelector('.bili-danmaku-x-dm')!

    expect(rules.isChatAdvertisement(chat)).toBe(false)
    expect(rules.isInsideVideoOverlay(overlay)).toBe(true)
    expect(rules.pathTouchesChatActions([chat])).toBe(false)
  })

  it('rejects advertisement cards, quick inputs, and player settings', () => {
    document.body.innerHTML = `
      <section id="live-player">
        <div class="bpx-player-ctrl-dm-input"><input class="bpx-player-dm-input"></div>
        <button aria-label="举报">举报</button>
      </section>
      <section id="chat-history-list">
        <article class="chat-item banner-card"><span class="ad-label">广告</span><a href="/ad">查看</a></article>
      </section>
    `
    const input = document.querySelector('input')!
    const setting = document.querySelector('button')!
    const advertisement = document.querySelector('.chat-item')!

    expect(rules.pathTouchesQuickInput([input])).toBe(true)
    expect(rules.pathTouchesChatActions([setting])).toBe(true)
    expect(rules.isChatAdvertisement(advertisement)).toBe(true)
    expect(rules.pathTouchesChatAdvertisement([advertisement])).toBe(true)
  })
})

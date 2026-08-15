import { afterEach, describe, expect, it } from 'vitest'

import { DouyuNativeHoverController } from '../native-hover'

afterEach(() => {
  document.body.replaceChildren()
})

describe('DouyuNativeHoverController', () => {
  it('does not invent a native entry or exit before a held internal transition', () => {
    const player = document.createElement('div')
    const candidate = document.createElement('div')
    const text = document.createElement('span')
    const controller = new DouyuNativeHoverController()
    const received: string[] = []

    candidate.append(text)
    player.append(candidate)
    document.body.append(player)
    candidate.addEventListener('pointerover', () => received.push('candidate:pointerover'))
    candidate.addEventListener('mouseover', () => received.push('candidate:mouseover'))
    candidate.addEventListener('pointerout', () => received.push('candidate:pointerout'))
    candidate.addEventListener('mouseout', () => received.push('candidate:mouseout'))

    controller.select(candidate, text)

    expect(received).toEqual([])
    expect(controller.release(player, { x: 321, y: 181 })).toBe(false)
    expect(received).toEqual([])
  })

  it('releases an image danmaku through Douyu native leave events', () => {
    const player = document.createElement('div')
    const candidate = document.createElement('div')
    const text = document.createElement('div')
    const imageWrap = document.createElement('div')
    const image = document.createElement('img')
    const controller = new DouyuNativeHoverController()
    const received: string[] = []
    let relatedTarget: EventTarget | null = null

    candidate.className = 'danmuItem-a8616a scroll-c8a9ee'
    text.className = 'text-da6396'
    imageWrap.className = 'EmotImageWrap-f11001'
    image.className = 'EmotImage-a24559'
    candidate.style.zIndex = '999'
    text.style.border = '2px solid rgb(2, 255, 255)'
    text.style.padding = '2px 17px 2px 4px'
    text.style.marginRight = '-17px'
    imageWrap.append(image)
    text.append(imageWrap)
    candidate.append(text)
    player.append(candidate)
    document.body.append(player)

    candidate.addEventListener('pointerout', (event) => {
      received.push(`pointerout:${(event.target as Element).className}`)
      relatedTarget = event.relatedTarget
    })
    imageWrap.addEventListener('pointerleave', () => received.push('image-wrap:pointerleave'))
    text.addEventListener('mouseleave', () => received.push('text:mouseleave'))
    candidate.addEventListener('mouseout', (event) => {
      if (event.relatedTarget instanceof Node && candidate.contains(event.relatedTarget)) return
      candidate.style.zIndex = '0'
      text.style.removeProperty('border')
      text.style.removeProperty('padding')
      text.style.removeProperty('margin-right')
      received.push('candidate:mouseout')
    })

    controller.select(candidate, image)
    controller.hold(image)

    expect(controller.release(player, { x: 320, y: 180 })).toBe(true)
    expect(controller.isReleasing).toBe(false)
    expect(relatedTarget).toBe(player)
    expect(received).toContain('pointerout:EmotImage-a24559')
    expect(received).toContain('image-wrap:pointerleave')
    expect(received).toContain('text:mouseleave')
    expect(received).toContain('candidate:mouseout')
    expect(candidate.style.zIndex).toBe('0')
    expect(text.style.border).toBe('')
    expect(text.style.padding).toBe('')
    expect(text.style.marginRight).toBe('')
  })

  it('ignores the joined plugin action bar as a native hover target', () => {
    const player = document.createElement('div')
    const candidate = document.createElement('div')
    const actionBar = document.createElement('div')
    const controller = new DouyuNativeHoverController()
    let releasedTarget: EventTarget | null = null

    actionBar.dataset.bcpOneOwned = 'true'
    candidate.append(actionBar)
    player.append(candidate)
    document.body.append(player)
    candidate.addEventListener('mouseout', (event) => {
      releasedTarget = event.target
    })

    controller.select(candidate, actionBar)
    controller.hold(actionBar)
    expect(controller.release(player)).toBe(true)
    expect(releasedTarget).toBe(candidate)
    expect(controller.release(player)).toBe(false)
  })
})

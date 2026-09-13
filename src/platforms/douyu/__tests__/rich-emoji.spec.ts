import { beforeEach, describe, expect, it } from 'vitest'

import { douyuEmojiToken } from '../rich-emoji'

const normalizeToken = (value: unknown): string => {
  const name = String(value || '')
    .trim()
    .replace(/^\[|\]$/g, '')
  return name ? `[${name}]` : ''
}

describe('Douyu rich Emoji metadata', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('uses img[rel] for regular and fan-exclusive barrage Emoji', () => {
    const image = document.createElement('img')
    image.className = 'EmotImagePe-f4134a EmotImagePe3-ba2535'
    image.setAttribute('rel', '像个小丑')

    expect(douyuEmojiToken(image, normalizeToken, (element) => element.className)).toBe(
      '[像个小丑]',
    )
  })

  it('falls back to the native Emoji panel title', () => {
    const item = document.createElement('button')
    item.className = 'EmotionList-item'
    item.innerHTML = '<span class="EmotionList-item-title">喷子</span>'

    expect(douyuEmojiToken(item, normalizeToken, (element) => element.className)).toBe('[喷子]')
  })

  it('returns an empty token when no trusted metadata exists', () => {
    const image = document.createElement('img')
    image.src = 'https://example.test/opaque.png'

    expect(douyuEmojiToken(image, normalizeToken, (element) => element.className)).toBe('')
  })
})

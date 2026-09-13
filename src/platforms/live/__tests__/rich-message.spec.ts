import { beforeEach, describe, expect, it } from 'vitest'

import {
  normalizedAssetKeys,
  richEmojiAssetCacheKey,
  richMessagePayload,
  richPartsFromElement,
  type RichEmojiAsset,
} from '../rich-message'

function assetFromImage(image: HTMLImageElement): RichEmojiAsset | null {
  const token = image.alt
  return token
    ? {
        keys: normalizedAssetKeys(image.src, location.href),
        src: image.src,
        token,
      }
    : null
}

describe('shared live rich-message model', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('preserves text, multiple images, Unicode Emoji, and DOM order', () => {
    const element = document.createElement('div')
    element.innerHTML = `前缀<img alt="[开心]" src="https://example.test/a.png">🙂<img alt="[大笑]" src="https://example.test/b.png">后缀`
    const parts = richPartsFromElement({ assetFromImage, element })

    expect(parts.map((part) => (part.type === 'text' ? part.text : part.asset.token))).toEqual([
      '前缀',
      '[开心]',
      '🙂',
      '[大笑]',
      '后缀',
    ])
    expect(richMessagePayload(parts)).toMatchObject({
      plainText: '前缀🙂后缀',
      text: '前缀[开心]🙂[大笑]后缀',
    })
    expect(richMessagePayload(parts).assets).toHaveLength(2)
  })

  it('supports text-only, image-only, and ignored decoration nodes', () => {
    const text = document.createElement('div')
    text.textContent = '纯文字'
    expect(richMessagePayload(richPartsFromElement({ assetFromImage, element: text })).text).toBe(
      '纯文字',
    )

    const image = document.createElement('div')
    image.innerHTML = '<img alt="[开心]" src="https://example.test/a.png"><button>+1</button>'
    const payload = richMessagePayload(
      richPartsFromElement({
        assetFromImage,
        element: image,
        removals: ['button'],
      }),
    )
    expect(payload.text).toBe('[开心]')
    expect(payload.plainText).toBe('')
  })

  it('matches signed/transcoded resources through stable public asset keys', () => {
    const digest = '14988198d32369566ecbe3312cbc82c7'
    const original = normalizedAssetKeys(
      `https://example.test/${digest}.png?signature=first`,
      location.href,
    )
    const rendered = normalizedAssetKeys(
      `https://cdn.example.test/${digest}_small.webp?auth=second`,
      location.href,
    )

    expect(original).toContain(`digest:${digest}`)
    expect(rendered).toContain(`digest:${digest}`)
  })

  it('builds one stable cache key for platform Emoji recovery', () => {
    expect(
      richEmojiAssetCacheKey({ keys: ['path:b', 'name:wave', 'digest:a'] }),
    ).toBe('digest:a|name:wave|path:b')
  })
})

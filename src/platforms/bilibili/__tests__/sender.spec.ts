import { describe, expect, it } from 'vitest'

import type { RichEmojiAsset, RichMessagePayload } from '../../live/rich-message'
import {
  bilibiliFavoriteImagePayload,
  bilibiliInlineEmojiText,
  isBilibiliNativePanelAsset,
  uniqueBilibiliPanelItem,
  type BilibiliPanelMatcher,
} from '../sender'

function asset(token: string, keys: string[] = []): RichEmojiAsset {
  return {
    keys,
    src: `https://i0.hdslb.com/bfs/live/${encodeURIComponent(token)}.png`,
    token,
  }
}

function imagePayload(value: RichEmojiAsset): RichMessagePayload {
  return {
    assets: [value],
    parts: [{ asset: value, type: 'emoji' }],
    plainText: '',
    text: value.token,
  }
}

function createTokenAsset(token: string): RichEmojiAsset {
  return asset(token, [`token:${token}`])
}

function panelMatcher(): BilibiliPanelMatcher {
  return {
    assetDescriptor(element) {
      return asset(
        element.getAttribute('data-token') || '',
        (element.getAttribute('data-keys') || '').split(',').filter(Boolean),
      )
    },
    assetMatchScore(element, expected) {
      const descriptor = this.assetDescriptor(element)
      return descriptor?.keys.some((key) => expected.keys.includes(key)) ? 8 : 0
    },
    interactiveEmojiItem: (element) => element as HTMLElement,
    isVisible: (element) => element.getAttribute('data-hidden') !== 'true',
    normalizeEmojiToken: (value) => String(value || '').trim().toLowerCase(),
  }
}

describe('Bilibili sender routing', () => {
  it('normalizes a bracket favorite into one authoritative Emoji part', () => {
    const source = asset('[大笑]', ['bili-auto-text:official-laugh'])
    const payload = bilibiliFavoriteImagePayload(imagePayload(source), createTokenAsset)

    expect(payload?.text).toBe('[大笑]')
    expect(payload?.assets).toEqual([source])
    expect(payload?.parts).toEqual([{ asset: source, type: 'emoji' }])
  })

  it('preserves official_* and room_* identities as native panel assets', () => {
    expect(isBilibiliNativePanelAsset(asset('[冲鸭]', ['native-panel:official_332']))).toBe(true)
    expect(isBilibiliNativePanelAsset(asset('[发财了]', ['native-panel:room_5236391_63398']))).toBe(
      true,
    )
    expect(isBilibiliNativePanelAsset(asset('[大笑]', ['bili-auto-text:official-laugh']))).toBe(
      false,
    )
  })

  it('rebuilds mixed text and Emoji in DOM order without needing image resources', () => {
    const first = asset('[大笑]')
    const second = asset('冲鸭')
    expect(
      bilibiliInlineEmojiText(
        {
          assets: [first, second],
          parts: [
            { asset: first, type: 'emoji' },
            { text: '一起', type: 'text' },
            { asset: second, type: 'emoji' },
          ],
          plainText: '一起',
          text: '[大笑]一起[冲鸭]',
        },
        () => false,
      ),
    ).toBe('[大笑]一起[冲鸭]')
  })

  it('accepts one unique panel match and rejects equally ranked ambiguous matches', () => {
    const expected = asset('[抱小皮]', ['native-panel:room_3990387_104800'])
    const unique = document.createElement('button')
    unique.dataset.token = '[抱小皮]'
    unique.dataset.keys = 'native-panel:room_3990387_104800'
    const other = document.createElement('button')
    other.dataset.token = '[其他]'
    other.dataset.keys = 'native-panel:room_3990387_99999'
    const matcher = panelMatcher()

    expect(uniqueBilibiliPanelItem([unique, other], expected, matcher)).toBe(unique)

    const duplicate = document.createElement('button')
    duplicate.dataset.token = '[抱小皮]'
    duplicate.dataset.keys = 'native-panel:room_3990387_104800-copy'
    expect(uniqueBilibiliPanelItem([unique, duplicate], expected, {
      ...matcher,
      assetMatchScore(element) {
        return element === unique || element === duplicate ? 8 : 0
      },
    })).toBeNull()
  })

  it('deduplicates duplicate DOM handles for the same native identity', () => {
    const expected = asset('[抱小皮]', ['native-panel:room_3990387_104800'])
    const visible = document.createElement('button')
    visible.dataset.token = '[抱小皮]'
    visible.dataset.keys = 'native-panel:room_3990387_104800'
    const hidden = document.createElement('button')
    hidden.dataset.token = '[抱小皮]'
    hidden.dataset.keys = 'native-panel:room_3990387_104800'
    hidden.dataset.hidden = 'true'

    expect(uniqueBilibiliPanelItem([hidden, visible], expected, panelMatcher())).toBe(visible)
  })
})

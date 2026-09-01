import { describe, expect, it } from 'vitest'

import {
  douyinEmojiCatalogEntries,
  douyinEmojiCatalogVersion,
  douyinEmojiResourceMarkers,
} from '../emoji-catalog'

describe('Douyin Emoji catalog', () => {
  it('maps the current catalog URI for the 看 Emoji to its bracket token', () => {
    const payload = {
      emoji_list: [{
        display_name: '[看]',
        emoji_url: {
          uri: 'tos-cn-i-tsj2vxp0zn/87c2ae45679c4cc4a35bd7182fd76935',
          url_list: [
            'https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/87c2ae45679c4cc4a35bd7182fd76935?x-signature=temporary',
          ],
        },
        origin_uri: 'kan.png',
      }],
      version: '1766572369433',
    }

    expect(douyinEmojiCatalogEntries(payload)).toContainEqual([
      '87c2ae45679c4cc4a35bd7182fd76935',
      '[看]',
    ])
    expect(douyinEmojiCatalogEntries(payload)).toContainEqual(['kan.png', '[看]'])
    expect(douyinEmojiCatalogVersion(payload)).toBe('1766572369433')
  })

  it('ignores signatures and malformed catalog labels', () => {
    expect(douyinEmojiResourceMarkers(
      'https://example.test/87c2ae45679c4cc4a35bd7182fd76935?x-signature=secret',
    )).toEqual(['87c2ae45679c4cc4a35bd7182fd76935'])
    expect(douyinEmojiCatalogEntries({
      emoji_list: [{ display_name: '看', emoji_url: { uri: 'abc.png' } }],
    })).toEqual([])
  })
})

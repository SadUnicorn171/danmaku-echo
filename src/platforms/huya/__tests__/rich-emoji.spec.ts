import { beforeEach, describe, expect, it } from 'vitest'

import type { RichEmojiAsset, RichMessagePayload } from '../../live/rich-message'
import { createHuyaEmojiRecovery, huyaEmojiPanelToken, huyaRichAssetKeys } from '../rich-emoji'

function payload(asset: RichEmojiAsset): RichMessagePayload {
  return {
    assets: [asset],
    parts: [{ asset, type: 'emoji' }],
    plainText: '',
    text: asset.token,
  }
}

describe('Huya rich Emoji recovery', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('reads the native panel label and stable material identity', () => {
    const item = document.createElement('button')
    item.className = 'emot--abc'
    item.dataset.id = '7788'
    item.innerHTML = '<img class="emot-icon--abc" alt="虎牙大笑">'

    expect(huyaEmojiPanelToken(item, (value) => `[${String(value)}]`)).toBe('[虎牙大笑]')
    expect(
      huyaRichAssetKeys(
        [item],
        ['https://example.test/web_base_material_123456789_pic.png'],
        (element) => element.className,
      ),
    ).toEqual(['huya-emoticon-id:7788', 'huya-material:123456789'])
  })

  it('recovers a weak resource token from the native chat descriptor', () => {
    const row = document.createElement('article')
    const message = document.createElement('span')
    const image = document.createElement('img')
    message.append(image)
    row.append(message)
    const target: RichEmojiAsset = { keys: ['huya-material:12345678'], src: 'a.png', token: '' }
    let refreshes = 0
    const recovery = createHuyaEmojiRecovery({
      assetDescriptor: () => ({
        keys: ['huya-material:12345678'],
        src: 'a.png',
        token: '[开心]',
      }),
      assetMatchScore: () => 10,
      isGenericLabel: () => false,
      isOwned: () => false,
      listMessageImages: () => [image],
      listRows: () => [row],
      merge: (asset, descriptor) => {
        asset.token = descriptor.token
      },
      messageElement: () => message,
      refresh: () => {
        refreshes += 1
      },
      tokenQuality: (token) => (token ? 5 : 0),
    })

    recovery.complete(payload(target))

    expect(target.token).toBe('[开心]')
    expect(refreshes).toBe(1)
  })

  it('keeps an existing strong name without scanning the chat list', () => {
    const target: RichEmojiAsset = { keys: ['raw:a'], src: 'a.png', token: '[大笑]' }
    let scans = 0
    const recovery = createHuyaEmojiRecovery({
      assetDescriptor: () => null,
      assetMatchScore: () => 0,
      isGenericLabel: () => false,
      isOwned: () => false,
      listMessageImages: () => [],
      listRows: () => {
        scans += 1
        return []
      },
      merge: () => undefined,
      messageElement: () => null,
      refresh: () => undefined,
      tokenQuality: (token) => (token === '[大笑]' ? 5 : 0),
    })

    recovery.complete(payload(target))

    expect(target.token).toBe('[大笑]')
    expect(scans).toBe(0)
  })
})

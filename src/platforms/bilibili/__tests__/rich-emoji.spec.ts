import { beforeEach, describe, expect, it } from 'vitest'

import type { RichEmojiAsset, RichMessagePayload } from '../../live/rich-message'
import { bilibiliRichAssetMetadata, createBilibiliEmojiRecovery } from '../rich-emoji'

function payload(asset: RichEmojiAsset): RichMessagePayload {
  return {
    assets: [asset],
    parts: [{ asset, type: 'emoji' }],
    plainText: '',
    text: asset.token,
  }
}

describe('Bilibili rich Emoji recovery', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('keeps an opaque send identity separate from its display name', () => {
    const row = document.createElement('article')
    row.dataset.type = '1'
    row.dataset.fileId = 'official_332'
    row.dataset.danmaku = 'official_332'
    const image = document.createElement('img')
    image.alt = '冲鸭'
    row.append(image)

    const metadata = bilibiliRichAssetMetadata({
      displayMetadata: [image.alt],
      metadataElements: [image, row],
      sources: ['https://i0.hdslb.com/bfs/live/emoji.png'],
    })

    expect(metadata.token).toBe('[冲鸭]')
    expect(metadata.keys).toContain('native-panel:official_332')
    expect(metadata.token).not.toContain('official_332')
  })

  it('uses the message body label and ignores wealth/fan decorations', () => {
    document.body.innerHTML = `
      <article class="chat-item" data-type="1" data-file-id="official_332">
        <img class="wealth-medal" alt="这是 TA 的荣耀等级勋章 (●'◡'●)ノ♥" src="badge.png">
        <span class="danmaku-item-right"><img class="emoji" alt="冲鸭" src="emoji.png"></span>
      </article>
    `
    const row = document.querySelector('article')!
    const message = row.querySelector('.danmaku-item-right')!
    const emoji = message.querySelector('img')!
    const source: RichEmojiAsset = { keys: ['raw:emoji'], src: 'emoji.png', token: '[冲鸭]' }
    const target: RichEmojiAsset = {
      keys: ["name:这是 ta 的荣耀等级勋章 (●'◡'●)ノ♥", 'raw:emoji'],
      src: 'emoji.png',
      token: "[这是 TA 的荣耀等级勋章 (●'◡'●)ノ♥]",
    }
    const recovery = createBilibiliEmojiRecovery({
      assetDescriptor: (element) => (element === emoji ? source : null),
      assetMatchScore: (element) => (element === emoji ? 8 : 0),
      isAdvertisement: () => false,
      isOwned: () => false,
      listMessageImages: () => [emoji],
      listRows: () => [row],
      merge: (asset, descriptor) => {
        asset.token = descriptor.token
        asset.keys = [...new Set([...asset.keys, ...descriptor.keys])]
      },
      messageElement: () => message,
    })

    recovery.complete(payload(target))

    expect(target.token).toBe('[冲鸭]')
    expect(target.keys).not.toContain("name:这是 ta 的荣耀等级勋章 (●'◡'●)ノ♥")
  })

  it('skips advertisement rows and caches a successful descriptor', () => {
    const advertisement = document.createElement('article')
    advertisement.dataset.type = '1'
    const message = document.createElement('span')
    const image = document.createElement('img')
    message.append(image)
    advertisement.append(message)
    let scans = 0
    const recovery = createBilibiliEmojiRecovery({
      assetDescriptor: () => ({ keys: ['raw:a'], src: 'a.png', token: '[广告]' }),
      assetMatchScore: () => 10,
      isAdvertisement: () => true,
      isOwned: () => false,
      listMessageImages: () => [image],
      listRows: () => {
        scans += 1
        return [advertisement]
      },
      merge: () => undefined,
      messageElement: () => message,
    })
    const asset: RichEmojiAsset = { keys: ['raw:a'], src: 'a.png', token: '' }

    expect(recovery.findDescriptor(asset)).toBeNull()
    expect(recovery.findDescriptor(asset)).toBeNull()
    expect(scans).toBe(1)
  })
})

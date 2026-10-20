import { afterEach, describe, expect, it } from 'vitest'
import { normalizeWhitespace } from '../../../core/shared'
import { createLivePlatformAdapter } from '../adapters'
import { elementMarker } from '../element-text'
import { richPartsFromElement, richMessagePayload } from '../rich-message'
import { createRichEmojiMetadataReader } from '../rich-emoji-metadata'

const fixtures = [
  ['mixed order', '<div class="message">前<img alt="[开心]" src="https://cdn.example/a.png">🙂<img title="[大笑]" src="https://cdn.example/b.png">后</div>'],
  ['native room identity', '<section data-type="1" data-file-id="room_123_456" data-danmaku="[房间表情]"><div class="message"><img alt="图片表情" src="https://cdn.example/exclusive.png"></div></section>'],
  ['standard id before label', '<div class="message" data-emoticon-id="official-id"><img alt="[微笑]" data-emoji-id="opaque-id" src="//cdn.example/asset.png?signature=secret"></div>'],
  ['Douyu rel priority', '<div class="message"><img class="EmotImagePe3" rel="狗骨头" alt="[other]" src="https://cdn.example/gougutou.webp"></div>'],
  ['Douyu panel title', '<div class="EmotionList-item"><span class="EmotionList-item-title">官方名称</span><div class="message"><img alt="图片" src="https://cdn.example/123.png"></div></div>'],
  ['Huya panel identity', '<div class="emot--box" data-id="99887766"><img class="emot-icon--item" alt="虎牙开心" src="https://cdn.example/web_base_material_99887766_pic.png"><span class="emot-preview--body"><span>后备文字</span></span></div>'],
  ['source and identity fallback', '<div class="message"><img data-src="https://cdn.example/fallback.png" data-id="0123456789abcdef" title="emoji" /></div>'],
  ['decorative rejection', '<div class="message"><img alt="舰长勋章" src="https://cdn.example/badge.png"></div>'],
  ['no metadata', '<div class="message">文字😀<img></div>'],
] as const

afterEach(() => document.body.replaceChildren())
describe('rich metadata extraction equivalence', () => {
  for (const platform of ['bilibili', 'douyu', 'huya'] as const) {
    it.each(fixtures)(`${platform}: %s`, (_name, html) => {
      document.body.innerHTML = html
      const adapter = createLivePlatformAdapter(platform)
      const reader = createRichEmojiMetadataReader({ adapter: adapter.richEmojiMetadata, normalizeWhitespace, marker: elementMarker, href: () => 'https://live.example/123', isMessageBoundary: element => element.matches('.message') })
      const root = document.body.firstElementChild!
      const payload = richMessagePayload(richPartsFromElement({ element: root, assetFromImage: reader.assetDescriptorFromElement }))
      // These snapshots were generated from the original content-app functions before extraction.
      expect({ payload, assets: [...root.querySelectorAll('img')].map(reader.assetDescriptorFromElement), token: reader.emojiTokenFromElement(root) }).toMatchSnapshot()
      adapter.cleanup()
    })
  }
})

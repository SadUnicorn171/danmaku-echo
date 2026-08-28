import { describe, expect, it } from 'vitest'

import {
  douyinEmojiMessageText,
  douyinEmojiTokenFromMetadata,
  douyinEmojiTokenFromResource,
  registerDouyinEmojiCatalog,
} from '../emoji-token'

const shamateUrl =
  'https://p3-pc-sign.douyinpic.com/obj/tos-cn-i-tsj2vxp0zn/ed5fb68598cf4741b3e7f2affd825650?x-signature=temporary'

describe('Douyin native Emoji text recovery', () => {
  it('maps the live Shamate resource to the text token accepted by Douyin', () => {
    expect(douyinEmojiTokenFromResource(shamateUrl)).toBe('[杀马特]')
    expect(douyinEmojiTokenFromMetadata({ src: shamateUrl, alt: '' })).toBe('[杀马特]')
  })

  it('reads current and legacy native Emoji metadata fields', () => {
    expect(douyinEmojiTokenFromMetadata({ alternativeText: '[杀马特]' })).toBe('[杀马特]')
    expect(douyinEmojiTokenFromMetadata({ image: { content: { display_name: '杀马特' } } }))
      .toBe('[杀马特]')
  })

  it('registers resource mappings loaded from the complete Emoji catalog', () => {
    expect(registerDouyinEmojiCatalog([
      ['1234567890abcdef1234567890abcdef', '[测试表情]'],
      ['unsafe', '测试表情'],
    ])).toBe(1)
    expect(douyinEmojiTokenFromResource(
      'https://example.test/1234567890abcdef1234567890abcdef?signature=temporary',
    )).toBe('[测试表情]')
  })

  it('keeps the complete repeated fallback text and rejects generic placeholders', () => {
    expect(douyinEmojiMessageText({
      default_content: '[杀马特][杀马特][杀马特]',
    })).toBe('[杀马特][杀马特][杀马特]')
    expect(douyinEmojiMessageText({ default_content: '[表情]' })).toBe('')
    expect(douyinEmojiMessageText({ default_content: '表情' })).toBe('')
  })
})

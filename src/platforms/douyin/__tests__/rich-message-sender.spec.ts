import { describe, expect, it } from 'vitest'

import type { EmojiAssetDescriptor } from '../rich-data'
import type { RichPayload } from '../own-message'
import { douyinAutoRecognizedEmojiText } from '../rich-message-sender'

function emoji(token: string, suffix: string): EmojiAssetDescriptor {
  return {
    keys: [`raw:https://example.test/${suffix}.webp`, `name:${token.slice(1, -1)}`],
    src: `https://example.test/${suffix}.webp`,
    token,
  }
}

function payload(parts: RichPayload['parts'], text: string): RichPayload {
  return {
    assets: parts.flatMap((part) => part.type === 'emoji' ? [part.asset] : []),
    parts,
    plainText: parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join(''),
    text,
  }
}

describe('Douyin bracket Emoji sending', () => {
  it('rebuilds repeated bracket Emoji without opening the native panel repeatedly', () => {
    const asset = emoji('[杀马特]', 'shamate')
    const parts: RichPayload['parts'] = Array.from({ length: 3 }, () => ({
      asset,
      type: 'emoji',
    }))
    expect(douyinAutoRecognizedEmojiText(payload(parts, '[杀马特][杀马特][杀马特]')))
      .toBe('[杀马特][杀马特][杀马特]')
  })

  it('preserves the complete order of repeated Emoji and ordinary text', () => {
    const asset = emoji('[杀马特]', 'shamate')
    const threeEmoji = (): RichPayload['parts'] => Array.from({ length: 3 }, () => ({
      asset,
      type: 'emoji' as const,
    }))
    const parts: RichPayload['parts'] = [
      ...threeEmoji(),
      { text: 'cyh', type: 'text' },
      ...threeEmoji(),
      { text: 'cyh', type: 'text' },
    ]
    const text = '[杀马特][杀马特][杀马特]cyh[杀马特][杀马特][杀马特]cyh'
    expect(douyinAutoRecognizedEmojiText(payload(parts, text))).toBe(text)
    expect(douyinAutoRecognizedEmojiText(payload(parts, 'cyhcyh'))).toBe(text)
  })

  it('uses complete visible bracket text when Canvas image tokens are empty', () => {
    const emptyTokenAsset = emoji('', 'canvas-shamate')
    const threeEmoji = (): RichPayload['parts'] => Array.from({ length: 3 }, () => ({
      asset: emptyTokenAsset,
      type: 'emoji' as const,
    }))
    const parts: RichPayload['parts'] = [
      ...threeEmoji(),
      { text: 'cyh', type: 'text' },
      ...threeEmoji(),
      { text: 'cyh', type: 'text' },
    ]
    const text = '[杀马特][杀马特][杀马特]cyh[杀马特][杀马特][杀马特]cyh'
    expect(douyinAutoRecognizedEmojiText(payload(parts, text))).toBe(text)
  })

  it('keeps opaque image Emoji on the resource path', () => {
    const opaque = emoji('', 'opaque-sticker')
    expect(douyinAutoRecognizedEmojiText(payload(
      [{ asset: opaque, type: 'emoji' }],
      '表情',
    ))).toBe('')

    const named = emoji('[杀马特]', 'shamate')
    expect(douyinAutoRecognizedEmojiText({
      assets: [named, named, named],
      parts: Array.from({ length: 3 }, () => ({ asset: named, type: 'emoji' as const })),
      plainText: '',
      text: '表情',
    })).toBe('[杀马特][杀马特][杀马特]')

    expect(douyinAutoRecognizedEmojiText({
      assets: [named, named],
      parts: [
        { asset: named, type: 'emoji' },
        { asset: named, type: 'emoji' },
      ],
      plainText: '',
      text: '[杀马特]',
    })).toBe('[杀马特]')
  })
})

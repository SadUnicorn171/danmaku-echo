import { describe, expect, it } from 'vitest'

import {
  bilibiliNativeEmoticonDisplayToken,
  bilibiliNativeEmoticonToken,
  isBilibiliDecorativeImageDescription,
  isBilibiliEmoticonFallbackLabel,
  isBilibiliOpaqueEmoticonIdentity,
} from '../emoticon-metadata'

describe('Bilibili native emoticon metadata', () => {
  it('uses the plain data-danmaku value as a room Emoji display name', () => {
    expect(bilibiliNativeEmoticonToken('发财了')).toBe('[发财了]')
    expect(bilibiliNativeEmoticonToken('[大笑]')).toBe('[大笑]')
  })

  it('does not expose native identities or generic image labels as names', () => {
    expect(bilibiliNativeEmoticonToken('room_5236391_63398')).toBe('')
    expect(bilibiliNativeEmoticonToken('official_332')).toBe('')
    expect(isBilibiliOpaqueEmoticonIdentity('[official_332]')).toBe(true)
    expect(bilibiliNativeEmoticonToken('图片表情')).toBe('')
  })

  it('prefers a rendered image label over an opaque send identity', () => {
    expect(bilibiliNativeEmoticonDisplayToken([
      '冲鸭',
      'official_332',
    ])).toBe('[冲鸭]')
    expect(bilibiliNativeEmoticonDisplayToken([
      '',
      'official_332',
      '发财了',
    ])).toBe('[发财了]')
  })

  it('recognizes Bilibili badge accessibility text as decorative metadata', () => {
    const description = "这是 TA 的荣耀等级勋章 (●'◡'●)ノ♥"

    expect(isBilibiliDecorativeImageDescription(description)).toBe(true)
    expect(bilibiliNativeEmoticonToken(description)).toBe('')
    expect(isBilibiliDecorativeImageDescription('发财了')).toBe(false)
  })

  it('recognizes both bracketed and plain hidden copies of one Emoji name', () => {
    expect(isBilibiliEmoticonFallbackLabel('发财了', '[发财了]')).toBe(true)
    expect(isBilibiliEmoticonFallbackLabel('[发财了]', '[发财了]')).toBe(true)
    expect(isBilibiliEmoticonFallbackLabel('真的发财了', '[发财了]')).toBe(false)
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { prepareDouyinBarrage } from '../barrage-content'
import type { MeasuredBarrageContent } from '../content-measurer'

function description(options: Record<string, unknown>): MeasuredBarrageContent {
  const content = Array.isArray(options.content) ? options.content : []
  const imageCount = JSON.stringify(content).match(/"type":"image"/gu)?.length || 0
  return {
    firstText: {
      color: '#ffffff',
      fontFamily: 'Arial',
      fontSize: 20,
      fontWeight: 400,
      strokeColor: '#000000',
      strokeWidth: 1,
    },
    height: 24,
    imageCount,
    text: content
      .filter((item): item is { text: string; type: 'text' } =>
        Boolean(item && typeof item === 'object' && item.type === 'text'),
      )
      .map((item) => item.text)
      .join(''),
    width: 120,
  }
}

describe('Douyin page barrage content parser', () => {
  it('extracts ordinary text, style, message identity and track metadata', () => {
    const result = prepareDouyinBarrage(
      {
        channelRange: {
          additionalPriority: 12,
          additionalReserveDuration: 600,
          len: 2,
          startIndex: 1,
        },
        content: [
          {
            color: '#ff4471',
            content: [
              {
                fontFamily: 'PingFang SC',
                fontSize: 26,
                fontWeight: 600,
                text: '普通弹幕',
                type: 'text',
              },
            ],
            strokeColor: '#000000',
            strokeWidth: 2,
            type: 'block',
          },
        ],
        duration: 14_000,
        id: 'message-1',
        prior: 3,
        reserveDuration: 900,
        startTime: 1_786_000_000_000,
        user: { nickname: '用户甲' },
      },
      { describe: description },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.barrage.description.text).toBe('普通弹幕')
    expect(result.barrage.description).toMatchObject({
      actionWidth: 0,
      contentHeight: 24,
      contentWidth: 120,
      rendererPadding: [0, 0, 0, 0],
    })
    expect(result.barrage.messageId).toBe('message-1')
    expect(result.barrage.sender).toBe('用户甲')
    expect(result.barrage.textStyle).toMatchObject({
      color: '#ff4471',
      fontFamily: 'PingFang SC',
      fontSize: 26,
      fontWeight: '600',
      strokeColor: '#000000',
      strokeWidth: 2,
    })
    expect(result.barrage.track).toEqual({
      channelRange: {
        additionalPriority: 12,
        additionalReserveDuration: 600,
        len: 2,
        startIndex: 1,
      },
      duration: 14_000,
      priority: 3,
      reserveDuration: 900,
      startTime: 1_786_000_000_000,
    })
  })

  it('preserves every image in a continuous Emoji message', () => {
    const result = prepareDouyinBarrage(
      {
        content: [
          { alt: '杀马特', src: 'https://example.com/a.png', type: 'image' },
          { alt: '杀马特', src: 'https://example.com/a.png', type: 'image' },
          { alt: '杀马特', src: 'https://example.com/a.png', type: 'image' },
        ],
        messageId: 'emoji-1',
      },
      { describe: description },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.barrage.description.text).toBe('[杀马特][杀马特][杀马特]')
    expect(result.barrage.description.imageOnly).toBe(true)
    expect(result.barrage.images).toHaveLength(3)
    expect(result.barrage.images.map((image) => image.emojiToken)).toEqual([
      '[杀马特]',
      '[杀马特]',
      '[杀马特]',
    ])
  })

  it('keeps mixed text and image parts in their original order', () => {
    const result = prepareDouyinBarrage(
      {
        content: [
          { text: '前', type: 'text' },
          { alt: '看', src: 'https://example.com/look.png', type: 'image' },
          { text: '后', type: 'text' },
        ],
        msgId: 'mixed-1',
      },
      { describe: description },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.barrage.description.text).toBe('前[看]后')
    expect(result.barrage.content.map((item) => item.type)).toEqual(['text', 'image', 'text'])
  })

  it('flags gifts and lucky-bag activity without rejecting renderer content', () => {
    const gift = prepareDouyinBarrage(
      {
        content: [{ text: '用户甲 送出小心心 x 1', type: 'text' }],
        id: 'gift-1',
        type: 'WebcastGiftMessage',
      },
      { describe: description },
    )
    const luckyBag = prepareDouyinBarrage(
      {
        content: [{ text: '左上角福袋抽钻石', type: 'text' }],
        id: 'lucky-1',
        messageType: 'WebcastLuckyBoxMessage',
      },
      { describe: description },
    )

    expect(gift.ok && gift.barrage.repeatReminderExclusion).toBe('gift')
    expect(luckyBag.ok && luckyBag.barrage.repeatReminderExclusion).toBe('synthetic-activity')
  })

  it('rejects unknown and non-interactive structures without throwing', () => {
    expect(prepareDouyinBarrage(null, { describe: description })).toEqual({
      imageCount: 0,
      messageId: '',
      ok: false,
      reason: 'invalid-options',
    })
    expect(
      prepareDouyinBarrage(
        { content: [{ payload: { unknown: true }, type: 'block' }], itemId: 'unknown-1' },
        { describe: description },
      ),
    ).toEqual({
      imageCount: 0,
      messageId: 'unknown-1',
      ok: false,
      reason: 'no-interactive-text',
    })
  })

  it('keeps content parsing and instance registration on separate boundaries', () => {
    const app = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/page-app.ts'),
      'utf8',
    )

    expect(app).toContain('prepareDouyinBarrage')
    expect(app).toContain('registerPreparedBarrage')
    expect(app).not.toContain('function prepareBarrage')
    expect(app).not.toContain('nativeBarrageMessageText')
    expect(app).not.toContain('douyinRepeatReminderExclusionReason')
    expect(app).not.toContain('serializeBarrage(')
  })
})

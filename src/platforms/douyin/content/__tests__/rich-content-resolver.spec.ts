import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDouyinChatParser, type DouyinChatMessageDescriptor } from '../chat-parser'
import { createDouyinRichContentResolver } from '../rich-content-resolver'

const BASE_URL = 'https://live.douyin.com/123'
const EMOJI_URL = 'https://p3-webcast.douyinpic.com/img/webcast/shamate.png'

function rendererEmoji(token = '', src = EMOJI_URL): Record<string, unknown> {
  return { emojiToken: token, src, type: 'image' }
}

function chatDescriptor(body: string, id = 'chat-1'): DouyinChatMessageDescriptor {
  const row = document.createElement('article')
  row.dataset.e2e = 'chat-message'
  row.dataset.messageId = id
  row.innerHTML = `
    <span data-e2e="chat-message-user-name">测试用户</span>
    <span data-e2e="chat-message-text">${body}</span>
  `
  document.body.append(row)
  const descriptor = createDouyinChatParser({ baseUrl: () => BASE_URL }).parse(row)
  if (!descriptor) throw new Error('测试侧聊消息解析失败')
  return descriptor
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('Douyin rich content resolver', () => {
  it('restores a pure image Emoji from complete Canvas bracket text', () => {
    const resolver = createDouyinRichContentResolver({ chatMessages: () => [] })
    const recovery = resolver.resolve('[杀马特]', [rendererEmoji('[杀马特]')])

    expect(recovery).toMatchObject({ reason: 'renderer-content', status: 'resolved' })
    expect(recovery.payload.parts.map((part) => part.type)).toEqual(['emoji'])
    expect(recovery.action).toEqual({ richPayload: null, text: '[杀马特]' })
  })

  it('preserves consecutive and repeated Emoji around ordinary text', () => {
    const fullText = '[杀马特][杀马特][杀马特]cyh[杀马特][杀马特][杀马特]cyh'
    const body = [
      '<img alt="[杀马特]" src="' + EMOJI_URL + '">',
      '<img alt="[杀马特]" src="' + EMOJI_URL + '">',
      '<img alt="[杀马特]" src="' + EMOJI_URL + '">cyh',
      '<img alt="[杀马特]" src="' + EMOJI_URL + '">',
      '<img alt="[杀马特]" src="' + EMOJI_URL + '">',
      '<img alt="[杀马特]" src="' + EMOJI_URL + '">cyh',
    ].join('')
    const descriptor = chatDescriptor(body)
    const content = [
      rendererEmoji(),
      rendererEmoji(),
      rendererEmoji(),
      { text: 'cyh', type: 'text' },
      rendererEmoji(),
      rendererEmoji(),
      rendererEmoji(),
      { text: 'cyh', type: 'text' },
    ]
    const resolver = createDouyinRichContentResolver({
      baseUrl: () => BASE_URL,
      chatMessages: () => [descriptor],
    })
    const recovery = resolver.resolve('cyhcyh', content)

    expect(recovery).toMatchObject({ reason: 'chat-asset-match', status: 'resolved' })
    expect(recovery.payload.assets).toHaveLength(6)
    expect(recovery.action.text).toBe(fullText)
    expect(resolver.actionFromPayload(recovery.payload).text).toBe(fullText)
  })

  it('prefers the side-chat row with the strongest resource match', () => {
    const wrong = chatDescriptor(
      '<img alt="[错误表情]" src="https://example.test/wrong.png">相同文字',
      'wrong',
    )
    const exact = chatDescriptor(
      '<img alt="[杀马特]" src="' + EMOJI_URL + '">相同文字',
      'exact',
    )
    const resolver = createDouyinRichContentResolver({
      baseUrl: () => BASE_URL,
      chatMessages: () => [wrong, exact],
    })

    expect(resolver.resolve('相同文字', [rendererEmoji(), { text: '相同文字', type: 'text' }]))
      .toMatchObject({
        action: { text: '[杀马特]相同文字' },
        reason: 'chat-asset-match',
      })
  })

  it('uses complete bracket text even when the image resource is unavailable', () => {
    const resolver = createDouyinRichContentResolver({ chatMessages: () => [] })
    const recovery = resolver.resolve('[资源失效]文字', [rendererEmoji('', '')])

    expect(recovery).toMatchObject({
      action: { text: '[资源失效]文字' },
      reason: 'canvas-bracket-text',
      status: 'fallback',
    })
    expect(recovery.payload.assets).toEqual([])
  })

  it('reports unresolved renderer Emoji after the bounded catalog retry', async () => {
    const ensureEmojiCatalog = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const delay = vi.fn<(milliseconds: number) => Promise<void>>(() => Promise.resolve())
    const resolver = createDouyinRichContentResolver({
      baseUrl: () => BASE_URL,
      chatMessages: () => [],
      delay,
      ensureEmojiCatalog,
    })
    const recovery = await resolver.resolveWithRetry('表情', [rendererEmoji()])

    expect(recovery).toMatchObject({
      reason: 'renderer-emoji-unresolved',
      status: 'unresolved',
    })
    expect(ensureEmojiCatalog).toHaveBeenCalledOnce()
    expect(delay).toHaveBeenCalledTimes(6)
  })

  it('keeps merge and resource scoring algorithms outside the entry', () => {
    const source = readFileSync(
      resolvePath(process.cwd(), 'src', 'platforms', 'douyin', 'content', 'content-app.ts'),
      'utf8',
    )
    expect(source).toContain('createDouyinRichContentResolver')
    expect(source).not.toMatch(
      /function\s+(?:richPayloadFromRendererContent|mergeRendererPayloadWithChatRow|mergeEmojiAsset|resolveRichPayload)\s*\(/u,
    )
  })
})

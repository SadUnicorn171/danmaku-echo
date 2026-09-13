import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { createDouyinChatParser } from '../chat-parser'

function loadFixture(): void {
  document.body.innerHTML = readFileSync(
    resolve(process.cwd(), 'tests', 'fixtures', 'live-dom', 'douyin.html'),
    'utf8',
  )
}

function createRow(options: {
  body: string
  id: string
  kind?: string
  sender?: string
}): HTMLElement {
  const row = document.createElement('article')
  row.dataset.e2e = 'chat-message'
  row.dataset.messageId = options.id
  if (options.kind) row.dataset.messageKind = options.kind
  row.innerHTML = `
    <span data-e2e="chat-message-user-name">${options.sender ?? '测试用户'}</span>
    <span data-e2e="chat-message-text">${options.body}</span>
  `
  return row
}

beforeEach(loadFixture)

describe('Douyin side-chat parser', () => {
  it('returns one immutable descriptor for mixed rich chat content', () => {
    const parser = createDouyinChatParser({ baseUrl: () => location.href })
    const row = document.querySelector('[data-message-id="douyin-chat-1"]')
    const descriptor = parser.parse(row)

    expect(descriptor).toMatchObject({
      kind: 'mixed',
      messageId: 'douyin-chat-1',
      sender: 'fixture-user-douyin',
    })
    expect(descriptor?.text).toContain('侧聊文字')
    expect(descriptor?.payload.assets).toHaveLength(1)
    expect(Object.isFrozen(descriptor)).toBe(true)
    expect(Object.isFrozen(descriptor?.messageIds)).toBe(true)
    expect(Object.isFrozen(descriptor?.payload)).toBe(true)
    expect(Object.isFrozen(descriptor?.payload.parts)).toBe(true)
    expect(parser.parse(row)).toBe(descriptor)
  })

  it('preserves consecutive image Emoji and mixed text in DOM order', () => {
    const parser = createDouyinChatParser({ baseUrl: () => location.href })
    const emoji = createRow({
      body: '<img alt="[杀马特]" src="/emoji-1.png"><img alt="[杀马特]" src="/emoji-1.png">',
      id: 'emoji-only',
    })
    const mixed = createRow({
      body: '<img alt="[杀马特]" src="/emoji-1.png">cyh<img alt="[杀马特]" src="/emoji-1.png">',
      id: 'emoji-mixed',
    })
    document.body.append(emoji, mixed)

    expect(parser.parse(emoji)).toMatchObject({ kind: 'image-emoji', text: '[杀马特][杀马特]' })
    expect(parser.parse(mixed)).toMatchObject({ kind: 'mixed', text: '[杀马特]cyh[杀马特]' })
    expect(parser.parse(mixed)?.payload.parts.map((part) => part.type)).toEqual([
      'emoji',
      'text',
      'emoji',
    ])
  })

  it('distinguishes text, gift, lottery and system rows', () => {
    const parser = createDouyinChatParser()
    const text = createRow({ body: '普通弹幕', id: 'text' })
    const system = createRow({ body: '直播间公告', id: 'system', kind: 'system' })
    document.body.append(text, system)

    expect(parser.parse(text)?.kind).toBe('text')
    expect(parser.parse(document.querySelector('[data-message-id="douyin-gift-1"]'))?.kind).toBe(
      'gift',
    )
    expect(parser.parse(document.querySelector('[data-message-id="douyin-lottery-1"]'))?.kind).toBe(
      'lottery',
    )
    expect(parser.parse(system)?.kind).toBe('system')
  })

  it('refreshes recycled rows and can parse removed virtual-list nodes', () => {
    const parser = createDouyinChatParser()
    const row = createRow({ body: '旧消息', id: 'old-id' })
    document.body.append(row)
    const first = parser.parse(row)

    row.dataset.messageId = 'new-id'
    const content = row.querySelector('[data-e2e="chat-message-text"]')
    if (content) content.textContent = '新消息'
    const second = parser.parse(row)

    expect(second).not.toBe(first)
    expect(second).toMatchObject({ messageId: 'new-id', text: '新消息' })
    const sender = row.querySelector('[data-e2e="chat-message-user-name"]')
    if (sender) sender.textContent = '新用户'
    const third = parser.parse(row)
    expect(third).not.toBe(second)
    expect(third?.sender).toBe('新用户')
    row.remove()
    expect(parser.rowsFromNode(row)).toEqual([row])
    expect(parser.parse(row)).toBe(third)
    parser.forget(row)
    expect(parser.parse(row)).not.toBe(third)
  })

  it('rejects extension-owned rows and keeps parsing algorithms outside the entry', () => {
    const parser = createDouyinChatParser()
    const owned = createRow({ body: '扩展节点', id: 'owned' })
    owned.dataset.bcpDouyinOwned = 'true'
    document.body.append(owned)

    expect(parser.parse(owned)).toBeNull()
    const source = readFileSync(
      resolve(process.cwd(), 'src', 'platforms', 'douyin', 'content', 'content-app.ts'),
      'utf8',
    )
    expect(source).toContain('createDouyinChatParser')
    expect(source).not.toMatch(
      /function\s+(?:emojiTokenFromImage|richPartsFromElement|senderFromChatContext)\s*\(/u,
    )
  })
})

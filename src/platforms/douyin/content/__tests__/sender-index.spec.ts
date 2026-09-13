import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { createDouyinChatParser, type DouyinChatMessageDescriptor } from '../chat-parser'
import { createDouyinSenderIndex } from '../sender-index'

function descriptor(options: {
  id: string
  message: string
  sender: string
}): DouyinChatMessageDescriptor {
  const row = document.createElement('article')
  row.dataset.e2e = 'chat-message'
  row.dataset.messageId = options.id
  row.innerHTML = `
    <span data-e2e="chat-message-user-name">${options.sender}</span>
    <span data-e2e="chat-message-text">${options.message}</span>
  `
  document.body.append(row)
  const parsed = createDouyinChatParser().parse(row)
  if (!parsed) throw new Error('测试侧聊消息解析失败')
  return parsed
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('Douyin sender index', () => {
  it('exposes only the bounded sender-index contract', () => {
    const index = createDouyinSenderIndex()

    expect(Object.keys(index).sort()).toEqual(['destroy', 'prune', 'remember', 'resolve'])
  })

  it('scans current chat descriptors and prioritizes an exact message ID', () => {
    const first = descriptor({ id: 'message-a', message: '相同弹幕', sender: '用户甲' })
    const second = descriptor({ id: 'message-b', message: '相同弹幕', sender: '用户乙' })
    const index = createDouyinSenderIndex({ chatMessages: () => [first, second] })

    expect(index.resolve('相同弹幕')).toBe('用户乙')
    expect(index.resolve('相同弹幕', { messageId: 'message-a' })).toBe('用户甲')
  })

  it('uses the nearest timestamp for same-text users and otherwise selects the newest', () => {
    let clock = 300
    const index = createDouyinSenderIndex({ now: () => clock })
    index.remember(
      { ids: ['a'], message: '同一句话', sender: '较早用户' },
      { observedAt: 100 },
    )
    index.remember(
      { ids: ['b'], message: '同一句话', sender: '较晚用户' },
      { observedAt: 260 },
    )

    expect(index.resolve('同一句话', { observedAt: 110 })).toBe('较早用户')
    expect(index.resolve('同一句话', { observedAt: 250 })).toBe('较晚用户')
    clock = 320
    expect(index.resolve('同一句话')).toBe('较晚用户')
  })

  it('expires stale observations at the configured TTL', () => {
    let clock = 1_000
    const index = createDouyinSenderIndex({ now: () => clock, ttl: 500 })
    index.remember({ message: '即将过期', sender: '测试用户' }, { observedAt: clock })
    expect(index.resolve('即将过期')).toBe('测试用户')

    clock = 1_501
    index.prune()
    expect(index.resolve('即将过期')).toBe('')
  })

  it('retains a removed virtual-list descriptor until destroy', () => {
    const removed = descriptor({ id: 'removed-id', message: '移除前消息', sender: '离屏用户' })
    removed.element.remove()
    const index = createDouyinSenderIndex()

    index.remember(removed, { observedAt: 100 })
    expect(index.resolve('无关文字', { messageId: 'removed-id', now: 120 })).toBe('离屏用户')
    index.destroy()
    expect(index.resolve('无关文字', { messageId: 'removed-id', now: 120 })).toBe('')
  })

  it('keeps sender cache and scoring implementations outside the entry', () => {
    const source = readFileSync(
      resolvePath(process.cwd(), 'src', 'platforms', 'douyin', 'content', 'content-app.ts'),
      'utf8',
    )
    expect(source).toContain('createDouyinSenderIndex')
    expect(source).not.toMatch(
      /function\s+(?:rememberMessageSender|pruneSenderCache|scanSenderCache|senderForMessage)\s*\(/u,
    )
    expect(source).not.toMatch(/state\.sender(?:Cache|IdCache|History|Correlation)/u)
  })
})

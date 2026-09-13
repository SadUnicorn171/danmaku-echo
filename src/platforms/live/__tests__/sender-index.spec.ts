import { afterEach, describe, expect, it, vi } from 'vitest'

import { SenderIndex } from '../sender-index'

describe('SenderIndex', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('prefers direct senders and resolves message IDs over equal text', () => {
    const index = new SenderIndex()
    index.remember({ ids: ['message-a'], messages: '同一句话', sender: '用户甲' })
    index.remember({ ids: ['message-b'], messages: '同一句话', sender: '用户乙' })

    expect(index.resolve({ ids: ['message-a'], messages: '同一句话' })).toBe('用户甲')
    expect(index.resolve({ ids: ['message-b'], messages: '同一句话' })).toBe('用户乙')
    expect(index.resolve({ directSender: '用户丙', messages: '新消息' })).toBe('用户丙')
  })

  it('uses observation time for equal text and drops expired entries', () => {
    const index = new SenderIndex(1_000, 10)
    index.remember({ messages: '重复内容', observedAt: 1_000, now: 1_000, sender: '早期用户' })
    index.remember({ messages: '重复内容', observedAt: 1_500, now: 1_500, sender: '近期用户' })

    expect(index.resolve({ messages: '重复内容', observedAt: 1_450, now: 1_600 })).toBe('近期用户')
    index.prune(3_000)
    expect(index.resolve({ messages: '重复内容', now: 3_000 })).toBe('')
  })

  it('handles virtual-list node reuse without duplicating an unchanged row', () => {
    const index = new SenderIndex()
    const row = document.createElement('div')
    const first = { ids: ['first'], messages: '第一条', node: row, sender: '用户甲' }
    expect(index.scan([first, first])).toBe(2)
    expect(index.size).toBe(1)

    index.remember({ ids: ['second'], messages: '第二条', node: row, sender: '用户乙' })
    expect(index.resolve({ ids: ['second'], messages: '第二条' })).toBe('用户乙')
    index.forgetNode(row)
    index.clear()
    expect(index.size).toBe(0)
  })

  it('owns its observer, throttled scan, removed-node capture, and cleanup', async () => {
    vi.useFakeTimers()
    const root = document.createElement('section')
    const removed = document.createElement('article')
    root.append(removed)
    let scans = 0
    const index = new SenderIndex()
    index.start({
      isRelevant: () => true,
      minScanInterval: 20,
      observations: () => {
        scans += 1
        return [{ messages: '列表消息', sender: '列表用户' }]
      },
      observationsFromRemovedNode: (node) =>
        node === removed ? [{ messages: '已移除消息', node, sender: '移除用户' }] : [],
      root,
    })

    expect(index.active).toBe(true)
    expect(index.scheduled).toBe(true)
    await vi.runAllTimersAsync()
    expect(scans).toBe(1)
    expect(index.resolve({ messages: '列表消息' })).toBe('列表用户')

    removed.remove()
    await Promise.resolve()
    await vi.runAllTimersAsync()
    expect(index.resolve({ messages: '已移除消息' })).toBe('移除用户')

    index.destroy()
    expect(index.active).toBe(false)
    expect(index.scheduled).toBe(false)
    expect(index.size).toBe(0)
  })
})

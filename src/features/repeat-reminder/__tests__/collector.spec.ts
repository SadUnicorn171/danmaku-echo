import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DanmakuDescriptor } from '../../../core/types'
import { createRepeatReminderCollector } from '../collector'
import type { RepeatReminderObservation } from '../types'

function describeMessage(
  element: Element,
  source: DanmakuDescriptor['source'],
): DanmakuDescriptor | null {
  const text = element.textContent?.trim() || ''
  if (!text) return null
  return {
    parts: [{ text, type: 'text' }],
    platform: 'douyin',
    resourceIds: [],
    source,
    text,
  }
}

async function flushCollector(delay = 50): Promise<void> {
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(delay)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('repeat reminder collector', () => {
  it('creates no observers or wakeups while initially disabled', () => {
    vi.useFakeTimers()
    const observe = vi.spyOn(MutationObserver.prototype, 'observe')
    const collector = createRepeatReminderCollector({ describe: describeMessage, enabled: () => false, messageSelectors: ['.message'], overlaySelectors: [], rootSelectors: ['.chat-root'], observation: () => {} })
    try {
      expect(observe).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
      collector.setEnabled(true)
      expect(vi.getTimerCount()).toBe(1)
    } finally { collector.destroy() }
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases detached shadow roots across repeated room-container replacements', async () => {
    vi.useFakeTimers()
    const NativeObserver = MutationObserver
    const active = new Set<MutationObserver>()
    vi.stubGlobal('MutationObserver', class extends NativeObserver {
      constructor(callback: MutationCallback) { super(callback); active.add(this) }
      override disconnect() { super.disconnect(); active.delete(this) }
    })
    const messages: string[] = []
    const counts: number[] = []
    const collector = createRepeatReminderCollector({ describe: describeMessage, enabled: () => true, messageSelectors: ['.message'], overlaySelectors: [], observation: (row) => messages.push(row.text) })
    try {
      for (let room = 0; room < 20; room++) {
        const host = document.createElement('section')
        host.attachShadow({ mode: 'open' }).innerHTML = `<div class="message">room-${room}</div>`
        document.body.append(host)
        await flushCollector()
        host.remove()
        await flushCollector()
        counts.push(active.size)
      }
      expect(messages).toEqual(Array.from({ length: 20 }, (_, index) => `room-${index}`))
      expect(counts).toEqual(Array.from({ length: 20 }, () => 1))
    } finally { collector.destroy() }
    expect(active.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('yields expensive batches without dropping or reordering queued messages', async () => {
    vi.useFakeTimers()
    let workTime = 0
    vi.spyOn(performance, 'now').mockImplementation(() => workTime)
    document.body.innerHTML = Array.from({ length: 20 }, (_, index) => `<div class="message">${index}</div>`).join('')
    const texts: string[] = []
    const collector = createRepeatReminderCollector({
      describe: (element, source) => { workTime += 1; return describeMessage(element, source) },
      enabled: () => true, messageSelectors: ['.message'], overlaySelectors: [],
      observation: (row) => texts.push(row.text),
    })
    try {
      await flushCollector(40)
      expect(texts).toEqual(['0', '1', '2', '3'])
      await flushCollector(100)
      expect(texts).toEqual(Array.from({ length: 20 }, (_, index) => String(index)))
      collector.setEnabled(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally { collector.destroy() }
  })

  it('discovers open shadow roots without materializing a whole-page wildcard query', async () => {
    vi.useFakeTimers()
    const host = document.createElement('section')
    host.attachShadow({ mode: 'open' }).innerHTML = '<div class="message">shadow message</div>'
    document.body.append(host)
    const query = vi.spyOn(document, 'querySelectorAll')
    const observation = vi.fn<(value: RepeatReminderObservation) => void>()
    const collector = createRepeatReminderCollector({ describe: describeMessage, enabled: () => true, messageSelectors: ['.message'], overlaySelectors: [], observation })
    try {
      await flushCollector()
      expect(observation.mock.calls.map(([row]) => row.text)).toEqual(['shadow message'])
      expect(query.mock.calls.some(([selector]) => selector === '*')).toBe(false)
    } finally { collector.destroy() }
  })

  it('observes only configured chat roots without scanning every page element', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <section class="outside"><div class="message">页面推荐内容</div></section>
      <section class="chat-root"><div class="message">直播间消息一</div></section>
    `
    const querySelectorAll = vi.spyOn(Element.prototype, 'querySelectorAll')
    const observation = vi.fn<(value: RepeatReminderObservation) => void>()
    const collector = createRepeatReminderCollector({
      describe: describeMessage,
      enabled: () => true,
      messageSelectors: ['.message'],
      observation,
      overlaySelectors: [],
      rootSelectors: ['.chat-root'],
    })

    try {
      await flushCollector()
      expect(observation.mock.calls.map(([value]) => value.text)).toEqual(['直播间消息一'])
      expect(querySelectorAll.mock.calls.some(([selector]) => selector === '*')).toBe(false)

      const outsideMessage = document.createElement('div')
      outsideMessage.className = 'message'
      outsideMessage.textContent = '页面推荐内容二'
      document.querySelector('.outside')?.append(outsideMessage)
      await flushCollector()
      expect(observation).toHaveBeenCalledTimes(1)

      const chatMessage = document.createElement('div')
      chatMessage.className = 'message'
      chatMessage.textContent = '直播间消息二'
      document.querySelector('.chat-root')?.append(chatMessage)
      await flushCollector()
      expect(observation.mock.calls.map(([value]) => value.text)).toEqual([
        '直播间消息一',
        '直播间消息二',
      ])
    } finally {
      collector.destroy()
    }
  })

  it('rebinds after Douyin replaces its virtual chat root', async () => {
    vi.useFakeTimers()
    const firstRoot = document.createElement('section')
    firstRoot.className = 'chat-root'
    document.body.append(firstRoot)
    const observation = vi.fn<(value: RepeatReminderObservation) => void>()
    const collector = createRepeatReminderCollector({
      describe: describeMessage,
      enabled: () => true,
      messageSelectors: ['.message'],
      observation,
      overlaySelectors: [],
      rootSelectors: ['.chat-root'],
    })

    try {
      firstRoot.remove()
      const replacement = document.createElement('section')
      replacement.className = 'chat-root'
      replacement.innerHTML = '<div class="message">替换后的消息</div>'
      document.body.append(replacement)
      await flushCollector(1_050)
      expect(observation.mock.calls.map(([value]) => value.text)).toContain('替换后的消息')
    } finally {
      collector.destroy()
    }
  })
})

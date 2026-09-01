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
  document.body.replaceChildren()
})

describe('repeat reminder collector', () => {
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

import { beforeEach, describe, expect, it } from 'vitest'

import { createRepeatReminderCandidateAdapter } from '../repeat-reminder-adapter'

describe('repeat reminder candidate adapter', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('filters and session-suppresses Bilibili lottery entry barrages', () => {
    document.body.innerHTML = `
      <section>
        <div class="bili-danmaku-x-dm" style="--fontSize: 24px">普通弹幕</div>
        <div class="bili-danmaku-x-dm" style="--fontSize: 36px">哼哧殿静174520</div>
      </section>
    `
    const row = document.querySelectorAll('.bili-danmaku-x-dm')[1]
    const suppressed: string[] = []
    const adapter = createRepeatReminderCandidateAdapter({
      describe: () => ({
        id: 'lottery',
        parts: [{ type: 'text', value: '哼哧殿静174520' }],
        platform: 'bilibili',
        resourceIds: [],
        source: 'video',
        text: '哼哧殿静174520',
      }),
      exclusionReason: () => 'lottery-entry',
      maxLength: 1_000,
      roomKey: () => 'bilibili:1',
      suppressText: (text) => suppressed.push(text),
    })

    expect(adapter.describe(row, 'video')).toBeNull()
    expect(adapter.describe(row, 'video')).toBeNull()
    expect(suppressed).toEqual(['哼哧殿静174520'])
  })

  it('passes normal and non-Bilibili descriptors through unchanged', () => {
    const row = document.createElement('div')
    const descriptor = {
      id: 'normal',
      parts: [{ type: 'text' as const, value: '正常弹幕' }],
      platform: 'huya' as const,
      resourceIds: [],
      source: 'chat' as const,
      text: '正常弹幕',
    }
    const adapter = createRepeatReminderCandidateAdapter({
      describe: () => descriptor,
      maxLength: 1_000,
      roomKey: () => 'huya:1',
      suppressText: () => undefined,
    })

    expect(adapter.describe(row, 'chat')).toBe(descriptor)
  })
})

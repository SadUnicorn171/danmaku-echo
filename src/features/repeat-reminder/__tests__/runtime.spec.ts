import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, mergeSettings } from '../../../core/shared'
import { createRepeatReminderRuntime } from '../runtime'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
  document
    .querySelectorAll('[data-bcp-repeat-reminder-owned]')
    .forEach((element) => element.remove())
})

describe('repeat reminder runtime audience refresh', () => {
  it('keeps the selected platform threshold fixed in manual mode', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<div data-e2e="live-room-audience">100,000</div>'
    const settings = mergeSettings({
      repeatReminder: {
        manual: {
          douyin: {
            promptDurationSeconds: 12,
            promptScalePercent: 90,
            queueLimit: 4,
            threshold: 4,
          },
        },
        mode: 'manual',
      },
    })
    const runtime = createRepeatReminderRuntime({
      initialSettings: settings,
      platform: 'douyin',
      plusOne: vi.fn<() => void>(),
      roomKey: () => 'douyin:manual-room',
    })
    try {
      const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      expect(shadow?.querySelector('[data-value="threshold"]')?.textContent).toBe('4 次')
      expect(shadow?.querySelector('[data-value="duration"]')?.textContent).toBe('12 秒')
      vi.advanceTimersByTime(35_000)
      expect(shadow?.querySelector('[data-value="threshold"]')?.textContent).toBe('4 次')
    } finally {
      runtime.destroy()
    }
  })

  it('falls back to a hysteresis-controlled traffic threshold when audience is unavailable', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    const runtime = createRepeatReminderRuntime({
      initialSettings: DEFAULT_SETTINGS,
      platform: 'douyin',
      plusOne: vi.fn<() => void>(),
      roomKey: () => 'douyin:room-one',
    })
    try {
      for (let index = 0; index < 400; index += 1) {
        runtime.ingest({
          messageId: `flow-${index}`,
          observedAt: Date.now(),
          parts: [{ text: `普通弹幕${index}`, type: 'text' }],
          resourceIds: [],
          senderId: `u${index}`,
          source: 'chat',
          text: `普通弹幕${index}`,
        })
      }
      vi.advanceTimersByTime(35_000)
      const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      expect(shadow?.querySelector('[data-audience-label]')?.textContent).toBe('弹幕流量')
      expect(shadow?.querySelector('[data-value="audience"]')?.textContent).toContain('条/分')
      expect(shadow?.querySelector('[data-value="threshold"]')?.textContent).toBe('9 次')
    } finally {
      runtime.destroy()
    }
  })

  it('refreshes the displayed audience and applies its adaptive threshold', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<div data-e2e="live-room-audience">4,974</div>'
    const runtime = createRepeatReminderRuntime({
      initialSettings: DEFAULT_SETTINGS,
      platform: 'douyin',
      plusOne: vi.fn<() => void>(),
      roomKey: () => 'douyin:room-one',
    })
    try {
      const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      expect(shadow?.querySelector('[data-value="audience"]')?.textContent).toBe('4,974 人')
      expect(shadow?.querySelector('[data-value="threshold"]')?.textContent).toBe('7 次')

      const audience = document.querySelector('[data-e2e="live-room-audience"]')
      if (audience) audience.textContent = '5,125'
      vi.advanceTimersByTime(1_000)

      expect(shadow?.querySelector('[data-value="audience"]')?.textContent).toBe('5,125 人')
      expect(shadow?.querySelector('[data-value="threshold"]')?.textContent).toBe('8 次')
    } finally {
      runtime.destroy()
    }
  })

  it('continues converging toward a stable audience sample after the displayed value changes', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<div data-e2e="live-room-audience">3,000</div>'
    const runtime = createRepeatReminderRuntime({
      initialSettings: DEFAULT_SETTINGS,
      platform: 'douyin',
      plusOne: vi.fn<() => void>(),
      roomKey: () => 'douyin:room-one',
    })
    try {
      const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      expect(shadow?.querySelector('[data-value="threshold"]')?.textContent).toBe('6 次')

      const audience = document.querySelector('[data-e2e="live-room-audience"]')
      if (audience) audience.textContent = '20,000'
      vi.advanceTimersByTime(3_000)

      expect(shadow?.querySelector('[data-value="audience"]')?.textContent).toBe('20,000 人')
      expect(shadow?.querySelector('[data-value="threshold"]')?.textContent).toBe('9 次')
    } finally {
      runtime.destroy()
    }
  })

  it('removes a prompt when its text is later identified as platform activity', () => {
    vi.useFakeTimers()
    const runtime = createRepeatReminderRuntime({
      initialSettings: DEFAULT_SETTINGS,
      platform: 'douyin',
      plusOne: vi.fn<() => void>(),
      roomKey: () => 'douyin:room-one',
    })
    try {
      const text = '点点关注铝厂ev63键盘'
      for (let index = 0; index < DEFAULT_SETTINGS.repeatReminder.threshold; index += 1) {
        vi.setSystemTime(1_800_000_000_000 + index * 100)
        runtime.ingest({
          messageId: `command-${index}`,
          observedAt: Date.now(),
          parts: [{ text, type: 'text' }],
          resourceIds: [],
          senderId: `u${index}`,
          source: 'chat',
          text,
        })
      }
      const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      expect(shadow?.querySelector('[data-suggestion-id]')).not.toBeNull()

      runtime.suppressText(text)

      expect(shadow?.querySelector('[data-suggestion-id]')).toBeNull()
    } finally {
      runtime.destroy()
    }
  })

  it('reawakens a timed-out prompt after 30 seconds and half the radar threshold', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn<() => Promise<Record<string, boolean>>>().mockResolvedValue({
            danmakuEchoRepeatReminderOnboardingV1: true,
          }),
          set: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        },
      },
    })
    const settings = mergeSettings({
      repeatReminder: {
        manual: {
          douyin: {
            promptDurationSeconds: 1,
            promptScalePercent: 100,
            queueLimit: 3,
            threshold: 4,
          },
        },
        mode: 'manual',
      },
    })
    const runtime = createRepeatReminderRuntime({
      initialSettings: settings,
      platform: 'douyin',
      plusOne: vi.fn<() => void>(),
      roomKey: () => 'douyin:room-one',
    })
    const ingest = (index: number): void =>
      runtime.ingest({
        messageId: `wake-${index}`,
        observedAt: Date.now(),
        parts: [{ text: '主播这波太帅了', type: 'text' }],
        resourceIds: [],
        senderId: `u${index}`,
        source: 'chat',
        text: '主播这波太帅了',
      })
    try {
      await Promise.resolve()
      await Promise.resolve()
      ingest(1)
      ingest(2)
      ingest(3)
      ingest(4)
      const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      expect(shadow?.querySelectorAll('.prompt')).toHaveLength(1)
      vi.advanceTimersByTime(1_000)
      expect(shadow?.querySelectorAll('.prompt')).toHaveLength(0)

      ingest(5)
      ingest(6)
      expect(shadow?.querySelectorAll('.prompt')).toHaveLength(0)
      vi.advanceTimersByTime(30_000)
      expect(shadow?.querySelectorAll('.prompt')).toHaveLength(1)
      expect(shadow?.querySelector('.prompt-meta')?.textContent).toContain('6 次')
    } finally {
      runtime.destroy()
    }
  })

  it('automatically +1s a newly triggered radar item and hard-suppresses it for 40 seconds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn<() => Promise<Record<string, boolean>>>().mockResolvedValue({
            danmakuEchoRepeatReminderOnboardingV1: true,
          }),
          set: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        },
      },
    })
    const plusOne = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)
    const settings = mergeSettings({
      repeatReminder: {
        autoPlusOne: true,
        manual: {
          douyin: {
            promptDurationSeconds: 10,
            promptScalePercent: 100,
            queueLimit: 3,
            threshold: 2,
          },
        },
        mode: 'manual',
      },
    })
    const runtime = createRepeatReminderRuntime({
      initialSettings: settings,
      platform: 'douyin',
      plusOne,
      roomKey: () => 'douyin:auto-plus-one',
    })
    const ingest = (index: number): void => runtime.ingest({
      messageId: `auto-${index}`,
      observedAt: Date.now(),
      parts: [{ text: '自动跟一条', type: 'text' }],
      resourceIds: [],
      senderId: `u${index}`,
      source: 'chat',
      text: '自动跟一条',
    })
    try {
      await Promise.resolve()
      await Promise.resolve()
      ingest(1)
      ingest(2)
      await Promise.resolve()
      await Promise.resolve()
      const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      expect(plusOne).toHaveBeenCalledExactlyOnceWith('自动跟一条')
      expect(shadow?.querySelectorAll('.prompt')).toHaveLength(0)

      ingest(3)
      await Promise.resolve()
      expect(plusOne).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(40_000)
      ingest(4)
      for (let index = 0; index < 6; index += 1) await Promise.resolve()
      expect(plusOne).toHaveBeenCalledTimes(2)
      expect(shadow?.querySelectorAll('.prompt')).toHaveLength(0)
    } finally {
      runtime.destroy()
    }
  })

  it('persists an Automatic +1 opt-in made directly from the first-use guide', async () => {
    const syncSet = vi.fn<(value: unknown) => Promise<void>>().mockResolvedValue(undefined)
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn<() => Promise<Record<string, boolean>>>().mockResolvedValue({}),
          set: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        },
        sync: { set: syncSet },
      },
    })
    const runtime = createRepeatReminderRuntime({
      initialSettings: DEFAULT_SETTINGS,
      platform: 'douyin',
      plusOne: vi.fn<() => void>(),
      roomKey: () => 'douyin:onboarding-opt-in',
    })
    try {
      const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      await vi.waitFor(() => {
        expect(shadow?.querySelector('.onboarding')?.classList.contains('is-visible')).toBe(true)
      })
      shadow?.querySelector<HTMLInputElement>('.onboarding-auto-plus-one input')?.click()
      expect(syncSet).toHaveBeenCalledExactlyOnceWith({
        repeatReminder: expect.objectContaining({ autoPlusOne: true }),
      })
    } finally {
      runtime.destroy()
    }
  })

  it('uses the Huya guest tab without requesting or estimating heat', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    document.body.innerHTML = `
      <span id="live-count" title="热度值">35.5万</span>
      <button class="J_rankTabVip">贵宾(2656)</button>
    `
    const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>()
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const runtime = createRepeatReminderRuntime({
      initialSettings: DEFAULT_SETTINGS,
      platform: 'huya',
      plusOne: vi.fn<() => void>(),
      roomKey: () => 'huya:660000',
    })
    try {
      await Promise.resolve()
      await Promise.resolve()
      const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      expect(sendMessage).not.toHaveBeenCalled()
      expect(shadow?.querySelector('[data-audience-label]')?.textContent).toBe('贵宾数')
      expect(shadow?.querySelector('[data-value="audience"]')?.textContent).toBe('2,656 位')
      expect(shadow?.querySelector('[data-value="threshold"]')?.textContent).toBe('18 次')
    } finally {
      runtime.destroy()
    }
  })

  it('reads Bilibili audience reported by its chat iframe', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>().mockResolvedValue({
      metric: {
        kind: 'viewers',
        label: '房间观众',
        platform: 'bilibili',
        rawText: '1万+',
        sampledAt: Date.now(),
        source: 'frame',
        value: 10_000,
      },
      ok: true,
    })
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const runtime = createRepeatReminderRuntime({
      initialSettings: DEFAULT_SETTINGS,
      platform: 'bilibili',
      plusOne: vi.fn<() => void>(),
      roomKey: () => 'bilibili:1746',
    })
    try {
      await Promise.resolve()
      await Promise.resolve()
      const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      expect(sendMessage).toHaveBeenCalledWith({
        platform: 'bilibili',
        type: 'danmaku-echo.live-audience.frame-read',
      })
      expect(shadow?.querySelector('[data-value="audience"]')?.textContent).toBe('1万+ 人')
      expect(shadow?.querySelector('[data-value="threshold"]')?.textContent).toBe('8 次')
    } finally {
      runtime.destroy()
    }
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRepeatReminderUi } from '../ui'
import type { RepeatReminderSuggestion } from '../types'

function suggestion(id = 'repeat-one', text = '主播这波太帅了'): RepeatReminderSuggestion {
  return { count: 5, id, senders: 4, text, threshold: 5, windowMs: 60_000 }
}

afterEach(() => {
  vi.useRealTimers()
  document
    .querySelectorAll('[data-bcp-repeat-reminder-owned]')
    .forEach((element) => element.remove())
  document.documentElement.removeAttribute('data-bcp-repeat-reminder-owner')
})

const ENABLED_SETTINGS = {
  enabled: true,
  promptDurationSeconds: 6,
  promptScalePercent: 100,
  queueLimit: 3,
  threshold: 5,
} as const

describe('repeat reminder UI', () => {
  it('keeps one portal when another runtime starts or a stale portal is reattached', async () => {
    const options = {
      dismiss: vi.fn<() => void>(),
      openSettings: vi.fn<() => void>(),
      plusOne: vi.fn<() => void>(),
    }
    const first = createRepeatReminderUi(options)
    const firstPortal = document.querySelector<HTMLElement>('[data-bcp-repeat-reminder-owned]')
    const second = createRepeatReminderUi(options)
    try {
      const secondPortal = document.querySelector<HTMLElement>('[data-bcp-repeat-reminder-owned]')
      expect(firstPortal).not.toBeNull()
      expect(secondPortal).not.toBe(firstPortal)
      expect(document.querySelectorAll('[data-bcp-repeat-reminder-owned]')).toHaveLength(1)

      first.ensureHost()
      expect(firstPortal?.isConnected).toBe(false)

      const stalePortal = document.createElement('div')
      stalePortal.dataset.bcpRepeatReminderOwned = 'true'
      document.documentElement.append(stalePortal)
      await vi.waitFor(() => {
        expect(document.querySelectorAll('[data-bcp-repeat-reminder-owned]')).toHaveLength(1)
        expect(secondPortal?.isConnected).toBe(true)
        expect(stalePortal.isConnected).toBe(false)
      })
    } finally {
      first.destroy()
      second.destroy()
    }
  })

  it('shows onboarding as soon as the enabled radar loads and persists acknowledgement', async () => {
    let acknowledged = false
    const onboardingStorage = {
      acknowledge: vi.fn<() => Promise<void>>(async () => {
        acknowledged = true
      }),
      isAcknowledged: vi.fn<() => Promise<boolean>>(async () => acknowledged),
    }
    const options = {
      dismiss: vi.fn<() => void>(),
      onboardingStorage,
      openSettings: vi.fn<() => void>(),
      plusOne: vi.fn<() => void>(),
      setAutoPlusOne: vi.fn<(enabled: boolean) => void>(),
    }
    let ui = createRepeatReminderUi(options)
    try {
      ui.applySettings(ENABLED_SETTINGS)
      let shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      await vi.waitFor(() => {
        expect(shadow?.querySelector('.onboarding')?.classList.contains('is-visible')).toBe(true)
      })
      expect(shadow?.querySelectorAll('.prompt')).toHaveLength(0)

      const portal = document.querySelector('[data-bcp-repeat-reminder-owned]')
      const mountMarker = document.createElement('div')
      document.documentElement.append(mountMarker)
      expect(portal?.nextSibling).toBe(mountMarker)
      ui.setSuggestions([suggestion()])
      expect(shadow?.querySelector('.onboarding')?.classList.contains('is-visible')).toBe(true)
      expect(shadow?.querySelectorAll('.prompt')).toHaveLength(0)
      expect(shadow?.querySelector('.prompt-list')?.classList.contains('is-visible')).toBe(false)
      expect(portal?.nextSibling).toBe(mountMarker)
      mountMarker.remove()
      expect(shadow?.querySelector('.onboarding-card')?.getAttribute('aria-modal')).toBe('true')
      expect(shadow?.querySelector('.onboarding-card')?.getAttribute('data-placement')).toBe('left')
      expect(shadow?.querySelector<HTMLElement>('.onboarding-card')?.style.left).not.toBe('')
      expect(shadow?.querySelector('.onboarding-arrow')).not.toBeNull()
      expect(shadow?.querySelector('.launcher')?.classList.contains('is-onboarding')).toBe(true)
      expect(shadow?.querySelector('.onboarding-accent')).not.toBeNull()
      expect(shadow?.querySelectorAll('.onboarding-feature')).toHaveLength(2)
      expect(shadow?.querySelectorAll('.onboarding-setting-list li')).toHaveLength(7)
      expect(shadow?.querySelector('.onboarding-note')).not.toBeNull()
      expect(shadow?.querySelector('.onboarding-card')?.textContent).toContain('默认只提醒')
      expect(shadow?.querySelector('.onboarding-card')?.textContent).toContain('箭头指向的按钮')
      expect(shadow?.querySelector('.onboarding-card')?.textContent).toContain('触发次数')
      expect(shadow?.querySelector('.onboarding-card')?.textContent).toContain('提示停留时间')
      const autoPlusOne = shadow?.querySelector<HTMLInputElement>(
        '.onboarding-auto-plus-one input',
      )
      expect(autoPlusOne?.checked).toBe(false)
      autoPlusOne?.click()
      expect(options.setAutoPlusOne).toHaveBeenCalledExactlyOnceWith(true)
      expect(shadow?.querySelector('.prompt-list')?.classList.contains('is-visible')).toBe(false)

      shadow?.querySelector<HTMLButtonElement>('.onboarding-acknowledge')?.click()
      expect(onboardingStorage.acknowledge).toHaveBeenCalledOnce()
      expect(shadow?.querySelector('.onboarding')?.classList.contains('is-visible')).toBe(false)
      expect(shadow?.querySelector('.launcher')?.classList.contains('is-onboarding')).toBe(false)
      expect(shadow?.querySelector('.prompt-list')?.classList.contains('is-visible')).toBe(true)
      expect(shadow?.querySelectorAll('.prompt')).toHaveLength(1)

      ui.destroy()
      ui = createRepeatReminderUi(options)
      ui.applySettings(ENABLED_SETTINGS)
      ui.setSuggestions([suggestion('second')])
      shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      await vi.waitFor(() => expect(onboardingStorage.isAcknowledged).toHaveBeenCalledTimes(2))
      expect(shadow?.querySelector('.onboarding')?.classList.contains('is-visible')).toBe(false)
      expect(shadow?.querySelector('.prompt-list')?.classList.contains('is-visible')).toBe(true)
    } finally {
      ui.destroy()
    }
  })

  it('animates a new prompt in while existing prompts move to their next queue position', () => {
    const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
    const animate = vi.fn<
      (keyframes: Keyframe[], options?: number | KeyframeAnimationOptions) => Animation
    >(
      (_keyframes, _options) =>
        ({
          cancel: vi.fn<() => void>(),
          finished: new Promise<void>(() => undefined),
        }) as unknown as Animation,
    )
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    })
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (!this.classList.contains('prompt')) return DOMRect.fromRect()
        const siblings = this.parentElement ? [...this.parentElement.children] : []
        return DOMRect.fromRect({
          height: 72,
          width: 360,
          x: 120,
          y: 60 + siblings.indexOf(this) * 80,
        })
      })
    const ui = createRepeatReminderUi({
      dismiss: vi.fn<() => void>(),
      openSettings: vi.fn<() => void>(),
      plusOne: vi.fn<() => void>(),
    })
    try {
      ui.applySettings(ENABLED_SETTINGS)
      ui.setSuggestions([suggestion('old', '较早弹幕')])
      const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      const oldPrompt = shadow?.querySelector<HTMLElement>('[data-suggestion-id="old"]')
      animate.mockClear()

      ui.setSuggestions([suggestion('new', '最新弹幕'), suggestion('old', '较早弹幕')])

      expect(shadow?.querySelector<HTMLElement>('[data-suggestion-id="old"]')).toBe(oldPrompt)
      const enterCall = animate.mock.calls.find(([keyframes]) => keyframes[0]?.opacity === 0)
      const moveCall = animate.mock.calls.find(
        ([keyframes]) => keyframes[0]?.transform === 'translate3d(0px, -80px, 0)',
      )
      expect(enterCall?.[1]).toMatchObject({ duration: 220 })
      expect(moveCall?.[1]).toMatchObject({ duration: 260 })
    } finally {
      ui.destroy()
      rectSpy.mockRestore()
      if (originalAnimate) {
        Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).animate
      }
    }
  })

  it('renders a newest-first queue and dismisses only the selected item', () => {
    const dismiss = vi.fn<(value: RepeatReminderSuggestion) => void>()
    const ui = createRepeatReminderUi({
      dismiss,
      openSettings: vi.fn<() => void>(),
      plusOne: vi.fn<() => void>(),
    })
    ui.applySettings(ENABLED_SETTINGS)
    ui.setSuggestions([suggestion('new', '最新弹幕'), suggestion('old', '较早弹幕')])
    const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
    const portal = document.querySelector<HTMLElement>('[data-bcp-repeat-reminder-owned]')
    const prompts = shadow?.querySelectorAll<HTMLElement>('.prompt')
    expect(portal?.style.zIndex).toBe('2147483647')
    expect([...(prompts || [])].map((item) => item.querySelector('strong')?.textContent)).toEqual([
      '最新弹幕',
      '较早弹幕',
    ])
    prompts?.[0]?.querySelector<HTMLButtonElement>('button:not(.is-primary)')?.click()
    expect(dismiss).toHaveBeenCalledWith(expect.objectContaining({ id: 'new' }))
    expect(shadow?.querySelectorAll('.prompt')).toHaveLength(1)
    expect(shadow?.querySelector('.prompt strong')?.textContent).toBe('较早弹幕')
    expect(shadow?.querySelector('.launcher-badge')?.textContent).toBe('1')
    ui.destroy()
  })

  it('executes +1 directly for the chosen queue item', () => {
    const plusOne = vi.fn<(value: RepeatReminderSuggestion) => void>()
    const ui = createRepeatReminderUi({
      dismiss: vi.fn<() => void>(),
      openSettings: vi.fn<() => void>(),
      plusOne,
    })
    ui.applySettings(ENABLED_SETTINGS)
    ui.setSuggestions([suggestion('one', '第一条'), suggestion('two', '第二条')])
    const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
    shadow?.querySelectorAll<HTMLButtonElement>('button.is-primary')[1]?.click()
    expect(plusOne).toHaveBeenCalledWith(expect.objectContaining({ id: 'two', text: '第二条' }))
    expect(shadow?.querySelectorAll('.prompt')).toHaveLength(1)
    ui.destroy()
  })

  it('publishes the visible prompt rectangle for Douyin page-world hit testing', () => {
    const ui = createRepeatReminderUi({
      dismiss: vi.fn<() => void>(),
      openSettings: vi.fn<() => void>(),
      plusOne: vi.fn<() => void>(),
    })
    ui.applySettings(ENABLED_SETTINGS)
    const portal = document.querySelector<HTMLElement>('[data-bcp-repeat-reminder-owned]')
    const promptList = portal?.shadowRoot?.querySelector<HTMLElement>('.prompt-list')
    vi.spyOn(promptList!, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ height: 80, width: 320, x: 120, y: 60 }),
    )
    ui.setSuggestions([suggestion()])
    expect(JSON.parse(portal?.dataset.bcpRepeatReminderHitRegions || '[]')).toContainEqual([
      120, 60, 440, 140,
    ])
    ui.destroy()
  })

  it('shows all lightweight settings and applies whole-prompt scaling', () => {
    const openSettings = vi.fn<() => void>()
    const ui = createRepeatReminderUi({
      dismiss: vi.fn<() => void>(),
      openSettings,
      plusOne: vi.fn<() => void>(),
    })
    ui.applySettings({
      enabled: true,
      promptDurationSeconds: 9,
      promptScalePercent: 125,
      queueLimit: 5,
      threshold: 12,
    })
    const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
    const launcher = shadow?.querySelector<HTMLButtonElement>('.launcher')
    expect(launcher?.classList.contains('is-visible')).toBe(true)
    expect(launcher?.style.top).toBe('18px')
    launcher?.click()
    expect(shadow?.querySelector('[data-value="threshold"]')?.textContent).toBe('12 次')
    expect(shadow?.querySelector('[data-value="duration"]')?.textContent).toBe('9 秒')
    expect(shadow?.querySelector('[data-value="queue"]')?.textContent).toBe('5 条')
    expect(shadow?.querySelector('[data-value="scale"]')?.textContent).toBe('125%')
    expect(
      shadow
        ?.querySelector<HTMLElement>('.prompt-list')
        ?.style.getPropertyValue('--bcp-repeat-prompt-scale'),
    ).toBe('1.25')
    shadow?.querySelector<HTMLButtonElement>('.open-settings')?.click()
    expect(openSettings).toHaveBeenCalledOnce()
    ui.destroy()
  })

  it('shows the live audience signal without changing the reminder threshold', () => {
    const ui = createRepeatReminderUi({
      dismiss: vi.fn<() => void>(),
      openSettings: vi.fn<() => void>(),
      plusOne: vi.fn<() => void>(),
    })
    ui.applySettings(ENABLED_SETTINGS)
    ui.setAudience({
      kind: 'viewers',
      label: '在线观众',
      platform: 'douyin',
      rawText: '4974',
      value: 4_974,
    })
    const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
    shadow?.querySelector<HTMLButtonElement>('.launcher')?.click()
    expect(shadow?.querySelector('[data-audience-label]')?.textContent).toBe('在线观众')
    expect(shadow?.querySelector('[data-value="audience"]')?.textContent).toBe('4,974 人')
    expect(shadow?.querySelector('[data-value="threshold"]')?.textContent).toBe('5 次')

    ui.setAudience({
      kind: 'guests',
      label: '贵宾数',
      platform: 'huya',
      rawText: '2656',
      value: 2_656,
    })
    expect(shadow?.querySelector('[data-audience-label]')?.textContent).toBe('贵宾数')
    expect(shadow?.querySelector('[data-value="audience"]')?.textContent).toBe('2,656 位')
    expect(shadow?.querySelector('[data-value="audience"]')?.getAttribute('title')).toContain(
      '直播间贵宾数',
    )
    ui.destroy()
  })

  it('shows danmaku traffic as the fallback basis when audience data is unavailable', () => {
    const ui = createRepeatReminderUi({
      dismiss: vi.fn<() => void>(),
      openSettings: vi.fn<() => void>(),
      plusOne: vi.fn<() => void>(),
    })
    ui.applySettings(ENABLED_SETTINGS)
    ui.setTraffic({
      burstRate: 600,
      level: 'active',
      messageCount: 420,
      rate: 486,
      ready: true,
      senderCoverage: 0.8,
      stableRate: 430,
    })
    const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
    expect(shadow?.querySelector('[data-audience-label]')?.textContent).toBe('弹幕流量')
    expect(shadow?.querySelector('[data-value="audience"]')?.textContent).toBe('约 486 条/分')
    expect(shadow?.querySelector('[data-value="audience"]')?.getAttribute('title')).toContain(
      '等级：活跃',
    )
    ui.destroy()
  })

  it('starts at the top right and can be dragged without opening settings', () => {
    const ui = createRepeatReminderUi({
      dismiss: vi.fn<() => void>(),
      openSettings: vi.fn<() => void>(),
      plusOne: vi.fn<() => void>(),
    })
    ui.applySettings(ENABLED_SETTINGS)
    const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
    const launcher = shadow?.querySelector<HTMLButtonElement>('.launcher')
    const initialLeft = Number.parseFloat(launcher?.style.left || '0')
    launcher?.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: initialLeft,
        clientY: 18,
      }),
    )
    document.dispatchEvent(
      new MouseEvent('pointermove', {
        bubbles: true,
        clientX: initialLeft - 100,
        clientY: 78,
      }),
    )
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    expect(Number.parseFloat(launcher?.style.left || '0')).toBe(initialLeft - 100)
    expect(launcher?.style.top).toBe('78px')
    launcher?.click()
    expect(launcher?.getAttribute('aria-expanded')).toBe('false')
    ui.destroy()
  })

  it('hides the launcher, settings and queue when radar is disabled', () => {
    const ui = createRepeatReminderUi({
      dismiss: vi.fn<() => void>(),
      openSettings: vi.fn<() => void>(),
      plusOne: vi.fn<() => void>(),
    })
    ui.applySettings(ENABLED_SETTINGS)
    ui.setSuggestions([suggestion()])
    const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
    shadow?.querySelector<HTMLButtonElement>('.launcher')?.click()
    ui.applySettings({ ...ENABLED_SETTINGS, enabled: false })
    expect(shadow?.querySelector('.launcher')?.classList.contains('is-visible')).toBe(false)
    expect(shadow?.querySelector('.settings')?.classList.contains('is-visible')).toBe(false)
    expect(shadow?.querySelector('.prompt-list')?.classList.contains('is-visible')).toBe(false)
    ui.destroy()
  })

  it('counts down and expires queue items independently', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T00:00:00Z'))
    const dismiss = vi.fn<(value: RepeatReminderSuggestion) => void>()
    const ui = createRepeatReminderUi({
      dismiss,
      openSettings: vi.fn<() => void>(),
      plusOne: vi.fn<() => void>(),
    })
    ui.applySettings(ENABLED_SETTINGS)
    ui.setSuggestions([suggestion('first')])
    vi.advanceTimersByTime(2_000)
    ui.setSuggestions([suggestion('second'), suggestion('first')])
    const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
    const buttons = shadow?.querySelectorAll<HTMLButtonElement>('.prompt-actions .is-primary')
    expect(buttons?.[0]?.textContent).toBe('+1 · 6s')
    expect(buttons?.[1]?.textContent).toBe('+1 · 4s')
    vi.advanceTimersByTime(4_000)
    expect(dismiss).toHaveBeenCalledWith(expect.objectContaining({ id: 'first' }))
    expect(shadow?.querySelectorAll('.prompt')).toHaveLength(1)
    expect(shadow?.querySelector('.prompt')?.getAttribute('data-suggestion-id')).toBe('second')
    ui.destroy()
  })

  it('never reawakens manually dismissed or +1 prompts during their 40-second snooze', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T00:00:00Z'))
    const refresh = vi.fn<() => void>()
    const ui = createRepeatReminderUi({
      dismiss: vi.fn<() => void>(),
      openSettings: vi.fn<() => void>(),
      plusOne: vi.fn<() => void>(),
      refresh,
    })
    ui.applySettings(ENABLED_SETTINGS)
    ui.setSuggestions([suggestion('dismissed'), suggestion('sent')])
    const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
    shadow
      ?.querySelector<HTMLElement>('[data-suggestion-id="dismissed"]')
      ?.querySelector<HTMLButtonElement>('button:not(.is-primary)')
      ?.click()
    shadow
      ?.querySelector<HTMLElement>('[data-suggestion-id="sent"]')
      ?.querySelector<HTMLButtonElement>('button.is-primary')
      ?.click()

    const increased = [
      { ...suggestion('dismissed'), count: 99 },
      { ...suggestion('sent'), count: 99 },
    ]
    ui.setSuggestions(increased)
    expect(shadow?.querySelectorAll('.prompt')).toHaveLength(0)
    vi.advanceTimersByTime(39_999)
    ui.setSuggestions(increased)
    expect(shadow?.querySelectorAll('.prompt')).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    ui.setSuggestions(increased)
    expect(shadow?.querySelectorAll('.prompt')).toHaveLength(2)
    ui.destroy()
  })

  it('reawakens an automatically timed-out prompt after 30 seconds and half its threshold', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T00:00:00Z'))
    const refresh = vi.fn<() => void>()
    const ui = createRepeatReminderUi({
      dismiss: vi.fn<() => void>(),
      openSettings: vi.fn<() => void>(),
      plusOne: vi.fn<() => void>(),
      refresh,
    })
    ui.applySettings({ ...ENABLED_SETTINGS, promptDurationSeconds: 1 })
    ui.setSuggestions([suggestion()])
    const shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
    vi.advanceTimersByTime(1_000)
    expect(shadow?.querySelectorAll('.prompt')).toHaveLength(0)

    ui.setSuggestions([{ ...suggestion(), count: 7 }])
    vi.advanceTimersByTime(29_999)
    ui.setSuggestions([{ ...suggestion(), count: 8 }])
    expect(shadow?.querySelectorAll('.prompt')).toHaveLength(0)
    expect(refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledOnce()
    ui.setSuggestions([{ ...suggestion(), count: 8 }])
    expect(shadow?.querySelectorAll('.prompt')).toHaveLength(1)
    expect(shadow?.querySelector('.prompt-meta')?.textContent).toContain('8 次')
    ui.destroy()
  })
})

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
})

const ENABLED_SETTINGS = {
  enabled: true,
  promptDurationSeconds: 6,
  promptScalePercent: 100,
  queueLimit: 3,
  threshold: 5,
} as const

describe('repeat reminder UI', () => {
  it('shows onboarding on the first triggered queue and persists acknowledgement', async () => {
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
    }
    let ui = createRepeatReminderUi(options)
    try {
      ui.applySettings(ENABLED_SETTINGS)
      ui.setSuggestions([suggestion()])
      let shadow = document.querySelector('[data-bcp-repeat-reminder-owned]')?.shadowRoot
      await vi.waitFor(() => {
        expect(shadow?.querySelector('.onboarding')?.classList.contains('is-visible')).toBe(true)
      })
      expect(shadow?.querySelector('.onboarding-card')?.getAttribute('aria-modal')).toBe('true')
      expect(shadow?.querySelector('.onboarding-card')?.textContent).toContain('只提醒，不自动发送')
      expect(shadow?.querySelector('.onboarding-card')?.textContent).toContain('触发次数')
      expect(shadow?.querySelector('.onboarding-card')?.textContent).toContain('提示停留时间')
      expect(shadow?.querySelector('.prompt-list')?.classList.contains('is-visible')).toBe(false)

      shadow?.querySelector<HTMLButtonElement>('.onboarding-acknowledge')?.click()
      expect(onboardingStorage.acknowledge).toHaveBeenCalledOnce()
      expect(shadow?.querySelector('.onboarding')?.classList.contains('is-visible')).toBe(false)
      expect(shadow?.querySelector('.prompt-list')?.classList.contains('is-visible')).toBe(true)

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
})

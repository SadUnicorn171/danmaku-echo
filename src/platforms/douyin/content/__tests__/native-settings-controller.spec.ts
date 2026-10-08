import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergeSettings } from '../../../../core/shared'
import { createDouyinNativeSettingsController } from '../native-settings-controller'

const switchHtml = (on: boolean) =>
  `<div class="_h3OuAw5 ${on ? 'G9q7tTop' : ''} hkTSP43k"><div class="FCG9Aotc ${on ? 'frP5WL3d' : ''}"></div></div>`
const rows =
  () => `<div class="TEzZfDTB"><span class="sAuC1nF6">送礼信息</span><div>${switchHtml(true)}</div></div>
  <div class="TEzZfDTB"><span class="sAuC1nF6">福袋口令</span><div>${switchHtml(true)}</div></div>
  <div data-e2e="danmaku-switch">${switchHtml(true)}</div>`
function fixture() {
  return `<section><div data-e2e="danmaku-setting-icon"></div><div class="panel">${rows()}</div></section>
    <section><div data-e2e="gift-setting"></div><div data-e2e="effect-switch">${switchHtml(false)}</div>
    <div data-e2e="gift-audio-switch">${switchHtml(true)}</div><div data-e2e="gift-shortcut-key-switch">${switchHtml(true)}</div></section>`
}
function installClicks(root: ParentNode = document, mutate = true) {
  const clicks = vi.fn<(event: Event) => void>((event) => {
    if (!mutate) return
    const control = event.currentTarget as HTMLElement
    const on = control.classList.toggle('G9q7tTop')
    control.firstElementChild!.classList.toggle('frP5WL3d', on)
  })
  root
    .querySelectorAll<HTMLElement>('._h3OuAw5')
    .forEach((control) => control.addEventListener('click', clicks))
  return clicks
}
const enabled = { hideGiftMessages: true, hideLuckyBagCommands: true, blockGiftEffects: true }
const controllers: ReturnType<typeof createDouyinNativeSettingsController>[] = []
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
function harness(initial = mergeSettings({ douyinNativeSettings: enabled })) {
  let settings = initial
  let href = 'https://live.douyin.com/100'
  const onUnavailable = vi.fn<(key: string) => void>()
  const controller = createDouyinNativeSettingsController({
    document,
    settings: () => settings,
    href: () => href,
    onUnavailable,
  })
  controllers.push(controller)
  return {
    controller,
    onUnavailable,
    settings(value: unknown) {
      settings = mergeSettings(value)
      controller.applySettings()
    },
    route(url: string) {
      href = url
      controller.routeChanged()
    },
  }
}
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.destroy())
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('Douyin native viewing settings', () => {
  it('normalizes old settings and only enables explicitly selected new preferences', () => {
    expect(mergeSettings().douyinNativeSettings).toEqual({
      hideGiftMessages: false,
      hideLuckyBagCommands: false,
      blockGiftEffects: false,
    })
    expect(
      mergeSettings({ douyinNativeSettings: { hideGiftMessages: 'true', blockGiftEffects: true } })
        .douyinNativeSettings,
    ).toEqual({ hideGiftMessages: false, hideLuckyBagCommands: false, blockGiftEffects: true })
  })
  it('turns off gift messages and lucky-bag commands, enables effect blocking and leaves unrelated switches alone', async () => {
    document.body.innerHTML = fixture()
    const clicks = installClicks()
    const { controller } = harness()
    controller.start()
    controller.start()
    await flush()
    expect(clicks).toHaveBeenCalledTimes(3)
    expect(
      [...document.querySelectorAll('._h3OuAw5')].map((control) =>
        control.classList.contains('G9q7tTop'),
      ),
    ).toEqual([false, false, true, true, true, true])
    controller.applySettings()
    await flush()
    expect(clicks).toHaveBeenCalledTimes(3)
  })
  it('does not toggle an already matching native state or change anything by default', async () => {
    document.body.innerHTML = fixture()
    const clicks = installClicks()
    const h = harness(mergeSettings())
    h.controller.start()
    await flush()
    expect(clicks).not.toHaveBeenCalled()
    h.settings({ douyinNativeSettings: { blockGiftEffects: true } })
    await flush()
    expect(clicks).toHaveBeenCalledTimes(1)
    h.controller.destroy()
    h.controller.start()
    await flush()
    expect(clicks).toHaveBeenCalledTimes(1)
  })
  it('handles lazily mounted panels and closes only its temporary hover', async () => {
    document.body.innerHTML = '<section><div data-e2e="danmaku-setting-icon"></div></section>'
    const anchor = document.querySelector<HTMLElement>('[data-e2e]')!
    // jsdom treats synthetic mouseover as a real :hover; browsers do not.
    vi.spyOn(anchor.parentElement!, 'matches').mockReturnValue(false)
    const leave = vi.fn<() => void>()
    anchor.addEventListener('mouseleave', leave)
    let clicks: ReturnType<typeof installClicks>
    anchor.addEventListener(
      'mouseover',
      () => {
        queueMicrotask(() => {
          anchor.insertAdjacentHTML('afterend', rows())
          clicks = installClicks()
        })
      },
      { once: true },
    )
    harness(
      mergeSettings({
        douyinNativeSettings: { hideGiftMessages: true, hideLuckyBagCommands: true },
      }),
    ).controller.start()
    await flush()
    expect(clicks!).toHaveBeenCalledTimes(2)
    expect(leave).toHaveBeenCalledOnce()
  })
  it('finds replaced controls, supports SPA live routes and stops after leaving the live route', async () => {
    const h = harness()
    h.route('https://www.douyin.com/')
    h.controller.start()
    document.body.innerHTML = fixture()
    let clicks = installClicks()
    await flush()
    expect(clicks).not.toHaveBeenCalled()
    h.route('https://www.douyin.com/follow/live/100')
    await flush()
    expect(clicks).toHaveBeenCalledTimes(3)
    document.body.innerHTML = fixture()
    clicks = installClicks()
    await flush()
    expect(clicks).toHaveBeenCalledTimes(3)
    h.route('https://www.douyin.com/')
    document.body.innerHTML = fixture()
    clicks = installClicks()
    await flush()
    expect(clicks).not.toHaveBeenCalled()
  })
  it.each(['preference', 'global', 'platform', 'destroy'])(
    'cancels pending work on %s disable',
    async (mode) => {
      document.body.innerHTML = fixture()
      const clicks = installClicks()
      const h = harness()
      h.controller.start()
      if (mode === 'destroy') h.controller.destroy()
      else
        h.settings({
          douyinNativeSettings: mode === 'preference' ? {} : enabled,
          enabled: mode !== 'global',
          platforms: { douyin: mode !== 'platform' },
        })
      await flush()
      expect(clicks).not.toHaveBeenCalled()
    },
  )
  it('does not guess unknown or disabled states and never repeatedly clicks an unresponsive switch', async () => {
    document.body.innerHTML = fixture()
    const switches = document.querySelectorAll<HTMLElement>('._h3OuAw5')
    switches[0]!.firstElementChild!.classList.remove('frP5WL3d')
    switches[1]!.setAttribute('aria-disabled', 'true')
    const clicks = installClicks(document, false)
    const h = harness()
    h.controller.start()
    await flush()
    expect(clicks).toHaveBeenCalledTimes(1)
    switches[3]!.setAttribute('aria-checked', 'false')
    await flush()
    expect(clicks).toHaveBeenCalledTimes(1)
    expect(h.onUnavailable).toHaveBeenCalledTimes(3)
  })
  it('releases a never-mounted temporary panel and its deadline on destruction', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    document.body.innerHTML = '<section><div data-e2e="gift-setting"></div></section>'
    const h = harness()
    h.controller.start()
    await flush()
    expect(vi.getTimerCount()).toBe(1)
    h.controller.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createUiAnimator,
  mountUiMotion,
  setPerformanceMode,
  subscribeUiMotion,
  uiMotionAllowed,
} from '../ui-motion'
import { mergeSettings } from '../shared'
import { applySettingsPatch } from '../settings-persistence'

let cleanup: (() => void)[] = []
let media: EventTarget & { matches: boolean }
let storageChanged: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void
let read: (value: Record<string, unknown>) => void
const remove = vi.fn<() => void>()
beforeEach(() => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  media = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal('matchMedia', () => media)
  vi.stubGlobal('chrome', {
    storage: {
      sync: {
        get: (_keys: string[], callback: typeof read) => {
          read = callback
        },
      },
      onChanged: {
        addListener: (callback: typeof storageChanged) => {
          storageChanged = callback
        },
        removeListener: remove,
      },
    },
  })
  setPerformanceMode(false)
})
afterEach(() => {
  cleanup.reverse().forEach((fn) => fn())
  cleanup = []
  setPerformanceMode(false)
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  remove.mockClear()
})

describe('UI motion policy', () => {
  it('defaults legacy settings to normal mode and validates persisted patches', () => {
    expect(mergeSettings({}).performanceMode).toBe(false)
    expect(mergeSettings({ performanceMode: 'true' }).performanceMode).toBe(false)
    expect(
      applySettingsPatch({}, [{ path: ['performanceMode'], value: true }]).performanceMode,
    ).toBe(true)
    expect(() => applySettingsPatch({}, [{ path: ['performanceMode'], value: 1 }])).toThrow(
      'invalid-settings-patch',
    )
  })
  it('applies sync changes immediately without allowing a stale initial read to undo them', () => {
    const root = document.createElement('div')
    root.attachShadow({ mode: 'open' })
    document.body.append(root)
    cleanup.push(mountUiMotion(root))
    storageChanged({ performanceMode: { newValue: true } }, 'sync')
    read({ performanceMode: false })
    expect(root.dataset.bcpMotion).toBe('off')
    expect(uiMotionAllowed()).toBe(false)
    storageChanged({ performanceMode: { newValue: false } }, 'local')
    expect(uiMotionAllowed()).toBe(false)
    storageChanged({ performanceMode: { newValue: false } }, 'sync')
    expect(root.dataset.bcpMotion).toBe('on')
    media.matches = true
    media.dispatchEvent(new Event('change'))
    expect(root.dataset.bcpMotion).toBe('off')
    setPerformanceMode(false)
    expect(root.dataset.bcpMotion).toBe('off')
  })
  it('cancels active JS animation and bypasses new animation work in performance mode', async () => {
    const animator = createUiAnimator()
    cleanup.push(() => animator.destroy())
    const element = document.createElement('div')
    let reject!: (error: Error) => void
    const cancel = vi.fn<() => void>(() => reject(new Error('cancelled')))
    element.animate = vi.fn<() => Animation>(
      () =>
        ({
          finished: new Promise<void>((_resolve, no) => {
            reject = no
          }),
          cancel,
        }) as unknown as Animation,
    )
    animator.play(element, [{ opacity: 0 }, { opacity: 1 }], 200)
    setPerformanceMode(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(animator.play(element, [{ opacity: 1 }], 200)).toBeNull()
    expect(element.animate).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    setPerformanceMode(false)
    expect(uiMotionAllowed()).toBe(true)
  })
  it('falls back without animation and still cleans up after extension invalidation', () => {
    const animator = createUiAnimator()
    const element = document.createElement('div')
    element.animate = vi.fn<() => Animation>(() => {
      throw new Error('unavailable')
    })
    expect(animator.play(element, [{ opacity: 1 }], 200)).toBeNull()
    remove.mockImplementationOnce(() => {
      throw new Error('Extension context invalidated')
    })
    animator.destroy()
    expect(document.documentElement.hasAttribute('data-bcp-ui-motion')).toBe(false)
  })
  it('stops loops while hidden and detaches shared listeners after the last consumer', () => {
    const listener = vi.fn<(allowed: boolean) => void>()
    const off1 = subscribeUiMotion(listener)
    const off2 = subscribeUiMotion(vi.fn<(allowed: boolean) => void>())
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(listener).toHaveBeenLastCalledWith(false)
    off1()
    expect(remove).not.toHaveBeenCalled()
    off2()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(document.documentElement.hasAttribute('data-bcp-ui-motion')).toBe(false)
  })
})

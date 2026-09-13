import { describe, expect, it } from 'vitest'
import { resolveInterfaceScalePercent, screenResolution } from '../interface-scale'
import { mergeSettings } from '../shared'

const auto = { mode: 'auto', capsulePercent: 100 } as const
const reference = { width: 3860, height: 2160, pixelRatio: 1 }

describe('automatic interface sizing', () => {
  it('preserves the configured size on the reference display including HiDPI', () => {
    expect(resolveInterfaceScalePercent(100, auto, reference)).toBe(100)
    expect(resolveInterfaceScalePercent(125, auto, reference)).toBe(125)
    expect(
      resolveInterfaceScalePercent(100, auto, { width: 1930, height: 1080, pixelRatio: 2 }),
    ).toBe(100)
  })

  it.each([
    [1930, 1080, 50],
    [2573, 1440, 67],
    [7720, 4320, 200],
    [7720, 2160, 100],
  ])('scales to %i x %i with a result of %i percent', (width, height, expected) => {
    expect(resolveInterfaceScalePercent(100, auto, { width, height, pixelRatio: 1 })).toBe(expected)
  })

  it('bounds effective size and handles unavailable screen information', () => {
    expect(resolveInterfaceScalePercent(50, auto, { width: 320, height: 240, pixelRatio: 1 })).toBe(
      50,
    )
    expect(
      resolveInterfaceScalePercent(200, auto, { width: 7720, height: 4320, pixelRatio: 1 }),
    ).toBe(200)
    for (const invalid of [0, -1, NaN, Infinity]) {
      expect(resolveInterfaceScalePercent(125, auto, { ...reference, width: invalid })).toBe(125)
      expect(resolveInterfaceScalePercent(125, auto, { ...reference, pixelRatio: invalid })).toBe(
        125,
      )
    }
  })

  it('keeps existing users in manual mode and preserves percentages across mode changes', () => {
    const settings = mergeSettings({ interfaceScale: { capsulePercent: 130 } })
    expect(settings.interfaceScale).toEqual({ capsulePercent: 130, mode: 'manual' })
    expect(
      resolveInterfaceScalePercent(130, settings.interfaceScale, {
        width: 1930,
        height: 1080,
        pixelRatio: 1,
      }),
    ).toBe(130)
    const changed = mergeSettings({
      ...settings,
      interfaceScale: { ...settings.interfaceScale, mode: 'auto' },
    })
    expect(changed.interfaceScale.capsulePercent).toBe(130)
    expect(mergeSettings(changed).interfaceScale.mode).toBe('auto')
    expect(mergeSettings({ interfaceScale: { mode: 'unknown' } }).interfaceScale.mode).toBe(
      'manual',
    )
  })

  it('reads screen size instead of the size of the browser viewport', () => {
    expect(
      screenResolution({
        screen: { width: 1930, height: 1080 },
        devicePixelRatio: 2,
        innerWidth: 600,
      } as Window),
    ).toEqual({ width: 1930, height: 1080, pixelRatio: 2 })
  })
})

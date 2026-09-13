import type { InterfaceScaleSettings } from './types'
import { normalizeCapsuleScalePercent } from './repeat-reminder-settings'

export const REFERENCE_SCREEN_WIDTH = 3860
export const REFERENCE_SCREEN_HEIGHT = 2160

export interface ScreenResolution {
  width: number
  height: number
  pixelRatio: number
}

export function screenResolution(target: Window): ScreenResolution {
  return {
    width: target.screen.width,
    height: target.screen.height,
    pixelRatio: target.devicePixelRatio,
  }
}

export function resolveInterfaceScalePercent(
  basePercent: number,
  settings: InterfaceScaleSettings,
  resolution: ScreenResolution,
): number {
  const base = normalizeCapsuleScalePercent(basePercent)
  if (settings.mode !== 'auto') return base
  const { width, height, pixelRatio } = resolution
  if (![width, height, pixelRatio].every((value) => Number.isFinite(value) && value > 0))
    return base
  // Screen dimensions are CSS pixels; the pixel ratio estimates display pixels.
  // Use the limiting dimension so ultrawide screens do not over-enlarge controls.
  const ratio = Math.min(
    (width * pixelRatio) / REFERENCE_SCREEN_WIDTH,
    (height * pixelRatio) / REFERENCE_SCREEN_HEIGHT,
  )
  return normalizeCapsuleScalePercent(base * ratio)
}

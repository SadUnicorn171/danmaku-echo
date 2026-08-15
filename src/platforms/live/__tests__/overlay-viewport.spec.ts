import { describe, expect, it } from 'vitest'

import {
  clampBoxStart,
  clipInsetsWithinRect,
  intersectRectBounds,
  pointInsideRect,
} from '../overlay-viewport'

function rect(left: number, top: number, right: number, bottom: number) {
  return { bottom, left, right, top }
}

describe('live overlay viewport geometry', () => {
  it('intersects a moving danmaku surface with the visible player', () => {
    const viewport = intersectRectBounds([
      rect(0, 0, 1440, 900),
      rect(20, 80, 1040, 660),
      rect(20, 80, 1000, 660),
    ])

    expect(viewport).toEqual({
      bottom: 660,
      height: 580,
      left: 20,
      right: 1000,
      top: 80,
      width: 980,
    })
    expect(pointInsideRect(viewport, 999, 300)).toBe(true)
    expect(pointInsideRect(viewport, 1120, 300)).toBe(false)
  })

  it('clips a frozen danmaku clone at the player right edge', () => {
    expect(
      clipInsetsWithinRect(rect(900, 120, 1120, 160), rect(20, 80, 1000, 660)),
    ).toEqual({ bottom: 0, left: 0, right: 120, top: 0 })
  })

  it('keeps the action capsule inside the player instead of the side column', () => {
    expect(clampBoxStart(1030, 180, 20, 1000, 8)).toBe(812)
    expect(clampBoxStart(500, 180, 20, 1000, 8)).toBe(500)
  })
})

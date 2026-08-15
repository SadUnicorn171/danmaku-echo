import { describe, expect, it } from 'vitest'
import { overlayCapsulePlacement } from '../capsule-position'

describe('overlayCapsulePlacement', () => {
  it('keeps the capsule on the left while the danmaku is still entering', () => {
    expect(
      overlayCapsulePlacement({
        anchorLeft: 700,
        anchorRight: 1_040,
        capsuleWidth: 172,
        viewportLeft: 0,
        viewportRight: 1_000,
      }),
    ).toEqual({ fullyEntered: false, left: 520, side: 'left' })
  })

  it('keeps the capsule on the left when the danmaku has entered but right space is insufficient', () => {
    expect(
      overlayCapsulePlacement({
        anchorLeft: 650,
        anchorRight: 900,
        capsuleWidth: 172,
        viewportLeft: 0,
        viewportRight: 1_000,
      }),
    ).toEqual({ fullyEntered: true, left: 470, side: 'left' })
  })

  it('uses the right only after the danmaku is fully visible and the capsule fits', () => {
    expect(
      overlayCapsulePlacement({
        anchorLeft: 500,
        anchorRight: 760,
        capsuleWidth: 172,
        viewportLeft: 0,
        viewportRight: 1_000,
      }),
    ).toEqual({ fullyEntered: true, left: 768, side: 'right' })
  })

  it('keeps the capsule clear of the text when neither side can contain it', () => {
    expect(
      overlayCapsulePlacement({
        anchorLeft: 60,
        anchorRight: 990,
        capsuleWidth: 172,
        viewportLeft: 20,
        viewportRight: 1_000,
      }),
    ).toEqual({ fullyEntered: true, left: -120, side: 'left' })
  })
})

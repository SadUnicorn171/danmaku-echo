import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DOUYU_OVERLAY_MOTION_PAUSED_ATTRIBUTE,
  DouyuOverlayMotionController,
} from '../overlay-motion'

afterEach(() => {
  document.body.replaceChildren()
})

function animationWithState(playState: AnimationPlayState, pending = false): Animation {
  return {
    pause: vi.fn<() => void>(),
    pending,
    play: vi.fn<() => void>(),
    playState,
  } as unknown as Animation
}

describe('DouyuOverlayMotionController', () => {
  it('pauses the renderer Web Animation and resumes a previously running timeline', () => {
    const candidate = document.createElement('div')
    const animation = animationWithState('running')
    candidate.getAnimations = vi.fn<() => Animation[]>(() => [animation])
    document.body.append(candidate)

    const controller = new DouyuOverlayMotionController()
    controller.pause(candidate)

    expect(animation.pause).toHaveBeenCalledOnce()
    expect(candidate.getAttribute(DOUYU_OVERLAY_MOTION_PAUSED_ATTRIBUTE)).toBe('true')

    controller.release(candidate)

    expect(animation.play).toHaveBeenCalledOnce()
    expect(candidate.hasAttribute(DOUYU_OVERLAY_MOTION_PAUSED_ATTRIBUTE)).toBe(false)
  })

  it('does not resume a timeline that Douyu had already paused', () => {
    const candidate = document.createElement('div')
    const animation = animationWithState('paused')
    candidate.getAnimations = vi.fn<() => Animation[]>(() => [animation])
    document.body.append(candidate)

    const controller = new DouyuOverlayMotionController()
    controller.pause(candidate)
    controller.release(candidate)

    expect(animation.pause).not.toHaveBeenCalled()
    expect(animation.play).not.toHaveBeenCalled()
  })
})

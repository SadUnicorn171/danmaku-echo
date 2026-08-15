import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BILIBILI_OVERLAY_MOTION_PAUSED_ATTRIBUTE,
  BilibiliOverlayMotionController,
} from '../overlay-motion'

afterEach(() => {
  document.body.replaceChildren()
})

describe('BilibiliOverlayMotionController', () => {
  it('pauses and releases the CSS timeline without touching Web Animations', () => {
    const candidate = document.createElement('div')
    const getAnimations = vi.fn<() => Animation[]>(() => [])
    const controller = new BilibiliOverlayMotionController()
    candidate.className = 'bili-danmaku-x-dm'
    candidate.getAnimations = getAnimations
    document.body.append(candidate)

    controller.pause(candidate)

    expect(candidate.getAttribute(BILIBILI_OVERLAY_MOTION_PAUSED_ATTRIBUTE)).toBe('true')
    expect(getAnimations).not.toHaveBeenCalled()

    controller.release(candidate)
    expect(candidate.hasAttribute(BILIBILI_OVERLAY_MOTION_PAUSED_ATTRIBUTE)).toBe(false)
    expect(getAnimations).not.toHaveBeenCalled()
  })

  it('releases an earlier row before pausing a replacement row', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    const controller = new BilibiliOverlayMotionController()

    controller.pause(first)
    controller.pause(second)

    expect(first.hasAttribute(BILIBILI_OVERLAY_MOTION_PAUSED_ATTRIBUTE)).toBe(false)
    expect(second.getAttribute(BILIBILI_OVERLAY_MOTION_PAUSED_ATTRIBUTE)).toBe('true')

    controller.release()
    expect(second.hasAttribute(BILIBILI_OVERLAY_MOTION_PAUSED_ATTRIBUTE)).toBe(false)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DouyuNativeMotionFallback } from '../native-motion-fallback'

afterEach(() => {
  document.body.replaceChildren()
})

function animationWithState(
  target: HTMLElement,
  playState: AnimationPlayState,
  pending = false,
): Animation {
  return {
    effect: { target },
    pause: vi.fn<() => void>(),
    pending,
    play: vi.fn<() => void>(),
    playState,
  } as unknown as Animation
}

describe('DouyuNativeMotionFallback', () => {
  it('repairs a paused orphan only after native leave had a chance to resume it', async () => {
    const candidate = document.createElement('div')
    const animation = animationWithState(candidate, 'running')
    candidate.getAnimations = vi.fn<() => Animation[]>(() => [animation])
    document.body.append(candidate)

    const fallback = new DouyuNativeMotionFallback()
    fallback.pause(candidate)
    Object.assign(animation, { playState: 'paused' })
    fallback.release(candidate)
    expect(animation.play).not.toHaveBeenCalled()
    await Promise.resolve()

    expect(candidate.getAnimations).toHaveBeenCalledTimes(2)
    expect(animation.pause).toHaveBeenCalledOnce()
    expect(animation.play).toHaveBeenCalledOnce()
  })

  it('does not replay an animation that native leave already resumed', async () => {
    const candidate = document.createElement('div')
    const animation = animationWithState(candidate, 'running')
    candidate.getAnimations = vi.fn<() => Animation[]>(() => [animation])
    document.body.append(candidate)

    const fallback = new DouyuNativeMotionFallback()
    fallback.pause(candidate)
    Object.assign(animation, { playState: 'running' })
    fallback.release(candidate)
    await Promise.resolve()

    expect(animation.pause).toHaveBeenCalledOnce()
    expect(animation.play).not.toHaveBeenCalled()
  })

  it('does not replay an animation replaced or recycled before release', async () => {
    const candidate = document.createElement('div')
    candidate.dataset.commentUuid = 'first-message'
    const first = animationWithState(candidate, 'running')
    const replacement = animationWithState(candidate, 'running')
    candidate.getAnimations = vi
      .fn<() => Animation[]>()
      .mockReturnValueOnce([first])
      .mockReturnValueOnce([replacement])
    document.body.append(candidate)

    const fallback = new DouyuNativeMotionFallback()
    fallback.pause(candidate)
    fallback.release(candidate)
    candidate.dataset.commentUuid = 'recycled-message'
    await Promise.resolve()

    expect(first.pause).toHaveBeenCalledOnce()
    expect(first.play).not.toHaveBeenCalled()
    expect(replacement.play).not.toHaveBeenCalled()
  })

  it('releases every rapidly switched danmaku instead of leaving a frozen trail', async () => {
    const firstCandidate = document.createElement('div')
    const secondCandidate = document.createElement('div')
    firstCandidate.dataset.commentUuid = 'first-message'
    secondCandidate.dataset.commentUuid = 'second-message'
    const first = animationWithState(firstCandidate, 'running')
    const second = animationWithState(secondCandidate, 'running')
    firstCandidate.getAnimations = vi.fn<() => Animation[]>(() => [first])
    secondCandidate.getAnimations = vi.fn<() => Animation[]>(() => [second])
    document.body.append(firstCandidate, secondCandidate)

    const fallback = new DouyuNativeMotionFallback()
    fallback.pause(firstCandidate)
    Object.assign(first, { playState: 'paused' })
    fallback.release(firstCandidate)
    fallback.pause(secondCandidate)
    Object.assign(second, { playState: 'paused' })
    fallback.release(secondCandidate)
    await Promise.resolve()

    expect(first.play).toHaveBeenCalledOnce()
    expect(second.play).toHaveBeenCalledOnce()
  })

  it('never pauses an ancestor or shared group animation', () => {
    const group = document.createElement('div')
    const candidate = document.createElement('div')
    const animation = animationWithState(group, 'running')
    candidate.getAnimations = vi.fn<() => Animation[]>(() => [animation])
    group.append(candidate)
    document.body.append(group)

    const fallback = new DouyuNativeMotionFallback()
    fallback.pause(candidate)

    expect(animation.pause).not.toHaveBeenCalled()
  })
})

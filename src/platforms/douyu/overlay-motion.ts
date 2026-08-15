export const DOUYU_OVERLAY_MOTION_PAUSED_ATTRIBUTE = 'data-bcp-douyu-motion-paused'

interface TrackedAnimation {
  animation: Animation
  shouldResume: boolean
}

/**
 * Douyu moves every scrolling danmaku with a Web Animation. The transform is
 * visible in computed styles but not in the element's inline style, so
 * position sampling and CSS transition controls cannot stop it reliably.
 *
 * Pause the renderer-owned Animation object without rewriting currentTime,
 * startTime or transform. Animations that were already paused by Douyu stay
 * under Douyu's ownership; only animations running when the extension first
 * observes them are resumed by release().
 */
export class DouyuOverlayMotionController {
  private candidate: HTMLElement | null = null
  private readonly animations = new Map<Animation, TrackedAnimation>()

  private captureAndPause(): void {
    const candidate = this.candidate
    if (!candidate || !candidate.isConnected || typeof candidate.getAnimations !== 'function') {
      return
    }

    for (const animation of candidate.getAnimations({ subtree: true })) {
      if (!this.animations.has(animation)) {
        this.animations.set(animation, {
          animation,
          shouldResume: animation.playState === 'running' || animation.pending,
        })
      }
      try {
        if (animation.playState === 'running' || animation.pending) animation.pause()
      } catch {
        // Douyu may recycle the danmaku between discovery and pausing.
      }
    }
  }

  pause(candidate: HTMLElement): void {
    if (this.candidate && this.candidate !== candidate) this.release()
    this.candidate = candidate
    candidate.setAttribute(DOUYU_OVERLAY_MOTION_PAUSED_ATTRIBUTE, 'true')
    this.captureAndPause()
  }

  hold(candidate: HTMLElement | null = this.candidate): void {
    if (!candidate || candidate !== this.candidate) return
    this.captureAndPause()
  }

  release(candidate: HTMLElement | null = null): void {
    if (candidate && candidate !== this.candidate) return
    this.candidate?.removeAttribute(DOUYU_OVERLAY_MOTION_PAUSED_ATTRIBUTE)
    for (const { animation, shouldResume } of this.animations.values()) {
      if (!shouldResume) continue
      try {
        animation.play()
      } catch {
        // Ignore animations removed by Douyu's recycled renderer.
      }
    }
    this.animations.clear()
    this.candidate = null
  }
}

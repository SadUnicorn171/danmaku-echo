interface TrackedAnimation {
  animation: Animation
  shouldResume: boolean
}

interface CandidateMotion {
  animations: Map<Animation, TrackedAnimation>
  identity: string
}

const IDENTITY_ATTRIBUTES = [
  'data-comment-uuid',
  'data-danmaku-id',
  'data-dm-id',
  'data-id',
  'data-id-str',
] as const

function candidateIdentity(candidate: HTMLElement): string {
  for (const attribute of IDENTITY_ATTRIBUTES) {
    const value = candidate.getAttribute(attribute)
    if (value) return `${attribute}:${value}`
  }

  const content = candidate.querySelector("[class*='textWrap-']")
  const image = candidate.querySelector('img')
  const text = String(content?.textContent || '').trim()
  const imageIdentity = String(
    image?.getAttribute('rel') || image?.getAttribute('src') || image?.getAttribute('alt') || '',
  ).trim()
  return text || imageIdentity ? `content:${text}|${imageIdentity}` : ''
}

function animationTarget(animation: Animation): unknown {
  const effect = animation.effect
  return effect && 'target' in effect ? effect.target : null
}

/**
 * Pauses only the Web Animations attached directly to Douyu's moving row.
 * Native leave gets the first opportunity to resume. A delayed fallback then
 * resumes only an animation that is still paused, still targets this exact row,
 * is still returned by this row, and still belongs to the same danmaku.
 */
export class DouyuNativeMotionFallback {
  private candidate: HTMLElement | null = null
  private readonly motions = new WeakMap<HTMLElement, CandidateMotion>()

  private currentAnimations(candidate: HTMLElement): Animation[] {
    if (!candidate.isConnected || typeof candidate.getAnimations !== 'function') return []

    try {
      // Do not include descendants: native capsule decorations can have their
      // own animations and must never be captured by the motion fallback.
      return candidate.getAnimations()
    } catch {
      return []
    }
  }

  private pauseCurrent(candidate: HTMLElement): void {
    let motion = this.motions.get(candidate)
    if (!motion) {
      motion = {
        animations: new Map(),
        identity: candidateIdentity(candidate),
      }
      this.motions.set(candidate, motion)
    }

    for (const animation of this.currentAnimations(candidate)) {
      // Some renderer implementations expose an ancestor/group animation
      // through a descendant. Pausing it would freeze a whole patch of rows.
      if (animationTarget(animation) !== candidate) continue
      if (!motion.animations.has(animation)) {
        motion.animations.set(animation, {
          animation,
          shouldResume: animation.playState === 'running' || animation.pending,
        })
      }
      try {
        if (animation.playState === 'running' || animation.pending) animation.pause()
      } catch {
        // Douyu may recycle the row between discovery and this call.
      }
    }
  }

  pause(candidate: HTMLElement): void {
    this.candidate = candidate
    this.pauseCurrent(candidate)
  }

  hold(candidate: HTMLElement | null = this.candidate): void {
    if (!candidate || candidate !== this.candidate) return
    this.pauseCurrent(candidate)
  }

  release(candidate: HTMLElement | null = null): void {
    const releasedCandidate = candidate || this.candidate
    if (!releasedCandidate) return
    if (this.candidate === releasedCandidate) this.candidate = null

    const motion = this.motions.get(releasedCandidate)
    if (!motion) return
    this.motions.delete(releasedCandidate)

    // Run after the real/synthesized native leave event has had a chance to
    // resume the animation. Usually every animation is already running and
    // this becomes a no-op. It only repairs a manually paused orphan.
    queueMicrotask(() => {
      if (!releasedCandidate.isConnected) return
      if (motion.identity && candidateIdentity(releasedCandidate) !== motion.identity) return

      const current = new Set(this.currentAnimations(releasedCandidate))
      for (const { animation, shouldResume } of motion.animations.values()) {
        if (
          !shouldResume ||
          animation.playState !== 'paused' ||
          !current.has(animation) ||
          animationTarget(animation) !== releasedCandidate
        ) {
          continue
        }
        try {
          animation.play()
        } catch {
          // The renderer can discard an animation during the release check.
        }
      }
    })
  }
}

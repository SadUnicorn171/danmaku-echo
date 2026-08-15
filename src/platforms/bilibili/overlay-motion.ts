export const BILIBILI_OVERLAY_MOTION_PAUSED_ATTRIBUTE =
  'data-bcp-bilibili-motion-paused'

/**
 * Bilibili moves live danmaku with a CSS `roll` animation, but current player
 * builds do not consistently expose that animation through getAnimations().
 * Keep the platform timeline intact and pause it through CSS instead of
 * calling Animation.pause()/play() on a sometimes incomplete animation list.
 */
export class BilibiliOverlayMotionController {
  private candidate: HTMLElement | null = null

  pause(candidate: HTMLElement): void {
    if (this.candidate && this.candidate !== candidate) {
      this.candidate.removeAttribute(BILIBILI_OVERLAY_MOTION_PAUSED_ATTRIBUTE)
    }

    candidate.setAttribute(BILIBILI_OVERLAY_MOTION_PAUSED_ATTRIBUTE, 'true')
    this.candidate = candidate
  }

  release(candidate: HTMLElement | null = this.candidate): void {
    candidate?.removeAttribute(BILIBILI_OVERLAY_MOTION_PAUSED_ATTRIBUTE)
    if (!candidate || candidate === this.candidate) {
      this.candidate = null
    }
  }
}

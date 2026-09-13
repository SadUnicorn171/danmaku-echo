import { numberOr } from '../barrage-model'
import type {
  AnimationFrameMilliseconds,
  CssPixels,
  DevicePixels,
  Milliseconds,
  RendererInstance,
  RendererScale,
  RendererTrack as RuntimeRendererTrack,
  RendererTrackMotionState,
} from './runtime-types'

export interface CanvasRectLike {
  height: CssPixels
  left: CssPixels
  top: CssPixels
  width: CssPixels
}

export type RendererTrackInstance = Pick<RendererInstance, 'config'>

export interface MotionTrack
  extends Pick<
    RuntimeRendererTrack,
    'bookedChannel' | 'description' | 'motion' | 'options'
  > {
  instance: RendererTrackInstance
}

export interface AdvanceTrackMotionInput {
  canvasWidth: DevicePixels
  deltaTime: Milliseconds
  deviceScale: RendererScale
  minimumLeft: DevicePixels | null
  speed: number
}

export function initialTrackMotion(distance: CssPixels = 0): RendererTrackMotionState {
  return { distance: Math.max(0, numberOr(distance, 0)), paused: false }
}

export function pauseTrackMotion(
  state: RendererTrackMotionState,
): RendererTrackMotionState {
  return state.paused ? state : { ...state, paused: true }
}

export function resumeTrackMotion(
  state: RendererTrackMotionState,
): RendererTrackMotionState {
  return state.paused ? { ...state, paused: false } : state
}

export function frameDelta(
  previous: AnimationFrameMilliseconds | 0,
  current: AnimationFrameMilliseconds,
  initial: Milliseconds = 16,
  maximum: Milliseconds = 300_000,
): Milliseconds {
  const currentTime = numberOr(current, 0)
  const previousTime = numberOr(previous, 0)
  const raw = previousTime > 0 ? currentTime - previousTime : initial
  return Math.max(0, Math.min(numberOr(raw, initial), Math.max(0, maximum)))
}

export function advanceTrackMotion(
  state: RendererTrackMotionState,
  input: AdvanceTrackMotionInput,
): RendererTrackMotionState {
  if (state.paused) return state
  const deltaTime = Math.max(0, numberOr(input.deltaTime, 0))
  const speed = Math.max(0, numberOr(input.speed, 0))
  if (deltaTime === 0 || speed === 0) return state

  const currentDistance = Math.max(0, numberOr(state.distance, 0))
  const proposedDistance = currentDistance + deltaTime * speed
  if (deltaTime > 1_000 || !Number.isFinite(input.minimumLeft)) {
    return { distance: proposedDistance, paused: false }
  }

  const deviceScale = Math.max(0.000_001, numberOr(input.deviceScale, 1))
  const proposedLeft = numberOr(input.canvasWidth, 0) - proposedDistance * deviceScale
  if (proposedLeft >= Number(input.minimumLeft)) {
    return { distance: proposedDistance, paused: false }
  }

  const constrainedDistance =
    (numberOr(input.canvasWidth, 0) - Number(input.minimumLeft)) / deviceScale
  // A resized channel or an overlapping predecessor must never move a track
  // backwards. Holding the current distance is preferable to visible jitter.
  return {
    distance: Math.max(currentDistance, constrainedDistance),
    paused: false,
  }
}

export function modelDpr(instance: RendererTrackInstance): RendererScale {
  const devicePixelRatio = Math.max(0.25, numberOr(instance.config.devicePixelRatio, 1))
  const fontSize = Math.max(1, numberOr(instance.config.fontSize, 20))
  return devicePixelRatio * fontSize / 20
}

export function canvasPixelSize(
  instance: RendererTrackInstance,
  rect: CanvasRectLike,
): { height: DevicePixels; width: DevicePixels } {
  const devicePixelRatio = Math.max(0.25, numberOr(instance.config.devicePixelRatio, 1))
  return {
    height: Math.max(20, numberOr(instance.config.height, rect.height)) * devicePixelRatio,
    width: Math.max(20, numberOr(instance.config.width, rect.width)) * devicePixelRatio,
  }
}

export function trackDuration(track: MotionTrack): Milliseconds {
  return Math.max(
    1_000,
    numberOr(track.options.duration, numberOr(track.instance.config.duration, 15_000)),
  )
}

export function trackInternalWidth(track: MotionTrack): DevicePixels {
  return track.description.width * modelDpr(track.instance)
}

export function trackInternalHeight(track: MotionTrack): DevicePixels {
  return track.description.height * modelDpr(track.instance)
}

export function trackRightPosition(
  track: MotionTrack,
  rect: CanvasRectLike,
): DevicePixels {
  const pixels = canvasPixelSize(track.instance, rect)
  return (
    pixels.width - track.motion.distance * modelDpr(track.instance) + trackInternalWidth(track)
  )
}

export function trackIsExpired(track: MotionTrack, rect: CanvasRectLike): boolean {
  return trackRightPosition(track, rect) <= 0
}

export function trackRightEdgeVisible(track: MotionTrack, rect: CanvasRectLike): boolean {
  const pixels = canvasPixelSize(track.instance, rect)
  const gap = Math.max(0, numberOr(track.instance.config.gap, 100)) * modelDpr(track.instance)
  return trackRightPosition(track, rect) <= pixels.width - gap
}

export function trackSpeed(track: MotionTrack, rect: CanvasRectLike): number {
  const pixels = canvasPixelSize(track.instance, rect)
  return (
    (pixels.width + trackInternalWidth(track)) /
    trackDuration(track) /
    modelDpr(track.instance)
  )
}

export function trackRect(
  track: MotionTrack,
  canvasRect: CanvasRectLike,
): { height: CssPixels; left: CssPixels; top: CssPixels; width: CssPixels } | null {
  if (!track.bookedChannel) return null
  const pixels = canvasPixelSize(track.instance, canvasRect)
  const deviceScale = modelDpr(track.instance)
  const scaleX = canvasRect.width / pixels.width
  const scaleY = canvasRect.height / pixels.height
  const internalLeft = pixels.width - track.motion.distance * deviceScale
  const internalTop =
    track.bookedChannel.start *
      Math.max(1, numberOr(track.instance.config.channelHeight, 40)) *
      deviceScale +
    2
  return {
    height: trackInternalHeight(track) * scaleY,
    left: canvasRect.left + internalLeft * scaleX,
    top: canvasRect.top + internalTop * scaleY,
    width: trackInternalWidth(track) * scaleX,
  }
}

import { numberOr } from '../barrage-model'
import {
  advanceTrackMotion,
  canvasPixelSize,
  modelDpr,
  trackInternalHeight,
  trackIsExpired,
  trackRightEdgeVisible,
  trackRightPosition,
  trackSpeed,
  type CanvasRectLike,
  type MotionTrack,
  type RendererTrackInstance,
} from './track-motion'
import type {
  Milliseconds,
  RendererChannel,
  RendererFrameState,
  RendererTrack,
  RendererTrackId,
  TimestampMilliseconds,
} from './runtime-types'

export interface ChannelSchedulerState extends RendererTrackInstance {
  channels: RendererChannel[]
  frameState: RendererFrameState
  pending: RendererTrack[]
  tracks: Map<RendererTrackId, RendererTrack>
}

export interface ChannelAssignment {
  end: number
  pendingDelay: Milliseconds
  start: number
  track: RendererTrack
}

export interface ChannelAssignmentResult {
  assigned: ChannelAssignment[]
  dropped: RendererTrack[]
  requeued: RendererTrack[]
  remaining: number
  wasEmpty: boolean
}

export interface ChannelResizeResult {
  requeued: RendererTrack[]
}

export interface ChannelEnqueueResult {
  accepted: boolean
  wasEmpty: boolean
}

export interface DouyinChannelScheduler {
  advance(
    state: ChannelSchedulerState,
    rect: CanvasRectLike,
    deltaTime: Milliseconds,
  ): RendererTrack[]
  assign(
    state: ChannelSchedulerState,
    rect: CanvasRectLike,
    now: TimestampMilliseconds,
  ): ChannelAssignmentResult
  clear(state: ChannelSchedulerState): void
  enqueue(
    state: ChannelSchedulerState,
    track: RendererTrack,
    maxPending: number,
  ): ChannelEnqueueResult
  isEmpty(state: Pick<ChannelSchedulerState, 'channels'>): boolean
  releaseExpired(state: ChannelSchedulerState, rect: CanvasRectLike): RendererTrack[]
  synchronize(state: ChannelSchedulerState, rect: CanvasRectLike): ChannelResizeResult
}

export function channelInfo(
  instance: RendererTrackInstance,
  rect: CanvasRectLike,
): { maxCanUse: number; maxDisplay: number } {
  const pixels = canvasPixelSize(instance, rect)
  const channelHeight = Math.max(1, numberOr(instance.config.channelHeight, 40)) * modelDpr(instance)
  const allChannels = Math.max(1, Math.floor(pixels.height / channelHeight))
  const limits = [pixels.height / channelHeight]
  const maxHeightRate = numberOr(instance.config.maxHeightRate, 1)
  if (maxHeightRate * pixels.height) limits.push((maxHeightRate * pixels.height) / channelHeight)
  const configured = numberOr(instance.config.maxChannelCount, 0)
  if (configured > 0) limits.push(configured)
  return {
    maxCanUse: allChannels,
    maxDisplay: Math.max(1, Math.floor(Math.min(...limits)) || 1),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function specialRange(track: MotionTrack, maxDisplay: number): Record<string, unknown> | null {
  const range = asRecord(track.options.channelRange)
  if (
    !range ||
    numberOr(range.startIndex, -1) < 0 ||
    maxDisplay <= Math.max(1, Math.floor(numberOr(range.len, maxDisplay)))
  ) {
    return null
  }
  return range
}

export function realChannelRange(
  track: MotionTrack,
  maxDisplay: number,
  maxCanUse: number,
): { end: number; start: number } {
  const range = specialRange(track, maxDisplay)
  if (!range) return { end: Math.min(maxCanUse - 1, maxDisplay - 1), start: 0 }
  const start = Math.max(0, Math.floor(numberOr(range.startIndex, 0)))
  const length = Math.max(1, Math.floor(numberOr(range.len, maxDisplay)))
  return {
    end: Math.min(maxCanUse - 1, start + length - 1),
    start: Math.min(maxCanUse - 1, start),
  }
}

export function trackPriority(track: MotionTrack, maxDisplay: number): number {
  const base = numberOr(track.options.prior, 0)
  const range = specialRange(track, maxDisplay)
  return range ? base + numberOr(range.additionalPriority, 100) : base
}

export function trackNeedsReserve(
  track: MotionTrack,
  maxDisplay: number,
  now: TimestampMilliseconds,
): boolean {
  const range = specialRange(track, maxDisplay)
  const additional = range ? numberOr(range.additionalReserveDuration, 0) : 0
  const reserve = numberOr(track.options.reserveDuration, 0)
  const startTime = numberOr(track.options.startTime, now)
  return startTime + reserve + additional > now
}

function requiredChannelCount(track: MotionTrack): number {
  return Math.max(
    1,
    Math.ceil(
      trackInternalHeight(track) /
        (Math.max(1, numberOr(track.instance.config.channelHeight, 40)) * modelDpr(track.instance)),
    ),
  )
}

function messageKey(track: RendererTrack): string {
  return String(track.options.id || track.id)
}

function clearFrameReferences(frameState: RendererFrameState, trackId: RendererTrackId): void {
  frameState.previousIds.delete(trackId)
}

export function createDouyinChannelScheduler(): DouyinChannelScheduler {
  const resize = (
    state: ChannelSchedulerState,
    channelCount: number,
  ): ChannelResizeResult => {
    const count = Math.max(1, Math.floor(numberOr(channelCount, 1)))
    if (state.channels.length <= count) {
      while (state.channels.length < count) state.channels.push([])
      return { requeued: [] }
    }

    const affected = new Set<RendererTrack>()
    state.channels.slice(count).forEach((channel) => channel.forEach((track) => affected.add(track)))
    state.channels.length = count
    if (!affected.size) return { requeued: [] }

    state.channels = state.channels.map((channel) =>
      channel.filter((track) => !affected.has(track)),
    )
    const requeued: RendererTrack[] = []
    affected.forEach((track) => {
      track.bookedChannel = null
      clearFrameReferences(state.frameState, track.id)
      if (state.tracks.has(track.id) && !state.pending.includes(track)) {
        state.pending.push(track)
        requeued.push(track)
      }
    })
    return { requeued }
  }

  const releaseTracks = (
    state: ChannelSchedulerState,
    predicate: (track: RendererTrack) => boolean,
  ): RendererTrack[] => {
    const released = new Set<RendererTrack>()
    state.channels = state.channels.map((channel) =>
      channel.filter((track) => {
        if (!predicate(track)) return true
        released.add(track)
        return false
      }),
    )
    released.forEach((track) => {
      state.tracks.delete(track.id)
      clearFrameReferences(state.frameState, track.id)
    })
    return Array.from(released)
  }

  return {
    advance(state, rect, deltaTime) {
      const { frameState } = state
      frameState.speeds.clear()
      frameState.rightPositions.clear()
      frameState.moved.clear()
      frameState.previousIds.forEach((items) => {
        items.length = 0
      })

      state.channels.forEach((channel) => {
        let channelSpeed = Infinity
        channel.forEach((track, index) => {
          const barrageId = messageKey(track)
          const ownSpeed = trackSpeed(track, rect)
          channelSpeed = Math.min(
            channelSpeed,
            frameState.speeds.get(barrageId) || ownSpeed,
            ownSpeed,
          )
          frameState.speeds.set(barrageId, channelSpeed)
          frameState.rightPositions.set(barrageId, trackRightPosition(track, rect))
          if (!frameState.previousIds.has(track.id)) frameState.previousIds.set(track.id, [])
          if (index > 0) {
            frameState.previousIds.get(track.id)?.push(messageKey(channel[index - 1]))
          }
        })
      })

      const advanced: RendererTrack[] = []
      state.channels.forEach((channel, channelIndex) => {
        channel.forEach((track) => {
          if (
            frameState.moved.has(track.id) ||
            !track.bookedChannel ||
            track.bookedChannel.start !== channelIndex
          ) {
            return
          }
          frameState.moved.add(track.id)
          const barrageId = messageKey(track)
          const predecessors = frameState.previousIds.get(track.id) || []
          const gap = Math.max(0, numberOr(state.config.gap, 100)) * modelDpr(state)
          let predecessorRightEdge = -Infinity
          predecessors.forEach((id) => {
            predecessorRightEdge = Math.max(
              predecessorRightEdge,
              numberOr(frameState.rightPositions.get(id), -Infinity),
            )
          })
          if (Number.isFinite(predecessorRightEdge)) predecessorRightEdge += gap
          track.motion = advanceTrackMotion(track.motion, {
            canvasWidth: canvasPixelSize(state, rect).width,
            deltaTime,
            deviceScale: modelDpr(state),
            minimumLeft: Number.isFinite(predecessorRightEdge) ? predecessorRightEdge : null,
            speed: numberOr(frameState.speeds.get(barrageId), trackSpeed(track, rect)),
          })
          frameState.rightPositions.set(barrageId, trackRightPosition(track, rect))
          advanced.push(track)
        })
      })
      return advanced
    },
    assign(state, rect, now) {
      const wasEmpty = state.channels.every((channel) => channel.length === 0)
      const info = channelInfo(state, rect)
      const { requeued } = resize(state, info.maxCanUse)
      state.pending.sort(
        (first, second) =>
          trackPriority(first, info.maxDisplay) - trackPriority(second, info.maxDisplay),
      )
      const blockedPriorities = new Set<number>()
      const assigned: ChannelAssignment[] = []

      state.pending.forEach((track) => {
        const priority = trackPriority(track, info.maxDisplay)
        if (
          track.bookedChannel ||
          Array.from(blockedPriorities).some((blocked) => blocked > priority)
        ) {
          return
        }
        const needed = requiredChannelCount(track)
        const range = realChannelRange(track, info.maxDisplay, info.maxCanUse)
        let consecutive = 0
        for (let index = range.start; index < info.maxCanUse; index += 1) {
          const channel = state.channels[index]
          const last = channel?.[channel.length - 1]
          if (!last || trackRightEdgeVisible(last, rect)) {
            consecutive += 1
          } else {
            consecutive = 0
            if (index >= range.end) break
          }
          if (consecutive < needed) continue
          const start = index - consecutive + 1
          const end = index
          track.bookedChannel = { end, start }
          track.startedAt = now
          for (let channelIndex = start; channelIndex <= end; channelIndex += 1) {
            state.channels[channelIndex].push(track)
          }
          assigned.push({ end, pendingDelay: now - track.observedAt, start, track })
          return
        }
        blockedPriorities.add(priority)
      })

      const dropped: RendererTrack[] = []
      state.pending = state.pending.filter((track) => {
        if (track.bookedChannel) return false
        if (trackNeedsReserve(track, info.maxDisplay, now)) return true
        state.tracks.delete(track.id)
        clearFrameReferences(state.frameState, track.id)
        dropped.push(track)
        return false
      })
      return { assigned, dropped, requeued, remaining: state.pending.length, wasEmpty }
    },
    clear(state) {
      state.pending.length = 0
      state.tracks.clear()
      state.channels = []
      state.frameState.speeds.clear()
      state.frameState.rightPositions.clear()
      state.frameState.previousIds.clear()
      state.frameState.moved.clear()
    },
    enqueue(state, track, maxPending) {
      const wasEmpty = state.pending.length === 0
      if (state.pending.length >= Math.max(1, Math.floor(numberOr(maxPending, 1)))) {
        return { accepted: false, wasEmpty }
      }
      state.tracks.set(track.id, track)
      state.pending.push(track)
      return { accepted: true, wasEmpty }
    },
    isEmpty: (state) => state.channels.every((channel) => channel.length === 0),
    releaseExpired: (state, rect) =>
      releaseTracks(state, (track) => trackIsExpired(track, rect)),
    synchronize: (state, rect) => resize(state, channelInfo(state, rect).maxCanUse),
  }
}

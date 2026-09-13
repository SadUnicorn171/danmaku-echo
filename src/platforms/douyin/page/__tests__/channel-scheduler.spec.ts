import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  channelInfo,
  createDouyinChannelScheduler,
  type ChannelSchedulerState,
} from '../channel-scheduler'
import { initialTrackMotion, trackRightPosition, type CanvasRectLike } from '../track-motion'
import type {
  RendererBarrageDescription,
  RendererConfig,
  RendererInstance,
  RendererTrack,
} from '../runtime-types'

const rect: CanvasRectLike = { height: 120, left: 0, top: 0, width: 400 }

function config(overrides: Partial<RendererConfig> = {}): RendererConfig {
  return {
    channelHeight: 40,
    devicePixelRatio: 1,
    duration: 10_000,
    fontSize: 20,
    gap: 100,
    height: 120,
    maxCount: 200,
    maxHeightRate: 1,
    width: 400,
    ...overrides,
  }
}

function schedulerState(overrides: Partial<RendererConfig> = {}): ChannelSchedulerState {
  return {
    channels: [],
    config: config(overrides),
    frameState: {
      moved: new Set(),
      previousIds: new Map(),
      rightPositions: new Map(),
      speeds: new Map(),
    },
    pending: [],
    tracks: new Map(),
  }
}

function description(text: string, width = 100, height = 30): RendererBarrageDescription {
  return {
    actionWidth: 0,
    contentHeight: height,
    contentWidth: width,
    firstText: null,
    height,
    imageCount: 0,
    imageOnly: false,
    rendererPadding: [0, 0, 0, 0],
    text,
    width,
  }
}

function track(
  state: ChannelSchedulerState,
  id: number,
  options: {
    distance?: number
    duration?: number
    height?: number
    reserveDuration?: number
    startTime?: number
    width?: number
  } = {},
): RendererTrack {
  return {
    bookedChannel: null,
    content: [],
    description: description(`弹幕 ${id}`, options.width, options.height),
    id,
    instance: state as RendererInstance,
    motion: initialTrackMotion(options.distance),
    observedAt: 1_000,
    options: {
      duration: options.duration,
      reserveDuration: options.reserveDuration,
      startTime: options.startTime,
    },
    own: false,
    sender: `user-${id}`,
    startedAt: 0,
  }
}

function enqueueAll(state: ChannelSchedulerState, tracks: RendererTrack[]): void {
  const scheduler = createDouyinChannelScheduler()
  tracks.forEach((item) => {
    expect(scheduler.enqueue(state, item, 200).accepted).toBe(true)
  })
}

describe('Douyin channel scheduler', () => {
  it('assigns a burst across available channels without DOM state', () => {
    const scheduler = createDouyinChannelScheduler()
    const state = schedulerState()
    const burst = [track(state, 1), track(state, 2), track(state, 3)]
    burst.forEach((item) => scheduler.enqueue(state, item, 200))

    const result = scheduler.assign(state, rect, 2_000)

    expect(result.assigned.map(({ start }) => start)).toEqual([0, 1, 2])
    expect(result.dropped).toEqual([])
    expect(result.remaining).toBe(0)
    expect(state.channels.map((channel) => channel.length)).toEqual([1, 1, 1])
  })

  it('keeps reserved barrages pending and drops expired ones when channels are full', () => {
    const scheduler = createDouyinChannelScheduler()
    const state = schedulerState({ height: 40 })
    const occupied = track(state, 1)
    occupied.bookedChannel = { end: 0, start: 0 }
    state.channels = [[occupied]]
    state.tracks.set(occupied.id, occupied)
    const reserved = track(state, 2, { reserveDuration: 2_000, startTime: 1_000 })
    const expired = track(state, 3)
    enqueueAll(state, [reserved, expired])

    const result = scheduler.assign(state, { ...rect, height: 40 }, 2_000)

    expect(result.assigned).toEqual([])
    expect(result.dropped).toEqual([expired])
    expect(state.pending).toEqual([reserved])
    expect(state.tracks.has(expired.id)).toBe(false)
  })

  it('keeps a faster short barrage behind a slower long predecessor', () => {
    const scheduler = createDouyinChannelScheduler()
    const state = schedulerState({ height: 40 })
    const long = track(state, 1, { distance: 500, duration: 20_000, width: 300 })
    long.bookedChannel = { end: 0, start: 0 }
    state.channels = [[long]]
    state.tracks.set(long.id, long)
    const short = track(state, 2, { duration: 5_000, width: 80 })
    scheduler.enqueue(state, short, 200)
    scheduler.assign(state, { ...rect, height: 40 }, 2_000)

    scheduler.advance(state, { ...rect, height: 40 }, 500)

    const longRight = trackRightPosition(long, rect)
    const shortLeft = state.config.width - short.motion.distance
    expect(short.bookedChannel).toEqual({ end: 0, start: 0 })
    expect(shortLeft).toBeGreaterThanOrEqual(longRight + state.config.gap)
  })

  it('requeues tracks outside the channel range after Canvas height shrinks', () => {
    const scheduler = createDouyinChannelScheduler()
    const state = schedulerState()
    const first = track(state, 1)
    const affected = track(state, 2)
    first.bookedChannel = { end: 0, start: 0 }
    affected.bookedChannel = { end: 2, start: 2 }
    state.channels = [[first], [], [affected]]
    state.tracks.set(first.id, first)
    state.tracks.set(affected.id, affected)

    state.config.height = 40
    const result = scheduler.synchronize(state, { ...rect, height: 40 })

    expect(result.requeued).toEqual([affected])
    expect(state.channels).toEqual([[first]])
    expect(affected.bookedChannel).toBeNull()
    expect(state.pending).toEqual([affected])
  })

  it('releases expired tracks from channels and the track registry', () => {
    const scheduler = createDouyinChannelScheduler()
    const state = schedulerState({ height: 40 })
    const expired = track(state, 1, { distance: 600 })
    expired.bookedChannel = { end: 0, start: 0 }
    state.channels = [[expired]]
    state.tracks.set(expired.id, expired)

    expect(scheduler.releaseExpired(state, { ...rect, height: 40 })).toEqual([expired])
    expect(state.channels).toEqual([[]])
    expect(state.tracks.size).toBe(0)
  })

  it('derives channel counts from Canvas size and keeps its source DOM-free', () => {
    const state = schedulerState()
    expect(channelInfo(state, rect)).toEqual({ maxCanUse: 3, maxDisplay: 3 })

    const schedulerSource = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/channel-scheduler.ts'),
      'utf8',
    )
    const appSource = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/page-app.ts'),
      'utf8',
    )
    expect(schedulerSource).not.toContain('document.')
    expect(schedulerSource).not.toContain('HTMLElement')
    expect(schedulerSource).not.toContain('.style')
    expect(appSource).toContain('createDouyinChannelScheduler')
    expect(appSource).not.toContain('function ensureChannels')
    expect(appSource).not.toContain('blockedPriorities')
  })
})

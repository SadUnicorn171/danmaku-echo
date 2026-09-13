import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  advanceTrackMotion,
  frameDelta,
  initialTrackMotion,
  pauseTrackMotion,
  resumeTrackMotion,
  trackIsExpired,
  trackRect,
  trackRightPosition,
  trackSpeed,
  type CanvasRectLike,
  type MotionTrack,
} from '../track-motion'

const rect: CanvasRectLike = { height: 200, left: 10, top: 20, width: 400 }

function motionTrack(distance = 0): MotionTrack {
  return {
    bookedChannel: { end: 0, start: 0 },
    description: {
      actionWidth: 0,
      contentHeight: 30,
      contentWidth: 100,
      firstText: null,
      height: 30,
      imageCount: 0,
      imageOnly: false,
      rendererPadding: [0, 0, 0, 0],
      text: '轨道',
      width: 100,
    },
    instance: {
      config: {
        channelHeight: 40,
        devicePixelRatio: 2,
        duration: 10_000,
        fontSize: 20,
        gap: 50,
        height: 200,
        maxCount: 200,
        maxHeightRate: 1,
        width: 400,
      },
    },
    motion: initialTrackMotion(distance),
    options: {},
  }
}

describe('Douyin pure track motion', () => {
  it('calculates deterministic speed, position and geometry', () => {
    const track = motionTrack(50)

    expect(trackSpeed(track, rect)).toBe(0.05)
    expect(trackRightPosition(track, rect)).toBe(900)
    expect(trackRect(track, rect)).toEqual({
      height: 30,
      left: 360,
      top: 21,
      width: 100,
    })
  })

  it('continues normal movement from the previous distance', () => {
    const next = advanceTrackMotion(initialTrackMotion(10), {
      canvasWidth: 800,
      deltaTime: 200,
      deviceScale: 2,
      minimumLeft: null,
      speed: 0.05,
    })

    expect(next).toEqual({ distance: 20, paused: false })
  })

  it('pauses repeatedly and resumes without catching up elapsed hover time', () => {
    const beforeHover = advanceTrackMotion(initialTrackMotion(), {
      canvasWidth: 800,
      deltaTime: 500,
      deviceScale: 2,
      minimumLeft: null,
      speed: 0.05,
    })
    const paused = pauseTrackMotion(pauseTrackMotion(beforeHover))
    const whileHovered = advanceTrackMotion(paused, {
      canvasWidth: 800,
      deltaTime: 5_000,
      deviceScale: 2,
      minimumLeft: null,
      speed: 0.05,
    })
    const resumed = advanceTrackMotion(resumeTrackMotion(whileHovered), {
      canvasWidth: 800,
      deltaTime: 500,
      deviceScale: 2,
      minimumLeft: null,
      speed: 0.05,
    })

    expect(beforeHover.distance).toBe(25)
    expect(whileHovered).toBe(paused)
    expect(resumed).toEqual({ distance: 50, paused: false })
  })

  it('enforces predecessor spacing without ever moving a track backwards', () => {
    const blocked = advanceTrackMotion(initialTrackMotion(100), {
      canvasWidth: 800,
      deltaTime: 20,
      deviceScale: 2,
      minimumLeft: 650,
      speed: 0.05,
    })
    const released = advanceTrackMotion(blocked, {
      canvasWidth: 800,
      deltaTime: 20,
      deviceScale: 2,
      minimumLeft: 590,
      speed: 0.05,
    })

    expect(blocked.distance).toBe(100)
    expect(released.distance).toBe(101)
  })

  it('uses only monotonic frame timestamps and expires from model position', () => {
    expect(frameDelta(100, 116)).toBe(16)
    expect(frameDelta(0, 500)).toBe(16)
    expect(frameDelta(200, 190)).toBe(0)
    expect(frameDelta(100, 500_500)).toBe(300_000)

    expect(trackIsExpired(motionTrack(499), rect)).toBe(false)
    expect(trackIsExpired(motionTrack(500), rect)).toBe(true)
  })

  it('keeps the pure motion boundary independent from DOM and wall-clock time', () => {
    const modelSource = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/track-motion.ts'),
      'utf8',
    )
    const appSource = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/page-app.ts'),
      'utf8',
    )

    expect(modelSource).not.toContain('document.')
    expect(modelSource).not.toContain('Date.now')
    expect(modelSource).not.toContain('requestAnimationFrame')
    expect(modelSource).not.toContain('.style')
    expect(appSource).toContain("from './track-motion'")
    expect(appSource).toContain('modelFrame(instance, timestamp)')
    expect(appSource).not.toContain('deltaXWithoutDpr')
    expect(appSource).not.toContain('resumeOffset')
  })
})

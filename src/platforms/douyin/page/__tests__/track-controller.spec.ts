import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DOUYIN_CONTENT_SOURCE } from '../../protocol'
import type { DouyinContentToPageMessage, DouyinPageToContentPayload } from '../../protocol'
import type { DouyinPageBridge } from '../page-bridge'
import { createRendererTrackController, type RendererTrackController } from '../track-controller'
import { initialTrackMotion } from '../track-motion'
import type { RendererInstance, RendererTrack, RendererTrackDomState } from '../runtime-types'

type TrackRequestPayload = Extract<
  DouyinPageToContentPayload,
  { type: 'renderer-activate' | 'renderer-copy' | 'renderer-favorite' }
>
type TrackResponse = Extract<
  DouyinContentToPageMessage,
  { type: 'renderer-copy-result' | 'renderer-favorite-result' | 'renderer-result' }
>

interface PendingRequest {
  payload: TrackRequestPayload
  respond(message: TrackResponse): void
}

interface ControllerHarness {
  bridge: DouyinPageBridge
  controller: RendererTrackController
  failures: string[]
  pending: PendingRequest[]
  sent: DouyinPageToContentPayload[]
  setReminderCovered(value: boolean): void
}

function createInstance(id = 'instance-1'): RendererInstance {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  return {
    active: true,
    animationFrame: 0,
    canvas,
    canvasEverConnected: true,
    canvasId: 1,
    channels: [[]],
    config: {
      channelHeight: 40,
      devicePixelRatio: 1,
      duration: 10_000,
      fontSize: 20,
      gap: 100,
      height: 120,
      maxCount: 200,
      maxHeightRate: 1,
      width: 400,
    },
    createdAt: 1_000,
    frameState: {
      moved: new Set(),
      previousIds: new Map(),
      rightPositions: new Map(),
      speeds: new Map(),
    },
    id,
    lastFrameAt: 0,
    lifecycle: { lastFailure: null, state: 'observing' },
    mountGraceUntil: 2_000,
    pending: [],
    pushTimer: 0,
    recovered: false,
    rendererBlocked: false,
    rendererBorderRadius: null,
    rendererCanvasVisibility: '',
    rendererCleanClearObserved: false,
    rendererGeneration: 0,
    rendererGeometryKey: '',
    rendererLayer: null,
    rendererNodes: new Map(),
    rendererOwnsCanvasVisibility: false,
    rendererPreparing: 0,
    rendererSafeAfter: 0,
    rendererSafeSync: true,
    rendererTakeover: false,
    tracks: new Map(),
  }
}

function createHarness(): ControllerHarness {
  let reminderCovered = false
  const failures: string[] = []
  const pending: PendingRequest[] = []
  const sent: DouyinPageToContentPayload[] = []
  const request: DouyinPageBridge['request'] = (payload, requestOptions) => {
    pending.push({
      payload,
      respond: (message) => {
        const onResponse = requestOptions.onResponse as unknown as (response: TrackResponse) => void
        onResponse(message)
      },
    })
    return () => undefined
  }
  const bridge: DouyinPageBridge = {
    destroy: () => undefined,
    request,
    send: (payload) => sent.push(payload),
    start: () => undefined,
  }
  const controller = createRendererTrackController({
    actionBaseHeight: 40,
    actionDividerWidth: 2,
    actionGap: 8,
    actionItemWidths: { copy: 56, favorite: 56, plusOne: 56, reply: 56 },
    actionTrailingSpace: 12,
    document,
    frozenTrackTimeout: 20_000,
    getBridge: () => bridge,
    getDevicePixelRatio: () => 1,
    hoverLeaveGrace: 220,
    isEnabled: () => true,
    onFailure: (_instance, reason) => failures.push(reason),
    requestTimeout: 8_000,
    target: window,
    touchesRepeatReminder: () => reminderCovered,
  })
  return {
    bridge,
    controller,
    failures,
    pending,
    sent,
    setReminderCovered: (value) => {
      reminderCovered = value
    },
  }
}

function connectTrack(
  harness: ControllerHarness,
  instance: RendererInstance,
  id: number,
): { state: RendererTrackDomState; track: RendererTrack } {
  const track: RendererTrack = {
    bookedChannel: { end: 0, start: 0 },
    content: [{ text: `弹幕${id}`, type: 'text' }],
    description: {
      actionWidth: 172,
      contentHeight: 40,
      contentWidth: 120,
      firstText: {},
      height: 40,
      imageCount: 0,
      imageOnly: false,
      rendererPadding: [8, 8, 8, 8],
      text: `弹幕${id}`,
      width: 312,
    },
    id,
    instance,
    motion: initialTrackMotion(24),
    observedAt: 1_000,
    options: { id: `message-${id}` },
    own: false,
    sender: `用户${id}`,
    startedAt: 1_000,
  }
  const node = document.createElement('div')
  const barrage = document.createElement('div')
  const content = document.createElement('span')
  const capsule = harness.controller.createCapsule()
  barrage.append(content)
  node.append(barrage, capsule.actionBar)
  document.body.append(node)
  const state: RendererTrackDomState = {
    ...capsule,
    actionSide: null,
    barrage,
    content,
    hovered: false,
    hoverTimer: 0,
    node,
    releaseTimer: 0,
    sending: false,
    visualHeight: 0,
    visualLeft: null,
    visualWidth: 0,
  }
  track.renderer = state
  for (const element of [
    state.node,
    state.actionBar,
    state.button,
    state.replyButton,
    state.favoriteButton,
    state.copyButton,
  ]) {
    element.dataset.track = String(track.id)
    element.dataset.instance = String(instance.id)
    element.dataset.message = track.description.text
  }
  instance.tracks.set(id, track)
  harness.controller.connectTrack(track, state)
  return { state, track }
}

beforeEach(() => {
  document.body.replaceChildren()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Douyin renderer track controller', () => {
  it('keeps exactly one overlapping track paused', () => {
    const harness = createHarness()
    const instance = createInstance()
    const first = connectTrack(harness, instance, 1)
    const second = connectTrack(harness, instance, 2)

    first.state.node.dispatchEvent(new MouseEvent('pointerenter', { clientX: 10, clientY: 10 }))
    second.state.node.dispatchEvent(new MouseEvent('pointerenter', { clientX: 10, clientY: 10 }))

    expect(first.track.motion.paused).toBe(false)
    expect(first.state.hovered).toBe(false)
    expect(second.track.motion.paused).toBe(true)
    expect(second.state.hovered).toBe(true)
    expect(harness.controller.diagnostics().hoveredTrackId).toBe(2)
  })

  it('keeps the body, gap, and capsule in one hover grace region', () => {
    const harness = createHarness()
    const instance = createInstance()
    const { state, track } = connectTrack(harness, instance, 1)

    state.node.dispatchEvent(new MouseEvent('pointerenter'))
    state.node.dispatchEvent(new MouseEvent('pointerleave'))
    vi.advanceTimersByTime(100)
    state.node.dispatchEvent(new MouseEvent('pointerenter'))
    vi.advanceTimersByTime(300)

    expect(track.motion.paused).toBe(true)
    expect(state.hovered).toBe(true)

    state.node.dispatchEvent(new MouseEvent('pointerleave'))
    vi.advanceTimersByTime(220)
    expect(track.motion.paused).toBe(false)
    expect(state.hovered).toBe(false)
  })

  it('does not activate or retain a track below the reminder overlay', () => {
    const harness = createHarness()
    const instance = createInstance()
    const { state, track } = connectTrack(harness, instance, 1)
    harness.setReminderCovered(true)

    state.node.dispatchEvent(new MouseEvent('pointerenter', { clientX: 20, clientY: 20 }))
    expect(track.motion.paused).toBe(false)

    harness.setReminderCovered(false)
    harness.controller.hold(track)
    harness.setReminderCovered(true)
    expect(harness.controller.releaseIfCoveredAt(20, 20)).toBe(true)
    expect(track.motion.paused).toBe(false)
  })

  it('releases the track after a successful +1 or reply action', () => {
    const harness = createHarness()
    const instance = createInstance()
    const first = connectTrack(harness, instance, 1)
    harness.controller.hold(first.track)

    first.state.button.click()
    expect(first.state.sending).toBe(true)
    expect(harness.pending).toHaveLength(1)
    harness.pending[0].respond({
      instanceId: String(instance.id),
      ok: true,
      protocolVersion: 1,
      reason: 'sent',
      requestId: 1,
      source: DOUYIN_CONTENT_SOURCE,
      trackId: String(first.track.id),
      type: 'renderer-result',
    })

    expect(first.track.motion.paused).toBe(false)
    expect(first.state.hovered).toBe(false)

    const second = connectTrack(harness, instance, 2)
    harness.controller.hold(second.track)
    second.state.replyButton.click()
    expect(harness.sent.at(-1)).toMatchObject({ type: 'renderer-reply', trackId: 2 })
    expect(second.track.motion.paused).toBe(false)
  })

  it('scales the complete capsule and chooses a side without moving a held anchor', () => {
    const harness = createHarness()
    harness.controller.updateSettings(
      { copy: true, favorite: true, plusOne: true, reply: true },
      150,
    )
    expect(harness.controller.actionWidth()).toBe(345)
    expect(harness.controller.actionHeight()).toBe(60)

    const instance = createInstance()
    const { state, track } = connectTrack(harness, instance, 1)
    const canvas = { height: 200, left: 0, top: 0, width: 800 }
    const right = harness.controller.layout(
      track,
      { height: 60, left: 20, top: 40, width: 485 },
      canvas,
    )
    expect(right.actionSide).toBe('right')

    const left = harness.controller.layout(
      track,
      { height: 60, left: 500, top: 40, width: 485 },
      canvas,
    )
    expect(left.actionSide).toBe('left')

    state.actionSide = 'right'
    state.visualLeft = 123
    harness.controller.hold(track)
    const held = harness.controller.layout(
      track,
      { height: 60, left: 500, top: 40, width: 485 },
      canvas,
    )
    expect(held).toMatchObject({ actionSide: 'right', visualLeft: 123 })
  })

  it('rejects an untrusted capsule activation before dispatch', () => {
    const harness = createHarness()
    const instance = createInstance()
    const { state } = connectTrack(harness, instance, 1)
    state.button.dataset.message = '被篡改'

    state.button.click()

    expect(harness.pending).toHaveLength(0)
    expect(harness.failures).toEqual(['activation-metadata-mismatch'])
  })

  it('cancels pending feedback and restores controls when destroyed', () => {
    const harness = createHarness()
    const instance = createInstance()
    const { state } = connectTrack(harness, instance, 1)
    state.button.click()
    expect(state.button.disabled).toBe(true)

    harness.controller.destroy()

    expect(state.sending).toBe(false)
    expect(state.button.disabled).toBe(false)
    expect(state.button.textContent).toBe('+1')
    expect(harness.controller.diagnostics().pendingActivationCount).toBe(0)
  })
})

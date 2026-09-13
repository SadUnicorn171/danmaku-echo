import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  createDouyinDomRenderer,
  type DouyinDomRenderer,
  type DouyinDomRendererEvent,
} from '../dom-renderer'
import type { DouyinPageBridge } from '../page-bridge'
import { createRendererTrackController } from '../track-controller'
import { initialTrackMotion, type CanvasRectLike } from '../track-motion'
import type { RendererInstance, RendererTrack } from '../runtime-types'

const rect: CanvasRectLike = { height: 120, left: 12, top: 24, width: 400 }

interface RendererHarness {
  actions: string[]
  beforeShutdown: string[]
  events: DouyinDomRendererEvent[]
  renderer: DouyinDomRenderer
  styleReads: Element[]
}

function createHarness(): RendererHarness {
  const actions: string[] = []
  const beforeShutdown: string[] = []
  const events: DouyinDomRendererEvent[] = []
  const styleReads: Element[] = []
  const bridge: DouyinPageBridge = {
    destroy: () => undefined,
    request: (payload) => {
      actions.push(payload.type)
      return () => undefined
    },
    send: (payload) => actions.push(payload.type),
    start: () => undefined,
  }
  const trackController = createRendererTrackController({
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
    onFailure: () => undefined,
    requestTimeout: 8_000,
    target: window,
  })
  const renderer = createDouyinDomRenderer({
    actionGap: 8,
    actionTrailingSpace: 12,
    beforeShutdown: (instance) => beforeShutdown.push(String(instance.id)),
    document,
    getComputedStyle: (element) => {
      styleReads.push(element)
      return { borderRadius: '8px' } as CSSStyleDeclaration
    },
    nodeLimit: 160,
    onEvent: (event) => events.push(event),
    trackController,
  })
  return { actions, beforeShutdown, events, renderer, styleReads }
}

function createInstance(id = 'renderer-1'): RendererInstance {
  const canvas = document.createElement('canvas')
  canvas.className = 'live-danmaku-canvas'
  canvas.style.visibility = 'visible'
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

function addTrack(instance: RendererInstance, id = 1): RendererTrack {
  const track: RendererTrack = {
    bookedChannel: { end: 0, start: 0 },
    content: [
      { fontSize: 20, text: '测试', type: 'text' },
      { height: 20, src: 'https://example.com/emoji.png', type: 'image', width: 20 },
    ],
    description: {
      actionWidth: 172,
      contentHeight: 30,
      contentWidth: 120,
      firstText: { color: '#ffffff', fontSize: 20, fontWeight: 600 },
      height: 40,
      imageCount: 1,
      imageOnly: false,
      rendererPadding: [8, 8, 8, 8],
      text: '测试[表情]',
      width: 312,
    },
    id,
    instance,
    motion: initialTrackMotion(),
    observedAt: 1_000,
    options: { id: `message-${id}` },
    own: false,
    sender: '用户甲',
    startedAt: 1_000,
  }
  instance.tracks.set(id, track)
  instance.channels[0].push(track)
  return track
}

beforeEach(() => {
  document.body.replaceChildren()
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    value: null,
  })
})

describe('Douyin DOM Renderer', () => {
  it('keeps frame reads side-effect free and hides Canvas only after nodes connect', () => {
    const harness = createHarness()
    const instance = createInstance()
    const track = addTrack(instance)

    const snapshot = harness.renderer.readFrame(instance, rect, { enabled: true, now: 2_000 })

    expect(snapshot.action).toBe('commit')
    expect(instance.rendererLayer).toBeNull()
    expect(track.renderer).toBeUndefined()
    expect(instance.canvas.style.visibility).toBe('visible')
    expect(harness.styleReads).toEqual([instance.canvas])

    harness.renderer.commitFrame(snapshot)

    expect(instance.rendererLayer?.isConnected).toBe(true)
    expect(track.renderer?.node.isConnected).toBe(true)
    expect(instance.canvas.style.visibility).toBe('hidden')
    expect(instance.canvas.dataset.bcpDouyinDomTakeover).toBe('true')
    expect(harness.events.map(({ type }) => type)).toEqual([
      'renderer-node-created',
      'renderer-takeover',
    ])
  })

  it('does not take over an empty frame and reuses an existing track node', () => {
    const harness = createHarness()
    const instance = createInstance()
    const empty = harness.renderer.readFrame(instance, rect, { enabled: true, now: 2_000 })
    harness.renderer.commitFrame(empty)
    expect(instance.canvas.style.visibility).toBe('visible')

    const track = addTrack(instance)
    const first = harness.renderer.readFrame(instance, rect, { enabled: true, now: 2_000 })
    harness.renderer.commitFrame(first)
    const node = track.renderer?.node
    const firstTransform = node?.style.transform
    track.motion = initialTrackMotion(40)
    const second = harness.renderer.readFrame(instance, rect, { enabled: true, now: 2_016 })
    harness.renderer.commitFrame(second)

    expect(track.renderer?.node).toBe(node)
    expect(instance.rendererNodes.size).toBe(1)
    expect(track.renderer?.node.style.transform).not.toBe(firstTransform)
    expect(harness.events.filter(({ type }) => type === 'renderer-node-created')).toHaveLength(1)
  })

  it('creates bounded rich content and refreshes action metadata without querying the page', () => {
    const harness = createHarness()
    const instance = createInstance()
    const track = addTrack(instance)
    harness.renderer.commitFrame(
      harness.renderer.readFrame(instance, rect, { enabled: true, now: 2_000 }),
    )

    expect(track.renderer?.content.textContent).toContain('测试')
    expect(track.renderer?.content.querySelectorAll('img')).toHaveLength(1)
    expect(track.renderer?.button.dataset.messageId).toBe('message-1')
    expect(track.renderer?.button.dataset.sender).toBe('用户甲')

    track.description.text = '已恢复完整消息'
    harness.renderer.refreshTrackMetadata(track)
    track.renderer?.button.click()
    expect(track.renderer?.button.getAttribute('aria-label')).toBe('发送相同弹幕：已恢复完整消息')
    expect(harness.actions).toEqual(['renderer-activate'])
  })

  it.each(['animation-frame-error', 'heartbeat-timeout', 'worker-destroy'])(
    'immediately restores Canvas and removes renderer DOM on %s',
    (reason) => {
      const harness = createHarness()
      const instance = createInstance(reason)
      const track = addTrack(instance)
      harness.renderer.commitFrame(
        harness.renderer.readFrame(instance, rect, { enabled: true, now: 2_000 }),
      )
      expect(instance.canvas.style.visibility).toBe('hidden')

      harness.renderer.shutdown(instance, reason)

      expect(instance.canvas.style.visibility).toBe('visible')
      expect(instance.canvas.dataset.bcpDouyinDomTakeover).toBeUndefined()
      expect(instance.rendererLayer).toBeNull()
      expect(track.renderer).toBeNull()
      expect(instance.rendererNodes.size).toBe(0)
      expect(harness.beforeShutdown).toEqual([reason])
      expect(harness.events.at(-1)).toMatchObject({
        details: { reason },
        type: 'renderer-canvas-restored',
      })
    },
  )

  it('turns a disabled frame into a synchronous shutdown commit', () => {
    const harness = createHarness()
    const instance = createInstance()
    addTrack(instance)
    harness.renderer.commitFrame(
      harness.renderer.readFrame(instance, rect, { enabled: true, now: 2_000 }),
    )

    const snapshot = harness.renderer.readFrame(instance, rect, { enabled: false, now: 2_100 })
    expect(snapshot).toMatchObject({ action: 'shutdown', reason: 'disabled' })
    harness.renderer.commitFrame(snapshot)
    expect(instance.canvas.style.visibility).toBe('visible')
    expect(instance.lifecycle.state).toBe('suspended')
  })

  it('mounts the renderer inside the fullscreen owner instead of escaping its viewport', () => {
    const harness = createHarness()
    const fullscreen = document.createElement('section')
    document.body.append(fullscreen)
    const instance = createInstance()
    fullscreen.append(instance.canvas)
    addTrack(instance)
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: fullscreen,
    })

    harness.renderer.commitFrame(
      harness.renderer.readFrame(instance, rect, { enabled: true, now: 2_000 }),
    )

    expect(instance.rendererLayer?.parentElement).toBe(fullscreen)
    expect(instance.rendererLayer?.style.overflow).toBe('hidden')
  })

  it('keeps DOM creation and writes outside the MAIN-world frame coordinator', () => {
    const appSource = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/page-app.ts'),
      'utf8',
    )
    const coordinator = appSource.match(
      /function updateRendererFrame\([\s\S]*?\): void \{[\s\S]*?\n  \}/u,
    )?.[0]

    expect(appSource).toContain('createDouyinDomRenderer')
    expect(coordinator).toContain('domRenderer.readFrame')
    expect(coordinator).toContain('domRenderer.commitFrame')
    expect(coordinator).not.toContain('.style')
    expect(appSource).not.toContain('function createRendererTrack')
    expect(appSource).not.toContain('function ensureRendererLayer')
    expect(appSource).not.toContain('function syncRendererTrack')
  })
})

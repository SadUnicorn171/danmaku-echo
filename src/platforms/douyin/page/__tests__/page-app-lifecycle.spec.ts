// @vitest-environment-options {"url":"https://live.douyin.com/100"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDouyinPageAppRuntime } from '../page-app'
import type { DouyinPageRuntime } from '../page-runtime'
import { createDouyinContentToPageMessage } from '../../protocol'
import type {} from '../../../../global'

let runtime: DouyinPageRuntime
let frames: Map<number, FrameRequestCallback>
let frameId: number
class FixturePort {
  postMessage(_message: unknown): void {}
}
const send = (id: string, method: string, params: unknown = {}) =>
  new FixturePort().postMessage({ _uniqueId: id, method, params })
const config = {
  width: 800,
  height: 450,
  channelHeight: 40,
  fontSize: 20,
  duration: 15000,
  devicePixelRatio: 1,
}
function frame(at: number) {
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach((callback) => callback(at))
}
function canvas(marked = true) {
  const node = document.createElement('canvas')
  if (marked) node.className = 'barrage-canvas'
  node.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 450,
    right: 800,
    bottom: 450,
    x: 0,
    y: 0,
    toJSON() {},
  })
  return node
}
function create(id: string, node: HTMLCanvasElement) {
  const offscrrenCanvas = node.transferControlToOffscreen()
  send(id, 'createInstance', { config, offscrrenCanvas, barrages: [] })
  send(id, 'addBarrage', {
    id: `${id}-barrage`,
    startTime: Date.now(),
    reserveDuration: 5000,
    content: [{ type: 'text', text: '首次进入直播的普通弹幕', fontSize: 20 }],
  })
}
const layer = (id: string) =>
  document.querySelector<HTMLElement>(`.bcp-douyin-dom-layer[data-instance="${id}"]`)
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1800000000000)
  frames = new Map()
  frameId = 0
  vi.stubGlobal('MessagePort', FixturePort)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id)
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (text: string) => ({ width: text.length * 20 }),
  } as unknown as CanvasRenderingContext2D)
  Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
    configurable: true,
    writable: true,
    value: () => ({}),
  })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  document.body.replaceChildren()
  history.replaceState({}, '', '/100')
  runtime = createDouyinPageAppRuntime()
  runtime.start()
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      data: createDouyinContentToPageMessage({
        type: 'renderer-settings',
        enabled: true,
        repeatReminderEnabled: false,
        actions: { plusOne: true, reply: true, favorite: true, copy: false },
        capsuleScalePercent: 100,
        reason: 'test',
        sentAt: Date.now(),
        version: 'test',
      }),
    }),
  )
  if (!runtime.isRendererEnabled()) throw new Error('Fixture renderer settings were rejected')
})
afterEach(() => {
  runtime.destroy()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Douyin page startup and animation lifecycle', () => {
  it('does not accumulate assignment timers when heartbeats arrive with queued barrages', () => {
    const node = canvas()
    document.body.append(node)
    create('busy', node)
    for (let index = 0; index < 40; index++) {
      send('busy', 'addBarrage', {
        id: `busy-${index}`,
        startTime: Date.now(),
        reserveDuration: 5000,
        content: [{ type: 'text', text: '等待可用轨道的弹幕' }],
      })
    }
    const timers = vi.getTimerCount()
    for (let index = 0; index < 20; index++) runtime.updateRendererSettings(true, false)
    expect(vi.getTimerCount()).toBe(timers)
  })
  it('preserves a transiently detached instance across the maintenance sweep', async () => {
    const node = canvas()
    document.body.append(node)
    create('sweep-race', node)
    frame(16)
    await vi.advanceTimersByTimeAsync(490)
    frame(490)
    node.remove()
    frame(496)
    await vi.advanceTimersByTimeAsync(20)
    document.body.append(node)
    frame(520)
    expect(layer('sweep-race')?.hidden).toBe(false)
    expect(node.style.visibility).toBe('hidden')
  })
  it('never takes over an ordinary unmarked Canvas even with renderer-like configuration', async () => {
    const ordinary = canvas(false)
    document.body.append(ordinary)
    create('ordinary', ordinary)
    await vi.advanceTimersByTimeAsync(500)
    frame(500)
    expect(layer('ordinary')).toBeNull()
    expect(ordinary.style.visibility).toBe('')
  })

  it('preserves a cached postMessage reference across a BFCache round trip', () => {
    const cachedPost = new FixturePort().postMessage.bind(new FixturePort())
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    const node = canvas()
    document.body.append(node)
    cachedPost({
      method: 'createInstance',
      _uniqueId: 'cached',
      params: { config, offscreenCanvas: node.transferControlToOffscreen() },
    })
    cachedPost({
      method: 'addBarrage',
      _uniqueId: 'cached',
      params: {
        id: 'cached-message',
        startTime: Date.now(),
        reserveDuration: 5000,
        content: [{ type: 'text', text: '返回后仍能接收弹幕' }],
      },
    })
    frame(16)
    frame(32)
    expect(layer('cached')?.hidden).toBe(false)
  })
  it('keeps transfer identity until an initially unmarked Canvas is mounted', async () => {
    const node = canvas(false)
    create('early', node)
    const host = document.createElement('div')
    host.className = 'CanvasDanmakuPlugin'
    host.append(node)
    document.body.append(host)
    await vi.advanceTimersByTimeAsync(150)
    frame(150)
    expect(layer('early')?.hidden).toBe(false)
    expect(node.style.visibility).toBe('hidden')
  })

  it('continues moving after a brief detach without waiting for a message or heartbeat', () => {
    const node = canvas()
    document.body.append(node)
    create('remount', node)
    frame(16)
    frame(32)
    const track = layer('remount')!.querySelector<HTMLElement>('.bcp-douyin-dom-track')!
    const before = track.style.transform
    expect(before).toContain('translate3d')
    node.remove()
    frame(48)
    document.body.append(node)
    frame(64)
    frame(80)
    expect(track.style.transform).not.toBe(before)
    expect(node.style.visibility).toBe('hidden')
  })

  it('does not clear a new room instance when the maintenance route check runs later', async () => {
    history.pushState({}, '', '/room-next')
    const node = canvas()
    document.body.append(node)
    create('next-room', node)
    frame(16)
    frame(32)
    expect(layer('next-room')?.hidden).toBe(false)
    await vi.advanceTimersByTimeAsync(550)
    frame(582)
    expect(layer('next-room')?.hidden).toBe(false)
    expect(node.style.visibility).toBe('hidden')
  })
})

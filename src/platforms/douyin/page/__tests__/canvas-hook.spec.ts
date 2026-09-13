import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDouyinCanvasHook, rendererCanvases } from '../canvas-hook'
import type { DouyinCanvasHook, DouyinCanvasTransferEvent } from '../canvas-hook'
import type { RendererInstance } from '../runtime-types'

const prototype = HTMLCanvasElement.prototype
let originalDescriptor: PropertyDescriptor | undefined
let activeHooks: DouyinCanvasHook[] = []
let nativeCalls: HTMLCanvasElement[] = []

beforeEach(() => {
  originalDescriptor = Object.getOwnPropertyDescriptor(prototype, 'transferControlToOffscreen')
  nativeCalls = []
  activeHooks = []
  Object.defineProperty(prototype, 'transferControlToOffscreen', {
    configurable: true,
    value: function nativeTransfer(this: HTMLCanvasElement): OffscreenCanvas {
      nativeCalls.push(this)
      return { source: this } as unknown as OffscreenCanvas
    },
    writable: true,
  })
  document.body.replaceChildren()
})

afterEach(() => {
  activeHooks.reverse().forEach((hook) => hook.destroy())
  if (originalDescriptor) {
    Object.defineProperty(prototype, 'transferControlToOffscreen', originalDescriptor)
  } else {
    delete (prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen
  }
  document.body.replaceChildren()
})

function trackedHook(events: DouyinCanvasTransferEvent[]): DouyinCanvasHook {
  const hook = createDouyinCanvasHook({ onTransfer: (event) => events.push(event) })
  activeHooks.push(hook)
  return hook
}

describe('DouyinCanvasHook', () => {
  it('passes ordinary Canvas transfers through without tracking them', () => {
    const events: DouyinCanvasTransferEvent[] = []
    const hook = trackedHook(events)
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    expect(hook.install()).toBe(true)

    const offscreen = canvas.transferControlToOffscreen()

    expect(nativeCalls).toEqual([canvas])
    expect(events).toEqual([])
    expect(hook.canvasForOffscreen(offscreen)).toBeNull()
    expect(hook.diagnostics()).toMatchObject({
      ignoredTransferCount: 1,
      installed: true,
      transferCount: 0,
    })
  })

  it('tracks only marked danmaku Canvas elements with stable ids', () => {
    const events: DouyinCanvasTransferEvent[] = []
    const hook = trackedHook(events)
    const container = document.createElement('div')
    container.className = 'live-danmaku-layer'
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    container.append(canvas)
    document.body.append(container)
    hook.install()

    const offscreen = canvas.transferControlToOffscreen()

    expect(hook.canvasForOffscreen(offscreen)).toBe(canvas)
    expect(hook.canvasId(canvas)).toBe(1)
    expect(hook.canvasId(canvas)).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ canvas, canvasId: 1, height: 720, width: 1280 })
    expect(hook.diagnostics()).toMatchObject({
      ignoredTransferCount: 0,
      installed: true,
      transferCount: 1,
    })
  })

  it('finds the latest unclaimed marked Canvas and ignores ordinary Canvas', () => {
    const hook = trackedHook([])
    const container = document.createElement('div')
    container.dataset.e2e = 'bullet-screen'
    const first = document.createElement('canvas')
    const second = document.createElement('canvas')
    const ordinary = document.createElement('canvas')
    container.append(first, second)
    document.body.append(container, ordinary)

    const claimed = rendererCanvases([{ canvas: first } as RendererInstance])
    expect(hook.findUnclaimedCanvas(claimed)).toBe(second)
    expect(hook.findUnclaimedCanvas(new Set([first, second]))).toBeNull()
  })

  it('installs one shared wrapper and restores the original after the last owner', () => {
    const firstEvents: DouyinCanvasTransferEvent[] = []
    const secondEvents: DouyinCanvasTransferEvent[] = []
    const original = prototype.transferControlToOffscreen
    const first = trackedHook(firstEvents)
    const second = trackedHook(secondEvents)

    expect(first.install()).toBe(true)
    const wrapper = prototype.transferControlToOffscreen
    expect(first.install()).toBe(true)
    expect(prototype.transferControlToOffscreen).toBe(wrapper)
    expect(second.install()).toBe(true)
    expect(prototype.transferControlToOffscreen).toBe(wrapper)
    expect(second.diagnostics().reusedPatch).toBe(true)

    const container = document.createElement('div')
    container.className = 'barrage-container'
    const canvas = document.createElement('canvas')
    container.append(canvas)
    document.body.append(container)
    canvas.transferControlToOffscreen()
    expect(firstEvents).toHaveLength(1)
    expect(secondEvents).toHaveLength(1)

    first.destroy()
    expect(prototype.transferControlToOffscreen).toBe(wrapper)
    second.destroy()
    expect(prototype.transferControlToOffscreen).toBe(original)
  })

  it('keeps Canvas prototype patching out of the page entry', () => {
    const entrySource = readFileSync(
      resolve(process.cwd(), 'src/entries/douyin-page-hook.ts'),
      'utf8',
    )
    const runtimeSource = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/page-runtime.ts'),
      'utf8',
    )
    const appSource = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/page-app.ts'),
      'utf8',
    )
    expect(entrySource).not.toContain('transferControlToOffscreen')
    expect(entrySource).toContain('createDouyinPageAppRuntime')
    expect(appSource).toContain('createDouyinCanvasHook')
    expect(appSource).toContain('createDouyinPageRuntime')
    expect(runtimeSource).toContain('options.canvasHook.install()')
  })
})

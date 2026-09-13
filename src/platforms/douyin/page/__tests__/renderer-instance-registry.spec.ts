import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  createRendererInstanceRegistry,
  type RendererInstanceRegistry,
  type RendererInstanceRegistryOptions,
  type RendererRegistryEvent,
} from '../renderer-instance-registry'
import type { RendererBarrageOptions, RendererInstance } from '../runtime-types'

interface RegistryHarness {
  barrages: Array<{ instance: RendererInstance; barrage: RendererBarrageOptions }>
  cleared: Array<{ instance: RendererInstance; reason: string }>
  events: RendererRegistryEvent[]
  registry: RendererInstanceRegistry
}

function canvas(width = 960, height = 540): HTMLCanvasElement {
  const element = document.createElement('canvas')
  element.className = 'live-danmaku-canvas'
  element.getBoundingClientRect = () =>
    ({ bottom: height, height, left: 0, right: width, top: 0, width, x: 0, y: 0 }) as DOMRect
  return element
}

function createHarness(now: () => number = () => 1_000): RegistryHarness {
  const barrages: RegistryHarness['barrages'] = []
  const cleared: RegistryHarness['cleared'] = []
  const events: RendererRegistryEvent[] = []
  const canvasIds = new WeakMap<HTMLCanvasElement, number>()
  let nextCanvasId = 1
  const canvasHook: RendererInstanceRegistryOptions['canvasHook'] = {
    canvasId: (element) => {
      let id = canvasIds.get(element)
      if (!id) {
        id = nextCanvasId
        nextCanvasId += 1
        canvasIds.set(element, id)
      }
      return id
    },
    findUnclaimedCanvas: (claimed) => {
      const owned = new Set(claimed)
      return (
        Array.from(document.querySelectorAll('canvas'))
          .reverse()
          .find((element) => !owned.has(element)) ?? null
      )
    },
    isDanmakuCanvas: (value): value is HTMLCanvasElement => value instanceof HTMLCanvasElement,
    markerFor: (element) => element?.className || '',
  }
  const registry = createRendererInstanceRegistry({
    canvasHook,
    clearInstance: (instance, reason) => {
      cleared.push({ instance, reason })
      instance.pending.length = 0
      instance.tracks.clear()
    },
    mountGrace: 1_000,
    now,
    onBarrage: (instance, barrage) => barrages.push({ barrage, instance }),
    onEvent: (event) => events.push(event),
    setTimeout: () => 1,
  })
  return { barrages, cleared, events, registry }
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('Douyin Renderer instance registry', () => {
  it('creates and retrieves a fully initialized instance', () => {
    const harness = createHarness()
    const target = canvas(1280, 720)
    document.body.append(target)

    const instance = harness.registry.create('renderer-1', target, { fontSize: 26 })

    expect(instance).not.toBeNull()
    expect(harness.registry.get('renderer-1')).toBe(instance)
    expect(instance?.config).toMatchObject({
      devicePixelRatio: expect.any(Number),
      fontSize: 26,
      height: 720,
      width: 1280,
    })
    expect(instance?.lifecycle.state).toBe('observing')
    expect(instance && harness.registry.owns(instance)).toBe(true)
    expect(harness.registry.diagnostics()).toMatchObject({
      claimedCanvasCount: 1,
      instanceCount: 1,
    })
  })

  it('rejects a second instance claiming an owned Canvas', () => {
    const harness = createHarness()
    const target = canvas()
    document.body.append(target)
    const first = harness.registry.create('renderer-1', target)

    const second = harness.registry.create('renderer-2', target)

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(harness.registry.size()).toBe(1)
    expect(harness.events.at(-1)?.type).toBe('canvas-claim-rejected')
  })

  it('recovers late-injected create data when an unclaimed Canvas appears', () => {
    const harness = createHarness()
    const barrage = { content: [{ text: '晚到弹幕', type: 'text' }] }
    harness.registry.rememberOrphan('renderer-late', 'createInstance', {
      barrages: [barrage],
      config: { duration: 18_000, fontSize: 24 },
    })

    expect(harness.registry.recover()).toBe(0)
    const target = canvas()
    document.body.append(target)
    expect(harness.registry.recover()).toBe(1)

    const recovered = harness.registry.get('renderer-late')
    expect(recovered).toMatchObject({
      recovered: true,
      rendererSafeSync: false,
    })
    expect(recovered?.lifecycle.state).toBe('recovering')
    expect(harness.barrages).toEqual([{ barrage, instance: recovered }])
    expect(harness.registry.orphanCount()).toBe(0)
  })

  it('keeps an initially detached Canvas during grace and recovers after remount', () => {
    let time = 100
    const harness = createHarness(() => time)
    const original = canvas()
    const instance = harness.registry.create('renderer-remount', original)
    expect(instance).not.toBeNull()

    time = 500
    expect(harness.registry.sweepDetached()).toBe(0)
    expect(harness.registry.get('renderer-remount')).toBe(instance)

    document.body.append(original)
    instance!.canvasEverConnected = true
    original.remove()
    const replacement = canvas()
    document.body.append(replacement)
    time = 700
    expect(harness.registry.sweepDetached()).toBe(1)
    expect(harness.registry.get('renderer-remount')).toBeUndefined()
    expect(harness.registry.orphanCount()).toBe(1)

    expect(harness.registry.recover()).toBe(1)
    expect(harness.registry.get('renderer-remount')?.canvas).toBe(replacement)
    expect(harness.cleared.at(-1)?.reason).toBe('canvas-detached')
  })

  it('resets lifecycle safely and removes or destroys owned instances', () => {
    let time = 2_000
    const harness = createHarness(() => time)
    const firstCanvas = canvas()
    const secondCanvas = canvas()
    document.body.append(firstCanvas, secondCanvas)
    const first = harness.registry.create('renderer-1', firstCanvas)!
    harness.registry.create('renderer-2', secondCanvas)

    time = 3_000
    harness.registry.reset('renderer-1', 'worker-clear', 'await-clean-sync')
    expect(first).toMatchObject({
      rendererCleanClearObserved: true,
      rendererSafeAfter: Infinity,
      rendererSafeSync: false,
    })
    expect(first.lifecycle.state).toBe('recovering')

    harness.registry.resetAll('route-change')
    expect(harness.registry.get('renderer-2')?.lifecycle.state).toBe('recovering')
    expect(harness.cleared.some(({ reason }) => reason === 'route-change')).toBe(true)

    expect(harness.registry.remove('renderer-1', 'worker-destroy')).toBe(first)
    expect(first.lifecycle.state).toBe('destroyed')
    harness.registry.destroyAll('pagehide')
    expect(harness.registry.diagnostics()).toMatchObject({
      claimedCanvasCount: 0,
      instanceCount: 0,
      orphanCount: 0,
    })
  })

  it('keeps Map mutation and orphan recovery out of the MAIN-world entry', () => {
    const entry = readFileSync(resolve(process.cwd(), 'src/entries/douyin-page-hook.ts'), 'utf8')
    const runtime = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/page-runtime.ts'),
      'utf8',
    )
    const app = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/page-app.ts'),
      'utf8',
    )

    expect(entry).toContain('createDouyinPageAppRuntime')
    expect(app).toContain('createRendererInstanceRegistry')
    expect(app).toContain('instanceRegistry.get')
    expect(app).toContain('instanceRegistry.remove')
    expect(entry).not.toContain('instanceRegistry.recover')
    expect(entry).not.toContain('instanceRegistry.resetAll("route-change")')
    expect(entry).not.toContain('instanceRegistry.sweepDetached')
    expect(runtime).toContain('options.registry.recover()')
    expect(runtime).toContain("options.registry.resetAll('route-change')")
    expect(runtime).toContain('options.registry.sweepDetached()')
    expect(app).not.toContain('instances.set(')
    expect(app).not.toContain('instances.delete(')
    expect(app).not.toContain('orphanMessages')
    expect(app).not.toContain('function createTrackedInstance')
    expect(app).not.toContain('function recoverOrphans')
  })
})

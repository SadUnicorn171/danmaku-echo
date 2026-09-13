import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createDouyinPageRuntime,
  type DouyinPageRuntime,
  type DouyinPageRuntimeInstance,
  type DouyinPageRuntimeOptions,
} from '../page-runtime'

interface HarnessCounters {
  bridgeDestroy: number
  bridgeStart: number
  canvasDestroy: number
  canvasInstall: number
  diagnosticsDestroy: number
  destroyAll: number
  recover: number
  relayout: number
  relayoutError: number
  resetAll: number
  retry: number
  started: number
  sweepDetached: number
  trackDestroy: number
  trackStart: number
  workerDestroy: number
  workerInstall: number
}

interface Harness {
  counters: HarnessCounters
  events: Array<{ details: unknown; level: string; type: string }>
  instances: DouyinPageRuntimeInstance[]
  now(value: number): void
  relayoutShouldFail(value: boolean): void
  resumed: DouyinPageRuntimeInstance[]
  runtime: DouyinPageRuntime
  suspended: Array<{ instance: DouyinPageRuntimeInstance; reason: string }>
}

const runtimes: DouyinPageRuntime[] = []

function pageTransition(type: 'pagehide' | 'pageshow', persisted: boolean): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'persisted', { configurable: true, value: persisted })
  return event
}

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
}

function setFullscreenElement(element: Element | null): void {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element })
}

function createInstance(
  options: Partial<DouyinPageRuntimeInstance> = {},
): DouyinPageRuntimeInstance {
  const canvas = document.createElement('canvas')
  const rendererLayer = document.createElement('div')
  return {
    active: true,
    canvas,
    canvasEverConnected: false,
    mountGraceUntil: 5_000,
    pending: [],
    pushTimer: 0,
    rendererLayer,
    ...options,
  }
}

function createHarness(initialNow = 1_000): Harness {
  let currentTime = initialNow
  let relayoutFails = false
  const instances: DouyinPageRuntimeInstance[] = []
  const resumed: DouyinPageRuntimeInstance[] = []
  const suspended: Array<{ instance: DouyinPageRuntimeInstance; reason: string }> = []
  const events: Array<{ details: unknown; level: string; type: string }> = []
  const counters: HarnessCounters = {
    bridgeDestroy: 0,
    bridgeStart: 0,
    canvasDestroy: 0,
    canvasInstall: 0,
    diagnosticsDestroy: 0,
    destroyAll: 0,
    recover: 0,
    relayout: 0,
    relayoutError: 0,
    resetAll: 0,
    retry: 0,
    started: 0,
    sweepDetached: 0,
    trackDestroy: 0,
    trackStart: 0,
    workerDestroy: 0,
    workerInstall: 0,
  }
  const options: DouyinPageRuntimeOptions<DouyinPageRuntimeInstance> = {
    bridge: {
      destroy: () => {
        counters.bridgeDestroy += 1
      },
      start: () => {
        counters.bridgeStart += 1
      },
    },
    canvasHook: {
      destroy: () => {
        counters.canvasDestroy += 1
      },
      install: () => {
        counters.canvasInstall += 1
        return true
      },
    },
    diagnostics: {
      destroy: () => {
        counters.diagnosticsDestroy += 1
      },
      record: (type, details = {}, level = 'debug') => {
        events.push({ details, level, type })
        return true
      },
    },
    document,
    heartbeatTimeout: 1_000,
    maintenanceInterval: 100,
    mountRetry: 25,
    now: () => currentTime,
    onRelayout: () => {
      counters.relayout += 1
      if (relayoutFails) throw new Error('relayout failed')
    },
    onRelayoutError: () => {
      counters.relayoutError += 1
    },
    onResumeInstance: (instance) => {
      resumed.push(instance)
    },
    onRetryPending: (_instance, delay) => {
      expect(delay).toBe(25)
      counters.retry += 1
    },
    onStarted: () => {
      counters.started += 1
    },
    onSuspendInstance: (instance, reason) => {
      suspended.push({ instance, reason })
    },
    registry: {
      destroyAll: () => {
        counters.destroyAll += 1
      },
      recover: () => {
        counters.recover += 1
        return 0
      },
      resetAll: () => {
        counters.resetAll += 1
      },
      sweepDetached: () => {
        counters.sweepDetached += 1
        return 0
      },
      values: () => instances.values(),
    },
    target: window,
    trackController: {
      destroy: () => {
        counters.trackDestroy += 1
      },
      start: () => {
        counters.trackStart += 1
      },
    },
    workerHook: {
      destroy: () => {
        counters.workerDestroy += 1
      },
      install: () => {
        counters.workerInstall += 1
        return true
      },
    },
  }
  const runtime = createDouyinPageRuntime(options)
  runtimes.push(runtime)
  return {
    counters,
    events,
    instances,
    now(value) {
      currentTime = value
    },
    relayoutShouldFail(value) {
      relayoutFails = value
    },
    resumed,
    runtime,
    suspended,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  history.replaceState(null, '', '/live/room-one')
  setDocumentHidden(false)
  setFullscreenElement(null)
})

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.destroy()
  vi.useRealTimers()
  document.body.replaceChildren()
  setDocumentHidden(false)
  setFullscreenElement(null)
})

describe('Douyin MAIN world page runtime', () => {
  it('starts and destroys every owned resource idempotently', () => {
    const harness = createHarness()

    expect(harness.runtime.start()).toBe(true)
    expect(harness.runtime.start()).toBe(false)
    expect(harness.counters).toMatchObject({
      bridgeStart: 1,
      canvasInstall: 1,
      started: 1,
      trackStart: 1,
      workerInstall: 1,
    })
    expect(harness.runtime.destroy()).toBe(true)
    expect(harness.runtime.destroy()).toBe(false)
    expect(harness.counters).toMatchObject({
      bridgeDestroy: 1,
      canvasDestroy: 1,
      diagnosticsDestroy: 1,
      destroyAll: 1,
      trackDestroy: 1,
      workerDestroy: 1,
    })
    expect(harness.runtime.start()).toBe(false)
  })

  it('disables and suspends the renderer after a visible-page heartbeat timeout', () => {
    const harness = createHarness()
    const instance = createInstance()
    harness.instances.push(instance)
    harness.runtime.start()
    harness.runtime.updateRendererSettings(true, true)
    harness.now(2_001)

    vi.advanceTimersByTime(100)

    expect(harness.runtime.isRendererEnabled()).toBe(false)
    expect(harness.runtime.isRepeatReminderEnabled()).toBe(false)
    expect(harness.suspended.at(-1)).toEqual({ instance, reason: 'heartbeat-timeout' })
    expect(harness.events.at(-1)).toMatchObject({ type: 'renderer-heartbeat-timeout' })
  })

  it('resets only when the SPA route key changes and keeps detached recovery running', () => {
    const harness = createHarness()
    const instance = createInstance({ mountGraceUntil: 5_000, pending: [{}] })
    harness.instances.push(instance)
    harness.runtime.start()

    history.replaceState(null, '', '/live/room-one?source=feed')
    vi.advanceTimersByTime(100)
    expect(harness.counters.resetAll).toBe(0)
    expect(harness.counters).toMatchObject({ recover: 1, retry: 1, sweepDetached: 1 })

    history.replaceState(null, '', '/live/room-two')
    vi.advanceTimersByTime(100)
    expect(harness.counters.resetAll).toBe(1)
    expect(harness.events.some(({ type }) => type === 'renderer-route-reset')).toBe(true)
  })

  it('restores Canvas while hidden and resumes active instances when visible again', () => {
    const harness = createHarness()
    const instance = createInstance()
    harness.instances.push(instance)
    harness.runtime.start()
    harness.runtime.updateRendererSettings(true, false)
    harness.suspended.splice(0)
    harness.resumed.splice(0)

    setDocumentHidden(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(harness.suspended).toEqual([{ instance, reason: 'document-hidden' }])

    setDocumentHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(harness.resumed).toEqual([instance])
    expect(harness.events.slice(-2).map(({ type }) => type)).toEqual([
      'page-runtime-hidden',
      'page-runtime-visible',
    ])
  })

  it('handles Canvas fullscreen and relayout failures through runtime callbacks', () => {
    const harness = createHarness()
    const instance = createInstance()
    document.body.append(instance.canvas, instance.rendererLayer as HTMLElement)
    harness.instances.push(instance)
    harness.runtime.start()

    setFullscreenElement(instance.canvas)
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(harness.suspended.at(-1)?.reason).toBe('canvas-is-fullscreen-element')

    setFullscreenElement(null)
    harness.relayoutShouldFail(true)
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(harness.counters).toMatchObject({ relayout: 1, relayoutError: 1 })
  })

  it('suspends and safely restarts hooks once across a BFCache round trip', () => {
    const harness = createHarness()
    harness.runtime.start()

    window.dispatchEvent(pageTransition('pagehide', true))
    expect(harness.runtime.diagnostics()).toMatchObject({ active: false, suspended: true })
    expect(harness.counters).toMatchObject({
      bridgeDestroy: 1,
      canvasDestroy: 1,
      trackDestroy: 1,
      workerDestroy: 1,
    })

    window.dispatchEvent(pageTransition('pageshow', true))
    expect(harness.runtime.diagnostics()).toMatchObject({ active: true, suspended: false })
    expect(harness.counters).toMatchObject({
      bridgeStart: 2,
      canvasInstall: 2,
      trackStart: 2,
      workerInstall: 2,
    })
  })

  it('keeps lifecycle listeners, maintenance, and hook ownership out of the page entry', () => {
    const entrySource = readFileSync(
      resolve(process.cwd(), 'src/entries/douyin-page-hook.ts'),
      'utf8',
    )

    expect(entrySource).toContain('createDouyinPageAppRuntime')
    expect(entrySource).toContain('globalThis.__danmakuEchoDouyinPageRuntime = pageRuntime')
    expect(entrySource).not.toMatch(/\bsetInterval\(/u)
    expect(entrySource).not.toContain('canvasHook.install()')
    expect(entrySource).not.toContain('workerHook.install()')
    expect(entrySource).not.toContain('pageBridge.start()')
    expect(entrySource).not.toContain('trackController.start()')
    expect(entrySource).not.toContain('addEventListener("fullscreenchange"')
    expect(entrySource).not.toContain('addEventListener("pagehide"')
    expect(entrySource).not.toContain('addEventListener("pageshow"')
  })
})

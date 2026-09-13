import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeSettings } from '../../../../core/shared'
import type { DiagnosticsSnapshotV1, ExtensionSettings } from '../../../../core/types'
import type { DouyinContentDiagnostics } from '../content-diagnostics'
import {
  createDouyinContentRuntime,
  type DouyinRuntimeBrowserBindings,
  type DouyinRuntimeService,
} from '../content-runtime'
import type { DouyinPageBridge } from '../page-bridge'

function service(name: string, calls: string[]): DouyinRuntimeService {
  return {
    destroy: vi.fn<() => void>(() => calls.push(`${name}.destroy`)),
    start: vi.fn<() => void>(() => calls.push(`${name}.start`)),
  }
}

function createHarness() {
  const calls: string[] = []
  let diagnosticsListener: Parameters<DouyinRuntimeBrowserBindings['addDiagnosticsListener']>[0]
    | null = null
  let storageListener: Parameters<DouyinRuntimeBrowserBindings['addStorageListener']>[0]
    | null = null
  let href = 'https://live.douyin.com/100'
  let settings: ExtensionSettings = mergeSettings()
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })

  const bridge: DouyinPageBridge = {
    beginRecovery: vi.fn<() => void>(() => calls.push('bridge.recover')),
    destroy: vi.fn<() => void>(() => calls.push('bridge.destroy')),
    heartbeat: () => calls.push('bridge.heartbeat'),
    isReady: () => true,
    markUnavailable: vi.fn<() => void>(() => calls.push('bridge.unavailable')),
    observeWindowMessage: () => ({ cancel: () => {}, result: Promise.resolve(null) }),
    pendingRequestCount: () => 0,
    ping: () => ({ requestId: 1, response: Promise.resolve(null) }),
    requestDebugSnapshot: () => ({ requestId: 1, response: Promise.resolve(null) }),
    send: () => {},
    sendRendererSettings: () => calls.push('bridge.settings'),
    start: vi.fn<() => void>(() => calls.push('bridge.start')),
  }
  const debug: DouyinContentDiagnostics = {
    destroy: vi.fn<() => void>(() => calls.push('debug.destroy')),
    event: () => {},
    snapshot: () => ({}),
    syncMarker: vi.fn<() => void>(() => calls.push('debug.sync')),
  }
  const bindings: DouyinRuntimeBrowserBindings = {
    addDiagnosticsListener(listener): void {
      diagnosticsListener = listener
      calls.push('runtime-listener.add')
    },
    addStorageListener(listener): void {
      storageListener = listener
      calls.push('storage-listener.add')
    },
    async loadSettings(): Promise<unknown> {
      calls.push('settings.load')
      return { altClick: false }
    },
    removeDiagnosticsListener(): void {
      diagnosticsListener = null
      calls.push('runtime-listener.remove')
    },
    removeStorageListener(): void {
      storageListener = null
      calls.push('storage-listener.remove')
    },
  }
  const controllers = [service('controller-a', calls), service('controller-b', calls)]
  const observers = [service('observer-a', calls), service('observer-b', calls)]
  const features = {
    applySettings: vi.fn<(next: ExtensionSettings) => void>(() => calls.push('features.apply')),
    destroy: vi.fn<() => void>(() => calls.push('features.destroy')),
    start: vi.fn<() => void>(() => calls.push('features.start')),
  }
  const runtime = createDouyinContentRuntime({
    bindings,
    bridge,
    controllers,
    debug,
    diagnostics: {
      record: () => {},
      snapshot: () => ({}) as DiagnosticsSnapshotV1,
    },
    document,
    ensureEmojiCatalog: vi.fn<() => void>(() => calls.push('emoji.start')),
    features,
    href: () => href,
    observers,
    onDeactivate: vi.fn<() => void>(() => calls.push('runtime.deactivate')),
    onRouteChanged: vi.fn<() => void>(() => calls.push('route.changed')),
    rendererSettings: () => ({
      actions: settings.actions,
      capsuleScalePercent: settings.interfaceScale.capsulePercent,
      enabled: settings.enabled,
      repeatReminderEnabled: settings.repeatReminder.enabled,
      version: 'test',
    }),
    rendererVersion: 'test',
    settings: {
      applyDocument: () => calls.push('settings.document'),
      current: () => settings,
      disableInteractions: () => calls.push('settings.disable'),
      enabled: () => settings.enabled,
      merge: (saved) => mergeSettings(saved),
      refreshObservers: () => calls.push('observers.refresh'),
      renderActions: () => calls.push('actions.render'),
      replace(next): void {
        settings = next
        calls.push('settings.apply')
      },
    },
    window,
  })
  return {
    bridge,
    calls,
    controllers,
    diagnosticsListener: () => diagnosticsListener,
    features,
    observers,
    runtime,
    setHref(value: string): void {
      href = value
    },
    storageListener: () => storageListener,
  }
}

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
})

describe('DouyinContentRuntime', () => {
  it('keeps the isolated-world entry strict and limited to runtime startup', () => {
    const entry = readFileSync(
      resolvePath(process.cwd(), 'src/entries/douyin-content.ts'),
      'utf8',
    )

    expect(entry).not.toContain('@ts-nocheck')
    expect(entry.split(/\r?\n/u).length).toBeLessThanOrEqual(30)
    expect(entry).toContain('createDouyinContentApp')
    expect(entry).toContain('void runtime.start()')
    expect(entry).not.toMatch(/createDouyin(?:ChatParser|DomHoverController|SendController)/u)
    expect(entry).not.toMatch(/(?:setInterval|setTimeout|MutationObserver|addEventListener)/u)
  })

  it('starts bridge, settings, features, controllers and observers exactly once in order', async () => {
    vi.useFakeTimers()
    const harness = createHarness()

    await Promise.all([harness.runtime.start(), harness.runtime.start()])

    expect(harness.calls.indexOf('bridge.start')).toBeLessThan(harness.calls.indexOf('settings.load'))
    expect(harness.calls.indexOf('settings.apply')).toBeLessThan(harness.calls.indexOf('features.start'))
    expect(harness.calls.indexOf('features.start')).toBeLessThan(harness.calls.indexOf('controller-a.start'))
    expect(harness.calls.indexOf('controller-b.start')).toBeLessThan(harness.calls.indexOf('observer-a.start'))
    expect(harness.features.start).toHaveBeenCalledTimes(1)
    expect(harness.controllers[0].start).toHaveBeenCalledTimes(1)
    expect(harness.observers[0].start).toHaveBeenCalledTimes(1)

    harness.runtime.destroy()
  })

  it('pauses on hidden, resumes without recreating features, and follows SPA route changes', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    await harness.runtime.start()

    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(harness.observers[1].destroy).toHaveBeenCalledTimes(1)
    expect(harness.controllers[1].destroy).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(harness.features.start).toHaveBeenCalledTimes(1)
    expect(harness.observers[0].start).toHaveBeenCalledTimes(2)

    harness.setHref('https://live.douyin.com/200')
    await vi.advanceTimersByTimeAsync(1_000)
    harness.setHref('https://www.douyin.com/')
    await vi.advanceTimersByTimeAsync(1_000)
    harness.setHref('https://live.douyin.com/300')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(harness.bridge.markUnavailable).toHaveBeenCalledTimes(3)
    expect(harness.calls).toContain('route.changed')
    expect(harness.features.start).toHaveBeenCalledTimes(1)

    harness.runtime.destroy()
  })

  it('owns storage/runtime listeners and destroys resources in reverse layers idempotently', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    await harness.runtime.start()
    expect(harness.storageListener()).toBeTypeOf('function')
    expect(harness.diagnosticsListener()).toBeTypeOf('function')

    harness.runtime.destroy()
    harness.runtime.destroy()

    expect(harness.storageListener()).toBeNull()
    expect(harness.diagnosticsListener()).toBeNull()
    expect(harness.features.destroy).toHaveBeenCalledTimes(1)
    expect(harness.bridge.destroy).toHaveBeenCalledTimes(1)
    const observerDestroy = harness.calls.indexOf('observer-b.destroy')
    const controllerDestroy = harness.calls.indexOf('controller-b.destroy')
    const featureDestroy = harness.calls.indexOf('features.destroy')
    const bridgeDestroy = harness.calls.indexOf('bridge.destroy')
    expect(observerDestroy).toBeLessThan(controllerDestroy)
    expect(controllerDestroy).toBeLessThan(featureDestroy)
    expect(featureDestroy).toBeLessThan(bridgeDestroy)
  })
})

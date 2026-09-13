import type { DiagnosticsSnapshotV1, ExtensionSettings } from '../../../core/types'
import type { DouyinPageBridge, DouyinRendererSettingsInput } from './page-bridge'
import type {
  DouyinContentDebugLevel,
  DouyinContentDiagnostics,
} from './content-diagnostics'

export interface DouyinRuntimeService {
  destroy(): void
  start(): void
}

export interface DouyinRuntimeFeatures {
  applySettings(settings: ExtensionSettings): void
  destroy(): void
  start(): void
}

export interface DouyinRuntimeEventBinding {
  listener: EventListener
  options?: AddEventListenerOptions | boolean
  target: EventTarget
  type: string
}

export interface DouyinRuntimeBrowserBindings {
  addDiagnosticsListener(listener: RuntimeMessageListener): void
  addStorageListener(listener: StorageChangeListener): void
  loadSettings(): Promise<unknown>
  removeDiagnosticsListener(listener: RuntimeMessageListener): void
  removeStorageListener(listener: StorageChangeListener): void
}

type RuntimeMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined

type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void

export interface DouyinContentRuntimeSettings {
  applyDocument(settings: ExtensionSettings): void
  current(): ExtensionSettings
  disableInteractions(): void
  enabled(): boolean
  merge(saved?: unknown): ExtensionSettings
  refreshObservers(): void
  renderActions(): void
  replace(settings: ExtensionSettings): void
}

export interface DouyinContentRuntimeOptions {
  bindings: DouyinRuntimeBrowserBindings
  bridge: DouyinPageBridge
  controllers: readonly DouyinRuntimeService[]
  debug: DouyinContentDiagnostics
  diagnostics: {
    record(event: { stage?: string; type: string }): void
    snapshot(): DiagnosticsSnapshotV1
  }
  document: Document
  ensureEmojiCatalog(): void | Promise<unknown>
  eventBindings?: readonly DouyinRuntimeEventBinding[]
  features: DouyinRuntimeFeatures
  href(): string
  observers: readonly DouyinRuntimeService[]
  onDeactivate?(): void
  onRouteChanged?(): void
  rendererSettings(): DouyinRendererSettingsInput
  rendererVersion: string
  settings: DouyinContentRuntimeSettings
  window: Window
}

export interface DouyinContentRuntime {
  destroy(): void
  handlePageReady(version: string): void
  postRendererSettings(reason: string, overrideEnabled?: boolean): void
  start(): Promise<void>
}

const HEARTBEAT_INTERVAL = 5_000
const ROUTE_POLL_INTERVAL = 1_000

export function createChromeDouyinRuntimeBindings(): DouyinRuntimeBrowserBindings {
  return {
    addDiagnosticsListener(listener): void {
      globalThis.chrome?.runtime?.onMessage?.addListener(listener)
    },
    addStorageListener(listener): void {
      globalThis.chrome?.storage?.onChanged?.addListener(listener)
    },
    loadSettings(): Promise<unknown> {
      return new Promise((resolve) => {
        if (!globalThis.chrome?.storage?.sync) {
          resolve({})
          return
        }
        chrome.storage.sync.get(null, (value) => resolve(value || {}))
      })
    },
    removeDiagnosticsListener(listener): void {
      globalThis.chrome?.runtime?.onMessage?.removeListener(listener)
    },
    removeStorageListener(listener): void {
      globalThis.chrome?.storage?.onChanged?.removeListener(listener)
    },
  }
}

export function createDouyinContentRuntime(
  options: DouyinContentRuntimeOptions,
): DouyinContentRuntime {
  let active = false
  let destroyed = false
  let featuresStarted = false
  let heartbeatTimer: ReturnType<typeof setInterval> | 0 = 0
  let lastUrl = options.href()
  let listenersAttached = false
  let routePollTimer: ReturnType<typeof setInterval> | 0 = 0
  let startPromise: Promise<void> | null = null

  function debug(type: string, details?: unknown, level?: DouyinContentDebugLevel): void {
    options.debug.event(type, details, level)
  }

  function postRendererSettings(reason: string, overrideEnabled?: boolean): void {
    const settings = options.rendererSettings()
    if (typeof overrideEnabled === 'boolean') settings.enabled = overrideEnabled
    if (reason === 'heartbeat') options.bridge.heartbeat(settings)
    else options.bridge.sendRendererSettings(settings, reason)
    debug('renderer-settings-sent', { enabled: settings.enabled, reason: reason || 'sync' })
  }

  function applySettings(saved: unknown): void {
    const settings = options.settings.merge(saved)
    options.settings.replace(settings)
    if (featuresStarted) options.features.applySettings(settings)
    options.settings.applyDocument(settings)
    options.settings.renderActions()
    debug('settings-applied', {
      enabled: settings.enabled,
      douyin: settings.platforms.douyin,
      altClick: settings.altClick,
    })
    if (!options.settings.enabled()) options.settings.disableInteractions()
    if (active) options.settings.refreshObservers()
    postRendererSettings('settings-applied')
  }

  function stopTimers(): void {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (routePollTimer) clearInterval(routePollTimer)
    heartbeatTimer = 0
    routePollTimer = 0
  }

  function checkRoute(): void {
    const href = options.href()
    if (lastUrl === href) return
    lastUrl = href
    debug('spa-url-changed', { href }, 'info')
    options.diagnostics.record({ type: 'route.changed', stage: 'fallback' })
    options.settings.disableInteractions()
    options.onRouteChanged?.()
    options.bridge.markUnavailable()
    options.bridge.beginRecovery()
    postRendererSettings('spa-url-change')
  }

  function startTimers(): void {
    if (options.document.hidden || destroyed) return
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(() => postRendererSettings('heartbeat'), HEARTBEAT_INTERVAL)
    }
    if (!routePollTimer) {
      routePollTimer = setInterval(() => {
        checkRoute()
        options.settings.refreshObservers()
      }, ROUTE_POLL_INTERVAL)
    }
  }

  function activate(): void {
    if (active || destroyed) return
    for (const service of options.controllers) service.start()
    for (const observer of options.observers) observer.start()
    active = true
  }

  function deactivate(): void {
    if (!active) return
    for (const observer of [...options.observers].reverse()) observer.destroy()
    for (const service of [...options.controllers].reverse()) service.destroy()
    active = false
    stopTimers()
    options.onDeactivate?.()
  }

  const onVisibilityChange = (): void => {
    if (options.document.hidden) {
      deactivate()
      return
    }
    activate()
    startTimers()
    checkRoute()
    postRendererSettings('document-visible')
  }

  const onPageHide = (): void => {
    postRendererSettings('pagehide', false)
    destroy()
  }

  const onDiagnosticsMessage: RuntimeMessageListener = (message, _sender, sendResponse) => {
    if (!message || (message as { type?: unknown }).type !== 'danmaku-echo.diagnostics.snapshot') {
      return false
    }
    sendResponse({ ok: true, snapshot: options.diagnostics.snapshot() })
    return false
  }

  const onStorageChanged: StorageChangeListener = (_changes, areaName) => {
    if (areaName !== 'sync' || destroyed) return
    void options.bindings.loadSettings().then((saved) => {
      if (!destroyed) applySettings(saved)
    })
  }

  function attachListeners(): void {
    if (listenersAttached) return
    options.document.addEventListener('visibilitychange', onVisibilityChange)
    options.window.addEventListener('pagehide', onPageHide, { once: true })
    options.bindings.addDiagnosticsListener(onDiagnosticsMessage)
    options.bindings.addStorageListener(onStorageChanged)
    for (const binding of options.eventBindings ?? []) {
      binding.target.addEventListener(binding.type, binding.listener, binding.options)
    }
    listenersAttached = true
  }

  function detachListeners(): void {
    if (!listenersAttached) return
    for (const binding of [...(options.eventBindings ?? [])].reverse()) {
      binding.target.removeEventListener(binding.type, binding.listener, binding.options)
    }
    options.bindings.removeStorageListener(onStorageChanged)
    options.bindings.removeDiagnosticsListener(onDiagnosticsMessage)
    options.window.removeEventListener('pagehide', onPageHide)
    options.document.removeEventListener('visibilitychange', onVisibilityChange)
    listenersAttached = false
  }

  function start(): Promise<void> {
    if (startPromise) return startPromise
    startPromise = (async () => {
      if (destroyed) return
      options.bridge.start()
      const saved = await options.bindings.loadSettings()
      if (destroyed) return
      applySettings(saved)
      options.features.start()
      featuresStarted = true
      options.features.applySettings(options.settings.current())
      if (!options.document.hidden) activate()
      attachListeners()
      options.bridge.beginRecovery()
      void options.ensureEmojiCatalog()
      startTimers()
      debug(
        'content-loaded',
        {
          href: options.href(),
          readyState: options.document.readyState,
          version: options.rendererVersion,
        },
        'info',
      )
      options.debug.syncMarker()
    })()
    return startPromise
  }

  function handlePageReady(version: string): void {
    debug('page-runtime-ready', { version }, 'info')
    postRendererSettings('page-ready')
  }

  function destroy(): void {
    if (destroyed) return
    destroyed = true
    detachListeners()
    deactivate()
    stopTimers()
    if (featuresStarted) options.features.destroy()
    featuresStarted = false
    options.debug.destroy()
    options.bridge.destroy()
  }

  return Object.freeze({ destroy, handlePageReady, postRendererSettings, start })
}

import type { DouyinPageDebugLevel, Milliseconds, TimestampMilliseconds } from './runtime-types'

export interface DouyinPageRuntimeHook {
  destroy(): void
  install(): boolean
}

export interface DouyinPageRuntimeStartable {
  destroy(): void
  start(): void
}

export interface DouyinPageRuntimeDiagnostics {
  destroy(): void
  record(type: string, details?: unknown, level?: DouyinPageDebugLevel): boolean
}

export interface DouyinPageRuntimeInstance {
  active: boolean
  canvas: HTMLCanvasElement
  canvasEverConnected: boolean
  mountGraceUntil: TimestampMilliseconds
  pending: readonly unknown[]
  pushTimer: number
  rendererLayer: HTMLElement | null
}

export interface DouyinPageRuntimeRegistry<Instance extends DouyinPageRuntimeInstance> {
  destroyAll(reason: string): void
  recover(): number
  resetAll(reason: string): void
  sweepDetached(): number
  values(): IterableIterator<Instance>
}

export interface DouyinPageRuntimeOptions<Instance extends DouyinPageRuntimeInstance> {
  bridge: DouyinPageRuntimeStartable
  canvasHook: DouyinPageRuntimeHook
  diagnostics: DouyinPageRuntimeDiagnostics
  document: Document
  heartbeatTimeout: Milliseconds
  maintenanceInterval?: Milliseconds
  mountRetry: Milliseconds
  now?: () => TimestampMilliseconds
  onDestroy?(): void
  onRelayout(instance: Instance): void
  onRelayoutError(instance: Instance, error: unknown): void
  onResumeInstance(instance: Instance): void
  onRetryPending(instance: Instance, delay: Milliseconds): void
  onStarted?(): void
  onSuspendInstance(instance: Instance, reason: string): void
  registry: DouyinPageRuntimeRegistry<Instance>
  target: Window
  trackController: DouyinPageRuntimeStartable
  workerHook: DouyinPageRuntimeHook
}

export interface DouyinPageRuntimeSettingsUpdate {
  enabled: boolean
  enabledChanged: boolean
  previousEnabled: boolean
  previousRepeatReminderEnabled: boolean
  repeatReminderEnabled: boolean
  repeatReminderEnabledChanged: boolean
}

export interface DouyinPageRuntimeDiagnosticsSnapshot {
  active: boolean
  destroyed: boolean
  generation: number
  heartbeatAge: Milliseconds | null
  maintenanceScheduled: boolean
  rendererEnabled: boolean
  repeatReminderEnabled: boolean
  suspended: boolean
}

export interface DouyinPageRuntime {
  destroy(): boolean
  diagnostics(): DouyinPageRuntimeDiagnosticsSnapshot
  isActive(): boolean
  isRendererEnabled(): boolean
  isRepeatReminderEnabled(): boolean
  start(): boolean
  updateRendererSettings(enabled: boolean, repeatReminderEnabled: boolean): DouyinPageRuntimeSettingsUpdate
}

function boundedDelay(value: number | undefined, fallback: number, minimum: number): number {
  const candidate = Number(value)
  return Math.max(minimum, Number.isFinite(candidate) ? Math.floor(candidate) : fallback)
}

export function douyinPageRouteKey(value: unknown, baseHref: string): string {
  try {
    const url = new URL(String(value ?? ''), baseHref)
    const pathname = url.pathname.replace(/\/+$/u, '') || '/'
    return `${url.origin}${pathname}`
  } catch {
    return String(value ?? '').split(/[?#]/u, 1)[0]
  }
}

export function createDouyinPageRuntime<Instance extends DouyinPageRuntimeInstance>(
  options: DouyinPageRuntimeOptions<Instance>,
): DouyinPageRuntime {
  const now = options.now ?? Date.now
  const maintenanceInterval = boundedDelay(options.maintenanceInterval, 500, 100)
  const heartbeatTimeout = boundedDelay(options.heartbeatTimeout, 15_000, 1_000)
  const mountRetry = boundedDelay(options.mountRetry, 100, 0)
  let active = false
  let destroyed = false
  let generation = 0
  let heartbeatAt: TimestampMilliseconds | 0 = 0
  let maintenanceTimer = 0
  let rendererEnabled = false
  let repeatReminderEnabled = false
  let suspended = false
  let lifecycleListenersInstalled = false
  let runtimeHref = options.target.location.href
  let runtimeRouteKey = douyinPageRouteKey(runtimeHref, runtimeHref)

  const suspendInstances = (reason: string): void => {
    for (const instance of options.registry.values()) {
      options.onSuspendInstance(instance, reason)
    }
  }

  const resumeInstances = (): void => {
    if (!rendererEnabled || options.document.hidden) return
    for (const instance of options.registry.values()) {
      if (instance.active) options.onResumeInstance(instance)
    }
  }

  const handleHeartbeat = (currentTime: TimestampMilliseconds): void => {
    if (
      !rendererEnabled ||
      options.document.hidden ||
      !heartbeatAt ||
      currentTime - heartbeatAt <= heartbeatTimeout
    ) {
      return
    }
    const age = currentTime - heartbeatAt
    rendererEnabled = false
    repeatReminderEnabled = false
    suspendInstances('heartbeat-timeout')
    options.diagnostics.record('renderer-heartbeat-timeout', { age }, 'warn')
  }

  const handleRoute = (): void => {
    const href = options.target.location.href
    if (href === runtimeHref) return
    const previousHref = runtimeHref
    runtimeHref = href
    const nextRouteKey = douyinPageRouteKey(href, runtimeHref)
    if (nextRouteKey === runtimeRouteKey) return
    const previousRouteKey = runtimeRouteKey
    runtimeRouteKey = nextRouteKey
    options.registry.resetAll('route-change')
    options.diagnostics.record('renderer-route-reset', {
      href,
      previousHref,
      previousRouteKey,
      routeKey: nextRouteKey,
    })
  }

  const maintainInstances = (currentTime: TimestampMilliseconds): void => {
    for (const instance of options.registry.values()) {
      if (
        !instance.canvas.isConnected &&
        !instance.canvasEverConnected &&
        currentTime < instance.mountGraceUntil &&
        instance.pending.length > 0 &&
        !instance.pushTimer
      ) {
        options.onRetryPending(instance, mountRetry)
      }
    }
    options.registry.sweepDetached()
    options.registry.recover()
  }

  const maintenanceTick = (expectedGeneration: number): void => {
    if (!active || destroyed || expectedGeneration !== generation) return
    const currentTime = now()
    handleHeartbeat(currentTime)
    handleRoute()
    maintainInstances(currentTime)
  }

  const onFullscreenChange = (): void => {
    if (!active || destroyed) return
    for (const instance of options.registry.values()) {
      if (options.document.fullscreenElement === instance.canvas) {
        options.onSuspendInstance(instance, 'canvas-is-fullscreen-element')
        continue
      }
      if (!instance.rendererLayer || !instance.canvas.isConnected) continue
      try {
        options.onRelayout(instance)
      } catch (error) {
        options.onRelayoutError(instance, error)
      }
    }
  }

  const onVisibilityChange = (): void => {
    if (!active || destroyed) return
    if (options.document.hidden) {
      suspendInstances('document-hidden')
      options.diagnostics.record('page-runtime-hidden')
      return
    }
    if (rendererEnabled) heartbeatAt = now()
    resumeInstances()
    options.diagnostics.record('page-runtime-visible')
  }

  const stopActiveResources = (reason: string): void => {
    if (maintenanceTimer) options.target.clearInterval(maintenanceTimer)
    maintenanceTimer = 0
    if (active) {
      options.document.removeEventListener('fullscreenchange', onFullscreenChange)
      options.document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    active = false
    generation += 1
    suspendInstances(reason)
    options.trackController.destroy()
    options.bridge.destroy()
    options.workerHook.destroy()
    options.canvasHook.destroy()
  }

  const onPageHide = (event: PageTransitionEvent): void => {
    if (destroyed) return
    if (event.persisted) {
      suspended = true
      options.diagnostics.record('page-runtime-suspended', { reason: 'pagehide-persisted' })
      stopActiveResources('pagehide-persisted')
      return
    }
    runtime.destroy()
  }

  const onPageShow = (event: PageTransitionEvent): void => {
    if (!event.persisted || destroyed || !suspended) return
    runtime.start()
  }

  const installLifecycleListeners = (): void => {
    if (lifecycleListenersInstalled) return
    options.target.addEventListener('pagehide', onPageHide)
    options.target.addEventListener('pageshow', onPageShow)
    lifecycleListenersInstalled = true
  }

  const removeLifecycleListeners = (): void => {
    if (!lifecycleListenersInstalled) return
    options.target.removeEventListener('pagehide', onPageHide)
    options.target.removeEventListener('pageshow', onPageShow)
    lifecycleListenersInstalled = false
  }

  const runtime: DouyinPageRuntime = {
    destroy() {
      if (destroyed) return false
      options.diagnostics.record('page-runtime-destroyed', { generation }, 'info')
      stopActiveResources('page-runtime-destroyed')
      removeLifecycleListeners()
      options.registry.destroyAll('page-runtime-destroyed')
      rendererEnabled = false
      repeatReminderEnabled = false
      heartbeatAt = 0
      suspended = false
      destroyed = true
      options.diagnostics.destroy()
      options.onDestroy?.()
      return true
    },
    diagnostics: () => ({
      active,
      destroyed,
      generation,
      heartbeatAge: heartbeatAt ? Math.max(0, now() - heartbeatAt) : null,
      maintenanceScheduled: Boolean(maintenanceTimer),
      rendererEnabled,
      repeatReminderEnabled,
      suspended,
    }),
    isActive: () => active,
    isRendererEnabled: () => rendererEnabled,
    isRepeatReminderEnabled: () => repeatReminderEnabled,
    start() {
      if (destroyed || active) return false
      installLifecycleListeners()
      generation += 1
      const currentGeneration = generation
      options.canvasHook.install()
      options.workerHook.install()
      options.bridge.start()
      options.trackController.start()
      options.document.addEventListener('fullscreenchange', onFullscreenChange)
      options.document.addEventListener('visibilitychange', onVisibilityChange)
      active = true
      suspended = false
      runtimeHref = options.target.location.href
      runtimeRouteKey = douyinPageRouteKey(runtimeHref, runtimeHref)
      if (rendererEnabled) heartbeatAt = now()
      maintenanceTimer = options.target.setInterval(
        () => maintenanceTick(currentGeneration),
        maintenanceInterval,
      )
      resumeInstances()
      options.diagnostics.record(
        currentGeneration === 1 ? 'installed' : 'page-runtime-resumed',
        {
          generation: currentGeneration,
          href: runtimeHref,
          messagePortAvailable: typeof globalThis.MessagePort === 'function',
          readyState: options.document.readyState,
          workerAvailable: typeof globalThis.Worker === 'function',
        },
        'info',
      )
      options.onStarted?.()
      return true
    },
    updateRendererSettings(enabled, requestedRepeatReminderEnabled) {
      const previousEnabled = rendererEnabled
      const previousRepeatReminderEnabled = repeatReminderEnabled
      rendererEnabled = Boolean(enabled)
      repeatReminderEnabled = rendererEnabled && Boolean(requestedRepeatReminderEnabled)
      heartbeatAt = now()
      if (!rendererEnabled) suspendInstances('settings-disabled')
      else resumeInstances()
      return {
        enabled: rendererEnabled,
        enabledChanged: rendererEnabled !== previousEnabled,
        previousEnabled,
        previousRepeatReminderEnabled,
        repeatReminderEnabled,
        repeatReminderEnabledChanged:
          repeatReminderEnabled !== previousRepeatReminderEnabled,
      }
    },
  }

  return runtime
}

import type { DouyinDomHoverSnapshot } from './dom-hover-controller'
import type { DouyinContentDebugState } from './runtime-state'

export type DouyinContentDebugLevel = 'debug' | 'error' | 'info' | 'warn'

export interface DouyinContentDiagnosticsOptions {
  debugState: DouyinContentDebugState
  document: Document
  enabled(): boolean
  href(): string
  hover(): DouyinDomHoverSnapshot
  pageReady(): boolean
  pageSnapshot(): Record<string, unknown> | null
  pageVersion(): string
  version: string
}

export interface DouyinContentDiagnostics {
  destroy(): void
  event(type: string, details?: unknown, level?: DouyinContentDebugLevel): void
  snapshot(): Record<string, unknown>
  syncMarker(): void
}

function conciseDebugValue(value: unknown, depth: number): unknown {
  if (depth > 3) return '[depth-limit]'
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, 240)
  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item) => conciseDebugValue(item, depth + 1))
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 20)
        .map(([key, item]) => [key, conciseDebugValue(item, depth + 1)]),
    )
  }
  return String(value).slice(0, 120)
}

export function createDouyinContentDiagnostics(
  options: DouyinContentDiagnosticsOptions,
): DouyinContentDiagnostics {
  let markerTimer: ReturnType<typeof setTimeout> | 0 = 0

  function snapshot(): Record<string, unknown> {
    const hover = options.hover()
    return {
      version: options.debugState.version,
      loadedAt: options.debugState.loadedAt,
      loadedAtMs: options.debugState.loadedAtMs,
      href: options.href(),
      pageReady: options.pageReady(),
      pageVersion: options.pageVersion(),
      settingsEnabled: options.enabled(),
      counters: { ...options.debugState.counters },
      lastCard: options.debugState.lastCard,
      lastError: options.debugState.lastError,
      card: hover.visible
        ? {
            hidden: false,
            hovered: hover.hovered,
            selectionId: hover.selectionId,
            selectionPhase: hover.selectionPhase,
            selectedAt: hover.selectedAt,
            lockedUntil: hover.lockedUntil,
            candidate: hover.candidate
              ? {
                  trackId: hover.candidate.trackId,
                  message: hover.candidate.message,
                  kind: hover.candidate.kind,
                  rect: hover.candidate.rect,
                }
              : null,
          }
        : null,
      events: options.debugState.events.slice(-80),
      pageSnapshot: options.pageSnapshot(),
    }
  }

  function syncMarker(): void {
    markerTimer = 0
    const root = options.document.documentElement
    if (!root) return
    let marker = options.document.getElementById(
      'bcp-douyin-content-debug',
    ) as HTMLScriptElement | null
    if (!marker) {
      marker = options.document.createElement('script')
      marker.id = 'bcp-douyin-content-debug'
      marker.type = 'application/json'
      marker.hidden = true
      root.appendChild(marker)
    }
    const value = snapshot()
    marker.dataset.version = options.version
    marker.dataset.pageReady = String(value.pageReady)
    marker.dataset.cardVisible = String(options.hover().visible)
    marker.textContent = JSON.stringify(value)
  }

  function scheduleMarker(): void {
    if (!markerTimer) markerTimer = setTimeout(syncMarker, 80)
  }

  function event(type: string, details: unknown = {}, level: DouyinContentDebugLevel = 'debug'): void {
    const entry = {
      at: Date.now(),
      sinceLoad: Date.now() - options.debugState.loadedAtMs,
      type,
      details: conciseDebugValue(details, 0),
    }
    options.debugState.events.push(entry)
    if (options.debugState.events.length > 240) {
      options.debugState.events.splice(0, options.debugState.events.length - 240)
    }
    if (level === 'error') {
      const value = details as { error?: unknown; message?: unknown } | null
      options.debugState.lastError = String(value?.message || value?.error || type).slice(0, 500)
      console.error('[Danmaku Echo][Douyin content]', type, entry.details)
    } else if (level === 'info') {
      console.info('[Danmaku Echo][Douyin content]', type, entry.details)
    } else if (level === 'warn') {
      console.warn('[Danmaku Echo][Douyin content]', type, entry.details)
    } else {
      console.debug('[Danmaku Echo][Douyin content]', type, entry.details)
    }
    scheduleMarker()
  }

  function destroy(): void {
    if (markerTimer) clearTimeout(markerTimer)
    markerTimer = 0
    options.document.getElementById('bcp-douyin-content-debug')?.remove()
  }

  return Object.freeze({ destroy, event, snapshot, syncMarker })
}

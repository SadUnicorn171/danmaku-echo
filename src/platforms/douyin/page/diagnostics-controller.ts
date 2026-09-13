import { recordRuntimeLog } from '../../../core/runtime-logger'
import type {
  DouyinPageDebugCounters,
  DouyinPageDebugEvent,
  DouyinPageDebugLevel,
  DouyinPageDebugState,
  DouyinPageDebugValue,
  Milliseconds,
  RendererInstance,
  TimestampMilliseconds,
} from './runtime-types'

export type DouyinPageDebugCounter = keyof DouyinPageDebugCounters
export type DouyinPageConsoleLevel = 'debug' | 'error' | 'info' | 'off' | 'warn'

export interface DouyinPageDiagnosticsSnapshot extends Record<string, unknown> {
  counters: DouyinPageDebugCounters
  events: DouyinPageDebugEvent[]
  href: string
  installedAt: string
  installedAtMs: TimestampMilliseconds
  lastError: string
  readyState: DocumentReadyState
  version: string
}

export interface DouyinPageDiagnosticsOptions {
  collectSnapshot?(): Record<string, unknown>
  consoleLevel?: DouyinPageConsoleLevel
  debugSampleInterval?: Milliseconds
  document: Document
  enabled?: () => boolean
  eventLimit?: number
  exposeGlobal?: boolean
  href(): string
  instances?(): Iterable<RendererInstance>
  markerId?: string
  markerInterval?: Milliseconds
  now?: () => TimestampMilliseconds
  snapshotEventLimit?: number
  version: string
}

export interface DouyinPageDiagnosticsController {
  destroy(): void
  increment(counter: DouyinPageDebugCounter, amount?: number): void
  record(type: string, details?: unknown, level?: DouyinPageDebugLevel): boolean
  snapshot(): DouyinPageDiagnosticsSnapshot
}

interface DouyinPageDebugGlobal {
  __danmakuEchoDouyinDebug?: DouyinPageDebugState
}

const COUNTER_NAMES = [
  'barragesObserved',
  'barragesStarted',
  'canvasTransfers',
  'instancesCreated',
  'instancesRecovered',
  'ownBarragesMatched',
  'ownBarragesReconciled',
  'ownMessagesQueued',
  'protocolMessagesRejected',
  'rendererActivations',
  'rendererNodesCreated',
  'rendererRestores',
  'rendererResults',
  'rendererTakeovers',
  'skippedBarrages',
  'workerMessages',
] as const satisfies readonly DouyinPageDebugCounter[]

const SENSITIVE_KEY_PATTERN =
  /(?:authorization|cookie|csrf|password|secret|sessdata|token|w_rid)/iu
const SENSITIVE_INLINE_PATTERN =
  /\b(authorization|cookie|csrf(?:_token)?|password|secret|sessdata|token|w_rid)\s*[:=]\s*([^\s,;&]+)/giu
const SENSITIVE_QUERY_PATTERN =
  /([?&](?:access_token|authorization|csrf|csrf_token|password|secret|sessdata|token|w_rid)=)[^&#\s]+/giu

function createCounters(): DouyinPageDebugCounters {
  return Object.fromEntries(COUNTER_NAMES.map((name) => [name, 0])) as unknown as DouyinPageDebugCounters
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number): number {
  return Math.max(minimum, Math.floor(Number.isFinite(value) ? Number(value) : fallback))
}

function redactString(value: string, limit: number): string {
  return value
    .replace(SENSITIVE_INLINE_PATTERN, '$1=[redacted]')
    .replace(SENSITIVE_QUERY_PATTERN, '$1[redacted]')
    .slice(0, limit)
}

function conciseDebugValue(
  value: unknown,
  depth = 0,
  key = '',
  seen = new WeakSet<object>(),
): DouyinPageDebugValue {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[redacted]'
  if (depth > 3) return '[depth-limit]'
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'string') return redactString(value, 240)
  if (value instanceof Error) {
    return {
      message: redactString(value.message, 240),
      name: redactString(value.name, 80),
    }
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    return value.slice(0, 12).map((item) => conciseDebugValue(item, depth + 1, '', seen))
  }
  if (typeof value === 'object' && value) {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    const result: Record<string, DouyinPageDebugValue> = {}
    for (const itemKey of Object.keys(value).slice(0, 20)) {
      result[itemKey] = conciseDebugValue(
        (value as Record<string, unknown>)[itemKey],
        depth + 1,
        itemKey,
        seen,
      )
    }
    return result
  }
  return redactString(String(value), 120)
}

function errorSummary(type: string, details: DouyinPageDebugValue): string {
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const candidate = details.message ?? details.error ?? details.reason
    if (typeof candidate === 'string' && candidate) return redactString(candidate, 500)
  }
  return redactString(type, 500)
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function instanceDebugSummary(
  instance: RendererInstance,
  currentTime: TimestampMilliseconds,
): Record<string, unknown> {
  const rect =
    instance.canvas instanceof HTMLCanvasElement ? instance.canvas.getBoundingClientRect() : null
  return {
    active: Boolean(instance.active),
    canvasId: instance.canvasId,
    canvasRect: rect ? [rect.left, rect.top, rect.width, rect.height] : null,
    channelCount: instance.channels.length,
    config: {
      channelHeight: finiteNumber(instance.config.channelHeight, 40),
      devicePixelRatio: finiteNumber(instance.config.devicePixelRatio, 1),
      duration: finiteNumber(instance.config.duration, 15_000),
      fontSize: finiteNumber(instance.config.fontSize, 20),
      gap: finiteNumber(instance.config.gap, 100),
      height: finiteNumber(instance.config.height, 0),
      width: finiteNumber(instance.config.width, 0),
    },
    connected: Boolean(instance.canvas?.isConnected),
    id: instance.id,
    pendingCount: instance.pending.length,
    recovered: Boolean(instance.recovered),
    renderer: {
      blocked: Boolean(instance.rendererBlocked),
      layerConnected: Boolean(instance.rendererLayer?.isConnected),
      nodeCount: instance.rendererNodes.size,
      safe:
        Boolean(instance.rendererSafeSync) ||
        currentTime >= finiteNumber(instance.rendererSafeAfter, Number.POSITIVE_INFINITY),
      takeover: Boolean(instance.rendererTakeover),
    },
    trackCount: instance.tracks.size,
  }
}

const CONSOLE_LEVEL_VALUE: Record<DouyinPageConsoleLevel, number> = {
  off: 5,
  error: 4,
  warn: 3,
  info: 2,
  debug: 1,
}

const EVENT_LEVEL_VALUE: Record<DouyinPageDebugLevel, number> = {
  error: 4,
  warn: 3,
  info: 2,
  debug: 1,
}

export function createDouyinPageDiagnostics(
  options: DouyinPageDiagnosticsOptions,
): DouyinPageDiagnosticsController {
  const now = options.now ?? Date.now
  const enabled = options.enabled ?? (() => true)
  const eventLimit = boundedInteger(options.eventLimit, 240, 1)
  const snapshotEventLimit = Math.min(
    eventLimit,
    boundedInteger(options.snapshotEventLimit, 80, 0),
  )
  const markerInterval = boundedInteger(options.markerInterval, 1_000, 100)
  const debugSampleInterval = boundedInteger(options.debugSampleInterval, 250, 0)
  const markerId = options.markerId ?? 'bcp-douyin-page-debug'
  const consoleLevel = options.consoleLevel ?? 'warn'
  const installedAtMs = now()
  const state: DouyinPageDebugState = {
    counters: createCounters(),
    events: [],
    href: options.href(),
    installedAt: new Date(installedAtMs).toISOString(),
    installedAtMs,
    lastError: '',
    readyState: options.document.readyState,
    version: options.version,
  }
  const debugGlobal = globalThis as typeof globalThis & DouyinPageDebugGlobal
  const lastDebugEventAt = new Map<string, TimestampMilliseconds>()
  let destroyed = false
  let lastMarkerAt: TimestampMilliseconds | 0 = 0
  let markerTimer: ReturnType<typeof setTimeout> | 0 = 0
  let waitingForDocument = false

  if (options.exposeGlobal !== false) debugGlobal.__danmakuEchoDouyinDebug = state

  const snapshot = (): DouyinPageDiagnosticsSnapshot => {
    const currentTime = now()
    state.href = options.href()
    state.readyState = options.document.readyState
    const extra = options.collectSnapshot?.() ?? {}
    return {
      ...extra,
      counters: { ...state.counters },
      events: state.events.slice(-snapshotEventLimit),
      href: state.href,
      installedAt: state.installedAt,
      installedAtMs: state.installedAtMs,
      lastError: state.lastError,
      readyState: state.readyState,
      version: state.version,
      ...(options.instances
        ? {
            instances: Array.from(options.instances(), (instance) =>
              instanceDebugSummary(instance, currentTime),
            ),
          }
        : {}),
    }
  }

  const syncMarker = (): void => {
    markerTimer = 0
    if (destroyed || !enabled()) return
    const root = options.document.documentElement
    if (!root) return
    const existingMarker = options.document.getElementById(markerId)
    let marker: HTMLScriptElement
    if (existingMarker instanceof HTMLScriptElement) {
      marker = existingMarker
    } else {
      existingMarker?.remove()
      marker = options.document.createElement('script')
      marker.id = markerId
      marker.type = 'application/json'
      marker.hidden = true
      root.append(marker)
    }
    const value = snapshot()
    marker.dataset.version = state.version
    const instanceCount = value.instanceCount
    const orphanCount = value.orphanCount
    marker.dataset.instanceCount = String(
      typeof instanceCount === 'number' && Number.isFinite(instanceCount) ? instanceCount : 0,
    )
    marker.dataset.orphanCount = String(
      typeof orphanCount === 'number' && Number.isFinite(orphanCount) ? orphanCount : 0,
    )
    marker.textContent = JSON.stringify(value)
    lastMarkerAt = now()
  }

  const scheduleMarker = (currentTime?: TimestampMilliseconds): void => {
    if (destroyed || markerTimer || !enabled()) return
    const timestamp = currentTime ?? now()
    const elapsed = lastMarkerAt ? Math.max(0, timestamp - lastMarkerAt) : markerInterval
    const delay = Math.max(0, markerInterval - elapsed)
    markerTimer = setTimeout(syncMarker, delay)
  }

  const record = (
    type: string,
    details: unknown = {},
    level: DouyinPageDebugLevel = 'debug',
  ): boolean => {
    if (destroyed || !enabled()) return false
    const currentTime = now()
    const eventType = String(type || 'unknown').slice(0, 120)
    if (level === 'debug' && debugSampleInterval > 0) {
      const previousAt = lastDebugEventAt.get(eventType)
      if (previousAt !== undefined && currentTime - previousAt < debugSampleInterval) return false
      lastDebugEventAt.set(eventType, currentTime)
    }
    if (level === 'warn' || level === 'error') recordRuntimeLog(level, eventType, details)
    const safeDetails = conciseDebugValue(details)
    const entry: DouyinPageDebugEvent = {
      at: currentTime,
      details: safeDetails,
      sinceInstall: Math.max(0, currentTime - installedAtMs),
      type: eventType,
    }
    state.events.push(entry)
    if (state.events.length > eventLimit) state.events.splice(0, state.events.length - eventLimit)
    if (level === 'error') state.lastError = errorSummary(eventType, safeDetails)
    if (EVENT_LEVEL_VALUE[level] >= CONSOLE_LEVEL_VALUE[consoleLevel]) {
      const logger = level === 'debug' ? console.debug : console[level]
      logger.call(console, '[Danmaku Echo][Douyin page]', eventType, safeDetails)
    }
    scheduleMarker(currentTime)
    return true
  }

  const onReadyStateChange = (): void => {
    waitingForDocument = false
    scheduleMarker()
  }

  if (!options.document.documentElement) {
    waitingForDocument = true
    options.document.addEventListener('readystatechange', onReadyStateChange, { once: true })
  }
  scheduleMarker(installedAtMs)

  return {
    destroy() {
      if (destroyed) return
      destroyed = true
      if (markerTimer) clearTimeout(markerTimer)
      markerTimer = 0
      if (waitingForDocument) {
        options.document.removeEventListener('readystatechange', onReadyStateChange)
        waitingForDocument = false
      }
      lastDebugEventAt.clear()
      options.document.getElementById(markerId)?.remove()
      if (debugGlobal.__danmakuEchoDouyinDebug === state) {
        debugGlobal.__danmakuEchoDouyinDebug = undefined
      }
    },
    increment(counter, amount = 1) {
      if (destroyed || !enabled() || !Number.isFinite(amount)) return
      state.counters[counter] = Math.max(0, state.counters[counter] + amount)
      scheduleMarker()
    },
    record,
    snapshot,
  }
}

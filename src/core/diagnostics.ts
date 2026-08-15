import type {
  DiagnosticsEventV1,
  DiagnosticsSnapshotV1,
  ExtensionSettings,
  PlatformId,
} from './types'

const MAX_EVENTS = 100
const SAFE_EVENT_TOKEN = /^[a-z0-9._:-]{1,80}$/i
const SAFE_EVENT_TYPES = new Set([
  'action.favorite',
  'action.plus-one',
  'action.reply',
  'candidate.selected',
  'diagnostics.requested',
  'lifecycle.hidden',
  'route.changed',
  'runtime.initialized',
  'send.completed',
])
const SENSITIVE_KEY = /(?:cookie|csrf|token|request|response|room|url|user|uid|message|content|text)/i

export interface DiagnosticsCollectorOptions {
  cacheCounts?: () => Record<string, number>
  featureFlags: () => ExtensionSettings
  observerCounts?: () => Record<string, number>
  performance?: () => Record<string, number>
  platform: PlatformId
  selectorHits?: () => Record<string, boolean>
}

function finiteCount(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
}

function safeBooleanRecord(value: Record<string, boolean> | undefined): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(value || {})
      .filter(([key]) => SAFE_EVENT_TOKEN.test(key) && !SENSITIVE_KEY.test(key))
      .slice(0, 60)
      .map(([key, enabled]) => [key, Boolean(enabled)]),
  )
}

function safeNumberRecord(value: Record<string, number> | undefined): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value || {})
      .filter(([key]) => SAFE_EVENT_TOKEN.test(key) && !SENSITIVE_KEY.test(key))
      .slice(0, 60)
      .map(([key, count]) => [key, finiteCount(count)]),
  )
}

function browserLabel(): string {
  const userAgent = navigator.userAgent
  const edge = userAgent.match(/Edg\/([\d.]+)/)
  if (edge) return `Edge ${edge[1]}`
  const chrome = userAgent.match(/Chrome\/([\d.]+)/)
  if (chrome) return `Chrome ${chrome[1]}`
  return 'Chromium'
}

function safeEvent(value: Partial<DiagnosticsEventV1>): DiagnosticsEventV1 | null {
  const type = String(value.type || '')
  if (!SAFE_EVENT_TYPES.has(type)) return null
  const event: DiagnosticsEventV1 = {
    at: finiteCount(value.at || Date.now()),
    type,
  }
  if (value.stage && SAFE_EVENT_TOKEN.test(value.stage)) event.stage = value.stage
  if (value.outcome === 'failure' || value.outcome === 'success' || value.outcome === 'warning') {
    event.outcome = value.outcome
  }
  if (value.durationMs !== undefined) event.durationMs = finiteCount(value.durationMs)
  return event
}

export function createDiagnosticsCollector(options: DiagnosticsCollectorOptions) {
  const events: DiagnosticsEventV1[] = []

  function record(value: Omit<DiagnosticsEventV1, 'at'> & { at?: number }): void {
    const event = safeEvent({ ...value, at: value.at || Date.now() })
    if (!event) return
    events.push(event)
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  }

  function snapshot(): DiagnosticsSnapshotV1 {
    const settings = options.featureFlags()
    return {
      browser: browserLabel(),
      cacheCounts: safeNumberRecord(options.cacheCounts?.()),
      events: events.map((event) => ({ ...event })),
      extensionVersion: chrome.runtime.getManifest().version,
      featureFlags: safeBooleanRecord({
        enabled: settings.enabled,
        altClick: settings.altClick,
        plusOne: settings.actions.plusOne,
        reply: settings.actions.reply,
        favorite: settings.actions.favorite,
        copy: settings.actions.copy,
        platformEnabled: settings.platforms[options.platform],
        sideChatCapsule: options.platform === 'douyin'
          ? true
          : settings.sideChatCapsule[options.platform as keyof typeof settings.sideChatCapsule],
      }),
      fullscreen: Boolean(document.fullscreenElement || (document as Document & {
        webkitFullscreenElement?: Element | null
      }).webkitFullscreenElement),
      observerCounts: safeNumberRecord(options.observerCounts?.()),
      performance: safeNumberRecord(options.performance?.()),
      platform: options.platform,
      schemaVersion: 1,
      selectorHits: safeBooleanRecord(options.selectorHits?.()),
    }
  }

  return { record, snapshot }
}

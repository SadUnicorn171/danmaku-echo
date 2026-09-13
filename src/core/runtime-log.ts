export const LOG_MESSAGE = 'danmaku-echo.runtime-log'
export const LOG_STORAGE_KEY = 'danmakuEchoRuntimeLogsV1'
export const LOG_LIMIT = 500
export const LOG_MAX_BYTES = 1_000_000
export const LOG_MAX_AGE = 7 * 24 * 60 * 60 * 1000

export interface RuntimeLog {
  id: string
  at: number
  level: 'warn' | 'error'
  source: string
  message: string
  details: unknown
  context: unknown
}
const PRIVATE_KEY =
  /cookie|authorization|password|secret|csrf|token|signature|sessdata|w_rid|text|content|message|sender|user|uid|room|url|href|body|headers/i

const SAFE_DIAGNOSTIC_TEXT = new Set(['errorMessage', 'apiMessage', 'errorName', 'errorStack', 'contentType'])
const SAFE_DIAGNOSTIC_COUNT = new Set(['messageLength', 'senderIndex', 'sender'])

export function redactLogText(value: string, limit = 2000): string {
  return value
    .replace(/https?:\/\/[^\s)"'<>]+/gi, (url) => {
      try {
        return new URL(url).origin + '/[redacted]'
      } catch {
        return '[url]'
      }
    })
    .replace(/\b(Bearer|Basic)\s+[a-z0-9+/=._-]+/gi, '$1 [redacted]')
    .replace(
      /(["']?(?:cookie|authorization|password|secret|csrf(?:_token)?|access_token|token|signature|sessdata|w_rid)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[redacted]',
    )
    .slice(0, limit)
}

export function sanitizeLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  try {
    if (value == null || typeof value === 'boolean') return value ?? null
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
    if (typeof value === 'string') return redactLogText(value)
    if (typeof value !== 'object') return String(value).slice(0, 100)
    if (depth > 4) return '[depth-limit]'
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    if (value instanceof Error)
      return {
        name: redactLogText(value.name, 100),
        error: redactLogText(value.message),
        stack: redactLogText(value.stack || '', 4000),
      }
    if (typeof Node !== 'undefined' && value instanceof Node) return '[DOM node]'
    if (Array.isArray(value))
      return value.slice(0, 20).map((item) => sanitizeLogValue(item, depth + 1, seen))
    return Object.fromEntries(
      Object.keys(value)
        .slice(0, 24)
        .map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, key)
          const item = descriptor && 'value' in descriptor ? descriptor.value : undefined
          const safeDiagnostic = SAFE_DIAGNOSTIC_TEXT.has(key) && typeof item === 'string'
          const safeCount = SAFE_DIAGNOSTIC_COUNT.has(key) && typeof item === 'number' && Number.isFinite(item)
          return [
            key.slice(0, 100),
            PRIVATE_KEY.test(key) && !safeDiagnostic && !safeCount
              ? '[redacted]'
              : descriptor && 'value' in descriptor
                ? sanitizeLogValue(descriptor.value, depth + 1, seen)
                : '[accessor]',
          ]
        }),
    )
  } catch {
    return '[unserializable]'
  }
}

export function isRuntimeLog(value: unknown): value is RuntimeLog {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<RuntimeLog>
  return (
    typeof row.id === 'string' &&
    /^[a-z0-9._:-]{1,120}$/i.test(row.id) &&
    typeof row.at === 'number' &&
    Number.isFinite(row.at) &&
    row.at > 0 &&
    (row.level === 'warn' || row.level === 'error') &&
    typeof row.source === 'string' &&
    /^[a-z0-9._-]{1,80}$/i.test(row.source) &&
    typeof row.message === 'string' &&
    row.message.length <= 2000
  )
}

export function normalizeRuntimeLog(value: unknown): RuntimeLog | null {
  if (!isRuntimeLog(value)) return null
  const row: RuntimeLog = {
    id: value.id,
    at: value.at,
    level: value.level,
    source: value.source,
    message: redactLogText(value.message),
    details: sanitizeLogValue(value.details),
    context: sanitizeLogValue(value.context),
  }
  if (JSON.stringify(row).length > 12000) {
    row.context = '[size-limit]'
    if (JSON.stringify(row).length > 12000) row.details = '[size-limit]'
  }
  return row
}

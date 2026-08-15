import { bilibiliRoomEmoticonIdentity } from './direct-emoticon-send'

const LOG_PREFIX = '[Danmaku Echo][Bilibili room Emoji +1] failed'
const SENSITIVE_DETAIL_KEY = /(?:authorization|cookie|credential|csrf|session)/i
let attemptSequence = 0

interface AssetLike {
  keys?: unknown
  src?: unknown
  token?: unknown
}

interface PayloadLike {
  assets?: unknown
  parts?: unknown
  text?: unknown
}

type DebugLogger = (message: string, details: Record<string, unknown>) => void

function keyKind(value: unknown): string {
  const key = String(value || '').trim().toLowerCase()
  if (key.startsWith('native-panel:')) return 'native-panel'
  if (key.startsWith('bili-exclusive:')) return 'bili-exclusive'
  if (key.startsWith('bili-auto-text:')) return 'bili-auto-text'
  if (key.startsWith('digest:')) return 'digest'
  if (/^https?:/.test(key)) return 'url'
  return key.includes(':') ? key.slice(0, key.indexOf(':')).slice(0, 32) : 'other'
}

function safeError(error: unknown): Record<string, string> | string {
  if (error instanceof Error) {
    return {
      message: error.message.slice(0, 240),
      name: error.name.slice(0, 80),
    }
  }
  return String(error || '').slice(0, 240)
}

function safeDetails(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return safeError(value)
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, 240)
  if (depth >= 3) return '[depth-limited]'
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeDetails(item, depth + 1))
  if (!value || typeof value !== 'object') return String(value || '')

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_DETAIL_KEY.test(key))
      .slice(0, 30)
      .map(([key, item]) => [key, safeDetails(item, depth + 1)]),
  )
}

export function bilibiliEmoticonAssetDebugSummary(asset: unknown): Record<string, unknown> {
  const value = asset && typeof asset === 'object' ? (asset as AssetLike) : null
  const keys = value && Array.isArray(value.keys) ? value.keys : []
  const token = String(value?.token || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return {
    hasSource: Boolean(String(value?.src || '').trim()),
    identity: bilibiliRoomEmoticonIdentity(value),
    keyCount: keys.length,
    keyKinds: Array.from(new Set(keys.map(keyKind))).slice(0, 12),
    token,
  }
}

export function createBilibiliEmoticonDebugAttempt(
  payload: unknown,
  logger: DebugLogger = console.error,
) {
  const value = payload && typeof payload === 'object' ? (payload as PayloadLike) : null
  const assets = value && Array.isArray(value.assets) ? value.assets : []
  const parts = value && Array.isArray(value.parts) ? value.parts : []
  const startedAt = Date.now()
  attemptSequence += 1
  const attemptId = `${startedAt.toString(36)}-${attemptSequence.toString(36)}`
  const payloadSummary = {
    assetCount: assets.length,
    firstAsset: bilibiliEmoticonAssetDebugSummary(assets[0]),
    messageLength: Array.from(String(value?.text || '')).length,
    partTypes: parts
      .map((part) =>
        part && typeof part === 'object' ? String((part as { type?: unknown }).type || '') : '',
      )
      .filter(Boolean)
      .slice(0, 20),
  }

  return {
    asset: bilibiliEmoticonAssetDebugSummary,
    attemptId,
    fail(stage: string, details: Record<string, unknown> = {}): void {
      logger(LOG_PREFIX, {
        attemptId,
        details: safeDetails(details),
        elapsedMs: Math.max(0, Date.now() - startedAt),
        payload: payloadSummary,
        stage: String(stage || 'unknown').slice(0, 100),
      })
    },
  }
}

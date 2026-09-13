import { isRuntimeLog, type RuntimeLog } from '../../core/runtime-log'
import type { ActionSettings } from '../../core/types'
import type { DouyinEmojiCatalogEntry } from './emoji-catalog'
import type { EmojiAssetDescriptor } from './rich-data'

export const DOUYIN_CONTENT_SOURCE = 'danmaku-echo-douyin-content'
export const DOUYIN_PAGE_SOURCE = 'danmaku-echo-douyin-page'
export const DOUYIN_PROTOCOL_VERSION = 1
// A page can temporarily retain an older MAIN-world hook while the extension is
// reloaded. Accept its versionless envelope through the 2.x line; remove this
// compatibility path in 3.0.0 when mixed-runtime updates are no longer supported.
const DOUYIN_LEGACY_PROTOCOL_VERSION = 0

type DouyinMessageSource = typeof DOUYIN_CONTENT_SOURCE | typeof DOUYIN_PAGE_SOURCE
type DouyinProtocolVersion =
  typeof DOUYIN_LEGACY_PROTOCOL_VERSION | typeof DOUYIN_PROTOCOL_VERSION
export type DouyinRequestId = number
type DouyinEntityId = string | number

export type DouyinRendererResultReason =
  | 'failed'
  | 'invalid-or-duplicate'
  | 'missing-trusted-click'
  | 'send-error'
  | 'send-failed'
  | 'sent'
  | 'timeout'
  | 'track-mismatch'

export interface DouyinRendererContentPart {
  [key: string]: unknown
}

interface DouyinProtocolBase<Source extends DouyinMessageSource, Type extends string> {
  protocolVersion?: DouyinProtocolVersion
  source: Source
  type: Type
}

export type DouyinContentToPageMessage =
  | (DouyinProtocolBase<typeof DOUYIN_CONTENT_SOURCE, 'ping'> & { requestId: DouyinRequestId })
  | (DouyinProtocolBase<typeof DOUYIN_CONTENT_SOURCE, 'debug-request'> & {
      requestId: DouyinRequestId
    })
  | (DouyinProtocolBase<typeof DOUYIN_CONTENT_SOURCE, 'renderer-settings'> & {
      actions: ActionSettings
      capsuleScalePercent: number
      enabled: boolean
      reason: string
      repeatReminderEnabled: boolean
      sentAt: number
      version: string
    })
  | (DouyinProtocolBase<typeof DOUYIN_CONTENT_SOURCE, 'emoji-catalog'> & {
      entries: DouyinEmojiCatalogEntry[]
    })
  | (DouyinProtocolBase<typeof DOUYIN_CONTENT_SOURCE, 'renderer-message-resolved'> & {
      instanceId: DouyinEntityId
      messageId: DouyinEntityId
      text: string
      trackId: DouyinEntityId
    })
  | (DouyinProtocolBase<typeof DOUYIN_CONTENT_SOURCE, 'own-message-intent'> & {
      assets: EmojiAssetDescriptor[]
      intentId: string
      plainText: string
      signature: string
      sourceType: string
      text: string
    })
  | (DouyinProtocolBase<typeof DOUYIN_CONTENT_SOURCE, 'own-message-cancel'> & { intentId: string })
  | (DouyinProtocolBase<typeof DOUYIN_CONTENT_SOURCE, 'renderer-result'> & {
      instanceId: string
      ok: boolean
      reason: DouyinRendererResultReason
      requestId: DouyinRequestId
      trackId: string
    })
  | (DouyinProtocolBase<typeof DOUYIN_CONTENT_SOURCE, 'renderer-favorite-result'> & {
      ok: boolean
      requestId: DouyinRequestId
    })
  | (DouyinProtocolBase<typeof DOUYIN_CONTENT_SOURCE, 'renderer-copy-result'> & {
      ok: boolean
      requestId: DouyinRequestId
    })

export interface DouyinRepeatReminderMessage {
  content: DouyinRendererContentPart[]
  excludedReason: string
  instanceId: DouyinEntityId
  messageId: string
  observedAt: number
  sender: string
  text: string
  trackId: DouyinEntityId
}

interface DouyinRendererActionPayload {
  content: DouyinRendererContentPart[]
  instanceId: DouyinEntityId
  messageId: string
  requestId: DouyinRequestId
  text: string
  trackId: DouyinEntityId
}

export type DouyinPageToContentMessage =
  | (DouyinProtocolBase<typeof DOUYIN_PAGE_SOURCE, 'runtime-log'> & { entry: RuntimeLog })
  | (DouyinProtocolBase<typeof DOUYIN_PAGE_SOURCE, 'ready'> & {
      instanceCount: number
      orphanCount: number
      rendererEnabled: boolean
      requestId: DouyinRequestId
      version: string
    })
  | (DouyinProtocolBase<typeof DOUYIN_PAGE_SOURCE, 'renderer-ready'> & {
      enabled: boolean
      instanceCount: number
      requestId: DouyinRequestId
      takeoverCount: number
      version: string
    })
  | (DouyinProtocolBase<typeof DOUYIN_PAGE_SOURCE, 'debug-snapshot'> & {
      requestId: DouyinRequestId
      snapshot: Record<string, unknown>
    })
  | (DouyinProtocolBase<typeof DOUYIN_PAGE_SOURCE, 'repeat-reminder-message'> & {
      message: DouyinRepeatReminderMessage
    })
  | (DouyinProtocolBase<typeof DOUYIN_PAGE_SOURCE, 'renderer-activate'> &
      DouyinRendererActionPayload)
  | (DouyinProtocolBase<typeof DOUYIN_PAGE_SOURCE, 'renderer-reply'> &
      DouyinRendererActionPayload & { observedAt: number; sender: string })
  | (DouyinProtocolBase<typeof DOUYIN_PAGE_SOURCE, 'renderer-favorite'> &
      DouyinRendererActionPayload)
  | (DouyinProtocolBase<typeof DOUYIN_PAGE_SOURCE, 'renderer-copy'> &
      DouyinRendererActionPayload)
  | (DouyinProtocolBase<typeof DOUYIN_PAGE_SOURCE, 'own-message-consumed'> & { intentId: string })

type ProtocolPayload<Message extends { protocolVersion?: unknown; source: unknown }> =
  Message extends unknown ? Omit<Message, 'protocolVersion' | 'source'> : never

export type DouyinContentToPagePayload = ProtocolPayload<DouyinContentToPageMessage>
export type DouyinPageToContentPayload = ProtocolPayload<DouyinPageToContentMessage>

export type DouyinContentToPageHandlers = {
  [Type in DouyinContentToPageMessage['type']]: (
    message: Extract<DouyinContentToPageMessage, { type: Type }>,
  ) => void
}

export type DouyinPageToContentHandlers = { 'runtime-log'?: (message: Extract<DouyinPageToContentMessage, { type: 'runtime-log' }>) => void } & {
  [Type in Exclude<DouyinPageToContentMessage['type'], 'runtime-log'>]: (
    message: Extract<DouyinPageToContentMessage, { type: Type }>,
  ) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isBoundedString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maximum && (allowEmpty || value.length > 0)
}

function isRequestId(value: unknown): value is DouyinRequestId {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isEntityId(value: unknown): value is DouyinEntityId {
  return (
    (typeof value === 'string' && value.length > 0 && value.length <= 180) ||
    (Number.isSafeInteger(value) && Number(value) >= 0)
  )
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100_000
}

function protocolVersion(value: Record<string, unknown>): DouyinProtocolVersion | null {
  if (value.protocolVersion === undefined) return DOUYIN_LEGACY_PROTOCOL_VERSION
  return value.protocolVersion === DOUYIN_PROTOCOL_VERSION ? DOUYIN_PROTOCOL_VERSION : null
}

function hasValidEnvelope(value: Record<string, unknown>, source: DouyinMessageSource): boolean {
  return (
    value.source === source && typeof value.type === 'string' && protocolVersion(value) !== null
  )
}

function isActionSettings(value: unknown): value is ActionSettings {
  return (
    isRecord(value) &&
    typeof value.copy === 'boolean' &&
    typeof value.favorite === 'boolean' &&
    typeof value.plusOne === 'boolean' &&
    typeof value.reply === 'boolean'
  )
}

function isEmojiCatalogEntries(value: unknown): value is DouyinEmojiCatalogEntry[] {
  return (
    Array.isArray(value) &&
    value.length <= 2_000 &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        isBoundedString(entry[0], 180) &&
        isBoundedString(entry[1], 42),
    )
  )
}

function isEmojiAsset(value: unknown): value is EmojiAssetDescriptor {
  return (
    isRecord(value) &&
    Array.isArray(value.keys) &&
    value.keys.length <= 24 &&
    value.keys.every((key) => isBoundedString(key, 4_096)) &&
    isBoundedString(value.src, 4_096, true) &&
    isBoundedString(value.token, 80, true)
  )
}

function isRendererContent(value: unknown): value is DouyinRendererContentPart[] {
  return Array.isArray(value) && value.length <= 256 && value.every(isRecord)
}

function isRendererActionPayload(value: Record<string, unknown>): boolean {
  return (
    isRequestId(value.requestId) &&
    isEntityId(value.trackId) &&
    isEntityId(value.instanceId) &&
    isBoundedString(value.messageId, 180) &&
    isBoundedString(value.text, 1_000) &&
    isRendererContent(value.content)
  )
}

function isRendererResultReason(value: unknown): value is DouyinRendererResultReason {
  return (
    value === 'failed' ||
    value === 'invalid-or-duplicate' ||
    value === 'missing-trusted-click' ||
    value === 'send-error' ||
    value === 'send-failed' ||
    value === 'sent' ||
    value === 'timeout' ||
    value === 'track-mismatch'
  )
}

function isRepeatReminderMessage(value: unknown): value is DouyinRepeatReminderMessage {
  return (
    isRecord(value) &&
    isRendererContent(value.content) &&
    isBoundedString(value.excludedReason, 80, true) &&
    isEntityId(value.instanceId) &&
    isBoundedString(value.messageId, 180, true) &&
    typeof value.observedAt === 'number' &&
    Number.isFinite(value.observedAt) &&
    isBoundedString(value.sender, 120, true) &&
    isBoundedString(value.text, 1_000) &&
    isEntityId(value.trackId)
  )
}

export function createDouyinContentToPageMessage<Message extends DouyinContentToPageMessage>(
  payload: ProtocolPayload<Message>,
): Message {
  return {
    ...payload,
    protocolVersion: DOUYIN_PROTOCOL_VERSION,
    source: DOUYIN_CONTENT_SOURCE,
  } as unknown as Message
}

export function createDouyinPageToContentMessage<Message extends DouyinPageToContentMessage>(
  payload: ProtocolPayload<Message>,
): Message {
  return {
    ...payload,
    protocolVersion: DOUYIN_PROTOCOL_VERSION,
    source: DOUYIN_PAGE_SOURCE,
  } as unknown as Message
}

export function isDouyinContentToPageMessage(value: unknown): value is DouyinContentToPageMessage {
  if (!isRecord(value) || !hasValidEnvelope(value, DOUYIN_CONTENT_SOURCE)) return false
  switch (value.type) {
    case 'ping':
    case 'debug-request':
      return isRequestId(value.requestId)
    case 'renderer-settings':
      return (
        typeof value.enabled === 'boolean' &&
        isActionSettings(value.actions) &&
        typeof value.capsuleScalePercent === 'number' &&
        Number.isFinite(value.capsuleScalePercent) &&
        value.capsuleScalePercent >= 50 &&
        value.capsuleScalePercent <= 200 &&
        typeof value.repeatReminderEnabled === 'boolean' &&
        isBoundedString(value.reason, 80) &&
        isBoundedString(value.version, 120) &&
        typeof value.sentAt === 'number' &&
        Number.isFinite(value.sentAt)
      )
    case 'emoji-catalog':
      return isEmojiCatalogEntries(value.entries)
    case 'renderer-message-resolved':
      return (
        isEntityId(value.instanceId) &&
        isEntityId(value.trackId) &&
        isEntityId(value.messageId) &&
        isBoundedString(value.text, 1_000)
      )
    case 'own-message-intent':
      return (
        isBoundedString(value.intentId, 80) &&
        isBoundedString(value.signature, 1_000) &&
        isBoundedString(value.sourceType, 40) &&
        isBoundedString(value.text, 1_000) &&
        isBoundedString(value.plainText, 1_000, true) &&
        Array.isArray(value.assets) &&
        value.assets.length <= 8 &&
        value.assets.every(isEmojiAsset)
      )
    case 'own-message-cancel':
      return isBoundedString(value.intentId, 80)
    case 'renderer-result':
      return (
        isRequestId(value.requestId) &&
        isBoundedString(value.instanceId, 180) &&
        isBoundedString(value.trackId, 180) &&
        typeof value.ok === 'boolean' &&
        isRendererResultReason(value.reason)
      )
    case 'renderer-favorite-result':
      return isRequestId(value.requestId) && typeof value.ok === 'boolean'
    case 'renderer-copy-result':
      return isRequestId(value.requestId) && typeof value.ok === 'boolean'
    default:
      return false
  }
}

export function isDouyinPageToContentMessage(value: unknown): value is DouyinPageToContentMessage {
  if (!isRecord(value) || !hasValidEnvelope(value, DOUYIN_PAGE_SOURCE)) return false
  switch (value.type) {
    case 'runtime-log':
      return isRuntimeLog(value.entry) && value.entry.source === 'douyin-page'
    case 'ready':
      return (
        isRequestId(value.requestId) &&
        isCount(value.instanceCount) &&
        isBoundedString(value.version, 120) &&
        isCount(value.orphanCount) &&
        typeof value.rendererEnabled === 'boolean'
      )
    case 'renderer-ready':
      return (
        isRequestId(value.requestId) &&
        typeof value.enabled === 'boolean' &&
        isCount(value.instanceCount) &&
        isCount(value.takeoverCount) &&
        isBoundedString(value.version, 120)
      )
    case 'debug-snapshot':
      return isRequestId(value.requestId) && isRecord(value.snapshot)
    case 'repeat-reminder-message':
      return isRepeatReminderMessage(value.message)
    case 'renderer-activate':
    case 'renderer-copy':
    case 'renderer-favorite':
      return isRendererActionPayload(value)
    case 'renderer-reply':
      return (
        isRendererActionPayload(value) &&
        isBoundedString(value.sender, 120, true) &&
        typeof value.observedAt === 'number' &&
        Number.isFinite(value.observedAt)
      )
    case 'own-message-consumed':
      return isBoundedString(value.intentId, 80)
    default:
      return false
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Douyin protocol message: ${JSON.stringify(value)}`)
}

export function dispatchDouyinContentToPageMessage(
  message: DouyinContentToPageMessage,
  handlers: DouyinContentToPageHandlers,
): void {
  switch (message.type) {
    case 'ping':
      handlers.ping(message)
      return
    case 'debug-request':
      handlers['debug-request'](message)
      return
    case 'renderer-settings':
      handlers['renderer-settings'](message)
      return
    case 'emoji-catalog':
      handlers['emoji-catalog'](message)
      return
    case 'renderer-message-resolved':
      handlers['renderer-message-resolved'](message)
      return
    case 'own-message-intent':
      handlers['own-message-intent'](message)
      return
    case 'own-message-cancel':
      handlers['own-message-cancel'](message)
      return
    case 'renderer-result':
      handlers['renderer-result'](message)
      return
    case 'renderer-favorite-result':
      handlers['renderer-favorite-result'](message)
      return
    case 'renderer-copy-result':
      handlers['renderer-copy-result'](message)
      return
    default:
      assertNever(message)
  }
}

export function dispatchDouyinPageToContentMessage(
  message: DouyinPageToContentMessage,
  handlers: DouyinPageToContentHandlers,
): void {
  switch (message.type) {
    case 'runtime-log':
      handlers['runtime-log']?.(message)
      return
    case 'ready':
      handlers.ready(message)
      return
    case 'renderer-ready':
      handlers['renderer-ready'](message)
      return
    case 'debug-snapshot':
      handlers['debug-snapshot'](message)
      return
    case 'repeat-reminder-message':
      handlers['repeat-reminder-message'](message)
      return
    case 'renderer-activate':
      handlers['renderer-activate'](message)
      return
    case 'renderer-copy':
      handlers['renderer-copy'](message)
      return
    case 'renderer-reply':
      handlers['renderer-reply'](message)
      return
    case 'renderer-favorite':
      handlers['renderer-favorite'](message)
      return
    case 'own-message-consumed':
      handlers['own-message-consumed'](message)
      return
    default:
      assertNever(message)
  }
}

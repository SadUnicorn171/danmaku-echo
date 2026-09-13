import type { ActionSettings } from '../../../core/types'
import { eventComposedPath } from '../../live/deep-dom'
import type { RichPayload } from '../own-message'
import type {
  DouyinPageToContentMessage,
  DouyinRendererContentPart,
} from '../protocol'
import type {
  DouyinRichAction,
  DouyinRichContentResolver,
  DouyinRichRecoveryResult,
} from './rich-content-resolver'

export type DouyinActionKind = keyof ActionSettings
export type DouyinActionSource = 'dom' | 'renderer'

export interface DouyinActionCandidate {
  content?: readonly DouyinRendererContentPart[]
  instanceId?: string
  message: string
  messageId?: string
  observedAt?: number
  requestId?: string
  richPayload?: RichPayload & { sender?: string }
  sender?: string
  trackId?: string
}

export type DouyinRendererActionMessage = Extract<
  DouyinPageToContentMessage,
  { type: 'renderer-activate' | 'renderer-copy' | 'renderer-favorite' | 'renderer-reply' }
>

export type DouyinActionFailureReason =
  | 'disabled'
  | 'duplicate'
  | 'invalid-message'
  | 'missing-candidate'
  | 'operation-error'
  | 'untrusted'

export type DouyinActionOutcome =
  | 'copied'
  | 'copy-failed'
  | 'favorite-saved'
  | 'favorite-skipped'
  | 'reply-failed'
  | 'reply-ready'
  | 'send-failed'
  | 'sent'

export interface DouyinActionDispatchResult {
  accepted: boolean
  action: DouyinActionKind
  ok: boolean
  outcome?: DouyinActionOutcome
  reason?: DouyinActionFailureReason
  requestId: string
  source: DouyinActionSource
}

export interface DouyinActionDispatcherOptions {
  actions(): ActionSettings
  copy(text: string): Promise<boolean>
  enabled(): boolean
  favorite(text: string, payload?: RichPayload): Promise<boolean | null>
  isPlausibleMessage(message: string, maxLength: number): boolean
  maxLength?: number
  now?: () => number
  onDispatch?(result: DouyinActionDispatchResult): void
  parseMessage(value: unknown, maxLength: number): string
  prepareReply(candidate: DouyinActionCandidate, reason: string): Promise<boolean> | boolean
  repeatMessage(text: string, payload: RichPayload | string): Promise<boolean>
  resolver: DouyinRichContentResolver
  senderForMessage(
    message: string,
    hint?: { messageId?: unknown; observedAt?: unknown },
  ): string
  trustedWindowMs?: number
}

export interface DouyinActionDispatcher {
  destroy(): void
  dispatchDom(
    action: DouyinActionKind,
    candidate: DouyinActionCandidate | null,
  ): Promise<DouyinActionDispatchResult>
  dispatchRenderer(
    action: DouyinActionKind,
    message: DouyinRendererActionMessage,
  ): Promise<DouyinActionDispatchResult>
  pendingCount(): number
  rememberTrustedRendererAction(event: Event): boolean
  start(): void
}

interface TrustedRendererAction {
  action: DouyinActionKind
  at: number
  instanceId: string
  message: string
  trackId: string
}

const DATASET_TO_ACTION: Readonly<Record<string, DouyinActionKind | undefined>> = {
  copy: 'copy',
  favorite: 'favorite',
  'plus-one': 'plusOne',
  plusOne: 'plusOne',
  reply: 'reply',
}

const MESSAGE_TYPE_TO_ACTION: Readonly<Record<DouyinRendererActionMessage['type'], DouyinActionKind>> = {
  'renderer-activate': 'plusOne',
  'renderer-copy': 'copy',
  'renderer-favorite': 'favorite',
  'renderer-reply': 'reply',
}

export function createDouyinActionDispatcher(
  options: DouyinActionDispatcherOptions,
): DouyinActionDispatcher {
  const maxLength = options.maxLength ?? 1_000
  const now = options.now ?? (() => performance.now())
  const trustedWindowMs = options.trustedWindowMs ?? 1_500
  const settledRequests = new Set<string>()
  const cleanupTimers = new Set<ReturnType<typeof setTimeout>>()
  let trustedAction: TrustedRendererAction | null = null
  let started = false

  function result(
    value: Omit<DouyinActionDispatchResult, 'requestId'> & { requestId?: string },
  ): DouyinActionDispatchResult {
    const completed = { ...value, requestId: value.requestId || '' }
    options.onDispatch?.(completed)
    return completed
  }

  function rejected(
    action: DouyinActionKind,
    source: DouyinActionSource,
    reason: DouyinActionFailureReason,
    requestId = '',
  ): DouyinActionDispatchResult {
    return result({ accepted: false, action, ok: false, reason, requestId, source })
  }

  function actionEnabled(action: DouyinActionKind): boolean {
    return options.enabled() && Boolean(options.actions()[action])
  }

  function normalizeMessage(value: unknown): string {
    return options.parseMessage(value, maxLength)
  }

  function rememberSettledRequest(action: DouyinActionKind, requestId: string): boolean {
    const key = `${action}:${requestId}`
    if (settledRequests.has(key)) return false
    settledRequests.add(key)
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer)
      settledRequests.delete(key)
    }, 10_000)
    cleanupTimers.add(timer)
    return true
  }

  function rememberTrustedRendererAction(event: Event): boolean {
    if (!event.isTrusted) return false
    const path = eventComposedPath(event)
    const actionBar = path.find(
      (item): item is HTMLElement =>
        item instanceof HTMLElement && item.matches('.bcp-douyin-dom-action'),
    )
    const item = path.find(
      (entry): entry is HTMLElement =>
        entry instanceof HTMLElement && entry.matches('.bcp-douyin-dom-action-item'),
    )
    if (!actionBar || !item || !actionBar.contains(item)) return false
    const action = DATASET_TO_ACTION[String(item.dataset.action || '')]
    if (!action) return false
    trustedAction = {
      action,
      at: now(),
      instanceId: String(actionBar.dataset.instanceId || ''),
      message: normalizeMessage(actionBar.dataset.message),
      trackId: String(actionBar.dataset.trackId || ''),
    }
    return true
  }

  function consumeTrustedRendererAction(
    action: DouyinActionKind,
    message: DouyinRendererActionMessage,
    normalizedMessage: string,
  ): boolean {
    const trusted = trustedAction
    trustedAction = null
    return Boolean(
      trusted &&
        now() - trusted.at <= trustedWindowMs &&
        trusted.action === action &&
        trusted.instanceId === String(message.instanceId || '') &&
        trusted.trackId === String(message.trackId || '') &&
        trusted.message === normalizedMessage,
    )
  }

  async function execute(
    action: DouyinActionKind,
    source: DouyinActionSource,
    candidate: DouyinActionCandidate,
    resolved?: DouyinRichRecoveryResult,
  ): Promise<DouyinActionDispatchResult> {
    const requestId = String(candidate.requestId || '')
    try {
      if (action === 'reply') {
        const ok = await options.prepareReply(
          candidate,
          source === 'renderer' ? 'renderer-reply' : 'card-reply',
        )
        return result({
          accepted: true,
          action,
          ok,
          outcome: ok ? 'reply-ready' : 'reply-failed',
          requestId,
          source,
        })
      }

      let richAction: DouyinRichAction
      if (resolved) richAction = resolved.action
      else if (source === 'renderer') {
        richAction = (
          await options.resolver.resolveWithRetry(candidate.message, candidate.content || [])
        ).action
      } else {
        richAction = options.resolver.actionFromPayload(
          candidate.richPayload,
          candidate.message,
        )
      }

      if (action === 'copy') {
        const ok = await options.copy(richAction.text)
        return result({
          accepted: true,
          action,
          ok,
          outcome: ok ? 'copied' : 'copy-failed',
          requestId,
          source,
        })
      }
      if (action === 'favorite') {
        const saved = await options.favorite(
          richAction.text,
          richAction.richPayload || undefined,
        )
        return result({
          accepted: true,
          action,
          ok: saved === true,
          outcome: saved === true ? 'favorite-saved' : 'favorite-skipped',
          requestId,
          source,
        })
      }
      const ok = await options.repeatMessage(
        richAction.text,
        richAction.richPayload || richAction.text,
      )
      return result({
        accepted: true,
        action,
        ok,
        outcome: ok ? 'sent' : 'send-failed',
        requestId,
        source,
      })
    } catch {
      return rejected(action, source, 'operation-error', requestId)
    }
  }

  async function dispatchDom(
    action: DouyinActionKind,
    candidate: DouyinActionCandidate | null,
  ): Promise<DouyinActionDispatchResult> {
    if (!actionEnabled(action)) return rejected(action, 'dom', 'disabled')
    if (!candidate) return rejected(action, 'dom', 'missing-candidate')
    const message = normalizeMessage(candidate.message)
    if (!options.isPlausibleMessage(message, maxLength)) {
      return rejected(action, 'dom', 'invalid-message')
    }
    return execute(action, 'dom', { ...candidate, message })
  }

  async function dispatchRenderer(
    action: DouyinActionKind,
    message: DouyinRendererActionMessage,
  ): Promise<DouyinActionDispatchResult> {
    const requestId = String(message.requestId ?? '')
    const text = normalizeMessage(message.text)
    if (!requestId || !options.isPlausibleMessage(text, maxLength)) {
      return rejected(action, 'renderer', 'invalid-message', requestId)
    }
    if (MESSAGE_TYPE_TO_ACTION[message.type] !== action) {
      return rejected(action, 'renderer', 'untrusted', requestId)
    }
    if (!actionEnabled(action)) return rejected(action, 'renderer', 'disabled', requestId)
    if (settledRequests.has(`${action}:${requestId}`)) {
      return rejected(action, 'renderer', 'duplicate', requestId)
    }
    if (!consumeTrustedRendererAction(action, message, text)) {
      return rejected(action, 'renderer', 'untrusted', requestId)
    }
    if (!rememberSettledRequest(action, requestId)) {
      return rejected(action, 'renderer', 'duplicate', requestId)
    }

    const baseCandidate: DouyinActionCandidate = {
      content: message.content,
      instanceId: String(message.instanceId || ''),
      message: text,
      messageId: String(message.messageId || ''),
      requestId,
      trackId: String(message.trackId || ''),
    }
    if (action !== 'reply') return execute(action, 'renderer', baseCandidate)

    const replyMessage = message as Extract<
      DouyinRendererActionMessage,
      { type: 'renderer-reply' }
    >
    const recovery = options.resolver.resolve(text, message.content)
    return execute(
      action,
      'renderer',
      {
        ...baseCandidate,
        message: recovery.payload.text || text,
        observedAt: Number(replyMessage.observedAt) || 0,
        richPayload: recovery.payload,
        sender:
          String(replyMessage.sender || '').trim() ||
          recovery.payload.sender ||
          options.senderForMessage(text, {
            messageId: message.messageId,
            observedAt: replyMessage.observedAt,
          }),
      },
      recovery,
    )
  }

  function start(): void {
    if (started) return
    started = true
    document.addEventListener('click', rememberTrustedRendererAction, true)
  }

  function destroy(): void {
    if (started) document.removeEventListener('click', rememberTrustedRendererAction, true)
    started = false
    trustedAction = null
    for (const timer of cleanupTimers) clearTimeout(timer)
    cleanupTimers.clear()
    settledRequests.clear()
  }

  return {
    destroy,
    dispatchDom,
    dispatchRenderer,
    pendingCount: () => settledRequests.size,
    rememberTrustedRendererAction,
    start,
  }
}

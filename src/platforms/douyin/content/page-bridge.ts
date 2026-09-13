import type { ActionSettings } from '../../../core/types'
import {
  DOUYIN_PAGE_SOURCE,
  createDouyinContentToPageMessage,
  dispatchDouyinPageToContentMessage,
  isDouyinPageToContentMessage,
  type DouyinContentToPageMessage,
  type DouyinContentToPagePayload,
  type DouyinPageToContentHandlers,
  type DouyinPageToContentMessage,
} from '../protocol'

type ReadyMessage = Extract<DouyinPageToContentMessage, { type: 'ready' }>
type DebugSnapshotMessage = Extract<
  DouyinPageToContentMessage,
  { type: 'debug-snapshot' }
>

export interface DouyinBridgeRequest<Response> {
  requestId: number
  response: Promise<Response | null>
}

export interface DouyinWindowMessageObservation<Value> {
  cancel(): void
  result: Promise<Value | null>
}

export interface DouyinRendererSettingsInput {
  actions: ActionSettings
  capsuleScalePercent: number
  enabled: boolean
  repeatReminderEnabled: boolean
  version: string
}

interface PendingRequest<Response extends ReadyMessage | DebugSnapshotMessage> {
  responseType: Response['type']
  resolve(value: Response | null): void
  timer: ReturnType<typeof setTimeout>
}

interface RawMessageObserver<Value = unknown> {
  predicate(event: MessageEvent): Value | null
  resolve(value: Value | null): void
  timer: ReturnType<typeof setTimeout>
}

export interface DouyinPageBridgeOptions {
  handlers: DouyinPageToContentHandlers
  onInvalidPageMessage?(value: unknown): void
  onProbe?(requestId: number): void
  target?: Window
}

export interface DouyinPageBridge {
  beginRecovery(delays?: readonly number[]): void
  destroy(): void
  heartbeat(settings: DouyinRendererSettingsInput): void
  isReady(): boolean
  markUnavailable(): void
  observeWindowMessage<Value>(
    predicate: (event: MessageEvent) => Value | null,
    timeoutMs: number,
  ): DouyinWindowMessageObservation<Value>
  pendingRequestCount(): number
  ping(timeoutMs?: number): DouyinBridgeRequest<ReadyMessage>
  requestDebugSnapshot(timeoutMs?: number): DouyinBridgeRequest<DebugSnapshotMessage>
  send(payload: DouyinContentToPagePayload): void
  sendRendererSettings(
    settings: DouyinRendererSettingsInput,
    reason: string,
    sentAt?: number,
  ): void
  start(): void
}

const DEFAULT_REQUEST_TIMEOUT_MS = 8_000
const DEFAULT_RECOVERY_DELAYS = [0, 1_000, 3_000, 7_000] as const
const MAX_SETTLED_RESPONSE_KEYS = 200

export function createDouyinPageBridge(options: DouyinPageBridgeOptions): DouyinPageBridge {
  const target = options.target ?? window
  const pendingRequests = new Map<number, PendingRequest<ReadyMessage | DebugSnapshotMessage>>()
  const rawObservers = new Set<RawMessageObserver>()
  const recoveryTimers = new Set<ReturnType<typeof setTimeout>>()
  const settledResponseKeys = new Set<string>()
  let nextRequestId = 1
  let ready = false
  let started = false
  let destroyed = false

  function send(payload: DouyinContentToPagePayload): void {
    if (destroyed) return
    const message = createDouyinContentToPageMessage<DouyinContentToPageMessage>(payload)
    target.postMessage(message, '*')
  }

  function rememberSettledResponse(message: ReadyMessage | DebugSnapshotMessage): boolean {
    const key = `${message.type}:${message.requestId}`
    if (settledResponseKeys.has(key)) return false
    settledResponseKeys.add(key)
    if (settledResponseKeys.size > MAX_SETTLED_RESPONSE_KEYS) {
      const oldest = settledResponseKeys.values().next().value
      if (typeof oldest === 'string') settledResponseKeys.delete(oldest)
    }
    return true
  }

  function clearRecoveryTimers(): void {
    for (const timer of recoveryTimers) clearTimeout(timer)
    recoveryTimers.clear()
  }

  function settlePending(message: DouyinPageToContentMessage): boolean {
    if (message.type !== 'ready' && message.type !== 'debug-snapshot') return true
    if (!rememberSettledResponse(message)) return false
    const pending = pendingRequests.get(message.requestId)
    if (pending?.responseType === message.type) {
      clearTimeout(pending.timer)
      pendingRequests.delete(message.requestId)
      pending.resolve(message)
    }
    if (message.type === 'ready') {
      ready = true
      clearRecoveryTimers()
    }
    return true
  }

  function onWindowMessage(event: MessageEvent): void {
    if (event.source !== target) return
    for (const observer of rawObservers) {
      const value = observer.predicate(event)
      if (value === null) continue
      clearTimeout(observer.timer)
      rawObservers.delete(observer)
      observer.resolve(value)
    }
    if (!isDouyinPageToContentMessage(event.data)) {
      if (
        event.data &&
        typeof event.data === 'object' &&
        'source' in event.data &&
        event.data.source === DOUYIN_PAGE_SOURCE
      ) {
        options.onInvalidPageMessage?.(event.data)
      }
      return
    }
    if (!settlePending(event.data)) return
    dispatchDouyinPageToContentMessage(event.data, options.handlers)
  }

  function request<Response extends ReadyMessage | DebugSnapshotMessage>(
    responseType: Response['type'],
    payload: Extract<DouyinContentToPagePayload, { type: 'ping' | 'debug-request' }>['type'],
    timeoutMs: number,
  ): DouyinBridgeRequest<Response> {
    const requestId = nextRequestId++
    let resolveResponse: (value: Response | null) => void = () => {}
    const response = new Promise<Response | null>((resolve) => {
      resolveResponse = resolve
    })
    const timer = setTimeout(() => {
      const pending = pendingRequests.get(requestId)
      if (!pending) return
      pendingRequests.delete(requestId)
      pending.resolve(null)
    }, Math.max(0, timeoutMs))
    pendingRequests.set(requestId, {
      responseType,
      resolve: resolveResponse as PendingRequest<ReadyMessage | DebugSnapshotMessage>['resolve'],
      timer,
    })
    send({ type: payload, requestId })
    return { requestId, response }
  }

  function ping(timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): DouyinBridgeRequest<ReadyMessage> {
    const pending = request<ReadyMessage>('ready', 'ping', timeoutMs)
    options.onProbe?.(pending.requestId)
    return pending
  }

  function requestDebugSnapshot(
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): DouyinBridgeRequest<DebugSnapshotMessage> {
    return request<DebugSnapshotMessage>('debug-snapshot', 'debug-request', timeoutMs)
  }

  function sendRendererSettings(
    settings: DouyinRendererSettingsInput,
    reason: string,
    sentAt = Date.now(),
  ): void {
    send({
      type: 'renderer-settings',
      ...settings,
      reason: String(reason || 'sync').slice(0, 80),
      sentAt,
    })
  }

  function heartbeat(settings: DouyinRendererSettingsInput): void {
    sendRendererSettings(settings, 'heartbeat')
  }

  function beginRecovery(delays: readonly number[] = DEFAULT_RECOVERY_DELAYS): void {
    clearRecoveryTimers()
    for (const delay of delays) {
      if (delay <= 0) {
        if (!ready) void ping().response
        continue
      }
      const timer = setTimeout(() => {
        recoveryTimers.delete(timer)
        if (!ready) void ping().response
      }, delay)
      recoveryTimers.add(timer)
    }
  }

  function observeWindowMessage<Value>(
    predicate: (event: MessageEvent) => Value | null,
    timeoutMs: number,
  ): DouyinWindowMessageObservation<Value> {
    let resolveResult: (value: Value | null) => void = () => {}
    const result = new Promise<Value | null>((resolve) => {
      resolveResult = resolve
    })
    const observer: RawMessageObserver<Value> = {
      predicate,
      resolve: resolveResult,
      timer: 0 as unknown as ReturnType<typeof setTimeout>,
    }
    observer.timer = setTimeout(() => {
      rawObservers.delete(observer)
      resolveResult(null)
    }, Math.max(0, timeoutMs))
    rawObservers.add(observer as RawMessageObserver)
    return {
      cancel() {
        if (!rawObservers.delete(observer as RawMessageObserver)) return
        clearTimeout(observer.timer)
        resolveResult(null)
      },
      result,
    }
  }

  function start(): void {
    if (started || destroyed) return
    started = true
    target.addEventListener('message', onWindowMessage)
  }

  function markUnavailable(): void {
    ready = false
    clearRecoveryTimers()
  }

  function destroy(): void {
    if (destroyed) return
    destroyed = true
    ready = false
    clearRecoveryTimers()
    if (started) target.removeEventListener('message', onWindowMessage)
    started = false
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timer)
      pending.resolve(null)
    }
    pendingRequests.clear()
    for (const observer of rawObservers) {
      clearTimeout(observer.timer)
      observer.resolve(null)
    }
    rawObservers.clear()
    settledResponseKeys.clear()
  }

  return {
    beginRecovery,
    destroy,
    heartbeat,
    isReady: () => ready,
    markUnavailable,
    observeWindowMessage,
    pendingRequestCount: () => pendingRequests.size,
    ping,
    requestDebugSnapshot,
    send,
    sendRendererSettings,
    start,
  }
}

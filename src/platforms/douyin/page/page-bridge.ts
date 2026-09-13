import {
  DOUYIN_CONTENT_SOURCE,
  createDouyinPageToContentMessage,
  dispatchDouyinContentToPageMessage,
  isDouyinContentToPageMessage
} from '../protocol'
import type {
  DouyinContentToPageHandlers,
  DouyinContentToPageMessage,
  DouyinPageToContentMessage,
  DouyinPageToContentPayload,
  DouyinRequestId
} from '../protocol'

type PageResponseMessage = Extract<
  DouyinContentToPageMessage,
  {
    type: 'renderer-copy-result' | 'renderer-favorite-result' | 'renderer-result'
  }
>

type PageRequestPayload = Extract<
  DouyinPageToContentPayload,
  { type: 'renderer-activate' | 'renderer-copy' | 'renderer-favorite' }
>

type ResponseFor<Request extends PageRequestPayload> =
  Request['type'] extends 'renderer-activate'
    ? Extract<PageResponseMessage, { type: 'renderer-result' }>
    : Request['type'] extends 'renderer-copy'
      ? Extract<PageResponseMessage, { type: 'renderer-copy-result' }>
      : Extract<PageResponseMessage, { type: 'renderer-favorite-result' }>

type PageCommandHandlers = Omit<
  DouyinContentToPageHandlers,
  'renderer-copy-result' | 'renderer-favorite-result' | 'renderer-result'
>

interface PendingResponse {
  settle: (message: PageResponseMessage) => void
  timer: number
}

export interface DouyinPageRequestOptions<Request extends PageRequestPayload> {
  onResponse: (message: ResponseFor<Request>) => void
  onTimeout: () => void
  timeoutMs: number
}

export interface DouyinPageBridgeOptions {
  handlers: PageCommandHandlers
  onProtocolRejected?: (payload: unknown) => void
  target?: Window
}

export interface DouyinPageBridge {
  destroy: () => void
  request: <Request extends PageRequestPayload>(
    payload: Request,
    options: DouyinPageRequestOptions<Request>
  ) => () => void
  send: (payload: DouyinPageToContentPayload) => void
  start: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function responseTypeFor(request: PageRequestPayload): PageResponseMessage['type'] {
  if (request.type === 'renderer-activate') return 'renderer-result'
  if (request.type === 'renderer-copy') return 'renderer-copy-result'
  return 'renderer-favorite-result'
}

function responseKey(type: PageResponseMessage['type'], requestId: DouyinRequestId): string {
  return `${type}:${requestId}`
}

export function createDouyinPageBridge(options: DouyinPageBridgeOptions): DouyinPageBridge {
  const target = options.target ?? window
  const pendingResponses = new Map<string, PendingResponse>()
  let started = false

  const settleResponse = (message: PageResponseMessage): void => {
    const key = responseKey(message.type, message.requestId)
    const pending = pendingResponses.get(key)
    if (!pending) return
    pendingResponses.delete(key)
    target.clearTimeout(pending.timer)
    pending.settle(message)
  }

  const protocolHandlers: DouyinContentToPageHandlers = {
    ...options.handlers,
    'renderer-copy-result': settleResponse,
    'renderer-favorite-result': settleResponse,
    'renderer-result': settleResponse
  }

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== target) return
    if (!isDouyinContentToPageMessage(event.data)) {
      if (isRecord(event.data) && event.data.source === DOUYIN_CONTENT_SOURCE) {
        options.onProtocolRejected?.(event.data)
      }
      return
    }
    dispatchDouyinContentToPageMessage(event.data, protocolHandlers)
  }

  const send = (payload: DouyinPageToContentPayload): void => {
    target.postMessage(
      createDouyinPageToContentMessage<DouyinPageToContentMessage>(payload),
      '*'
    )
  }

  const request = <Request extends PageRequestPayload>(
    payload: Request,
    requestOptions: DouyinPageRequestOptions<Request>
  ): (() => void) => {
    const responseType = responseTypeFor(payload)
    const key = responseKey(responseType, payload.requestId)
    if (pendingResponses.has(key)) {
      throw new Error(`Duplicate Douyin page request: ${key}`)
    }
    const pending: PendingResponse = {
      settle: (message) => requestOptions.onResponse(message as ResponseFor<Request>),
      timer: 0
    }
    pending.timer = target.setTimeout(() => {
      if (pendingResponses.get(key) !== pending) return
      pendingResponses.delete(key)
      requestOptions.onTimeout()
    }, Math.max(0, requestOptions.timeoutMs))
    pendingResponses.set(key, pending)
    try {
      send(payload)
    } catch (error) {
      pendingResponses.delete(key)
      target.clearTimeout(pending.timer)
      throw error
    }
    return () => {
      if (pendingResponses.get(key) !== pending) return
      pendingResponses.delete(key)
      target.clearTimeout(pending.timer)
    }
  }

  return {
    destroy() {
      if (started) {
        target.removeEventListener('message', handleMessage)
        started = false
      }
      pendingResponses.forEach((pending) => target.clearTimeout(pending.timer))
      pendingResponses.clear()
    },
    request,
    send,
    start() {
      if (started) return
      target.addEventListener('message', handleMessage)
      started = true
    }
  }
}

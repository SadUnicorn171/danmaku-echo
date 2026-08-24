import type { PlatformId } from '../../core/types'

export const INSTALL_NATIVE_SEND_OBSERVER = 'danmaku-echo.live.install-native-send-observer' as const
export const NATIVE_SEND_RESULT_SOURCE = 'danmaku-echo.live-native-send-observer'

const NONCE_PATTERN = /^[a-z0-9-]{8,80}$/i

export interface InstallNativeSendObserverRequest {
  nonce: string
  platform: PlatformId
  type: typeof INSTALL_NATIVE_SEND_OBSERVER
}

export interface NativeSendObservation {
  code?: number | string
  endpoint?: string
  httpStatus?: number
  message?: string
  method?: string
  nonce: string
  platform: PlatformId
  requestOnly?: boolean
  source: typeof NATIVE_SEND_RESULT_SOURCE
  transport: 'fetch' | 'websocket' | 'xhr'
  type: 'native-send-result'
}

export function isInstallNativeSendObserverRequest(
  value: unknown,
): value is InstallNativeSendObserverRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<InstallNativeSendObserverRequest>
  return request.type === INSTALL_NATIVE_SEND_OBSERVER
    && typeof request.nonce === 'string'
    && NONCE_PATTERN.test(request.nonce)
    && (request.platform === 'bilibili' || request.platform === 'douyin'
      || request.platform === 'douyu' || request.platform === 'huya')
}

export function isNativeSendObservation(
  value: unknown,
  nonce: string,
  platform: PlatformId,
): value is NativeSendObservation {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<NativeSendObservation>
  return result.source === NATIVE_SEND_RESULT_SOURCE
    && result.type === 'native-send-result'
    && result.nonce === nonce
    && result.platform === platform
    && (result.transport === 'fetch' || result.transport === 'xhr'
      || result.transport === 'websocket')
}

/**
 * Runs for one send attempt in the page's MAIN world. It publishes only a
 * bounded transport summary; query strings, headers, cookies and bodies never
 * cross into the extension context.
 */
export function installNativeSendObserverInPage(options: {
  nonce: string
  platform: PlatformId
}): { ok: boolean } {
  const PAGE_SOURCE = 'danmaku-echo.live-native-send-observer'
  const nonce = String(options.nonce || '')
  const platform = String(options.platform || '')
  if (!/^[a-z0-9-]{8,80}$/i.test(nonce)
    || !['bilibili', 'douyin', 'douyu', 'huya'].includes(platform)) {
    return { ok: false }
  }

  type ObservationState = { restore: () => void }
  type ObservedXhr = XMLHttpRequest & {
    __danmakuEchoSendMethod?: string
    __danmakuEchoSendUrl?: string
  }
  const runtime = globalThis as typeof globalThis & {
    __danmakuEchoNativeSendObserver?: ObservationState
  }
  runtime.__danmakuEchoNativeSendObserver?.restore()

  const originalFetch = globalThis.fetch
  const originalOpen = XMLHttpRequest.prototype.open
  const originalXhrSend = XMLHttpRequest.prototype.send
  const originalWebSocketSend = WebSocket.prototype.send
  let settled = false
  let timeout = 0

  const parsedUrl = (value: unknown) => {
    try {
      return new URL(String(value || ''), location.href)
    } catch {
      return null
    }
  }
  const endpointOf = (value: unknown) => {
    const parsed = parsedUrl(value)
    return parsed ? `${parsed.hostname.toLowerCase()}${parsed.pathname}`.slice(0, 120) : ''
  }
  const matchesHttpSend = (url: unknown, method: unknown) => {
    if (String(method || 'GET').toUpperCase() !== 'POST') return false
    const parsed = parsedUrl(url)
    if (!parsed) return false
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname.toLowerCase()
    if (platform === 'bilibili') {
      return host === 'api.live.bilibili.com' && path === '/msg/send'
    }
    if (platform === 'douyin') {
      return host.endsWith('.douyin.com') && /\/(?:webcast\/)?room\/chat(?:\/|$)/.test(path)
    }
    const platformHost = platform === 'douyu'
      ? host === 'douyu.com' || host.endsWith('.douyu.com')
      : host === 'huya.com' || host.endsWith('.huya.com')
    return platformHost && /(?:chat|danmu|barrage|message|comment|send)/.test(path)
  }
  const bodyText = (value: unknown) => {
    try {
      if (typeof value === 'string') return value.slice(0, 16_384)
      if (value instanceof ArrayBuffer) {
        return new TextDecoder().decode(value.slice(0, 16_384))
      }
      if (ArrayBuffer.isView(value)) {
        return new TextDecoder().decode(
          new Uint8Array(value.buffer, value.byteOffset, Math.min(value.byteLength, 16_384)),
        )
      }
    } catch {
      // An undecodable binary frame is not safe evidence of a chat request.
    }
    return ''
  }
  const matchesWebSocketSend = (value: unknown) => {
    const text = bodyText(value)
    if (!text) return false
    if (platform === 'douyu') {
      return /type@=chatmessage(?:\/|$)/i.test(text) && /content@=/.test(text)
    }
    if (platform === 'huya') {
      return /(?:sendmessage|chatmessage|sendchat|barrage|danmu)/i.test(text)
    }
    return false
  }
  const envelopeSummary = (value: unknown) => {
    if (!value || typeof value !== 'object') return {}
    const envelope = value as Record<string, unknown>
    const rawCode = envelope.code ?? envelope.status_code ?? envelope.status ?? envelope.errno
    const numericCode = Number(rawCode)
    const code = rawCode === undefined
      ? undefined
      : Number.isFinite(numericCode)
        ? numericCode
        : String(rawCode).replace(/\s+/g, '').slice(0, 40)
    return {
      code,
      message: String(
        envelope.message ?? envelope.msg ?? envelope.status_msg ?? envelope.prompts ?? '',
      ).replace(/\s+/g, ' ').trim().slice(0, 180),
    }
  }
  const restore = () => {
    if (timeout) clearTimeout(timeout)
    if (globalThis.fetch === observedFetch) globalThis.fetch = originalFetch
    if (XMLHttpRequest.prototype.open === observedOpen) XMLHttpRequest.prototype.open = originalOpen
    if (XMLHttpRequest.prototype.send === observedXhrSend) {
      XMLHttpRequest.prototype.send = originalXhrSend
    }
    if (WebSocket.prototype.send === observedWebSocketSend) {
      WebSocket.prototype.send = originalWebSocketSend
    }
    if (runtime.__danmakuEchoNativeSendObserver?.restore === restore) {
      delete runtime.__danmakuEchoNativeSendObserver
    }
  }
  const publish = (value: Record<string, unknown>) => {
    if (settled) return
    settled = true
    window.postMessage({
      ...value,
      nonce,
      platform,
      source: PAGE_SOURCE,
      type: 'native-send-result',
    }, '*')
    restore()
  }
  const publishFetchResponse = async (response: Response, body: unknown, url: unknown) => {
    let envelope: unknown = null
    try {
      envelope = await response.clone().json()
    } catch {
      // HTTP metadata still makes this request useful for diagnostics.
    }
    publish({
      ...envelopeSummary(envelope),
      endpoint: endpointOf(url),
      httpStatus: response.status,
      method: 'POST',
      requestOnly: false,
      transport: 'fetch',
    })
    void body
  }
  function observedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const request = input instanceof Request ? input : null
    const url = request?.url || String(input || '')
    const method = init?.method || request?.method || 'GET'
    const response = Reflect.apply(originalFetch, globalThis, [input, init])
    if (matchesHttpSend(url, method)) {
      response.then(
        (result) => void publishFetchResponse(result, init?.body, url),
        (error) => publish({
          endpoint: endpointOf(url),
          httpStatus: 0,
          message: String(error instanceof Error ? error.message : error).slice(0, 180),
          method: 'POST',
          requestOnly: false,
          transport: 'fetch',
        }),
      )
    }
    return response
  }
  function observedOpen(this: ObservedXhr, method: string, url: string | URL, ...rest: unknown[]) {
    this.__danmakuEchoSendMethod = String(method || 'GET')
    this.__danmakuEchoSendUrl = String(url || '')
    return Reflect.apply(originalOpen, this, [method, url, ...rest] as Parameters<XMLHttpRequest['open']>)
  }
  function observedXhrSend(this: ObservedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
    if (matchesHttpSend(this.__danmakuEchoSendUrl, this.__danmakuEchoSendMethod)) {
      const url = this.__danmakuEchoSendUrl
      this.addEventListener('loadend', () => {
        let envelope: unknown = null
        try {
          envelope = JSON.parse(this.responseText)
        } catch {
          // HTTP metadata still makes this request useful for diagnostics.
        }
        publish({
          ...envelopeSummary(envelope),
          endpoint: endpointOf(url),
          httpStatus: this.status,
          method: 'POST',
          requestOnly: false,
          transport: 'xhr',
        })
      }, { once: true })
    }
    return Reflect.apply(originalXhrSend, this, [body])
  }
  function observedWebSocketSend(this: WebSocket, data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (matchesWebSocketSend(data)) {
      publish({
        endpoint: endpointOf(this.url),
        method: 'SEND',
        requestOnly: true,
        transport: 'websocket',
      })
    }
    return Reflect.apply(originalWebSocketSend, this, [data])
  }

  if (typeof originalFetch === 'function') globalThis.fetch = observedFetch
  XMLHttpRequest.prototype.open = observedOpen as typeof XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.send = observedXhrSend
  WebSocket.prototype.send = observedWebSocketSend
  timeout = window.setTimeout(restore, 8_000)
  runtime.__danmakuEchoNativeSendObserver = { restore }
  return { ok: true }
}

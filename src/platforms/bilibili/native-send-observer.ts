export const BILIBILI_INSTALL_NATIVE_SEND_OBSERVER =
  'danmaku-echo.bilibili.install-native-send-observer' as const
export const BILIBILI_NATIVE_SEND_RESULT_SOURCE = 'danmaku-echo.bilibili-native-send-observer'

const NONCE_PATTERN = /^[a-z0-9-]{8,80}$/i

export interface BilibiliInstallNativeSendObserverRequest {
  nonce: string
  type: typeof BILIBILI_INSTALL_NATIVE_SEND_OBSERVER
}

export interface BilibiliNativeSendObservation {
  code?: number
  dmType?: string
  endpoint: string
  hasEmoticonOptions?: boolean
  httpStatus?: number
  identity?: string
  message?: string
  method: 'POST'
  nonce: string
  source: typeof BILIBILI_NATIVE_SEND_RESULT_SOURCE
  transport: 'fetch' | 'xhr'
  type: 'native-send-result'
}

export function isBilibiliInstallNativeSendObserverRequest(
  value: unknown,
): value is BilibiliInstallNativeSendObserverRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<BilibiliInstallNativeSendObserverRequest>
  return request.type === BILIBILI_INSTALL_NATIVE_SEND_OBSERVER
    && typeof request.nonce === 'string'
    && NONCE_PATTERN.test(request.nonce)
}

export function isBilibiliNativeSendObservation(
  value: unknown,
  nonce: string,
): value is BilibiliNativeSendObservation {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<BilibiliNativeSendObservation>
  return result.source === BILIBILI_NATIVE_SEND_RESULT_SOURCE
    && result.type === 'native-send-result'
    && result.nonce === nonce
    && (result.transport === 'fetch' || result.transport === 'xhr')
}

/**
 * Runs briefly in Bilibili's MAIN world. It observes exactly one native
 * `/msg/send` response, posts a sanitized result, then restores fetch/XHR.
 * Authentication fields and the full form body never leave the page.
 */
export function installBilibiliNativeSendObserverInPage(options: {
  nonce: string
}): { ok: boolean } {
  const PAGE_SOURCE = 'danmaku-echo.bilibili-native-send-observer'
  const SEND_PATH = '/msg/send'
  const nonce = String(options.nonce || '')
  if (!/^[a-z0-9-]{8,80}$/i.test(nonce)) return { ok: false }

  type ObservationState = { restore: () => void }
  type ObservedXhr = XMLHttpRequest & {
    __danmakuEchoSendMethod?: string
    __danmakuEchoSendUrl?: string
  }
  const runtime = globalThis as typeof globalThis & {
    __danmakuEchoBilibiliNativeSendObserver?: ObservationState
  }
  runtime.__danmakuEchoBilibiliNativeSendObserver?.restore()

  const originalFetch = globalThis.fetch
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  let settled = false
  let timeout = 0

  const matchesSend = (url: unknown, method: unknown) => {
    if (String(method || 'GET').toUpperCase() !== 'POST') return false
    try {
      const parsed = new URL(String(url || ''), location.href)
      return parsed.hostname === 'api.live.bilibili.com' && parsed.pathname === SEND_PATH
    } catch {
      return false
    }
  }
  const formSummary = (body: unknown) => {
    if (!(body instanceof FormData)) return {}
    const identity = String(body.get('msg') || '').trim().toLowerCase()
    return {
      dmType: String(body.get('dm_type') || ''),
      hasEmoticonOptions: body.has('emoticonOptions'),
      identity: /^room_[1-9]\d{0,19}_[1-9]\d{0,19}$/.test(identity) ? identity : undefined,
    }
  }
  const envelopeSummary = (value: unknown) => {
    if (!value || typeof value !== 'object') return {}
    const envelope = value as { code?: unknown; message?: unknown; msg?: unknown }
    const code = Number(envelope.code)
    return {
      code: Number.isFinite(code) ? code : undefined,
      message: String(envelope.message || envelope.msg || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180),
    }
  }
  const restore = () => {
    if (timeout) clearTimeout(timeout)
    if (globalThis.fetch === observedFetch) globalThis.fetch = originalFetch
    if (XMLHttpRequest.prototype.open === observedOpen) XMLHttpRequest.prototype.open = originalOpen
    if (XMLHttpRequest.prototype.send === observedSend) XMLHttpRequest.prototype.send = originalSend
    if (runtime.__danmakuEchoBilibiliNativeSendObserver?.restore === restore) {
      delete runtime.__danmakuEchoBilibiliNativeSendObserver
    }
  }
  const publish = (value: Record<string, unknown>) => {
    if (settled) return
    settled = true
    window.postMessage({
      ...value,
      nonce,
      source: PAGE_SOURCE,
      type: 'native-send-result',
    }, '*')
    restore()
  }
  const publishFetchResponse = async (response: Response, body: unknown) => {
    let envelope: unknown = null
    try {
      envelope = await response.clone().json()
    } catch {
      // HTTP metadata still makes this attempt observable.
    }
    publish({
      ...formSummary(body),
      ...envelopeSummary(envelope),
      endpoint: 'api.live.bilibili.com/msg/send',
      httpStatus: response.status,
      method: 'POST',
      transport: 'fetch',
    })
  }
  function observedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const request = input instanceof Request ? input : null
    const url = request?.url || String(input || '')
    const method = init?.method || request?.method || 'GET'
    const body = init?.body
    const response = Reflect.apply(originalFetch, globalThis, [input, init])
    if (matchesSend(url, method)) {
      response.then(
        (result) => void publishFetchResponse(result, body),
        (error) => publish({
          ...formSummary(body),
          endpoint: 'api.live.bilibili.com/msg/send',
          message: String(error instanceof Error ? error.message : error).slice(0, 180),
          method: 'POST',
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
  function observedSend(this: ObservedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
    if (matchesSend(this.__danmakuEchoSendUrl, this.__danmakuEchoSendMethod)) {
      const summary = formSummary(body)
      this.addEventListener('loadend', () => {
        let envelope: unknown = null
        try {
          envelope = JSON.parse(this.responseText)
        } catch {
          // HTTP metadata still makes this attempt observable.
        }
        publish({
          ...summary,
          ...envelopeSummary(envelope),
          endpoint: 'api.live.bilibili.com/msg/send',
          httpStatus: this.status,
          method: 'POST',
          transport: 'xhr',
        })
      }, { once: true })
    }
    return Reflect.apply(originalSend, this, [body])
  }

  if (typeof originalFetch === 'function') globalThis.fetch = observedFetch
  XMLHttpRequest.prototype.open = observedOpen as typeof XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.send = observedSend
  timeout = window.setTimeout(restore, 10_000)
  runtime.__danmakuEchoBilibiliNativeSendObserver = { restore }
  return { ok: true }
}

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  INSTALL_NATIVE_SEND_OBSERVER,
  NATIVE_SEND_RESULT_SOURCE,
  installNativeSendObserverInPage,
  isInstallNativeSendObserverRequest,
} from '../native-send-observer'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('native send observation', () => {
  it('validates a bounded platform-scoped request', () => {
    expect(isInstallNativeSendObserverRequest({
      nonce: 'observer-12345678',
      platform: 'douyu',
      type: INSTALL_NATIVE_SEND_OBSERVER,
    })).toBe(true)
    expect(isInstallNativeSendObserverRequest({
      nonce: 'observer-12345678',
      platform: 'unknown',
      type: INSTALL_NATIVE_SEND_OBSERVER,
    })).toBe(false)
  })

  it('publishes a sanitized Bilibili HTTP result', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: 10031, message: '发送过快' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const received = new Promise<unknown>((resolve) => {
      const listener = (event: MessageEvent) => {
        if (event.data?.source !== NATIVE_SEND_RESULT_SOURCE || event.data.pending) return
        window.removeEventListener('message', listener)
        resolve(event.data)
      }
      window.addEventListener('message', listener)
    })

    expect(installNativeSendObserverInPage({
      nonce: 'observer-12345678',
      platform: 'bilibili',
    })).toEqual({ ok: true })
    const form = new FormData()
    form.set('msg', 'hello')
    form.set('csrf', 'secret-csrf')
    await fetch('https://api.live.bilibili.com/msg/send?w_rid=secret', {
      body: form,
      method: 'POST',
    })

    const result = await received
    expect(result).toMatchObject({
      code: 10031,
      endpoint: 'api.live.bilibili.com/msg/send',
      httpStatus: 200,
      method: 'POST',
      platform: 'bilibili',
      transport: 'fetch',
      requestFormat: 'form-data',
      requestFields: ['msg', 'csrf'],
      queryFields: ['w_rid'],
      responseState: 'response',
    })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('hello')
    expect(globalThis.fetch).toBe(fetchMock)
  })

  it('keeps pending request evidence on timeout and ignores late responses', async () => {
    vi.useFakeTimers()
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    let resolve!: (value: Response) => void
    const original = vi.fn<typeof fetch>(() => new Promise((done) => { resolve = done }))
    vi.stubGlobal('fetch', original)
    installNativeSendObserverInPage({ nonce: 'observer-12345678', platform: 'bilibili' })
    const pending = fetch('https://api.live.bilibili.com/msg/send?csrf=private', {
      method: 'POST', body: 'msg=private-message&csrf=private-cookie',
    })
    expect(post.mock.calls[0]?.[0]).toMatchObject({ pending: true, requestOnly: true, requestFields: ['msg', 'csrf'] })
    await vi.advanceTimersByTimeAsync(8_000)
    expect(post.mock.calls[1]?.[0]).toMatchObject({ pending: false, requestOnly: true, responseState: 'timeout', elapsedMs: 8_000 })
    expect(globalThis.fetch).toBe(original)
    resolve(new Response('{"code":0}'))
    await pending
    await vi.advanceTimersByTimeAsync(0)
    expect(post).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(post.mock.calls)).not.toContain('private')
  })

  it('restores hooks on pagehide without publishing unrelated traffic', async () => {
    const original = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', original)
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    installNativeSendObserverInPage({ nonce: 'observer-12345678', platform: 'douyin' })
    await fetch('https://live.douyin.com/unrelated', { method: 'POST', body: 'secret' })
    window.dispatchEvent(new Event('pagehide'))
    expect(globalThis.fetch).toBe(original)
    expect(post).not.toHaveBeenCalled()
  })
})

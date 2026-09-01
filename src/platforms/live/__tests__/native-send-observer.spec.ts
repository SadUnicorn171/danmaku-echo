import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  INSTALL_NATIVE_SEND_OBSERVER,
  NATIVE_SEND_RESULT_SOURCE,
  installNativeSendObserverInPage,
  isInstallNativeSendObserverRequest,
} from '../native-send-observer'

afterEach(() => {
  vi.unstubAllGlobals()
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
      window.addEventListener('message', (event) => {
        if (event.data?.source === NATIVE_SEND_RESULT_SOURCE) resolve(event.data)
      }, { once: true })
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
    })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(globalThis.fetch).toBe(fetchMock)
  })
})

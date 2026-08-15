import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BILIBILI_INSTALL_NATIVE_SEND_OBSERVER,
  BILIBILI_NATIVE_SEND_RESULT_SOURCE,
  installBilibiliNativeSendObserverInPage,
  isBilibiliInstallNativeSendObserverRequest,
} from '../native-send-observer'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Bilibili native send observation', () => {
  it('validates only bounded one-shot observer requests', () => {
    expect(isBilibiliInstallNativeSendObserverRequest({
      nonce: 'observer-12345678',
      type: BILIBILI_INSTALL_NATIVE_SEND_OBSERVER,
    })).toBe(true)
    expect(isBilibiliInstallNativeSendObserverRequest({
      nonce: 'short',
      type: BILIBILI_INSTALL_NATIVE_SEND_OBSERVER,
    })).toBe(false)
  })

  it('publishes the room identity and response without authentication fields', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: {} }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const received = new Promise<unknown>((resolve) => {
      window.addEventListener('message', (event) => {
        if (event.data?.source === BILIBILI_NATIVE_SEND_RESULT_SOURCE) resolve(event.data)
      }, { once: true })
    })
    expect(installBilibiliNativeSendObserverInPage({ nonce: 'observer-12345678' })).toEqual({
      ok: true,
    })
    const form = new FormData()
    form.set('msg', 'room_3990387_104800')
    form.set('dm_type', '1')
    form.set('emoticonOptions', '[object Object]')
    form.set('csrf', 'secret-csrf')
    form.set('csrf_token', 'secret-csrf')

    await fetch('https://api.live.bilibili.com/msg/send', { body: form, method: 'POST' })
    const result = await received

    expect(result).toMatchObject({
      code: 0,
      dmType: '1',
      hasEmoticonOptions: true,
      httpStatus: 200,
      identity: 'room_3990387_104800',
      nonce: 'observer-12345678',
      source: BILIBILI_NATIVE_SEND_RESULT_SOURCE,
      transport: 'fetch',
      type: 'native-send-result',
    })
    expect(JSON.stringify(result)).not.toContain('secret-csrf')
    expect(globalThis.fetch).toBe(fetchMock)
  })
})

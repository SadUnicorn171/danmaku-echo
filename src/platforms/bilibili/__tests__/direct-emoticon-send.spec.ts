import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE,
  bilibiliRoomEmoticonIdentity,
  isBilibiliDirectEmoticonSendRequest,
  sendBilibiliRoomEmoticonInPage,
} from '../direct-emoticon-send'

const IMAGE_KEY = '7cd084941338484aae1ad9425b84077c'
const SUB_KEY = '4932caff0ff746eab6f01bf08b70ac45'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Bilibili direct room-emoticon fallback', () => {
  it('accepts either a strict room identity or a bounded bracket token', () => {
    expect(isBilibiliDirectEmoticonSendRequest({
      identity: 'room_3990387_104794',
      type: BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE,
    })).toBe(true)
    expect(isBilibiliDirectEmoticonSendRequest({
      identity: 'room_3990387_0',
      type: BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE,
    })).toBe(false)
    expect(isBilibiliDirectEmoticonSendRequest({
      sourceHints: ['https://i0.hdslb.com/bfs/live/hug.webp'],
      token: '[抱小皮]',
      type: BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE,
    })).toBe(true)
  })

  it('extracts only the exact native room resource identity', () => {
    expect(bilibiliRoomEmoticonIdentity({
      keys: ['digest:image', 'native-panel:room_3990387_104794'],
    })).toBe('room_3990387_104794')
    expect(bilibiliRoomEmoticonIdentity({
      keys: ['native-panel:resolved:[点赞]', 'bili-auto-text:104794'],
    })).toBe('')
  })

  it('sends the captured dm_type=1 form only after resolving the current real room', async () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      value: 'bili_jct=test-csrf-token',
    })
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { room_id: 3990387 } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          wbi_img: {
            img_url: `https://i0.hdslb.com/bfs/wbi/${IMAGE_KEY}.png`,
            sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB_KEY}.png`,
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendBilibiliRoomEmoticonInPage({
      href: 'https://live.bilibili.com/1746',
      identity: 'room_3990387_104794',
      timestamp: 1_786_614_744,
    })).resolves.toEqual({ code: 0, identity: 'room_3990387_104794', ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [url, init] = fetchMock.mock.calls[2]
    const sendUrl = new URL(String(url))
    expect(sendUrl.origin + sendUrl.pathname).toBe('https://api.live.bilibili.com/msg/send')
    expect(sendUrl.searchParams.get('web_location')).toBe('444.8')
    // Captured official request for the same keys, timestamp and query.
    expect(sendUrl.searchParams.get('w_rid')).toBe('b2dc81448dc4a7178778001dd993fe61')
    expect(sendUrl.searchParams.get('wts')).toBe('1786614744')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    const form = init?.body as FormData
    expect(form.get('msg')).toBe('room_3990387_104794')
    expect(form.get('dm_type')).toBe('1')
    expect(form.get('roomid')).toBe('3990387')
    expect(form.get('csrf')).toBe('test-csrf-token')
    expect(form.get('csrf_token')).toBe('test-csrf-token')
  })

  it('resolves a name-only room Emoji from the current official room list', async () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      value: 'bili_jct=test-csrf-token',
    })
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { room_id: 3990387 } }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          packages: [{
            emoticons: [{
              emoticon_unique: 'room_3990387_104800',
              emoji: '[抱小皮]',
              url: 'https://i0.hdslb.com/bfs/live/hug.webp',
            }],
          }],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          wbi_img: {
            img_url: `https://i0.hdslb.com/bfs/wbi/${IMAGE_KEY}.png`,
            sub_url: `https://i0.hdslb.com/bfs/wbi/${SUB_KEY}.png`,
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendBilibiliRoomEmoticonInPage({
      href: 'https://live.bilibili.com/1746',
      sourceHints: ['https://i0.hdslb.com/bfs/live/hug.webp?from=danmaku'],
      timestamp: 1_786_614_744,
      token: '[抱小皮]',
    })).resolves.toEqual({ code: 0, identity: 'room_3990387_104800', ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(String(fetchMock.mock.calls[1][0])).toContain('/emoticon/GetEmoticons')
    const form = fetchMock.mock.calls[3][1]?.body as FormData
    expect(form.get('msg')).toBe('room_3990387_104800')
    expect(form.get('dm_type')).toBe('1')
    expect(form.get('emoticonOptions')).toBe('[object Object]')
  })

  it('rejects a valid room identity that belongs to another live room', async () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      value: 'bili_jct=test-csrf-token',
    })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({ code: 0, data: { room_id: 111111 } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendBilibiliRoomEmoticonInPage({
      href: 'https://live.bilibili.com/1746',
      identity: 'room_3990387_104794',
    })).resolves.toEqual({
      error: 'room-mismatch',
      ok: false,
      stage: 'validate-room-identity',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('identifies the first-use authentication stage without exposing the CSRF value', async () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      value: '',
    })

    await expect(sendBilibiliRoomEmoticonInPage({
      href: 'https://live.bilibili.com/1746',
      identity: 'room_3990387_104794',
    })).resolves.toEqual({
      error: 'csrf-unavailable',
      ok: false,
      stage: 'read-csrf',
    })
  })
})

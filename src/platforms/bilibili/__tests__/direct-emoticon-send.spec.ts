import { runInNewContext } from 'node:vm'
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
    })).resolves.toEqual({
      code: 0,
      endpoint: 'api.live.bilibili.com/msg/send',
      httpStatus: 200,
      identity: 'room_3990387_104794',
      method: 'POST',
      ok: true,
      transport: 'fetch',
    })

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
    })).resolves.toEqual({
      code: 0,
      endpoint: 'api.live.bilibili.com/msg/send',
      httpStatus: 200,
      identity: 'room_3990387_104800',
      method: 'POST',
      ok: true,
      transport: 'fetch',
    })

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
    })).resolves.toMatchObject({
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
    })).resolves.toMatchObject({
      error: 'csrf-unavailable',
      ok: false,
      stage: 'read-csrf',
    })
  })
})

describe('Bilibili precise failure diagnostics', () => {
  function setup() {
    Object.defineProperty(document, 'cookie', { configurable: true, value: 'bili_jct=private-csrf-value' })
    const options = { href: 'https://live.bilibili.com/1746', token: '[抱小皮]', attemptId: 'attempt:precise' }
    const responses = [
      { code: 0, data: { room_id: 3990387 } },
      { code: 0, data: { packages: [{ emoticons: [{ emoticon_unique: 'room_3990387_104800', emoji: '[抱小皮]' }] }] } },
      { code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/' + IMAGE_KEY + '.png', sub_url: 'https://i0.hdslb.com/' + SUB_KEY + '.png' } } },
      { code: 0, data: {} },
    ]
    return { options, responses }
  }
  const stages = ['resolve-room', 'resolve-identity', 'load-wbi', 'send']

  it.each([0, 1, 2, 3])('identifies a rejected request at step %i without claiming an HTTP response', async (index) => {
    const { options, responses } = setup()
    let count = 0
    const fetchMock = vi.fn<typeof fetch>(async () => {
      if (count++ === index) throw new TypeError('Failed to fetch https://api.bilibili.com/private?token=hidden csrf=private-csrf-value')
      return jsonResponse(responses[count - 1])
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await sendBilibiliRoomEmoticonInPage(options)
    expect(result).toMatchObject({ ok: false, error: 'network', stage: stages[index] + '-request',
      diagnostics: { attemptId: options.attemptId, failureKind: 'transport', errorName: 'TypeError',
        sendRequestStarted: index === 3, sendResponseReceived: false } })
    const trace = result.diagnostics!.requests
    expect(trace).toHaveLength(index + 1)
    expect(trace[index]).toMatchObject({ stage: stages[index], state: 'transport-error', method: index === 3 ? 'POST' : 'GET' })
    expect(trace[index]!.httpStatus).toBeUndefined()
    expect(trace[index]!.endpoint).not.toContain('?')
    expect(result.diagnostics!.errorMessage).toContain('Failed to fetch')
    for (const secret of ['private-csrf-value', 'hidden', 'private?token', '抱小皮']) {
      expect(JSON.stringify(result.diagnostics)).not.toContain(secret)
    }
    expect(fetchMock).toHaveBeenCalledTimes(index + 1)
  })

  it.each([0, 1, 2, 3])('records the HTTP status and exact endpoint at step %i', async (index) => {
    const { options, responses } = setup()
    let count = 0
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => count++ === index
      ? jsonResponse({}, 429) : jsonResponse(responses[count - 1])))
    const result = await sendBilibiliRoomEmoticonInPage(options)
    expect(result.diagnostics).toMatchObject({ failureKind: 'http', failedStage: stages[index] + '-http',
      sendRequestStarted: index === 3, sendResponseReceived: index === 3 })
    expect(result.diagnostics!.requests.at(-1)).toMatchObject({ httpStatus: 429, state: 'http-error', contentType: 'application/json' })
  })

  it.each([0, 1, 2, 3])('records a business rejection separately from transport at step %i', async (index) => {
    const { options, responses } = setup()
    let count = 0
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => count++ === index
      ? jsonResponse({ code: -101, message: 'Login required token=hidden' }) : jsonResponse(responses[count - 1])))
    const result = await sendBilibiliRoomEmoticonInPage(options)
    expect(result.diagnostics).toMatchObject({ failureKind: 'api', failedStage: stages[index] + '-api' })
    expect(result.diagnostics!.requests.at(-1)).toMatchObject({ httpStatus: 200, apiCode: -101, apiMessage: 'Login required token=[redacted]' })
  })

  it.each([0, 1, 2, 3])('retains parse failures without exporting response bodies at step %i', async (index) => {
    const { options, responses } = setup()
    let count = 0
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => count++ === index
      ? new Response('<html>private-response-content</html>', { headers: { 'content-type': 'text/html' } })
      : jsonResponse(responses[count - 1])))
    const result = await sendBilibiliRoomEmoticonInPage(options)
    expect(result).toMatchObject({ error: 'invalid-json', stage: stages[index] + '-parse',
      diagnostics: { failureKind: 'parse', errorName: 'SyntaxError' } })
    expect(result.diagnostics!.requests.at(-1)).toMatchObject({ httpStatus: 200, state: 'parse-error', contentType: 'text/html' })
    expect(JSON.stringify(result.diagnostics)).not.toContain('private-response-content')
  })

  it('distinguishes local signing exceptions and does not attempt a POST', async () => {
    const { options, responses } = setup()
    let count = 0
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(responses[count++]))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('TextEncoder', class { encode() { throw new ReferenceError('signing helper failed') } })
    const result = await sendBilibiliRoomEmoticonInPage(options)
    expect(result).toMatchObject({ error: 'runtime-exception', stage: 'prepare-send-prepare',
      diagnostics: { failureKind: 'runtime', errorName: 'ReferenceError', sendRequestStarted: false } })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

it('resolves name-only emoji when serialized without its module scope', async () => {
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ code: 0, data: { room_id: 3990387 } }))
    .mockResolvedValueOnce(jsonResponse({ code: 0, data: {
      packages: [{ emoticons: [{ emoticon_unique: 'room_3990387_104800', emoji: '[测试]' }] }]
    } }))
    .mockResolvedValueOnce(jsonResponse({ code: 0, data: { wbi_img: {
      img_url: 'https://i0.hdslb.com/' + IMAGE_KEY + '.png',
      sub_url: 'https://i0.hdslb.com/' + SUB_KEY + '.png'
    } } }))
    .mockResolvedValueOnce(jsonResponse({ code: 0 }))
  const injected = runInNewContext('(' + sendBilibiliRoomEmoticonInPage.toString() + ')', {
    fetch: fetchMock, URL, FormData, TextEncoder, Error,
    document: { cookie: 'bili_jct=fixture-csrf' },
    location: { href: 'https://live.bilibili.com/1746', hostname: 'live.bilibili.com' },
    navigator: { onLine: true },
  }) as typeof sendBilibiliRoomEmoticonInPage
  const result = await injected({ href: 'https://live.bilibili.com/1746', token: '[测试]' })
  expect(result).toMatchObject({ ok: true, identity: 'room_3990387_104800' })
  expect(fetchMock).toHaveBeenCalledTimes(4)
})

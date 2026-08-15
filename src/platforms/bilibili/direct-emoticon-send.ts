export const BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE =
  'danmaku-echo.bilibili.direct-emoticon-send' as const

const ROOM_EMOTICON_PATTERN = /^room_([1-9]\d{0,19})_([1-9]\d{0,19})$/

export interface BilibiliDirectEmoticonSendRequest {
  identity?: string
  sourceHints?: string[]
  token?: string
  type: typeof BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE
}

export interface BilibiliDirectEmoticonSendResponse {
  code?: number
  error?: string
  message?: string
  ok: boolean
  identity?: string
  stage?: string
}

export function isBilibiliDirectEmoticonSendRequest(
  value: unknown,
): value is BilibiliDirectEmoticonSendRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<BilibiliDirectEmoticonSendRequest>
  const identity = String(request.identity || '').toLowerCase()
  const token = String(request.token || '').trim()
  return request.type === BILIBILI_DIRECT_EMOTICON_SEND_MESSAGE
    && (ROOM_EMOTICON_PATTERN.test(identity) || /^\[[^\]\n]{1,40}\]$/.test(token))
    && (request.sourceHints === undefined
      || (Array.isArray(request.sourceHints)
        && request.sourceHints.length <= 8
        && request.sourceHints.every((hint) => typeof hint === 'string' && hint.length <= 4_096)))
}

export function bilibiliRoomEmoticonIdentity(asset: unknown): string {
  if (!asset || typeof asset !== 'object') return ''
  const keys = (asset as { keys?: unknown }).keys
  if (!Array.isArray(keys)) return ''
  for (const rawKey of keys) {
    const key = String(rawKey || '').trim().toLowerCase()
    if (!key.startsWith('native-panel:') && !key.startsWith('bili-exclusive:')) continue
    const candidate = key.slice(key.indexOf(':') + 1)
    if (ROOM_EMOTICON_PATTERN.test(candidate)) return candidate
  }
  return ''
}

/**
 * Runs once in Bilibili's MAIN world through chrome.scripting.executeScript.
 * Keep every dependency inside the function: Chrome serializes `func` without
 * its module scope. Authentication material never leaves the page context.
 */
export async function sendBilibiliRoomEmoticonInPage(options: {
  href: string
  identity?: string
  sourceHints?: string[]
  timestamp?: number
  token?: string
}): Promise<BilibiliDirectEmoticonSendResponse> {
  const EMOTICON_LIST_URL =
    'https://api.live.bilibili.com/xlive/web-ucenter/v2/emoticon/GetEmoticons'
  const LIVE_SEND_URL = 'https://api.live.bilibili.com/msg/send'
  const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav'
  const ROOM_INIT_URL = 'https://api.live.bilibili.com/room/v1/Room/room_init'
  const WEB_LOCATION = '444.8'
  const IDENTITY_PATTERN = /^room_([1-9]\d{0,19})_([1-9]\d{0,19})$/
  const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
  ]

  type ApiEnvelope = {
    code?: unknown
    data?: unknown
    message?: unknown
    msg?: unknown
  }

  const add32 = (first: number, second: number) => (first + second) | 0
  const rotateLeft = (value: number, amount: number) =>
    (value << amount) | (value >>> (32 - amount))
  const cmn = (
    operation: number,
    first: number,
    second: number,
    word: number,
    shift: number,
    constant: number,
  ) => add32(rotateLeft(add32(add32(first, operation), add32(word, constant)), shift), second)
  const ff = (
    first: number,
    second: number,
    third: number,
    fourth: number,
    word: number,
    shift: number,
    constant: number,
  ) => cmn((second & third) | (~second & fourth), first, second, word, shift, constant)
  const gg = (
    first: number,
    second: number,
    third: number,
    fourth: number,
    word: number,
    shift: number,
    constant: number,
  ) => cmn((second & fourth) | (third & ~fourth), first, second, word, shift, constant)
  const hh = (
    first: number,
    second: number,
    third: number,
    fourth: number,
    word: number,
    shift: number,
    constant: number,
  ) => cmn(second ^ third ^ fourth, first, second, word, shift, constant)
  const ii = (
    first: number,
    second: number,
    third: number,
    fourth: number,
    word: number,
    shift: number,
    constant: number,
  ) => cmn(third ^ (second | ~fourth), first, second, word, shift, constant)

  const md5Cycle = (state: number[], words: number[]) => {
    let [first, second, third, fourth] = state

    first = ff(first, second, third, fourth, words[0], 7, -680876936)
    fourth = ff(fourth, first, second, third, words[1], 12, -389564586)
    third = ff(third, fourth, first, second, words[2], 17, 606105819)
    second = ff(second, third, fourth, first, words[3], 22, -1044525330)
    first = ff(first, second, third, fourth, words[4], 7, -176418897)
    fourth = ff(fourth, first, second, third, words[5], 12, 1200080426)
    third = ff(third, fourth, first, second, words[6], 17, -1473231341)
    second = ff(second, third, fourth, first, words[7], 22, -45705983)
    first = ff(first, second, third, fourth, words[8], 7, 1770035416)
    fourth = ff(fourth, first, second, third, words[9], 12, -1958414417)
    third = ff(third, fourth, first, second, words[10], 17, -42063)
    second = ff(second, third, fourth, first, words[11], 22, -1990404162)
    first = ff(first, second, third, fourth, words[12], 7, 1804603682)
    fourth = ff(fourth, first, second, third, words[13], 12, -40341101)
    third = ff(third, fourth, first, second, words[14], 17, -1502002290)
    second = ff(second, third, fourth, first, words[15], 22, 1236535329)

    first = gg(first, second, third, fourth, words[1], 5, -165796510)
    fourth = gg(fourth, first, second, third, words[6], 9, -1069501632)
    third = gg(third, fourth, first, second, words[11], 14, 643717713)
    second = gg(second, third, fourth, first, words[0], 20, -373897302)
    first = gg(first, second, third, fourth, words[5], 5, -701558691)
    fourth = gg(fourth, first, second, third, words[10], 9, 38016083)
    third = gg(third, fourth, first, second, words[15], 14, -660478335)
    second = gg(second, third, fourth, first, words[4], 20, -405537848)
    first = gg(first, second, third, fourth, words[9], 5, 568446438)
    fourth = gg(fourth, first, second, third, words[14], 9, -1019803690)
    third = gg(third, fourth, first, second, words[3], 14, -187363961)
    second = gg(second, third, fourth, first, words[8], 20, 1163531501)
    first = gg(first, second, third, fourth, words[13], 5, -1444681467)
    fourth = gg(fourth, first, second, third, words[2], 9, -51403784)
    third = gg(third, fourth, first, second, words[7], 14, 1735328473)
    second = gg(second, third, fourth, first, words[12], 20, -1926607734)

    first = hh(first, second, third, fourth, words[5], 4, -378558)
    fourth = hh(fourth, first, second, third, words[8], 11, -2022574463)
    third = hh(third, fourth, first, second, words[11], 16, 1839030562)
    second = hh(second, third, fourth, first, words[14], 23, -35309556)
    first = hh(first, second, third, fourth, words[1], 4, -1530992060)
    fourth = hh(fourth, first, second, third, words[4], 11, 1272893353)
    third = hh(third, fourth, first, second, words[7], 16, -155497632)
    second = hh(second, third, fourth, first, words[10], 23, -1094730640)
    first = hh(first, second, third, fourth, words[13], 4, 681279174)
    fourth = hh(fourth, first, second, third, words[0], 11, -358537222)
    third = hh(third, fourth, first, second, words[3], 16, -722521979)
    second = hh(second, third, fourth, first, words[6], 23, 76029189)
    first = hh(first, second, third, fourth, words[9], 4, -640364487)
    fourth = hh(fourth, first, second, third, words[12], 11, -421815835)
    third = hh(third, fourth, first, second, words[15], 16, 530742520)
    second = hh(second, third, fourth, first, words[2], 23, -995338651)

    first = ii(first, second, third, fourth, words[0], 6, -198630844)
    fourth = ii(fourth, first, second, third, words[7], 10, 1126891415)
    third = ii(third, fourth, first, second, words[14], 15, -1416354905)
    second = ii(second, third, fourth, first, words[5], 21, -57434055)
    first = ii(first, second, third, fourth, words[12], 6, 1700485571)
    fourth = ii(fourth, first, second, third, words[3], 10, -1894986606)
    third = ii(third, fourth, first, second, words[10], 15, -1051523)
    second = ii(second, third, fourth, first, words[1], 21, -2054922799)
    first = ii(first, second, third, fourth, words[8], 6, 1873313359)
    fourth = ii(fourth, first, second, third, words[15], 10, -30611744)
    third = ii(third, fourth, first, second, words[6], 15, -1560198380)
    second = ii(second, third, fourth, first, words[13], 21, 1309151649)
    first = ii(first, second, third, fourth, words[4], 6, -145523070)
    fourth = ii(fourth, first, second, third, words[11], 10, -1120210379)
    third = ii(third, fourth, first, second, words[2], 15, 718787259)
    second = ii(second, third, fourth, first, words[9], 21, -343485551)

    state[0] = add32(first, state[0])
    state[1] = add32(second, state[1])
    state[2] = add32(third, state[2])
    state[3] = add32(fourth, state[3])
  }

  const md5 = (value: string) => {
    const bytes = new TextEncoder().encode(value)
    const totalLength = Math.ceil((bytes.length + 9) / 64) * 64
    const padded = new Uint8Array(totalLength)
    padded.set(bytes)
    padded[bytes.length] = 0x80
    const bitLength = bytes.length * 8
    const view = new DataView(padded.buffer)
    view.setUint32(totalLength - 8, bitLength >>> 0, true)
    view.setUint32(totalLength - 4, Math.floor(bitLength / 0x1_0000_0000), true)
    const state = [1732584193, -271733879, -1732584194, 271733878]
    for (let offset = 0; offset < totalLength; offset += 64) {
      const words = Array.from({ length: 16 }, (_value, index) =>
        view.getInt32(offset + index * 4, true),
      )
      md5Cycle(state, words)
    }
    return state.map((word) => {
      let result = ''
      for (let index = 0; index < 4; index += 1) {
        result += ((word >>> (index * 8)) & 0xff).toString(16).padStart(2, '0')
      }
      return result
    }).join('')
  }

  const jsonEnvelope = async (response: Response): Promise<ApiEnvelope> => {
    try {
      const value: unknown = await response.json()
      return value && typeof value === 'object' ? value as ApiEnvelope : {}
    } catch {
      return {}
    }
  }
  const codeOf = (envelope: ApiEnvelope) => {
    const code = Number(envelope.code)
    return Number.isFinite(code) ? code : undefined
  }
  const messageOf = (envelope: ApiEnvelope) =>
    String(envelope.message || envelope.msg || '').replace(/\s+/g, ' ').trim().slice(0, 180)
  const fileKey = (value: unknown) => {
    const source = String(value || '')
    return source.slice(source.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
  }

  const normalizeToken = (value: unknown) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  const sourceFragments = (value: unknown) => {
    const source = String(value || '').toLowerCase()
    const results = new Set<string>()
    if (!source) return results
    try {
      const url = new URL(source, location.href)
      const path = decodeURIComponent(url.pathname).replace(/\/fmt(?:png|webp|jpg)$/i, '')
      results.add(path)
      const file = path.slice(path.lastIndexOf('/') + 1)
      if (file) results.add(file.replace(/\.[a-z0-9]+$/i, ''))
    } catch {
      results.add(source.slice(0, 300))
    }
    return results
  }
  const resolveIdentityFromEmoticons = (value: unknown, roomId: string) => {
    const expectedToken = normalizeToken(options.token)
    const expectedSources = new Set(
      (Array.isArray(options.sourceHints) ? options.sourceHints : [])
        .flatMap((source) => Array.from(sourceFragments(source))),
    )
    const matches: Array<{ identity: string; sourceScore: number }> = []
    const seen = new Set<unknown>()
    const visit = (current: unknown, depth: number) => {
      if (!current || depth > 10 || typeof current !== 'object' || seen.has(current)) return
      seen.add(current)
      if (Array.isArray(current)) {
        current.slice(0, 500).forEach((item) => visit(item, depth + 1))
        return
      }
      const record = current as Record<string, unknown>
      const identity = [
        record.emoticon_unique,
        record.emoticonUnique,
        record.emoticon_id,
        record.unique,
      ].map((item) => String(item || '').trim().toLowerCase())
        .find((item) => ROOM_EMOTICON_PATTERN.test(item)) || ''
      if (identity && identity.startsWith(`room_${roomId}_`)) {
        const names = [
          record.emoji,
          record.descript,
          record.description,
          record.name,
          record.text,
        ].map(normalizeToken).filter(Boolean)
        if (!expectedToken || names.includes(expectedToken)) {
          const candidateSources = [
            record.url,
            record.emoticon_url,
            record.gif_url,
            record.webp_url,
          ].flatMap((source) => Array.from(sourceFragments(source)))
          const sourceScore = candidateSources.reduce(
            (score, source) => Math.max(
              score,
              ...Array.from(expectedSources).map((expected) =>
                source === expected || source.includes(expected) || expected.includes(source) ? 1 : 0,
              ),
            ),
            0,
          )
          matches.push({ identity, sourceScore })
        }
      }
      Object.values(record).slice(0, 100).forEach((item) => visit(item, depth + 1))
    }
    visit(value, 0)
    const uniqueMatches = Array.from(
      new Map(matches.map((match) => [match.identity, match])).values(),
    )
    const sourceMatches = uniqueMatches.filter((match) => match.sourceScore > 0)
    const candidates = sourceMatches.length ? sourceMatches : uniqueMatches
    return candidates.length === 1 ? candidates[0].identity : ''
  }

  let identity = String(options.identity || '').trim().toLowerCase()
  const csrfMatch = document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/)
  if (!csrfMatch) return { error: 'csrf-unavailable', ok: false, stage: 'read-csrf' }
  let csrf = csrfMatch[1]
  try {
    csrf = decodeURIComponent(csrf)
  } catch {
    // The cookie is already an unescaped token.
  }

  try {
    const pageUrl = new URL(
      location.hostname === 'live.bilibili.com' ? location.href : options.href,
    )
    if (pageUrl.hostname !== 'live.bilibili.com') {
      return { error: 'invalid-page', ok: false, stage: 'validate-page' }
    }
    const shortRoomId = pageUrl.pathname.split('/').find((part) => /^\d+$/.test(part)) || ''
    if (!shortRoomId) return { error: 'room-unavailable', ok: false, stage: 'read-room' }
    let identityMatch = identity.match(IDENTITY_PATTERN)
    let roomId = shortRoomId
    if (!identityMatch || roomId !== identityMatch[1]) {
      const roomUrl = new URL(ROOM_INIT_URL)
      roomUrl.searchParams.set('id', shortRoomId)
      const roomResponse = await fetch(roomUrl, { credentials: 'include' })
      if (!roomResponse.ok) {
        return { error: 'room-unavailable', ok: false, stage: 'resolve-room-http' }
      }
      const roomEnvelope = await jsonEnvelope(roomResponse)
      if (codeOf(roomEnvelope) !== 0 || !roomEnvelope.data || typeof roomEnvelope.data !== 'object') {
        return { error: 'room-unavailable', ok: false, stage: 'resolve-room-api' }
      }
      const resolved = Number((roomEnvelope.data as { room_id?: unknown }).room_id)
      roomId = Number.isSafeInteger(resolved) && resolved > 0 ? String(resolved) : ''
    }
    if (!roomId) return { error: 'room-unavailable', ok: false, stage: 'resolve-room-data' }
    if (!identityMatch) {
      const emoticonUrl = new URL(EMOTICON_LIST_URL)
      emoticonUrl.searchParams.set('platform', 'pc')
      emoticonUrl.searchParams.set('room_id', roomId)
      const emoticonResponse = await fetch(emoticonUrl, { credentials: 'include' })
      if (!emoticonResponse.ok) {
        return { error: 'emoticon-list-unavailable', ok: false, stage: 'resolve-identity-http' }
      }
      const emoticonEnvelope = await jsonEnvelope(emoticonResponse)
      if (codeOf(emoticonEnvelope) !== 0) {
        return {
          error: 'emoticon-list-unavailable',
          message: messageOf(emoticonEnvelope),
          ok: false,
          stage: 'resolve-identity-api',
        }
      }
      identity = resolveIdentityFromEmoticons(emoticonEnvelope.data, roomId)
      identityMatch = identity.match(IDENTITY_PATTERN)
      if (!identityMatch) {
        return { error: 'identity-unavailable', ok: false, stage: 'resolve-identity-data' }
      }
    }
    if (roomId !== identityMatch[1]) {
      return { error: 'room-mismatch', ok: false, stage: 'validate-room-identity' }
    }

    const navResponse = await fetch(NAV_URL, { credentials: 'include' })
    if (!navResponse.ok) {
      return { error: 'wbi-key-unavailable', ok: false, stage: 'load-wbi-http' }
    }
    const navEnvelope = await jsonEnvelope(navResponse)
    if (codeOf(navEnvelope) !== 0 || !navEnvelope.data || typeof navEnvelope.data !== 'object') {
      return { error: 'wbi-key-unavailable', ok: false, stage: 'load-wbi-api' }
    }
    const wbi = (navEnvelope.data as { wbi_img?: unknown }).wbi_img
    if (!wbi || typeof wbi !== 'object') {
      return { error: 'wbi-key-unavailable', ok: false, stage: 'load-wbi-data' }
    }
    const imageKey = fileKey((wbi as { img_url?: unknown }).img_url)
    const subKey = fileKey((wbi as { sub_url?: unknown }).sub_url)
    if (imageKey.length !== 32 || subKey.length !== 32) {
      return { error: 'wbi-key-unavailable', ok: false, stage: 'parse-wbi-key' }
    }
    const sourceKey = `${imageKey}${subKey}`
    const mixinKey = MIXIN_KEY_ENC_TAB.map((index) => sourceKey[index] || '').join('').slice(0, 32)
    const timestamp = Number.isSafeInteger(options.timestamp) && Number(options.timestamp) > 0
      ? Number(options.timestamp)
      : Math.floor(Date.now() / 1_000)
    const signedQuery = `web_location=${encodeURIComponent(WEB_LOCATION)}&wts=${timestamp}`
    const wRid = md5(`${signedQuery}${mixinKey}`)
    const sendUrl = new URL(LIVE_SEND_URL)
    sendUrl.searchParams.set('web_location', WEB_LOCATION)
    sendUrl.searchParams.set('w_rid', wRid)
    sendUrl.searchParams.set('wts', String(timestamp))

    const form = new FormData()
    form.set('bubble', '0')
    form.set('msg', identity)
    form.set('color', '16777215')
    form.set('mode', '1')
    form.set('dm_type', '1')
    form.set('emoticonOptions', '[object Object]')
    form.set('data_extend', JSON.stringify({ trackid: '-99998' }))
    form.set('fontsize', '25')
    form.set('rnd', String(timestamp))
    form.set('roomid', roomId)
    form.set('csrf', csrf)
    form.set('csrf_token', csrf)

    const sendResponse = await fetch(sendUrl, {
      body: form,
      credentials: 'include',
      method: 'POST',
    })
    if (!sendResponse.ok) {
      return { error: `http-${sendResponse.status}`, ok: false, stage: 'send-http' }
    }
    const sendEnvelope = await jsonEnvelope(sendResponse)
    const code = codeOf(sendEnvelope)
    const message = messageOf(sendEnvelope)
    return code === 0
      ? { code, identity, ok: true }
      : {
          code,
          error: code === undefined ? 'invalid-response' : `api-${code}`,
          identity,
          message,
          ok: false,
          stage: 'send-api',
        }
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error || '')
    return {
      error: 'network',
      message: reason.replace(/\s+/g, ' ').trim().slice(0, 180),
      ok: false,
      stage: 'network',
    }
  }
}

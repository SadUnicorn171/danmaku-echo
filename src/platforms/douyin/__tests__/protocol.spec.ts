import { describe, expect, it } from 'vitest'

import {
  DOUYIN_CONTENT_SOURCE,
  DOUYIN_PAGE_SOURCE,
  DOUYIN_PROTOCOL_VERSION,
  createDouyinContentToPageMessage,
  createDouyinPageToContentMessage,
  dispatchDouyinContentToPageMessage,
  dispatchDouyinPageToContentMessage,
  isDouyinContentToPageMessage,
  isDouyinPageToContentMessage,
  type DouyinContentToPageHandlers,
  type DouyinContentToPageMessage,
  type DouyinPageToContentHandlers,
  type DouyinPageToContentMessage,
} from '../protocol'

const contentMessages: DouyinContentToPageMessage[] = [
  { source: DOUYIN_CONTENT_SOURCE, type: 'ping', requestId: 1 },
  { source: DOUYIN_CONTENT_SOURCE, type: 'debug-request', requestId: 2 },
  {
    source: DOUYIN_CONTENT_SOURCE,
    type: 'renderer-settings',
    actions: { copy: true, favorite: true, plusOne: true, reply: true },
    capsuleScalePercent: 100,
    enabled: true,
    reason: 'test',
    repeatReminderEnabled: true,
    sentAt: 1,
    version: 'test-v1',
  },
  { source: DOUYIN_CONTENT_SOURCE, type: 'emoji-catalog', entries: [['asset.png', '[看]']] },
  {
    source: DOUYIN_CONTENT_SOURCE,
    type: 'renderer-message-resolved',
    instanceId: 'instance-1',
    messageId: 'message-1',
    text: '[看]',
    trackId: 1,
  },
  {
    source: DOUYIN_CONTENT_SOURCE,
    type: 'own-message-intent',
    assets: [{ keys: ['asset.png'], src: 'https://example.test/asset.png', token: '[看]' }],
    intentId: 'intent-1',
    plainText: '',
    signature: '::asset.png',
    sourceType: 'manual-input',
    text: '[看]',
  },
  { source: DOUYIN_CONTENT_SOURCE, type: 'own-message-cancel', intentId: 'intent-1' },
  {
    source: DOUYIN_CONTENT_SOURCE,
    type: 'renderer-result',
    instanceId: 'instance-1',
    ok: true,
    reason: 'sent',
    requestId: 3,
    trackId: '1',
  },
  {
    source: DOUYIN_CONTENT_SOURCE,
    type: 'renderer-favorite-result',
    ok: true,
    requestId: 4,
  },
  {
    source: DOUYIN_CONTENT_SOURCE,
    type: 'renderer-copy-result',
    ok: true,
    requestId: 5,
  },
]

const rendererAction = {
  content: [{ type: 'text', text: '你好' }],
  instanceId: 'instance-1',
  messageId: 'message-1',
  requestId: 5,
  text: '你好',
  trackId: 1,
}

const pageMessages: DouyinPageToContentMessage[] = [
  {
    source: DOUYIN_PAGE_SOURCE,
    type: 'ready',
    instanceCount: 1,
    orphanCount: 0,
    rendererEnabled: true,
    requestId: 1,
    version: 'page-v1',
  },
  {
    source: DOUYIN_PAGE_SOURCE,
    type: 'renderer-ready',
    enabled: true,
    instanceCount: 1,
    requestId: 2,
    takeoverCount: 1,
    version: 'page-v1',
  },
  {
    source: DOUYIN_PAGE_SOURCE,
    type: 'debug-snapshot',
    requestId: 3,
    snapshot: { instanceCount: 1 },
  },
  {
    source: DOUYIN_PAGE_SOURCE,
    type: 'repeat-reminder-message',
    message: {
      content: [{ type: 'text', text: '你好' }],
      excludedReason: '',
      instanceId: 'instance-1',
      messageId: 'message-1',
      observedAt: 1,
      sender: '观众',
      text: '你好',
      trackId: 1,
    },
  },
  { source: DOUYIN_PAGE_SOURCE, type: 'renderer-activate', ...rendererAction },
  {
    source: DOUYIN_PAGE_SOURCE,
    type: 'renderer-reply',
    ...rendererAction,
    observedAt: 1,
    sender: '观众',
  },
  { source: DOUYIN_PAGE_SOURCE, type: 'renderer-favorite', ...rendererAction },
  { source: DOUYIN_PAGE_SOURCE, type: 'renderer-copy', ...rendererAction },
  { source: DOUYIN_PAGE_SOURCE, type: 'own-message-consumed', intentId: 'intent-1' },
]

function withoutRequiredPayload(message: object): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...message }
  const requiredKey = Object.keys(copy).find((key) => key !== 'source' && key !== 'type')
  if (requiredKey) delete copy[requiredKey]
  return copy
}

describe('Douyin cross-world protocol', () => {
  it.each(contentMessages.map((message) => [message.type, message] as const))(
    'accepts content-to-page %s and rejects its incomplete payload',
    (_type, message) => {
      expect(isDouyinContentToPageMessage(message)).toBe(true)
      expect(isDouyinContentToPageMessage(withoutRequiredPayload(message))).toBe(false)
    },
  )

  it.each(pageMessages.map((message) => [message.type, message] as const))(
    'accepts page-to-content %s and rejects its incomplete payload',
    (_type, message) => {
      expect(isDouyinPageToContentMessage(message)).toBe(true)
      expect(isDouyinPageToContentMessage(withoutRequiredPayload(message))).toBe(false)
    },
  )

  it('rejects forged sources, unknown types, unsupported versions, and invalid request IDs', () => {
    expect(
      isDouyinContentToPageMessage({ ...contentMessages[0], source: DOUYIN_PAGE_SOURCE }),
    ).toBe(false)
    expect(
      isDouyinPageToContentMessage({ ...pageMessages[0], source: DOUYIN_CONTENT_SOURCE }),
    ).toBe(false)
    expect(isDouyinContentToPageMessage({ source: DOUYIN_CONTENT_SOURCE, type: 'unknown' })).toBe(
      false,
    )
    expect(isDouyinPageToContentMessage({ source: DOUYIN_PAGE_SOURCE, type: 'unknown' })).toBe(
      false,
    )
    expect(isDouyinContentToPageMessage({ ...contentMessages[0], protocolVersion: 2 })).toBe(false)
    expect(isDouyinContentToPageMessage({ ...contentMessages[0], requestId: -1 })).toBe(false)
  })

  it('rejects oversized arrays before they reach either runtime', () => {
    expect(
      isDouyinContentToPageMessage({
        source: DOUYIN_CONTENT_SOURCE,
        type: 'emoji-catalog',
        entries: Array.from({ length: 2_001 }, () => ['asset.png', '[看]']),
      }),
    ).toBe(false)
    expect(
      isDouyinPageToContentMessage({
        source: DOUYIN_PAGE_SOURCE,
        type: 'renderer-activate',
        ...rendererAction,
        content: Array.from({ length: 257 }, () => ({})),
      }),
    ).toBe(false)
  })

  it('adds the current version while retaining legacy-message compatibility', () => {
    const contentMessage = createDouyinContentToPageMessage({ type: 'ping', requestId: 9 })
    const pageMessage = createDouyinPageToContentMessage({
      type: 'own-message-consumed',
      intentId: 'intent-9',
    })

    expect(contentMessage.protocolVersion).toBe(DOUYIN_PROTOCOL_VERSION)
    expect(pageMessage.protocolVersion).toBe(DOUYIN_PROTOCOL_VERSION)
    expect(isDouyinContentToPageMessage({ ...contentMessage, protocolVersion: undefined })).toBe(
      true,
    )
    expect(isDouyinPageToContentMessage({ ...pageMessage, protocolVersion: undefined })).toBe(true)
  })

  it('dispatches through exhaustive direction-specific handler maps', () => {
    const visited: string[] = []
    const contentHandlers: DouyinContentToPageHandlers = {
      'debug-request': ({ type }) => visited.push(type),
      'emoji-catalog': ({ type }) => visited.push(type),
      'own-message-cancel': ({ type }) => visited.push(type),
      'own-message-intent': ({ type }) => visited.push(type),
      ping: ({ type }) => visited.push(type),
      'renderer-copy-result': ({ type }) => visited.push(type),
      'renderer-favorite-result': ({ type }) => visited.push(type),
      'renderer-message-resolved': ({ type }) => visited.push(type),
      'renderer-result': ({ type }) => visited.push(type),
      'renderer-settings': ({ type }) => visited.push(type),
    }
    const pageHandlers: DouyinPageToContentHandlers = {
      'debug-snapshot': ({ type }) => visited.push(type),
      'own-message-consumed': ({ type }) => visited.push(type),
      ready: ({ type }) => visited.push(type),
      'renderer-activate': ({ type }) => visited.push(type),
      'renderer-copy': ({ type }) => visited.push(type),
      'renderer-favorite': ({ type }) => visited.push(type),
      'renderer-ready': ({ type }) => visited.push(type),
      'renderer-reply': ({ type }) => visited.push(type),
      'repeat-reminder-message': ({ type }) => visited.push(type),
    }

    contentMessages.forEach((message) =>
      dispatchDouyinContentToPageMessage(message, contentHandlers),
    )
    pageMessages.forEach((message) => dispatchDouyinPageToContentMessage(message, pageHandlers))

    expect(visited).toHaveLength(contentMessages.length + pageMessages.length)
  })
})

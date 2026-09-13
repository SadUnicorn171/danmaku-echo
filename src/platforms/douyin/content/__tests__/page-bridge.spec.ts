import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DOUYIN_PAGE_SOURCE,
  createDouyinPageToContentMessage,
  type DouyinContentToPageMessage,
  type DouyinPageToContentHandlers,
  type DouyinPageToContentMessage,
} from '../../protocol'
import { createDouyinPageBridge } from '../page-bridge'

type PingMessage = Extract<DouyinContentToPageMessage, { type: 'ping' }>

function createHandlers(visited: string[]): DouyinPageToContentHandlers {
  return {
    'debug-snapshot': () => visited.push('debug-snapshot'),
    'own-message-consumed': () => visited.push('own-message-consumed'),
    ready: () => visited.push('ready'),
    'renderer-activate': () => visited.push('renderer-activate'),
    'renderer-copy': () => visited.push('renderer-copy'),
    'renderer-favorite': () => visited.push('renderer-favorite'),
    'renderer-ready': () => visited.push('renderer-ready'),
    'renderer-reply': () => visited.push('renderer-reply'),
    'repeat-reminder-message': () => visited.push('repeat-reminder-message'),
  }
}

function dispatchPageMessage(message: DouyinPageToContentMessage): void {
  window.dispatchEvent(new MessageEvent('message', { data: message, source: window }))
}

function readyMessage(requestId: number, version = 'fixture-page-hook'): DouyinPageToContentMessage {
  return createDouyinPageToContentMessage({
    type: 'ready',
    instanceCount: 1,
    orphanCount: 0,
    rendererEnabled: true,
    requestId,
    version,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Douyin page bridge', () => {
  it('matches a ready response once and ignores duplicate or wrong-source messages', async () => {
    const visited: string[] = []
    let invalidMessages = 0
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const bridge = createDouyinPageBridge({
      handlers: createHandlers(visited),
      onInvalidPageMessage: () => {
        invalidMessages += 1
      },
    })
    bridge.start()

    const request = bridge.ping(1_000)
    const outgoing = postMessage.mock.calls[0]?.[0] as DouyinContentToPageMessage
    expect(outgoing).toMatchObject({ type: 'ping', requestId: request.requestId })

    const ready = readyMessage(request.requestId)
    window.dispatchEvent(new MessageEvent('message', { data: ready, source: null }))
    expect(visited).toEqual([])
    dispatchPageMessage(ready)
    dispatchPageMessage(ready)

    await expect(request.response).resolves.toEqual(ready)
    expect(visited).toEqual(['ready'])
    expect(bridge.pendingRequestCount()).toBe(0)

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          protocolVersion: 1,
          requestId: 'invalid',
          source: DOUYIN_PAGE_SOURCE,
          type: 'ready',
        },
        source: window,
      }),
    )
    expect(invalidMessages).toBe(1)
    bridge.destroy()
  })

  it('settles timed-out requests and all pending work during destroy', async () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const bridge = createDouyinPageBridge({ handlers: createHandlers([]) })
    bridge.start()

    const timedOut = bridge.requestDebugSnapshot(100)
    await vi.advanceTimersByTimeAsync(100)
    await expect(timedOut.response).resolves.toBeNull()

    const destroyed = bridge.ping(5_000)
    expect(bridge.pendingRequestCount()).toBe(1)
    bridge.destroy()
    await expect(destroyed.response).resolves.toBeNull()
    expect(bridge.pendingRequestCount()).toBe(0)
  })

  it('stops recovery probes after ready and can recover after a page-hook reload', () => {
    const visited: string[] = []
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const bridge = createDouyinPageBridge({ handlers: createHandlers(visited) })
    bridge.start()

    bridge.beginRecovery([0, 100, 200])
    const firstPing = postMessage.mock.calls[0]?.[0] as PingMessage
    dispatchPageMessage(readyMessage(firstPing.requestId, 'first-hook'))
    vi.advanceTimersByTime(500)
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(bridge.isReady()).toBe(true)

    bridge.markUnavailable()
    bridge.beginRecovery([0])
    const secondPing = postMessage.mock.calls[1]?.[0] as PingMessage
    expect(secondPing.requestId).not.toBe(firstPing.requestId)
    dispatchPageMessage(readyMessage(secondPing.requestId, 'reloaded-hook'))
    expect(visited).toEqual(['ready', 'ready'])
    expect(bridge.isReady()).toBe(true)
    bridge.destroy()
  })

  it('routes raw native-send observations through its only window listener', async () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const bridge = createDouyinPageBridge({ handlers: createHandlers([]) })
    bridge.start()
    const observation = bridge.observeWindowMessage(
      (event) => (event.data?.nonce === 'fixture-nonce' ? event.data : null),
      500,
    )
    const result = { nonce: 'fixture-nonce', ok: true }

    window.dispatchEvent(new MessageEvent('message', { data: result, source: window }))
    await expect(observation.result).resolves.toEqual(result)
    bridge.destroy()
  })

  it('keeps direct window message registration out of the content entry', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src', 'platforms', 'douyin', 'content', 'content-app.ts'),
      'utf8',
    )

    expect(source).not.toMatch(/window\.(?:add|remove)EventListener\(['"]message['"]/u)
    expect(source).not.toContain('window.postMessage(')
    expect(source).toContain('createDouyinPageBridge')
  })
})

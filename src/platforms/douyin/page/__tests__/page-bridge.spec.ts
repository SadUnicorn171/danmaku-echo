import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DOUYIN_CONTENT_SOURCE,
  createDouyinContentToPageMessage,
  isDouyinPageToContentMessage,
} from '../../protocol'
import { createDouyinPageBridge } from '../page-bridge'
import type { DouyinContentToPageMessage } from '../../protocol'
import type { DouyinPageBridge } from '../page-bridge'

function dispatchFrom(source: MessageEventSource | null, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data, source }))
}

function createHarness(): {
  bridge: DouyinPageBridge
  calls: Record<string, number>
  rejected: { count: number }
} {
  const calls: Record<string, number> = {}
  const rejected = { count: 0 }
  const count = (type: string): void => {
    calls[type] = (calls[type] ?? 0) + 1
  }
  const bridge = createDouyinPageBridge({
    handlers: {
      'debug-request': () => count('debug-request'),
      'emoji-catalog': () => count('emoji-catalog'),
      'own-message-cancel': () => count('own-message-cancel'),
      'own-message-intent': () => count('own-message-intent'),
      ping: () => count('ping'),
      'renderer-message-resolved': () => count('renderer-message-resolved'),
      'renderer-settings': () => count('renderer-settings'),
    },
    onProtocolRejected: () => {
      rejected.count += 1
    },
  })
  return { bridge, calls, rejected }
}

let activeBridge: DouyinPageBridge | null = null

afterEach(() => {
  activeBridge?.destroy()
  activeBridge = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('DouyinPageBridge', () => {
  it('accepts only valid same-window content messages and releases its listener', () => {
    const harness = createHarness()
    activeBridge = harness.bridge
    harness.bridge.start()
    harness.bridge.start()

    const ping = createDouyinContentToPageMessage<
      Extract<DouyinContentToPageMessage, { type: 'ping' }>
    >({ type: 'ping', requestId: 7 })
    dispatchFrom(null, ping)
    dispatchFrom(window, {
      protocolVersion: 1,
      requestId: -1,
      source: DOUYIN_CONTENT_SOURCE,
      type: 'ping',
    })
    dispatchFrom(window, { source: 'unrelated-page', type: 'ping' })
    dispatchFrom(window, ping)

    expect(harness.calls.ping).toBe(1)
    expect(harness.rejected.count).toBe(1)

    harness.bridge.destroy()
    dispatchFrom(window, ping)
    expect(harness.calls.ping).toBe(1)
  })

  it('adds the page protocol envelope to every outgoing event', () => {
    const posted: unknown[] = []
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
      posted.push(message)
    })
    const harness = createHarness()
    activeBridge = harness.bridge

    harness.bridge.send({
      instanceCount: 2,
      orphanCount: 1,
      rendererEnabled: true,
      requestId: 4,
      type: 'ready',
      version: 'test',
    })

    expect(posted).toHaveLength(1)
    expect(isDouyinPageToContentMessage(posted[0])).toBe(true)
    expect(posted[0]).toMatchObject({ requestId: 4, type: 'ready' })
  })

  it('correlates equal numeric ids by response type and ignores duplicate responses', () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const harness = createHarness()
    activeBridge = harness.bridge
    harness.bridge.start()
    const results: string[] = []

    harness.bridge.request(
      {
        content: [],
        instanceId: 'instance-1',
        messageId: 'message-1',
        requestId: 3,
        text: '测试',
        trackId: 1,
        type: 'renderer-activate',
      },
      {
        onResponse: () => results.push('activate'),
        onTimeout: () => results.push('activate-timeout'),
        timeoutMs: 100,
      },
    )
    harness.bridge.request(
      {
        content: [],
        instanceId: 'instance-1',
        messageId: 'message-1',
        requestId: 3,
        text: '测试',
        trackId: 1,
        type: 'renderer-favorite',
      },
      {
        onResponse: () => results.push('favorite'),
        onTimeout: () => results.push('favorite-timeout'),
        timeoutMs: 100,
      },
    )

    const favoriteResult = createDouyinContentToPageMessage<
      Extract<DouyinContentToPageMessage, { type: 'renderer-favorite-result' }>
    >({ ok: true, requestId: 3, type: 'renderer-favorite-result' })
    dispatchFrom(window, favoriteResult)
    dispatchFrom(window, favoriteResult)
    expect(results).toEqual(['favorite'])

    const activationResult = createDouyinContentToPageMessage<
      Extract<DouyinContentToPageMessage, { type: 'renderer-result' }>
    >({
      instanceId: 'instance-1',
      ok: true,
      reason: 'sent',
      requestId: 3,
      trackId: '1',
      type: 'renderer-result',
    })
    dispatchFrom(window, activationResult)
    vi.advanceTimersByTime(100)
    expect(results).toEqual(['favorite', 'activate'])
  })

  it('settles an unanswered request once and ignores its late response', () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const harness = createHarness()
    activeBridge = harness.bridge
    harness.bridge.start()
    const results: string[] = []

    harness.bridge.request(
      {
        content: [],
        instanceId: 'instance-1',
        messageId: 'message-2',
        requestId: 8,
        text: '复制',
        trackId: 2,
        type: 'renderer-copy',
      },
      {
        onResponse: () => results.push('response'),
        onTimeout: () => results.push('timeout'),
        timeoutMs: 80,
      },
    )
    vi.advanceTimersByTime(80)

    const lateResult = createDouyinContentToPageMessage<
      Extract<DouyinContentToPageMessage, { type: 'renderer-copy-result' }>
    >({ ok: true, requestId: 8, type: 'renderer-copy-result' })
    dispatchFrom(window, lateResult)
    expect(results).toEqual(['timeout'])
  })

  it('keeps direct cross-world transport out of the page entry', () => {
    const entrySource = readFileSync(
      resolve(process.cwd(), 'src/entries/douyin-page-hook.ts'),
      'utf8',
    )
    const runtimeSource = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/page-runtime.ts'),
      'utf8',
    )
    const appSource = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/page-app.ts'),
      'utf8',
    )
    expect(entrySource).not.toContain('window.postMessage')
    expect(entrySource).not.toMatch(/window\.addEventListener\(["']message["']/u)
    expect(entrySource).toContain('createDouyinPageAppRuntime')
    expect(appSource).toContain('createDouyinPageBridge')
    expect(appSource).toContain('createDouyinPageRuntime')
    expect(runtimeSource).toContain('options.bridge.start()')
  })
})

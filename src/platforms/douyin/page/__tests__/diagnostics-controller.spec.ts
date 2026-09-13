import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDouyinPageDiagnostics } from '../diagnostics-controller'
import type { DouyinPageDebugState } from '../runtime-types'

const markerId = 'bcp-douyin-page-debug'

function exposedDebugState(): DouyinPageDebugState | undefined {
  return Reflect.get(globalThis, '__danmakuEchoDouyinDebug') as DouyinPageDebugState | undefined
}

beforeEach(() => {
  vi.useFakeTimers()
  document.documentElement.replaceChildren(
    document.createElement('head'),
    document.createElement('body'),
  )
  Reflect.deleteProperty(globalThis, '__danmakuEchoDouyinDebug')
})

afterEach(() => {
  vi.useRealTimers()
  document.getElementById(markerId)?.remove()
  Reflect.deleteProperty(globalThis, '__danmakuEchoDouyinDebug')
  vi.restoreAllMocks()
})

describe('Douyin page diagnostics controller', () => {
  it('owns counters, bounded events, snapshots, and the exposed debug state', () => {
    let currentTime = 10_000
    const diagnostics = createDouyinPageDiagnostics({
      collectSnapshot: () => ({ instanceCount: 2, orphanCount: 1 }),
      debugSampleInterval: 0,
      document,
      eventLimit: 3,
      href: () => 'https://live.douyin.com/123',
      now: () => currentTime,
      snapshotEventLimit: 2,
      version: 'test-version',
    })

    diagnostics.increment('barragesObserved')
    diagnostics.increment('barragesObserved', 2)
    for (let index = 0; index < 4; index += 1) {
      currentTime += 1
      diagnostics.record(`event-${index}`, { index })
    }

    const snapshot = diagnostics.snapshot()
    expect(snapshot.counters.barragesObserved).toBe(3)
    expect(snapshot.events.map(({ type }) => type)).toEqual(['event-2', 'event-3'])
    expect(snapshot).toMatchObject({
      href: 'https://live.douyin.com/123',
      instanceCount: 2,
      orphanCount: 1,
      version: 'test-version',
    })
    expect(exposedDebugState()?.events).toHaveLength(3)

    diagnostics.destroy()
  })

  it('caps full DOM marker snapshots during high-frequency records', () => {
    let currentTime = 20_000
    const collectSnapshot = vi.fn<() => Record<string, unknown>>(() => ({
      instanceCount: 1,
      orphanCount: 0,
    }))
    const diagnostics = createDouyinPageDiagnostics({
      collectSnapshot,
      debugSampleInterval: 250,
      document,
      href: () => 'https://live.douyin.com/456',
      markerInterval: 1_000,
      now: () => currentTime,
      version: 'rate-limited',
    })

    vi.runOnlyPendingTimers()
    expect(collectSnapshot).toHaveBeenCalledTimes(1)
    for (let index = 0; index < 100; index += 1) {
      diagnostics.increment('barragesStarted')
      diagnostics.record('barrage-started', {
        payload: { index, values: Array.from({ length: 50 }, () => index) },
      })
    }
    expect(exposedDebugState()?.events).toHaveLength(1)

    currentTime = 20_999
    vi.advanceTimersByTime(999)
    expect(collectSnapshot).toHaveBeenCalledTimes(1)
    currentTime = 21_000
    vi.advanceTimersByTime(1)
    expect(collectSnapshot).toHaveBeenCalledTimes(2)
    expect(document.getElementById(markerId)?.textContent).toContain('"barragesStarted":100')

    diagnostics.destroy()
  })

  it('can be disabled without recording events or creating a marker', () => {
    const diagnostics = createDouyinPageDiagnostics({
      document,
      enabled: () => false,
      href: () => 'https://live.douyin.com/disabled',
      version: 'disabled',
    })

    diagnostics.increment('workerMessages')
    expect(diagnostics.record('ignored', { value: 1 })).toBe(false)
    vi.runAllTimers()

    expect(diagnostics.snapshot().counters.workerMessages).toBe(0)
    expect(diagnostics.snapshot().events).toEqual([])
    expect(document.getElementById(markerId)).toBeNull()

    diagnostics.destroy()
  })

  it('stores only bounded redacted error details', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const diagnostics = createDouyinPageDiagnostics({
      consoleLevel: 'error',
      debugSampleInterval: 0,
      document,
      href: () => 'https://live.douyin.com/error',
      version: 'redaction',
    })

    diagnostics.record(
      'request-failed',
      {
        authorization: 'Bearer private-auth',
        cookie: 'SESSDATA=private-cookie',
        message: 'request failed token=private-token',
        url: 'https://example.com/send?w_rid=private-signature&safe=1',
      },
      'error',
    )

    const serialized = JSON.stringify(diagnostics.snapshot())
    expect(serialized).not.toContain('private-auth')
    expect(serialized).not.toContain('private-cookie')
    expect(serialized).not.toContain('private-token')
    expect(serialized).not.toContain('private-signature')
    expect(diagnostics.snapshot().lastError).toContain('token=[redacted]')
    expect(errorSpy).toHaveBeenCalledTimes(1)

    diagnostics.destroy()
  })

  it('clears pending marker work, DOM state, and its global reference on destroy', () => {
    const diagnostics = createDouyinPageDiagnostics({
      document,
      href: () => 'https://live.douyin.com/destroy',
      version: 'destroy',
    })
    vi.runOnlyPendingTimers()
    expect(document.getElementById(markerId)).not.toBeNull()

    diagnostics.record('pending')
    diagnostics.destroy()
    vi.runAllTimers()

    expect(document.getElementById(markerId)).toBeNull()
    expect(exposedDebugState()).toBeUndefined()
    expect(diagnostics.record('late')).toBe(false)
  })

  it('keeps debug state, marker serialization, and event buffering out of the page entry', () => {
    const appSource = readFileSync(
      resolve(process.cwd(), 'src/platforms/douyin/page/page-app.ts'),
      'utf8',
    )

    expect(appSource).toContain('createDouyinPageDiagnostics')
    expect(appSource).toContain('diagnostics.increment(')
    expect(appSource).toContain('diagnostics.record(')
    expect(appSource).not.toContain('const debugState')
    expect(appSource).not.toContain('function debugEvent')
    expect(appSource).not.toContain('function debugSnapshot')
    expect(appSource).not.toContain('JSON.stringify(snapshot)')
    expect(appSource).not.toContain('bcp-douyin-page-debug')
  })
})

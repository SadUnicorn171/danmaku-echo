import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LOG_LIMIT,
  LOG_MAX_AGE,
  LOG_MAX_BYTES,
  LOG_STORAGE_KEY,
  type RuntimeLog,
  normalizeRuntimeLog,
  sanitizeLogValue,
} from '../runtime-log'
import { createRuntimeLogStore, startRuntimeLogService } from '../runtime-log-store'
import { installRuntimeLogger, setRuntimeLogContext } from '../runtime-logger'
import { captureSendFailureEvidence } from '../send-failure-evidence'
import { createRuntimeLogStore as createReferenceLogStore } from '../../../tests/fixtures/performance/runtime-log-store'

function entry(id = 'test:1'): RuntimeLog {
  return {
    id,
    at: Date.now(),
    source: 'test',
    level: 'error',
    message: 'send-failed',
    details: new Error('failure'),
    context: { fullscreen: true },
  }
}
function storageFixture() {
  let data: Record<string, unknown> = { favorites: ['keep'] }
  return {
    get: vi.fn<() => Promise<Record<string, unknown>>>(async () => structuredClone(data)),
    set: vi.fn<(patch: Record<string, unknown>) => Promise<void>>(
      async (patch: Record<string, unknown>) => {
        data = { ...data, ...structuredClone(patch) }
      },
    ),
    remove: vi.fn<(key: string | string[]) => Promise<void>>(async (key: string | string[]) => {
      for (const item of Array.isArray(key) ? key : [key]) delete data[item]
    }),
  }
}
afterEach(() => {
  installRuntimeLogger({ source: 'cleanup', write: () => {} }).destroy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('persistent runtime logs', () => {
  it.each(['count', 'bytes'])('preserves sequential eviction and retry semantics across a %s-bounded batch', async (limit) => {
    const now = Date.now()
    const seed = Array.from({ length: limit === 'count' ? 500 : 280 }, (_, index) => ({
      ...entry(`seed-${index}`), at: now, details: limit === 'bytes' ? '界'.repeat(1200) : {}, receivedAt: now, version: 'test',
    }))
    const additions = ['new', 'seed-0', 'seed-1', 'new', 'seed-2'].map((id) => ({ ...entry(id), at: now }))
    const baselineStorage = storageFixture()
    const currentStorage = storageFixture()
    await baselineStorage.set({ [LOG_STORAGE_KEY]: { schemaVersion: 1, entries: seed } })
    await currentStorage.set({ [LOG_STORAGE_KEY]: { schemaVersion: 1, entries: seed } })
    const baseline = createReferenceLogStore(baselineStorage, () => now)
    const current = createRuntimeLogStore(currentStorage, () => now)
    await Promise.all(additions.map((row) => baseline.append(row, { version: 'test' })))
    await Promise.all(additions.map((row) => current.append(row, { version: 'test' })))
    expect(await current.export()).toEqual(await baseline.export())
  })

  it('coalesces queued appends, acknowledges only after persistence, and respects export/clear barriers', async () => {
    const storage = storageFixture()
    const originalSet = storage.set.getMockImplementation()!
    let release!: () => void
    storage.set.mockImplementationOnce(async (patch) => {
      await new Promise<void>((resolve) => { release = resolve })
      await originalSet(patch)
    })
    const store = createRuntimeLogStore(storage)
    const acknowledged: string[] = []
    const first = store.append(entry('first'), { version: 'test' }).then(() => acknowledged.push('first'))
    const second = store.append(entry('second'), { version: 'test' }).then(() => acknowledged.push('second'))
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1))
    expect(acknowledged).toEqual([])
    const exported = store.export()
    const cleared = store.clear()
    const third = store.append(entry('third'), { version: 'test' })
    release()
    await Promise.all([first, second, cleared, third])
    expect((await exported).entries.map((row) => row.id)).toEqual(['first', 'second'])
    expect((await store.export()).entries.map((row) => row.id)).toEqual(['third'])
    expect(acknowledged).toEqual(['first', 'second'])
  })

  it('rejects every unpersisted batch member on storage failure and allows later retries', async () => {
    const storage = storageFixture()
    storage.set.mockRejectedValueOnce(new Error('offline'))
    const store = createRuntimeLogStore(storage)
    const failed = await Promise.allSettled([
      store.append(entry('a'), { version: 'test' }),
      store.append(entry('b'), { version: 'test' }),
    ])
    expect(failed.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    await Promise.all([store.append(entry('a'), { version: 'test' }), store.append(entry('b'), { version: 'test' })])
    expect((await createRuntimeLogStore(storage).export()).entries.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('bounds pending requests even when they share one write', async () => {
    const store = createRuntimeLogStore(storageFixture())
    const pending = Array.from({ length: 100 }, (_, index) => store.append(entry(`pending-${index}`), { version: 'test' }))
    await expect(store.append(entry('overflow'), { version: 'test' })).rejects.toThrow('log-queue-full')
    await Promise.all(pending)
    expect((await store.export()).entries).toHaveLength(100)
  })

  it('retains bounded page evidence across restarts and exports readable HTML beside old logs', async () => {
    document.body.innerHTML = '<form class="send-form"><textarea>private-draft</textarea><button>发送</button></form>'
    const storage = storageFixture()
    const store = createRuntimeLogStore(storage)
    await store.append(entry('old'), { version: 'test' })
    await store.append({
      ...entry('failure'),
      evidence: captureSendFailureEvidence('attempt-12345678', Date.now(), document),
    }, { version: 'test' })
    const exported = await createRuntimeLogStore(storage).export()
    expect(exported.entries).toHaveLength(2)
    expect(exported.entries[0]?.evidence).toBeUndefined()
    expect(JSON.stringify(exported.entries[1]?.evidence)).toContain('send-form')
    expect(JSON.stringify(exported)).not.toContain('private-draft')
    await store.clear()
    expect((await store.export()).entries).toEqual([])
    document.body.replaceChildren()
  })

  it('redacts credentials, page identifiers and hostile objects while retaining error stacks', () => {
    const object = {
      cookie: 'hidden',
      userId: 'private-user',
      text: 'private-danmaku',
      requestUrl: 'https://example.com/room?token=hidden',
      nested: {},
    }
    object.nested = object
    const error = new Error('token=secret request https://example.com/room?uid=123')
    error.stack = 'Error\n at chrome-extension://test/src/content.js:12:4'
    const result = JSON.stringify(
      sanitizeLogValue({
        object,
        error,
        get accessor() {
          throw new Error('must not execute')
        },
      }),
    )
    expect(result).not.toContain('hidden')
    expect(result).not.toContain('private-user')
    expect(result).not.toContain('private-danmaku')
    expect(result).not.toContain('secret')
    expect(result).not.toContain('uid=123')
    expect(result).toContain('content.js:12:4')
    expect(result).toContain('[circular]')
    expect(result).toContain('[accessor]')
    expect(normalizeRuntimeLog({ ...entry(), level: 'debug' })).toBeNull()
  })

  it('serializes concurrent tabs, survives store recreation and deduplicates retries', async () => {
    const storage = storageFixture()
    const store = createRuntimeLogStore(storage)
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.append(entry('test:' + index), { version: '2.3.2', tabId: index, frameId: 0 }),
      ),
    )
    expect(storage.set).toHaveBeenCalledTimes(1)
    await store.append(entry('test:1'), { version: '2.3.2' })
    const restarted = createRuntimeLogStore(storage)
    const bundle = await restarted.export()
    expect(bundle.entries).toHaveLength(20)
    expect(bundle.entries[5]).toMatchObject({ tabId: 5, frameId: 0, version: '2.3.2' })
    await restarted.clear()
    expect((await restarted.export()).entries).toEqual([])
    expect((await storage.get()).favorites).toEqual(['keep'])
  })

  it('recovers after a failed write and expires old logs using receipt time', async () => {
    const storage = storageFixture()
    let now = Date.now()
    const store = createRuntimeLogStore(storage, () => now)
    storage.set.mockRejectedValueOnce(new Error('quota'))
    await expect(store.append(entry('failed'), { version: 'test' })).rejects.toThrow('quota')
    await store.append(entry('ok'), { version: 'test' })
    expect((await store.export()).entries).toHaveLength(1)
    now += LOG_MAX_AGE + 1
    expect((await store.export()).entries).toEqual([])
    expect((await storage.get())[LOG_STORAGE_KEY]).toMatchObject({ entries: [] })
  })

  it('bounds total entries and UTF-8 storage size', async () => {
    const storage = storageFixture()
    const now = Date.now()
    await storage.set({
      [LOG_STORAGE_KEY]: {
        schemaVersion: 1,
        entries: Array.from({ length: LOG_LIMIT + 10 }, (_, index) => ({
          ...entry('large:' + index),
          details: '界'.repeat(1800),
          receivedAt: now,
          version: 'test',
        })),
      },
    })
    const bundle = await createRuntimeLogStore(storage).export()
    expect(bundle.entries.length).toBeLessThanOrEqual(LOG_LIMIT)
    expect(new TextEncoder().encode(JSON.stringify(bundle.entries)).length).toBeLessThanOrEqual(
      LOG_MAX_BYTES,
    )
    expect(bundle.entries.at(-1)?.id).toBe('large:' + (LOG_LIMIT + 9))
  })

  it('preserves console output, captures contextual warnings once, and cleans up hooks', () => {
    const original = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const write = vi.fn<(entry: RuntimeLog) => void>()
    const logger = installRuntimeLogger({ source: 'content', write, extensionOnlyErrors: true })
    expect(installRuntimeLogger({ source: 'duplicate', write })).toBe(logger)
    setRuntimeLogContext(() => ({ enabled: true, stage: 'hover' }))
    console.warn('website warning')
    console.warn('[Danmaku Echo] failure', { code: 400 })
    expect(original).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      level: 'warn',
      context: { snapshot: { enabled: true, stage: 'hover' } },
    })
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'site', filename: 'https://site.example/app.js' }),
    )
    expect(write).toHaveBeenCalledTimes(1)
    window.dispatchEvent(
      new ErrorEvent('error', {
        error: new Error('extension'),
        filename: 'chrome-extension://id/src/content.js',
        lineno: 4,
      }),
    )
    expect(write).toHaveBeenCalledTimes(2)
    const rejection = new Event('unhandledrejection')
    const reason = new Error('promise')
    reason.stack = 'chrome-extension://id/src/content.js:9:2'
    Object.defineProperty(rejection, 'reason', { value: reason })
    window.dispatchEvent(rejection)
    expect(write).toHaveBeenCalledTimes(3)
    logger.destroy()
    expect(console.warn).toBe(original)
    window.dispatchEvent(rejection)
    expect(write).toHaveBeenCalledTimes(3)
  })

  it('limits a warning storm and retries storage failure once without recursive errors', async () => {
    vi.useFakeTimers()
    const write = vi
      .fn<(entry: RuntimeLog) => Promise<void>>()
      .mockRejectedValue(new Error('offline'))
    const logger = installRuntimeLogger({ source: 'test', captureConsole: false, write })
    for (let index = 0; index < 1000; index++) logger.record('warn', 'repeated-warning')
    expect(write).toHaveBeenCalledTimes(60)
    await vi.advanceTimersByTimeAsync(1000)
    expect(write).toHaveBeenCalledTimes(80)
    await vi.advanceTimersByTimeAsync(5000)
    expect(write).toHaveBeenCalledTimes(80)
    logger.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('background log access', () => {
  it('validates the sender and reserves export/clear for extension pages', async () => {
    type Reply = { ok: boolean; data?: { entries: RuntimeLog[] } }
    type Listener = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      respond: (response: Reply) => void,
    ) => boolean
    const addListener = vi.fn<(listener: Listener) => void>()
    const storage = storageFixture()
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'extension-id',
        getManifest: () => ({ version: '2.3.2' }),
        getURL: (path: string) => 'chrome-extension://extension-id/' + path,
        onMessage: { addListener },
      },
      storage: { local: storage },
    })
    startRuntimeLogService()
    const listener = addListener.mock.calls[0]![0]
    const request = (
      action: string,
      sender: chrome.runtime.MessageSender,
      log: unknown = entry(),
    ) =>
      new Promise<Reply>((resolve) =>
        listener({ type: 'danmaku-echo.runtime-log', action, entry: log }, sender, resolve),
      )
    const page = {
      id: 'extension-id',
      url: 'https://live.bilibili.com/123',
      tab: { id: 7 } as chrome.tabs.Tab,
      frameId: 0,
    }
    expect((await request('append', { ...page, id: 'other-extension' })).ok).toBe(false)
    expect((await request('append', page, { ...entry(), level: 'debug' })).ok).toBe(false)
    expect((await request('append', page)).ok).toBe(true)
    expect((await request('export', page)).ok).toBe(false)
    expect((await request('clear', page)).ok).toBe(false)
    const settings = { ...page, url: 'chrome-extension://extension-id/index.html' }
    expect((await request('export', settings)).data?.entries).toHaveLength(1)
    expect((await request('clear', settings)).ok).toBe(true)
    expect((await request('export', settings)).data?.entries).toEqual([])
  })
})

it('preserves diagnostic error text and structural counts through persistence without allowing chat message fields', () => {
  const details = {
    errorMessage: 'Failed to fetch token=hidden',
    apiMessage: 'Login required',
    message: 'private-chat',
    messageLength: 3, senderIndex: 10, sender: 1,
    userId: 'private-user',
    diagnostics: { requests: [{ stage: 'send', endpoint: 'api.live.bilibili.com/msg/send', httpStatus: 403, apiMessage: 'Denied' }] },
  }
  const sanitized = normalizeRuntimeLog({ ...entry(), details: [details] })!
  const roundtrip = normalizeRuntimeLog(JSON.parse(JSON.stringify(sanitized)))!
  expect(roundtrip.details).toMatchObject([{
    errorMessage: 'Failed to fetch token=[redacted]', apiMessage: 'Login required',
    message: '[redacted]', messageLength: 3, senderIndex: 10, sender: 1,
    userId: '[redacted]', diagnostics: { requests: [{ apiMessage: 'Denied', httpStatus: 403 }] },
  }])
  expect(JSON.stringify(roundtrip)).not.toContain('hidden')
  expect(JSON.stringify(roundtrip)).not.toContain('private-chat')
})

import { describe, expect, it } from 'vitest'
import { createSendStatisticsStore, STATISTICS_CHUNK_SIZE, STATISTICS_HEALTH_KEY } from '../store'
import { SEND_STATISTICS_DAY_PREFIX, SEND_STATISTICS_INDEX_KEY, type ConfirmedSend } from '../types'

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial))
  return {
    data,
    async get(key: string | string[] | null) { return Object.fromEntries((key === null ? [...data.keys()] : Array.isArray(key) ? key : [key]).map((item) => [item, structuredClone(data.get(item))])) },
    async getKeys() { return [...data.keys()] },
    async set(values: Record<string, unknown>) {
      for (const [key, value] of Object.entries(values)) data.set(key, structuredClone(value))
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key)
    },
  }
}

const first: ConfirmedSend = {
  id: 'attempt-1234567890', platform: 'bilibili', roomId: '1234', sentAtSec: 1_800_000_000,
}

describe('send statistics store', () => {
  it('keeps second-level events across worker restarts, deduplicates retries and serializes parallel writes', async () => {
    const storage = memoryStorage({ danmakuEchoFavoritesV1: { legacy: true } })
    const store = createSendStatisticsStore(storage)
    const second: ConfirmedSend = { ...first, id: 'attempt-1234567891', platform: 'douyin', roomId: '5678', text: '你好 👋[微笑]\n<script>只是文字</script>' }
    const nextDay: ConfirmedSend = { ...first, id: 'attempt-1234567892', sentAtSec: first.sentAtSec + 86_400 }
    await Promise.all([store.append(first), store.append(second), store.append(first), store.append(nextDay)])
    const reopened = createSendStatisticsStore(storage)
    expect(await reopened.read()).toEqual([first, second, nextDay])
    const exported = await reopened.export()
    expect(exported.events).toHaveLength(3)
    expect(exported.events[0]).not.toHaveProperty('text')
    expect(exported.events[1]?.text).toBe(second.text)
    expect(exported.perSecond).toEqual([
      { second: first.sentAtSec, count: 2 },
      { second: nextDay.sentAtSec, count: 1 },
    ])
    expect(storage.data.get('danmakuEchoFavoritesV1')).toEqual({ legacy: true })
    await reopened.clear()
    expect(await reopened.read()).toEqual([])
    expect(storage.data.get('danmakuEchoFavoritesV1')).toEqual({ legacy: true })
  })

  it('stores only event metadata and text, never the accompanying rich payload', async () => {
    const storage = memoryStorage()
    const store = createSendStatisticsStore(storage)
    const event = { ...first, text: '[微笑]', payload: { assets: [{ src: 'https://example.com/emoji.png' }] } }
    await store.append(event)
    expect(await store.read()).toEqual([{ ...first, text: '[微笑]' }])
    expect(JSON.stringify([...storage.data.values()])).not.toContain('emoji.png')
    await expect(store.append({ ...first, text: { html: '<b>bad</b>' } } as unknown as ConfirmedSend))
      .rejects.toThrow('invalid-send-statistics-event')
    await store.append({ ...first, id: 'attempt-1234567893', text: '' })
    expect((await store.export()).events[1]?.text).toBe('')
  })

  it('refuses unknown or incomplete schema without overwriting prior data', async () => {
    const date = new Date(first.sentAtSec * 1_000).toISOString().slice(0, 10)
    const dayKey = SEND_STATISTICS_DAY_PREFIX + date
    const storage = memoryStorage({
      [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 2, days: [date] },
      [dayKey]: { schemaVersion: 1, date, events: [first] },
    })
    const store = createSendStatisticsStore(storage)
    await expect(store.append(first)).rejects.toThrow('invalid-send-statistics-index')
    expect(storage.data.get(dayKey)).toEqual({ schemaVersion: 1, date, events: [first] })
    storage.data.set(SEND_STATISTICS_INDEX_KEY, { schemaVersion: 1, days: [date, '2027-01-01'] })
    expect(await store.inspect()).toEqual({ events: [first], unavailableDays: ['2027-01-01'] })
  })
  it('migrates an active legacy day without dropping old text or counting a retry twice', async () => {
    const date = new Date(first.sentAtSec * 1000).toISOString().slice(0, 10)
    const legacy = { schemaVersion: 1, date, events: [first] }
    const storage = memoryStorage({ [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: [date] },
      [SEND_STATISTICS_DAY_PREFIX + date]: legacy })
    const store = createSendStatisticsStore(storage)
    const next = { ...first, id: 'attempt-migrated-0001', text: '新增正文' }
    await store.append(next)
    await store.append(first)
    expect(await store.read()).toEqual([first, next].sort((a,b) => a.id.localeCompare(b.id)))
    expect(storage.data.get('danmakuEchoSendStatisticsBackupV1:' + date)).toEqual(legacy)
    expect((await store.summary()).days[0]?.total).toBe(2)
  })

  it('keeps append and first-page I/O bounded with 10000 full-text records', async () => {
    const storage = memoryStorage()
    const store = createSendStatisticsStore(storage)
    for (let i = 0; i < 10000; i++) await store.append({ ...first, id: `volume-attempt-${String(i).padStart(8, '0')}`, text: '文本'.repeat(500), sentAtSec: first.sentAtSec + i })
    const reads: string[] = []
    const get = storage.get
    storage.get = async (keys) => { reads.push(...(keys === null ? [...storage.data.keys()] : Array.isArray(keys) ? keys : [keys])); return get(keys) }
    const totals = await store.summary()
    expect(totals.days.reduce((sum, day) => sum + day.total, 0)).toBe(10000)
    expect(reads.some((key) => key.startsWith('danmakuEchoSendStatisticsEventV2:'))).toBe(false)
    reads.length = 0
    await store.append({ ...first, id: 'volume-final-00000001', text: '末条', sentAtSec: first.sentAtSec + 10000 })
    // One additional key checks for a durable cleanup left by a worker restart.
    expect(reads.length).toBeLessThanOrEqual(5)
    reads.length = 0
    const page = await store.query()
    expect(page.events).toHaveLength(50)
    expect(page.events[0]?.text).toBe('末条')
    expect(reads.filter((key) => key.startsWith('danmakuEchoSendStatisticsEventV2:')).length).toBeLessThanOrEqual(STATISTICS_CHUNK_SIZE * 2)
    const next = await store.query({}, page.nextCursor)
    expect(next.events).toHaveLength(50)
    expect(new Set([...page.events, ...next.events].map((event) => event.id)).size).toBe(100)
  })

  it('filters, exports and clears matching records while serializing a concurrent append', async () => {
    const store = createSendStatisticsStore(memoryStorage())
    await store.append({ ...first, text: '保留苹果' })
    await store.append({ ...first, id: 'attempt-000000002', text: '筛选香蕉', platform: 'huya' })
    const filter = { platform: 'huya' as const, room: '1234', text: '香蕉' }
    expect((await store.query(filter)).events).toHaveLength(1)
    expect((await store.export(filter)).events[0]?.text).toBe('筛选香蕉')
    await Promise.all([store.clear(filter), store.append({ ...first, id: 'attempt-000000003', text: '新香蕉', platform: 'huya' })])
    expect((await store.read()).map((event) => event.text)).toEqual(['新香蕉', '保留苹果'])
    expect((await store.summary()).days[0]?.total).toBe(2)
  })

  it('preserves legacy records when migration cannot be persisted and exposes write health', async () => {
    const date = new Date(first.sentAtSec * 1000).toISOString().slice(0, 10)
    const legacy = { schemaVersion: 1, date, events: [first] }
    const storage = memoryStorage({ [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: [date] }, [SEND_STATISTICS_DAY_PREFIX + date]: legacy })
    const set = storage.set
    storage.set = async (values) => {
      if (!(STATISTICS_HEALTH_KEY in values)) throw new Error('quota')
      await set(values)
    }
    const store = createSendStatisticsStore(storage)
    await expect(store.append({ ...first, id: 'attempt-000000002' })).rejects.toThrow('quota')
    expect(await store.read()).toEqual([first])
    expect((await store.summary()).lastFailureAt).toBeGreaterThan(0)
  })

})


describe('statistics cleanup recovery', () => {
  it.each(['prepare', 'rewrite', 'remove', 'finish'])('recovers a failed %s without leaving deleted text or touching other data', async (stage) => {
    const date = new Date(first.sentAtSec * 1000).toISOString().slice(0, 10)
    const storage = memoryStorage({ unrelated: { text: 'private favorite' },
      [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: [date] },
      [SEND_STATISTICS_DAY_PREFIX + date]: { schemaVersion: 1, date, events: [{ ...first, text: 'delete me' }] },
    })
    const writer = createSendStatisticsStore(storage)
    await writer.append({ ...first, id: 'attempt-keep-12345', text: 'keep me' })
    expect(storage.data.has('danmakuEchoSendStatisticsBackupV1:' + date)).toBe(true)
    const set = storage.set, remove = storage.remove
    let injected = false
    storage.set = async (values) => {
      const journal = values.danmakuEchoSendStatisticsCleanupV1 as { phase?: string } | undefined
      if (!injected && ((stage === 'prepare' && journal?.phase === 'rewrite') || (stage === 'rewrite' && journal?.phase === 'remove'))) {
        injected = true; throw new Error('injected failure')
      }
      await set(values)
    }
    storage.remove = async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys]
      if (!injected && ((stage === 'remove' && list.some(k => k.includes('EventV2:'))) || (stage === 'finish' && list.includes('danmakuEchoSendStatisticsCleanupV1')))) {
        injected = true; throw new Error('injected failure')
      }
      await remove(keys)
    }
    await expect(writer.clear({ text: 'delete me' })).rejects.toThrow('injected failure')
    const interruptedRead = await createSendStatisticsStore(storage).read().then(events => events.map(e => e.text), error => error.message)
    expect(interruptedRead).toEqual(stage === 'prepare' ? ['delete me', 'keep me'] : 'send-statistics-cleaning')
    const reopened = createSendStatisticsStore(storage)
    await reopened.clear({ text: 'delete me' })
    expect((await reopened.read()).map(e => e.text)).toEqual(['keep me'])
    expect(JSON.stringify([...storage.data])).not.toContain('delete me')
    expect(storage.data.has('danmakuEchoSendStatisticsBackupV1:' + date)).toBe(false)
    expect(storage.data.get('unrelated')).toEqual({ text: 'private favorite' })
  })

  it('recovers after an earlier deletion batch has already removed its records', async () => {
    const date = new Date(first.sentAtSec * 1000).toISOString().slice(0, 10)
    const events = Array.from({ length: 140 }, (_, i) => ({ ...first, id: `partial-delete-${i}`, text: 'delete batch' }))
    const storage = memoryStorage({ [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: [date] }, [SEND_STATISTICS_DAY_PREFIX + date]: { schemaVersion: 1, date, events } })
    const store = createSendStatisticsStore(storage)
    await store.append({ ...first, id: 'partial-keep-record', text: 'keep' })
    const remove = storage.remove
    let batches = 0
    storage.remove = async keys => {
      if (++batches === 2) throw new Error('interrupted second batch')
      await remove(keys)
    }
    await expect(store.clear({ text: 'delete batch' })).rejects.toThrow('interrupted second batch')
    expect([...storage.data.keys()].filter(key => key.includes('EventV2:'))).toHaveLength(13)
    const reopened = createSendStatisticsStore(storage)
    await reopened.recover()
    expect((await reopened.read()).map(event => event.text)).toEqual(['keep'])
    expect(JSON.stringify([...storage.data])).not.toContain('delete batch')
    expect(storage.data.has('danmakuEchoSendStatisticsBackupV1:' + date)).toBe(false)
  })

  it('finds orphan records even when the index is gone and preserves unknown namespaces', async () => {
    const storage = memoryStorage()
    const writer = createSendStatisticsStore(storage)
    await writer.append({ ...first, text: 'orphan secret' })
    storage.data.delete(SEND_STATISTICS_INDEX_KEY)
    storage.data.set('danmakuEchoSendStatisticsEventV3:future', { schemaVersion: 3 })
    await writer.clear()
    expect(JSON.stringify([...storage.data])).not.toContain('orphan secret')
    expect(storage.data.has('danmakuEchoSendStatisticsEventV3:future')).toBe(true)
  })

  it('invalidates a positional cursor after another writer deletes records, but not after append', async () => {
    const storage = memoryStorage(), writer = createSendStatisticsStore(storage)
    for (let i = 1; i <= 6; i++) await writer.append({ ...first, id: `attempt-page-${i}`, text: `message-${i}` })
    const reader = createSendStatisticsStore(storage)
    const page = await reader.query({}, undefined, 2)
    await writer.append({ ...first, id: 'attempt-page-7', text: 'message-7' })
    expect((await reader.query({}, page.nextCursor, 2)).events.map(e => e.text)).toEqual(['message-4', 'message-3'])
    await writer.clear({ text: 'message-1' })
    await expect(reader.query({}, page.nextCursor, 2)).rejects.toThrow('send-statistics-cursor-expired')
  })
})

describe('statistics interruption boundaries', () => {
  it('resumes all selected days before appending, without deleting the new record', async () => {
    const storage = memoryStorage(), store = createSendStatisticsStore(storage)
    await store.append({ ...first, text: 'old selected' })
    await store.append({ ...first, id: 'attempt-nextday-1', sentAtSec: first.sentAtSec + 86400, text: 'old selected' })
    const remove = storage.remove
    let failed = false
    storage.remove = async keys => {
      if (!failed) { failed = true; throw new Error('worker stopped') }
      await remove(keys)
    }
    await expect(store.clear({ text: 'old selected' })).rejects.toThrow('worker stopped')
    const reopened = createSendStatisticsStore(storage)
    const next = { ...first, id: 'attempt-after-restart', text: 'old selected but new' }
    await reopened.append(next)
    expect(await reopened.read()).toEqual([next])
    expect([...storage.data.values()].filter(value => value && typeof value === 'object' && 'text' in value)).toEqual([next])
  })

  it('rejects a query that crosses a concurrent clear and a cursor without a revision', async () => {
    const storage = memoryStorage(), writer = createSendStatisticsStore(storage), reader = createSendStatisticsStore(storage)
    await writer.append(first)
    const get = storage.get
    let trigger = true
    storage.get = async keys => {
      const result = await get(keys)
      if (trigger && typeof keys === 'string' && keys.startsWith('danmakuEchoSendStatisticsChunkV2:')) {
        trigger = false
        await writer.clear()
      }
      return result
    }
    await expect(reader.query()).rejects.toThrow('send-statistics-cursor-expired')
    await expect(reader.query({}, { date: '2027-01-15', before: 2 })).rejects.toThrow('send-statistics-cursor-expired')
  })

  it('keeps future known-key schemas and rejects cleanup tasks that name unrelated storage', async () => {
    const storage = memoryStorage({ 'danmakuEchoSendStatisticsDayV1:2027-01-15': { schemaVersion: 3, future: true } })
    await expect(createSendStatisticsStore(storage).clear()).rejects.toThrow('invalid-send-statistics-future-schema')
    storage.data.set('danmakuEchoSendStatisticsCleanupV1', { schemaVersion: 1, id: 'attempt-malformed-1', phase: 'remove', removeKeys: ['danmakuEchoFavoritesV1'] })
    await expect(createSendStatisticsStore(storage).recover()).rejects.toThrow('invalid-send-statistics-cleanup')
  })
})

describe('statistics bounded reads and cancellation', () => {
  it('keeps the full scan total while progress crosses multiple days', async () => {
    const legacyDate = new Date((first.sentAtSec - 86400) * 1000).toISOString().slice(0, 10)
    const storage = memoryStorage({
      [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: [legacyDate] },
      [SEND_STATISTICS_DAY_PREFIX + legacyDate]: { schemaVersion: 1, date: legacyDate, events: [{ ...first, platform: 'douyin', sentAtSec: first.sentAtSec - 86400 }] },
    }), store = createSendStatisticsStore(storage)
    for (let i = 0; i < 6; i++) await store.append({ ...first, id: `progress-day-${i}`, sentAtSec: first.sentAtSec + Math.floor(i / 3) * 86400, text: 'fixture' })
    const progress: { completed: number; total: number }[] = []
    await store.query({ text: 'absent', platform: first.platform }, undefined, 50, { onProgress: value => progress.push(value) })
    expect(progress.map(value => value.total)).toEqual([6, 6, 6])
    expect(progress.map(value => value.completed)).toEqual([0, 3, 6])
  })

  it('batches daily summaries, reuses an opted-in cache and invalidates it on storage changes', async () => {
    const data: Record<string, unknown> = {}
    const dates = Array.from({ length: 300 }, (_, i) => new Date((first.sentAtSec + i * 86400) * 1000).toISOString().slice(0, 10))
    data[SEND_STATISTICS_INDEX_KEY] = { schemaVersion: 1, days: dates }
    for (const date of dates) data[SEND_STATISTICS_DAY_PREFIX + date] = { schemaVersion: 2, date, total: 1, platforms: { huya: 1 } }
    const storage = memoryStorage(data), get = storage.get
    let calls = 0
    storage.get = async keys => { calls++; return get(keys) }
    const store = createSendStatisticsStore(storage, { cacheSummary: true })
    expect((await store.summary()).days).toHaveLength(300)
    expect(calls).toBe(7) // 2 revision checks, index, 3 batches, health.
    calls = 0
    await store.summary()
    expect(calls).toBe(2)
    store.invalidate()
    calls = 0
    await store.summary()
    expect(calls).toBe(7)
  })

  it('cancels sparse searches and exports at a chunk boundary without changing data', async () => {
    const storage = memoryStorage(), store = createSendStatisticsStore(storage)
    for (let i = 0; i < 400; i++) await store.append({ ...first, id: `cancel-attempt-${i}`, text: 'body' })
    const before = JSON.stringify([...storage.data])
    for (const kind of ['query', 'export'] as const) {
      const abort = new AbortController()
      const progress: number[] = []
      const operation = { signal: abort.signal, onProgress(value: { completed: number }) {
        progress.push(value.completed)
        if (value.completed >= 128) abort.abort()
      } }
      const task = kind === 'query' ? store.query({ text: 'absent' }, undefined, 50, operation) : store.exportBlob({}, operation)
      await expect(task).rejects.toThrow('aborted')
      expect(progress.at(-1)).toBeLessThanOrEqual(256)
      expect(JSON.stringify([...storage.data])).toBe(before)
    }
  })

  it('exports equivalent ordered JSON from mixed legacy and chunked days', async () => {
    const date = new Date(first.sentAtSec * 1000).toISOString().slice(0, 10)
    const storage = memoryStorage({ [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: [date] }, [SEND_STATISTICS_DAY_PREFIX + date]: { schemaVersion: 1, date, events: [first] } })
    const store = createSendStatisticsStore(storage)
    await store.append({ ...first, id: 'export-next-day-z', sentAtSec: first.sentAtSec + 86400, text: '引号"与\n换行😀' })
    await store.append({ ...first, id: 'export-next-day-a', sentAtSec: first.sentAtSec + 86400, text: '' })
    const legacy = await store.export()
    const progress: number[] = []
    const { blob } = await store.exportBlob({}, { onProgress: value => progress.push(value.completed) })
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob)
    })
    expect(JSON.parse(text)).toEqual({ ...legacy, exportedAt: expect.any(String) })
    expect(progress.at(-1)).toBe(3)
  })

  it('yields legacy arrays between chunks so a UI cancellation can interrupt the scan', async () => {
    const date = new Date(first.sentAtSec * 1000).toISOString().slice(0, 10)
    const events = Array.from({ length: 512 }, (_, i) => ({ ...first, id: `legacy-cancel-${i}`, text: 'body' }))
    const storage = memoryStorage({ [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: [date] }, [SEND_STATISTICS_DAY_PREFIX + date]: { schemaVersion: 1, date, events } })
    const store = createSendStatisticsStore(storage)
    for (const kind of ['query', 'export'] as const) {
      const abort = new AbortController()
      let scanned = 0
      const operation = { signal: abort.signal, onProgress: (value: { completed: number }) => {
        scanned = value.completed
        if (scanned === 128) setTimeout(() => abort.abort(), 0)
      } }
      await expect(kind === 'query' ? store.query({ text: 'absent' }, undefined, 50, operation) : store.exportBlob({}, operation)).rejects.toThrow('aborted')
      expect(scanned).toBe(128)
    }
    expect((await store.read())).toHaveLength(512)
  })
})

it('pages sparse filtered records across UTC days without duplicates after an append', async () => {
  const storage = memoryStorage(), writer = createSendStatisticsStore(storage), reader = createSendStatisticsStore(storage)
  const expected: string[] = []
  for (let day = 0; day < 3; day++) for (let i = 0; i < 8; i++) {
    const id = `cross-day-${day}-${i}-record`
    const match = i % 3 === 0
    await writer.append({ ...first, id, sentAtSec: first.sentAtSec + day * 86400 + i, text: match ? 'match' : 'skip', platform: match ? 'douyin' : 'huya' })
    if (match) expected.unshift(id)
  }
  const filter = { platform: 'douyin' as const, text: 'match' }
  const firstPage = await reader.query(filter, undefined, 2)
  await writer.append({ ...first, id: 'cross-day-new-record', text: 'match', platform: 'douyin', sentAtSec: first.sentAtSec + 2 * 86400 + 9 })
  const found = firstPage.events.map(event => event.id)
  let cursor = firstPage.nextCursor
  while (cursor) {
    const page = await reader.query(filter, cursor, 2)
    found.push(...page.events.map(event => event.id)); cursor = page.nextCursor
  }
  expect(found).toEqual(expected)
  expect(new Set(found).size).toBe(found.length)
})

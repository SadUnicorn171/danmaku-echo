import { describe, expect, it } from 'vitest'
import { createSendStatisticsStore, STATISTICS_CHUNK_SIZE, STATISTICS_HEALTH_KEY } from '../store'
import { SEND_STATISTICS_DAY_PREFIX, SEND_STATISTICS_INDEX_KEY, type ConfirmedSend } from '../types'

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial))
  return {
    data,
    async get(key: string | string[]) { return Object.fromEntries((Array.isArray(key) ? key : [key]).map((item) => [item, data.get(item)])) },
    async set(values: Record<string, unknown>) {
      for (const [key, value] of Object.entries(values)) data.set(key, value)
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
    storage.get = async (keys) => { reads.push(...(Array.isArray(keys) ? keys : [keys])); return get(keys) }
    const totals = await store.summary()
    expect(totals.days.reduce((sum, day) => sum + day.total, 0)).toBe(10000)
    expect(reads.some((key) => key.startsWith('danmakuEchoSendStatisticsEventV2:'))).toBe(false)
    reads.length = 0
    await store.append({ ...first, id: 'volume-final-00000001', text: '末条', sentAtSec: first.sentAtSec + 10000 })
    expect(reads.length).toBeLessThanOrEqual(4)
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

import {
  SEND_STATISTICS_DAY_PREFIX, SEND_STATISTICS_INDEX_KEY, isConfirmedSend,
  type ConfirmedSend, type StatisticsFilter, type StatisticsCursor,
} from './types'

export const STATISTICS_CHUNK_SIZE = 128
export const STATISTICS_HEALTH_KEY = 'danmakuEchoSendStatisticsHealthV1'
const CHUNK_PREFIX = 'danmakuEchoSendStatisticsChunkV2:'
const EVENT_PREFIX = 'danmakuEchoSendStatisticsEventV2:'
const BACKUP_PREFIX = 'danmakuEchoSendStatisticsBackupV1:'
type Counts = Record<string, number>
interface LegacyDay { schemaVersion: 1; date: string; events: ConfirmedSend[] }
interface Day { schemaVersion: 2; date: string; total: number; platforms: Counts }
interface Index { schemaVersion: 1; days: string[] }
interface Storage {
  get(key: string | string[]): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string | string[]): Promise<void>
}
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const dateFor = (second: number) => new Date(second * 1_000).toISOString().slice(0, 10)
const eventKey = (date: string, id: string) => EVENT_PREFIX + date + ':' + id
const chunkKey = (date: string, chunk: number) => CHUNK_PREFIX + date + ':' + chunk
function snapshot(event: ConfirmedSend): ConfirmedSend {
  return { id: event.id, platform: event.platform, roomId: event.roomId, sentAtSec: event.sentAtSec,
    ...(event.text === undefined ? {} : { text: event.text }),
    ...(event.confirmation === undefined ? {} : { confirmation: event.confirmation }) }
}
function daySummary(date: string, events: ConfirmedSend[]): Day {
  const platforms: Counts = {}
  for (const event of events) platforms[event.platform] = (platforms[event.platform] || 0) + 1
  return { schemaVersion: 2, date, total: events.length, platforms }
}
function matching(event: ConfirmedSend, filter: StatisticsFilter): boolean {
  return (!filter.platform || event.platform === filter.platform)
    && (!filter.room || event.roomId.includes(filter.room))
    && (!filter.text || (event.text || '').toLocaleLowerCase().includes(filter.text.toLocaleLowerCase()))
}
function selected(date: string, filter: StatisticsFilter): boolean {
  return (!filter.from || date >= filter.from) && (!filter.to || date <= filter.to)
}
function validateFilter(filter: StatisticsFilter): void {
  if ((filter.from && !datePattern.test(filter.from)) || (filter.to && !datePattern.test(filter.to))
    || (filter.from && filter.to && filter.from > filter.to)
    || (filter.platform && !['bilibili', 'douyin', 'douyu', 'huya'].includes(filter.platform))
    || (filter.room !== undefined && typeof filter.room !== 'string')
    || (filter.text !== undefined && typeof filter.text !== 'string')) throw new Error('invalid-send-statistics-filter')
}
export function createSendStatisticsStore(storage: Storage) {
  let tail: Promise<unknown> = Promise.resolve()
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = tail.then(operation)
    tail = task.catch(() => {})
    return task
  }
  async function index(): Promise<Index> {
    const value = (await storage.get(SEND_STATISTICS_INDEX_KEY))[SEND_STATISTICS_INDEX_KEY] as Index | undefined
    if (value === undefined) return { schemaVersion: 1, days: [] }
    if (value?.schemaVersion !== 1 || !Array.isArray(value.days)
      || !value.days.every((date) => typeof date === 'string' && datePattern.test(date))) throw new Error('invalid-send-statistics-index')
    return { schemaVersion: 1, days: [...new Set(value.days)].sort() }
  }
  async function day(date: string, required = true): Promise<Day | LegacyDay> {
    const value = (await storage.get(SEND_STATISTICS_DAY_PREFIX + date))[SEND_STATISTICS_DAY_PREFIX + date] as Day | LegacyDay | undefined
    if (value === undefined && !required) return daySummary(date, [])
    if (value?.date === date) {
      if (value.schemaVersion === 1 && Array.isArray(value.events)
        && value.events.every((event) => isConfirmedSend(event) && dateFor(event.sentAtSec) === date)) return value
      if (value.schemaVersion === 2 && Number.isSafeInteger(value.total) && value.total >= 0
        && value.platforms && Object.entries(value.platforms).every(([platform, count]) =>
          ['bilibili', 'douyin', 'douyu', 'huya'].includes(platform) && Number.isSafeInteger(count) && count >= 0)
        && Object.values(value.platforms).reduce((a, b) => a + b, 0) === value.total) return value
    }
    throw new Error(value === undefined ? 'missing-send-statistics-day' : 'invalid-send-statistics-day')
  }
  async function chunkIds(date: string, chunk: number, total: number): Promise<string[]> {
    const key = chunkKey(date, chunk)
    const ids = (await storage.get(key))[key]
    const size = Math.min(STATISTICS_CHUNK_SIZE, total - chunk * STATISTICS_CHUNK_SIZE)
    if (!Array.isArray(ids) || ids.length < size || !ids.every((id) => typeof id === 'string' && /^[a-z0-9-]{12,100}$/i.test(id))) {
      throw new Error('invalid-send-statistics-chunk')
    }
    return ids.slice(0, size) as string[]
  }
  async function readChunk(date: string, chunk: number, total: number): Promise<ConfirmedSend[]> {
    const ids = await chunkIds(date, chunk, total)
    const keys = ids.map((id) => eventKey(date, id))
    const values = await storage.get(keys)
    return keys.map((key, i) => {
      const event = values[key]
      if (!isConfirmedSend(event) || event.id !== ids[i] || dateFor(event.sentAtSec) !== date) throw new Error('invalid-send-statistics-event')
      return event
    })
  }
  async function eventsFor(value: Day | LegacyDay): Promise<ConfirmedSend[]> {
    if (value.schemaVersion === 1) return value.events
    const events: ConfirmedSend[] = []
    for (let chunk = 0; chunk < Math.ceil(value.total / STATISTICS_CHUNK_SIZE); chunk++) events.push(...await readChunk(value.date, chunk, value.total))
    return events
  }
  function encode(date: string, events: ConfirmedSend[]): Record<string, unknown> {
    const values: Record<string, unknown> = { [SEND_STATISTICS_DAY_PREFIX + date]: daySummary(date, events) }
    for (let i = 0; i < events.length; i += STATISTICS_CHUNK_SIZE) {
      const batch = events.slice(i, i + STATISTICS_CHUNK_SIZE)
      values[chunkKey(date, i / STATISTICS_CHUNK_SIZE)] = batch.map((event) => event.id)
      for (const event of batch) values[eventKey(date, event.id)] = snapshot(event)
    }
    return values
  }
  async function inspect(filter: StatisticsFilter = {}) {
    validateFilter(filter)
    const events: ConfirmedSend[] = []
    const unavailableDays: string[] = []
    for (const date of (await index()).days.filter((date) => selected(date, filter))) {
      try { events.push(...(await eventsFor(await day(date))).filter((event) => matching(event, filter))) }
      catch (error) {
        if (!(error instanceof Error) || !/^(invalid|missing)-send-statistics-/.test(error.message)) throw error
        unavailableDays.push(date)
      }
    }
    events.sort((a, b) => a.sentAtSec - b.sentAtSec || a.id.localeCompare(b.id))
    return { events, unavailableDays }
  }
  return {
    append(event: ConfirmedSend): Promise<void> {
      if (!isConfirmedSend(event)) return Promise.reject(new Error('invalid-send-statistics-event'))
      const record = snapshot(event)
      return serial(async () => {
        try {
          const date = dateFor(record.sentAtSec)
          const current = await index()
          const value = await day(date, current.days.includes(date))
          const key = eventKey(date, record.id)
          if (value.schemaVersion === 1) {
            if (value.events.some((item) => item.id === record.id)) return
            // Stage all records, the new manifest and original backup in one write.
            await storage.set({ ...encode(date, [...value.events, record]),
              [BACKUP_PREFIX + date]: value,
              [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: [...new Set([...current.days, date])].sort() } })
            return
          }
          if ((await storage.get(key))[key] !== undefined) return
          const chunk = Math.floor(value.total / STATISTICS_CHUNK_SIZE)
          const previous = value.total % STATISTICS_CHUNK_SIZE
            ? await chunkIds(date, chunk, value.total) : []
          await storage.set({
            [key]: record,
            [chunkKey(date, chunk)]: [...previous, record.id],
            [SEND_STATISTICS_DAY_PREFIX + date]: { ...value, total: value.total + 1,
              platforms: { ...value.platforms, [record.platform]: (value.platforms[record.platform] || 0) + 1 } },
            ...(current.days.includes(date) ? {} : { [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: [...current.days, date].sort() } }),
          })
        } catch (error) {
          try { await storage.set({ [STATISTICS_HEALTH_KEY]: { lastFailureAt: Date.now(), reason: 'write-failed' } }) } catch { /* Storage may be full. */ }
          throw error
        }
      })
    },
    read(): Promise<ConfirmedSend[]> { return serial(async () => (await inspect()).events) },
    inspect(filter: StatisticsFilter = {}) { return serial(() => inspect(filter)) },
    summary() {
      return serial(async () => {
        const days: Day[] = []
        const unavailableDays: string[] = []
        for (const date of (await index()).days) {
          try {
            const value = await day(date)
            days.push(value.schemaVersion === 1 ? daySummary(date, value.events) : value)
          } catch (error) {
            if (!(error instanceof Error) || !/^(invalid|missing)-send-statistics-/.test(error.message)) throw error
            unavailableDays.push(date)
          }
        }
        const health = (await storage.get(STATISTICS_HEALTH_KEY))[STATISTICS_HEALTH_KEY] as { lastFailureAt?: number } | undefined
        return { days, unavailableDays, lastFailureAt: Number.isFinite(health?.lastFailureAt) ? health!.lastFailureAt : undefined }
      })
    },
    query(filter: StatisticsFilter = {}, cursor?: StatisticsCursor, limit = 50) {
      return serial(async () => {
        validateFilter(filter)
        if (cursor && (!datePattern.test(cursor.date) || !Number.isSafeInteger(cursor.before) || cursor.before < 0)) throw new Error('invalid-send-statistics-cursor')
        const events: ConfirmedSend[] = []
        const unavailableDays: string[] = []
        const pageSize = Math.min(100, Math.max(1, Math.floor(limit) || 50))
        let nextCursor: StatisticsCursor | undefined
        const dates = (await index()).days.filter((date) => selected(date, filter) && (!cursor || date <= cursor.date)).reverse()
        for (const date of dates) {
          try {
            const value = await day(date)
            if (value.schemaVersion === 2 && filter.platform && !value.platforms[filter.platform]) continue
            const total = value.schemaVersion === 1 ? value.events.length : value.total
            let before = Math.min(total, cursor?.date === date ? cursor.before : total)
            while (before > 0) {
              const chunk = Math.floor((before - 1) / STATISTICS_CHUNK_SIZE)
              const batch = value.schemaVersion === 1
                ? value.events.slice(chunk * STATISTICS_CHUNK_SIZE, (chunk + 1) * STATISTICS_CHUNK_SIZE)
                : await readChunk(date, chunk, total)
              for (let i = before - chunk * STATISTICS_CHUNK_SIZE - 1; i >= 0; i--) {
                const event = batch[i]!
                before--
                if (!matching(event, filter)) continue
                if (events.length === pageSize) return { events, unavailableDays, nextCursor }
                events.push(event)
                if (events.length === pageSize) nextCursor = { date, before }
              }
            }
          } catch (error) {
            if (!(error instanceof Error) || !/^(invalid|missing)-send-statistics-/.test(error.message)) throw error
            unavailableDays.push(date)
          }
        }
        return { events, unavailableDays, nextCursor: undefined as StatisticsCursor | undefined }
      })
    },
    export(filter: StatisticsFilter = {}) {
      return serial(async () => {
        const { events, unavailableDays } = await inspect(filter)
        const counts = new Map<number, number>()
        for (const event of events) counts.set(event.sentAtSec, (counts.get(event.sentAtSec) || 0) + 1)
        return { format: 'danmaku-echo-send-statistics', schemaVersion: 1 as const,
          exportedAt: new Date().toISOString(), events,
          perSecond: [...counts].map(([second, count]) => ({ second, count })), unavailableDays }
      })
    },
    clear(filter: StatisticsFilter = {}): Promise<void> {
      return serial(async () => {
        validateFilter(filter)
        const current = await index()
        for (const date of [...current.days].filter((date) => selected(date, filter))) {
          const value = await day(date)
          const events = await eventsFor(value)
          const kept = events.filter((event) => !matching(event, filter))
          if (kept.length === events.length) continue
          const removed = events.filter((event) => matching(event, filter)).map((event) => eventKey(date, event.id))
          const oldChunks = Math.ceil(events.length / STATISTICS_CHUNK_SIZE)
          for (let chunk = Math.ceil(kept.length / STATISTICS_CHUNK_SIZE); chunk < oldChunks; chunk++) removed.push(chunkKey(date, chunk))
          removed.push(BACKUP_PREFIX + date)
          if (kept.length) await storage.set(encode(date, kept))
          else {
            current.days = current.days.filter((item) => item !== date)
            // Empty the manifest before deleting records so interrupted cleanup never exposes deleted text.
            await storage.set({ [SEND_STATISTICS_INDEX_KEY]: current, [SEND_STATISTICS_DAY_PREFIX + date]: daySummary(date, []) })
            removed.push(SEND_STATISTICS_DAY_PREFIX + date)
          }
          await storage.remove(removed)
        }
        if (!Object.values(filter).some(Boolean)) {
          await storage.remove(STATISTICS_HEALTH_KEY)
          if (!current.days.length) await storage.remove(SEND_STATISTICS_INDEX_KEY)
        }
      })
    },
  }
}

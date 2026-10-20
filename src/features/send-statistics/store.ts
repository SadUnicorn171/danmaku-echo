import { checkpoint, yieldStatisticsOperation, statisticsCapacity, type StatisticsOperation } from './operations'
import { createStatisticsCleanup, statisticsKeys, ownedStatisticsKey, CHUNK_PREFIX, EVENT_PREFIX, BACKUP_PREFIX, STATISTICS_HEALTH_KEY, type StatisticsStorage } from './cleanup'
export { STATISTICS_HEALTH_KEY } from './cleanup'
import {
  SEND_STATISTICS_DAY_PREFIX, SEND_STATISTICS_INDEX_KEY, isConfirmedSend,
  type ConfirmedSend, type StatisticsFilter, type StatisticsCursor,
} from './types'

export const STATISTICS_CHUNK_SIZE = 128
type Counts = Record<string, number>
interface LegacyDay { schemaVersion: 1; date: string; events: ConfirmedSend[] }
interface Day { schemaVersion: 2; date: string; total: number; platforms: Counts }
interface Index { schemaVersion: 1; days: string[] }
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
export function createSendStatisticsStore(storage: StatisticsStorage, options: { cacheSummary?: boolean } = {}) {
  let cacheEpoch = 0
  let summaryCache: { epoch: number; revision: string; value: { days: Day[]; unavailableDays: string[]; lastFailureAt: number | undefined } } | undefined
  function invalidate(): void { cacheEpoch++; summaryCache = undefined }
  let tail: Promise<unknown> = Promise.resolve()
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = tail.then(operation)
    tail = task.catch(() => {})
    return task
  }
  const cleanup = createStatisticsCleanup(storage, async (task) => {
    if (!task.rewrite) return { [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: [] } }
    const updates: Record<string, unknown> = { [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: task.rewrite.days } }
    for (const { date, keepIds } of task.rewrite.dates) {
      const value = await day(date)
      const events = await eventsFor(value)
      const wanted = new Set(keepIds)
      const kept = events.filter(event => wanted.has(event.id))
      if (kept.length !== keepIds.length) throw new Error('invalid-send-statistics-cleanup-source')
      if (value.schemaVersion === 1) {
        // Keep legacy days readable without duplicating text into a migration buffer.
        updates[SEND_STATISTICS_DAY_PREFIX + date] = { schemaVersion: 1, date, events: kept }
      } else {
        const replacement = encode(date, kept)
        for (const event of kept) delete replacement[eventKey(date, event.id)]
        Object.assign(updates, replacement)
      }
    }
    return updates
  })
  async function consistent<T>(operation: (revision: string) => Promise<T>, expected?: string): Promise<T> {
    const revision = await cleanup.revision()
    if (expected !== undefined && expected !== revision) throw new Error('send-statistics-cursor-expired')
    try {
      const result = await operation(revision)
      if (await cleanup.revision() !== revision) throw new Error('send-statistics-cursor-expired')
      return result
    } catch (error) {
      if (await cleanup.revision() !== revision) throw new Error('send-statistics-cursor-expired')
      throw error
    }
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
    return parseDay(date, value, required)
  }
  function parseDay(date: string, value: Day | LegacyDay | undefined, required = true): Day | LegacyDay {
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
  async function summaries(revision: string) {
    if (summaryCache?.revision === revision && summaryCache.epoch === cacheEpoch) return summaryCache.value
    const epoch = cacheEpoch
    const days: Day[] = [], unavailableDays: string[] = []
    const dates = (await index()).days
    for (let start = 0; start < dates.length; start += STATISTICS_CHUNK_SIZE) {
      const batch = dates.slice(start, start + STATISTICS_CHUNK_SIZE)
      const values = await storage.get(batch.map(date => SEND_STATISTICS_DAY_PREFIX + date))
      for (const date of batch) {
        try {
          const value = parseDay(date, values[SEND_STATISTICS_DAY_PREFIX + date] as Day | LegacyDay | undefined)
          days.push(value.schemaVersion === 1 ? daySummary(date, value.events) : value)
        } catch (error) {
          if (!(error instanceof Error) || !/^(invalid|missing)-send-statistics-/.test(error.message)) throw error
          unavailableDays.push(date)
        }
      }
    }
    const health = (await storage.get(STATISTICS_HEALTH_KEY))[STATISTICS_HEALTH_KEY] as { lastFailureAt?: number } | undefined
    const value = { days, unavailableDays, lastFailureAt: Number.isFinite(health?.lastFailureAt) ? health!.lastFailureAt : undefined }
    if (options.cacheSummary && epoch === cacheEpoch) summaryCache = { epoch, revision, value }
    return value
  }
  return {
    append(event: ConfirmedSend): Promise<void> {
      if (!isConfirmedSend(event)) return Promise.reject(new Error('invalid-send-statistics-event'))
      const record = snapshot(event)
      return serial(async () => {
        try {
          invalidate()
          await cleanup.recover()
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
    recover(): Promise<void> { return serial(() => { invalidate(); return cleanup.recover() }) },
    read(): Promise<ConfirmedSend[]> { return serial(() => consistent(async () => (await inspect()).events)) },
    inspect(filter: StatisticsFilter = {}) { return serial(() => consistent(() => inspect(filter))) },
    invalidate,
    capacity: () => statisticsCapacity(storage),
    summary() { return serial(() => consistent(revision => summaries(revision))) },
    query(filter: StatisticsFilter = {}, cursor?: StatisticsCursor, limit = 50, operation: StatisticsOperation = {}) {
      return serial(() => consistent(async (revision) => {
        if (cursor && !cursor.revision) throw new Error('send-statistics-cursor-expired')
        validateFilter(filter)
        if (cursor && (!datePattern.test(cursor.date) || !Number.isSafeInteger(cursor.before) || cursor.before < 0)) throw new Error('invalid-send-statistics-cursor')
        const events: ConfirmedSend[] = []
        const unavailableDays: string[] = []
        checkpoint(operation)
        let completed = 0
        const total = operation.onProgress ? (await summaries(revision)).days
          .filter(day => selected(day.date, filter) && (!cursor || day.date <= cursor.date) && (!filter.platform || day.platforms[filter.platform]))
          .reduce((sum, day) => sum + Math.min(day.total, cursor?.date === day.date ? cursor.before : day.total), 0) : 0
        checkpoint(operation, { completed, total, unit: 'records' })
        const pageSize = Math.min(100, Math.max(1, Math.floor(limit) || 50))
        let nextCursor: StatisticsCursor | undefined
        const dates = (await index()).days.filter((date) => selected(date, filter) && (!cursor || date <= cursor.date)).reverse()
        for (const date of dates) {
          try {
            const value = await day(date)
            if (filter.platform && (value.schemaVersion === 1
              ? !value.events.some(event => event.platform === filter.platform)
              : !value.platforms[filter.platform])) continue
            const dayTotal = value.schemaVersion === 1 ? value.events.length : value.total
            let before = Math.min(dayTotal, cursor?.date === date ? cursor.before : dayTotal)
            while (before > 0) {
              checkpoint(operation)
              const chunk = Math.floor((before - 1) / STATISTICS_CHUNK_SIZE)
              if (value.schemaVersion === 1 && completed > 0) await yieldStatisticsOperation(operation)
              const batch = value.schemaVersion === 1
                ? value.events.slice(chunk * STATISTICS_CHUNK_SIZE, (chunk + 1) * STATISTICS_CHUNK_SIZE)
                : await readChunk(date, chunk, dayTotal)
              checkpoint(operation)
              for (let i = before - chunk * STATISTICS_CHUNK_SIZE - 1; i >= 0; i--) {
                const event = batch[i]!
                before--
                completed++
                if (!matching(event, filter)) continue
                if (events.length === pageSize) {
                  checkpoint(operation, { completed, total, unit: 'records' })
                  return { events, unavailableDays, nextCursor }
                }
                events.push(event)
                if (events.length === pageSize) nextCursor = { date, before, revision }
              }
              checkpoint(operation, { completed, total, unit: 'records' })
            }
          } catch (error) {
            if (!(error instanceof Error) || !/^(invalid|missing)-send-statistics-/.test(error.message)) throw error
            unavailableDays.push(date)
          }
        }
        return { events, unavailableDays, nextCursor: undefined as StatisticsCursor | undefined }
      }, cursor?.revision))
    },
    export(filter: StatisticsFilter = {}) {
      return serial(() => consistent(async () => {
        const { events, unavailableDays } = await inspect(filter)
        const counts = new Map<number, number>()
        for (const event of events) counts.set(event.sentAtSec, (counts.get(event.sentAtSec) || 0) + 1)
        return { format: 'danmaku-echo-send-statistics', schemaVersion: 1 as const,
          exportedAt: new Date().toISOString(), events,
          perSecond: [...counts].map(([second, count]) => ({ second, count })), unavailableDays }
      }))
    },
    exportBlob(filter: StatisticsFilter = {}, operation: StatisticsOperation = {}) {
      return serial(() => consistent(async revision => {
        validateFilter(filter)
        checkpoint(operation)
        const totals = await summaries(revision)
        const total = totals.days.filter(day => selected(day.date, filter)).reduce((sum, day) => sum + day.total, 0)
        let completed = 0, hasEvents = false, hasSeconds = false
        const unavailableDays: string[] = []
        const eventParts: BlobPart[] = [], secondParts: BlobPart[] = []
        checkpoint(operation, { completed, total, unit: 'records' })
        for (const date of (await index()).days.filter(date => selected(date, filter))) {
          checkpoint(operation)
          try {
            const value = await day(date)
            const events: ConfirmedSend[] = []
            const count = value.schemaVersion === 1 ? value.events.length : value.total
            for (let chunk = 0; chunk < Math.ceil(count / STATISTICS_CHUNK_SIZE); chunk++) {
              checkpoint(operation)
              if (value.schemaVersion === 1 && completed > 0) await yieldStatisticsOperation(operation)
              const batch = value.schemaVersion === 1
                ? value.events.slice(chunk * STATISTICS_CHUNK_SIZE, (chunk + 1) * STATISTICS_CHUNK_SIZE)
                : await readChunk(date, chunk, count)
              events.push(...batch.filter(event => matching(event, filter)))
              completed += batch.length
              checkpoint(operation, { completed, total, unit: 'records' })
            }
            events.sort((a, b) => a.sentAtSec - b.sentAtSec || a.id.localeCompare(b.id))
            if (events.length) {
              eventParts.push(new Blob([hasEvents ? ',' : '', JSON.stringify(events).slice(1, -1)]))
              hasEvents = true
              const counts = new Map<number, number>()
              for (const event of events) counts.set(event.sentAtSec, (counts.get(event.sentAtSec) || 0) + 1)
              secondParts.push(new Blob([hasSeconds ? ',' : '', JSON.stringify([...counts].map(([second, count]) => ({ second, count }))).slice(1, -1)]))
              hasSeconds = true
            }
          } catch (error) {
            if (!(error instanceof Error) || !/^(invalid|missing)-send-statistics-/.test(error.message)) throw error
            unavailableDays.push(date)
          }
        }
        checkpoint(operation)
        const header = JSON.stringify({ format: 'danmaku-echo-send-statistics', schemaVersion: 1, exportedAt: new Date().toISOString() }).slice(0, -1)
        return { blob: new Blob([header, ',"events":[', ...eventParts, '],"perSecond":[', ...secondParts, '],"unavailableDays":', JSON.stringify(unavailableDays), '}'], { type: 'application/json' }), unavailableDays }
      }))
    },
    clear(filter: StatisticsFilter = {}): Promise<void> {
      return serial(async () => {
        validateFilter(filter)
        invalidate()
        await cleanup.recover()
        const current = await index()
        if (!Object.values(filter).some(Boolean)) {
          const keys = (await statisticsKeys(storage)).filter(ownedStatisticsKey)
          // Preserve future schemas even under a known key. Corrupt known data can be explicitly cleared.
          for (let start = 0; start < keys.length; start += 128) {
            const values = await storage.get(keys.slice(start, start + 128))
            for (const [key, value] of Object.entries(values)) {
              if (value && typeof value === 'object' && 'schemaVersion' in value
                && !((key.startsWith(SEND_STATISTICS_DAY_PREFIX) ? [1, 2] : [1]).includes(Number(value.schemaVersion)))) {
                throw new Error('invalid-send-statistics-future-schema')
              }
            }
          }
          await cleanup.start([...new Set([...keys, SEND_STATISTICS_INDEX_KEY])])
          return
        }
        const removeKeys: string[] = []
        const dates: { date: string; keepIds: string[] }[] = []
        for (const date of [...current.days].filter(date => selected(date, filter))) {
          const value = await day(date)
          const events = await eventsFor(value)
          const kept = events.filter(event => !matching(event, filter))
          if (kept.length === events.length) continue
          const removed = events.filter(event => matching(event, filter)).map(event => eventKey(date, event.id))
          for (let chunk = Math.ceil(kept.length / STATISTICS_CHUNK_SIZE); chunk < Math.ceil(events.length / STATISTICS_CHUNK_SIZE); chunk++) removed.push(chunkKey(date, chunk))
          removed.push(BACKUP_PREFIX + date)
          if (!kept.length) {
            current.days = current.days.filter(item => item !== date)
            removed.push(SEND_STATISTICS_DAY_PREFIX + date)
          }
          removeKeys.push(...removed)
          dates.push({ date, keepIds: kept.map(event => event.id) })
        }
        if (dates.length) await cleanup.start(removeKeys, { dates, days: current.days })
      })
    },
  }
}

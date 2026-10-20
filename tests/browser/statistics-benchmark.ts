import { createSendStatisticsStore } from '../../src/features/send-statistics/store'
import { SEND_STATISTICS_DAY_PREFIX, SEND_STATISTICS_INDEX_KEY, type ConfirmedSend } from '../../src/features/send-statistics/types'
import { EVENT_PREFIX, CHUNK_PREFIX } from '../../src/features/send-statistics/cleanup'

/** Only loaded by CDP in the runner's disposable extension profile. */
export async function run() {
  const measurements = [], assertionFailures: string[] = []
  const area = chrome.storage.local
  const quota = area.QUOTA_BYTES
  const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null
  for (const [label, count, nearQuota] of [['1000', 1000, false], ['10000', 10000, false], ['near-quota', 10000, true]] as const) {
    await area.clear()
    const values: Record<string, unknown> = {}, days: string[] = []
    for (let day = 0; day < 10; day++) {
      const date = new Date(Date.UTC(2026, 0, day + 1)).toISOString().slice(0, 10)
      days.push(date)
      const events: ConfirmedSend[] = Array.from({ length: count / 10 }, (_, index) => ({
        id: `benchmark-${day}-${String(index).padStart(8, '0')}`, platform: 'huya', roomId: 'fixture-100', sentAtSec: Date.parse(date) / 1000 + index,
        text: `fixture ${index} ` + 'x'.repeat(100), confirmation: 'page',
      }))
      values[SEND_STATISTICS_DAY_PREFIX + date] = { schemaVersion: 2, date, total: events.length, platforms: { huya: events.length } }
      for (let chunk = 0; chunk * 128 < events.length; chunk++) values[CHUNK_PREFIX + date + ':' + chunk] = events.slice(chunk * 128, (chunk + 1) * 128).map(event => event.id)
      for (const event of events) values[EVENT_PREFIX + date + ':' + event.id] = event
    }
    values[SEND_STATISTICS_INDEX_KEY] = { schemaVersion: 1, days }
    await area.set(values)
    if (nearQuota) {
      const initial = await area.getBytesInUse(null)
      const extra = Math.floor((quota * .96 - initial) / count)
      if (extra <= 0) throw new Error('Benchmark seed exceeds quota target')
      for (const [key, value] of Object.entries(values)) if (key.startsWith(EVENT_PREFIX)) (value as ConfirmedSend).text += 'x'.repeat(extra)
      await area.set(values)
    }
    for (const key of Object.keys(values)) delete values[key]
    let calls = 0
    const storageCalls = { get: 0, set: 0, remove: 0, getKeys: 0, getBytesInUse: 0 }
    const storage = {
      get: async (keys: string | string[] | null) => { calls++; storageCalls.get++; return area.get(keys) },
      set: (data: Record<string, unknown>) => { storageCalls.set++; return area.set(data) },
      remove: (keys: string | string[]) => { storageCalls.remove++; return area.remove(keys) },
      getKeys: () => { storageCalls.getKeys++; return (area as typeof area & { getKeys(): Promise<string[]> }).getKeys() },
      getBytesInUse: (keys: string[] | null) => { storageCalls.getBytesInUse++; return area.getBytesInUse(keys) }, QUOTA_BYTES: quota,
    }
    const store = createSendStatisticsStore(storage, { cacheSummary: true })
    const metrics: Record<string, unknown> = { label, count, bytes: await area.getBytesInUse(null), quota }
    let peakHeap = heap(), sampleTimer = 0
    const sample = () => { const current = heap(); if (current !== null) peakHeap = Math.max(peakHeap ?? 0, current) }
    async function measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
      peakHeap = heap()
      calls = 0; const beforeHeap = heap(), start = performance.now()
      Object.assign(storageCalls, { get: 0, set: 0, remove: 0, getKeys: 0, getBytesInUse: 0 })
      sampleTimer = window.setInterval(sample, 10)
      try { return await operation() }
      finally { clearInterval(sampleTimer); sample(); metrics[name] = { ms: performance.now() - start, storageReads: calls, storageCalls: { ...storageCalls }, beforeHeapBytes: beforeHeap, afterHeapBytes: heap(), sampledPeakHeapBytes: peakHeap } }
    }
    const summary = await measure('summary', () => store.summary())
    if (summary.days.reduce((sum, day) => sum + day.total, 0) !== count) assertionFailures.push(`${label}:summary`)
    const page = await measure('firstPage', () => store.query())
    await measure('nextPageWithSummary', async () => { await store.summary(); return store.query({}, page.nextCursor) })
    const result = await measure('searchAll', () => store.query({ text: 'no-match' }, undefined, 50, { onProgress: sample }))
    if (result.events.length) assertionFailures.push(`${label}:search`)
    const exported = await measure('export', () => store.exportBlob({}, { onProgress: sample }))
    const parsed = JSON.parse(await exported.blob.text())
    if (parsed.events.length !== count || parsed.perSecond.length !== count || exported.unavailableDays.length) assertionFailures.push(`${label}:export`)
    const abort = new AbortController()
    let cancelled = false
    try { await store.query({ text: 'no-match' }, undefined, 50, { signal: abort.signal, onProgress: progress => { if (progress.completed > 0) abort.abort() } }) }
    catch (error) { cancelled = (error as Error).name === 'AbortError' }
    if (!cancelled) assertionFailures.push(`${label}:cancel`)
    const capacity = await store.capacity()
    if (nearQuota && capacity.totalBytes! / quota < .95) assertionFailures.push(`${label}:capacity`)
    await area.set({ unrelatedFavorite: 'fixture keep' })
    await measure('clear', () => store.clear())
    const remaining = await area.get(null)
    if (remaining.unrelatedFavorite !== 'fixture keep' || Object.keys(remaining).some(key => key.startsWith(EVENT_PREFIX) || key.startsWith(CHUNK_PREFIX))) assertionFailures.push(`${label}:cleanup`)
    metrics.capacity = capacity
    metrics.exportBytes = exported.blob.size
    measurements.push(metrics)
  }
  await area.clear()
  return { assertionFailures, statisticsBenchmark: measurements, userAgent: navigator.userAgent, heapNote: 'Chromium performance.memory sampled every 10 ms and at progress checkpoints; approximate JS heap, excludes browser-native Blob/storage buffers.' }
}

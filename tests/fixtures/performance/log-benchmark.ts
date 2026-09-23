import { createRuntimeLogStore as baseline } from './runtime-log-store'
import { createRuntimeLogStore as current } from '../../../src/core/runtime-log-store'
import { LOG_STORAGE_KEY, type RuntimeLog } from '../../../src/core/runtime-log'

export async function measureLogs() {
  const results: unknown[] = []
  const assertionFailures: string[] = []
  for (const tabs of [1, 5, 10]) for (let run = 0; run < 3; run++) {
    for (const [name, create] of run % 2 ? [['current', current], ['baseline', baseline]] as const : [['baseline', baseline], ['current', current]] as const) {
      const now = Date.now()
      const entry = (id: string): RuntimeLog => ({ id, at: now, source: 'performance', level: 'error', message: 'fixture-failure', details: '界'.repeat(1000), context: {} })
      const seed = Array.from({ length: 250 }, (_, i) => ({ ...entry(`seed-${i}`), receivedAt: now, version: 'performance' }))
      await chrome.storage.local.set({ [LOG_STORAGE_KEY]: { schemaVersion: 1, entries: seed } })
      let reads = 0
      let writes = 0
      const storage = {
        get: async (key: string) => { reads++; return chrome.storage.local.get(key) },
        set: async (value: Record<string, unknown>) => { writes++; await chrome.storage.local.set(value) },
        remove: (key: string) => chrome.storage.local.remove(key),
      } as Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>
      const store = create(storage)
      const durations: number[] = []
      const started = performance.now()
      await Promise.all(Array.from({ length: tabs * 10 }, async (_, index) => {
        const start = performance.now()
        await store.append(entry(`append-${index}`), { version: 'performance', tabId: index % tabs })
        durations.push(performance.now() - start)
      }))
      const elapsedMs = performance.now() - started
      const sorted = durations.sort((a, b) => a - b)
      results.push({ kind: 'log-append', implementation: name, run: run + 1, tabs, entries: tabs * 10, reads, writes, elapsedMs, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] })
      const exported = await store.export()
      const actualIds = new Set(exported.entries.map((row) => row.id))
      if (Array.from({ length: tabs * 10 }, (_, i) => `append-${i}`).some((id) => !actualIds.has(id))) assertionFailures.push(`${name}-${tabs}-${run}: missing appended logs`)
    }
  }
  await chrome.storage.local.remove(LOG_STORAGE_KEY)
  return { results, assertionFailures }
}

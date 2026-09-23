import {
  LOG_LIMIT,
  LOG_MAX_AGE,
  LOG_MAX_BYTES,
  LOG_MESSAGE,
  LOG_STORAGE_KEY,
  normalizeRuntimeLog,
  type RuntimeLog,
} from './runtime-log'
import { installRuntimeLogger } from './runtime-logger'
import { exportSendFailureEvidence } from './send-failure-evidence'

interface StoredLog extends RuntimeLog {
  receivedAt: number
  version: string
  tabId?: number
  frameId?: number
}
interface LogBundle {
  schemaVersion: 1
  entries: StoredLog[]
}
type Storage = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>
type LogMetadata = { version: string; tabId?: number; frameId?: number }
interface PendingAppend { entry: RuntimeLog; metadata: LogMetadata }

export function createRuntimeLogStore(storage: Storage, now = Date.now) {
  let tail: Promise<unknown> = Promise.resolve()
  let waiting = 0
  let appendBatch: { items: PendingAppend[]; done: Promise<void> } | undefined
  function reserve<T>(operation: () => Promise<T>): Promise<T> {
    if (waiting >= 100) return Promise.reject(new Error('log-queue-full'))
    waiting++
    return operation().finally(() => { waiting-- })
  }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = tail.then(operation)
    tail = task.catch(() => {})
    return task
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    return reserve(() => {
      // Export/clear are barriers: later appends cannot join an earlier batch.
      appendBatch = undefined
      return enqueue(operation)
    })
  }
  async function read(): Promise<StoredLog[]> {
    const value = (await storage.get(LOG_STORAGE_KEY))[LOG_STORAGE_KEY] as
      Partial<LogBundle> | undefined
    if (value?.schemaVersion !== 1 || !Array.isArray(value.entries)) return []
    return value.entries.slice(-LOG_LIMIT).flatMap((raw) => {
      const entry = normalizeRuntimeLog(raw)
      if (!entry || !Number.isFinite(raw.receivedAt) || raw.receivedAt < now() - LOG_MAX_AGE)
        return []
      return [
        {
          ...entry,
          receivedAt: raw.receivedAt,
          version: String(raw.version || '').slice(0, 80),
          ...(Number.isInteger(raw.tabId) ? { tabId: raw.tabId } : {}),
          ...(Number.isInteger(raw.frameId) ? { frameId: raw.frameId } : {}),
        },
      ]
    })
  }
  function bound(entries: StoredLog[]): StoredLog[] {
    const kept = entries.slice(-LOG_LIMIT)
    let bytes = new TextEncoder().encode(JSON.stringify(kept)).length
    while (bytes > LOG_MAX_BYTES && kept.length) {
      bytes -= new TextEncoder().encode(JSON.stringify(kept.shift())).length + 1
    }
    return kept
  }
  async function appendEntries(items: PendingAppend[]): Promise<void> {
    const entries = await read()
    const counts = new Map<string, number>()
    for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) || 0) + 1)
    if (items.every(({ entry }) => counts.has(entry.id))) return
    const encoder = new TextEncoder()
    const sizeOf = (entry: StoredLog) => encoder.encode(JSON.stringify(entry)).length
    const sizes = entries.map(sizeOf)
    let bytes = 2 + Math.max(0, entries.length - 1) + sizes.reduce((sum, size) => sum + size, 0)
    let head = 0
    for (const { entry, metadata } of items) {
      if (counts.has(entry.id)) continue
      const stored = { ...entry, ...metadata, receivedAt: now() }
      const size = sizeOf(stored)
      bytes += size + (entries.length > head ? 1 : 0)
      entries.push(stored)
      sizes.push(size)
      counts.set(entry.id, 1)
      // Apply the same eviction after each append, including retry IDs evicted
      // earlier in this batch. Only the final I/O is coalesced.
      while (entries.length - head > LOG_LIMIT || bytes > LOG_MAX_BYTES) {
        bytes -= sizes[head]! + (entries.length - head > 1 ? 1 : 0)
        const removed = entries[head++]!
        const count = counts.get(removed.id)! - 1
        if (count) counts.set(removed.id, count)
        else counts.delete(removed.id)
      }
    }
    await storage.set({ [LOG_STORAGE_KEY]: { schemaVersion: 1, entries: entries.slice(head) } })
  }
  return {
    append(value: unknown, metadata: LogMetadata) {
      const entry = normalizeRuntimeLog(value)
      if (!entry) return Promise.reject(new Error('invalid-log-entry'))
      return reserve(() => {
        if (!appendBatch) {
          const items: PendingAppend[] = []
          const done = enqueue(async () => {
            if (appendBatch?.items === items) appendBatch = undefined
            await appendEntries(items)
          })
          appendBatch = { items, done }
        }
        appendBatch.items.push({ entry, metadata })
        return appendBatch.done
      })
    },
    export() {
      return serial(async () => {
        const entries = bound(await read())
        await storage.set({ [LOG_STORAGE_KEY]: { schemaVersion: 1, entries } })
        return {
          schemaVersion: 1,
          exportedAt: new Date(now()).toISOString(),
          entries: entries.map(({ evidence, ...entry }) => ({
            ...entry,
            ...(evidence ? { evidence: exportSendFailureEvidence(evidence) } : {}),
          })),
        }
      })
    },
    clear() {
      return serial(() => storage.remove(LOG_STORAGE_KEY))
    },
  }
}

export function startRuntimeLogService(): void {
  const store = createRuntimeLogStore(chrome.storage.local)
  const version = chrome.runtime.getManifest().version
  installRuntimeLogger({ source: 'background', write: (entry) => store.append(entry, { version }) })
  const rates = new Map<string, { at: number; count: number }>()
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message || message.type !== LOG_MESSAGE) return false
    if (sender.id !== chrome.runtime.id) {
      respond({ ok: false, error: 'invalid-sender' })
      return false
    }
    const extensionPage = sender.url?.startsWith(chrome.runtime.getURL(''))
    let operation: Promise<unknown>
    if (message.action === 'append') {
      const key = String(sender.tab?.id ?? 'extension') + ':' + String(sender.frameId ?? 0)
      const now = Date.now()
      for (const [id, rate] of rates) if (now - rate.at >= 60_000) rates.delete(id)
      const rate = rates.get(key) || { at: now, count: 0 }
      if (rates.size >= 200 || rate.count >= 120) {
        respond({ ok: false, error: 'log-rate-limit' })
        return false
      }
      rate.count++
      rates.set(key, rate)
      operation = store.append(message.entry, {
        version,
        tabId: sender.tab?.id,
        frameId: sender.frameId,
      })
    } else if (extensionPage && message.action === 'export') operation = store.export()
    else if (extensionPage && message.action === 'clear') operation = store.clear()
    else {
      respond({ ok: false, error: 'invalid-log-action' })
      return false
    }
    void operation.then(
      (data) => respond({ ok: true, data }),
      () => respond({ ok: false, error: 'log-storage-unavailable' }),
    )
    return true
  })
}

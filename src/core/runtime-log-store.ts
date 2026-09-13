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

export function createRuntimeLogStore(storage: Storage, now = Date.now) {
  let tail: Promise<unknown> = Promise.resolve()
  let waiting = 0
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    if (waiting >= 100) return Promise.reject(new Error('log-queue-full'))
    waiting++
    const task = tail.then(operation).finally(() => {
      waiting--
    })
    tail = task.catch(() => {})
    return task
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
  return {
    append(value: unknown, metadata: { version: string; tabId?: number; frameId?: number }) {
      const entry = normalizeRuntimeLog(value)
      if (!entry) return Promise.reject(new Error('invalid-log-entry'))
      return serial(async () => {
        const entries = await read()
        if (entries.some((row) => row.id === entry.id)) return
        entries.push({ ...entry, ...metadata, receivedAt: now() })
        await storage.set({ [LOG_STORAGE_KEY]: { schemaVersion: 1, entries: bound(entries) } })
      })
    },
    export() {
      return serial(async () => {
        const entries = bound(await read())
        await storage.set({ [LOG_STORAGE_KEY]: { schemaVersion: 1, entries } })
        return { schemaVersion: 1, exportedAt: new Date(now()).toISOString(), entries }
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

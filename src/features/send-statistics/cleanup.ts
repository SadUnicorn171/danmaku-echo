import { SEND_STATISTICS_INDEX_KEY } from './types'

export const STATISTICS_CLEANUP_KEY = 'danmakuEchoSendStatisticsCleanupV1'
export const STATISTICS_REVISION_KEY = 'danmakuEchoSendStatisticsRevisionV1'
export const STATISTICS_HEALTH_KEY = 'danmakuEchoSendStatisticsHealthV1'
export const CHUNK_PREFIX = 'danmakuEchoSendStatisticsChunkV2:'
export const EVENT_PREFIX = 'danmakuEchoSendStatisticsEventV2:'
export const BACKUP_PREFIX = 'danmakuEchoSendStatisticsBackupV1:'
export interface StatisticsStorage {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>
  set(values: Record<string, unknown>): Promise<void>
  remove(keys: string | string[]): Promise<void>
  getKeys?(): Promise<string[]>
  getBytesInUse?(keys: string[] | null): Promise<number>
  QUOTA_BYTES?: number
}
export interface CleanupTask {
  schemaVersion: 1
  id: string
  phase: 'rewrite' | 'remove'
  removeKeys: string[]
  rewrite?: { dates: { date: string; keepIds: string[] }[]; days: string[] }
}
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const idPattern = /^[a-z0-9-]{12,100}$/i
export function ownedStatisticsKey(key: string): boolean {
  return key === SEND_STATISTICS_INDEX_KEY || key === STATISTICS_HEALTH_KEY
    || /^danmakuEchoSendStatistics(?:DayV1|BackupV1):\d{4}-\d{2}-\d{2}$/.test(key)
    || /^danmakuEchoSendStatisticsEventV2:\d{4}-\d{2}-\d{2}:[a-z0-9-]{12,100}$/i.test(key)
    || /^danmakuEchoSendStatisticsChunkV2:\d{4}-\d{2}-\d{2}:\d+$/.test(key)
}
export async function statisticsKeys(storage: StatisticsStorage): Promise<string[]> {
  return storage.getKeys ? storage.getKeys() : Object.keys(await storage.get(null))
}
// Group repetitive namespaces/date prefixes so recovery metadata can fit near quota.
function persisted(task: CleanupTask): Record<string, unknown> {
  const targets: Record<string, string[]> = {}
  for (const key of task.removeKeys) {
    const separator = key.lastIndexOf(':') + 1
    const prefix = key.slice(0, separator)
    ;(targets[prefix] ||= []).push(key.slice(separator))
  }
  const { removeKeys: _keys, ...metadata } = task
  return { ...metadata, targets }
}
export function createStatisticsCleanup(storage: StatisticsStorage, rewrite: (task: CleanupTask) => Promise<Record<string, unknown>>) {
  async function pending(): Promise<CleanupTask | undefined> {
    const value = (await storage.get(STATISTICS_CLEANUP_KEY))[STATISTICS_CLEANUP_KEY]
    if (value === undefined) return undefined
    const stored = value as CleanupTask & { targets?: Record<string, unknown> }
    if (stored?.targets && (typeof stored.targets !== 'object' || Array.isArray(stored.targets)
      || !Object.values(stored.targets).every(value => Array.isArray(value) && value.every(part => typeof part === 'string')))) throw new Error('invalid-send-statistics-cleanup')
    const task = stored?.targets ? { ...stored, removeKeys: Object.entries(stored.targets).flatMap(([prefix, parts]) => (parts as string[]).map(part => prefix + part)) } : stored
    if (!task || task.schemaVersion !== 1 || !idPattern.test(task.id)
      || !['rewrite', 'remove'].includes(task.phase) || !Array.isArray(task.removeKeys)
      || !task.removeKeys.every(key => typeof key === 'string' && ownedStatisticsKey(key))
      || (task.rewrite && (!Array.isArray(task.rewrite.dates) || !task.rewrite.dates.every(day => day && datePattern.test(day.date) && Array.isArray(day.keepIds) && day.keepIds.every(id => typeof id === 'string' && idPattern.test(id)))
        || !Array.isArray(task.rewrite.days) || !task.rewrite.days.every(date => typeof date === 'string' && datePattern.test(date))))) {
      throw new Error('invalid-send-statistics-cleanup')
    }
    return task
  }
  async function recover(): Promise<void> {
    let task = await pending()
    if (!task) return
    if (task.phase === 'rewrite') {
      const updates = await rewrite(task)
      task = { ...task, phase: 'remove' }
      await storage.set({ ...updates, [STATISTICS_REVISION_KEY]: { schemaVersion: 1, id: task.id }, [STATISTICS_CLEANUP_KEY]: persisted(task) })
    }
    // Repeating any batch is safe. The writer cannot append until recovery finishes.
    for (let start = 0; start < task.removeKeys.length; start += 128) {
      const keys = task.removeKeys.slice(start, start + 128)
      await storage.remove(keys)
      const remaining = await storage.get(keys)
      if (keys.some(key => remaining[key] !== undefined)) throw new Error('send-statistics-cleanup-incomplete')
    }
    await storage.remove(STATISTICS_CLEANUP_KEY)
    if (await pending()) throw new Error('send-statistics-cleanup-incomplete')
  }
  return {
    recover,
    async start(removeKeys: string[], replacement?: CleanupTask['rewrite']): Promise<void> {
      const task: CleanupTask = { schemaVersion: 1, id: crypto.randomUUID(), phase: 'rewrite', removeKeys,
        ...(replacement ? { rewrite: replacement } : {}) }
      // No logical or physical deletion starts until this durable intent is saved.
      await storage.set({ [STATISTICS_CLEANUP_KEY]: persisted(task) })
      await recover()
    },
    async revision(): Promise<string> {
      const values = await storage.get([STATISTICS_CLEANUP_KEY, STATISTICS_REVISION_KEY])
      if (values[STATISTICS_CLEANUP_KEY] !== undefined) throw new Error('send-statistics-cleaning')
      const revision = values[STATISTICS_REVISION_KEY] as { schemaVersion?: number; id?: string } | undefined
      if (revision === undefined) return 'legacy'
      if (revision.schemaVersion !== 1 || typeof revision.id !== 'string' || !idPattern.test(revision.id)) throw new Error('invalid-send-statistics-revision')
      return revision.id
    },
  }
}

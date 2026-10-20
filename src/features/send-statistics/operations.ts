import { ownedStatisticsKey, statisticsKeys, STATISTICS_CLEANUP_KEY, STATISTICS_REVISION_KEY, type StatisticsStorage } from './cleanup'

export interface StatisticsProgress { completed: number; total: number; unit: 'records' | 'days' }
export interface StatisticsOperation {
  signal?: AbortSignal
  onProgress?(progress: StatisticsProgress): void
}
export function checkpoint(operation: StatisticsOperation, progress?: StatisticsProgress): void {
  operation.signal?.throwIfAborted()
  if (progress) operation.onProgress?.(progress)
  operation.signal?.throwIfAborted()
}
/** Legacy arrays are already in memory; yield between chunks so Cancel can run. */
export async function yieldStatisticsOperation(operation: StatisticsOperation): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler
  if (scheduler?.yield) await scheduler.yield()
  else await new Promise<void>(resolve => setTimeout(resolve, 0))
  checkpoint(operation)
}
export interface StatisticsCapacity {
  statisticsBytes: number | null
  totalBytes: number | null
  quotaBytes: number | null
}
export async function statisticsCapacity(storage: StatisticsStorage): Promise<StatisticsCapacity> {
  const result: StatisticsCapacity = { statisticsBytes: null, totalBytes: null, quotaBytes: Number.isFinite(storage.QUOTA_BYTES) && storage.QUOTA_BYTES! > 0 ? storage.QUOTA_BYTES! : null }
  if (!storage.getBytesInUse) return result
  try {
    result.totalBytes = await storage.getBytesInUse(null)
    const keys = (await statisticsKeys(storage)).filter(key => ownedStatisticsKey(key) || key === STATISTICS_CLEANUP_KEY || key === STATISTICS_REVISION_KEY)
    result.statisticsBytes = keys.length ? await storage.getBytesInUse(keys) : 0
  } catch { /* Keep unavailable measurements distinct from zero bytes. */ }
  return result
}
/** Strictly before UTC midnight N calendar days ago, independent of local DST. */
export function statisticsAgeFilter(days: 30 | 90 | 180, now = Date.now()): { to: string } {
  const today = new Date(now).toISOString().slice(0, 10)
  return { to: new Date(Date.parse(today) - days * 86_400_000 - 1).toISOString().slice(0, 10) }
}

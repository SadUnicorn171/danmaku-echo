import { describe, expect, it, vi } from 'vitest'
import { statisticsAgeFilter, statisticsCapacity } from '../operations'
import { SEND_STATISTICS_INDEX_KEY } from '../types'

const storage = () => ({ get: vi.fn<() => Promise<Record<string, unknown>>>(async () => ({})), set: vi.fn<() => Promise<void>>(async () => {}), remove: vi.fn<() => Promise<void>>(async () => {}) })
describe('statistics capacity and UTC retention shortcuts', () => {
  it('uses native byte accounting and enumerates only on explicit capacity checks', async () => {
    const backend = { ...storage(), QUOTA_BYTES: 1000, getKeys: vi.fn<() => Promise<string[]>>(async () => [SEND_STATISTICS_INDEX_KEY, 'favorite']), getBytesInUse: vi.fn<(keys: string[] | null) => Promise<number>>(async (keys: string[] | null) => keys ? 100 : 960) }
    expect(await statisticsCapacity(backend)).toEqual({ statisticsBytes: 100, totalBytes: 960, quotaBytes: 1000 })
    expect(backend.getBytesInUse).toHaveBeenLastCalledWith([SEND_STATISTICS_INDEX_KEY])
    expect(backend.get).not.toHaveBeenCalled()
  })
  it('keeps missing capacity unavailable, with a compatibility key scan only when requested', async () => {
    expect(await statisticsCapacity(storage())).toEqual({ statisticsBytes: null, totalBytes: null, quotaBytes: null })
    const backend = { ...storage(), getBytesInUse: vi.fn<() => Promise<number>>(async () => 50) }
    await statisticsCapacity(backend)
    expect(backend.get).toHaveBeenCalledWith(null)
  })
  it('excludes the UTC cutoff date and remains stable across local timezone and DST changes', () => {
    expect(statisticsAgeFilter(30, Date.parse('2026-04-01T00:00:00Z'))).toEqual({ to: '2026-03-01' })
    expect(statisticsAgeFilter(30, Date.parse('2026-04-01T23:59:59Z'))).toEqual({ to: '2026-03-01' })
  })
})

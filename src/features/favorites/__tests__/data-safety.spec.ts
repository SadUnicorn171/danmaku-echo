import { describe, expect, it } from 'vitest'
import { createFavoritesRepository, exportFavoritesData, importFavoritesData, previewFavoritesImport } from '../repository'
import { FAVORITES_STORAGE_KEY, FAVORITES_BACKUP_STORAGE_KEY, FAVORITES_IMPORT_BACKUP_STORAGE_KEY } from '../types'

function memory(initial: Record<string, unknown> = {}) {
  const data = structuredClone(initial)
  const area = {
    get(keys: string[], callback: (value: Record<string, unknown>) => void) { callback(structuredClone(Object.fromEntries(keys.map((key) => [key, data[key]])))) },
    set(values: Record<string, unknown>, callback: () => void) { Object.assign(data, structuredClone(values)); callback() },
  } as unknown as Pick<chrome.storage.StorageArea, 'get' | 'set'>
  return { data, area }
}
const bundle = (items: { id: string; text: string }[]) => ({ format: 'danmaku-echo-favorites', schemaVersion: 1, database: { schemaVersion: 1, items } })

describe('favorite data compatibility and recovery', () => {
  it('never falls back and overwrites a newer database or imports a newer backup', async () => {
    const future = { schemaVersion: 999, items: [] }
    const { area, data } = memory({ [FAVORITES_STORAGE_KEY]: future, [FAVORITES_BACKUP_STORAGE_KEY]: { schemaVersion: 2, items: [] } })
    await expect(createFavoritesRepository(area).load()).rejects.toThrow('版本')
    await expect(importFavoritesData(area, { ...bundle([]), schemaVersion: 999 })).rejects.toThrow('版本')
    expect(data[FAVORITES_STORAGE_KEY]).toEqual(future)
  })
  it('previews changes without writes, rejects stale previews and restores pre-import data', async () => {
    const { area, data } = memory()
    await importFavoritesData(area, bundle([{ id: 'keep', text: '保留' }, { id: 'remove', text: '删除' }]))
    const incoming = bundle([{ id: 'keep', text: '修改' }, { id: 'new', text: '新增' }])
    const before = JSON.stringify(data)
    const preview = await previewFavoritesImport(area, incoming)
    expect(preview).toMatchObject({ added: 1, changed: 1, removed: 1, total: 2 })
    expect(JSON.stringify(data)).toBe(before)
    const repository = createFavoritesRepository(area)
    await expect(repository.importData(incoming, preview.revision - 1)).rejects.toThrow('已变化')
    await repository.importData(incoming, preview.revision)
    expect(data[FAVORITES_IMPORT_BACKUP_STORAGE_KEY]).toBeDefined()
    await repository.restoreBeforeImport()
    expect((await exportFavoritesData(area)).database.items.map((item) => item.text)).toEqual(['保留', '删除'])
  })
})

import { describe, expect, it } from 'vitest'
import { applySettingsPatch, createSettingsWriter, diffSettings } from '../settings-persistence'
import { mergeSettings } from '../shared'

describe('settings field writes', () => {
  it('merges edits from stale pages without losing sibling fields or future fields', async () => {
    let values: Record<string, unknown> = { actions: { copy: true, reply: true, future: 'keep' }, futureSetting: 42 }
    const storage = {
      get: async () => structuredClone(values),
      set: async (patch: Record<string, unknown>) => { values = { ...values, ...patch } },
    } as unknown as Pick<chrome.storage.StorageArea, 'get' | 'set'>
    const write = createSettingsWriter(storage)
    const first = mergeSettings(values)
    const second = mergeSettings(values)
    const original = mergeSettings(values)
    first.actions.copy = false
    second.actions.reply = false
    await Promise.all([write(diffSettings(original, first)), write(diffSettings(original, second))])
    expect(values).toMatchObject({ actions: { copy: false, reply: false, future: 'keep' }, futureSetting: 42 })
    await write([{ path: ['settingsLanguage'], value: 'en' }])
    expect(values.settingsLanguage).toBe('en')
  })

  it('rejects unknown and prototype paths and normalizes known numeric fields', () => {
    expect(() => applySettingsPatch({}, [{ path: ['__proto__', 'polluted'], value: true }])).toThrow('invalid-settings-patch')
    expect(() => applySettingsPatch({}, [{ path: ['unknown'], value: true }])).toThrow('invalid-settings-patch')
    expect(() => applySettingsPatch({}, [{ path: ['enabled'], value: 'bad' }])).toThrow('invalid-settings-patch')
    const result = applySettingsPatch({}, [{ path: ['repeatReminder', 'manual', 'douyin', 'queueLimit'], value: 10000 }])
    expect(mergeSettings(result).repeatReminder.manual.douyin.queueLimit).toBeLessThan(10000)
  })
})

import { DEFAULT_SETTINGS, mergeSettings } from './shared'

export const SETTINGS_PATCH_MESSAGE = 'danmaku-echo.settings-patch'
export interface SettingsPatch { path: string[]; value: string | number | boolean }
const blocked = new Set(['__proto__', 'prototype', 'constructor'])
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function diffSettings(before: unknown, after: unknown, path: string[] = []): SettingsPatch[] {
  if (record(before) && record(after)) return Object.keys(after).flatMap((key) =>
    blocked.has(key) ? [] : diffSettings(before[key], after[key], [...path, key]))
  if (before === after || !['string', 'number', 'boolean'].includes(typeof after)) return []
  return [{ path, value: after as SettingsPatch['value'] }]
}

function at(value: unknown, path: string[]): unknown {
  for (const key of path) value = record(value) ? value[key] : undefined
  return value
}

export function applySettingsPatch(value: unknown, changes: SettingsPatch[]): Record<string, unknown> {
  const result: Record<string, unknown> = record(value) ? structuredClone(value) : {}
  const template = { ...DEFAULT_SETTINGS, settingsLanguage: 'zh-CN' }
  for (const change of changes) {
    if (!change || !Array.isArray(change.path) || !change.path.length || change.path.length > 6
      || change.path.some((key) => typeof key !== 'string' || blocked.has(key))
      || !['string', 'number', 'boolean'].includes(typeof change.value)
      || typeof at(template, change.path) !== typeof change.value
      || (typeof change.value === 'number' && !Number.isFinite(change.value))) {
      throw new Error('invalid-settings-patch')
    }
    let node = result
    for (const key of change.path.slice(0, -1)) {
      if (!record(node[key])) node[key] = {}
      node = node[key] as Record<string, unknown>
    }
    node[change.path.at(-1)!] = change.value
  }
  // Normalize only edited leaves while preserving unknown fields from newer versions.
  const normalized = { ...mergeSettings(result), settingsLanguage: result.settingsLanguage === 'en' ? 'en' : 'zh-CN' }
  for (const change of changes) {
    let node = result
    for (const key of change.path.slice(0, -1)) node = node[key] as Record<string, unknown>
    node[change.path.at(-1)!] = at(normalized, change.path)
  }
  return result
}

export function createSettingsWriter(storage: Pick<chrome.storage.StorageArea, 'get' | 'set'>) {
  let tail: Promise<unknown> = Promise.resolve()
  return (changes: SettingsPatch[]): Promise<void> => {
    if (!Array.isArray(changes) || changes.length > 200) return Promise.reject(new Error('invalid-settings-patch'))
    const task = tail.then(async () => {
      const current = await storage.get(null)
      const next = applySettingsPatch(current, changes)
      const keys = [...new Set(changes.map((change) => change.path[0]!))]
      await storage.set(Object.fromEntries(keys.map((key) => [key, next[key]])))
    })
    tail = task.catch(() => {})
    return task
  }
}

export async function saveSettingsPatch(changes: SettingsPatch[]): Promise<void> {
  if (!changes.length) return
  const result = await chrome.runtime.sendMessage({ type: SETTINGS_PATCH_MESSAGE, changes })
  if (!result?.ok) throw new Error('settings-save-failed')
}

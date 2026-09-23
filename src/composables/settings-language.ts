import { ref } from 'vue'
import english from '../../public/_locales/en/messages.json'
import chinese from '../../public/_locales/zh_CN/messages.json'

export type SettingsLanguage = 'zh-CN' | 'en'
export const settingsLanguage = ref<SettingsLanguage>('zh-CN')

export function normalizeSettingsLanguage(value: unknown): SettingsLanguage {
  return value === 'en' ? 'en' : 'zh-CN'
}

interface Message {
  message: string
  placeholders?: Record<string, { content: string }>
}

// Settings use an explicit preference; Chrome's getMessage cannot select a locale.
// Keep these dictionaries in the settings bundle, outside the live-page runtime.
export function t(key: string, substitutions?: string | string[]): string {
  const messages: Record<string, Message> = settingsLanguage.value === 'en' ? english : chinese
  const entry = messages[key]
  if (!entry) return key
  const values = Array.isArray(substitutions) ? substitutions : [substitutions ?? '']
  const substitute = (value: string) =>
    value.replace(/\$(\d+)/g, (_match, index: string) => values[Number(index) - 1] ?? '')
  return entry.message.replace(/\$([a-z_][\w]*|\d+)\$?/gi, (_match, name: string) => {
    if (/^\d+$/.test(name)) return values[Number(name) - 1] ?? ''
    return substitute(entry.placeholders?.[name.toLowerCase()]?.content ?? '')
  })
}

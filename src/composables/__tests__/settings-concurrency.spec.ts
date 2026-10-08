import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { useSettings } from '../useSettings'
import { createSettingsWriter, type SettingsPatch } from '../../core/settings-persistence'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function setup() {
  let values: Record<string, unknown> = { actions: { copy: true, reply: true } }
  const listeners = new Set<(changes: object, area: string) => void>()
  let fail = false
  const sync = {
    get(_keys: unknown, callback?: (data: unknown) => void) {
      const data = structuredClone(values)
      callback?.(data)
      return Promise.resolve(data)
    },
    async set(patch: object) {
      if (fail) throw new Error('storage unavailable')
      values = { ...values, ...structuredClone(patch) }
      listeners.forEach(listener => listener({}, 'sync'))
    },
  }
  const write = createSettingsWriter(sync as unknown as chrome.storage.StorageArea)
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: async (request: { changes: SettingsPatch[] }) => {
      try { await write(request.changes); return { ok: true } } catch { return { ok: false } }
    } },
    storage: { sync, onChanged: { addListener: (listener: (changes: object, area: string) => void) => listeners.add(listener), removeListener: (listener: (changes: object, area: string) => void) => listeners.delete(listener) } },
  })
  function page() {
    let settings!: ReturnType<typeof useSettings>
    const wrapper = mount(defineComponent({ setup() { settings = useSettings(); return () => null } }))
    return { settings, wrapper }
  }
  return { page, values: () => values, setFail: (value: boolean) => { fail = value } }
}

describe('settings page concurrency', () => {
  it('preserves sibling edits from two open pages', async () => {
    const fixture = setup()
    const a = fixture.page(); const b = fixture.page()
    a.settings.settings.actions.copy = false
    b.settings.settings.actions.reply = false
    a.settings.save(); b.settings.save()
    await flushPromises()
    expect(fixture.values()).toMatchObject({ actions: { copy: false, reply: false } })
    expect(a.settings.settings.actions.reply).toBe(false)
    expect(b.settings.settings.actions.copy).toBe(false)
    a.wrapper.unmount(); b.wrapper.unmount()
  })
  it('keeps the last choice when a switch is toggled twice before its first write resolves', async () => {
    const fixture = setup()
    const { settings, wrapper } = fixture.page()
    settings.settings.actions.copy = false; settings.save()
    settings.settings.actions.copy = true; settings.save()
    await flushPromises()
    expect(fixture.values()).toMatchObject({ actions: { copy: true } })
    expect(settings.settings.actions.copy).toBe(true)
    wrapper.unmount()
  })
  it('keeps a failed draft available for retry', async () => {
    const fixture = setup()
    const { settings, wrapper } = fixture.page()
    fixture.setFail(true)
    settings.settings.actions.copy = false; settings.save()
    await flushPromises()
    expect(settings.statusKind.value).toBe('error')
    expect(settings.settings.actions.copy).toBe(false)
    fixture.setFail(false)
    settings.save()
    await flushPromises()
    expect(fixture.values()).toMatchObject({ actions: { copy: false } })
    wrapper.unmount()
  })
})

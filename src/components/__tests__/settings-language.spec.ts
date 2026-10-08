import { applySettingsPatch, type SettingsPatch } from '../../core/settings-persistence'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '../../App.vue'
import { normalizeSettingsLanguage, settingsLanguage, t } from '../../composables/settings-language'

vi.mock('../../composables/useSectionNavigation', async () => {
  const { ref } = await import('vue')
  return {
    useSectionNavigation: () => ({
      activeSection: ref('general-settings'),
      contentCanvas: ref(null),
      scrollToSection: vi.fn<() => void>(),
    }),
  }
})

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  settingsLanguage.value = 'zh-CN'
  vi.unstubAllGlobals()
})

function storage(saved: Record<string, unknown> = {}, fail = false) {
  const runtime: { lastError?: { message: string } } = {}
  const set = vi.fn<(value: Record<string, unknown>, callback: () => void) => void>(
    (value: Record<string, unknown>, callback: () => void) => {
      if (fail) runtime.lastError = { message: 'storage unavailable' }
      else Object.assign(saved, value)
      callback()
      delete runtime.lastError
    },
  )
  vi.stubGlobal('chrome', {
    i18n: { getUILanguage: () => 'en', getMessage: () => 'browser translation' },
    runtime: { ...runtime, sendMessage: async (request: { changes: SettingsPatch[] }) => {
      if (fail) return { ok: false }
      Object.assign(saved, applySettingsPatch(saved, request.changes))
      return { ok: true }
    } },
    storage: {
      sync: { get: (_key: unknown, callback: (value: unknown) => void) => callback(saved), set },
      onChanged: { addListener: vi.fn<() => void>(), removeListener: vi.fn<() => void>() },
    },
  })
  return { saved, set }
}

describe('settings language preference', () => {
  it('saves independent Douyin filters and translates their labels without resetting them', async () => {
    const { saved } = storage({ douyinNativeSettings: { futureOption: 'keep' } })
    wrapper = shallowMount(App, { global: { stubs: { SettingsSidebar: false, SettingSwitch: false } } })
    await flushPromises()
    expect(wrapper.get('#douyin-native-settings').text()).toContain('自动关闭送礼信息')
    for (const id of ['douyin-hide-gift-messages', 'douyin-hide-lucky-bag', 'douyin-block-gift-effects']) {
      expect((wrapper.get(`#${id}`).element as HTMLInputElement).checked).toBe(false)
      await wrapper.get(`#${id}`).setValue(true)
      await flushPromises()
    }
    await wrapper.get('.language-switch button[lang="en"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('#douyin-native-settings').text()).toContain('Automatically hide gift messages')
    await wrapper.get('#douyin-hide-gift-messages').setValue(false)
    await flushPromises()
    expect(saved.douyinNativeSettings).toEqual({
      futureOption: 'keep', hideGiftMessages: false, hideLuckyBagCommands: true, blockGiftEffects: true,
    })
  })

  it('defaults to Chinese independently of the browser and switches existing content without remounting', async () => {
    const { saved } = storage({ enabled: false })
    wrapper = shallowMount(App, { global: { stubs: { SettingsSidebar: false } } })
    const root = wrapper.element
    expect(wrapper.text()).toContain('常规设置')
    expect(t('settingsRepeatReminderAutoPlusOne')).toBe('自动 +1 雷达弹幕')
    await wrapper.get('.language-switch button[lang="en"]').trigger('click')
    await flushPromises()
    expect(wrapper.element).toBe(root)
    expect(wrapper.text()).toContain('General')
    expect(wrapper.get('#repeat-reminder-tab-bilibili').text()).toBe('Bilibili')
    expect(t('settingsRepeatReminderAutoPlusOne')).toBe('Automatically +1 radar danmaku')
    expect(document.documentElement.lang).toBe('en')
    expect(saved.settingsLanguage).toBe('en')
    expect(saved.enabled).toBe(false)
    wrapper.unmount()
    wrapper = shallowMount(App)
    await nextTick()
    expect(wrapper.text()).toContain('Interaction features')
    expect(settingsLanguage.value).toBe('en')
  })

  it('restores the previous language and reports failed persistence', async () => {
    storage({}, true)
    wrapper = shallowMount(App, { global: { stubs: { SettingsSidebar: false } } })
    await wrapper.get('.language-switch button[lang="en"]').trigger('click')
    await flushPromises()
    expect(settingsLanguage.value).toBe('zh-CN')
    expect(wrapper.text()).toContain('保存失败')
  })

  it('normalizes missing or invalid preferences and substitutes named placeholders literally', () => {
    expect(normalizeSettingsLanguage(undefined)).toBe('zh-CN')
    expect(normalizeSettingsLanguage('fr')).toBe('zh-CN')
    settingsLanguage.value = 'en'
    expect(t('settingsFeedbackCopied', '$2@example.com')).toBe(
      'Feedback email copied: $2@example.com',
    )
    expect(t('missing-key')).toBe('missing-key')
  })
})

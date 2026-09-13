import { afterEach, describe, expect, it, vi } from 'vitest'
import { shallowMount, type VueWrapper } from '@vue/test-utils'
import App from '../../App.vue'

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
  wrapper = undefined
})

describe('settings size mode and radar threshold independence', () => {
  it('keeps general radar inputs editable in auto mode and preserves them across switches', async () => {
    wrapper = shallowMount(App)
    expect(wrapper.find('#repeat-reminder-threshold-bilibili').exists()).toBe(false)
    const duration = wrapper.get('#repeat-reminder-prompt-duration-bilibili')
    expect(duration.attributes('disabled')).toBeUndefined()
    await duration.setValue(21)
    await wrapper.get('#repeat-reminder-queue-limit-bilibili').setValue(7)
    await wrapper.get('#repeat-reminder-prompt-scale-bilibili').setValue(125)
    await wrapper.get('input[name="repeat-reminder-mode"][value="manual"]').setValue(true)
    expect(wrapper.find('#repeat-reminder-threshold-bilibili').exists()).toBe(true)
    expect(
      (wrapper.get('#repeat-reminder-prompt-duration-bilibili').element as HTMLInputElement).value,
    ).toBe('21')
    await wrapper.get('input[name="repeat-reminder-mode"][value="auto"]').setValue(true)
    expect(
      (wrapper.get('#repeat-reminder-queue-limit-bilibili').element as HTMLInputElement).value,
    ).toBe('7')
    await wrapper.get('input[name="interface-scale-mode"][value="auto"]').setValue(true)
    expect(
      (wrapper.get('#repeat-reminder-prompt-scale-bilibili').element as HTMLInputElement).value,
    ).toBe('125')
    expect(
      wrapper.get('#repeat-reminder-prompt-scale-bilibili').attributes('disabled'),
    ).toBeUndefined()
    expect(
      (wrapper.get('input[name="repeat-reminder-mode"][value="auto"]').element as HTMLInputElement)
        .checked,
    ).toBe(true)
    await wrapper.get('#repeat-reminder-tab-douyin').trigger('click')
    expect(
      (wrapper.get('#repeat-reminder-prompt-duration-douyin').element as HTMLInputElement).value,
    ).toBe('10')
  })
})

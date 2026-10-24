import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import AnimatedCount from '../AnimatedCount.vue'
import { setPerformanceMode } from '../../core/ui-motion'

afterEach(() => {
  setPerformanceMode(false)
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it('renders initial truth, interpolates updates, and settles immediately when motion is disabled', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 10,
    bottom: 30,
  } as DOMRect)
  const wrapper = mount(AnimatedCount, { props: { value: 0, ready: false } })
  await wrapper.setProps({ value: 100, ready: true })
  expect(wrapper.text()).toBe('100')
  await wrapper.setProps({ value: 200 })
  await vi.advanceTimersByTimeAsync(100)
  expect(Number(wrapper.text())).toBeGreaterThan(100)
  expect(Number(wrapper.text())).toBeLessThan(200)
  expect(wrapper.attributes('aria-label')).toBe('200')
  setPerformanceMode(true)
  await wrapper.setProps({ value: 300 })
  expect(wrapper.text()).toBe('300')
  wrapper.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

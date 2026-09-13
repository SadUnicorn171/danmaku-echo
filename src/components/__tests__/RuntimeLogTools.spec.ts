import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import RuntimeLogTools from '../RuntimeLogTools.vue'
import { LOG_MESSAGE } from '../../core/runtime-log'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('runtime log tools', () => {
  it('exports JSON and clears only through the background log service', async () => {
    vi.useFakeTimers()
    const sendMessage = vi
      .fn<(message: unknown) => Promise<unknown>>()
      .mockResolvedValue({ ok: true, data: { entries: [{ message: 'failure' }] } })
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:logs')
    const revokeObjectURL = vi.fn<(url: string) => void>()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const wrapper = mount(RuntimeLogTools)
    await wrapper.findAll('button')[0]!.trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    expect(sendMessage).toHaveBeenCalledWith({ type: LOG_MESSAGE, action: 'export' })
    expect(createObjectURL.mock.calls[0]?.length).toBe(1)
    expect(document.querySelector('a[download]')).toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:logs')
    await wrapper.findAll('button')[1]!.trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    expect(sendMessage).toHaveBeenLastCalledWith({ type: LOG_MESSAGE, action: 'clear' })
    expect(wrapper.emitted('status')?.at(-1)?.[1]).toBe('saved')
    wrapper.unmount()
  })

  it('reports failed exports without claiming success or leaving controls disabled', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi
          .fn<(message: unknown) => Promise<unknown>>()
          .mockResolvedValue({ ok: false }),
      },
    })
    const wrapper = mount(RuntimeLogTools)
    await wrapper.findAll('button')[0]!.trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.emitted('status')?.at(-1)?.[1]).toBe('error')
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
})

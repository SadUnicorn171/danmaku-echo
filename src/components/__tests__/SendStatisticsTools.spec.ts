import { createSendStatisticsStore } from '../../features/send-statistics/store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SendStatisticsTools from '../SendStatisticsTools.vue'
import { settingsLanguage } from '../../composables/settings-language'
import { SEND_STATISTICS_DAY_PREFIX, SEND_STATISTICS_INDEX_KEY, type StatisticsFilter } from '../../features/send-statistics/types'

function storage(initial: Record<string, unknown> = {}, workerAvailable = false) {
  const values = new Map<string, unknown>(Object.entries(initial))
  const local = {
    get: vi.fn<(keys: string | string[] | null) => Promise<Record<string, unknown>>>(async (keys) => Object.fromEntries((keys === null ? [...values.keys()] : Array.isArray(keys) ? keys : [keys]).map((key) => [key, values.get(key)]))),
    set: vi.fn<(items: Record<string, unknown>) => Promise<void>>(async (items) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value)
    }),
    remove: vi.fn<(keys: string | string[]) => Promise<void>>(async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key)
    }),
  }
  const writer = createSendStatisticsStore(local)
  const sendMessage = vi.fn<(request: { filter?: StatisticsFilter }) => Promise<{ ok: boolean }>>(async (request) => {
    if (!workerAvailable) throw new Error('worker unavailable')
    await writer.clear(request.filter); return { ok: true }
  })
  vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { local } })
  return { local, sendMessage, values }
}

afterEach(() => {
  settingsLanguage.value = 'zh-CN'
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('send statistics settings', () => {
  it('pages through history and applies the same filter to details and deletion', async () => {
    const { local, sendMessage } = storage({}, true)
    const writer = createSendStatisticsStore(local)
    for (let i = 0; i < 120; i++) await writer.append({
      id: `paging-attempt-${String(i).padStart(4, '0')}`,
      platform: 'huya', roomId: 'room-66', sentAtSec: 1_800_000_000 + i,
      text: [60, 62, 64].includes(i) ? '查找目标' : `文本 ${i}`, confirmation: 'platform',
    })
    const wrapper = mount(SendStatisticsTools)
    await flushPromises()
    expect(wrapper.findAll('.send-statistics-text')).toHaveLength(50)
    expect(wrapper.text()).toContain('平台响应确认')
    await wrapper.findAll('.send-statistics-pagination button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.send-statistics-text')).toHaveLength(50)
    expect(wrapper.find('.send-statistics-text').text()).toBe('文本 69')
    await wrapper.findAll('.send-statistics-pagination button')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.send-statistics-text').text()).toBe('文本 119')
    await wrapper.findAll('input[type="search"]')[1]!.setValue('查找目标')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.findAll('.send-statistics-text')).toHaveLength(3)
    expect(wrapper.findAll('.send-statistics-pagination button')[1]!.attributes('disabled')).toBeDefined()
    expect(wrapper.find('.send-statistics-summary b').text()).toBe('120')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await wrapper.findAll('.send-statistics-actions button')[2]!.trigger('click')
    await flushPromises()
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'clear', filter: expect.objectContaining({ text: '查找目标' }) }))
    expect(wrapper.findAll('.send-statistics-text')).toHaveLength(0)
    expect((await writer.read())).toHaveLength(117)
    wrapper.unmount()
  })
  it('returns to page one after another settings page clears history', async () => {
    const { local } = storage({}, true)
    const writer = createSendStatisticsStore(local)
    for (let i = 0; i < 61; i++) await writer.append({ id: `cursor-ui-test-${i}`, platform: 'huya', roomId: '123', sentAtSec: 1_800_000_000 + i, text: `row:${i}:` })
    const wrapper = mount(SendStatisticsTools)
    await flushPromises()
    await writer.clear({ text: 'row:0:' })
    await wrapper.findAll('.send-statistics-pagination button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.send-statistics-text').text()).toBe('row:60:')
    expect(wrapper.find('.send-statistics-pagination').text()).toContain('第 1 页')
    expect(wrapper.emitted('status')?.at(-1)?.[0]).toContain('记录已变化')
    wrapper.unmount()
  })

  it('explains why statistics are unavailable in a plain development preview', async () => {
    vi.stubGlobal('chrome', undefined)
    const wrapper = mount(SendStatisticsTools)
    await flushPromises()
    expect(wrapper.text()).toContain('请在已安装扩展的设置页查看发送统计')
    expect(wrapper.emitted('status')).toBeUndefined()
    wrapper.unmount()
  })

  it('reads local statistics but preserves them when clearing cannot reach the writer', async () => {
    const second = 1_800_000_000
    const date = new Date(second * 1_000).toISOString().slice(0, 10)
    const event = { id: 'test-attempt-1234', platform: 'huya', roomId: '123', sentAtSec: second }
    const { local, sendMessage, values } = storage({
      [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: [date] },
      [SEND_STATISTICS_DAY_PREFIX + date]: { schemaVersion: 1, date, events: [event] },
    })
    const wrapper = mount(SendStatisticsTools)
    await flushPromises()
    expect(wrapper.find('.send-statistics-summary b').text()).toBe('1')
    expect(wrapper.find('.send-statistics-recent').text()).toContain('×1')
    expect(wrapper.find('.send-statistics-text').text()).toBe('旧记录未保存正文')
    expect(sendMessage).not.toHaveBeenCalled()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await wrapper.findAll('.send-statistics-actions button')[2]!.trigger('click')
    await flushPromises()
    expect(local.remove).not.toHaveBeenCalled()
    expect(values.has(SEND_STATISTICS_INDEX_KEY)).toBe(true)
    expect(wrapper.find('.send-statistics-summary b').text()).toBe('1')
    expect(wrapper.emitted('status')?.at(-1)?.[0]).toContain('未清理记录')
    wrapper.unmount()
  })

  it('displays every message in a second as literal text and distinguishes empty from legacy text', async () => {
    const second = 1_800_000_000
    const date = new Date(second * 1_000).toISOString().slice(0, 10)
    const base = { platform: 'huya', roomId: '123', sentAtSec: second }
    const message = '<img src="https://example.com/test.png">你好 👋[微笑]'
    storage({
      [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: [date] },
      [SEND_STATISTICS_DAY_PREFIX + date]: { schemaVersion: 1, date, events: [
        { ...base, id: 'test-attempt-0001', text: message },
        { ...base, id: 'test-attempt-0002', text: '' },
        { ...base, id: 'test-attempt-0003' },
      ] },
    })
    const wrapper = mount(SendStatisticsTools)
    await flushPromises()
    expect(wrapper.find('.send-statistics-recent b').text()).toBe('×3')
    expect(wrapper.findAll('.send-statistics-text').map((node) => node.text()))
      .toEqual(['旧记录未保存正文', '无文本内容', message])
    expect(wrapper.find('img').exists()).toBe(false)
    settingsLanguage.value = 'en'
    await flushPromises()
    expect(wrapper.text()).toContain('No text content')
    expect(wrapper.text()).toContain('Text was not saved for this older record')
    wrapper.unmount()
  })

  it('reports an invalid stored schema instead of a generic retry error', async () => {
    storage({ [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 2, days: [] } })
    const wrapper = mount(SendStatisticsTools)
    await flushPromises()
    expect(wrapper.emitted('status')?.[0]).toEqual([
      '发送统计数据格式异常，原始数据已保留；请检查本地存储或反馈此问题', 'error',
    ])
    wrapper.unmount()
  })

  it('shows readable days and warns about missing day shards without deleting data', async () => {
    const second = 1_800_000_000
    const date = new Date(second * 1_000).toISOString().slice(0, 10)
    const event = { id: 'test-attempt-5678', platform: 'douyu', roomId: '456', sentAtSec: second }
    const { values } = storage({
      [SEND_STATISTICS_INDEX_KEY]: { schemaVersion: 1, days: [date, '2027-01-01'] },
      [SEND_STATISTICS_DAY_PREFIX + date]: { schemaVersion: 1, date, events: [event] },
    })
    const wrapper = mount(SendStatisticsTools)
    await flushPromises()
    expect(wrapper.find('.send-statistics-summary b').text()).toBe('1')
    expect(wrapper.find('.send-statistics-warning').text()).toContain('1 天')
    expect(values.has(SEND_STATISTICS_INDEX_KEY)).toBe(true)
    wrapper.unmount()
  })
})

describe('statistics capacity controls', () => {
  it.each([.81, .96])('shows the appropriate quota warning at %s and applies the UTC age shortcut to all platforms', async ratio => {
    const { local, sendMessage } = storage({}, true)
    Object.assign(local, { QUOTA_BYTES: 1000000, getBytesInUse: vi.fn<(keys: string[] | null) => Promise<number>>(async (keys: string[] | null) => keys ? 10000 : 1000000 * ratio) })
    const wrapper = mount(SendStatisticsTools)
    await flushPromises()
    expect(wrapper.find('.send-statistics-capacity').text()).toContain(ratio > .95 ? '95%' : '80%')
    expect(wrapper.find('.send-statistics-warning').classes().includes('is-critical')).toBe(ratio > .95)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await wrapper.find('.send-statistics-capacity button').trigger('click')
    await flushPromises()
    expect(confirm.mock.calls[0]?.[0]).toContain('与当前筛选无关')
    const to = new Date(Date.parse(new Date().toISOString().slice(0, 10)) - 30 * 86400000 - 1).toISOString().slice(0, 10)
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'clear', filter: { to } }))
    wrapper.unmount()
  })

  it('offers cancel during a text scan and releases the busy state without changing stored records', async () => {
    const { local, values } = storage()
    const writer = createSendStatisticsStore(local)
    for (let i = 0; i < 150; i++) await writer.append({ id: `cancel-ui-test-${i}`, platform: 'huya', roomId: 'test', sentAtSec: 1800000000 + i, text: 'fixture' })
    const wrapper = mount(SendStatisticsTools)
    await flushPromises()
    const get = local.get.getMockImplementation()!
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    local.get.mockImplementation(async keys => {
      if (Array.isArray(keys) && keys.some(k => k.includes('EventV2:'))) await gate
      return get(keys)
    })
    const before = JSON.stringify([...values])
    await wrapper.findAll('input[type="search"]')[1]!.setValue('absent')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.send-statistics-progress').exists()).toBe(true)
    await wrapper.find('.send-statistics-progress button').trigger('click')
    release()
    await flushPromises()
    expect(wrapper.find('.send-statistics-progress').exists()).toBe(false)
    expect(wrapper.emitted('status')?.at(-1)?.[0]).toContain('已取消')
    expect(JSON.stringify([...values])).toBe(before)
    wrapper.unmount()
  })
})

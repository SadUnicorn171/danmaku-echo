import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import FavoritesLauncher from '../FavoritesLauncher.vue'
import FavoriteItemRow from '../FavoriteItemRow.vue'
import type { FavoritesLauncherState } from '../launcher'
import type { FavoriteDisplayItem } from '../types'

describe('large favorites lists', () => {
  it('renders 50 rows at first, adds the next batch and resets after a search change', async () => {
    const items: FavoriteDisplayItem[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `favorite-${i}`, text: `弹幕 ${i}`, normalizedText: `弹幕 ${i}`,
      payload: { text: `弹幕 ${i}`, plainText: `弹幕 ${i}`, assets: [], parts: [] }, origins: [], roomStats: {},
      tags: [], createdAt: i, updatedAt: i, lastSentAt: 0, totalSendCount: 0, globalPinned: false,
      belongsToCurrentRoom: true, customOrder: i, pinned: false, sourceLabel: '', sortTimestamp: i,
    }))
    const state: FavoritesLauncherState = {
      items, groups: [], currentCount: items.length, otherCount: 0, totalCount: items.length,
      mode: 'panel', loading: false, search: '', sort: 'custom', view: 'current', selectedRoomKey: '',
      room: { roomId: '123', roomKey: 'huya:123', roomName: '测试直播间', platform: 'huya', url: 'https://www.huya.com/123' },
      centerX: 0, centerY: 0, radialOptions: [], radialGazeAngle: 0, radialGazeX: 0, radialGazeY: 0, selectedRadialKey: '',
    }
    const wrapper = mount(FavoritesLauncher, { props: { state }, global: { stubs: { FavoriteItemRow: true } } })
    await flushPromises()
    expect(wrapper.findAll('favorite-item-row-stub')).toHaveLength(50)
    await wrapper.find('.bcp-favorites-load-more').trigger('click')
    expect(wrapper.findAll('favorite-item-row-stub')).toHaveLength(100)
    expect(wrapper.findAllComponents(FavoriteItemRow).slice(0, 9).map(row => row.props('shortcutIndex')))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    await wrapper.setProps({ state: { ...state, search: '弹幕', items: items.slice(0, 60) } })
    expect(wrapper.findAll('favorite-item-row-stub')).toHaveLength(50)
    await wrapper.find('.bcp-favorites-load-more').trigger('click')
    expect(wrapper.findAll('favorite-item-row-stub')).toHaveLength(60)
    expect(wrapper.find('.bcp-favorites-load-more').exists()).toBe(false)
    wrapper.unmount()
  })
})

import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import { useFavoritesMotion } from '../use-favorites-motion'
import { setPerformanceMode } from '../../../core/ui-motion'
import type { FavoritesLauncherState } from '../launcher'
import type { FavoriteDisplayItem } from '../types'

function item(id: string) {
  return { id } as FavoriteDisplayItem
}
afterEach(() => {
  setPerformanceMode(false)
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it('animates only affected visible rows, caps appended entrances, and skips work in performance mode', async () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const animate = vi.fn<() => Animation>(
    () =>
      ({
        finished: new Promise<void>(() => {}),
        cancel: vi.fn<() => void>(),
      }) as unknown as Animation,
  )
  vi.stubGlobal('Animation', class {})
  const originalAnimate = HTMLElement.prototype.animate
  HTMLElement.prototype.animate = animate
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const index = this.dataset.motionId ? Array.from(this.parentElement!.children).indexOf(this) : 0
    return {
      top: index * 20,
      bottom: this.dataset.motionId ? index * 20 + 20 : 1000,
      left: 0,
      right: 500,
    } as DOMRect
  })
  const state = reactive({
    mode: 'panel',
    view: 'current',
    search: '',
    selectedRoomKey: '',
    items: [item('a'), item('b')],
    groups: [],
  } as unknown as FavoritesLauncherState)
  const wrapper = mount(
    defineComponent({
      setup() {
        const panel = ref<HTMLElement | null>(null)
        useFavoritesMotion(() => state, panel, ref(50))
        return () =>
          h(
            'section',
            { ref: panel },
            h(
              'ol',
              { role: 'tabpanel' },
              state.items.map((row) => h('li', { key: row.id, 'data-motion-id': row.id }, row.id)),
            ),
          )
      },
    }),
    { attachTo: document.body },
  )
  state.items = [item('b'), item('a')]
  await flushPromises()
  expect(animate).toHaveBeenCalledTimes(2)
  animate.mockClear()
  state.items = [...state.items, ...Array.from({ length: 10 }, (_, index) => item(`new-${index}`))]
  await flushPromises()
  expect(animate).toHaveBeenCalledTimes(6)
  animate.mockClear()
  setPerformanceMode(true)
  state.items = [...state.items].reverse()
  await flushPromises()
  expect(animate).not.toHaveBeenCalled()
  wrapper.unmount()
  HTMLElement.prototype.animate = originalAnimate
  vi.unstubAllGlobals()
})

it('restores the originating room scroll and focus after detail navigation', async () => {
  setPerformanceMode(true)
  const state = reactive({
    mode: 'panel',
    view: 'all',
    search: '',
    selectedRoomKey: '',
    items: [],
    groups: [],
  } as unknown as FavoritesLauncherState)
  const shadow = document.createElement('div').attachShadow({ mode: 'open' })
  document.body.append(shadow.host)
  const mountPoint = document.createElement('div')
  shadow.append(mountPoint)
  const wrapper = mount(
    defineComponent({
      setup() {
        const panel = ref<HTMLElement | null>(null)
        useFavoritesMotion(() => state, panel, ref(50))
        return () =>
          h('section', { ref: panel }, [
            state.selectedRoomKey
              ? h('button', { class: 'bcp-favorites-room-back' }, 'Back')
              : null,
            h('ol', { key: state.selectedRoomKey, role: 'tabpanel' }, [
              h('li', { 'data-motion-id': 'room-a' }, h('button', 'Room A')),
            ]),
          ])
      },
    }),
    { attachTo: mountPoint },
  )
  const list = wrapper.get('ol').element
  list.scrollTop = 120
  state.selectedRoomKey = 'room-a'
  await nextTick()
  await nextTick()
  expect(wrapper.get('ol').element.scrollTop).toBe(0)
  expect(shadow.activeElement?.className).toBe('bcp-favorites-room-back')
  state.selectedRoomKey = ''
  await nextTick()
  await nextTick()
  expect(wrapper.get('ol').element.scrollTop).toBe(120)
  expect(shadow.activeElement?.textContent).toBe('Room A')
  wrapper.unmount()
})

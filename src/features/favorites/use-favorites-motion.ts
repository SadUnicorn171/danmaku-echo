import { nextTick, onUnmounted, watch, type Ref } from 'vue'
import { createUiAnimator, uiMotionAllowed } from '../../core/ui-motion'
import type { FavoritesLauncherState } from './launcher'

/** Local measurements only, and only when list identity/order changes. */
export function useFavoritesMotion(
  getState: () => FavoritesLauncherState,
  panel: Ref<HTMLElement | null>,
  limit: Ref<number>,
) {
  const animator = createUiAnimator()
  let revision = 0
  let roomScroll = 0
  let roomLimit = 50
  const list = () => panel.value?.querySelector<HTMLElement>('[role="tabpanel"]')
  const rows = () => Array.from(list()?.querySelectorAll<HTMLElement>('[data-motion-id]') ?? [])
  const visible = (row: HTMLElement, bounds: DOMRect) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > bounds.top && rect.top < bounds.bottom ? rect : null
  }
  watch(
    () => getState().selectedRoomKey,
    async (key, previous) => {
      const current = ++revision
      animator.clear()
      const oldList = list()
      const source = key
        ? rows()
            .find((row) => row.dataset.motionId === key)
            ?.querySelector('strong')
        : undefined
      const from = uiMotionAllowed() ? source?.getBoundingClientRect() : undefined
      if (key) {
        roomScroll = oldList?.scrollTop ?? 0
        roomLimit = Math.max(50, oldList?.children.length ?? 50)
      } else if (previous) limit.value = roomLimit
      await nextTick()
      if (revision !== current || getState().mode !== 'panel') return
      const targetList = list()
      if (!targetList) return
      targetList.scrollTop = key ? 0 : roomScroll
      const focusTarget = key
        ? panel.value?.querySelector<HTMLButtonElement>('.bcp-favorites-room-back')
        : rows()
            .find((row) => row.dataset.motionId === previous)
            ?.querySelector('button')
      focusTarget?.focus({ preventScroll: true })
      animator.play(
        targetList,
        [
          { opacity: 0.6, transform: `translateX(${key ? 8 : -8}px)` },
          { opacity: 1, transform: 'none' },
        ],
        180,
      )
      const title = panel.value?.querySelector<HTMLElement>('.bcp-favorites-list-title > strong')
      if (from && title && uiMotionAllowed()) {
        const to = title.getBoundingClientRect()
        animator.play(
          title,
          [
            { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
            { transform: 'none' },
          ],
          220,
        )
      }
    },
  )
  watch(
    () =>
      [
        getState().mode,
        getState().view,
        getState().search,
        getState().selectedRoomKey,
        getState()
          .items.map((item) => item.id)
          .join(','),
        getState()
          .groups.map((group) => `${group.roomKey}:${group.items.map((item) => item.id).join(',')}`)
          .join('|'),
        limit.value,
      ] as const,
    async (next, previous) => {
      if (next.slice(0, 4).some((value, index) => value !== previous[index])) return
      const root = list()
      if (!root) return
      const oldRows = rows()
      const active = panel.value?.getRootNode() as Document | ShadowRoot | undefined
      const activeRow = oldRows.find((row) => row.contains(active?.activeElement ?? null))
      const focusIndex = activeRow ? oldRows.indexOf(activeRow) : -1
      const current = ++revision
      const bounds = uiMotionAllowed() ? root.getBoundingClientRect() : null
      const before = new Map(
        oldRows.map((row) => [row.dataset.motionId!, bounds ? visible(row, bounds) : null]),
      )
      animator.clear()
      await nextTick()
      if (revision !== current || getState().mode !== 'panel') return
      const afterRows = rows()
      if (activeRow && !activeRow.isConnected) {
        const target =
          afterRows[Math.min(focusIndex, afterRows.length - 1)]?.querySelector<HTMLElement>(
            'button',
          )
        ;(target ?? panel.value)?.focus({ preventScroll: true })
      }
      if (!bounds || !uiMotionAllowed()) return
      let entered = 0
      const measurements = afterRows.map((row) => ({ row, rect: visible(row, bounds) }))
      for (const { row, rect } of measurements) {
        if (!rect || row.classList.contains('is-dragging')) continue
        const old = before.get(row.dataset.motionId!)
        if (old && old.top !== rect.top) {
          animator.play(
            row,
            [{ transform: `translateY(${old.top - rect.top}px)` }, { transform: 'none' }],
            220,
          )
        } else if (
          !before.has(row.dataset.motionId!) &&
          entered < 6 &&
          !row.contains(active?.activeElement ?? null)
        ) {
          animator.play(
            row,
            [
              { opacity: 0, transform: 'translateY(4px)' },
              { opacity: 1, transform: 'none' },
            ],
            160,
            entered++ * 24,
          )
        }
      }
    },
  )
  watch(
    () => getState().mode,
    () => {
      revision++
      animator.clear()
    },
  )
  onUnmounted(() => {
    revision++
    animator.destroy()
  })
}

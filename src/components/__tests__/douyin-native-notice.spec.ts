import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createDouyinOverlay } from '../live/douyin-overlay'

afterEach(() => document.body.replaceChildren())
it('keeps send feedback independent, does not focus the notice, and wires retry and dismiss', async () => {
  const input = document.createElement('textarea'); document.body.append(input); input.focus()
  const noop = () => {}
  const overlay = createDouyinOverlay({ onCardEnter: noop, onCardLeave: noop, onCardMove: noop, onCopy: noop, onFavorite: noop, onPlaceholder: noop, onPlusOne: noop, onPointerDown: noop })
  overlay.ensureHost(document.body)
  const retry = vi.fn<() => void>(), dismiss = vi.fn<() => void>()
  overlay.setNativeSettingsNotice({ message: '应用失败', retryLabel: '重试', dismissLabel: '关闭', retry, dismiss })
  await nextTick()
  expect(document.activeElement).toBe(input)
  const notice = document.querySelector<HTMLElement>('.bcp-douyin-native-notice')!
  notice.querySelector<HTMLButtonElement>('button')!.click()
  notice.querySelectorAll<HTMLButtonElement>('button')[1]!.click()
  expect(retry).toHaveBeenCalledOnce()
  expect(dismiss).toHaveBeenCalledOnce()
  overlay.showToast('发送失败', 'error')
  await nextTick()
  expect(notice.hidden).toBe(true)
  expect(document.querySelector('.bcp-douyin-toast')?.textContent).toContain('发送失败')
  overlay.dismissToast()
  await nextTick()
  expect(notice.hidden).toBe(false)
  overlay.setNativeSettingsNotice(null)
  await nextTick()
  expect(document.querySelector('.bcp-douyin-native-notice')).toBeNull()
  overlay.destroy()
})

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import * as repositories from '../repository'
import type { FavoritePayload } from '../types'
import { currentRoomContext } from '../room-context'
import { createFavoritesRuntime, type FavoritesRuntime } from '../launcher'

let runtime: FavoritesRuntime | null = null
let send: Mock<(payload: FavoritePayload) => Promise<boolean>>
let write: ReturnType<typeof vi.fn>
let toast: Mock<(message: string, tone?: string) => void>
const shadow = () => document.querySelector('.bcp-favorites-host')!.shadowRoot!
const key = (type: string, code = 'KeyQ') => document.dispatchEvent(new KeyboardEvent(type, {
  key: code === 'Escape' ? 'Escape' : 'q', code, altKey: true, bubbles: true,
}))
async function openAndRelease(prepare?: (wheel: HTMLElement) => void) {
  key('keydown')
  await vi.advanceTimersByTimeAsync(180)
  await nextTick()
  const wheel = shadow().querySelector<HTMLElement>('.bcp-favorites-radial')!
  prepare?.(wheel)
  document.dispatchEvent(new MouseEvent('pointermove', {
    clientX: parseFloat(wheel.style.left), clientY: parseFloat(wheel.style.top) - 132, bubbles: true,
  }))
  await nextTick()
  key('keyup')
  await nextTick()
}

beforeEach(async () => {
  const values: Record<string, unknown> = {}
  const storage = {
    get: vi.fn<(keys: string[], callback: (data: unknown) => void) => void>((keys, callback) => callback(Object.fromEntries(keys.map(k => [k, values[k]])))),
    set: vi.fn<(update: Record<string, unknown>, callback: () => void) => void>((update, callback) => { Object.assign(values, update); callback() }),
  } as unknown as chrome.storage.LocalStorageArea
  write = vi.fn<(_request: unknown, callback: (response: { ok: boolean }) => void) => void>((_request, callback) => callback({ ok: true }))
  vi.stubGlobal('chrome', { runtime: { id: 'test-extension', sendMessage: write }, storage: { local: storage, onChanged: { addListener: vi.fn<() => void>(), removeListener: vi.fn<() => void>() } } })
  const repository = repositories.createFavoritesRepository(storage)
  await repository.load()
  await repository.favorite('测试收藏', currentRoomContext('huya'))
  vi.spyOn(repositories, 'createFavoritesRepository').mockReturnValue(repository)
  send = vi.fn<(payload: FavoritePayload) => Promise<boolean>>()
  vi.useFakeTimers()
  toast = vi.fn<(message: string, tone?: string) => void>()
  runtime = createFavoritesRuntime({ platform: 'huya', enabled: () => true, sendFavorite: send, showToast: toast })
  await flushPromises()
})
afterEach(() => {
  runtime?.destroy()
  runtime = null
  history.replaceState(null, '', '/')
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('radial send feedback lifecycle', () => {
  it('allows a new wheel gesture during panel exit and ignores the stale exit callback', async () => {
    runtime!.openPanel(); await nextTick();
    const panel = shadow().querySelector<HTMLElement>('.bcp-favorites-panel')!;
    let resolveExit!: () => void;
    panel.animate = vi.fn<() => Animation>(() => ({
      finished: new Promise<void>(resolve => { resolveExit = resolve }),
      cancel: vi.fn<() => void>(),
    }) as unknown as Animation);
    key('keydown', 'Escape'); await nextTick();
    key('keydown'); await vi.advanceTimersByTimeAsync(180); await nextTick();
    expect(shadow().querySelector('.bcp-favorites-radial')).not.toBeNull();
    resolveExit(); await flushPromises();
    expect(shadow().querySelector('.bcp-favorites-radial')).not.toBeNull();
  })
  it('removes the entire wheel after collapsing without waiting for the sender', async () => {
    let finish!: (value: boolean) => void
    send.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve }))
    let finishCollapse!: () => void
    await openAndRelease(wheel => {
      wheel.animate = vi.fn<() => Animation>(() => ({
        finished: new Promise<void>(resolve => { finishCollapse = resolve }),
        cancel: vi.fn<() => void>(),
      }) as unknown as Animation)
    })
    expect(shadow().querySelector('.is-sending')).not.toBeNull()
    expect(shadow().querySelector('.is-sending.is-submitted')).not.toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-caption')).toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-hint')).toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-bot')).not.toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-check')).toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-cross')).toBeNull()
    key('keydown'); await vi.advanceTimersByTimeAsync(180); key('keyup')
    expect(send).toHaveBeenCalledTimes(1)
    finishCollapse(); await flushPromises()
    expect(shadow().querySelector('.bcp-favorites-layer')).toBeNull()
    expect(document.querySelector<HTMLElement>('.bcp-favorites-host')?.dataset.bcpFavoritesLastSendResult).toBe('pending')
    finish(true); await flushPromises()
    expect(shadow().querySelector('.bcp-favorites-radial')).toBeNull()
    expect(toast).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ operation: 'record-sent' }), expect.any(Function))
  })
  it.each([false, new Error('sender failed')])('closes immediately on failed sends and leaves result feedback to toasts (%s)', async failure => {
    if (failure instanceof Error) send.mockRejectedValue(failure)
    else send.mockResolvedValue(failure)
    await openAndRelease(); await flushPromises()
    const expectedToasts = failure instanceof Error ? [['sender failed', 'error']] : []
    expect(toast.mock.calls).toEqual(expectedToasts)
    expect(write).not.toHaveBeenCalled()
    expect(shadow().querySelector('.bcp-favorites-radial')).toBeNull()
  })
  it('removes the pending wheel immediately when animation is unavailable', async () => {
    send.mockImplementation(() => new Promise<boolean>(() => {}))
    await openAndRelease()
    expect(shadow().querySelector('.bcp-favorites-layer')).toBeNull()
    expect(document.querySelector<HTMLElement>('.bcp-favorites-host')?.dataset.bcpFavoritesLastSendResult).toBe('pending')
  })
  it('ignores an old collapse completion after a new panel opens', async () => {
    let finishCollapse!: () => void
    send.mockImplementation(() => new Promise<boolean>(() => {}))
    await openAndRelease(wheel => {
      wheel.animate = vi.fn<() => Animation>(() => ({
        finished: new Promise<void>(resolve => { finishCollapse = resolve }),
        cancel: vi.fn<() => void>(),
      }) as unknown as Animation)
    })
    runtime!.openPanel(); await nextTick()
    finishCollapse(); await flushPromises()
    expect(shadow().querySelector('.bcp-favorites-panel')).not.toBeNull()
  })
  it('does not revive cancelled feedback or close a subsequently opened panel', async () => {
    let finish!: (value: boolean) => void
    send.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve }))
    await openAndRelease()
    key('keydown', 'Escape')
    runtime!.openPanel()
    finish(true); await flushPromises(); await vi.advanceTimersByTimeAsync(1000)
    expect(shadow().querySelector('.bcp-favorites-panel')).not.toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-check')).toBeNull()
  })
  it('closes before send-count persistence completes and does not later close a new panel', async () => {
    let persist!: (response: { ok: boolean }) => void
    write.mockImplementation((_request, callback) => { persist = callback })
    send.mockResolvedValue(true)
    await openAndRelease(); await flushPromises()
    expect(shadow().querySelector('.bcp-favorites-radial')).toBeNull()
    runtime!.openPanel(); await nextTick()
    persist({ ok: true }); await flushPromises(); await vi.advanceTimersByTimeAsync(1000)
    expect(shadow().querySelector('.bcp-favorites-panel')).not.toBeNull()
  })
  it('does not display a late result after changing rooms', async () => {
    let finish!: (value: boolean) => void
    send.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve }))
    await openAndRelease()
    history.replaceState(null, '', '/another-room')
    finish(true); await flushPromises()
    expect(shadow().querySelector('.bcp-favorites-radial')).toBeNull()
  })
  it('ignores a pending result after destroy without leaving timers or recording a send', async () => {
    let finish!: (value: boolean) => void
    send.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve }))
    await openAndRelease()
    runtime!.destroy()
    finish(true); await flushPromises(); await vi.advanceTimersByTimeAsync(1000)
    expect(document.querySelector('.bcp-favorites-host')).toBeNull()
    expect(write).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

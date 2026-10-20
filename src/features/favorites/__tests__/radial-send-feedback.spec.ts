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
const shadow = () => document.querySelector('.bcp-favorites-host')!.shadowRoot!
const key = (type: string, code = 'KeyQ') => document.dispatchEvent(new KeyboardEvent(type, {
  key: code === 'Escape' ? 'Escape' : 'q', code, altKey: true, bubbles: true,
}))
async function openAndRelease() {
  key('keydown')
  await vi.advanceTimersByTimeAsync(180)
  await nextTick()
  const wheel = shadow().querySelector<HTMLElement>('.bcp-favorites-radial')!
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
  runtime = createFavoritesRuntime({ platform: 'huya', enabled: () => true, sendFavorite: send, showToast: vi.fn<() => void>() })
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
  it('waits for sender success, locks selection, then shows a check and dismisses once', async () => {
    let finish!: (value: boolean) => void
    send.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve }))
    await openAndRelease()
    expect(shadow().querySelector('.is-sending')).not.toBeNull()
    expect(shadow().querySelector('.is-sending.is-submitted')).not.toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-caption')).toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-hint')).toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-bot')).not.toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-check')).toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-cross')).toBeNull()
    key('keydown'); await vi.advanceTimersByTimeAsync(180); key('keyup')
    expect(send).toHaveBeenCalledTimes(1)
    finish(true); await flushPromises()
    expect(shadow().querySelector('.is-success .bcp-favorites-radial-check')).not.toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-caption')).toBeNull()
    expect(shadow().querySelector('.bcp-favorites-visually-hidden[role="status"]')?.textContent).toBe('发送完成')
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ operation: 'record-sent' }), expect.any(Function))
    await vi.advanceTimersByTimeAsync(900)
    expect(shadow().querySelector('.bcp-favorites-radial')).toBeNull()
  })
  it.each([false, new Error('sender failed')])('never shows success for a failed sender (%s)', async failure => {
    if (failure instanceof Error) send.mockRejectedValue(failure)
    else send.mockResolvedValue(failure)
    await openAndRelease(); await flushPromises()
    expect(shadow().querySelector('.is-failed.is-submitted .bcp-favorites-radial-cross')).not.toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-check')).toBeNull()
    expect(shadow().querySelector('.bcp-favorites-radial-caption')).toBeNull()
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(900)
    expect(shadow().querySelector('.bcp-favorites-radial')).toBeNull()
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
  it('dismisses success even if the room changes during its dwell', async () => {
    send.mockResolvedValue(true)
    await openAndRelease(); await flushPromises()
    history.replaceState(null, '', '/another-room')
    await vi.advanceTimersByTimeAsync(900)
    expect(shadow().querySelector('.bcp-favorites-radial')).toBeNull()
  })
  it('does not display a late result after changing rooms', async () => {
    let finish!: (value: boolean) => void
    send.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve }))
    await openAndRelease()
    history.replaceState(null, '', '/another-room')
    finish(true); await flushPromises()
    expect(shadow().querySelector('.bcp-favorites-radial')).toBeNull()
  })
  it('cleans success feedback timers on destroy', async () => {
    send.mockResolvedValue(true)
    await openAndRelease(); await flushPromises()
    expect(shadow().querySelector('.is-success')).not.toBeNull()
    runtime!.destroy()
    await vi.advanceTimersByTimeAsync(1000)
    expect(document.querySelector('.bcp-favorites-host')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

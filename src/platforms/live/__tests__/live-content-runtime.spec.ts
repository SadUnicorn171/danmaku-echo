import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FavoritesRuntime } from '../../../features/favorites/launcher'
import type { RepeatReminderRuntime } from '../../../features/repeat-reminder/runtime'
import {
  LiveContentRuntime,
  type RuntimeMessageListener,
  type StorageChangeListener,
} from '../live-content-runtime'

function listenerSource<Listener>() {
  const listeners = new Set<Listener>()
  return {
    addListener: vi.fn<(listener: Listener) => void>((listener) => listeners.add(listener)),
    listeners,
    removeListener: vi.fn<(listener: Listener) => void>((listener) => listeners.delete(listener)),
  }
}

function createHarness() {
  const calls: string[] = []
  let roomKey = 'bilibili:100'
  const runtimeMessages = listenerSource<RuntimeMessageListener>()
  const storageChanges = listenerSource<StorageChangeListener>()
  const favorites: FavoritesRuntime = {
    destroy: vi.fn<() => void>(() => calls.push('favorites.destroy')),
    favoriteText: vi.fn<FavoritesRuntime['favoriteText']>(async () => null),
    openPanel: vi.fn<FavoritesRuntime['openPanel']>(),
  }
  const repeatReminder: RepeatReminderRuntime = {
    applySettings: vi.fn<RepeatReminderRuntime['applySettings']>(),
    destroy: vi.fn<() => void>(() => calls.push('repeat.destroy')),
    ingest: vi.fn<RepeatReminderRuntime['ingest']>(),
    scan: vi.fn<RepeatReminderRuntime['scan']>(),
    suppressText: vi.fn<RepeatReminderRuntime['suppressText']>(),
  }
  const resources = {
    capsule: { destroy: vi.fn<() => void>(() => calls.push('capsule.destroy')) },
    clearRepeatReminderAdapter: vi.fn<() => void>(() => calls.push('adapter.clear')),
    createFavorites: vi.fn<() => FavoritesRuntime>(() => favorites),
    createRepeatReminder: vi.fn<() => RepeatReminderRuntime>(() => repeatReminder),
    hoverSelection: {
      destroy: vi.fn<() => void>(() => calls.push('hover.destroy')),
      start: vi.fn<() => void>(() => calls.push('hover.start')),
    },
    releaseTransient: vi.fn<() => void>(() => calls.push('transient.release')),
    startSenderObserver: vi.fn<() => void>(() => calls.push('sender.start')),
  }
  const events = {
    onAltClick: vi.fn<(event: MouseEvent) => void>(),
    onDiagnosticsMessage: vi.fn<RuntimeMessageListener>(() => false),
    onFullscreenChange: vi.fn<() => void>(),
    onQuickInputKeyDown: vi.fn<(event: KeyboardEvent) => void>(),
    onQuickInputPointerDown: vi.fn<(event: PointerEvent) => void>(),
    onViewportChange: vi.fn<() => void>(),
  }
  const onResourcesChanged = vi.fn<
    (favorites: FavoritesRuntime | null, repeatReminder: RepeatReminderRuntime | null) => void
  >()
  const runtime = new LiveContentRuntime({
    document,
    events,
    initialize: vi.fn<() => void>(() => calls.push('initialize')),
    loadSettings: vi.fn<() => void>(() => calls.push('settings.load')),
    onDestroyed: vi.fn<() => void>(() => calls.push('destroyed')),
    onResourcesChanged,
    resources,
    roomKey: () => roomKey,
    runtimeMessages,
    storageChanges,
    window,
  })
  return {
    calls,
    events,
    favorites,
    onResourcesChanged,
    repeatReminder,
    resources,
    runtime,
    runtimeMessages,
    storageChanges,
    setRoomKey: (value: string) => (roomKey = value),
  }
}

describe('LiveContentRuntime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts resources and installs every listener only once', () => {
    const harness = createHarness()
    harness.runtime.start()
    harness.runtime.start()

    expect(harness.runtime.started).toBe(true)
    expect(harness.resources.createRepeatReminder).toHaveBeenCalledTimes(1)
    expect(harness.resources.createFavorites).toHaveBeenCalledTimes(1)
    expect(harness.resources.hoverSelection.start).toHaveBeenCalledTimes(1)
    expect(harness.resources.startSenderObserver).toHaveBeenCalledTimes(1)
    expect(harness.runtimeMessages.addListener).toHaveBeenCalledTimes(1)
    expect(harness.storageChanges.addListener).toHaveBeenCalledTimes(1)

    document.dispatchEvent(new MouseEvent('click'))
    document.dispatchEvent(new KeyboardEvent('keydown'))
    document.dispatchEvent(new Event('fullscreenchange'))
    window.dispatchEvent(new Event('resize'))
    expect(harness.events.onAltClick).toHaveBeenCalledTimes(1)
    expect(harness.events.onQuickInputKeyDown).toHaveBeenCalledTimes(1)
    expect(harness.events.onFullscreenChange).toHaveBeenCalledTimes(1)
    expect(harness.events.onViewportChange).toHaveBeenCalledTimes(1)
  })

  it('suspends transient observers while hidden and resumes them when visible', () => {
    const harness = createHarness()
    let hidden = true
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    harness.runtime.start()
    harness.resources.startSenderObserver.mockClear()

    document.dispatchEvent(new Event('visibilitychange'))
    expect(harness.resources.releaseTransient).toHaveBeenCalledTimes(1)
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(harness.resources.startSenderObserver).toHaveBeenCalledTimes(1)
  })

  it('reloads only sync settings changes', () => {
    const harness = createHarness()
    harness.runtime.start()
    const loadSettings = harness.calls.filter((call) => call === 'settings.load').length
    const listener = [...harness.storageChanges.listeners][0]

    listener({}, 'local')
    listener({}, 'sync')
    expect(harness.calls.filter((call) => call === 'settings.load')).toHaveLength(loadSettings + 1)
  })

  it('recreates room-scoped UI and observers after a room switch', () => {
    const harness = createHarness()
    harness.runtime.start()
    harness.resources.startSenderObserver.mockClear()
    harness.setRoomKey('bilibili:200')

    expect(harness.runtime.checkRoom()).toBe(true)
    expect(harness.runtime.checkRoom()).toBe(false)
    expect(harness.favorites.destroy).toHaveBeenCalledTimes(1)
    expect(harness.repeatReminder.destroy).toHaveBeenCalledTimes(1)
    expect(harness.resources.clearRepeatReminderAdapter).toHaveBeenCalledTimes(1)
    expect(harness.resources.createFavorites).toHaveBeenCalledTimes(2)
    expect(harness.resources.createRepeatReminder).toHaveBeenCalledTimes(2)
    expect(harness.resources.startSenderObserver).toHaveBeenCalledTimes(1)
  })

  it('destroys resources and removes listeners idempotently', () => {
    const harness = createHarness()
    harness.runtime.start()
    harness.runtime.destroy()
    harness.runtime.destroy()

    expect(harness.runtime.started).toBe(false)
    expect(harness.runtime.destroyed).toBe(true)
    expect(harness.resources.releaseTransient).toHaveBeenCalledTimes(1)
    expect(harness.resources.clearRepeatReminderAdapter).toHaveBeenCalledTimes(1)
    expect(harness.favorites.destroy).toHaveBeenCalledTimes(1)
    expect(harness.repeatReminder.destroy).toHaveBeenCalledTimes(1)
    expect(harness.resources.capsule.destroy).toHaveBeenCalledTimes(1)
    expect(harness.resources.hoverSelection.destroy).toHaveBeenCalledTimes(1)
    expect(harness.runtimeMessages.removeListener).toHaveBeenCalledTimes(1)
    expect(harness.storageChanges.removeListener).toHaveBeenCalledTimes(1)
    expect(harness.onResourcesChanged).toHaveBeenLastCalledWith(null, null)

    document.dispatchEvent(new MouseEvent('click'))
    window.dispatchEvent(new Event('resize'))
    expect(harness.events.onAltClick).toHaveBeenCalledTimes(0)
    expect(harness.events.onViewportChange).toHaveBeenCalledTimes(0)
    harness.runtime.start()
    expect(harness.resources.createFavorites).toHaveBeenCalledTimes(1)
  })
})

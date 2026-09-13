import type { FavoritesRuntime } from '../../features/favorites/launcher'
import type { RepeatReminderRuntime } from '../../features/repeat-reminder/runtime'

export type RuntimeMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined

export type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void

interface ChromeListenerSource<Listener> {
  addListener(listener: Listener): void
  removeListener(listener: Listener): void
}

interface StartableResource {
  destroy(): void
  start(): void
}

interface DestroyableResource {
  destroy(): void
}

export interface LiveContentRuntimeResources {
  capsule: DestroyableResource
  clearRepeatReminderAdapter(): void
  createFavorites(): FavoritesRuntime | null
  createRepeatReminder(): RepeatReminderRuntime
  hoverSelection: StartableResource
  releaseTransient(): void
  startSenderObserver(): void
}

export interface LiveContentRuntimeEvents {
  onAltClick(event: MouseEvent): void
  onDiagnosticsMessage: RuntimeMessageListener
  onFullscreenChange(): void
  onQuickInputKeyDown(event: KeyboardEvent): void
  onQuickInputPointerDown(event: PointerEvent): void
  onViewportChange(): void
}

export interface LiveContentRuntimeOptions {
  document: Document
  events: LiveContentRuntimeEvents
  initialize(): void
  loadSettings(): void | Promise<void>
  onDestroyed(): void
  onResourcesChanged(
    favorites: FavoritesRuntime | null,
    repeatReminder: RepeatReminderRuntime | null,
  ): void
  resources: LiveContentRuntimeResources
  roomKey(): string
  runtimeMessages?: ChromeListenerSource<RuntimeMessageListener>
  storageChanges?: ChromeListenerSource<StorageChangeListener>
  window: Window
}

export class LiveContentRuntime {
  readonly #options: LiveContentRuntimeOptions
  #destroyed = false
  #favorites: FavoritesRuntime | null = null
  #repeatReminder: RepeatReminderRuntime | null = null
  #roomKey = ''
  #started = false

  readonly #altClickListener: EventListener
  readonly #fullscreenListener: EventListener
  readonly #keyDownListener: EventListener
  readonly #pageHideListener: EventListener
  readonly #pointerDownListener: EventListener
  readonly #resizeListener: EventListener
  readonly #roomChangeListener: EventListener
  readonly #scrollListener: EventListener
  readonly #storageListener: StorageChangeListener
  readonly #visibilityListener: EventListener

  constructor(options: LiveContentRuntimeOptions) {
    this.#options = options
    this.#altClickListener = (event) => options.events.onAltClick(event as MouseEvent)
    this.#fullscreenListener = () => {
      this.checkRoom()
      options.events.onFullscreenChange()
    }
    this.#keyDownListener = (event) => options.events.onQuickInputKeyDown(event as KeyboardEvent)
    this.#pageHideListener = () => this.destroy()
    this.#pointerDownListener = (event) =>
      options.events.onQuickInputPointerDown(event as PointerEvent)
    this.#resizeListener = () => {
      this.checkRoom()
      options.events.onViewportChange()
    }
    this.#roomChangeListener = () => this.checkRoom()
    this.#scrollListener = () => {
      this.checkRoom()
      options.events.onViewportChange()
    }
    this.#storageListener = (_changes, areaName) => {
      if (areaName === 'sync') void options.loadSettings()
    }
    this.#visibilityListener = () => {
      this.checkRoom()
      if (options.document.hidden) options.resources.releaseTransient()
      else options.resources.startSenderObserver()
    }
  }

  get destroyed(): boolean {
    return this.#destroyed
  }

  get started(): boolean {
    return this.#started
  }

  start(): void {
    if (this.#started || this.#destroyed) return
    this.#started = true
    this.#roomKey = this.#options.roomKey()

    this.#createFeatureResources()
    this.#options.initialize()
    void this.#options.loadSettings()
    this.#options.resources.startSenderObserver()
    this.#options.resources.hoverSelection.start()
    this.#addListeners()
  }

  checkRoom(): boolean {
    if (!this.#started || this.#destroyed) return false
    const roomKey = this.#options.roomKey()
    if (!roomKey || roomKey === this.#roomKey) return false
    this.#roomKey = roomKey

    this.#options.resources.releaseTransient()
    this.#options.resources.clearRepeatReminderAdapter()
    this.#destroyFeatureResources()
    this.#createFeatureResources()
    this.#options.initialize()
    if (!this.#options.document.hidden) this.#options.resources.startSenderObserver()
    return true
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    if (this.#started) {
      this.#started = false
      this.#removeListeners()
    }

    this.#options.resources.releaseTransient()
    this.#options.resources.clearRepeatReminderAdapter()
    this.#destroyFeatureResources()
    this.#options.resources.capsule.destroy()
    this.#options.resources.hoverSelection.destroy()
    this.#options.onDestroyed()
  }

  #addListeners(): void {
    const { document, runtimeMessages, storageChanges, window } = this.#options
    document.addEventListener('click', this.#altClickListener, true)
    document.addEventListener('pointerdown', this.#pointerDownListener, true)
    document.addEventListener('keydown', this.#keyDownListener, true)
    document.addEventListener('fullscreenchange', this.#fullscreenListener, true)
    document.addEventListener('webkitfullscreenchange', this.#fullscreenListener, true)
    document.addEventListener('visibilitychange', this.#visibilityListener)
    window.addEventListener('pagehide', this.#pageHideListener, { once: true })
    window.addEventListener('popstate', this.#roomChangeListener)
    window.addEventListener('hashchange', this.#roomChangeListener)
    window.addEventListener('scroll', this.#scrollListener, true)
    window.addEventListener('resize', this.#resizeListener, { passive: true })
    window.addEventListener('focus', this.#resizeListener)
    runtimeMessages?.addListener(this.#options.events.onDiagnosticsMessage)
    storageChanges?.addListener(this.#storageListener)
  }

  #removeListeners(): void {
    const { document, runtimeMessages, storageChanges, window } = this.#options
    document.removeEventListener('click', this.#altClickListener, true)
    document.removeEventListener('pointerdown', this.#pointerDownListener, true)
    document.removeEventListener('keydown', this.#keyDownListener, true)
    document.removeEventListener('fullscreenchange', this.#fullscreenListener, true)
    document.removeEventListener('webkitfullscreenchange', this.#fullscreenListener, true)
    document.removeEventListener('visibilitychange', this.#visibilityListener)
    window.removeEventListener('pagehide', this.#pageHideListener)
    window.removeEventListener('popstate', this.#roomChangeListener)
    window.removeEventListener('hashchange', this.#roomChangeListener)
    window.removeEventListener('scroll', this.#scrollListener, true)
    window.removeEventListener('resize', this.#resizeListener)
    window.removeEventListener('focus', this.#resizeListener)
    runtimeMessages?.removeListener(this.#options.events.onDiagnosticsMessage)
    storageChanges?.removeListener(this.#storageListener)
  }

  #createFeatureResources(): void {
    this.#repeatReminder = this.#options.resources.createRepeatReminder()
    this.#favorites = this.#options.resources.createFavorites()
    this.#options.onResourcesChanged(this.#favorites, this.#repeatReminder)
  }

  #destroyFeatureResources(): void {
    this.#favorites?.destroy()
    this.#repeatReminder?.destroy()
    this.#favorites = null
    this.#repeatReminder = null
    this.#options.onResourcesChanged(null, null)
  }
}

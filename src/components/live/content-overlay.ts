import { mountUiMotion, uiMotionAllowed } from '../../core/ui-motion'
import { createApp, nextTick, reactive } from 'vue'
import type { ActionSettings } from '../../core/types'
import ContentOverlay from './ContentOverlay.vue'

export interface OverlayUiState {
  actions: ActionSettings
  actionVisible: boolean
  cooldownSeconds: number
  message: string
  sender: string
  sending: boolean
  toast: null | { id: number; message: string; tone: string; visible: boolean }
}

export interface OverlayCallbacks {
  onCopy(event: MouseEvent): void
  onFavorite(event: MouseEvent): void
  onPlaceholder(event: MouseEvent, action: 'reply'): void
  onPlusOne(event: MouseEvent): void
  onPointerDown?(event: MouseEvent | PointerEvent): void
  onPointerEnter(): void
  onPointerLeave(): void
}

export type ContentOverlayHandle = ReturnType<typeof createContentOverlay>

export function createContentOverlay(callbacks: OverlayCallbacks) {
  const portal = document.createElement('div')
  portal.className = 'bcp-one-portal'
  portal.dataset.bcpOneOwned = 'true'
  const state = reactive<OverlayUiState>({
    actions: { copy: false, plusOne: true, reply: true, favorite: true },
    actionVisible: false,
    cooldownSeconds: 0,
    message: '',
    sender: '',
    sending: false,
    toast: null,
  })
  const app = createApp(ContentOverlay, {
    state,
    onCopy: callbacks.onCopy,
    onPlaceholder: callbacks.onPlaceholder,
    onFavorite: callbacks.onFavorite,
    onPlusOne: callbacks.onPlusOne,
    onPointerdown: callbacks.onPointerDown,
    onPointerenter: callbacks.onPointerEnter,
    onPointerleave: callbacks.onPointerLeave,
  })
  app.mount(portal)
  const stopMotion = mountUiMotion(portal)
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let toastId = 0
  let destroyed = false
  let toastFrame = 0
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined

  function ensureHost(host: Element): HTMLElement {
    if (portal.parentNode !== host) {
      try {
        host.appendChild(portal)
      } catch {
        document.documentElement.appendChild(portal)
      }
    }
    return portal
  }

  function actionBar(): HTMLElement | null {
    return portal.querySelector<HTMLElement>('.bcp-one-actions')
  }

  function plusOneButton(): HTMLButtonElement | null {
    return portal.querySelector<HTMLButtonElement>('.bcp-one-button')
  }

  function showToast(message: string, tone = 'info'): void {
    if (destroyed) return
    clearTimeout(toastTimer)
    clearTimeout(cleanupTimer)
    cancelAnimationFrame(toastFrame)
    const id = ++toastId
    state.toast = { id, message, tone, visible: !uiMotionAllowed() }
    if (uiMotionAllowed()) void nextTick(() => {
      if (destroyed || id !== toastId) return
      toastFrame = requestAnimationFrame(() => {
        toastFrame = 0
        if (state.toast?.id === id) state.toast.visible = true
      })
    })
    toastTimer = setTimeout(() => {
      if (state.toast?.id !== id) return
      state.toast.visible = false
      if (!uiMotionAllowed()) state.toast = null
      else cleanupTimer = setTimeout(() => {
        if (state.toast?.id === id) state.toast = null
      }, 180)
    }, message.length > 80 ? 6000 : tone === 'error' ? 3600 : 2400)
  }

  return {
    actionBar,
    destroy(): void {
      destroyed = true
      cancelAnimationFrame(toastFrame)
      clearTimeout(cleanupTimer)
      if (toastTimer !== undefined) clearTimeout(toastTimer)
      stopMotion()
      app.unmount()
      portal.remove()
    },
    ensureHost,
    hideActionBar(): void {
      state.actionVisible = false
      state.sending = false
    },
    plusOneButton,
    portal,
    setActions(actions: ActionSettings): void {
      state.actions = { ...actions }
      if (!Object.values(actions).some(Boolean)) state.actionVisible = false
    },
    setCooldown(remainingMs: number): void {
      state.cooldownSeconds = Math.max(0, Math.ceil(Number(remainingMs) / 1_000))
    },
    setSending(sending: boolean): void {
      state.sending = sending
    },
    showActionBar(message: string, sender = ''): void {
      state.message = message
      state.sender = sender
      state.actionVisible = true
    },
    showToast,
  }
}

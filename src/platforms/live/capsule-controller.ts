import type { ActionSettings } from '../../core/types'
import {
  createContentOverlay,
  type ContentOverlayHandle,
  type OverlayCallbacks,
} from '../../components/live/content-overlay'
import { overlayCapsulePlacement } from './capsule-position'
import { clampBoxStart, type RectBounds } from './overlay-viewport'
import type { LiveCandidateKind } from './candidate-adapter'

export interface CapsuleAnchor {
  candidate: Element
  kind: LiveCandidateKind
  overlayViewport: RectBounds | null
  positionTarget: Element
}

export interface CapsuleControllerOptions {
  anchor(): CapsuleAnchor | null
  callbacks: OverlayCallbacks
  document: Document
  fullscreenHost(): Element | null
  overlayFactory?: (callbacks: OverlayCallbacks) => ContentOverlayHandle
  viewport(): RectBounds
}

export class CapsuleController {
  readonly #options: CapsuleControllerOptions
  #actionBar: HTMLElement | null = null
  #bridge: HTMLElement | null = null
  #positionFrame = 0
  #ui: ContentOverlayHandle | null = null

  constructor(options: CapsuleControllerOptions) {
    this.#options = options
  }

  contains(target: EventTarget | null): boolean {
    return target instanceof Node && Boolean(this.#actionBar?.contains(target) || this.#bridge?.contains(target))
  }

  destroy(): void {
    this.cancelPosition()
    this.removeBridge()
    this.#ui?.destroy()
    this.#ui = null
    this.#actionBar = null
  }

  ensure(): HTMLElement {
    if (!this.#ui) {
      const factory = this.#options.overlayFactory ?? createContentOverlay
      this.#ui = factory(this.#options.callbacks)
    }
    const host = this.#options.fullscreenHost() ?? this.#options.document.documentElement
    const portal = this.#ui.ensureHost(host)
    this.#actionBar = this.#ui.actionBar()
    return portal
  }

  hide(): void {
    this.#ui?.hideActionBar()
    this.removeBridge()
  }

  removeBridge(): void {
    this.#bridge?.remove()
    this.#bridge = null
  }

  schedulePosition(): void {
    if (this.#positionFrame) return
    this.#positionFrame = requestAnimationFrame(() => {
      this.#positionFrame = 0
      this.updatePosition()
    })
  }

  setActions(actions: ActionSettings): void {
    this.ensure()
    this.#ui?.setActions(actions)
  }

  setCooldown(remainingMs: number): void {
    this.#ui?.setCooldown(remainingMs)
  }

  setSending(sending: boolean): void {
    this.#ui?.setSending(sending)
  }

  show(message: string, sender = ''): void {
    this.ensure()
    this.#ui?.showActionBar(message, sender)
    this.schedulePosition()
  }

  showToast(message: string, tone = 'info'): void {
    this.ensure()
    this.#ui?.showToast(message, tone)
  }

  updatePosition(): void {
    const anchor = this.#options.anchor()
    const actionBar = this.#actionBar
    if (!anchor || !actionBar || actionBar.hidden || !anchor.positionTarget.isConnected) return

    const rect = anchor.positionTarget.getBoundingClientRect()
    const buttonRect = actionBar.getBoundingClientRect()
    const browserViewport = this.#options.viewport()
    const actionViewport =
      anchor.kind === 'overlay' ? anchor.overlayViewport ?? browserViewport : browserViewport
    const placement = overlayCapsulePlacement({
      anchorLeft: rect.left,
      anchorRight: rect.right,
      capsuleWidth: buttonRect.width,
      viewportLeft: actionViewport.left,
      viewportRight: actionViewport.right,
    })
    const top = rect.top + (rect.height - buttonRect.height) / 2
    const actionTop = clampBoxStart(
      top,
      buttonRect.height,
      actionViewport.top,
      actionViewport.bottom,
      8,
    )
    actionBar.dataset.bcpOverlaySide = placement.side
    actionBar.style.left = `${placement.left}px`
    actionBar.style.top = `${actionTop}px`

    if (anchor.kind !== 'overlay' || !this.#ui) {
      this.removeBridge()
      return
    }
    const bridgeLeft = placement.side === 'right' ? rect.right : placement.left + buttonRect.width
    const bridgeRight = placement.side === 'right' ? placement.left : rect.left
    const bridgeTop = Math.min(rect.top, actionTop)
    const bridgeBottom = Math.max(rect.bottom, actionTop + buttonRect.height)
    const bridgeHost = this.#ui.portal.parentElement ?? this.#options.document.documentElement
    const bridge = this.ensureBridge(bridgeHost)
    bridge.style.setProperty('left', `${bridgeLeft}px`, 'important')
    bridge.style.setProperty('top', `${bridgeTop}px`, 'important')
    bridge.style.setProperty('width', `${Math.max(1, bridgeRight - bridgeLeft)}px`, 'important')
    bridge.style.setProperty('height', `${Math.max(1, bridgeBottom - bridgeTop)}px`, 'important')
  }

  private cancelPosition(): void {
    if (!this.#positionFrame) return
    cancelAnimationFrame(this.#positionFrame)
    this.#positionFrame = 0
  }

  private ensureBridge(parent: HTMLElement): HTMLElement {
    if (!this.#bridge?.isConnected || this.#bridge.parentElement !== parent) {
      this.removeBridge()
      const bridge = this.#options.document.createElement('div')
      bridge.className = 'bcp-one-hover-bridge'
      bridge.dataset.bcpOneOwned = 'true'
      bridge.setAttribute('aria-hidden', 'true')
      bridge.addEventListener('pointerenter', this.#options.callbacks.onPointerEnter)
      bridge.addEventListener('pointerleave', this.#options.callbacks.onPointerLeave)
      bridge.style.setProperty('position', 'fixed', 'important')
      parent.appendChild(bridge)
      this.#bridge = bridge
    }
    return this.#bridge
  }
}

import {
  pathTouchesNativeDialog,
  pointTouchesNativeDialog,
} from '../../../core/native-dialog-guard'
import type { ActionSettings } from '../../../core/types'
import {
  createDouyinOverlay,
  type DouyinOverlayCallbacks,
  type DouyinOverlayHandle,
} from '../../../components/live/douyin-overlay'
import {
  eventTouchesRepeatReminder,
  pointTouchesRepeatReminder,
} from '../../../features/repeat-reminder/pointer-guard'
import type { RichPayload } from '../own-message'
import type { DouyinRendererContentPart } from '../protocol'
import {
  CHAT_MESSAGE_SELECTORS,
  CHAT_ROOT_SELECTORS,
  DOM_DANMAKU_SELECTORS,
  VIDEO_ROOT_SELECTORS,
} from './dom-config'
import { closestAny, isDouyinOwnedNode, matchesAny } from './dom-query'

export type DouyinSelectionPhase = 'armed' | 'engaged' | 'grace' | 'idle'
export type DouyinDomCandidateKind = 'chat' | 'video-dom'

export interface DouyinCandidateRect {
  height: number
  left: number
  top: number
  width: number
}

export interface DouyinRichPayload extends RichPayload {
  sender?: string
}

export interface DouyinDomCandidate {
  content: DouyinRendererContentPart[]
  kind: DouyinDomCandidateKind
  message: string
  pointerX?: number
  pointerY?: number
  rect: DouyinCandidateRect
  richPayload: DouyinRichPayload
  sender: string
  style: Record<string, unknown>
  trackId: string
}

export interface DouyinSelection {
  candidate: DouyinDomCandidate
  id: number
  lockedUntil: number
  phase: DouyinSelectionPhase
  selectedAt: number
}

export interface DouyinPointerSample {
  clientX: number
  clientY: number
  path: readonly EventTarget[]
  target: EventTarget | null
  touchesRepeatReminder: boolean
}

export interface DouyinDomHoverSnapshot {
  candidate: DouyinDomCandidate | null
  hovered: boolean
  lockedUntil: number
  selectedAt: number
  selectionId: number
  selectionPhase: DouyinSelectionPhase
  timers: number
  visible: boolean
}

export interface DouyinDomHoverControllerOptions {
  actions(): ActionSettings
  cooldownForMessage(message: string): number
  enabled(): boolean
  host(): Element
  isPlausibleMessage(message: string, maxLength: number): boolean
  maxLength: number
  onCardPointerEnter?(candidate: DouyinDomCandidate | null): void
  onCopy(event: MouseEvent): void
  onFavorite(event: MouseEvent): void
  onHidden?(candidate: DouyinDomCandidate, reason: string): void
  onPlaceholder(event: MouseEvent, action: 'reply'): void
  onPlusOne(event: MouseEvent): void
  onShown?(selection: DouyinSelection): void
  payloadFromChatRow(row: Element): DouyinRichPayload
  payloadFromElement(element: Element): DouyinRichPayload
  senderForMessage(message: string): string
  createOverlay?(callbacks: DouyinOverlayCallbacks): DouyinOverlayHandle
  eventTouchesReminder?(event: Event): boolean
  pointTouchesReminder?(document: Document, clientX: number, clientY: number): boolean
  visible?(element: Element): boolean
}

export interface DouyinDomHoverController {
  current(): DouyinDomCandidate | null
  destroy(): void
  dismissToast(): void
  ensureHost(): HTMLElement
  hide(reason?: string): void
  keepAlive(): void
  scheduleHide(reason: string, delay?: number): void
  setActions(actions: ActionSettings): void
  setCooldown(remainingMs: number): void
  setSending(sending: boolean): void
  showToast(message: string, tone?: string): void
  snapshot(): DouyinDomHoverSnapshot
  start(): void
}

const CARD_LOCK_TIME = 2_500
const CARD_STICKY_TIME = 8_000
const CARD_HIDE_DELAY = 650
const CARD_PADDING = 12
const CANDIDATE_PADDING = 10

function defaultVisible(element: Element): boolean {
  if (!element.isConnected) return false
  const style = getComputedStyle(element)
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    Number(style.opacity || 1) > 0 &&
    element.getClientRects().length > 0
  )
}

function pointInside(
  rect: Pick<DOMRect, 'height' | 'left' | 'top' | 'width'> | null,
  x: number,
  y: number,
  padding = 0,
): boolean {
  return Boolean(
    rect &&
    x >= rect.left - padding &&
    x <= rect.left + rect.width + padding &&
    y >= rect.top - padding &&
    y <= rect.top + rect.height + padding,
  )
}

function saneRect(rect: DOMRect): boolean {
  return (
    [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
    rect.width >= 2 &&
    rect.width <= innerWidth * 2 &&
    rect.height >= 4 &&
    rect.height <= 300
  )
}

export function createDouyinDomHoverController(
  options: DouyinDomHoverControllerOptions,
): DouyinDomHoverController {
  let candidate: DouyinDomCandidate | null = null
  let cardHovered = false
  let lockedUntil = 0
  let selectedAt = 0
  let selectionId = 0
  let selectionPhase: DouyinSelectionPhase = 'idle'
  let overlay: DouyinOverlayHandle | null = null
  let hideTimer: ReturnType<typeof setTimeout> | 0 = 0
  let expiryTimer: ReturnType<typeof setTimeout> | 0 = 0
  let pendingPointerMove: DouyinPointerSample | null = null
  let pointerMoveFrame = 0
  let positionFrame = 0
  let started = false

  const touchesReminder = options.eventTouchesReminder || eventTouchesRepeatReminder
  const pointTouchesReminder = options.pointTouchesReminder || pointTouchesRepeatReminder
  const isVisible = options.visible || defaultVisible
  const overlayFactory = options.createOverlay || createDouyinOverlay

  function ensureOverlay(): DouyinOverlayHandle {
    if (!overlay) {
      overlay = overlayFactory({
        onCardEnter,
        onCardLeave,
        onCardMove,
        onCopy: options.onCopy,
        onFavorite: options.onFavorite,
        onPlaceholder: options.onPlaceholder,
        onPlusOne: options.onPlusOne,
        onPointerDown(event) {
          event.stopPropagation()
          keepAlive()
        },
      })
    }
    overlay.ensureHost(options.host())
    return overlay
  }

  function cancelHide(): void {
    if (!hideTimer) return
    clearTimeout(hideTimer)
    hideTimer = 0
  }

  function clearExpiry(): void {
    if (!expiryTimer) return
    clearTimeout(expiryTimer)
    expiryTimer = 0
  }

  function armExpiry(): void {
    clearExpiry()
    const activeSelectionId = selectionId
    expiryTimer = setTimeout(() => {
      expiryTimer = 0
      if (activeSelectionId !== selectionId || !candidate) return
      if (cardHovered) {
        armExpiry()
        return
      }
      hide('sticky-timeout')
    }, CARD_STICKY_TIME)
  }

  function keepAlive(): void {
    cancelHide()
    if (candidate) armExpiry()
  }

  function hide(reason = 'unspecified'): void {
    cancelHide()
    clearExpiry()
    if (positionFrame) cancelAnimationFrame(positionFrame)
    positionFrame = 0
    const previous = candidate
    candidate = null
    cardHovered = false
    selectionPhase = 'idle'
    selectedAt = 0
    lockedUntil = 0
    overlay?.hideCard()
    if (previous) options.onHidden?.(previous, reason)
  }

  function scheduleHide(reason: string, delay = CARD_HIDE_DELAY): void {
    if (hideTimer) return
    const activeSelectionId = selectionId
    hideTimer = setTimeout(() => {
      hideTimer = 0
      if (activeSelectionId !== selectionId || cardHovered) return
      hide(reason)
    }, delay)
  }

  function onCardEnter(): void {
    cardHovered = true
    selectionPhase = 'engaged'
    overlay?.setSelectionPhase(selectionPhase)
    options.onCardPointerEnter?.(candidate)
    cancelHide()
    armExpiry()
  }

  function onCardMove(): void {
    cardHovered = true
    selectionPhase = 'engaged'
    overlay?.setSelectionPhase(selectionPhase)
    cancelHide()
  }

  function onCardLeave(): void {
    cardHovered = false
    selectionPhase = 'grace'
    overlay?.setSelectionPhase(selectionPhase)
    scheduleHide('card-pointerleave')
  }

  function positionCard(activeCandidate: DouyinDomCandidate): void {
    if (!overlay || activeCandidate !== candidate) return
    const card = overlay.card()
    if (!card) return
    const measured = card.getBoundingClientRect()
    const width = Math.max(120, measured.width)
    const height = Math.max(36, measured.height)
    const anchor = activeCandidate.rect
    const pointerX = Number.isFinite(activeCandidate.pointerX)
      ? Number(activeCandidate.pointerX)
      : anchor.left + anchor.width / 2
    const pointerY = Number.isFinite(activeCandidate.pointerY)
      ? Number(activeCandidate.pointerY)
      : anchor.top + anchor.height / 2
    const boundsRight = innerWidth - 8
    let side = 'right'
    let left = pointerX + 8
    if (left + width > boundsRight) {
      side = 'left'
      left = pointerX - width - 8
    }
    left = Math.max(8, Math.min(left, boundsRight - width))
    const boundsBottom = innerHeight - 8
    const top = Math.max(8, Math.min(pointerY - height / 2, boundsBottom - height))
    overlay.positionCard(left, top, side)
  }

  function show(activeCandidate: DouyinDomCandidate): void {
    if (
      !options.enabled() ||
      !options.isPlausibleMessage(activeCandidate.message, options.maxLength)
    ) {
      return
    }
    cancelHide()
    clearExpiry()
    const ui = ensureOverlay()
    ui.setActions(options.actions())
    selectionId += 1
    candidate = activeCandidate
    cardHovered = false
    selectionPhase = 'armed'
    selectedAt = Date.now()
    lockedUntil = performance.now() + CARD_LOCK_TIME
    ui.prepareCard(
      { ...activeCandidate },
      {
        kind: activeCandidate.kind,
        message: activeCandidate.message.slice(0, 240),
        selectionId: String(selectionId),
        selectionPhase,
        trackId: activeCandidate.trackId || 'dom',
      },
    )
    ui.setCooldown(options.cooldownForMessage(activeCandidate.message))
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0
      positionCard(activeCandidate)
    })
    armExpiry()
    options.onShown?.({
      candidate: activeCandidate,
      id: selectionId,
      lockedUntil,
      phase: selectionPhase,
      selectedAt,
    })
  }

  function candidateFromElement(
    element: Element,
    kind: DouyinDomCandidateKind,
  ): DouyinDomCandidate | null {
    if (isDouyinOwnedNode(element) || !isVisible(element)) return null
    const rect = element.getBoundingClientRect()
    if (!saneRect(rect)) return null
    const richPayload =
      kind === 'chat' ? options.payloadFromChatRow(element) : options.payloadFromElement(element)
    const message = richPayload.text
    if (!options.isPlausibleMessage(message, options.maxLength)) return null
    return {
      content: [],
      kind,
      message,
      rect: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
      richPayload,
      sender: richPayload.sender || options.senderForMessage(message),
      style: {},
      trackId: `dom-${Date.now()}`,
    }
  }

  function findCandidate(path: readonly EventTarget[]): DouyinDomCandidate | null {
    for (const item of path) {
      if (!(item instanceof Element)) continue
      const danmaku = closestAny(item, DOM_DANMAKU_SELECTORS)
      if (!danmaku || !closestAny(danmaku, VIDEO_ROOT_SELECTORS)) continue
      const match = candidateFromElement(danmaku, 'video-dom')
      if (match) return match
    }
    return null
  }

  function isInsideChatColumn(path: readonly EventTarget[]): boolean {
    return path.some(
      (item) =>
        item instanceof Element &&
        Boolean(
          closestAny(item, CHAT_ROOT_SELECTORS) ||
          (closestAny(item, CHAT_MESSAGE_SELECTORS) && !closestAny(item, VIDEO_ROOT_SELECTORS)),
        ),
    )
  }

  function processPointerMove(sample: DouyinPointerSample | null): void {
    if (!sample || !options.enabled()) return
    const { clientX, clientY, path, target } = sample
    if (pathTouchesNativeDialog(path) || pointTouchesNativeDialog(document, clientX, clientY)) {
      if (candidate) hide('entered-native-dialog')
      return
    }
    if (sample.touchesRepeatReminder || pointTouchesReminder(document, clientX, clientY)) {
      if (candidate) hide('entered-repeat-reminder')
      return
    }
    if (isInsideChatColumn(path)) {
      if (candidate) hide('entered-chat-column')
      return
    }
    if (
      path.some(
        (item) =>
          item instanceof Element &&
          matchesAny(item, [
            '.bcp-douyin-dom-layer',
            '.bcp-douyin-dom-track',
            '.bcp-douyin-dom-barrage',
          ]),
      )
    ) {
      return
    }
    if (isDouyinOwnedNode(target)) {
      keepAlive()
      return
    }
    const card = overlay?.card() || null
    if (candidate) {
      if (
        performance.now() < lockedUntil ||
        (card && pointInside(card.getBoundingClientRect(), clientX, clientY, CARD_PADDING)) ||
        pointInside(candidate.rect, clientX, clientY, CANDIDATE_PADDING)
      ) {
        cancelHide()
      } else {
        scheduleHide('left-chat-card')
      }
      return
    }
    const next = findCandidate(path)
    if (!next) return
    next.pointerX = clientX
    next.pointerY = clientY
    show(next)
  }

  function onPointerMove(event: PointerEvent): void {
    if (!options.enabled() || event.pointerType === 'touch') return
    pendingPointerMove = {
      clientX: event.clientX,
      clientY: event.clientY,
      path:
        typeof event.composedPath === 'function'
          ? event.composedPath()
          : event.target
            ? [event.target]
            : [],
      target: event.target,
      touchesRepeatReminder: touchesReminder(event),
    }
    if (pointerMoveFrame) return
    pointerMoveFrame = requestAnimationFrame(() => {
      pointerMoveFrame = 0
      const sample = pendingPointerMove
      pendingPointerMove = null
      processPointerMove(sample)
    })
  }

  function onPointerDown(event: PointerEvent): void {
    if (candidate && !isDouyinOwnedNode(event.target) && performance.now() >= lockedUntil) {
      hide('outside-pointerdown')
    }
  }

  function start(): void {
    if (started) return
    started = true
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerdown', onPointerDown, true)
  }

  function destroy(): void {
    if (started) {
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
    started = false
    hide('controller-destroyed')
    if (pointerMoveFrame) cancelAnimationFrame(pointerMoveFrame)
    if (positionFrame) cancelAnimationFrame(positionFrame)
    pointerMoveFrame = 0
    positionFrame = 0
    pendingPointerMove = null
    overlay?.destroy()
    overlay = null
  }

  return {
    current: () => candidate,
    destroy,
    dismissToast: () => overlay?.dismissToast(),
    ensureHost: () => ensureOverlay().ensureHost(options.host()),
    hide,
    keepAlive,
    scheduleHide,
    setActions: (actions) => overlay?.setActions(actions),
    setCooldown: (remainingMs) => overlay?.setCooldown(remainingMs),
    setSending: (sending) => overlay?.setSending(sending),
    showToast(message, tone = 'info') {
      ensureOverlay().showToast(message, tone)
    },
    snapshot: () => ({
      candidate,
      hovered: cardHovered,
      lockedUntil,
      selectedAt,
      selectionId,
      selectionPhase,
      timers: Number(Boolean(hideTimer)) + Number(Boolean(expiryTimer)),
      visible: Boolean(candidate),
    }),
    start,
  }
}

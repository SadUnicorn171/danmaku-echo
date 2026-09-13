import { pathTouchesNativeDialog, pointTouchesNativeDialog } from '../../core/native-dialog-guard'
import type { LiveCandidateKind } from './candidate-adapter'
import { eventComposedPath } from './deep-dom'

export interface HoverPoint {
  x: number
  y: number
}

export interface HoverCandidate {
  element: Element
  kind: LiveCandidateKind
}

export interface HoverSelectionSnapshot extends HoverCandidate {
  frozen: boolean
}

export interface HoverSelectionOperations {
  clear(): void
  current(): HoverSelectionSnapshot | null
  enabled(): boolean
  findAtPoint(point: HoverPoint): HoverCandidate | null
  findFromPath(path: readonly EventTarget[]): HoverCandidate | null
  guard(event: MouseEvent, point: HoverPoint | null): boolean
  holdCurrent(target: EventTarget | null): void
  insideCurrentBody(target: EventTarget | null): boolean
  insideCurrentFrozenZone(point: HoverPoint): boolean
  insideCurrentViewport(point: HoverPoint): boolean
  isOwned(target: EventTarget | null): boolean
  nativeCandidateFromPath(path: readonly EventTarget[]): Element | null
  nativeCandidateFromTarget(target: EventTarget | null): Element | null
  nativeExitWillProceed(): void
  nativeIsReleasing(): boolean
  pathBlocksSelection(path: readonly EventTarget[]): boolean
  rememberNativeTarget(target: EventTarget | null): void
  select(
    candidate: HoverCandidate,
    point: HoverPoint | null,
    nativeTarget: EventTarget | null,
  ): boolean
  updatePointer(point: HoverPoint): void
}

export interface HoverSelectionControllerOptions {
  document: Document
  fallbackPointOnOver?: boolean
  nativeHoverBoundary?: boolean
  operations: HoverSelectionOperations
  overlayLeaveDelay?: number
  chatLeaveDelay?: number
  requestFrame?: typeof requestAnimationFrame
  cancelFrame?: typeof cancelAnimationFrame
}

export interface HoverSelectionController {
  cancelHide(): void
  destroy(): void
  onMouseOut(event: MouseEvent): void
  onMouseOver(event: MouseEvent): void
  onPointerMove(event: PointerEvent): void
  onPointerOut(event: PointerEvent): void
  onPointerOver(event: PointerEvent): void
  pointer(): HoverPoint
  reset(): void
  scheduleHide(delay?: number): void
  start(): void
}

function pointerCoordinates(event: MouseEvent): HoverPoint | null {
  const x = Number(event.clientX)
  const y = Number(event.clientY)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (!event.isTrusted && x === 0 && y === 0) return null
  return { x, y }
}

export function createHoverSelectionController(
  options: HoverSelectionControllerOptions,
): HoverSelectionController {
  const operations = options.operations
  const requestFrame = options.requestFrame ?? requestAnimationFrame
  const cancelFrame = options.cancelFrame ?? cancelAnimationFrame
  let started = false
  let hideTimer: ReturnType<typeof setTimeout> | 0 = 0
  let pointerFrame = 0
  let pointer = { x: 0, y: 0 }

  const cancelHide = () => {
    if (!hideTimer) return
    clearTimeout(hideTimer)
    hideTimer = 0
  }

  const scheduleHide = (delay?: number) => {
    if (hideTimer) return
    const current = operations.current()
    const timeout = Number.isFinite(delay)
      ? Number(delay)
      : current?.kind === 'overlay'
        ? (options.overlayLeaveDelay ?? 90)
        : (options.chatLeaveDelay ?? 180)
    hideTimer = setTimeout(() => {
      hideTimer = 0
      operations.clear()
    }, timeout)
  }

  const cancelPointerFrame = () => {
    if (!pointerFrame) return
    cancelFrame(pointerFrame)
    pointerFrame = 0
  }

  const updatePointer = (next: HoverPoint | null) => {
    if (!next) return
    pointer = next
    operations.updatePointer(next)
  }

  const clearForGuard = () => {
    cancelPointerFrame()
    if (operations.current()) operations.clear()
  }

  const onPointerOver = (event: PointerEvent) => {
    if (!operations.enabled()) return
    const point = pointerCoordinates(event)
    updatePointer(point)
    if (
      pathTouchesNativeDialog(eventComposedPath(event)) ||
      (point && pointTouchesNativeDialog(options.document, point.x, point.y)) ||
      operations.guard(event, point)
    ) {
      clearForGuard()
      return
    }

    const current = operations.current()
    if (point && current?.kind === 'overlay' && !operations.insideCurrentViewport(point)) {
      operations.clear()
    }
    const path = eventComposedPath(event)
    if (operations.isOwned(event.target)) return

    if (point && operations.insideCurrentFrozenZone(point)) {
      const entering = operations.nativeCandidateFromPath(path)
      const selected = operations.current()
      if (selected?.kind === 'overlay' && entering && entering !== selected.element) {
        event.stopImmediatePropagation()
      }
      cancelHide()
      return
    }

    const found = operations.findFromPath(path)
    const selected = operations.current()
    if (found && found.element !== selected?.element) {
      if (operations.select(found, point, event.target))
        operations.rememberNativeTarget(event.target)
      return
    }
    if (found && found.element === selected?.element) {
      operations.rememberNativeTarget(event.target)
      operations.holdCurrent(event.target)
      return
    }
    if (operations.pathBlocksSelection(path)) {
      if (selected) operations.clear()
      return
    }
    if (!point || !options.fallbackPointOnOver) return
    const pointFound = operations.findAtPoint(point)
    if (pointFound && pointFound.element !== operations.current()?.element) {
      operations.select(pointFound, point, event.target)
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!operations.enabled()) return
    const point = pointerCoordinates(event)
    updatePointer(point)
    if (
      pathTouchesNativeDialog(eventComposedPath(event)) ||
      (point && pointTouchesNativeDialog(options.document, point.x, point.y)) ||
      operations.guard(event, point)
    ) {
      clearForGuard()
      return
    }

    const current = operations.current()
    if (point && current?.kind === 'overlay' && !operations.insideCurrentViewport(point)) {
      operations.clear()
      return
    }

    operations.rememberNativeTarget(event.target)
    operations.holdCurrent(event.target)
    if (operations.isOwned(event.target)) {
      cancelHide()
      return
    }

    if (current?.kind === 'overlay' && current.frozen) {
      if (point && operations.insideCurrentFrozenZone(point)) cancelHide()
      else scheduleHide()
      return
    }

    if (current?.kind === 'chat' && operations.pathBlocksSelection(eventComposedPath(event))) {
      operations.clear()
      return
    }
    if (pointerFrame) return
    pointerFrame = requestFrame(() => {
      pointerFrame = 0
      if (pointTouchesNativeDialog(options.document, pointer.x, pointer.y)) {
        clearForGuard()
        return
      }
      const candidate = operations.findAtPoint(pointer)
      if (candidate) {
        cancelHide()
        if (candidate.element !== operations.current()?.element) {
          operations.select(candidate, pointer, event.target)
        }
      } else if (operations.current()?.kind === 'overlay') {
        scheduleHide()
      }
    })
  }

  const onPointerOut = (event: PointerEvent) => {
    if (operations.nativeIsReleasing()) return
    if (event.relatedTarget && pathTouchesNativeDialog([event.relatedTarget])) {
      operations.nativeExitWillProceed()
      clearForGuard()
      return
    }
    const current = operations.current()
    if (!current) return
    const next = event.relatedTarget
    if (operations.insideCurrentBody(next)) {
      if (current.kind === 'overlay' && current.element.contains(event.target as Node)) {
        operations.holdCurrent(event.target)
        event.stopImmediatePropagation()
        cancelHide()
      }
      return
    }

    const nextNative = operations.nativeCandidateFromTarget(next)
    if (
      current.kind === 'overlay' &&
      nextNative &&
      nextNative !== current.element &&
      current.element.contains(event.target as Node)
    ) {
      operations.nativeExitWillProceed()
      operations.clear()
      return
    }

    const point = pointerCoordinates(event)
    updatePointer(point)
    const path = eventComposedPath(event)
    const leavesCurrent = current.kind === 'overlay' && path.includes(current.element)
    if (point && current.kind === 'overlay' && !operations.insideCurrentViewport(point)) {
      if (leavesCurrent) operations.nativeExitWillProceed()
      operations.clear()
      return
    }
    if (point && operations.insideCurrentFrozenZone(point)) {
      if (leavesCurrent) {
        operations.holdCurrent(event.target)
        event.stopImmediatePropagation()
      }
      cancelHide()
      return
    }
    if (path.includes(current.element)) {
      operations.nativeExitWillProceed()
      scheduleHide()
    }
  }

  const onMouseOver = (event: MouseEvent) => {
    if (
      pathTouchesNativeDialog(eventComposedPath(event)) ||
      operations.guard(event, pointerCoordinates(event))
    ) {
      if (operations.current()) operations.clear()
      return
    }
    if (!options.nativeHoverBoundary || operations.current()?.kind !== 'overlay') return
    const point = pointerCoordinates(event)
    if (!point || !operations.insideCurrentFrozenZone(point)) return
    const entering = operations.nativeCandidateFromPath(eventComposedPath(event))
    if (entering && entering !== operations.current()?.element) event.stopImmediatePropagation()
  }

  const onMouseOut = (event: MouseEvent) => {
    if (operations.nativeIsReleasing()) return
    if (event.relatedTarget && pathTouchesNativeDialog([event.relatedTarget])) {
      operations.nativeExitWillProceed()
      clearForGuard()
      return
    }
    const current = operations.current()
    if (!options.nativeHoverBoundary || current?.kind !== 'overlay') {
      operations.rememberNativeTarget(event.target)
      return
    }
    const nextNative = operations.nativeCandidateFromTarget(event.relatedTarget)
    if (
      nextNative &&
      nextNative !== current.element &&
      current.element.contains(event.target as Node)
    ) {
      operations.nativeExitWillProceed()
      operations.clear()
      return
    }
    if (
      operations.insideCurrentBody(event.relatedTarget) &&
      current.element.contains(event.target as Node)
    ) {
      operations.holdCurrent(event.target)
      event.stopImmediatePropagation()
      cancelHide()
      return
    }
    if (!eventComposedPath(event).includes(current.element)) return
    const point = pointerCoordinates(event)
    updatePointer(point)
    if (point && operations.insideCurrentFrozenZone(point)) {
      operations.holdCurrent(event.target)
      event.stopImmediatePropagation()
      cancelHide()
    } else {
      operations.nativeExitWillProceed()
    }
  }

  const start = () => {
    if (started) return
    started = true
    options.document.addEventListener('pointerover', onPointerOver, true)
    options.document.addEventListener('mouseover', onMouseOver, true)
    options.document.addEventListener('pointermove', onPointerMove, true)
    options.document.addEventListener('pointerout', onPointerOut, true)
    options.document.addEventListener('mouseout', onMouseOut, true)
  }

  const destroy = () => {
    if (!started) return
    started = false
    cancelHide()
    cancelPointerFrame()
    options.document.removeEventListener('pointerover', onPointerOver, true)
    options.document.removeEventListener('mouseover', onMouseOver, true)
    options.document.removeEventListener('pointermove', onPointerMove, true)
    options.document.removeEventListener('pointerout', onPointerOut, true)
    options.document.removeEventListener('mouseout', onMouseOut, true)
  }

  const reset = () => {
    cancelHide()
    cancelPointerFrame()
  }

  return {
    cancelHide,
    destroy,
    onMouseOut,
    onMouseOver,
    onPointerMove,
    onPointerOut,
    onPointerOver,
    pointer: () => ({ ...pointer }),
    reset,
    scheduleHide,
    start,
  }
}

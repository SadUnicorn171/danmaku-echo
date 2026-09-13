import type { DanmakuDescriptor } from '../../core/types'

export type LiveCandidateKind = 'chat' | 'native-capsule' | 'overlay'

export interface LiveCandidateOrder {
  /** Smaller distance wins when pointer hit testing returns overlapping rows. */
  pointerDistance: number
  /** Later DOM paint order wins after z-index. */
  paintOrder: number
  /** Higher computed z-index wins before DOM order. */
  zIndex: number
}

export interface LiveCandidateDescriptor {
  element: Element
  kind: LiveCandidateKind
  order: LiveCandidateOrder
  source: DanmakuDescriptor['source']
}

export interface LiveCandidateCapabilities {
  chat: boolean
  nativeCapsule: boolean
  normalize: boolean
  overlay: boolean
}

export interface LiveCandidateAdapter {
  readonly capabilities: LiveCandidateCapabilities
  describe(candidate: LiveCandidateDescriptor): DanmakuDescriptor | null
  findFromPath(path: readonly EventTarget[]): LiveCandidateDescriptor | null
  normalize(candidate: LiveCandidateDescriptor): LiveCandidateDescriptor | null
}

export function stableCandidateOrder(
  element: Element,
  pointer?: { x: number; y: number },
): LiveCandidateOrder {
  const rect = element.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const pointerDistance = pointer
    ? Math.hypot(pointer.x - centerX, pointer.y - centerY)
    : Number.POSITIVE_INFINITY
  const rawZIndex = Number.parseInt(getComputedStyle(element).zIndex, 10)
  let paintOrder = 0
  let current: Element | null = element
  while (current?.previousElementSibling) {
    paintOrder += 1
    current = current.previousElementSibling
  }
  return {
    paintOrder,
    pointerDistance,
    zIndex: Number.isFinite(rawZIndex) ? rawZIndex : 0,
  }
}

export function compareLiveCandidates(
  first: LiveCandidateDescriptor,
  second: LiveCandidateDescriptor,
): number {
  return (
    second.order.zIndex - first.order.zIndex ||
    second.order.paintOrder - first.order.paintOrder ||
    first.order.pointerDistance - second.order.pointerDistance
  )
}

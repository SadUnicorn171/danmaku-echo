const PLUGIN_OWNED_SELECTOR = '[data-bcp-one-owned]'

export interface DouyuNativeHoverPointer {
  x?: number
  y?: number
}

function nativeHoverPath(candidate: HTMLElement, target: Element | null): Element[] {
  const start =
    target && candidate.contains(target) && !target.closest(PLUGIN_OWNED_SELECTOR)
      ? target
      : candidate
  const path: Element[] = []
  let current: Element | null = start

  while (current) {
    path.push(current)
    if (current === candidate) return path
    current = current.parentElement
  }

  return [candidate]
}

function nativeRelatedTarget(
  candidate: HTMLElement,
  relatedTarget: EventTarget | null,
): EventTarget | null {
  if (relatedTarget instanceof Node && !candidate.contains(relatedTarget)) {
    return relatedTarget
  }
  return candidate.parentElement || candidate.ownerDocument.documentElement
}

function dispatchNativeHoverExit(
  candidate: HTMLElement,
  target: Element | null,
  relatedTarget: EventTarget | null,
  pointer: DouyuNativeHoverPointer,
): void {
  const path = nativeHoverPath(candidate, target)
  const eventTarget = path[0]
  const view = candidate.ownerDocument.defaultView
  const MouseEventConstructor = view?.MouseEvent || MouseEvent
  const PointerEventConstructor = view?.PointerEvent
  const commonInit: MouseEventInit = {
    bubbles: true,
    cancelable: false,
    clientX: Number.isFinite(pointer.x) ? Number(pointer.x) : 0,
    clientY: Number.isFinite(pointer.y) ? Number(pointer.y) : 0,
    composed: true,
    relatedTarget,
  }

  eventTarget.dispatchEvent(
    PointerEventConstructor
      ? new PointerEventConstructor('pointerout', {
          ...commonInit,
          isPrimary: true,
          pointerId: 1,
          pointerType: 'mouse',
        })
      : new MouseEventConstructor('pointerout', commonInit),
  )
  for (const element of path) {
    element.dispatchEvent(
      PointerEventConstructor
        ? new PointerEventConstructor('pointerleave', {
            ...commonInit,
            bubbles: false,
            isPrimary: true,
            pointerId: 1,
            pointerType: 'mouse',
          })
        : new MouseEventConstructor('pointerleave', { ...commonInit, bubbles: false }),
    )
  }

  eventTarget.dispatchEvent(new MouseEventConstructor('mouseout', commonInit))
  for (const element of path) {
    element.dispatchEvent(
      new MouseEventConstructor('mouseleave', { ...commonInit, bubbles: false }),
    )
  }
}

/**
 * Douyu owns the actual pause/resume timeline. The extension keeps its
 * adjacent action bar inside the native hover body and completes native leave
 * chains that programmatic DOM moves do not emit. Native entry is always left
 * to the user's real mouse event; synthetic entry cannot pause Douyu's
 * script-driven transform renderer reliably.
 */
export class DouyuNativeHoverController {
  private candidate: HTMLElement | null = null
  private held = false
  private nativeTarget: Element | null = null
  private releasing = false

  get isReleasing(): boolean {
    return this.releasing
  }

  hold(target: EventTarget | null): void {
    this.remember(target)
    this.held = Boolean(this.candidate)
  }

  remember(target: EventTarget | null): void {
    if (
      target instanceof Element &&
      this.candidate?.contains(target) &&
      !target.closest(PLUGIN_OWNED_SELECTOR)
    ) {
      this.nativeTarget = target
    }
  }

  nativeExitWillProceed(): void {
    if (!this.releasing) {
      this.held = false
    }
  }

  release(
    relatedTarget: EventTarget | null = null,
    pointer: DouyuNativeHoverPointer = {},
  ): boolean {
    const candidate = this.candidate
    if (!candidate || !this.held || this.releasing) return false

    this.releasing = true
    try {
      dispatchNativeHoverExit(
        candidate,
        this.nativeTarget,
        nativeRelatedTarget(candidate, relatedTarget),
        pointer,
      )
      return true
    } finally {
      this.candidate = null
      this.held = false
      this.nativeTarget = null
      this.releasing = false
    }
  }

  reset(): void {
    this.candidate = null
    this.held = false
    this.nativeTarget = null
  }

  select(candidate: HTMLElement, target: EventTarget | null = null): void {
    this.candidate = candidate
    this.held = false
    this.nativeTarget = candidate
    this.remember(target)
  }
}

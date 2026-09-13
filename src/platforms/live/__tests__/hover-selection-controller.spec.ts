import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createHoverSelectionController,
  type HoverCandidate,
  type HoverPoint,
  type HoverSelectionOperations,
  type HoverSelectionSnapshot,
} from '../hover-selection-controller'

function createHarness() {
  let current: HoverSelectionSnapshot | null = null
  let clearCount = 0
  let selectCount = 0
  let guard = false
  let frozenZone = false
  let bodyTarget: EventTarget | null = null
  let pathCandidate: HoverCandidate | null = null
  let pointCandidate: HoverCandidate | null = null
  let nativeCandidate: Element | null = null
  let frameCallback: FrameRequestCallback | null = null
  let frameRequests = 0

  const operations: HoverSelectionOperations = {
    clear() {
      clearCount += 1
      current = null
    },
    current: () => current,
    enabled: () => true,
    findAtPoint: () => pointCandidate,
    findFromPath: () => pathCandidate,
    guard: () => guard,
    holdCurrent() {},
    insideCurrentBody: (target) => target === bodyTarget,
    insideCurrentFrozenZone: () => frozenZone,
    insideCurrentViewport: () => true,
    isOwned: () => false,
    nativeCandidateFromPath: () => nativeCandidate,
    nativeCandidateFromTarget: () => nativeCandidate,
    nativeExitWillProceed() {},
    nativeIsReleasing: () => false,
    pathBlocksSelection: () => false,
    rememberNativeTarget() {},
    select(candidate) {
      selectCount += 1
      current = { ...candidate, frozen: candidate.kind === 'overlay' }
      return true
    },
    updatePointer() {},
  }
  const controller = createHoverSelectionController({
    cancelFrame: () => {},
    document,
    fallbackPointOnOver: true,
    nativeHoverBoundary: true,
    operations,
    requestFrame(callback) {
      frameCallback = callback
      frameRequests += 1
      return frameRequests
    },
  })

  return {
    controller,
    counts: () => ({ clearCount, frameRequests, selectCount }),
    flushFrame() {
      const callback = frameCallback
      frameCallback = null
      callback?.(performance.now())
    },
    setBodyTarget: (target: EventTarget | null) => (bodyTarget = target),
    setCurrent: (value: HoverSelectionSnapshot | null) => (current = value),
    setFrozenZone: (value: boolean) => (frozenZone = value),
    setGuard: (value: boolean) => (guard = value),
    setNativeCandidate: (value: Element | null) => (nativeCandidate = value),
    setPathCandidate: (value: HoverCandidate | null) => (pathCandidate = value),
    setPointCandidate: (value: HoverCandidate | null) => (pointCandidate = value),
  }
}

function pointerEvent(type: string, target: Element, point: HoverPoint = { x: 20, y: 20 }) {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: point.x,
    clientY: point.y,
    relatedTarget: type.endsWith('out') ? target : null,
  })
  target.dispatchEvent(event)
  return event as PointerEvent
}

describe('HoverSelectionController', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('treats the action capsule and gap bridge as part of one hover body', () => {
    vi.useFakeTimers()
    const harness = createHarness()
    const row = document.createElement('div')
    const bridge = document.createElement('div')
    row.append(document.createElement('span'))
    document.body.append(row, bridge)
    harness.setCurrent({ element: row, frozen: true, kind: 'overlay' })
    harness.setBodyTarget(bridge)

    const event = new MouseEvent('pointerout', { relatedTarget: bridge }) as PointerEvent
    Object.defineProperty(event, 'target', { value: row.firstElementChild })
    harness.controller.onPointerOut(event)
    vi.advanceTimersByTime(500)

    expect(harness.counts().clearCount).toBe(0)
  })

  it('clears the current row when a pointer guard such as the radar UI wins', () => {
    const harness = createHarness()
    const row = document.createElement('div')
    harness.setCurrent({ element: row, frozen: false, kind: 'chat' })
    harness.setGuard(true)

    harness.controller.onPointerOver(pointerEvent('pointerover', row))

    expect(harness.counts().clearCount).toBe(1)
  })

  it('suppresses an overlapping native row while the selected row owns the point', () => {
    const harness = createHarness()
    const selected = document.createElement('div')
    const covered = document.createElement('div')
    document.body.append(selected, covered)
    harness.setCurrent({ element: selected, frozen: true, kind: 'overlay' })
    harness.setFrozenZone(true)
    harness.setNativeCandidate(covered)
    const event = pointerEvent('pointerover', covered)
    let stopped = false
    event.stopImmediatePropagation = () => {
      stopped = true
    }

    harness.controller.onPointerOver(event)

    expect(stopped).toBe(true)
    expect(harness.counts().selectCount).toBe(0)
  })

  it('coalesces rapid pointer moves and selects only the latest point candidate', () => {
    const harness = createHarness()
    const target = document.createElement('div')
    const candidate = document.createElement('div')
    document.body.append(target, candidate)
    harness.setPointCandidate({ element: candidate, kind: 'overlay' })

    harness.controller.onPointerMove(pointerEvent('pointermove', target, { x: 10, y: 10 }))
    harness.controller.onPointerMove(pointerEvent('pointermove', target, { x: 30, y: 30 }))

    expect(harness.counts().frameRequests).toBe(1)
    harness.flushFrame()
    expect(harness.counts().selectCount).toBe(1)
  })

  it.each(['pointerover', 'pointermove'])('releases frozen danmaku on native dialog %s', (type) => {
    const harness = createHarness()
    const row = document.createElement('div')
    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog')
    const button = document.createElement('button')
    dialog.append(button)
    document.body.append(row, dialog)
    harness.setCurrent({ element: row, frozen: true, kind: 'overlay' })
    harness.setFrozenZone(true)
    harness.setPointCandidate({ element: row, kind: 'overlay' })
    harness.controller.start()

    const event = pointerEvent(type, button)
    harness.flushFrame()

    expect(harness.counts().clearCount).toBe(1)
    expect(harness.counts().selectCount).toBe(0)
    expect(event.defaultPrevented).toBe(false)
    harness.controller.destroy()
  })
  it('installs and removes its pointer listeners idempotently', () => {
    const harness = createHarness()
    const row = document.createElement('div')
    document.body.append(row)
    harness.setPathCandidate({ element: row, kind: 'chat' })
    harness.controller.start()
    harness.controller.start()

    pointerEvent('pointerover', row)
    expect(harness.counts().selectCount).toBe(1)

    harness.controller.destroy()
    harness.controller.destroy()
    harness.setCurrent(null)
    pointerEvent('pointerover', row)
    expect(harness.counts().selectCount).toBe(1)
  })
})

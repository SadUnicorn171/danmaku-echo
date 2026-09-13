import { afterEach, describe, expect, it } from 'vitest'

import type { ContentOverlayHandle, OverlayCallbacks } from '../../../components/live/content-overlay'
import { CapsuleController, type CapsuleAnchor } from '../capsule-controller'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function createOverlayFactory(actionRect: () => DOMRect) {
  let callbacks: OverlayCallbacks | null = null
  let hidden = false
  const portal = document.createElement('div')
  const actionBar = document.createElement('div')
  actionBar.className = 'bcp-one-actions'
  actionBar.getBoundingClientRect = actionRect
  portal.append(actionBar)

  const factory = (nextCallbacks: OverlayCallbacks): ContentOverlayHandle => {
    callbacks = nextCallbacks
    return {
      actionBar: () => actionBar,
      destroy() {
        portal.remove()
      },
      ensureHost(host) {
        host.append(portal)
        return portal
      },
      hideActionBar() {
        hidden = true
      },
      plusOneButton: () => null,
      portal,
      setActions() {},
      setCooldown() {},
      setSending() {},
      showActionBar() {
        hidden = false
      },
      showToast() {},
    }
  }
  return {
    callbacks: () => callbacks,
    factory,
    hidden: () => hidden,
    portal,
  }
}

function createController(anchor: () => CapsuleAnchor | null, overlay: ReturnType<typeof createOverlayFactory>) {
  return new CapsuleController({
    anchor,
    callbacks: {
      onCopy() {},
      onFavorite() {},
      onPlaceholder() {},
      onPlusOne() {},
      onPointerEnter() {},
      onPointerLeave() {},
    },
    document,
    fullscreenHost: () => null,
    overlayFactory: overlay.factory,
    viewport: () => rect(0, 0, 500, 300),
  })
}

describe('CapsuleController', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    document.querySelectorAll('[data-bcp-one-owned]').forEach((element) => element.remove())
    document.body.replaceChildren()
  })

  it('places the capsule left until the complete message has enough right-side space', () => {
    let messageRect = rect(410, 20, 70, 30)
    const candidate = document.createElement('div')
    candidate.getBoundingClientRect = () => messageRect
    document.body.append(candidate)
    const overlay = createOverlayFactory(() => rect(0, 0, 100, 28))
    const controller = createController(
      () => ({ candidate, kind: 'overlay', overlayViewport: rect(0, 0, 500, 300), positionTarget: candidate }),
      overlay,
    )
    controller.ensure()

    controller.updatePosition()
    const actionBar = overlay.portal.querySelector<HTMLElement>('.bcp-one-actions')!
    expect(actionBar.dataset.bcpOverlaySide).toBe('left')
    expect(actionBar.style.left).toBe('302px')

    messageRect = rect(100, 20, 70, 30)
    controller.updatePosition()
    expect(actionBar.dataset.bcpOverlaySide).toBe('right')
    expect(actionBar.style.left).toBe('178px')
  })

  it('keeps right-side anchoring stable when the capsule width changes', () => {
    let width = 100
    const candidate = document.createElement('div')
    candidate.getBoundingClientRect = () => rect(100, 20, 70, 30)
    document.body.append(candidate)
    const overlay = createOverlayFactory(() => rect(0, 0, width, 28))
    const controller = createController(
      () => ({ candidate, kind: 'overlay', overlayViewport: rect(0, 0, 500, 300), positionTarget: candidate }),
      overlay,
    )
    controller.ensure()
    controller.updatePosition()
    const actionBar = overlay.portal.querySelector<HTMLElement>('.bcp-one-actions')!
    expect(actionBar.style.left).toBe('178px')

    width = 150
    controller.updatePosition()
    expect(actionBar.style.left).toBe('178px')
  })

  it('mounts a pointer-active bridge between the message and action capsule', () => {
    let entered = 0
    const candidate = document.createElement('div')
    candidate.getBoundingClientRect = () => rect(100, 20, 70, 30)
    document.body.append(candidate)
    const overlay = createOverlayFactory(() => rect(0, 0, 100, 28))
    const controller = new CapsuleController({
      anchor: () => ({
        candidate,
        kind: 'overlay',
        overlayViewport: rect(0, 0, 500, 300),
        positionTarget: candidate,
      }),
      callbacks: {
        onCopy() {},
        onFavorite() {},
        onPlaceholder() {},
        onPlusOne() {},
        onPointerEnter() {
          entered += 1
        },
        onPointerLeave() {},
      },
      document,
      fullscreenHost: () => null,
      overlayFactory: overlay.factory,
      viewport: () => rect(0, 0, 500, 300),
    })
    controller.ensure()
    controller.updatePosition()

    const bridge = document.querySelector<HTMLElement>('.bcp-one-hover-bridge')!
    bridge.dispatchEvent(new Event('pointerenter'))
    expect(entered).toBe(1)
    expect(controller.contains(bridge)).toBe(true)
  })

  it('moves the portal to the current fullscreen host', () => {
    const firstHost = document.createElement('section')
    const fullscreenHost = document.createElement('section')
    document.body.append(firstHost, fullscreenHost)
    let host: Element | null = firstHost
    const overlay = createOverlayFactory(() => rect(0, 0, 100, 28))
    const controller = new CapsuleController({
      anchor: () => null,
      callbacks: {
        onCopy() {},
        onFavorite() {},
        onPlaceholder() {},
        onPlusOne() {},
        onPointerEnter() {},
        onPointerLeave() {},
      },
      document,
      fullscreenHost: () => host,
      overlayFactory: overlay.factory,
      viewport: () => rect(0, 0, 500, 300),
    })

    controller.ensure()
    expect(overlay.portal.parentElement).toBe(firstHost)
    host = fullscreenHost
    controller.ensure()
    expect(overlay.portal.parentElement).toBe(fullscreenHost)
  })
})

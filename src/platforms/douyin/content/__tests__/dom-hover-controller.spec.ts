import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DouyinOverlayCallbacks,
  DouyinOverlayHandle,
} from '../../../../components/live/douyin-overlay'
import {
  createDouyinDomHoverController,
  type DouyinDomHoverControllerOptions,
  type DouyinRichPayload,
} from '../dom-hover-controller'

function payload(element: Element): DouyinRichPayload {
  const text = element.getAttribute('data-message') || element.textContent || ''
  return { assets: [], parts: [{ text, type: 'text' }], plainText: text, text }
}

function setRect(
  element: Element,
  rect: { height: number; left: number; top: number; width: number },
): void {
  element.getBoundingClientRect = vi.fn<() => DOMRect>(() => ({
    ...rect,
    bottom: rect.top + rect.height,
    right: rect.left + rect.width,
    toJSON: () => ({}),
    x: rect.left,
    y: rect.top,
  }))
}

function makeDanmaku(message: string, left: number): HTMLElement {
  const element = document.createElement('div')
  element.dataset.e2e = 'danmaku-item'
  element.dataset.message = message
  element.textContent = message
  setRect(element, { height: 30, left, top: 20, width: 120 })
  return element
}

function pointerMove(target: Element, clientX: number, clientY: number): void {
  const event = new MouseEvent('pointermove', { bubbles: true, clientX, clientY })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  target.dispatchEvent(event)
}

function fixture() {
  const player = document.createElement('main')
  player.dataset.e2e = 'live-player'
  const first = makeDanmaku('第一条弹幕', 20)
  const second = makeDanmaku('第二条弹幕', 220)
  player.append(first, second)

  const chat = document.createElement('aside')
  chat.dataset.e2e = 'chat-message-list'
  const chatMessage = document.createElement('div')
  chatMessage.dataset.e2e = 'chat-message'
  chatMessage.dataset.message = '侧聊消息'
  chatMessage.textContent = '侧聊消息'
  chat.append(chatMessage)
  document.body.append(player, chat)
  return { chatMessage, first, second }
}

function createHarness(overrides: Partial<DouyinDomHoverControllerOptions> = {}) {
  const card = document.createElement('div')
  card.className = 'bcp-douyin-card'
  card.dataset.bcpDouyinOwned = 'true'
  setRect(card, { height: 40, left: 160, top: 15, width: 120 })
  const portal = document.createElement('div')
  portal.dataset.bcpDouyinOwned = 'true'
  portal.append(card)
  let callbacks: DouyinOverlayCallbacks | null = null
  const prepareCard = vi.fn<DouyinOverlayHandle['prepareCard']>()
  const hideCard = vi.fn<DouyinOverlayHandle['hideCard']>()
  const destroy = vi.fn<DouyinOverlayHandle['destroy']>(() => portal.remove())
  const createOverlay = vi.fn<(value: DouyinOverlayCallbacks) => DouyinOverlayHandle>((value) => {
    callbacks = value
    return {
      card: () => card,
      destroy,
      dismissToast: vi.fn<DouyinOverlayHandle['dismissToast']>(),
      ensureHost(host) {
        host.append(portal)
        return portal
      },
      hideCard,
      plusOneButton: () => null,
      portal,
      positionCard: vi.fn<DouyinOverlayHandle['positionCard']>(),
      prepareCard,
      setActions: vi.fn<DouyinOverlayHandle['setActions']>(),
      setCooldown: vi.fn<DouyinOverlayHandle['setCooldown']>(),
      setSelectionPhase: vi.fn<DouyinOverlayHandle['setSelectionPhase']>(),
      setSending: vi.fn<DouyinOverlayHandle['setSending']>(),
      showToast: vi.fn<DouyinOverlayHandle['showToast']>(),
    }
  })
  const controller = createDouyinDomHoverController({
    actions: () => ({ copy: true, favorite: true, plusOne: true, reply: true }),
    cooldownForMessage: () => 0,
    createOverlay,
    enabled: () => true,
    eventTouchesReminder: () => false,
    host: () => document.documentElement,
    isPlausibleMessage: (message) => Boolean(message),
    maxLength: 1_000,
    onCopy: vi.fn<(event: MouseEvent) => void>(),
    onFavorite: vi.fn<(event: MouseEvent) => void>(),
    onPlaceholder: vi.fn<(event: MouseEvent, action: 'reply') => void>(),
    onPlusOne: vi.fn<(event: MouseEvent) => void>(),
    payloadFromChatRow: payload,
    payloadFromElement: payload,
    pointTouchesReminder: () => false,
    senderForMessage: () => '测试用户',
    visible: () => true,
    ...overrides,
  })
  return {
    callbacks: () => callbacks,
    card,
    controller,
    createOverlay,
    destroy,
    hideCard,
    prepareCard,
  }
}

let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 1

function flushFrames(): void {
  while (frames.size) {
    const pending = [...frames.entries()]
    frames.clear()
    pending.forEach(([, callback]) => callback(performance.now()))
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.replaceChildren()
  frames = new Map()
  nextFrame = 1
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn<(callback: FrameRequestCallback) => number>((callback) => {
      const id = nextFrame++
      frames.set(id, callback)
      return id
    }),
  )
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn<(id: number) => void>((id) => {
      frames.delete(id)
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Douyin DOM hover controller', () => {
  it('selects video text but never treats the side-chat column as a capsule candidate', () => {
    const { chatMessage, first } = fixture()
    const harness = createHarness()
    harness.controller.start()

    pointerMove(chatMessage, 10, 10)
    flushFrames()
    expect(harness.controller.current()).toBeNull()

    pointerMove(first, 40, 30)
    flushFrames()
    expect(harness.controller.current()?.message).toBe('第一条弹幕')
    expect(harness.prepareCard).toHaveBeenCalledTimes(1)
    harness.controller.destroy()
  })

  it('keeps one selection across the text-to-capsule gap and capsule itself', () => {
    const { first } = fixture()
    const harness = createHarness()
    harness.controller.start()
    pointerMove(first, 130, 30)
    flushFrames()
    vi.advanceTimersByTime(2_600)

    pointerMove(document.body, 151, 30)
    flushFrames()
    vi.advanceTimersByTime(700)
    expect(harness.controller.current()?.message).toBe('第一条弹幕')

    pointerMove(harness.card, 180, 30)
    flushFrames()
    harness.callbacks()?.onCardEnter()
    expect(harness.controller.current()?.message).toBe('第一条弹幕')
    expect(harness.controller.snapshot().selectionPhase).toBe('engaged')
    expect(harness.prepareCard).toHaveBeenCalledTimes(1)
    harness.controller.destroy()
  })

  it('blocks the underlying danmaku when the radar reminder owns the pointer', () => {
    const { first } = fixture()
    const harness = createHarness({ eventTouchesReminder: () => true })
    harness.controller.start()

    pointerMove(first, 40, 30)
    flushFrames()
    expect(harness.controller.current()).toBeNull()
    expect(harness.createOverlay).not.toHaveBeenCalled()
    harness.controller.destroy()
  })

  it('coalesces rapid pointer moves and selects only the newest candidate', () => {
    const { first, second } = fixture()
    const harness = createHarness()
    harness.controller.start()

    pointerMove(first, 40, 30)
    pointerMove(second, 240, 30)
    expect(harness.controller.current()).toBeNull()
    flushFrames()

    expect(harness.controller.current()?.message).toBe('第二条弹幕')
    expect(harness.prepareCard).toHaveBeenCalledTimes(1)
    harness.controller.destroy()
  })

  it('does not switch to an overlapping candidate while one selection is active', () => {
    const { first, second } = fixture()
    const harness = createHarness()
    harness.controller.start()
    pointerMove(first, 40, 30)
    flushFrames()
    vi.advanceTimersByTime(2_600)

    pointerMove(second, 240, 30)
    flushFrames()
    expect(harness.controller.current()?.message).toBe('第一条弹幕')
    expect(harness.prepareCard).toHaveBeenCalledTimes(1)
    harness.controller.destroy()
  })

  it('cancels hover timers, animation frames, listeners and overlay on destroy', () => {
    const { first } = fixture()
    const harness = createHarness()
    harness.controller.start()
    pointerMove(first, 40, 30)
    flushFrames()
    expect(harness.controller.snapshot().timers).toBeGreaterThan(0)

    harness.controller.destroy()
    expect(harness.controller.snapshot()).toMatchObject({
      candidate: null,
      selectionPhase: 'idle',
      timers: 0,
      visible: false,
    })
    expect(harness.destroy).toHaveBeenCalledTimes(1)

    pointerMove(first, 40, 30)
    flushFrames()
    expect(harness.controller.current()).toBeNull()
  })

  it('keeps lock, sticky, hide and pointer-frame ownership outside the entry', () => {
    const source = readFileSync(
      resolvePath(process.cwd(), 'src', 'platforms', 'douyin', 'content', 'content-app.ts'),
      'utf8',
    )

    expect(source).toContain('createDouyinDomHoverController')
    expect(source).not.toMatch(/CARD_(?:LOCK_TIME|STICKY_TIME|HIDE_DELAY)/u)
    expect(source).not.toMatch(/state\.(?:cardHovered|lockedUntil|hideTimer|expiryTimer)/u)
    expect(source).not.toMatch(/function\s+(?:showCard|positionCard|processPointerMove)\s*\(/u)
  })
})

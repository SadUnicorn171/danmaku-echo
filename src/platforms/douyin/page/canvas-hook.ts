import type { RendererInstance, TimestampMilliseconds } from './runtime-types'

type CanvasTransferMethod = (this: HTMLCanvasElement) => OffscreenCanvas

interface CanvasPatchOwner {
  observeTransfer: (canvas: HTMLCanvasElement, offscreen: OffscreenCanvas) => void
}

interface CanvasPatchRecord {
  original: CanvasTransferMethod
  owners: Set<CanvasPatchOwner>
  wrapper: CanvasTransferMethod
}

export interface DouyinCanvasTransferEvent {
  canvas: HTMLCanvasElement
  canvasId: number
  connected: boolean
  height: number
  marker: string
  observedAt: TimestampMilliseconds
  offscreen: OffscreenCanvas
  width: number
}

export interface DouyinCanvasHookDiagnostics {
  ignoredTransferCount: number
  installed: boolean
  lastTransferAt: TimestampMilliseconds | 0
  reusedPatch: boolean
  transferCount: number
}

export interface DouyinCanvasHookOptions {
  canvasConstructor?: typeof HTMLCanvasElement
  document?: Document
  onTransfer?: (event: DouyinCanvasTransferEvent) => void
}

export interface DouyinCanvasHook {
  canvasForOffscreen: (value: unknown) => HTMLCanvasElement | null
  canvasId: (canvas: HTMLCanvasElement) => number
  destroy: () => void
  diagnostics: () => DouyinCanvasHookDiagnostics
  findUnclaimedCanvas: (claimed: Iterable<HTMLCanvasElement>) => HTMLCanvasElement | null
  install: () => boolean
  isDanmakuCanvas: (value: unknown) => value is HTMLCanvasElement
  markerFor: (element: Element | null) => string
}

const CANVAS_PATCH_KEY = Symbol.for('danmaku-echo.douyin.canvas-transfer-patch')
const DANMAKU_MARKER_PATTERN = /(danmaku|danmu|barrage|bullet)/iu

function isPatchRecord(value: unknown): value is CanvasPatchRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CanvasPatchRecord>
  return (
    typeof candidate.original === 'function' &&
    candidate.owners instanceof Set &&
    typeof candidate.wrapper === 'function'
  )
}

export function createDouyinCanvasHook(options: DouyinCanvasHookOptions = {}): DouyinCanvasHook {
  const documentRef = options.document ?? document
  const Canvas = options.canvasConstructor ?? HTMLCanvasElement
  const prototype = Canvas.prototype
  const prototypeSlot = prototype as unknown as Record<PropertyKey, unknown>
  const offscreenSources = new WeakMap<object, HTMLCanvasElement>()
  const canvasIds = new WeakMap<HTMLCanvasElement, number>()
  let nextCanvasId = 1
  let installedRecord: CanvasPatchRecord | null = null
  const state: DouyinCanvasHookDiagnostics = {
    ignoredTransferCount: 0,
    installed: false,
    lastTransferAt: 0,
    reusedPatch: false,
    transferCount: 0
  }

  const markerFor = (element: Element | null): string => {
    if (!(element instanceof Element)) return ''
    const className = typeof element.className === 'string' ? element.className : ''
    return [element.id, className, element.getAttribute('data-e2e')].filter(Boolean).join(' ')
  }

  const isDanmakuCanvas = (value: unknown): value is HTMLCanvasElement => {
    if (!(value instanceof Canvas)) return false
    let current: Element | null = value
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      if (DANMAKU_MARKER_PATTERN.test(markerFor(current))) return true
    }
    return false
  }

  const canvasId = (canvas: HTMLCanvasElement): number => {
    const existing = canvasIds.get(canvas)
    if (existing !== undefined) return existing
    const id = nextCanvasId
    nextCanvasId += 1
    canvasIds.set(canvas, id)
    return id
  }

  const owner: CanvasPatchOwner = {
    observeTransfer(canvas, offscreen) {
      if (!isDanmakuCanvas(canvas)) {
        state.ignoredTransferCount += 1
        return
      }
      offscreenSources.set(offscreen, canvas)
      state.transferCount += 1
      state.lastTransferAt = Date.now()
      options.onTransfer?.({
        canvas,
        canvasId: canvasId(canvas),
        connected: canvas.isConnected,
        height: canvas.height,
        marker: markerFor(canvas.parentElement),
        observedAt: state.lastTransferAt,
        offscreen,
        width: canvas.width
      })
    }
  }

  const install = (): boolean => {
    if (state.installed) return true
    const slot = prototypeSlot
    const sharedRecord = slot[CANVAS_PATCH_KEY]
    if (isPatchRecord(sharedRecord) && prototype.transferControlToOffscreen === sharedRecord.wrapper) {
      sharedRecord.owners.add(owner)
      installedRecord = sharedRecord
      state.installed = true
      state.reusedPatch = true
      return true
    }
    const original = prototype.transferControlToOffscreen
    if (typeof original !== 'function') return false
    const owners = new Set<CanvasPatchOwner>()
    const wrapper: CanvasTransferMethod = function danmakuEchoTransferControlToOffscreen() {
      const offscreen = Reflect.apply(original, this, []) as OffscreenCanvas
      if (offscreen && typeof offscreen === 'object') {
        owners.forEach((subscriber) => subscriber.observeTransfer(this, offscreen))
      }
      return offscreen
    }
    const record: CanvasPatchRecord = { original, owners, wrapper }
    owners.add(owner)
    Object.defineProperty(prototype, 'transferControlToOffscreen', {
      configurable: true,
      value: wrapper,
      writable: true
    })
    Object.defineProperty(slot, CANVAS_PATCH_KEY, {
      configurable: true,
      value: record
    })
    installedRecord = record
    state.installed = true
    return true
  }

  return {
    canvasForOffscreen(value) {
      return value && typeof value === 'object' ? offscreenSources.get(value) ?? null : null
    },
    canvasId,
    destroy() {
      if (!state.installed || !installedRecord) return
      installedRecord.owners.delete(owner)
      if (
        installedRecord.owners.size === 0 &&
        prototype.transferControlToOffscreen === installedRecord.wrapper
      ) {
        Object.defineProperty(prototype, 'transferControlToOffscreen', {
          configurable: true,
          value: installedRecord.original,
          writable: true
        })
        delete prototypeSlot[CANVAS_PATCH_KEY]
      }
      installedRecord = null
      state.installed = false
      state.reusedPatch = false
    },
    diagnostics: () => ({ ...state }),
    findUnclaimedCanvas(claimed) {
      const claimedCanvases = new Set(claimed)
      return (
        Array.from(documentRef.querySelectorAll('canvas'))
          .reverse()
          .find((canvas) => isDanmakuCanvas(canvas) && !claimedCanvases.has(canvas)) ?? null
      )
    },
    install,
    isDanmakuCanvas,
    markerFor
  }
}

export function rendererCanvases(instances: Iterable<RendererInstance>): Set<HTMLCanvasElement> {
  return new Set(Array.from(instances, (instance) => instance.canvas))
}

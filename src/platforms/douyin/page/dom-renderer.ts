import { numberOr, rendererBox, rendererPaint, type SerializedBarrageItem } from '../barrage-model'
import { trackRect, type CanvasRectLike } from './track-motion'
import type { RendererCapsuleLayout, RendererTrackController } from './track-controller'
import type {
  RendererInstance,
  RendererTrack,
  RendererTrackDomState,
  TimestampMilliseconds,
} from './runtime-types'

export interface DouyinDomRendererEvent {
  details: Record<string, number | string>
  level?: 'info'
  type: 'renderer-canvas-restored' | 'renderer-node-created' | 'renderer-takeover'
}

export interface DouyinDomRendererOptions {
  actionGap: number
  actionTrailingSpace: number
  beforeShutdown: (instance: RendererInstance) => void
  document: Document
  getComputedStyle: (element: Element) => CSSStyleDeclaration
  nodeLimit: number
  onEvent?: (event: DouyinDomRendererEvent) => void
  trackController: RendererTrackController
}

export interface RendererTrackLayoutSnapshot extends RendererCapsuleLayout {
  track: RendererTrack
}

interface RendererNoopFrameSnapshot {
  action: 'noop'
  instance: RendererInstance
}

interface RendererRestoreFrameSnapshot {
  action: 'restore'
  instance: RendererInstance
  reason: string
}

interface RendererShutdownFrameSnapshot {
  action: 'shutdown'
  instance: RendererInstance
  reason: string
}

interface RendererCommitFrameSnapshot {
  action: 'commit'
  borderRadius: string
  canvasRect: CanvasRectLike
  geometryKey: string
  instance: RendererInstance
  layouts: RendererTrackLayoutSnapshot[]
  mount: Element
}

export type RendererFrameSnapshot =
  | RendererCommitFrameSnapshot
  | RendererNoopFrameSnapshot
  | RendererRestoreFrameSnapshot
  | RendererShutdownFrameSnapshot

export interface ReadRendererFrameOptions {
  enabled: boolean
  now: TimestampMilliseconds
}

export interface DouyinDomRenderer {
  commitFrame(snapshot: RendererFrameSnapshot): void
  invalidateGeometry(instance: RendererInstance): void
  markTrackOwn(track: RendererTrack): void
  readFrame(
    instance: RendererInstance,
    canvasRect: CanvasRectLike,
    options: ReadRendererFrameOptions,
  ): RendererFrameSnapshot
  refreshTrackMetadata(track: RendererTrack): void
  removeTrack(track: RendererTrack): void
  restoreCanvas(instance: RendererInstance, reason: string): void
  shutdown(instance: RendererInstance, reason: string): void
}

function geometryKey(rect: CanvasRectLike): string {
  return [rect.left, rect.top, rect.width, rect.height]
    .map((value) => Math.round(numberOr(value, 0) * 100) / 100)
    .join('|')
}

function instanceIsSafe(instance: RendererInstance, now: TimestampMilliseconds): boolean {
  return (
    instance.rendererSafeSync ||
    now >= numberOr(instance.rendererSafeAfter, Number.POSITIVE_INFINITY)
  )
}

function messageId(track: RendererTrack): string {
  return String(track.options.id == null ? track.id : track.options.id)
}

function setMetadata(element: HTMLElement, track: RendererTrack): void {
  element.dataset.track = String(track.id)
  element.dataset.trackId = String(track.id)
  element.dataset.instance = String(track.instance.id)
  element.dataset.instanceId = String(track.instance.id)
  element.dataset.message = track.description.text
  element.dataset.messageId = messageId(track)
  if (track.sender) element.dataset.sender = track.sender
  else delete element.dataset.sender
}

interface RendererContentStyle {
  backgroundColor?: unknown
  borderColor?: unknown
  borderRadius?: unknown
  borderWidth?: unknown
  color?: unknown
  fontFamily?: unknown
  fontSize?: unknown
  fontWeight?: unknown
  height?: unknown
  margin?: unknown
  opacity?: unknown
  padding?: unknown
  strokeColor?: unknown
  strokeWidth?: unknown
  type?: string
  width?: unknown
}

function applyContentStyle(element: HTMLElement, item: RendererContentStyle): void {
  if (Number.isFinite(Number(item.fontSize))) {
    element.style.fontSize = `${Math.max(8, Math.min(96, Number(item.fontSize)))}px`
  }
  if (item.type !== 'image' && Number.isFinite(Number(item.width))) {
    element.style.width = `${Math.max(0, Math.min(1_000, Number(item.width)))}px`
  }
  if (item.type !== 'image' && Number.isFinite(Number(item.height))) {
    element.style.height = `${Math.max(0, Math.min(500, Number(item.height)))}px`
  }
  if (item.fontWeight != null) element.style.fontWeight = String(item.fontWeight).slice(0, 100)
  if (item.fontFamily != null) element.style.fontFamily = String(item.fontFamily).slice(0, 100)

  const color = rendererPaint(item.color, false)
  if (color) element.style.color = color
  const background = rendererPaint(item.backgroundColor, true)
  if (background) {
    if (/gradient\(/iu.test(background)) element.style.backgroundImage = background
    else element.style.backgroundColor = background
  }
  const stroke = rendererPaint(item.strokeColor, false)
  const strokeWidth = Math.max(0, Math.min(8, numberOr(item.strokeWidth, 0)))
  if (stroke && strokeWidth) {
    element.style.webkitTextStroke = `${strokeWidth}px ${stroke}`
    element.style.paintOrder = 'stroke fill'
  }
  const borderColor = rendererPaint(item.borderColor, false)
  const borderWidth = Math.max(0, Math.min(12, numberOr(item.borderWidth, 0)))
  if (borderColor && borderWidth) element.style.border = `${borderWidth}px solid ${borderColor}`
  if (item.margin != null) element.style.margin = rendererBox(item.margin)
  if (item.padding != null) element.style.padding = rendererBox(item.padding)
  if (Number.isFinite(Number(item.borderRadius))) {
    element.style.borderRadius = `${Math.max(0, Math.min(100, Number(item.borderRadius)))}px`
  }
  if (Number.isFinite(Number(item.opacity))) {
    element.style.opacity = String(Math.max(0, Math.min(1, Number(item.opacity))))
  }
}

function createContent(
  document: Document,
  item: SerializedBarrageItem,
  depth: number,
): HTMLElement | null {
  if (depth > 6) return null
  let element: HTMLImageElement | HTMLSpanElement
  if (item.type === 'image' && typeof item.src === 'string') {
    const image = document.createElement('img')
    image.src = item.src
    image.alt = ''
    image.draggable = false
    image.style.display = 'inline-block'
    image.style.objectFit = 'contain'
    const fallbackSize = Math.max(8, Math.min(96, numberOr(item.fontSize, 20)))
    const width = numberOr(item.width, numberOr(item.height, fallbackSize))
    const height = numberOr(item.height, numberOr(item.width, fallbackSize))
    image.style.width = `${Math.max(1, Math.min(500, width))}px`
    image.style.height = `${Math.max(1, Math.min(200, height))}px`
    element = image
  } else {
    const span = document.createElement('span')
    if (item.type === 'text') {
      span.textContent = String(item.text == null ? '' : item.text).slice(0, 1_000)
      span.style.display = 'inline-block'
    } else {
      span.style.display = item.isInline ? 'inline-flex' : 'flex'
      span.style.alignItems = 'center'
      for (const child of item.content ?? []) {
        const childElement = createContent(document, child, depth + 1)
        if (childElement) span.append(childElement)
      }
    }
    element = span
  }
  element.style.boxSizing = 'border-box'
  element.style.flexShrink = '0'
  applyContentStyle(element, item)
  return element
}

export function createDouyinDomRenderer(options: DouyinDomRendererOptions): DouyinDomRenderer {
  const emit = (event: DouyinDomRendererEvent): void => options.onEvent?.(event)

  const refreshTrackMetadata = (track: RendererTrack): void => {
    const state = track.renderer
    if (!state) return
    const elements = [
      state.node,
      state.barrage,
      state.actionBar,
      state.button,
      state.replyButton,
      state.favoriteButton,
      state.copyButton,
    ]
    elements.forEach((element) => setMetadata(element, track))
    const text = track.description.text
    state.button.setAttribute('aria-label', `发送相同弹幕：${text}`)
    state.replyButton.setAttribute('aria-label', `回复弹幕：${text}`)
    state.favoriteButton.setAttribute('aria-label', `收藏弹幕：${text}`)
    state.copyButton.setAttribute('aria-label', `复制弹幕：${text}`)
  }

  const createTrack = (track: RendererTrack, layer: HTMLDivElement): RendererTrackDomState => {
    const instance = track.instance
    if (instance.rendererNodes.size >= options.nodeLimit) {
      throw new Error(`renderer node limit exceeded (${options.nodeLimit})`)
    }
    const document = options.document
    const node = document.createElement('div')
    node.className = 'bcp-douyin-dom-track'
    node.dataset.bcpDouyinOwned = 'true'
    setMetadata(node, track)
    node.style.position = 'absolute'
    node.style.left = '0'
    node.style.top = '0'
    node.style.display = 'flex'
    node.style.alignItems = 'center'
    node.style.boxSizing = 'border-box'
    node.style.whiteSpace = 'nowrap'
    node.style.columnGap = `${options.actionGap}px`
    node.style.paddingRight = `${options.actionTrailingSpace}px`
    node.style.pointerEvents = 'auto'
    node.style.userSelect = 'none'
    node.style.webkitUserSelect = 'none'
    node.style.willChange = 'transform'
    node.style.contain = 'layout style'
    node.style.overflow = 'visible'

    const barrage = document.createElement('div')
    barrage.className = 'bcp-douyin-dom-barrage'
    barrage.dataset.bcpDouyinOwned = 'true'
    if (track.own) barrage.dataset.own = 'true'
    setMetadata(barrage, track)
    barrage.style.display = 'flex'
    barrage.style.alignItems = 'center'
    barrage.style.flex = '1 0 auto'
    barrage.style.flexShrink = '0'
    barrage.style.minWidth = '0'
    barrage.style.height = '100%'
    barrage.style.boxSizing = 'border-box'
    barrage.style.pointerEvents = 'none'
    barrage.style.padding = rendererBox(track.description.rendererPadding)

    const content = document.createElement('span')
    content.className = 'bcp-douyin-dom-content'
    content.style.display = 'flex'
    content.style.alignItems = 'center'
    content.style.flex = '1 1 auto'
    content.style.minWidth = '0'
    content.style.height = '100%'
    content.style.overflow = 'visible'
    content.style.pointerEvents = 'auto'
    const fragment = document.createDocumentFragment()
    track.content.forEach((item) => {
      const child = createContent(document, item, 0)
      if (child) fragment.append(child)
    })
    if (fragment.childNodes.length) content.append(fragment)
    else content.textContent = track.description.text
    applyContentStyle(content, track.description.firstText ?? {})

    const { actionBar, button, copyButton, favoriteButton, replyButton } =
      options.trackController.createCapsule()
    setMetadata(actionBar, track)

    barrage.append(content)
    node.append(barrage, actionBar)
    const state: RendererTrackDomState = {
      actionBar,
      actionSide: null,
      barrage,
      button,
      content,
      copyButton,
      favoriteButton,
      hovered: false,
      hoverTimer: 0,
      node,
      releaseTimer: 0,
      replyButton,
      sending: false,
      visualHeight: 0,
      visualLeft: null,
      visualWidth: 0,
    }
    track.renderer = state
    refreshTrackMetadata(track)
    options.trackController.connectTrack(track, state)
    instance.rendererNodes.set(track.id, node)
    layer.append(node)
    emit({
      details: { instanceId: String(instance.id), trackId: track.id },
      type: 'renderer-node-created',
    })
    return state
  }

  const restoreCanvas = (instance: RendererInstance, reason: string): void => {
    const canvas = instance.canvas
    if (instance.rendererOwnsCanvasVisibility) {
      canvas.style.visibility = instance.rendererCanvasVisibility
      delete canvas.dataset.bcpDouyinDomTakeover
      instance.rendererOwnsCanvasVisibility = false
      emit({
        details: { instanceId: String(instance.id), reason },
        type: 'renderer-canvas-restored',
      })
    }
    instance.rendererTakeover = false
    if (!instance.rendererBlocked && instance.lifecycle.state === 'active') {
      instance.lifecycle.state = 'observing'
    }
    if (instance.rendererLayer) {
      instance.rendererLayer.style.visibility = 'hidden'
      instance.rendererLayer.hidden = true
    }
  }

  const removeTrack = (track: RendererTrack): void => {
    const state = track.renderer
    if (!state) return
    options.trackController.disconnectTrack(track)
    state.node.remove()
    track.instance.rendererNodes.delete(track.id)
    track.renderer = null
  }

  const shutdown = (instance: RendererInstance, reason: string): void => {
    options.beforeShutdown(instance)
    Array.from(instance.tracks.values()).forEach(removeTrack)
    instance.rendererNodes.clear()
    restoreCanvas(instance, reason)
    instance.rendererLayer?.remove()
    instance.rendererLayer = null
    instance.rendererGeometryKey = ''
    instance.rendererBorderRadius = null
    instance.lifecycle.state = instance.rendererBlocked ? 'blocked' : 'suspended'
  }

  const ensureLayer = (snapshot: RendererCommitFrameSnapshot): HTMLDivElement => {
    const { instance } = snapshot
    let layer = instance.rendererLayer
    if (!layer) {
      layer = options.document.createElement('div')
      layer.className = 'bcp-douyin-dom-layer'
      layer.dataset.instance = String(instance.id)
      layer.dataset.instanceId = String(instance.id)
      layer.dataset.canvas = String(instance.canvasId)
      layer.dataset.canvasId = String(instance.canvasId)
      layer.dataset.bcpDouyinOwned = 'true'
      layer.style.position = 'fixed'
      layer.style.margin = '0'
      layer.style.padding = '0'
      layer.style.overflow = 'hidden'
      layer.style.pointerEvents = 'none'
      layer.style.contain = 'layout style'
      layer.style.isolation = 'isolate'
      layer.style.zIndex = '2147483646'
      layer.style.visibility = 'hidden'
      layer.hidden = true
      instance.rendererLayer = layer
      instance.rendererGeometryKey = ''
      instance.rendererBorderRadius = null
    }
    if (layer.parentElement !== snapshot.mount) {
      snapshot.mount.append(layer)
      instance.rendererGeometryKey = ''
    }
    if (instance.rendererBorderRadius !== snapshot.borderRadius) {
      layer.style.borderRadius = snapshot.borderRadius
      instance.rendererBorderRadius = snapshot.borderRadius
    }
    if (instance.rendererGeometryKey !== snapshot.geometryKey) {
      const { canvasRect } = snapshot
      layer.style.left = `${canvasRect.left}px`
      layer.style.top = `${canvasRect.top}px`
      layer.style.width = `${canvasRect.width}px`
      layer.style.height = `${canvasRect.height}px`
      instance.rendererGeometryKey = snapshot.geometryKey
    }
    return layer
  }

  const commitLayout = (
    state: RendererTrackDomState,
    layout: RendererTrackLayoutSnapshot,
  ): void => {
    state.actionSide = layout.actionSide
    state.node.dataset.bcpOverlaySide = layout.actionSide
    state.actionBar.dataset.bcpOverlaySide = layout.actionSide
    state.actionBar.style.order = layout.actionSide === 'left' ? '-1' : '1'
    state.barrage.style.order = '0'
    state.visualLeft = layout.visualLeft
    if (!state.hovered) {
      if (Math.abs(layout.width - state.visualWidth) > 0.1) {
        state.node.style.width = `${layout.width}px`
        state.visualWidth = layout.width
      }
      if (Math.abs(layout.height - state.visualHeight) > 0.1) {
        state.node.style.height = `${layout.height}px`
        state.visualHeight = layout.height
      }
    }
    state.node.style.transform = `translate3d(${state.visualLeft}px, ${layout.targetTop}px, 0)`
  }

  const takeOverCanvas = (instance: RendererInstance): void => {
    if (instance.rendererTakeover) return
    const layer = instance.rendererLayer
    if (
      !instance.canvas.isConnected ||
      !layer?.isConnected ||
      !instance.rendererNodes.size ||
      Array.from(instance.rendererNodes.values()).some((node) => !node.isConnected)
    ) {
      return
    }
    instance.rendererCanvasVisibility = instance.canvas.style.visibility
    instance.rendererOwnsCanvasVisibility = true
    layer.hidden = false
    layer.style.visibility = 'visible'
    instance.canvas.style.visibility = 'hidden'
    instance.canvas.dataset.bcpDouyinDomTakeover = 'true'
    instance.rendererTakeover = true
    instance.lifecycle.state = 'active'
    emit({
      details: {
        canvasId: instance.canvasId,
        instanceId: String(instance.id),
        nodeCount: instance.rendererNodes.size,
      },
      level: 'info',
      type: 'renderer-takeover',
    })
  }

  return {
    commitFrame(snapshot) {
      if (snapshot.action === 'noop') return
      if (snapshot.action === 'restore') {
        restoreCanvas(snapshot.instance, snapshot.reason)
        return
      }
      if (snapshot.action === 'shutdown') {
        shutdown(snapshot.instance, snapshot.reason)
        return
      }
      const layer = ensureLayer(snapshot)
      for (const layout of snapshot.layouts) {
        const state = layout.track.renderer ?? createTrack(layout.track, layer)
        if (!state.node.isConnected) {
          throw new Error('renderer barrage detached before takeover')
        }
        commitLayout(state, layout)
      }
      if (snapshot.instance.rendererNodes.size) takeOverCanvas(snapshot.instance)
    },
    invalidateGeometry(instance) {
      instance.rendererGeometryKey = ''
      instance.rendererBorderRadius = null
    },
    markTrackOwn(track) {
      if (track.renderer) track.renderer.barrage.dataset.own = 'true'
    },
    readFrame(instance, canvasRect, frameOptions) {
      const fullscreen = options.document.fullscreenElement
      if (fullscreen === instance.canvas) {
        return instance.rendererLayer || instance.rendererTakeover
          ? { action: 'shutdown', instance, reason: 'canvas-is-fullscreen-element' }
          : { action: 'noop', instance }
      }
      if (
        !frameOptions.enabled ||
        !instance.active ||
        instance.rendererBlocked ||
        !instanceIsSafe(instance, frameOptions.now)
      ) {
        return instance.rendererLayer || instance.rendererTakeover
          ? {
              action: 'shutdown',
              instance,
              reason: frameOptions.enabled ? 'unsafe-instance' : 'disabled',
            }
          : { action: 'noop', instance }
      }
      if (instance.rendererPreparing > 0) {
        return instance.rendererTakeover
          ? { action: 'restore', instance, reason: 'barrage-preparing' }
          : { action: 'noop', instance }
      }
      const mount =
        fullscreen instanceof Element &&
        fullscreen !== instance.canvas &&
        fullscreen.contains(instance.canvas)
          ? fullscreen
          : options.document.documentElement || options.document.body
      if (!(mount instanceof Element)) throw new Error('renderer mount is unavailable')
      let borderRadius = instance.rendererBorderRadius
      if (borderRadius == null) {
        try {
          borderRadius = options.getComputedStyle(instance.canvas).borderRadius || ''
        } catch {
          borderRadius = ''
        }
      }
      const layouts: RendererTrackLayoutSnapshot[] = []
      for (const track of instance.tracks.values()) {
        if (!track.bookedChannel) continue
        const barrageRect = trackRect(track, canvasRect)
        if (!barrageRect) continue
        layouts.push({
          ...options.trackController.layout(track, barrageRect, canvasRect),
          track,
        })
      }
      return {
        action: 'commit',
        borderRadius,
        canvasRect,
        geometryKey: geometryKey(canvasRect),
        instance,
        layouts,
        mount,
      }
    },
    refreshTrackMetadata,
    removeTrack,
    restoreCanvas,
    shutdown,
  }
}

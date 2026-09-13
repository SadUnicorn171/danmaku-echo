import { pointTouchesNativeDialog } from '../../../core/native-dialog-guard'
import type { ActionSettings } from '../../../core/types'
import { pointTouchesRepeatReminder } from '../../../features/repeat-reminder/pointer-guard'
import { numberOr, type SerializedBarrageItem } from '../barrage-model'
import type { DouyinPageToContentPayload, DouyinRendererContentPart } from '../protocol'
import { overlayCapsulePlacement } from '../../live/capsule-position'
import type { DouyinPageBridge } from './page-bridge'
import { pauseTrackMotion, resumeTrackMotion, type CanvasRectLike } from './track-motion'
import type {
  RendererFailureReason,
  RendererInstance,
  RendererTrack,
  RendererTrackDomState,
} from './runtime-types'

const ACTION_ORDER = ['plusOne', 'reply', 'favorite', 'copy'] as const

interface PendingTrackRequest {
  button: HTMLButtonElement
  cancelResponse: () => void
  track: RendererTrack
}

type RendererActivatePayload = Extract<DouyinPageToContentPayload, { type: 'renderer-activate' }>
type RendererCopyPayload = Extract<DouyinPageToContentPayload, { type: 'renderer-copy' }>
type RendererFavoritePayload = Extract<DouyinPageToContentPayload, { type: 'renderer-favorite' }>

export interface RendererCapsuleElements {
  actionBar: HTMLDivElement
  button: HTMLButtonElement
  copyButton: HTMLButtonElement
  favoriteButton: HTMLButtonElement
  replyButton: HTMLButtonElement
}

export interface RendererCapsuleLayout {
  actionSide: 'left' | 'right'
  height: number
  targetTop: number
  visualLeft: number
  width: number
}

export interface RendererTrackControllerSettings {
  actions: ActionSettings
  scale: number
}

export interface RendererTrackControllerUpdate {
  actionsChanged: boolean
  scaleChanged: boolean
  settings: RendererTrackControllerSettings
}

export interface RendererTrackControllerDiagnostics {
  hoveredTrackId: number | null
  pendingActivationCount: number
  pendingCopyCount: number
  pendingFavoriteCount: number
  started: boolean
}

export interface RendererTrackControllerMetric {
  type: 'activation' | 'result'
}

export interface RendererTrackControllerOptions {
  actionBaseHeight: number
  actionDividerWidth: number
  actionGap: number
  actionItemWidths: Record<keyof ActionSettings, number>
  actionTrailingSpace: number
  document: Document
  frozenTrackTimeout: number
  getBridge: () => DouyinPageBridge
  getDevicePixelRatio: () => number
  hoverLeaveGrace: number
  isEnabled: () => boolean
  onFailure: (instance: RendererInstance, reason: RendererFailureReason, error?: unknown) => void
  onMetric?: (metric: RendererTrackControllerMetric) => void
  requestTimeout: number
  target: Window
  touchesRepeatReminder?: (document: Document, clientX: number, clientY: number) => boolean
}

export interface RendererTrackController {
  actionHeight(): number
  actionWidth(): number
  clearInstance(instance: RendererInstance): void
  connectTrack(track: RendererTrack, state: RendererTrackDomState): void
  createCapsule(): RendererCapsuleElements
  destroy(): void
  diagnostics(): RendererTrackControllerDiagnostics
  disconnectTrack(track: RendererTrack): void
  hold(track: RendererTrack): void
  layout(
    track: RendererTrack,
    barrageRect: CanvasRectLike,
    canvasRect: CanvasRectLike,
  ): RendererCapsuleLayout
  release(track: RendererTrack): void
  releaseIfCoveredAt(clientX: number, clientY: number): boolean
  renderActionBar(state: RendererTrackDomState): void
  start(): void
  syncTrackAppearance(track: RendererTrack): void
  updateSettings(actions: unknown, scalePercent: unknown): RendererTrackControllerUpdate
}

export function normalizeRendererActions(value: unknown): ActionSettings {
  const actions = value && typeof value === 'object' ? (value as Partial<ActionSettings>) : {}
  return {
    copy: typeof actions.copy === 'boolean' ? actions.copy : false,
    favorite: typeof actions.favorite === 'boolean' ? actions.favorite : true,
    plusOne: typeof actions.plusOne === 'boolean' ? actions.plusOne : true,
    reply: typeof actions.reply === 'boolean' ? actions.reply : true,
  }
}

export function normalizeRendererCapsuleScale(value: unknown): number {
  const percent = Number(value)
  if (!Number.isFinite(percent)) return 1
  return Math.min(200, Math.max(50, Math.round(percent))) / 100
}

function actionItem(document: Document, label: string, action: string): HTMLButtonElement {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'bcp-douyin-dom-action-item'
  item.textContent = label
  item.dataset.action = action
  item.dataset.bcpDouyinOwned = 'true'
  return item
}

function messageId(track: RendererTrack): string {
  return String(track.options.id == null ? track.id : track.options.id)
}

export function rendererProtocolContent(
  content: readonly SerializedBarrageItem[],
): DouyinRendererContentPart[] {
  return content.map((item) => {
    const part: DouyinRendererContentPart = { ...item }
    if (item.content) part.content = rendererProtocolContent(item.content)
    return part
  })
}

function trustedAction(track: RendererTrack, button: HTMLButtonElement): boolean {
  return (
    button.dataset.track === String(track.id) &&
    button.dataset.instance === String(track.instance.id) &&
    button.dataset.message === track.description.text
  )
}

export function createRendererTrackController(
  options: RendererTrackControllerOptions,
): RendererTrackController {
  let settings: RendererTrackControllerSettings = {
    actions: normalizeRendererActions(undefined),
    scale: 1,
  }
  let started = false
  let currentTrack: RendererTrack | null = null
  let pointerFrame = 0
  let pointerX = 0
  let pointerY = 0
  let nextActivationRequestId = 1
  let nextCopyRequestId = 1
  let nextFavoriteRequestId = 1
  let nextReplyRequestId = 1
  const activationRequests = new Map<number, PendingTrackRequest>()
  const copyRequests = new Map<number, PendingTrackRequest>()
  const favoriteRequests = new Map<number, PendingTrackRequest>()
  const feedbackTimers = new Map<RendererTrack, Set<number>>()
  const touchesReminder = options.touchesRepeatReminder ?? pointTouchesRepeatReminder

  const scheduleFeedback = (track: RendererTrack, callback: () => void, delay: number): void => {
    let timer = 0
    timer = options.target.setTimeout(() => {
      const timers = feedbackTimers.get(track)
      timers?.delete(timer)
      if (!timers?.size) feedbackTimers.delete(track)
      callback()
    }, delay)
    let timers = feedbackTimers.get(track)
    if (!timers) {
      timers = new Set()
      feedbackTimers.set(track, timers)
    }
    timers.add(timer)
  }

  const clearFeedback = (track: RendererTrack): void => {
    const timers = feedbackTimers.get(track)
    if (!timers) return
    timers.forEach((timer) => options.target.clearTimeout(timer))
    feedbackTimers.delete(track)
  }

  const resetTransientState = (track: RendererTrack): void => {
    const state = track.renderer
    if (!state) return
    state.sending = false
    delete state.node.dataset.sending
    delete state.node.dataset.sendOk
    state.button.disabled = false
    state.button.textContent = '+1'
    state.button.title = '发送相同弹幕（+1）'
    state.favoriteButton.disabled = false
    state.favoriteButton.textContent = '收藏'
    state.favoriteButton.title = '收藏弹幕'
    state.copyButton.disabled = false
    state.copyButton.textContent = '复制'
    state.copyButton.title = '复制弹幕内容'
  }

  const release = (track: RendererTrack): void => {
    const state = track.renderer
    if (!state) {
      if (currentTrack === track) currentTrack = null
      return
    }
    if (state.hoverTimer) options.target.clearTimeout(state.hoverTimer)
    if (state.releaseTimer) options.target.clearTimeout(state.releaseTimer)
    state.hoverTimer = 0
    state.releaseTimer = 0
    track.motion = resumeTrackMotion(track.motion)
    state.hovered = false
    delete state.node.dataset.hovered
    delete state.node.dataset.resuming
    if (currentTrack === track) currentTrack = null
  }

  const hold = (track: RendererTrack): void => {
    const state = track.renderer
    if (!state) return
    if (currentTrack && currentTrack !== track) release(currentTrack)
    currentTrack = track
    track.motion = pauseTrackMotion(track.motion)
    state.hovered = true
    state.node.dataset.hovered = 'true'
    delete state.node.dataset.resuming
    if (state.releaseTimer) options.target.clearTimeout(state.releaseTimer)
    if (state.hoverTimer) options.target.clearTimeout(state.hoverTimer)
    state.releaseTimer = 0
    state.hoverTimer = options.target.setTimeout(() => {
      if (track.renderer === state && state.hovered) release(track)
    }, options.frozenTrackTimeout)
  }

  const scheduleRelease = (track: RendererTrack): void => {
    const state = track.renderer
    if (!state) return
    if (state.releaseTimer) options.target.clearTimeout(state.releaseTimer)
    state.releaseTimer = options.target.setTimeout(() => {
      state.releaseTimer = 0
      if (track.renderer === state) release(track)
    }, options.hoverLeaveGrace)
  }

  const renderActionBar = (state: RendererTrackDomState): void => {
    const visible: HTMLButtonElement[] = []
    if (settings.actions.plusOne) visible.push(state.button)
    if (settings.actions.reply) visible.push(state.replyButton)
    if (settings.actions.favorite) visible.push(state.favoriteButton)
    if (settings.actions.copy) visible.push(state.copyButton)
    const fragment = options.document.createDocumentFragment()
    visible.forEach((item, index) => {
      if (index > 0) {
        const divider = options.document.createElement('span')
        divider.className = 'bcp-douyin-dom-action-divider'
        divider.setAttribute('aria-hidden', 'true')
        fragment.append(divider)
      }
      fragment.append(item)
    })
    state.actionBar.replaceChildren(fragment)
    const width = actionWidth()
    state.actionBar.hidden = visible.length === 0
    state.actionBar.style.flex = `0 0 ${width}px`
    state.actionBar.style.width = `${width}px`
    state.actionBar.style.minWidth = `${width}px`
    state.actionBar.style.maxWidth = `${width}px`
    state.node.style.setProperty('--bcp-douyin-action-space', `${width}px`)
  }

  const snapToDevicePixel = (pixels: number): number => {
    const ratio = Number(options.getDevicePixelRatio())
    const deviceScale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
    return Math.max(
      1 / deviceScale,
      Math.round(pixels * settings.scale * deviceScale) / deviceScale,
    )
  }

  const actionWidth = (): number => {
    const enabled = ACTION_ORDER.filter((key) => settings.actions[key])
    return (
      enabled.reduce((width, key) => width + snapToDevicePixel(options.actionItemWidths[key]), 0) +
      Math.max(0, enabled.length - 1) * snapToDevicePixel(options.actionDividerWidth)
    )
  }

  const actionHeight = (): number => options.actionBaseHeight * settings.scale

  const settleActivation = (requestId: number, ok: boolean, reason = ''): void => {
    const request = activationRequests.get(requestId)
    if (!request) return
    activationRequests.delete(requestId)
    request.cancelResponse()
    const state = request.track.renderer
    if (!state || state.button !== request.button) return
    state.sending = false
    delete state.node.dataset.sending
    state.button.disabled = false
    state.button.textContent = '+1'
    delete state.button.dataset.result
    delete state.node.dataset.sendOk
    if (ok) release(request.track)
    state.button.title = ok ? '已发送 +1' : `发送失败${reason ? `：${reason}` : ''}`
    options.onMetric?.({ type: 'result' })
    scheduleFeedback(
      request.track,
      () => {
        if (request.track.renderer === state) state.button.title = '发送相同弹幕（+1）'
      },
      ok ? 900 : 1_200,
    )
  }

  const activate = (track: RendererTrack, event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const state = track.renderer
    if (!state || state.sending || !options.isEnabled() || !settings.actions.plusOne) return
    if (!trustedAction(track, state.button)) {
      options.onFailure(track.instance, 'activation-metadata-mismatch')
      return
    }
    const requestId = nextActivationRequestId
    nextActivationRequestId += 1
    state.sending = true
    state.node.dataset.sending = 'true'
    state.button.disabled = true
    state.button.textContent = '…'
    const payload: RendererActivatePayload = {
      content: rendererProtocolContent(track.content),
      instanceId: track.instance.id,
      messageId: messageId(track),
      requestId,
      text: track.description.text,
      trackId: track.id,
      type: 'renderer-activate',
    }
    const cancelResponse = options.getBridge().request(payload, {
      onResponse: (message) => {
        const request = activationRequests.get(message.requestId)
        if (request && message.trackId !== String(request.track.id)) {
          settleActivation(message.requestId, false, 'track-mismatch')
        } else {
          settleActivation(message.requestId, message.ok, message.reason)
        }
      },
      onTimeout: () => settleActivation(requestId, false, 'timeout'),
      timeoutMs: options.requestTimeout,
    })
    activationRequests.set(requestId, { button: state.button, cancelResponse, track })
    options.onMetric?.({ type: 'activation' })
  }

  const activateReply = (track: RendererTrack, event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const state = track.renderer
    if (!state || !options.isEnabled() || !settings.actions.reply) return
    if (!trustedAction(track, state.replyButton)) {
      options.onFailure(track.instance, 'reply-metadata-mismatch')
      return
    }
    options.getBridge().send({
      content: rendererProtocolContent(track.content),
      instanceId: track.instance.id,
      messageId: messageId(track),
      observedAt: track.observedAt,
      requestId: nextReplyRequestId,
      sender: track.sender,
      text: track.description.text,
      trackId: track.id,
      type: 'renderer-reply',
    })
    nextReplyRequestId += 1
    release(track)
  }

  const settleFavorite = (requestId: number, ok: boolean): void => {
    const request = favoriteRequests.get(requestId)
    if (!request) return
    favoriteRequests.delete(requestId)
    request.cancelResponse()
    const state = request.track.renderer
    if (!state || state.favoriteButton !== request.button) return
    request.button.disabled = false
    request.button.textContent = ok ? '已收藏' : '收藏'
    request.button.title = ok ? '已收藏到本房' : '收藏失败或暂不支持该内容'
    release(request.track)
    scheduleFeedback(
      request.track,
      () => {
        if (request.track.renderer === state) {
          request.button.textContent = '收藏'
          request.button.title = '收藏弹幕'
        }
      },
      ok ? 1_000 : 1_500,
    )
  }

  const activateFavorite = (track: RendererTrack, event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const state = track.renderer
    if (
      !state ||
      !options.isEnabled() ||
      !settings.actions.favorite ||
      state.favoriteButton.disabled
    ) {
      return
    }
    if (!trustedAction(track, state.favoriteButton)) {
      options.onFailure(track.instance, 'favorite-metadata-mismatch')
      return
    }
    const requestId = nextFavoriteRequestId
    nextFavoriteRequestId += 1
    state.favoriteButton.disabled = true
    state.favoriteButton.textContent = '…'
    const payload: RendererFavoritePayload = {
      content: rendererProtocolContent(track.content),
      instanceId: track.instance.id,
      messageId: messageId(track),
      requestId,
      text: track.description.text,
      trackId: track.id,
      type: 'renderer-favorite',
    }
    const cancelResponse = options.getBridge().request(payload, {
      onResponse: (message) => settleFavorite(message.requestId, message.ok),
      onTimeout: () => settleFavorite(requestId, false),
      timeoutMs: options.requestTimeout,
    })
    favoriteRequests.set(requestId, {
      button: state.favoriteButton,
      cancelResponse,
      track,
    })
  }

  const settleCopy = (requestId: number, ok: boolean): void => {
    const request = copyRequests.get(requestId)
    if (!request) return
    copyRequests.delete(requestId)
    request.cancelResponse()
    const state = request.track.renderer
    if (!state || state.copyButton !== request.button) return
    request.button.disabled = false
    request.button.textContent = ok ? '已复制' : '复制失败'
    request.button.title = ok ? '弹幕内容已复制' : '复制失败，请重试'
    release(request.track)
    scheduleFeedback(
      request.track,
      () => {
        if (request.track.renderer === state) {
          request.button.textContent = '复制'
          request.button.title = '复制弹幕内容'
        }
      },
      ok ? 900 : 1_400,
    )
  }

  const activateCopy = (track: RendererTrack, event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const state = track.renderer
    if (
      !state ||
      !options.isEnabled() ||
      !settings.actions.copy ||
      !track.description.text ||
      state.copyButton.disabled
    ) {
      return
    }
    if (!trustedAction(track, state.copyButton)) {
      options.onFailure(track.instance, 'copy-metadata-mismatch')
      return
    }
    const requestId = nextCopyRequestId
    nextCopyRequestId += 1
    state.copyButton.disabled = true
    state.copyButton.textContent = '…'
    const payload: RendererCopyPayload = {
      content: rendererProtocolContent(track.content),
      instanceId: track.instance.id,
      messageId: messageId(track),
      requestId,
      text: track.description.text,
      trackId: track.id,
      type: 'renderer-copy',
    }
    const cancelResponse = options.getBridge().request(payload, {
      onResponse: (message) => settleCopy(message.requestId, message.ok),
      onTimeout: () => settleCopy(requestId, false),
      timeoutMs: options.requestTimeout,
    })
    copyRequests.set(requestId, { button: state.copyButton, cancelResponse, track })
  }

  const clearRequests = (instance?: RendererInstance, track?: RendererTrack): void => {
    for (const requests of [activationRequests, copyRequests, favoriteRequests]) {
      for (const [requestId, request] of requests) {
        if (instance && request.track.instance !== instance) continue
        if (track && request.track !== track) continue
        request.cancelResponse()
        resetTransientState(request.track)
        requests.delete(requestId)
      }
    }
  }

  const disconnectTrack = (track: RendererTrack): void => {
    clearRequests(undefined, track)
    release(track)
    clearFeedback(track)
    resetTransientState(track)
  }

  const releaseIfCoveredAt = (clientX: number, clientY: number): boolean => {
    const track = currentTrack
    if (
      !track ||
      !(
        touchesReminder(options.document, clientX, clientY) ||
        pointTouchesNativeDialog(options.document, clientX, clientY)
      )
    )
      return false
    release(track)
    return true
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!options.isEnabled() || !currentTrack) return
    pointerX = Number(event.clientX)
    pointerY = Number(event.clientY)
    if (pointerFrame) return
    pointerFrame = options.target.requestAnimationFrame(() => {
      pointerFrame = 0
      releaseIfCoveredAt(pointerX, pointerY)
    })
  }

  return {
    actionHeight,
    actionWidth,
    clearInstance(instance) {
      clearRequests(instance)
      for (const track of instance.tracks.values()) disconnectTrack(track)
    },
    connectTrack(track, state) {
      const stopPointerDown = (event: PointerEvent): void => {
        event.preventDefault()
        event.stopPropagation()
      }
      state.node.addEventListener('pointerenter', (event) => {
        if (
          touchesReminder(options.document, Number(event.clientX), Number(event.clientY)) ||
          pointTouchesNativeDialog(options.document, Number(event.clientX), Number(event.clientY))
        ) {
          release(track)
          return
        }
        hold(track)
      })
      state.node.addEventListener('pointerleave', () => scheduleRelease(track))
      state.node.addEventListener('click', (event) => event.stopPropagation())
      for (const item of [
        state.button,
        state.replyButton,
        state.favoriteButton,
        state.copyButton,
      ]) {
        item.addEventListener('pointerdown', stopPointerDown)
      }
      state.button.addEventListener('click', (event) => activate(track, event))
      state.replyButton.addEventListener('click', (event) => activateReply(track, event))
      state.favoriteButton.addEventListener('click', (event) => activateFavorite(track, event))
      state.copyButton.addEventListener('click', (event) => activateCopy(track, event))
      renderActionBar(state)
    },
    createCapsule() {
      const actionBar = options.document.createElement('div')
      actionBar.className = 'bcp-douyin-dom-action'
      actionBar.dataset.bcpDouyinOwned = 'true'
      actionBar.setAttribute('role', 'toolbar')
      actionBar.setAttribute('aria-label', '弹幕快捷操作')
      const button = actionItem(options.document, '+1', 'plus-one')
      button.classList.add('bcp-douyin-dom-plus-one')
      button.title = '发送相同弹幕（+1）'
      const replyButton = actionItem(options.document, '回复', 'reply')
      const favoriteButton = actionItem(options.document, '收藏', 'favorite')
      const copyButton = actionItem(options.document, '复制', 'copy')
      copyButton.title = '复制弹幕内容'
      return { actionBar, button, copyButton, favoriteButton, replyButton }
    },
    destroy() {
      if (started) {
        options.document.removeEventListener('pointermove', onPointerMove, true)
        started = false
      }
      if (pointerFrame) options.target.cancelAnimationFrame(pointerFrame)
      pointerFrame = 0
      clearRequests()
      feedbackTimers.forEach((timers, track) => {
        timers.forEach((timer) => options.target.clearTimeout(timer))
        resetTransientState(track)
      })
      feedbackTimers.clear()
      if (currentTrack) release(currentTrack)
    },
    diagnostics: () => ({
      hoveredTrackId: currentTrack?.id ?? null,
      pendingActivationCount: activationRequests.size,
      pendingCopyCount: copyRequests.size,
      pendingFavoriteCount: favoriteRequests.size,
      started,
    }),
    disconnectTrack,
    hold,
    layout(track, barrageRect, canvasRect) {
      const actionWidthValue = actionWidth()
      const nativeLeft = barrageRect.left - canvasRect.left
      const contentWidth = Math.max(
        1,
        barrageRect.width - actionWidthValue - options.actionGap - options.actionTrailingSpace,
      )
      const placement = overlayCapsulePlacement({
        anchorLeft: nativeLeft,
        anchorRight: nativeLeft + contentWidth,
        capsuleWidth: actionWidthValue,
        gap: options.actionGap,
        viewportLeft: 0,
        viewportRight: canvasRect.width,
      })
      const state = track.renderer
      const actionSide = state?.hovered && state.actionSide ? state.actionSide : placement.side
      const targetLeft =
        nativeLeft - (actionSide === 'left' ? actionWidthValue + options.actionGap : 0)
      return {
        actionSide,
        height: Math.max(actionHeight(), barrageRect.height),
        targetTop: barrageRect.top - canvasRect.top,
        visualLeft:
          state?.hovered && Number.isFinite(state.visualLeft)
            ? Number(state.visualLeft)
            : targetLeft,
        width: Math.max(
          actionWidthValue + options.actionGap + options.actionTrailingSpace + 1,
          barrageRect.width,
        ),
      }
    },
    release,
    releaseIfCoveredAt,
    renderActionBar,
    start() {
      if (started) return
      options.document.addEventListener('pointermove', onPointerMove, true)
      started = true
    },
    syncTrackAppearance(track) {
      const width = actionWidth()
      const previousWidth = Math.max(0, numberOr(track.description.actionWidth, width))
      track.description.actionWidth = width
      track.description.width += width - previousWidth
      track.description.height = Math.max(
        numberOr(track.description.contentHeight, track.description.height),
        actionHeight(),
      )
      if (track.renderer) {
        renderActionBar(track.renderer)
        track.renderer.visualWidth = 0
      }
    },
    updateSettings(actions, scalePercent) {
      const nextActions = normalizeRendererActions(actions)
      const nextScale = normalizeRendererCapsuleScale(scalePercent)
      const actionsChanged = ACTION_ORDER.some((key) => nextActions[key] !== settings.actions[key])
      const scaleChanged = nextScale !== settings.scale
      settings = { actions: nextActions, scale: nextScale }
      return { actionsChanged, scaleChanged, settings }
    },
  }
}

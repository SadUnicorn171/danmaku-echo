import { boxEdges, normalizeText, numberOr, plausibleText } from '../barrage-model'
import { registerDouyinEmojiCatalog } from '../emoji-token'
import type { DouyinContentToPageMessage, DouyinRequestId } from '../protocol'
import { prepareDouyinBarrage, type PreparedBarrage } from './barrage-content'
import { createDouyinContentMeasurer } from './content-measurer'
import { createDouyinCanvasHook } from './canvas-hook'
import { createDouyinPageBridge } from './page-bridge'
import { createDouyinChannelScheduler } from './channel-scheduler'
import { createDouyinDomRenderer } from './dom-renderer'
import { createDouyinPageDiagnostics } from './diagnostics-controller'
import { createRendererOwnMessageMatcher } from './own-message-matcher'
import { createDouyinPageRuntime, type DouyinPageRuntime } from './page-runtime'
import { createRendererTrackController, rendererProtocolContent } from './track-controller'
import { createRendererInstanceRegistry } from './renderer-instance-registry'
import { createDouyinWorkerHook } from './worker-hook'
import {
  frameDelta,
  initialTrackMotion,
  trackDuration,
  trackSpeed,
  type CanvasRectLike,
} from './track-motion'
import type {
  AnimationFrameMilliseconds,
  RendererBarrageOptions,
  RendererConfig,
  RendererFailureReason,
  RendererInstance,
  TimestampMilliseconds,
  RendererTrack,
} from './runtime-types'
import type { DouyinRendererCommand } from './worker-hook'

type ResolvedRendererMessage = Pick<
  Extract<DouyinContentToPageMessage, { type: 'renderer-message-resolved' }>,
  'instanceId' | 'messageId' | 'text' | 'trackId'
>
type EmojiCatalogMessage = Extract<DouyinContentToPageMessage, { type: 'emoji-catalog' }>
type RendererSettingsMessage = Extract<DouyinContentToPageMessage, { type: 'renderer-settings' }>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '')
}

export function createDouyinPageAppRuntime(): DouyinPageRuntime {
  'use strict'

  const DEBUG_VERSION = 'douyin-dom-renderer-v14-gated-repeat-collector'
  const DOM_ACTION_HEIGHT = 40
  const DOM_ACTION_ITEM_WIDTHS = Object.freeze({
    plusOne: 56,
    reply: 56,
    favorite: 56,
    copy: 56,
  })
  const DOM_ACTION_DIVIDER_WIDTH = 2
  const DOM_ACTION_GAP = 8
  const DOM_ACTION_TRAILING_SPACE = 12
  const DOM_BARRAGE_PADDING = 8
  const DOM_BARRAGE_PADDING_MAX = 12
  const DOM_NODE_LIMIT = 160
  const RENDERER_HEARTBEAT_TIMEOUT = 15_000
  const RENDERER_RESULT_TIMEOUT = 8_000
  const FROZEN_TRACK_TIMEOUT = 20_000
  const HOVER_LEAVE_GRACE = 220
  const CANVAS_MOUNT_GRACE = 8_000
  const CANVAS_MOUNT_RETRY = 100
  const OWN_MESSAGE_TTL = 12_000
  const OWN_MESSAGE_LIMIT = 24
  let nextTrackId = 1
  const contentMeasurer = createDouyinContentMeasurer()
  const channelScheduler = createDouyinChannelScheduler()

  const diagnostics = createDouyinPageDiagnostics({
    collectSnapshot: () => ({
      instanceCount: instanceRegistry.size(),
      orphanCount: instanceRegistry.orphanCount(),
      renderer: {
        ...pageRuntime.diagnostics(),
        trackController: trackController.diagnostics(),
      },
      canvasHook: canvasHook.diagnostics(),
      contentMeasurer: contentMeasurer.diagnostics(),
      instanceRegistry: instanceRegistry.diagnostics(),
      workerHook: workerHook.diagnostics(),
    }),
    document,
    href: () => location.href,
    instances: () => instanceRegistry.values(),
    version: DEBUG_VERSION,
  })

  const trackController = createRendererTrackController({
    actionBaseHeight: DOM_ACTION_HEIGHT,
    actionDividerWidth: DOM_ACTION_DIVIDER_WIDTH,
    actionGap: DOM_ACTION_GAP,
    actionItemWidths: DOM_ACTION_ITEM_WIDTHS,
    actionTrailingSpace: DOM_ACTION_TRAILING_SPACE,
    document,
    frozenTrackTimeout: FROZEN_TRACK_TIMEOUT,
    getBridge: () => pageBridge,
    getDevicePixelRatio: () => globalThis.devicePixelRatio,
    hoverLeaveGrace: HOVER_LEAVE_GRACE,
    isEnabled: () => pageRuntime.isRendererEnabled(),
    onFailure: (instance, reason, error) => failInstanceRenderer(instance, reason, error),
    onMetric: (metric) => {
      diagnostics.increment(
        metric.type === 'activation' ? 'rendererActivations' : 'rendererResults',
      )
    },
    requestTimeout: RENDERER_RESULT_TIMEOUT,
    target: window,
  })

  const domRenderer = createDouyinDomRenderer({
    actionGap: DOM_ACTION_GAP,
    actionTrailingSpace: DOM_ACTION_TRAILING_SPACE,
    beforeShutdown: trackController.clearInstance,
    document,
    getComputedStyle: (element) => getComputedStyle(element),
    nodeLimit: DOM_NODE_LIMIT,
    onEvent: (event) => {
      if (event.type === 'renderer-canvas-restored') {
        diagnostics.increment('rendererRestores')
      } else if (event.type === 'renderer-takeover') {
        diagnostics.increment('rendererTakeovers')
      } else if (event.type === 'renderer-node-created') {
        diagnostics.increment('rendererNodesCreated')
      }
      diagnostics.record(event.type, event.details, event.level)
    },
    trackController,
  })

  const canvasHook = createDouyinCanvasHook({
    onTransfer: (event) => {
      diagnostics.increment('canvasTransfers')
      diagnostics.record('canvas-transferred', {
        canvasId: event.canvasId,
        connected: event.connected,
        marker: event.marker,
        width: event.width,
        height: event.height,
      })
    },
  })
  const instanceRegistry = createRendererInstanceRegistry({
    canvasHook,
    clearInstance,
    mountGrace: CANVAS_MOUNT_GRACE,
    onBarrage: queueBarrage,
    onEvent: (event) => {
      if (event.type === 'instance-created') {
        diagnostics.increment('instancesCreated')
      } else if (event.type === 'instance-recovered') {
        diagnostics.increment('instancesRecovered')
      }
      diagnostics.record(event.type, event.details, event.level)
    },
  })
  const ownMessageMatcher = createRendererOwnMessageMatcher({
    baseUrl: () => location.href,
    limit: OWN_MESSAGE_LIMIT,
    onEvent: (event) => {
      if (event.type === 'queued') {
        diagnostics.increment('ownMessagesQueued')
        diagnostics.record('own-message-queued', {
          text: event.intent.text,
          assetCount: event.intent.assets.length,
          signature: event.intent.signature,
          source: event.intent.source,
          queueLength: event.queueLength,
        })
        return
      }
      if (event.type === 'cancelled') {
        diagnostics.record('own-message-cancelled', { intentId: event.intentId })
        return
      }
      if (event.type !== 'matched') return
      domRenderer.markTrackOwn(event.track)
      diagnostics.increment('ownBarragesMatched')
      if (event.mode === 'recent-track') {
        diagnostics.increment('ownBarragesReconciled')
      }
      diagnostics.record(
        event.mode === 'recent-track' ? 'own-barrage-reconciled' : 'own-barrage-matched',
        {
          intentId: event.intent.id,
          trackId: event.track.id,
          text: event.track.description.text,
          assetCount: event.assetCount,
          source: event.intent.source,
          age: event.age,
        },
      )
      pageBridge.send({
        type: 'own-message-consumed',
        intentId: event.intent.id,
      })
    },
    recentTrackWindow: 2_500,
    tracks: () =>
      Array.from(instanceRegistry.values()).flatMap((instance) =>
        Array.from(instance.tracks.values()),
      ),
    ttl: OWN_MESSAGE_TTL,
  })
  const workerHook = createDouyinWorkerHook({
    onCommand: (command) => {
      diagnostics.increment('workerMessages')
      handleRendererCommand(command)
    },
    onError: (error, target) => {
      diagnostics.record(
        'observe-message-error',
        {
          target,
          message: errorMessage(error),
        },
        'error',
      )
    },
    onPatched: (target, reused) => {
      diagnostics.record('message-sender-patched', { prototype: target, reused }, 'info')
    },
  })

  function applyResolvedRendererMessage(data: ResolvedRendererMessage): void {
    const instance = instanceRegistry.get(String(data.instanceId || ''))
    const track = instance && instance.tracks.get(Number(data.trackId))
    const text = normalizeText(data.text)
    if (!track || !plausibleText(text)) return
    const expectedMessageId = String(track.options.id == null ? track.id : track.options.id)
    if (data.messageId != null && String(data.messageId) !== expectedMessageId) return
    if (track.description.text === text) return
    track.description.text = text
    domRenderer.refreshTrackMetadata(track)
    diagnostics.record(
      'renderer-message-resolved',
      {
        instanceId: track.instance.id,
        trackId: track.id,
        text,
      },
      'info',
    )
  }

  function applyDouyinEmojiCatalog(data: EmojiCatalogMessage): void {
    const registered = registerDouyinEmojiCatalog(data.entries)
    if (!registered) return
    let resolved = 0
    for (const instance of instanceRegistry.values()) {
      for (const track of instance.tracks.values()) {
        const prepared = prepareDouyinBarrage(track.options, {
          describe: () => track.description,
        })
        if (!prepared.ok) continue
        const interactionText = prepared.barrage.description.text
        track.content = prepared.barrage.content
        if (!plausibleText(interactionText) || interactionText === track.description.text) continue
        applyResolvedRendererMessage({
          instanceId: instance.id,
          messageId: String(track.options.id == null ? track.id : track.options.id),
          text: interactionText,
          trackId: track.id,
        })
        resolved += 1
      }
    }
    diagnostics.record('emoji-catalog-applied', { registered, resolved }, 'info')
  }

  function failInstanceRenderer(
    instance: RendererInstance,
    reason: RendererFailureReason,
    error?: unknown,
  ): void {
    instance.rendererBlocked = true
    instance.lifecycle.lastFailure = reason
    instance.lifecycle.state = 'blocked'
    domRenderer.shutdown(instance, reason)
    diagnostics.record(
      'renderer-failed',
      {
        instanceId: instance.id,
        reason,
        message: error == null ? '' : errorMessage(error),
      },
      'error',
    )
  }

  function updateRendererFrame(instance: RendererInstance, canvasRect: CanvasRectLike): void {
    const snapshot = domRenderer.readFrame(instance, canvasRect, {
      enabled: pageRuntime.isRendererEnabled(),
      now: Date.now(),
    })
    domRenderer.commitFrame(snapshot)
  }

  function stopAnimation(instance: RendererInstance): void {
    if (instance.animationFrame) {
      cancelAnimationFrame(instance.animationFrame)
      instance.animationFrame = 0
    }
  }

  function modelFrame(instance: RendererInstance, frameTime: AnimationFrameMilliseconds): void {
    try {
      advanceModelFrame(instance, frameTime)
    } catch (error) {
      instance.animationFrame = 0
      failInstanceRenderer(instance, 'animation-frame-error', error)
    }
  }

  function advanceModelFrame(
    instance: RendererInstance,
    frameTime: AnimationFrameMilliseconds,
  ): void {
    instance.animationFrame = 0
    if (
      !instance.active ||
      !(instance.canvas instanceof HTMLCanvasElement) ||
      !instance.canvas.isConnected
    ) {
      return
    }
    const rect = instance.canvas.getBoundingClientRect()
    if (rect.width < 20 || rect.height < 20) {
      instance.animationFrame = requestAnimationFrame((timestamp) =>
        modelFrame(instance, timestamp),
      )
      return
    }
    const { requeued } = channelScheduler.synchronize(instance, rect)
    requeued.forEach((track) => domRenderer.removeTrack(track))
    if (requeued.length && !instance.pushTimer) {
      instance.pushTimer = setTimeout(() => assignPendingTracks(instance), 0)
    }
    const deltaTime = frameDelta(instance.lastFrameAt, frameTime)
    instance.lastFrameAt = frameTime
    channelScheduler
      .releaseExpired(instance, rect)
      .forEach((track) => domRenderer.removeTrack(track))
    if (channelScheduler.isEmpty(instance)) {
      updateRendererFrame(instance, rect)
      return
    }
    channelScheduler.advance(instance, rect, deltaTime)
    updateRendererFrame(instance, rect)
    instance.animationFrame = requestAnimationFrame((timestamp) => modelFrame(instance, timestamp))
  }

  function startAnimation(instance: RendererInstance): void {
    if (!instance.animationFrame && instance.active) {
      instance.lastFrameAt = 0
      instance.animationFrame = requestAnimationFrame((timestamp) =>
        modelFrame(instance, timestamp),
      )
    }
  }

  function assignPendingTracks(instance: RendererInstance): void {
    instance.pushTimer = 0
    if (!(instance.canvas instanceof HTMLCanvasElement)) {
      return
    }
    if (!instance.canvas.isConnected) {
      if (
        !instance.canvasEverConnected &&
        instanceRegistry.owns(instance) &&
        instance.active &&
        Date.now() < instance.mountGraceUntil
      ) {
        instance.pushTimer = setTimeout(() => assignPendingTracks(instance), CANVAS_MOUNT_RETRY)
      }
      return
    }
    instance.canvasEverConnected = true
    const rect = instance.canvas.getBoundingClientRect()
    if (rect.width < 20 || rect.height < 20) {
      instance.pushTimer = setTimeout(() => assignPendingTracks(instance), 300)
      return
    }
    const result = channelScheduler.assign(instance, rect, Date.now())
    result.requeued.forEach((track) => domRenderer.removeTrack(track))
    result.assigned.forEach(({ end, pendingDelay, start, track }) => {
      diagnostics.increment('barragesStarted')
      diagnostics.record('barrage-started', {
        instanceId: instance.id,
        trackId: track.id,
        text: track.description.text,
        channel: [start, end],
        pendingDelay,
      })
    })
    result.dropped.forEach((track) => {
      domRenderer.removeTrack(track)
      diagnostics.record('barrage-dropped', {
        instanceId: instance.id,
        trackId: track.id,
        text: track.description.text,
        reason: 'reserve-expired',
      })
    })
    if (instance.active && result.wasEmpty && !channelScheduler.isEmpty(instance)) {
      startAnimation(instance)
    }
    if (result.remaining) {
      instance.pushTimer = setTimeout(() => assignPendingTracks(instance), 300)
    }
  }

  function registerPreparedBarrage(
    instance: RendererInstance,
    prepared: PreparedBarrage,
    observedAt: TimestampMilliseconds,
    rendererGeneration: number,
  ): boolean | undefined {
    if (!instanceRegistry.owns(instance) || instance.rendererGeneration !== rendererGeneration) {
      return
    }
    const { content, description, messageId, options, repeatReminderExclusion, sender } = prepared
    if (pageRuntime.isRepeatReminderEnabled()) {
      pageBridge.send({
        type: 'repeat-reminder-message',
        message: {
          content: rendererProtocolContent(content),
          excludedReason: repeatReminderExclusion || '',
          instanceId: instance.id,
          messageId,
          observedAt,
          sender,
          text: description.text,
          trackId: nextTrackId,
        },
      })
    }
    const sourcePadding = boxEdges(options.padding)
    const uniformPadding = Math.min(
      DOM_BARRAGE_PADDING_MAX,
      Math.max(
        DOM_BARRAGE_PADDING,
        sourcePadding.top,
        sourcePadding.right,
        sourcePadding.bottom,
        sourcePadding.left,
      ),
    )
    description.rendererPadding = [uniformPadding, uniformPadding, uniformPadding, uniformPadding]
    description.width +=
      description.rendererPadding[1] +
      description.rendererPadding[3] -
      sourcePadding.right -
      sourcePadding.left
    description.height +=
      description.rendererPadding[0] +
      description.rendererPadding[2] -
      sourcePadding.top -
      sourcePadding.bottom
    description.contentWidth = description.width
    description.contentHeight = description.height
    description.actionWidth = trackController.actionWidth()
    description.width += description.actionWidth + DOM_ACTION_GAP + DOM_ACTION_TRAILING_SPACE
    description.height = Math.max(trackController.actionHeight(), description.height)
    const maxCount = Math.max(1, numberOr(instance.config.maxCount, 200))
    const track: RendererTrack = {
      id: nextTrackId,
      instance,
      options,
      description,
      content,
      sender,
      own: false,
      motion: initialTrackMotion(),
      bookedChannel: null,
      observedAt,
      startedAt: 0,
    }
    const canvasRect =
      instance.canvas instanceof HTMLCanvasElement ? instance.canvas.getBoundingClientRect() : null
    if (canvasRect && canvasRect.width >= 20 && canvasRect.height >= 20) {
      const optionStart = numberOr(options.startTime, 0)
      const now = Date.now()
      const credibleStart =
        optionStart > now - 60_000 && optionStart < now + 5_000 ? optionStart : observedAt
      const preparationDelay = Math.max(0, Math.min(trackDuration(track), now - credibleStart))
      track.motion = initialTrackMotion(preparationDelay * trackSpeed(track, canvasRect))
    }
    const enqueueResult = channelScheduler.enqueue(instance, track, maxCount)
    if (!enqueueResult.accepted) {
      diagnostics.increment('skippedBarrages')
      diagnostics.record('barrage-skipped', { instanceId: instance.id, reason: 'pending-limit' })
      return false
    }
    ownMessageMatcher.match(track)
    nextTrackId += 1
    if (enqueueResult.wasEmpty) {
      if (instance.pushTimer) {
        clearTimeout(instance.pushTimer)
        instance.pushTimer = 0
      }
      assignPendingTracks(instance)
    } else if (!instance.pushTimer) {
      instance.pushTimer = setTimeout(() => assignPendingTracks(instance), 300)
    }
    return true
  }

  function queueBarrage(instance: RendererInstance, options: RendererBarrageOptions): void {
    if (!options || typeof options !== 'object') {
      return
    }
    if (instance.rendererCleanClearObserved) {
      instance.rendererSafeSync = true
      instance.rendererCleanClearObserved = false
      instance.rendererBlocked = false
      instance.lifecycle.lastFailure = null
      instance.lifecycle.state = 'observing'
      diagnostics.record('renderer-clean-sync', { instanceId: instance.id })
    }
    diagnostics.increment('barragesObserved')
    const observedAt = Date.now()
    const rendererGeneration = instance.rendererGeneration
    instance.rendererPreparing += 1
    try {
      // Never wait for remote image metadata before deciding whether Canvas can
      // be hidden. Douyin usually provides image dimensions; missing dimensions
      // use the same deterministic square fallback in both measurement and DOM.
      const prepared = prepareDouyinBarrage(options, {
        describe: (value, content) => contentMeasurer.measure(value, instance.config, content),
      })
      if (!prepared.ok) {
        diagnostics.increment('skippedBarrages')
        diagnostics.record('barrage-skipped', {
          instanceId: instance.id,
          reason: prepared.reason,
          barrageId: prepared.messageId,
          imageCount: prepared.imageCount,
        })
        return
      }
      registerPreparedBarrage(instance, prepared.barrage, observedAt, rendererGeneration)
    } catch (error) {
      if (instanceRegistry.owns(instance) && instance.rendererGeneration === rendererGeneration) {
        failInstanceRenderer(instance, 'prepare-barrage-error', error)
      }
      diagnostics.record(
        'prepare-barrage-error',
        {
          instanceId: instance.id,
          message: errorMessage(error),
        },
        'error',
      )
    } finally {
      if (instanceRegistry.owns(instance) && instance.rendererGeneration === rendererGeneration) {
        instance.rendererPreparing = Math.max(0, instance.rendererPreparing - 1)
        if (instance.active && !channelScheduler.isEmpty(instance)) {
          startAnimation(instance)
        }
      }
    }
  }

  function clearInstance(instance: RendererInstance, reason: string): void {
    if (instance.pushTimer) {
      clearTimeout(instance.pushTimer)
      instance.pushTimer = 0
    }
    domRenderer.shutdown(instance, reason || 'instance-cleared')
    instance.rendererGeneration += 1
    instance.rendererPreparing = 0
    stopAnimation(instance)
    channelScheduler.clear(instance)
    instance.lastFrameAt = 0
  }

  function looksLikeDanmakuConfig(
    config: Partial<RendererConfig>,
    canvas: HTMLCanvasElement,
  ): boolean {
    return (
      canvasHook.isDanmakuCanvas(canvas) ||
      (config && numberOr(config.channelHeight, 0) > 0 && numberOr(config.duration, 0) > 0)
    )
  }

  function handleRendererCommand(command: DouyinRendererCommand): void {
    const id = String(command.instanceId)
    if (command.type === 'create-instance') {
      const mappedCanvas = canvasHook.canvasForOffscreen(command.offscreen)
      const canvas =
        mappedCanvas ||
        canvasHook.findUnclaimedCanvas(
          Array.from(instanceRegistry.values(), (instance) => instance.canvas),
        )
      if (
        !(canvas instanceof HTMLCanvasElement) ||
        !id ||
        !looksLikeDanmakuConfig(command.config, canvas)
      ) {
        instanceRegistry.rememberOrphan(id, 'createInstance', command.params)
        return
      }
      // Missing transfer metadata means the hook arrived after OffscreenCanvas
      // ownership changed or matched heuristically. Treat it as recovered so a
      // guessed Canvas can never be hidden before a clean sync boundary.
      const instance = instanceRegistry.create(id, canvas, command.config, !mappedCanvas)
      if (!instance) {
        instanceRegistry.rememberOrphan(id, 'createInstance', command.params)
        return
      }
      command.barrages.forEach((barrage) => queueBarrage(instance, barrage))
      return
    }

    const instance = instanceRegistry.get(id)
    if (!instance) {
      if (command.type === 'add-barrage') {
        instanceRegistry.rememberOrphan(id, 'addBarrage', command.params)
      } else if (command.type === 'update-config') {
        instanceRegistry.rememberOrphan(id, 'updateConfig', command.params)
      }
      return
    }
    if (command.type === 'add-barrage') {
      queueBarrage(instance, command.barrage)
    } else if (command.type === 'update-config') {
      instanceRegistry.updateConfig(id, command.config)
      diagnostics.record('config-updated', { instanceId: id, config: command.config })
    } else if (command.type === 'clear') {
      instanceRegistry.reset(id, 'worker-clear', 'await-clean-sync')
      diagnostics.record('instance-cleared', { instanceId: id })
    } else if (command.type === 'destroy') {
      instanceRegistry.remove(id, 'worker-destroy')
    } else if (command.type === 'stop' && instance.active) {
      instance.active = false
      if (instance.pushTimer) {
        clearTimeout(instance.pushTimer)
        instance.pushTimer = 0
      }
      stopAnimation(instance)
      domRenderer.shutdown(instance, 'worker-stop')
      diagnostics.record('instance-stopped', { instanceId: id })
    } else if (command.type === 'start' && !instance.active) {
      instance.active = true
      instance.lifecycle.state = 'observing'
      assignPendingTracks(instance)
      if (!channelScheduler.isEmpty(instance)) {
        startAnimation(instance)
      }
      diagnostics.record('instance-started', { instanceId: id })
    }
  }

  function postReady(requestId: DouyinRequestId | undefined): void {
    pageBridge.send({
      type: 'ready',
      requestId: requestId || 0,
      instanceCount: instanceRegistry.size(),
      version: DEBUG_VERSION,
      orphanCount: instanceRegistry.orphanCount(),
      rendererEnabled: pageRuntime.isRendererEnabled(),
    })
  }

  function postRendererReady(requestId: DouyinRequestId | undefined): void {
    pageBridge.send({
      type: 'renderer-ready',
      requestId: Number(requestId) || 0,
      enabled: pageRuntime.isRendererEnabled(),
      instanceCount: instanceRegistry.size(),
      takeoverCount: Array.from(instanceRegistry.values()).filter(
        (instance) => instance.rendererTakeover,
      ).length,
      version: DEBUG_VERSION,
    })
  }

  function updateRendererSettings(data: RendererSettingsMessage): void {
    const controllerUpdate = trackController.updateSettings(data.actions, data.capsuleScalePercent)
    const { actionsChanged, scaleChanged, settings } = controllerUpdate
    const runtimeUpdate = pageRuntime.updateRendererSettings(
      Boolean(data.enabled),
      Boolean(data.repeatReminderEnabled),
    )
    if (actionsChanged || scaleChanged) {
      for (const instance of instanceRegistry.values()) {
        for (const track of instance.tracks.values()) {
          trackController.syncTrackAppearance(track)
        }
      }
    }
    if (
      runtimeUpdate.enabledChanged ||
      runtimeUpdate.repeatReminderEnabledChanged ||
      actionsChanged ||
      scaleChanged
    ) {
      diagnostics.record(
        'renderer-settings',
        {
          enabled: runtimeUpdate.enabled,
          repeatReminderEnabled: runtimeUpdate.repeatReminderEnabled,
          actions: settings.actions,
          capsuleScale: settings.scale,
          instanceCount: instanceRegistry.size(),
        },
        'info',
      )
    }
    postRendererReady(0)
  }

  const pageBridge = createDouyinPageBridge({
    handlers: {
      'debug-request': (message) => {
        pageBridge.send({
          type: 'debug-snapshot',
          requestId: message.requestId,
          snapshot: diagnostics.snapshot(),
        })
      },
      'emoji-catalog': applyDouyinEmojiCatalog,
      'own-message-cancel': (message) => ownMessageMatcher.cancel(message),
      'own-message-intent': (message) => ownMessageMatcher.remember(message),
      ping: (message) => postReady(message.requestId),
      'renderer-message-resolved': applyResolvedRendererMessage,
      'renderer-settings': updateRendererSettings,
    },
    onProtocolRejected: () => {
      diagnostics.increment('protocolMessagesRejected')
    },
  })
  const pageRuntime = createDouyinPageRuntime({
    bridge: pageBridge,
    canvasHook,
    diagnostics,
    document,
    heartbeatTimeout: RENDERER_HEARTBEAT_TIMEOUT,
    mountRetry: CANVAS_MOUNT_RETRY,
    onDestroy: () => {
      if (globalThis.__danmakuEchoDouyinPageRuntime === pageRuntime) {
        globalThis.__danmakuEchoDouyinPageRuntime = undefined
      }
      globalThis.__bulletPlusOneDouyinCanvasHook = false
    },
    onRelayout: (instance) => {
      domRenderer.invalidateGeometry(instance)
      updateRendererFrame(instance, instance.canvas.getBoundingClientRect())
    },
    onRelayoutError: (instance, error) => {
      failInstanceRenderer(instance, 'fullscreen-relayout-error', error)
    },
    onResumeInstance: (instance) => {
      assignPendingTracks(instance)
      if (!channelScheduler.isEmpty(instance)) startAnimation(instance)
    },
    onRetryPending: (instance, delay) => {
      instance.pushTimer = setTimeout(() => assignPendingTracks(instance), delay)
    },
    onStarted: () => postReady(0),
    onSuspendInstance: (instance, reason) => {
      if (instance.pushTimer) {
        clearTimeout(instance.pushTimer)
        instance.pushTimer = 0
      }
      stopAnimation(instance)
      domRenderer.shutdown(instance, reason)
    },
    registry: instanceRegistry,
    target: window,
    trackController,
    workerHook,
  })
  return pageRuntime
}

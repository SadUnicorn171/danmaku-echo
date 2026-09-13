import { normalizeText, numberOr, plausibleText } from '../barrage-model'
import type { DouyinCanvasHook } from './canvas-hook'
import type {
  Milliseconds,
  RendererBarrageOptions,
  RendererConfig,
  RendererInstance,
  RendererInstanceId,
  RendererOrphanInstance,
  RendererTimerId,
  TimestampMilliseconds,
} from './runtime-types'

const DEFAULT_MOUNT_GRACE = 8_000
const DEFAULT_ORPHAN_TTL = 12_000
const DEFAULT_RECOVERY_DELAY = 120

export type RendererRegistryEventType =
  | 'canvas-claim-rejected'
  | 'instance-created'
  | 'instance-destroyed'
  | 'instance-detached'
  | 'instance-recovered'
  | 'instance-replaced'
  | 'orphan-expired'
  | 'orphan-observed'

export interface RendererRegistryEvent {
  details: Record<string, unknown>
  level: 'info' | 'warn'
  type: RendererRegistryEventType
}

export interface RendererInstanceRegistryOptions {
  canvasHook: Pick<
    DouyinCanvasHook,
    'canvasId' | 'findUnclaimedCanvas' | 'isDanmakuCanvas' | 'markerFor'
  >
  clearInstance(instance: RendererInstance, reason: string): void
  clearTimeout?: (timer: RendererTimerId) => void
  defaultConfig?(canvas: HTMLCanvasElement): RendererConfig
  devicePixelRatio?: () => number
  mountGrace?: Milliseconds
  now?: () => TimestampMilliseconds
  onBarrage(instance: RendererInstance, barrage: RendererBarrageOptions): void
  onEvent?: (event: RendererRegistryEvent) => void
  orphanTtl?: Milliseconds
  recoveryDelay?: Milliseconds
  setTimeout?: (callback: () => void, delay: Milliseconds) => RendererTimerId
}

export interface RendererInstanceRegistryDiagnostics {
  claimedCanvasCount: number
  instanceCount: number
  orphanCount: number
  recoveryScheduled: boolean
}

export interface RendererInstanceRegistry {
  create(
    id: RendererInstanceId,
    canvas: HTMLCanvasElement,
    config?: Partial<RendererConfig>,
    recovered?: boolean,
  ): RendererInstance | null
  destroyAll(reason: string): void
  diagnostics(): RendererInstanceRegistryDiagnostics
  forgetOrphan(id: RendererInstanceId): boolean
  get(id: RendererInstanceId): RendererInstance | undefined
  has(id: RendererInstanceId): boolean
  orphanCount(): number
  owns(instance: RendererInstance): boolean
  recover(): number
  rememberOrphan(
    id: RendererInstanceId,
    method: 'addBarrage' | 'createInstance' | 'updateConfig',
    params: Record<string, unknown>,
  ): void
  remove(id: RendererInstanceId, reason: string): RendererInstance | null
  reset(
    id: RendererInstanceId,
    reason: string,
    mode?: 'await-clean-sync' | 'route-change',
  ): RendererInstance | null
  resetAll(reason: string): void
  size(): number
  sweepDetached(): number
  updateConfig(
    id: RendererInstanceId,
    config: Partial<RendererConfig>,
  ): RendererInstance | null
  values(): IterableIterator<RendererInstance>
}

function defaultRendererConfig(
  canvas: HTMLCanvasElement,
  devicePixelRatio: () => number,
): RendererConfig {
  const rect = canvas.getBoundingClientRect()
  return {
    channelHeight: 40,
    devicePixelRatio: Math.max(0.25, numberOr(devicePixelRatio(), 1)),
    duration: 15_000,
    fontSize: 20,
    gap: 100,
    height: Math.max(20, rect.height || 0),
    maxCount: 200,
    maxHeightRate: 1,
    width: Math.max(20, rect.width || 0),
  }
}

function roughBarrageText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const item = value as Record<string, unknown>
  if (item.type === 'text') return normalizeText(item.text)
  return (Array.isArray(item.content) ? item.content : []).map(roughBarrageText).join('')
}

function instanceKey(id: RendererInstanceId): string {
  return String(id)
}

export function createRendererInstanceRegistry(
  options: RendererInstanceRegistryOptions,
): RendererInstanceRegistry {
  const now = options.now ?? Date.now
  const setTimer =
    options.setTimeout ??
    ((callback, delay) =>
      globalThis.setTimeout(callback, delay) as unknown as RendererTimerId)
  const clearTimer = options.clearTimeout ?? ((timer) => globalThis.clearTimeout(timer))
  const devicePixelRatio = options.devicePixelRatio ?? (() => globalThis.devicePixelRatio)
  const mountGrace = Math.max(0, numberOr(options.mountGrace, DEFAULT_MOUNT_GRACE))
  const orphanTtl = Math.max(1, numberOr(options.orphanTtl, DEFAULT_ORPHAN_TTL))
  const recoveryDelay = Math.max(0, numberOr(options.recoveryDelay, DEFAULT_RECOVERY_DELAY))
  const instances = new Map<string, RendererInstance>()
  const canvasOwners = new Map<HTMLCanvasElement, RendererInstance>()
  const orphans = new Map<string, RendererOrphanInstance>()
  let recoveryTimer: RendererTimerId = 0

  const emit = (
    type: RendererRegistryEventType,
    details: Record<string, unknown>,
    level: 'info' | 'warn' = 'info',
  ): void => options.onEvent?.({ details, level, type })

  const claimedCanvases = (): Set<HTMLCanvasElement> => new Set(canvasOwners.keys())

  const scheduleRecovery = (): void => {
    if (recoveryTimer || !orphans.size) return
    recoveryTimer = setTimer(() => {
      recoveryTimer = 0
      registry.recover()
    }, recoveryDelay)
  }

  const create = (
    id: RendererInstanceId,
    canvas: HTMLCanvasElement,
    config: Partial<RendererConfig> = {},
    recovered = false,
  ): RendererInstance | null => {
    const key = instanceKey(id)
    if (!key) return null
    const owner = canvasOwners.get(canvas)
    if (owner && owner.id !== key) {
      emit(
        'canvas-claim-rejected',
        { canvasId: owner.canvasId, instanceId: key, ownerInstanceId: owner.id },
        'warn',
      )
      return null
    }

    const previous = instances.get(key)
    if (previous) {
      options.clearInstance(previous, 'instance-replaced')
      canvasOwners.delete(previous.canvas)
      instances.delete(key)
      emit('instance-replaced', { instanceId: key }, 'warn')
    }

    const createdAt = now()
    const baseConfig = options.defaultConfig
      ? options.defaultConfig(canvas)
      : defaultRendererConfig(canvas, devicePixelRatio)
    const mergedConfig: RendererConfig = { ...baseConfig, ...config }
    const instance: RendererInstance = {
      active: true,
      animationFrame: 0,
      canvas,
      canvasEverConnected: Boolean(canvas.isConnected),
      canvasId: options.canvasHook.canvasId(canvas),
      channels: [],
      config: mergedConfig,
      createdAt,
      frameState: {
        moved: new Set(),
        previousIds: new Map(),
        rightPositions: new Map(),
        speeds: new Map(),
      },
      id: key,
      lastFrameAt: 0,
      lifecycle: {
        lastFailure: null,
        state: recovered ? 'recovering' : 'observing',
      },
      mountGraceUntil: createdAt + mountGrace,
      pending: [],
      pushTimer: 0,
      recovered,
      rendererBlocked: false,
      rendererBorderRadius: null,
      rendererCanvasVisibility: '',
      rendererCleanClearObserved: false,
      rendererGeneration: 1,
      rendererGeometryKey: '',
      rendererLayer: null,
      rendererNodes: new Map(),
      rendererOwnsCanvasVisibility: false,
      rendererPreparing: 0,
      rendererSafeAfter: recovered
        ? createdAt + Math.max(1_000, numberOr(mergedConfig.duration, 15_000)) + 1_000
        : Infinity,
      rendererSafeSync: !recovered,
      rendererTakeover: false,
      tracks: new Map(),
    }
    instances.set(key, instance)
    canvasOwners.set(canvas, instance)
    orphans.delete(key)
    emit(recovered ? 'instance-recovered' : 'instance-created', {
      canvasId: instance.canvasId,
      config: instance.config,
      instanceId: key,
      marker: options.canvasHook.markerFor(canvas.parentElement),
    }, recovered ? 'warn' : 'info')
    return instance
  }

  const remove = (id: RendererInstanceId, reason: string): RendererInstance | null => {
    const key = instanceKey(id)
    const instance = instances.get(key)
    if (!instance) return null
    options.clearInstance(instance, reason)
    instance.lifecycle.state = 'destroyed'
    instances.delete(key)
    canvasOwners.delete(instance.canvas)
    emit('instance-destroyed', { instanceId: key, reason })
    return instance
  }

  const reset: RendererInstanceRegistry['reset'] = (
    id,
    reason,
    mode = 'route-change',
  ) => {
    const instance = instances.get(instanceKey(id))
    if (!instance) return null
    options.clearInstance(instance, reason)
    instance.rendererBlocked = false
    instance.rendererCleanClearObserved = mode === 'await-clean-sync'
    instance.rendererSafeAfter = mode === 'await-clean-sync'
      ? Infinity
      : now() + Math.max(1_000, numberOr(instance.config.duration, 15_000)) + 1_000
    instance.rendererSafeSync = false
    instance.lifecycle.lastFailure = null
    instance.lifecycle.state = 'recovering'
    return instance
  }

  const rememberOrphan: RendererInstanceRegistry['rememberOrphan'] = (id, method, params) => {
    const key = instanceKey(id)
    if (!key) return
    let orphan = orphans.get(key)
    if (!orphan) {
      orphan = { barrages: [], config: {}, createdAt: now(), id: key }
      orphans.set(key, orphan)
    }
    if (method === 'createInstance' || method === 'updateConfig') {
      const source = method === 'createInstance' && params.config
        ? params.config
        : params
      if (source && typeof source === 'object') {
        Object.assign(orphan.config, source)
      }
      if (method === 'createInstance' && Array.isArray(params.barrages)) {
        orphan.barrages.push(
          ...params.barrages.filter(
            (barrage): barrage is RendererBarrageOptions =>
              Boolean(barrage) && typeof barrage === 'object',
          ),
        )
      }
    } else if (
      Array.isArray(params.content) &&
      plausibleText(roughBarrageText(params))
    ) {
      orphan.barrages.push(params)
    }
    emit(
      'orphan-observed',
      { barrageCount: orphan.barrages.length, instanceId: key, method },
      'warn',
    )
    scheduleRecovery()
  }

  const registry: RendererInstanceRegistry = {
    create,
    destroyAll(reason) {
      if (recoveryTimer) {
        clearTimer(recoveryTimer)
        recoveryTimer = 0
      }
      for (const id of instances.keys()) remove(id, reason)
      orphans.clear()
    },
    diagnostics: () => ({
      claimedCanvasCount: canvasOwners.size,
      instanceCount: instances.size,
      orphanCount: orphans.size,
      recoveryScheduled: Boolean(recoveryTimer),
    }),
    forgetOrphan: (id) => orphans.delete(instanceKey(id)),
    get: (id) => instances.get(instanceKey(id)),
    has: (id) => instances.has(instanceKey(id)),
    orphanCount: () => orphans.size,
    owns: (instance) => instances.get(instanceKey(instance.id)) === instance,
    recover() {
      if (recoveryTimer) {
        clearTimer(recoveryTimer)
        recoveryTimer = 0
      }
      let recoveredCount = 0
      const currentTime = now()
      for (const [id, orphan] of orphans) {
        if (currentTime - orphan.createdAt > orphanTtl) {
          orphans.delete(id)
          emit('orphan-expired', { instanceId: id }, 'warn')
          continue
        }
        const canvas = options.canvasHook.findUnclaimedCanvas(claimedCanvases())
        if (!canvas) continue
        const instance = create(id, canvas, orphan.config, true)
        if (!instance) continue
        orphan.barrages.forEach((barrage) => options.onBarrage(instance, barrage))
        recoveredCount += 1
      }
      scheduleRecovery()
      return recoveredCount
    },
    rememberOrphan,
    remove,
    reset,
    resetAll(reason) {
      for (const instance of instances.values()) reset(instance.id, reason, 'route-change')
    },
    size: () => instances.size,
    sweepDetached() {
      let detachedCount = 0
      const currentTime = now()
      for (const [id, instance] of instances) {
        if (instance.canvas.isConnected) continue
        if (!instance.canvasEverConnected && currentTime < instance.mountGraceUntil) continue
        const config = { ...instance.config }
        remove(id, 'canvas-detached')
        rememberOrphan(id, 'updateConfig', config)
        emit('instance-detached', { instanceId: id }, 'warn')
        detachedCount += 1
      }
      return detachedCount
    },
    updateConfig(id, config) {
      const instance = instances.get(instanceKey(id))
      if (!instance) return null
      Object.assign(instance.config, config)
      return instance
    },
    values: () => instances.values(),
  }

  return registry
}

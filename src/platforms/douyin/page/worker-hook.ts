import type {
  RendererBarrageOptions,
  RendererConfig,
  RendererInstanceId,
  TimestampMilliseconds
} from './runtime-types'

type MessageSenderMethod = (this: object, ...args: unknown[]) => unknown

interface MessageSenderPatchOwner {
  observe: (message: unknown) => void
}

interface MessageSenderPatchRecord {
  original: MessageSenderMethod
  owners: Set<MessageSenderPatchOwner>
  wrapper: MessageSenderMethod
}

export type DouyinRendererCommand =
  | {
      barrages: RendererBarrageOptions[]
      config: Partial<RendererConfig>
      instanceId: RendererInstanceId
      offscreen: unknown
      params: Record<string, unknown>
      type: 'create-instance'
    }
  | {
      barrage: RendererBarrageOptions
      instanceId: RendererInstanceId
      params: Record<string, unknown>
      type: 'add-barrage'
    }
  | {
      config: Partial<RendererConfig>
      instanceId: RendererInstanceId
      params: Record<string, unknown>
      type: 'update-config'
    }
  | {
      instanceId: RendererInstanceId
      type: 'clear' | 'destroy' | 'start' | 'stop'
    }

export type DouyinMessageSenderName = 'MessagePort' | 'Worker'

export interface DouyinMessageSenderTarget {
  name: DouyinMessageSenderName
  prototype: object
}

export interface DouyinWorkerHookDiagnostics {
  commandCount: number
  ignoredMessageCount: number
  installed: boolean
  lastCommandAt: TimestampMilliseconds | 0
  patchedTargets: DouyinMessageSenderName[]
  reusedPatchCount: number
}

export interface DouyinWorkerHookOptions {
  onCommand: (command: DouyinRendererCommand) => void
  onError?: (error: unknown, target: DouyinMessageSenderName) => void
  onPatched?: (target: DouyinMessageSenderName, reused: boolean) => void
  targets?: DouyinMessageSenderTarget[]
}

export interface DouyinWorkerHook {
  destroy: () => void
  diagnostics: () => DouyinWorkerHookDiagnostics
  install: () => boolean
}

interface InstalledTarget {
  owner: MessageSenderPatchOwner
  prototype: object
  record: MessageSenderPatchRecord
}

const MESSAGE_SENDER_PATCH_KEY = Symbol.for('danmaku-echo.douyin.message-sender-patch')

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asBarrageOptions(value: unknown): RendererBarrageOptions | null {
  return isRecord(value) ? value : null
}

function asConfig(value: unknown): Partial<RendererConfig> {
  return isRecord(value) ? value : {}
}

export function parseDouyinRendererCommand(value: unknown): DouyinRendererCommand | null {
  if (!isRecord(value) || typeof value.method !== 'string') return null
  const instanceId = String(value._uniqueId ?? '')
  if (!instanceId) return null
  const params = isRecord(value.params) ? value.params : {}
  switch (value.method) {
    case 'createInstance':
      return {
        barrages: Array.isArray(params.barrages)
          ? params.barrages.map(asBarrageOptions).filter((item) => item !== null)
          : [],
        config: asConfig(params.config),
        instanceId,
        offscreen: params.offscrrenCanvas ?? params.offscreenCanvas,
        params,
        type: 'create-instance'
      }
    case 'addBarrage':
      return { barrage: params, instanceId, params, type: 'add-barrage' }
    case 'updateConfig':
      return { config: asConfig(params), instanceId, params, type: 'update-config' }
    case 'clear':
    case 'destroy':
    case 'start':
    case 'stop':
      return { instanceId, type: value.method }
    default:
      return null
  }
}

function isPatchRecord(value: unknown): value is MessageSenderPatchRecord {
  if (!isRecord(value)) return false
  return (
    typeof value.original === 'function' &&
    value.owners instanceof Set &&
    typeof value.wrapper === 'function'
  )
}

function defaultTargets(): DouyinMessageSenderTarget[] {
  const targets: DouyinMessageSenderTarget[] = []
  if (typeof globalThis.Worker === 'function') {
    targets.push({ name: 'Worker', prototype: globalThis.Worker.prototype })
  }
  if (typeof globalThis.MessagePort === 'function') {
    targets.push({ name: 'MessagePort', prototype: globalThis.MessagePort.prototype })
  }
  return targets
}

export function createDouyinWorkerHook(options: DouyinWorkerHookOptions): DouyinWorkerHook {
  const targets = options.targets ?? defaultTargets()
  const installedTargets = new Map<object, InstalledTarget>()
  const state: DouyinWorkerHookDiagnostics = {
    commandCount: 0,
    ignoredMessageCount: 0,
    installed: false,
    lastCommandAt: 0,
    patchedTargets: [],
    reusedPatchCount: 0
  }

  const installTarget = (target: DouyinMessageSenderTarget): boolean => {
    if (installedTargets.has(target.prototype)) return true
    const slot = target.prototype as Record<PropertyKey, unknown>
    const observe = (message: unknown): void => {
      const command = parseDouyinRendererCommand(message)
      if (!command) {
        state.ignoredMessageCount += 1
        return
      }
      state.commandCount += 1
      state.lastCommandAt = Date.now()
      options.onCommand(command)
    }
    const owner: MessageSenderPatchOwner = {
      observe(message) {
        try {
          observe(message)
        } catch (error) {
          options.onError?.(error, target.name)
        }
      }
    }
    const sharedRecord = slot[MESSAGE_SENDER_PATCH_KEY]
    if (isPatchRecord(sharedRecord) && slot.postMessage === sharedRecord.wrapper) {
      sharedRecord.owners.add(owner)
      installedTargets.set(target.prototype, {
        owner,
        prototype: target.prototype,
        record: sharedRecord
      })
      state.reusedPatchCount += 1
      options.onPatched?.(target.name, true)
      return true
    }
    if (typeof slot.postMessage !== 'function') return false
    const original = slot.postMessage as MessageSenderMethod
    const owners = new Set<MessageSenderPatchOwner>()
    const wrapper: MessageSenderMethod = function danmakuEchoPostMessage(...args: unknown[]) {
      owners.forEach((subscriber) => subscriber.observe(args[0]))
      return Reflect.apply(original, this, args)
    }
    const record: MessageSenderPatchRecord = { original, owners, wrapper }
    owners.add(owner)
    Object.defineProperty(target.prototype, 'postMessage', {
      configurable: true,
      value: wrapper,
      writable: true
    })
    Object.defineProperty(slot, MESSAGE_SENDER_PATCH_KEY, {
      configurable: true,
      value: record
    })
    installedTargets.set(target.prototype, { owner, prototype: target.prototype, record })
    options.onPatched?.(target.name, false)
    return true
  }

  return {
    destroy() {
      installedTargets.forEach(({ owner, prototype, record }) => {
        record.owners.delete(owner)
        const slot = prototype as Record<PropertyKey, unknown>
        if (record.owners.size === 0 && slot.postMessage === record.wrapper) {
          Object.defineProperty(prototype, 'postMessage', {
            configurable: true,
            value: record.original,
            writable: true
          })
          delete slot[MESSAGE_SENDER_PATCH_KEY]
        }
      })
      installedTargets.clear()
      state.installed = false
      state.patchedTargets = []
      state.reusedPatchCount = 0
    },
    diagnostics: () => ({ ...state, patchedTargets: [...state.patchedTargets] }),
    install() {
      if (state.installed) return true
      const patchedTargets = targets.filter(installTarget).map((target) => target.name)
      state.patchedTargets = patchedTargets
      state.installed = patchedTargets.length > 0
      return state.installed
    }
  }
}

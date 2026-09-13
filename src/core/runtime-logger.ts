import { LOG_MESSAGE, type RuntimeLog, redactLogText, sanitizeLogValue } from './runtime-log'

interface Logger {
  record(level: RuntimeLog['level'], message: string, details?: unknown): void
  destroy(): void
  context?: () => unknown
}
const SLOT = '__danmakuEchoRuntimeLogger'
type LoggerGlobal = typeof globalThis & { [SLOT]?: Logger }
export interface LoggerOptions {
  source: string
  captureConsole?: boolean
  extensionOnlyErrors?: boolean
  write?: (entry: RuntimeLog) => Promise<unknown> | void
}

export async function forwardRuntimeLog(entry: RuntimeLog): Promise<void> {
  const response = await globalThis.chrome?.runtime?.sendMessage({
    type: LOG_MESSAGE,
    action: 'append',
    entry,
  })
  if (!response?.ok) throw new Error('runtime-log-write-failed')
}

export function recordRuntimeLog(
  level: RuntimeLog['level'],
  message: string,
  details?: unknown,
): void {
  ;(globalThis as LoggerGlobal)[SLOT]?.record(level, message, details)
}

export function setRuntimeLogContext(context: () => unknown): void {
  const logger = (globalThis as LoggerGlobal)[SLOT]
  if (logger) logger.context = context
}

export function installRuntimeLogger(options: LoggerOptions): Logger {
  const target = globalThis as LoggerGlobal
  if (target[SLOT]) return target[SLOT]
  let destroyed = false
  let recording = false
  let sequence = 0
  let windowAt = Date.now()
  let windowCount = 0
  const session = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  const pending = new Set<ReturnType<typeof setTimeout>>()
  const originals = { warn: console.warn, error: console.error }
  const wrappers: Partial<typeof originals> = {}
  const write = options.write || forwardRuntimeLog
  function deliver(entry: RuntimeLog, retry = true): void {
    try {
      Promise.resolve(write(entry)).catch(() => {
        if (!retry || destroyed || pending.size >= 20) return
        const timer = setTimeout(() => {
          pending.delete(timer)
          deliver(entry, false)
        }, 1000)
        pending.add(timer)
      })
    } catch {
      /* Logging must never break the feature that failed. */
    }
  }
  const logger: Logger = {
    record(level, message, details) {
      if (destroyed || recording) return
      if (Date.now() - windowAt >= 60_000) {
        windowAt = Date.now()
        windowCount = 0
      }
      if (windowCount >= 60) return
      windowCount++
      recording = true
      try {
        let snapshot: unknown = null
        try {
          snapshot = logger.context?.()
        } catch {
          snapshot = '[snapshot-unavailable]'
        }
        const context = {
          version: globalThis.chrome?.runtime?.getManifest?.().version || 'page',
          browser: globalThis.navigator?.userAgent,
          host: globalThis.location?.hostname,
          viewport: typeof window === 'undefined' ? null : [window.innerWidth, window.innerHeight],
          screen: typeof screen === 'undefined' ? null : [screen.width, screen.height],
          pixelRatio: globalThis.devicePixelRatio,
          visibility: globalThis.document?.visibilityState,
          fullscreen: Boolean(globalThis.document?.fullscreenElement),
          snapshot,
          callStack: new Error('log-callsite').stack,
        }
        deliver({
          id: session + ':' + ++sequence,
          at: Date.now(),
          level,
          source: options.source,
          message: redactLogText(message),
          details: sanitizeLogValue(details),
          context: sanitizeLogValue(context),
        })
      } catch {
        /* Even hostile objects must not escape a console wrapper. */
      } finally {
        recording = false
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      for (const level of ['warn', 'error'] as const) {
        if (console[level] === wrappers[level]) console[level] = originals[level]
      }
      target.removeEventListener?.('error', onError)
      target.removeEventListener?.('unhandledrejection', onRejection)
      target.removeEventListener?.('pagehide', onPageHide)
      pending.forEach(clearTimeout)
      pending.clear()
      logger.context = undefined
      if (target[SLOT] === logger) delete target[SLOT]
    },
  }
  function owned(value: string): boolean {
    if (!options.extensionOnlyErrors) return true
    const extensionRoot = globalThis.chrome?.runtime?.getURL?.('')
    if (extensionRoot) return value.includes(extensionRoot)
    return /(?:chrome|moz)-extension:\/\/[^/]+\/src\/(?:content|douyin-(?:content|page-hook|bootstrap))\.js\b/.test(
      value,
    )
  }
  function onError(event: Event): void {
    const error = event as ErrorEvent
    if (owned(String(error.filename || '') + '\n' + String(error.error?.stack || ''))) {
      logger.record('error', 'uncaught-exception', {
        error: error.error || error.message,
        file: error.filename,
        line: error.lineno,
        column: error.colno,
      })
    }
  }
  function onRejection(event: Event): void {
    const reason = (event as PromiseRejectionEvent).reason
    if (owned(reason instanceof Error ? reason.stack || '' : ''))
      logger.record('error', 'unhandled-rejection', reason)
  }
  function onPageHide(event: Event): void {
    if (!(event as PageTransitionEvent).persisted) logger.destroy()
  }
  target[SLOT] = logger
  if (options.captureConsole !== false) {
    for (const level of ['warn', 'error'] as const) {
      const wrapper = (...args: unknown[]): void => {
        try {
          originals[level].apply(console, args)
        } finally {
          if (typeof args[0] === 'string' && /\[(?:Danmaku Echo|DanmakuEcho|BCP)/i.test(args[0])) {
            logger.record(level, args[0], args.slice(1))
          }
        }
      }
      wrappers[level] = wrapper
      console[level] = wrapper
    }
  }
  target.addEventListener?.('pagehide', onPageHide)
  target.addEventListener?.('error', onError)
  target.addEventListener?.('unhandledrejection', onRejection)
  return logger
}

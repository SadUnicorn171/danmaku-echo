import type { PlatformId } from '../../core/types'
import { recordRuntimeLog } from '../../core/runtime-logger'
import { sanitizeLogValue } from '../../core/runtime-log'
import { captureSendFailureEvidence } from '../../core/send-failure-evidence'
import {
  classifyPlatformSendResponse,
  createPlatformFeedbackProbe,
  createSendProtection,
  formatPlatformSendRequestSummary,
  type PlatformFeedbackProbe,
  type PlatformSendFeedback,
  type PlatformSendResponseSummary,
  type SendBlock,
  type SendBlockReason,
  type SendProtection,
} from './send-protection'
import {
  INSTALL_NATIVE_SEND_OBSERVER,
  isNativeSendObservation,
  type NativeSendObservation,
} from './native-send-observer'

export type SendMethod = 'direct-emoji' | 'native-emoji' | 'panel-emoji' | 'text'
export type SendFailureReason =
  | SendBlockReason
  | 'editor-not-found'
  | 'emoji-text-unavailable'
  | 'input-not-consumed'
  | 'platform-feedback'
  | 'send-failed'
  | 'unconfirmed'

export interface SendResult {
  confirmation?: 'platform' | 'page'
  failureReason?: SendFailureReason
  feedback?: PlatformSendFeedback
  method?: SendMethod
  network?: NativeSendObservation | null
  success: boolean
}

export interface SendNetworkObserver {
  cancel(): void
  read(timeout?: number): Promise<NativeSendObservation | null>
}

export interface SendCoordinatorOptions {
  document?: Document
  feedbackFailureWaitMs?: number
  feedbackSuccessWaitMs?: number
  onBlock?(block: SendBlock, message: string): void
  onFeedback?(feedback: PlatformSendFeedback, message: string): void
  onSuccess?(attemptId: string, sentAtSec: number, roomId: string | undefined, text: string, confirmation: 'platform' | 'page'): void
  onStateChange?(message: string): void
  onUnconfirmed?(summary: string, message: string): void
  platform: PlatformId
  protection?: SendProtection
  roomId?(): string
}

function randomNonce(): string {
  const randomBytes = new Uint32Array(4)
  crypto.getRandomValues(randomBytes)
  return `${Date.now().toString(36)}-${Array.from(randomBytes)
    .map((value) => value.toString(36))
    .join('-')}`
}

async function observeNativeSend(platform: PlatformId): Promise<SendNetworkObserver> {
  const nonce = randomNonce()
  let settled = false
  let latest: NativeSendObservation | null = null
  let resolveResult: (value: NativeSendObservation | null) => void = () => undefined
  const result = new Promise<NativeSendObservation | null>((resolve) => {
    resolveResult = resolve
  })
  const finish = (value: NativeSendObservation | null): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    window.removeEventListener('message', onMessage)
    resolveResult(value || latest)
  }
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== window || !isNativeSendObservation(event.data, nonce, platform)) return
    latest = event.data
    if (latest.pending) return
    finish(event.data)
  }
  const timer = window.setTimeout(() => finish(null), 8_500)
  window.addEventListener('message', onMessage)
  try {
    const installed = await chrome.runtime.sendMessage({
      nonce,
      platform,
      type: INSTALL_NATIVE_SEND_OBSERVER,
    })
    if (!installed?.ok) finish(null)
  } catch {
    finish(null)
  }
  return {
    cancel: () => finish(null),
    read: (timeout = 160) =>
      Promise.race([
        result,
        new Promise<NativeSendObservation | null>((resolve) => setTimeout(() => resolve(latest), Math.max(0, timeout))),
      ]),
  }
}

export class SendCoordinator {
  private readonly feedbackFailureWaitMs: number
  private readonly feedbackSuccessWaitMs: number
  private readonly options: SendCoordinatorOptions
  private readonly protection: SendProtection
  private attempt: { id: string; at: number; recorded: boolean; roomId?: string; text: string; successRecorded: boolean } | null = null
  private evidenceWindowAt = 0
  private evidenceCount = 0
  private failureContext: { network?: unknown; method?: SendMethod; reason?: string } = {}

  constructor(options: SendCoordinatorOptions) {
    this.options = options
    this.protection = options.protection ?? createSendProtection()
    this.feedbackFailureWaitMs = Math.max(0, options.feedbackFailureWaitMs ?? 1_800)
    this.feedbackSuccessWaitMs = Math.max(0, options.feedbackSuccessWaitMs ?? 500)
  }

  begin(message: string, text = message): boolean {
    return this.beginResult(message, text).allowed
  }

  beginResult(message: string, text = message): SendBlock {
    const block = this.protection.begin(message)
    if (block.allowed) {
      let roomId: string | undefined
      try { roomId = this.options.roomId?.() } catch { /* Room metadata cannot block sending. */ }
      this.attempt = { id: randomNonce(), at: Date.now(), recorded: false, roomId, text, successRecorded: false }
      this.failureContext = {}
    }
    if (!block.allowed) this.options.onBlock?.(block, message)
    return block
  }

  finish(message: string, success: boolean, text?: string, confirmation: 'platform' | 'page' = 'page'): void {
    if (!success) this.recordFailure(this.failureContext.reason || 'send-failed', message)
    this.protection.finish(message, success)
    if (success && this.attempt && !this.attempt.successRecorded) {
      this.attempt.successRecorded = true
      try {
        this.options.onSuccess?.(this.attempt.id, Math.floor(Date.now() / 1_000), this.attempt.roomId, text ?? this.attempt.text, confirmation)
      } catch {
        // Statistics must not turn an otherwise successful send into a failure.
      }
    }
    this.options.onStateChange?.(message)
  }

  applyFeedback(feedback: PlatformSendFeedback, message: string): void {
    this.recordFailure('platform-feedback', message, feedback)
    this.protection.applyPlatformFeedback(feedback, message)
    this.options.onFeedback?.(feedback, message)
    this.options.onStateChange?.(message)
  }

  remainingMs(message: string): number {
    return this.protection.remainingMs(message)
  }

  feedbackProbe(root: Document | Element = document): PlatformFeedbackProbe {
    return createPlatformFeedbackProbe(root)
  }

  observeNetwork(): Promise<SendNetworkObserver> {
    return observeNativeSend(this.options.platform)
  }

  /** Allows platform-owned fallback paths to attach their existing request trace. */
  setFailureContext(context: { network?: unknown; method?: SendMethod; reason?: string }): void {
    if (this.attempt && context.method && context.method !== this.failureContext.method) this.attempt.recorded = false
    this.failureContext = context
  }

  private recordFailure(reason: string, message: string, feedback?: PlatformSendFeedback): void {
    const attempt = this.attempt
    if (!attempt || attempt.recorded) return
    attempt.recorded = true
    const now = Date.now()
    if (now - this.evidenceWindowAt >= 60_000) {
      this.evidenceWindowAt = now
      this.evidenceCount = 0
    }
    const capture = this.evidenceCount++ < 3
    const doc = this.options.document || globalThis.document
    // Official error envelopes may echo the submitted text. Keep it out of logs.
    const hideSubmittedText = (value: unknown): unknown => {
      if (typeof value === 'string') return message ? value.split(message).join('[redacted]') : value
      if (Array.isArray(value)) return value.map(hideSubmittedText)
      if (value && typeof value === 'object') return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, hideSubmittedText(item)]),
      )
      return value
    }
    recordRuntimeLog('error', 'send-failure', {
      attemptId: attempt.id,
      platform: this.options.platform,
      reason,
      method: this.failureContext.method,
      elapsedMs: Math.max(0, now - attempt.at),
      network: hideSubmittedText(sanitizeLogValue(this.failureContext.network || null)),
      networkObserved: Boolean(this.failureContext.network),
      feedback: feedback ? hideSubmittedText(sanitizeLogValue({ ...feedback, apiMessage: feedback.message })) : null,
      pageSnapshot: capture && doc ? 'attached-if-available' : 'rate-limited-or-unavailable',
    }, capture && doc ? () => captureSendFailureEvidence(attempt.id, attempt.at, doc) : undefined)
  }

  async settle(options: {
    feedbackProbe: PlatformFeedbackProbe
    message: string
    method?: SendMethod
    networkObserver?: SendNetworkObserver | null
    success: boolean
    /** Final editor text when preparation differs from the protection key. */
    text?: string
  }): Promise<SendResult> {
    const { feedbackProbe, message, method, networkObserver, success } = options
    let feedback = await feedbackProbe.wait(
      success ? this.feedbackSuccessWaitMs : this.feedbackFailureWaitMs,
    )
    const network = networkObserver ? await networkObserver.read(feedback ? 220 : 160) : null
    this.failureContext = { ...this.failureContext, method, ...(network ? { network: { ...network, apiMessage: network.message } } : {}) }
    networkObserver?.cancel()
    const networkFeedback =
      network && !network.requestOnly
        ? classifyPlatformSendResponse(network as PlatformSendResponseSummary)
        : null
    if (feedback && network) {
      feedback = {
        ...feedback,
        code: network.code,
        endpoint: network.endpoint,
        httpStatus: network.httpStatus,
        method: network.method,
        source: 'network',
        transport: network.transport,
      }
    } else if (!feedback && networkFeedback) {
      feedback = networkFeedback
    }
    if (feedback) {
      this.applyFeedback(feedback, message)
      return { failureReason: 'platform-feedback', feedback, method, network, success: false }
    }

    const networkSummary = network ? formatPlatformSendRequestSummary(network) : ''
    if (!success && networkSummary) {
      this.failureContext.reason = 'unconfirmed'
      this.finish(message, false)
      this.options.onUnconfirmed?.(networkSummary, message)
      return { failureReason: 'unconfirmed', method, network, success: false }
    }
    const confirmation = network && !network.pending && !network.requestOnly
      && (network.code === 0 || network.code === '0') ? 'platform' : 'page'
    this.finish(message, success, options.text, confirmation)
    return {
      confirmation: success ? confirmation : undefined,
      failureReason: success ? undefined : 'send-failed',
      method,
      network,
      success,
    }
  }
}

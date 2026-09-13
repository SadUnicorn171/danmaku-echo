import type { PlatformId } from '../../core/types'
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
  feedbackFailureWaitMs?: number
  feedbackSuccessWaitMs?: number
  onBlock?(block: SendBlock, message: string): void
  onFeedback?(feedback: PlatformSendFeedback, message: string): void
  onStateChange?(message: string): void
  onUnconfirmed?(summary: string, message: string): void
  platform: PlatformId
  protection?: SendProtection
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
  let resolveResult: (value: NativeSendObservation | null) => void = () => undefined
  const result = new Promise<NativeSendObservation | null>((resolve) => {
    resolveResult = resolve
  })
  const finish = (value: NativeSendObservation | null): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    window.removeEventListener('message', onMessage)
    resolveResult(value)
  }
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== window || !isNativeSendObservation(event.data, nonce, platform)) return
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
        new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(0, timeout))),
      ]),
  }
}

export class SendCoordinator {
  private readonly feedbackFailureWaitMs: number
  private readonly feedbackSuccessWaitMs: number
  private readonly options: SendCoordinatorOptions
  private readonly protection: SendProtection

  constructor(options: SendCoordinatorOptions) {
    this.options = options
    this.protection = options.protection ?? createSendProtection()
    this.feedbackFailureWaitMs = Math.max(0, options.feedbackFailureWaitMs ?? 1_800)
    this.feedbackSuccessWaitMs = Math.max(0, options.feedbackSuccessWaitMs ?? 500)
  }

  begin(message: string): boolean {
    return this.beginResult(message).allowed
  }

  beginResult(message: string): SendBlock {
    const block = this.protection.begin(message)
    if (!block.allowed) this.options.onBlock?.(block, message)
    return block
  }

  finish(message: string, success: boolean): void {
    this.protection.finish(message, success)
    this.options.onStateChange?.(message)
  }

  applyFeedback(feedback: PlatformSendFeedback, message: string): void {
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

  async settle(options: {
    feedbackProbe: PlatformFeedbackProbe
    message: string
    method?: SendMethod
    networkObserver?: SendNetworkObserver | null
    success: boolean
  }): Promise<SendResult> {
    const { feedbackProbe, message, method, networkObserver, success } = options
    let feedback = await feedbackProbe.wait(
      success ? this.feedbackSuccessWaitMs : this.feedbackFailureWaitMs,
    )
    const network = networkObserver ? await networkObserver.read(feedback ? 220 : 160) : null
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
      this.finish(message, false)
      this.options.onUnconfirmed?.(networkSummary, message)
      return { failureReason: 'unconfirmed', method, network, success: false }
    }
    this.finish(message, success)
    return {
      failureReason: success ? undefined : 'send-failed',
      method,
      network,
      success,
    }
  }
}

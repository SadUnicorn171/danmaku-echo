import { t } from '../../core/i18n'
import type { SendCoordinator } from './send-coordinator'

export interface LiveTextSenderRuntime {
  coordinator: SendCoordinator
  document: Document
  findInput(): HTMLElement | null
  findSendButton(input: HTMLElement): HTMLElement | null
  platformName: string
  pressEnter(input: HTMLElement): void
  releaseInputFocus(input: HTMLElement): void
  setNativeValue(input: HTMLElement, value: string): void
  showToast(message: string, tone: 'error' | 'info' | 'success' | 'warning'): void
  waitForInputConsumption(input: HTMLElement, message: string, timeout: number): Promise<boolean>
}

export class LiveTextSender {
  readonly #runtime: LiveTextSenderRuntime

  constructor(runtime: LiveTextSenderRuntime) {
    this.#runtime = runtime
  }

  async send(message: string): Promise<boolean> {
    const runtime = this.#runtime
    if (!runtime.coordinator.begin(message)) return false
    const input = runtime.findInput()
    if (!input) {
      runtime.coordinator.finish(message, false)
      runtime.showToast(t('toastEditorNotFound', runtime.platformName), 'error')
      return false
    }

    runtime.setNativeValue(input, message)
    await new Promise((resolve) => setTimeout(resolve, 80))
    let button = runtime.findSendButton(input)
    const networkObserver = await runtime.coordinator.observeNetwork()
    const feedbackProbe = runtime.coordinator.feedbackProbe(runtime.document)
    if (button) button.click()
    else runtime.pressEnter(input)

    let consumed = await runtime.waitForInputConsumption(input, message, 320)
    if (!consumed) {
      runtime.pressEnter(input)
      consumed = await runtime.waitForInputConsumption(input, message, 260)
    }
    if (!consumed) {
      button = runtime.findSendButton(input)
      if (button) {
        button.click()
        consumed = await runtime.waitForInputConsumption(input, message, 320)
      }
    }
    if (!consumed) {
      const settled = await runtime.coordinator.settle({
        feedbackProbe,
        message,
        method: 'text',
        networkObserver,
        success: false,
      })
      if (settled.failureReason !== 'platform-feedback' && settled.failureReason !== 'unconfirmed') {
        runtime.showToast(t('toastAutomaticSendFailed'), 'error')
      }
      return false
    }

    const settled = await runtime.coordinator.settle({
      feedbackProbe,
      message,
      method: 'text',
      networkObserver,
      success: true,
    })
    if (!settled.success) return false
    runtime.releaseInputFocus(input)
    runtime.showToast(t('toastPlusOneSent'), 'success')
    return true
  }
}

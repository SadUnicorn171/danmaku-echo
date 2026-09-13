import { t } from '../../../core/i18n'
import type { RichPayload } from '../own-message'
import { douyinAutoRecognizedEmojiText } from '../rich-message-sender'
import {
  formatPlatformSendFeedback,
  type PlatformSendFeedback,
  type SendBlock,
  type SendProtection,
} from '../../live/send-protection'
import {
  SendCoordinator,
  type SendMethod,
  type SendNetworkObserver,
  type SendResult,
} from '../../live/send-coordinator'
import { SEND_BUTTON_SELECTORS } from './dom-config'
import type { DouyinEditorController } from './editor-controller'

export type DouyinSendDebugLevel = 'error' | 'info' | 'warning'

export interface DouyinSendControllerOptions {
  announceOwnMessage(payload: RichPayload, source: 'plus-one'): string
  cancelOwnMessageAnnouncement(intentId: string): void
  document: Document
  editor: DouyinEditorController
  feedbackFailureWaitMs?: number
  feedbackSuccessWaitMs?: number
  isVisible(element: Element): boolean
  normalizePayload(value: RichPayload | string): RichPayload
  normalizeWhitespace(value: unknown): string
  observeNetwork(): Promise<SendNetworkObserver>
  onAttempt?(message: string, payload: RichPayload): void
  onCooldownChange?(message: string): void
  onDebug?(type: string, details: unknown, level: DouyinSendDebugLevel): void
  onFailure?(message: string, payload: RichPayload, result: SendResult): void
  onSuccess?(message: string, payload: RichPayload, result: SendResult): void
  platformName: string
  protection: SendProtection
  query(selectors: readonly string[], root?: Document | Element | ShadowRoot): Element[]
  sendDelayMs?: number
  showToast(message: string, tone: 'error' | 'info' | 'success' | 'warning'): void
}

export interface DouyinSendController {
  send(message: string, richValue?: RichPayload | string): Promise<SendResult>
}

interface PreparedInput {
  method: SendMethod
  ok: boolean
  reason?: 'emoji-text-unavailable'
  text: string
}

const NEARBY_BUTTON_SELECTORS = [
  'button',
  "[role='button']",
  "[data-e2e*='send' i]",
  "[aria-label*='发送']",
  "[class*='send' i]",
] as const

function sendBlockToast(
  block: SendBlock,
  showToast: DouyinSendControllerOptions['showToast'],
): void {
  const seconds = Math.max(1, Math.ceil(block.remainingMs / 1_000))
  if (block.reason === 'duplicate') {
    showToast(t('toastDuplicateCooldown', String(seconds)), 'warning')
  } else if (block.reason === 'in-flight') {
    showToast(t('toastSendInProgress'), 'warning')
  } else if (block.reason === 'cooldown') {
    showToast(t('toastSendCooldown', String(seconds)), 'warning')
  } else {
    showToast(t('toastAccidentalSendBlocked'), 'warning')
  }
}

export function createDouyinSendController(
  options: DouyinSendControllerOptions,
): DouyinSendController {
  const coordinator = new SendCoordinator({
    feedbackFailureWaitMs: options.feedbackFailureWaitMs,
    feedbackSuccessWaitMs: options.feedbackSuccessWaitMs,
    onBlock(block, message) {
      sendBlockToast(block, options.showToast)
      options.onCooldownChange?.(message)
    },
    onFeedback(feedback) {
      showPlatformFeedback(feedback)
    },
    onStateChange: options.onCooldownChange,
    onUnconfirmed(summary) {
      options.showToast(
        t('toastPlatformSendUnconfirmed', [options.platformName, summary]),
        'error',
      )
    },
    platform: 'douyin',
    protection: options.protection,
  })
  const sendDelayMs = Math.max(0, options.sendDelayMs ?? 80)

  function debug(type: string, details: unknown, level: DouyinSendDebugLevel): void {
    options.onDebug?.(type, details, level)
  }

  function showPlatformFeedback(feedback: PlatformSendFeedback): void {
    const seconds = Math.max(1, Math.ceil(feedback.cooldownMs / 1_000))
    options.showToast(
      feedback.cooldownMs > 0
        ? t('toastPlatformCooldown', [
            options.platformName,
            formatPlatformSendFeedback(feedback),
            String(seconds),
          ])
        : t('toastPlatformRejected', [
            options.platformName,
            formatPlatformSendFeedback(feedback),
          ]),
      feedback.kind === 'rejected' ? 'error' : 'warning',
    )
  }

  function buttonScore(
    button: HTMLElement,
    editor: HTMLElement,
    selectorIndex: number,
    scopeBonus: number,
  ): number {
    if (
      !options.isVisible(button) ||
      button.matches(':disabled') ||
      button.getAttribute('aria-disabled') === 'true' ||
      typeof button.click !== 'function'
    ) {
      return Number.NEGATIVE_INFINITY
    }
    const text = options.normalizeWhitespace(
      button.innerText || button.textContent || button.getAttribute('aria-label'),
    )
    const marker = [
      button.getAttribute('data-e2e'),
      button.getAttribute('data-testid'),
      button.getAttribute('aria-label'),
      typeof button.className === 'string' ? button.className : '',
    ]
      .filter(Boolean)
      .join(' ')
    let score = 100 - selectorIndex + scopeBonus
    if (/^(发送|发 送|send)$/i.test(text)) score += 200
    else if (/(发送|send)/i.test(text)) score += 80
    if (/(send|发送|danmu|danmaku|comment)/i.test(marker)) score += 120
    const editorRect = editor.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    const distance =
      Math.abs(buttonRect.left - editorRect.right) +
      Math.abs(buttonRect.top - editorRect.top)
    return score - Math.min(distance / 10, 100)
  }

  function findSendButton(editor: HTMLElement): HTMLElement | null {
    const candidates: Array<{
      button: HTMLElement
      index: number
      scopeBonus: number
    }> = []
    const seen = new Set<HTMLElement>()
    const add = (element: Element, index: number, scopeBonus: number): void => {
      if (!(element instanceof HTMLElement) || seen.has(element)) return
      seen.add(element)
      candidates.push({ button: element, index, scopeBonus })
    }
    let parent = editor.parentElement
    for (let depth = 0; parent && depth < 6; depth += 1, parent = parent.parentElement) {
      options
        .query(NEARBY_BUTTON_SELECTORS, parent)
        .forEach((button) => add(button, SEND_BUTTON_SELECTORS.length + 1, 360 - depth * 50))
    }
    SEND_BUTTON_SELECTORS.forEach((selector, index) => {
      options.query([selector]).forEach((button) => add(button, index, 0))
    })
    candidates.sort(
      (left, right) =>
        buttonScore(right.button, editor, right.index, right.scopeBonus) -
        buttonScore(left.button, editor, left.index, left.scopeBonus),
    )
    const best = candidates[0]
    return best &&
      buttonScore(best.button, editor, best.index, best.scopeBonus) >
        Number.NEGATIVE_INFINITY
      ? best.button
      : null
  }

  function prepareInput(editor: HTMLElement, payload: RichPayload): PreparedInput {
    const emojiParts = payload.parts.filter((part) => part.type === 'emoji')
    if (!emojiParts.length) {
      options.editor.setValue(editor, payload.text)
      return { method: 'text', ok: true, text: payload.text }
    }
    const nativeText = douyinAutoRecognizedEmojiText(payload)
    if (nativeText) {
      options.editor.setValue(editor, nativeText)
      debug(
        'bracket-emoji-text-ready',
        {
          emojiCount: emojiParts.length,
          textLength: Array.from(nativeText).length,
        },
        'info',
      )
      return { method: 'native-emoji', ok: true, text: nativeText }
    }
    debug(
      'emoji-text-unavailable',
      {
        emojiCount: emojiParts.length,
        message: payload.text,
        tokens: emojiParts.map((part) => String(part.asset.token || '').slice(0, 120)),
      },
      'error',
    )
    return {
      method: 'native-emoji',
      ok: false,
      reason: 'emoji-text-unavailable',
      text: '',
    }
  }

  async function waitForConsumption(
    editor: HTMLElement,
    prepared: PreparedInput,
  ): Promise<boolean> {
    const wait = (timeoutMs: number): Promise<boolean> =>
      prepared.method === 'native-emoji'
        ? options.editor.waitForClear(editor, timeoutMs)
        : options.editor.waitForConsumption(editor, prepared.text, timeoutMs)
    let consumed = await wait(prepared.method === 'native-emoji' ? 420 : 320)
    if (!consumed) {
      options.editor.pressEnter(editor)
      consumed = await wait(prepared.method === 'native-emoji' ? 320 : 260)
    }
    if (!consumed) {
      const button = findSendButton(editor)
      if (button) {
        button.click()
        consumed = await wait(prepared.method === 'native-emoji' ? 420 : 320)
      }
    }
    return consumed
  }

  function failure(
    message: string,
    payload: RichPayload,
    result: SendResult,
    level: DouyinSendDebugLevel = 'error',
  ): SendResult {
    options.onFailure?.(message, payload, result)
    debug('send-failed', { message, reason: result.failureReason }, level)
    return result
  }

  async function send(message: string, richValue?: RichPayload | string): Promise<SendResult> {
    const block = coordinator.beginResult(message)
    if (!block.allowed) {
      return {
        failureReason: block.reason ?? 'send-failed',
        success: false,
      }
    }

    const payload = options.normalizePayload(richValue ?? message)
    const emojiCount = payload.parts.filter((part) => part.type === 'emoji').length
    options.onAttempt?.(message, payload)
    debug(
      'send-attempt',
      {
        emojiCount,
        message,
        plainText: emojiCount ? payload.plainText : message,
      },
      'info',
    )
    const editor = options.editor.find()
    if (!editor) {
      coordinator.finish(message, false)
      options.showToast(t('toastEditorNotFound', options.platformName), 'error')
      return failure(message, payload, {
        failureReason: 'editor-not-found',
        success: false,
      })
    }

    const networkObserver = await options.observeNetwork()
    const feedbackProbe = coordinator.feedbackProbe(options.document)
    const ownIntentId = options.announceOwnMessage(payload, 'plus-one')
    try {
      const prepared = prepareInput(editor, payload)
      if (sendDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, sendDelayMs))
      }
      if (!prepared.ok) {
        options.cancelOwnMessageAnnouncement(ownIntentId)
        const settled = await coordinator.settle({
          feedbackProbe,
          message,
          method: prepared.method,
          networkObserver,
          success: false,
        })
        if (settled.failureReason === 'platform-feedback' || settled.failureReason === 'unconfirmed') {
          return failure(message, payload, settled, 'warning')
        }
        options.editor.setValue(editor, '')
        options.showToast(t('toastDouyinEmojiTextUnavailable'), 'error')
        return failure(message, payload, {
          ...settled,
          failureReason: prepared.reason,
        })
      }

      const button = findSendButton(editor)
      if (button) button.click()
      else options.editor.pressEnter(editor)
      const consumed = await waitForConsumption(editor, prepared)
      if (!consumed) {
        options.cancelOwnMessageAnnouncement(ownIntentId)
        const settled = await coordinator.settle({
          feedbackProbe,
          message,
          method: prepared.method,
          networkObserver,
          success: false,
        })
        if (settled.failureReason === 'platform-feedback' || settled.failureReason === 'unconfirmed') {
          return failure(message, payload, settled, 'warning')
        }
        options.showToast(t('toastAutomaticSendFailed'), 'error')
        return failure(message, payload, {
          ...settled,
          failureReason: 'input-not-consumed',
        })
      }

      options.editor.releaseFocus(editor)
      const settled = await coordinator.settle({
        feedbackProbe,
        message,
        method: prepared.method,
        networkObserver,
        success: true,
      })
      if (!settled.success) return failure(message, payload, settled, 'warning')
      options.onSuccess?.(message, payload, settled)
      debug('send-succeeded', { emojiCount, message }, 'info')
      options.showToast(
        prepared.method === 'native-emoji' ? t('toastRichPlusOneSent') : t('toastPlusOneSent'),
        'success',
      )
      return settled
    } catch {
      feedbackProbe.stop()
      networkObserver.cancel()
      options.cancelOwnMessageAnnouncement(ownIntentId)
      coordinator.finish(message, false)
      options.showToast(t('toastAutomaticSendFailed'), 'error')
      return failure(message, payload, {
        failureReason: 'send-failed',
        method: emojiCount ? 'native-emoji' : 'text',
        success: false,
      })
    }
  }

  return { send }
}

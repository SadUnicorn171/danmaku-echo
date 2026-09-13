import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { normalizeRichPayload, type RichPayload } from '../../own-message'
import { NATIVE_SEND_RESULT_SOURCE, type NativeSendObservation } from '../../../live/native-send-observer'
import { createSendProtection } from '../../../live/send-protection'
import type { SendNetworkObserver, SendResult } from '../../../live/send-coordinator'
import type { DouyinEditorController } from '../editor-controller'
import { createDouyinSendController } from '../send-controller'

interface HarnessOptions {
  clock?: () => number
  consumed?: boolean
  input?: HTMLTextAreaElement | null
  network?: NativeSendObservation | null
}

function imagePayload(text: string): RichPayload {
  return {
    assets: [{ keys: ['emoji:shamate'], src: '', token: '' }],
    parts: [
      { asset: { keys: ['emoji:shamate'], src: '', token: '' }, type: 'emoji' },
      { text: 'cyh', type: 'text' },
    ],
    plainText: 'cyh',
    text,
  }
}

function createNetworkObserver(value: NativeSendObservation | null): SendNetworkObserver {
  return {
    cancel: () => undefined,
    read: () => Promise.resolve(value),
  }
}

function createHarness(options: HarnessOptions = {}) {
  const input = options.input === undefined ? document.createElement('textarea') : options.input
  const button = document.createElement('button')
  button.textContent = '发送'
  button.dataset.e2e = 'chat-room-send'
  const wrapper = document.createElement('section')
  if (input) wrapper.append(input)
  wrapper.append(button)
  document.body.append(wrapper)
  let buttonClicks = 0
  let enterPresses = 0
  let released = 0
  const written: string[] = []
  const canceledIntents: string[] = []
  const toasts: string[] = []
  const failures: SendResult[] = []
  button.addEventListener('click', () => {
    buttonClicks += 1
  })
  const editor: DouyinEditorController = {
    contains: () => true,
    destroy: () => undefined,
    editableFrom: () => input,
    find: () => input,
    isEmpty: () => false,
    mention: () => '',
    prepareReply: () => {
      throw new Error('not used by send controller')
    },
    pressEnter: () => {
      enterPresses += 1
    },
    read: () => input?.value ?? '',
    releaseFocus: () => {
      released += 1
    },
    setValue: (_editor, value) => {
      written.push(value)
      if (input) input.value = value
    },
    start: () => undefined,
    waitForClear: () => Promise.resolve(options.consumed ?? true),
    waitForConsumption: () => Promise.resolve(options.consumed ?? true),
  }
  const protection = createSendProtection({ now: options.clock })
  const controller = createDouyinSendController({
    announceOwnMessage: () => 'intent-1',
    cancelOwnMessageAnnouncement: (intentId) => canceledIntents.push(intentId),
    document,
    editor,
    feedbackFailureWaitMs: 0,
    feedbackSuccessWaitMs: 0,
    isVisible: () => true,
    normalizePayload: (value) =>
      normalizeRichPayload(value, (text) => String(text ?? '').trim(), 1_000),
    normalizeWhitespace: (value) => String(value ?? '').replace(/\s+/g, ' ').trim(),
    observeNetwork: () => Promise.resolve(createNetworkObserver(options.network ?? null)),
    onFailure: (_message, _payload, result) => failures.push(result),
    platformName: '抖音直播',
    protection,
    query: (selectors, root = document) =>
      Array.from(root.querySelectorAll(selectors.join(','))),
    sendDelayMs: 0,
    showToast: (message) => toasts.push(message),
  })
  return {
    canceledIntents,
    controller,
    failures,
    get buttonClicks() {
      return buttonClicks
    },
    get enterPresses() {
      return enterPresses
    },
    get released() {
      return released
    },
    toasts,
    written,
  }
}

describe('DouyinSendController', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('sends ordinary text through the discovered nearby button', async () => {
    const harness = createHarness()

    const result = await harness.controller.send('普通弹幕')

    expect(result).toMatchObject({ method: 'text', success: true })
    expect(harness.written).toEqual(['普通弹幕'])
    expect(harness.buttonClicks).toBe(1)
    expect(harness.enterPresses).toBe(0)
    expect(harness.released).toBe(1)
  })

  it.each([
    '[杀马特][杀马特][杀马特]',
    '[杀马特][杀马特][杀马特]cyh[杀马特][杀马特][杀马特]cyh',
  ])('sends continuous and mixed bracket Emoji as complete text: %s', async (text) => {
    const harness = createHarness()
    const payload = imagePayload(text)

    const result = await harness.controller.send(text, payload)

    expect(result).toMatchObject({ method: 'native-emoji', success: true })
    expect(harness.written).toEqual([text])
  })

  it('does not require an image URL or token when the complete bracket text exists', async () => {
    const harness = createHarness()
    const payload = imagePayload('[杀马特]cyh')

    const result = await harness.controller.send(payload.text, payload)

    expect(result.success).toBe(true)
    expect(harness.written).toEqual(['[杀马特]cyh'])
  })

  it('blocks immediate duplicate and accidental repeat clicks', async () => {
    let now = 1_000
    const duplicate = createHarness({ clock: () => now })
    expect((await duplicate.controller.send('相同弹幕')).success).toBe(true)
    now += 1_001
    const duplicateResult = await duplicate.controller.send('相同弹幕')
    expect(duplicateResult).toMatchObject({ failureReason: 'duplicate', success: false })
    expect(duplicate.buttonClicks).toBe(1)

    document.body.replaceChildren()
    const accidental = createHarness({ clock: () => now, input: null })
    expect((await accidental.controller.send('第一条')).failureReason).toBe('editor-not-found')
    const accidentalResult = await accidental.controller.send('第二条')
    expect(accidentalResult).toMatchObject({ failureReason: 'accidental', success: false })
  })

  it('applies a platform rate limit to following sends', async () => {
    const now = 2_000
    const network: NativeSendObservation = {
      code: 1,
      endpoint: 'live.douyin.com/send',
      httpStatus: 200,
      message: '发送太快，请稍后再试',
      method: 'POST',
      nonce: 'test-nonce',
      platform: 'douyin',
      source: NATIVE_SEND_RESULT_SOURCE,
      transport: 'fetch',
      type: 'native-send-result',
    }
    const harness = createHarness({ clock: () => now, network })

    const limited = await harness.controller.send('第一条')
    const blocked = await harness.controller.send('第二条')

    expect(limited).toMatchObject({ failureReason: 'platform-feedback', success: false })
    expect(blocked).toMatchObject({ failureReason: 'cooldown', success: false })
    expect(harness.toasts.some((message) => message.includes('发送太快'))).toBe(true)
    expect(harness.toasts.some((message) => message.includes('live.douyin.com/send'))).toBe(true)
  })

  it('returns input-not-consumed and cancels the own-message intent after all fallbacks', async () => {
    const harness = createHarness({ consumed: false })

    const result = await harness.controller.send('无法消费')

    expect(result).toMatchObject({ failureReason: 'input-not-consumed', success: false })
    expect(harness.buttonClicks).toBe(2)
    expect(harness.enterPresses).toBe(1)
    expect(harness.canceledIntents).toEqual(['intent-1'])
    expect(harness.failures.at(-1)?.failureReason).toBe('input-not-consumed')
  })

  it('keeps repeatMessage business and send mechanics out of the entry', () => {
    const source = readFileSync(
      resolvePath(process.cwd(), 'src/platforms/douyin/content/content-app.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/function\s+repeatMessage\s*\(/)
    expect(source).not.toMatch(/function\s+findSendButton\s*\(/)
    expect(source).not.toMatch(/function\s+finishProtectedSend\s*\(/)
    expect(source).toContain('createDouyinSendController')
  })
})

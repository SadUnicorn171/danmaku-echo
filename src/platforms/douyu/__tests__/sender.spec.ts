import { describe, expect, it } from 'vitest'

import type { RichMessagePayload } from '../../live/rich-message'
import type { SendCoordinator } from '../../live/send-coordinator'
import type { LiveTextSender } from '../../live/text-sender'
import { DouyuSender, type DouyuSenderRuntime } from '../sender'

function payload(token: string, mixed = false): RichMessagePayload {
  const value = { keys: [`token:${token}`], src: 'https://example.com/emoji.png', token }
  return {
    assets: [value],
    parts: mixed
      ? [
          { text: '前', type: 'text' },
          { asset: value, type: 'emoji' },
          { text: '后', type: 'text' },
        ]
      : [{ asset: value, type: 'emoji' }],
    plainText: mixed ? '前后' : '',
    text: mixed ? `前${token}后` : token,
  }
}

function runtime(options: {
  item?: HTMLElement | null
  result?: 'dispatched' | 'inserted' | 'none' | 'sent'
  settleSuccess?: boolean
} = {}): { sent: string[]; toasts: string[]; value: DouyuSenderRuntime } {
  const input = document.createElement('div')
  document.body.append(input)
  const sent: string[] = []
  const toasts: string[] = []
  const item = options.item === undefined ? document.createElement('button') : options.item
  if (item) document.body.append(item)
  const coordinator = {
    begin: () => true,
    feedbackProbe: () => ({ stop: () => undefined, wait: async () => null }),
    finish: () => undefined,
    observeNetwork: async () => ({ cancel: () => undefined, read: async () => null }),
    settle: async () => ({
      failureReason: options.settleSuccess === false ? 'platform-feedback' : undefined,
      success: options.settleSuccess !== false,
    }),
  } as unknown as SendCoordinator
  return {
    sent,
    toasts,
    value: {
      assetMatchScore: (element) => (element === item ? 8 : 0),
      coordinator,
      countChatImageMessages: () => 0,
      countMatchingAssets: () => 0,
      emojiCategories: () => [],
      emojiItems: () => (item ? [item] : []),
      emojiToggles: () => [],
      findInput: () => input,
      fullscreenActive: () => false,
      inputFingerprint: () => '',
      interactiveEmojiItem: (element) => element as HTMLElement,
      isVisible: () => true,
      platformName: '斗鱼',
      refreshPayloadText: (value) => value.text,
      releaseInputFocus: () => undefined,
      showToast: (message) => toasts.push(message),
      submitInsertedEmoji: async () => ({ consumed: true, sent: true }),
      textSender: {
        async send(message: string) {
          sent.push(message)
          return true
        },
      } as unknown as LiveTextSender,
      waitForEmojiResult: async () => options.result || 'dispatched',
    },
  }
}

describe('DouyuSender', () => {
  it('uses bracket text for mixed content', async () => {
    const context = runtime()
    await expect(context.value.textSender.send('')).resolves.toBe(true)
    context.sent.length = 0
    const sender = new DouyuSender(context.value)

    await expect(sender.sendRich(payload('[开心]', true))).resolves.toBe(true)
    expect(context.sent).toEqual(['前[开心]后'])
  })

  it('uses the native picker for one exclusive image so Douyu can emit pe=3', async () => {
    const item = document.createElement('button')
    let clicks = 0
    item.addEventListener('click', () => {
      clicks += 1
    })
    const context = runtime({ item })
    const sender = new DouyuSender(context.value)

    await expect(sender.sendRich(payload('[像个小丑]'))).resolves.toBe(true)
    expect(clicks).toBe(1)
    expect(context.sent).toEqual([])
  })

  it('reports a missing or unauthorized native panel item without sending text', async () => {
    const context = runtime({ item: null })
    const sender = new DouyuSender(context.value)

    await expect(sender.sendRich(payload('[像个小丑]'))).resolves.toBe(false)
    expect(context.sent).toEqual([])
    expect(context.toasts).toHaveLength(1)
  })

  it('leaves platform rate-limit feedback to the shared coordinator', async () => {
    const context = runtime({ result: 'none', settleSuccess: false })
    const sender = new DouyuSender(context.value)

    await expect(sender.sendRich(payload('[像个小丑]'))).resolves.toBe(false)
    expect(context.toasts).toEqual([])
  })
})

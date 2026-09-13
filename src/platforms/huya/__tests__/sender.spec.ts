import { describe, expect, it } from 'vitest'

import type { RichMessagePayload } from '../../live/rich-message'
import type { LiveTextSender } from '../../live/text-sender'
import { HuyaSender } from '../sender'

function payload(token: string): RichMessagePayload {
  const asset = { keys: [`token:${token}`], src: '', token }
  return {
    assets: [asset],
    parts: [
      { text: '前', type: 'text' },
      { asset, type: 'emoji' },
      { text: '后', type: 'text' },
    ],
    plainText: '前后',
    text: `前${token}后`,
  }
}

describe('HuyaSender', () => {
  it('completes image names before using the official text editor', async () => {
    const sent: string[] = []
    let completed = false
    const sender = new HuyaSender({
      completeEmojiTokens: () => {
        completed = true
      },
      platformName: '虎牙',
      refreshPayloadText: (value) => value.text,
      showToast: () => undefined,
      textSender: {
        async send(message: string) {
          sent.push(message)
          return true
        },
      } as unknown as LiveTextSender,
    })

    await expect(sender.sendRich(payload('[开心]'))).resolves.toBe(true)
    expect(completed).toBe(true)
    expect(sent).toEqual(['前[开心]后'])
  })

  it('rejects an unresolved image instead of sending a generic label', async () => {
    const toasts: string[] = []
    const value = payload('[图片表情]')
    const sender = new HuyaSender({
      completeEmojiTokens: () => undefined,
      platformName: '虎牙',
      refreshPayloadText: (current) => current.text,
      showToast: (message) => toasts.push(message),
      textSender: { send: async () => true } as unknown as LiveTextSender,
    })

    await expect(sender.sendRich(value)).resolves.toBe(false)
    expect(toasts).toHaveLength(1)
  })
})

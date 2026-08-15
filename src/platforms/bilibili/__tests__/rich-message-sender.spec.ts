import { describe, expect, it, vi } from 'vitest'

import { bilibiliAutoRecognizedEmojiText, sendBilibiliRichMessage } from '../rich-message-sender'
import type { LiveRichMessagePayload, LiveRichMessageSenderRuntime } from '../../live/rich-message-sender'

function imagePayload(keys: string[]): LiveRichMessagePayload {
  const asset = {
    keys,
    src: 'https://i0.hdslb.com/bfs/live/room-emoticon.webp',
    token: '[抱小皮]',
  }
  return {
    assets: [asset],
    parts: [{ asset, type: 'emoji' }],
    text: '[抱小皮]',
  }
}

function runtime(): LiveRichMessageSenderRuntime {
  return {
    reportEmojiNameUnavailable: vi.fn<() => void>(),
    sendBilibiliNative: vi.fn<(payload: LiveRichMessagePayload) => Promise<boolean>>()
      .mockResolvedValue(true),
    sendText: vi.fn<(message: string) => Promise<boolean>>().mockResolvedValue(true),
  }
}

describe('Bilibili rich image Emoji routing', () => {
  it('uses bracket text only for explicitly identified ordinary Emoji', async () => {
    const payload = imagePayload(['bili-auto-text:official-hug'])
    const sender = runtime()

    expect(bilibiliAutoRecognizedEmojiText(payload)).toBe('[抱小皮]')
    await sendBilibiliRichMessage(payload, sender)

    expect(sender.sendText).toHaveBeenCalledWith('[抱小皮]')
    expect(sender.sendBilibiliNative).not.toHaveBeenCalled()
  })

  it('never downgrades a name-only room Emoji to literal bracket text', async () => {
    const payload = imagePayload(['native-panel:matched-name:[抱小皮]'])
    const sender = runtime()

    expect(bilibiliAutoRecognizedEmojiText(payload)).toBe('')
    await sendBilibiliRichMessage(payload, sender)

    expect(sender.sendBilibiliNative).toHaveBeenCalledWith(payload)
    expect(sender.sendText).not.toHaveBeenCalled()
  })

  it('repairs the persisted panel-name marker produced by the old classifier', async () => {
    const payload = imagePayload(['bili-auto-text:panel-name:[抱小皮]'])
    const sender = runtime()

    expect(bilibiliAutoRecognizedEmojiText(payload)).toBe('')
    await sendBilibiliRichMessage(payload, sender)

    expect(sender.sendBilibiliNative).toHaveBeenCalledWith(payload)
    expect(sender.sendText).not.toHaveBeenCalled()
  })
})

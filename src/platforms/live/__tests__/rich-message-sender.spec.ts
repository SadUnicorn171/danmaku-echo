import { describe, expect, it, vi } from 'vitest'

import type {
  LiveRichMessagePayload,
  LiveRichMessageSenderRuntime,
} from '../rich-message-sender'
import { liveRichMessageSender } from '../rich-message-sender'

function payload(token = '[666]', keys: string[] = []) {
  const asset = { keys, token }
  return {
    assets: [asset],
    parts: [
      { text: '前', type: 'text' },
      { asset, type: 'emoji' },
      { text: '后', type: 'text' },
    ],
    text: `前${token}后`,
  }
}

function runtime() {
  const context = {
    prepareEmojiNames: undefined as LiveRichMessageSenderRuntime['prepareEmojiNames'],
    reportEmojiNameUnavailable: vi.fn<() => void>(),
    sendBilibiliNative:
      vi.fn<(payload: LiveRichMessagePayload) => Promise<boolean>>().mockResolvedValue(true),
    sendText: vi.fn<(message: string) => Promise<boolean>>().mockResolvedValue(true),
  }
  return context satisfies LiveRichMessageSenderRuntime
}

describe('platform rich-message senders', () => {
  it('sends Huya image Emoji through its bracket-name editor conversion', async () => {
    const context = runtime()
    const prepareEmojiNames = vi.fn<(payload: LiveRichMessagePayload) => void>()
    context.prepareEmojiNames = prepareEmojiNames

    await expect(liveRichMessageSender('huya')(payload(), context)).resolves.toBe(true)

    expect(prepareEmojiNames).toHaveBeenCalledOnce()
    expect(context.sendText).toHaveBeenCalledWith('前[666]后')
    expect(context.sendBilibiliNative).not.toHaveBeenCalled()
  })

  it('sends Douyu image Emoji through its bracket-name editor conversion', async () => {
    const context = runtime()

    await expect(liveRichMessageSender('douyu')(payload('[开心]'), context)).resolves.toBe(true)

    expect(context.sendText).toHaveBeenCalledWith('前[开心]后')
    expect(context.sendBilibiliNative).not.toHaveBeenCalled()
  })

  it('lets the Bilibili editor auto-recognize ordinary bracket Emoji', async () => {
    const context = runtime()
    const richPayload = payload('[大哭]', ['bili-auto-text:official-cry'])

    await expect(liveRichMessageSender('bilibili')(richPayload, context)).resolves.toBe(true)

    expect(context.sendText).toHaveBeenCalledWith('前[大哭]后')
    expect(context.sendBilibiliNative).not.toHaveBeenCalled()
  })

  it('deduplicates Bilibili hidden fallback text for one auto-recognized Emoji', async () => {
    const context = runtime()
    const richPayload = payload('[卖萌]', ['bili-auto-text:official-cute'])
    richPayload.parts = [
      { asset: richPayload.assets[0], type: 'emoji' },
      { text: '[卖萌]', type: 'text' },
    ]
    richPayload.text = '[卖萌] [卖萌]'

    await expect(liveRichMessageSender('bilibili')(richPayload, context)).resolves.toBe(true)

    expect(context.sendText).toHaveBeenCalledWith('[卖萌]')
    expect(context.sendBilibiliNative).not.toHaveBeenCalled()
  })

  it.each(['native-panel:room-happy-42', 'bili-exclusive:room-happy-42'])(
    'keeps Bilibili image Emoji with %s identity on the native panel sender',
    async (identity) => {
      const context = runtime()
      const richPayload = payload('[主播表情9]', [identity])

      await expect(liveRichMessageSender('bilibili')(richPayload, context)).resolves.toBe(true)

      expect(context.sendBilibiliNative).toHaveBeenCalledWith(richPayload)
      expect(context.sendText).not.toHaveBeenCalled()
    },
  )

  it('keeps unresolved Bilibili image labels on the native sender', async () => {
    const context = runtime()
    const richPayload = payload('[图片表情]')

    await expect(liveRichMessageSender('bilibili')(richPayload, context)).resolves.toBe(true)

    expect(context.sendBilibiliNative).toHaveBeenCalledWith(richPayload)
    expect(context.sendText).not.toHaveBeenCalled()
  })

  it('does not guess that an unclassified Bilibili bracket image supports text recognition', async () => {
    const context = runtime()
    const richPayload = payload('[大笑]')

    await expect(liveRichMessageSender('bilibili')(richPayload, context)).resolves.toBe(true)

    expect(context.sendBilibiliNative).toHaveBeenCalledWith(richPayload)
    expect(context.sendText).not.toHaveBeenCalled()
  })

  it('keeps Bilibili image Emoji native when only the ordered part retains its identity', async () => {
    const context = runtime()
    const richPayload = payload('[主播表情9]', ['bili-auto-text:ambiguous-resource'])
    richPayload.parts[1] = {
      asset: { keys: ['native-panel:room-happy-42'], token: '[主播表情9]' },
      type: 'emoji',
    }

    await expect(liveRichMessageSender('bilibili')(richPayload, context)).resolves.toBe(true)

    expect(context.sendBilibiliNative).toHaveBeenCalledWith(richPayload)
    expect(context.sendText).not.toHaveBeenCalled()
  })

  it.each(['huya', 'douyu'] as const)(
    'does not send a generic or unresolved %s image label as text',
    async (platform) => {
      const context = runtime()

      await expect(liveRichMessageSender(platform)(payload('[图片表情]'), context)).resolves.toBe(false)

      expect(context.reportEmojiNameUnavailable).toHaveBeenCalledOnce()
      expect(context.sendText).not.toHaveBeenCalled()
      expect(context.sendBilibiliNative).not.toHaveBeenCalled()
    },
  )
})
